/* Protect meaningful local care data from empty or incomplete cloud records and reconcile it safely. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const DEVICE_KEY = 'elderxonnect_device_id';
  const RECOVERY_KEY = 'elderxonnect_pending_local_recovery';
  const PROTECTED_KEYS = ['me_profile', 'checkins_v2', 'reminders', 'contacts'];
  const PROFILE_FIELDS = [
    'name', 'dob', 'blood', 'homeAddr', 'mailAddr', 'allergies', 'conditions',
    'doctor', 'doctorPhone', 'caregiverName', 'caregiverPhone', 'familyList'
  ];
  const nativeSetItem = Storage.prototype.setItem;
  const nativeGetItem = Storage.prototype.getItem;
  let reconciling = false;
  let retryTimer = null;

  function parseText(text, fallback) {
    try { return JSON.parse(text) ?? fallback; }
    catch { return fallback; }
  }

  function parseKey(key, fallback) {
    return parseText(nativeGetItem.call(localStorage, key), fallback);
  }

  function profileRichness(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return 0;
    return PROFILE_FIELDS.reduce((score, key) => {
      const value = profile[key];
      if (Array.isArray(value)) return score + (value.length ? 1 : 0);
      if (value && typeof value === 'object') return score + (Object.keys(value).length ? 1 : 0);
      return score + (String(value ?? '').trim() ? 1 : 0);
    }, 0);
  }

  function meaningfulValue(key, value) {
    if (key === 'me_profile') return profileRichness(value) > 0;
    return Array.isArray(value) && value.length > 0;
  }

  function backup(key, value, reason) {
    if (!meaningfulValue(key, value)) return;
    nativeSetItem.call(localStorage, `elderxonnect_backup_${key}`, JSON.stringify({
      value,
      reason,
      savedAt: new Date().toISOString()
    }));
  }

  function recoveryState() {
    const state = parseKey(RECOVERY_KEY, {});
    return state && typeof state === 'object' ? state : {};
  }

  function saveRecoveryState(state) {
    if (PROTECTED_KEYS.some((key) => state[key])) {
      state.detectedAt = state.detectedAt || new Date().toISOString();
      nativeSetItem.call(localStorage, RECOVERY_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(RECOVERY_KEY);
    }
  }

  function markForRecovery(key) {
    const state = recoveryState();
    state[key] = true;
    saveRecoveryState(state);
    scheduleReconcile();
  }

  Storage.prototype.setItem = function protectedSetItem(key, value) {
    if (this === localStorage && PROTECTED_KEYS.includes(key)) {
      const incoming = parseText(value, key === 'me_profile' ? {} : []);
      const current = parseText(nativeGetItem.call(this, key), key === 'me_profile' ? {} : []);
      const emptyOverwrite = !meaningfulValue(key, incoming) && meaningfulValue(key, current);
      const thinProfileOverwrite = key === 'me_profile'
        && profileRichness(current) >= 3
        && profileRichness(incoming) <= 1;

      if (emptyOverwrite || thinProfileOverwrite) {
        backup(key, current, thinProfileOverwrite
          ? 'Blocked incomplete cloud profile overwrite'
          : 'Blocked empty cloud overwrite');
        markForRecovery(key);
        window.dispatchEvent(new CustomEvent('elderxonnect-empty-cloud-overwrite-blocked', {
          detail: { key }
        }));
        return;
      }

      if (meaningfulValue(key, incoming)) backup(key, incoming, 'Latest meaningful local value');
    }

    return nativeSetItem.call(this, key, value);
  };

  function deviceId() {
    let value = nativeGetItem.call(localStorage, DEVICE_KEY);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      nativeSetItem.call(localStorage, DEVICE_KEY, value);
    }
    return value;
  }

  function stableClientId(kind, item, index) {
    return String(item.clientId || item.client_id || `${deviceId()}:recovery:${kind}:${item.created || item.ts || index}`);
  }

  async function loadSupabase() {
    if (window.supabase?.createClient) return window.supabase;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-safe-reconcile-supabase]');
      if (existing) {
        if (window.supabase?.createClient) return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.dataset.safeReconcileSupabase = '1';
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Supabase for safe recovery.'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function check(resultPromise) {
    const result = await resultPromise;
    if (result.error) throw result.error;
    return result.data;
  }

  function setStatus(message) {
    const status = document.getElementById('cloudStatus');
    if (status) status.textContent = message;
  }

  function identityMatches(session) {
    const localSession = parseKey('auth_session', {});
    const localUsers = parseKey('auth_users', []);
    const expected = String(localSession?.cloudEmail || localUsers?.[0]?.cloudEmail || '').trim().toLowerCase();
    const actual = String(session?.user?.email || '').trim().toLowerCase();
    return !expected || !actual || expected === actual;
  }

  async function detectRecoveryNeeds(client, userId, state) {
    const [profileRow, cloudCheckins, cloudReminders, cloudContacts] = await Promise.all([
      check(client.from('profiles').select('profile_data').eq('user_id', userId).maybeSingle()),
      check(client.from('checkins').select('id').eq('user_id', userId).limit(1)),
      check(client.from('reminders').select('id').eq('user_id', userId).limit(1)),
      check(client.from('contacts').select('id').eq('user_id', userId).limit(1))
    ]);

    const cloudValues = {
      me_profile: profileRow?.profile_data || {},
      checkins_v2: cloudCheckins || [],
      reminders: cloudReminders || [],
      contacts: cloudContacts || []
    };

    PROTECTED_KEYS.forEach((key) => {
      const localValue = parseKey(key, key === 'me_profile' ? {} : []);
      let shouldRecover = meaningfulValue(key, localValue) && !meaningfulValue(key, cloudValues[key]);

      if (key === 'me_profile') {
        const localScore = profileRichness(localValue);
        const cloudScore = profileRichness(cloudValues[key]);
        shouldRecover = shouldRecover || (localScore >= 3 && cloudScore <= 1);
      }

      if (shouldRecover) {
        backup(key, localValue, 'Cloud record was empty or incomplete');
        state[key] = true;
      }
    });

    saveRecoveryState(state);
    return state;
  }

  async function reconcile() {
    if (reconciling) return;

    const config = parseKey(CFG_KEY, {});
    if (!config.url || !config.key) return;

    reconciling = true;
    try {
      const lib = await loadSupabase();
      const client = lib.createClient(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      const session = sessionResult.data?.session;
      const userId = session?.user?.id;
      if (!userId || !identityMatches(session)) return;

      let pending = recoveryState();
      pending = await detectRecoveryNeeds(client, userId, pending);
      const keys = PROTECTED_KEYS.filter((key) => pending[key]);
      if (!keys.length) return;

      setStatus('Preserving this device’s saved care information…');

      const profile = parseKey('me_profile', {});
      if (pending.me_profile && meaningfulValue('me_profile', profile)) {
        await check(client.from('profiles').upsert(
          { user_id: userId, profile_data: profile },
          { onConflict: 'user_id' }
        ));

        const snapshotResult = await client.rpc('set_care_recipient_profile', {
          p_profile: profile
        });
        if (snapshotResult.error) console.warn('Caregiver snapshot update deferred:', snapshotResult.error);
      }

      const checkins = parseKey('checkins_v2', []);
      if (pending.checkins_v2 && checkins.length) {
        const rows = checkins.map((item, index) => ({
          user_id: userId,
          client_id: stableClientId('checkin', item, index),
          occurred_at: new Date(item.ts || Date.now()).toISOString(),
          mood: item.mood || 'OK',
          pain: Number(item.pain || 0),
          notes: item.notes || ''
        }));
        await check(client.from('checkins').upsert(rows, { onConflict: 'user_id,client_id' }));
      }

      const reminders = parseKey('reminders', []);
      if (pending.reminders && reminders.length) {
        const rows = reminders.map((item, index) => ({
          user_id: userId,
          client_id: stableClientId('reminder', item, index),
          title: item.title || '',
          reminder_time: item.time || null,
          category: item.cat || '⭐',
          urgent: Boolean(item.urgent),
          created_at: new Date(item.created || Date.now()).toISOString()
        }));
        await check(client.from('reminders').upsert(rows, { onConflict: 'user_id,client_id' }));
      }

      const contacts = parseKey('contacts', []);
      if (pending.contacts && contacts.length) {
        const rows = contacts.map((item, index) => ({
          user_id: userId,
          client_id: stableClientId('contact', item, index),
          name: item.name || '',
          phone: item.phone || '',
          relationship: item.rel || 'Other',
          created_at: new Date(item.created || Date.now()).toISOString()
        }));
        await check(client.from('contacts').upsert(rows, { onConflict: 'user_id,client_id' }));
      }

      nativeSetItem.call(localStorage, `elderxonnect_cloud_ready_${userId}`, 'true');
      localStorage.removeItem(RECOVERY_KEY);
      setStatus('✅ Saved local care information was protected and restored to cloud');
      window.dispatchEvent(new CustomEvent('elderxonnect-local-recovery-complete'));
    } catch (error) {
      console.warn('Safe cloud reconcile failed:', error);
      setStatus(`⚠️ Could not safely reconcile local data: ${error?.message || error}`);
    } finally {
      reconciling = false;
    }
  }

  function scheduleReconcile() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => reconcile(), 1200);
    setTimeout(() => reconcile(), 3500);
    setTimeout(() => reconcile(), 8000);
  }

  function removeOldPublisher() {
    document.getElementById('publishCaregiverNameCard')?.remove();
  }

  function boot() {
    PROTECTED_KEYS.forEach((key) => {
      const value = parseKey(key, key === 'me_profile' ? {} : []);
      if (meaningfulValue(key, value)) backup(key, value, 'Startup backup');
    });

    removeOldPublisher();
    new MutationObserver(removeOldPublisher).observe(document.body, { childList: true, subtree: true });
    scheduleReconcile();
    window.addEventListener('focus', scheduleReconcile);
    window.addEventListener('pageshow', scheduleReconcile);
    setInterval(scheduleReconcile, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
