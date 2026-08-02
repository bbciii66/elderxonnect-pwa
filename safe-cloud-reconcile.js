/* Protect meaningful local care data from empty cloud records and reconcile it safely. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const DEVICE_KEY = 'elderxonnect_device_id';
  const RECOVERY_KEY = 'elderxonnect_pending_local_recovery';
  const PROTECTED_KEYS = ['me_profile', 'checkins_v2', 'reminders', 'contacts'];
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

  function meaningfulValue(key, value) {
    if (key === 'me_profile') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return Object.values(value).some((item) => {
        if (Array.isArray(item)) return item.length > 0;
        if (item && typeof item === 'object') return Object.keys(item).length > 0;
        return String(item ?? '').trim().length > 0;
      });
    }
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

  function markForRecovery(key) {
    const state = recoveryState();
    state[key] = true;
    state.detectedAt = state.detectedAt || new Date().toISOString();
    nativeSetItem.call(localStorage, RECOVERY_KEY, JSON.stringify(state));
    scheduleReconcile();
  }

  Storage.prototype.setItem = function protectedSetItem(key, value) {
    if (this === localStorage && PROTECTED_KEYS.includes(key)) {
      const incoming = parseText(value, key === 'me_profile' ? {} : []);
      const current = parseText(nativeGetItem.call(this, key), key === 'me_profile' ? {} : []);

      if (!meaningfulValue(key, incoming) && meaningfulValue(key, current)) {
        backup(key, current, 'Blocked empty cloud overwrite');
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

  async function reconcile() {
    if (reconciling) return;
    const pending = recoveryState();
    const keys = PROTECTED_KEYS.filter((key) => pending[key]);
    if (!keys.length) return;

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
      const userId = sessionResult.data?.session?.user?.id;
      if (!userId) return;

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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
