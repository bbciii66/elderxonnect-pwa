/* Restore an existing My Care Supabase account onto a browser and create a device-only PIN. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const READY_PREFIX = 'elderxonnect_cloud_ready_';
  const LAST_SYNC_KEY = 'elderxonnect_last_sync';
  let restoring = false;

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function store(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function hashPin(pin) {
    let hash = 0;
    for (let i = 0; i < pin.length; i += 1) {
      hash = ((hash << 5) - hash) + pin.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function loadSupabase() {
    if (window.supabase?.createClient) return window.supabase;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-recipient-restore-supabase]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.dataset.recipientRestoreSupabase = '1';
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load secure cloud sign-in.'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function throwIfError(promise) {
    const result = await promise;
    if (result.error) throw result.error;
    return result.data;
  }

  async function restoreAccount() {
    if (restoring) return;

    const emailInput = document.getElementById('restoreRecipientEmail');
    const passwordInput = document.getElementById('restoreRecipientPassword');
    const pinInput = document.getElementById('restoreRecipientPin');
    const confirmInput = document.getElementById('restoreRecipientPinConfirm');
    const button = document.getElementById('restoreRecipientAccount');
    const status = document.getElementById('restoreRecipientStatus');

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const pin = pinInput.value.trim();
    const confirmation = confirmInput.value.trim();

    status.textContent = '';
    status.style.color = '';

    if (!email || password.length < 8) {
      status.textContent = 'Enter the email and password for the existing My Care cloud account.';
      status.style.color = 'var(--red)';
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      status.textContent = 'Choose a four-digit PIN for this device.';
      status.style.color = 'var(--red)';
      return;
    }
    if (pin !== confirmation) {
      status.textContent = 'The two PIN entries do not match.';
      status.style.color = 'var(--red)';
      return;
    }

    const config = parse(CFG_KEY, {});
    if (!config.url || !config.key) {
      status.textContent = 'Cloud configuration is unavailable. Reload the page and try again.';
      status.style.color = 'var(--red)';
      return;
    }

    restoring = true;
    button.disabled = true;
    button.textContent = 'Restoring My Care…';
    status.textContent = 'Signing in and downloading your saved My Care information…';

    try {
      const lib = await loadSupabase();
      const client = lib.createClient(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      const authResult = await client.auth.signInWithPassword({ email, password });
      if (authResult.error) throw authResult.error;

      const session = authResult.data?.session;
      const user = session?.user;
      if (!user?.id) throw new Error('Cloud sign-in succeeded, but no account session was returned.');

      const [profileRow, checkins, reminders, contacts] = await Promise.all([
        throwIfError(client.from('profiles').select('profile_data').eq('user_id', user.id).maybeSingle()),
        throwIfError(client.from('checkins').select('*').eq('user_id', user.id).order('occurred_at', { ascending: false })),
        throwIfError(client.from('reminders').select('*').eq('user_id', user.id).order('created_at', { ascending: true })),
        throwIfError(client.from('contacts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }))
      ]);

      const profile = profileRow?.profile_data && typeof profileRow.profile_data === 'object'
        ? profileRow.profile_data
        : {};
      const metadataName = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
      const emailName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const name = String(profile.name || metadataName || emailName || 'My Care').trim();
      const username = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || `user${Date.now()}`;

      if (!profile.name && name) profile.name = name;
      store('me_profile', profile);
      store('checkins_v2', (checkins || []).map((item) => ({
        clientId: item.client_id,
        ts: new Date(item.occurred_at).getTime(),
        mood: item.mood,
        pain: item.pain,
        notes: item.notes
      })));
      store('reminders', (reminders || []).map((item) => ({
        clientId: item.client_id,
        title: item.title,
        time: item.reminder_time?.slice(0, 5) || '',
        cat: item.category,
        urgent: Boolean(item.urgent),
        created: new Date(item.created_at).getTime()
      })));
      store('contacts', (contacts || []).map((item) => ({
        clientId: item.client_id,
        name: item.name,
        phone: item.phone,
        rel: item.relationship,
        created: new Date(item.created_at).getTime()
      })));

      const localUser = {
        name,
        username,
        pinHash: hashPin(pin),
        created: Date.now(),
        cloudUserId: user.id,
        cloudEmail: user.email || email
      };
      store('auth_users', [localUser]);
      store('auth_session', { ...localUser, ts: Date.now() });
      localStorage.setItem(`${READY_PREFIX}${user.id}`, 'true');
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

      status.textContent = `Account restored for ${escapeHtml(name)}. Opening My Care…`;
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      status.textContent = error?.message || String(error);
      status.style.color = 'var(--red)';
      button.disabled = false;
      button.textContent = 'Restore Existing My Care Account';
      restoring = false;
    }
  }

  function addRestorePanel() {
    if (document.getElementById('recipientAccountRestoreCard')) return;
    const panel = document.querySelector('#authScreen .auth-panel');
    if (!panel) return;

    const card = document.createElement('div');
    card.id = 'recipientAccountRestoreCard';
    card.className = 'auth-card';
    card.style.marginTop = '14px';
    card.innerHTML = `
      <div class="auth-card-title">Already have My Care?</div>
      <div class="auth-card-sub" style="margin-bottom:14px;line-height:1.5">
        Restore your existing cloud account on this device. This does not create another account.
      </div>
      <div class="label">My Care email</div>
      <input id="restoreRecipientEmail" type="email" autocomplete="email" placeholder="you@example.com" style="font-size:16px;margin-bottom:10px">
      <div class="label">Cloud password</div>
      <input id="restoreRecipientPassword" type="password" autocomplete="current-password" minlength="8" placeholder="Your My Care password" style="font-size:16px;margin-bottom:10px">
      <div class="label">Choose a 4-digit PIN for this device</div>
      <input id="restoreRecipientPin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="••••" style="font-size:20px;text-align:center;letter-spacing:8px;margin-bottom:10px">
      <div class="label">Confirm device PIN</div>
      <input id="restoreRecipientPinConfirm" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="••••" style="font-size:20px;text-align:center;letter-spacing:8px;margin-bottom:12px">
      <button class="btn gold" id="restoreRecipientAccount" type="button">Restore Existing My Care Account</button>
      <div class="auth-error" id="restoreRecipientStatus" style="margin-top:10px"></div>`;

    panel.appendChild(card);
    document.getElementById('restoreRecipientAccount').addEventListener('click', restoreAccount);

    ['restoreRecipientPin', 'restoreRecipientPinConfirm'].forEach((id) => {
      document.getElementById(id).addEventListener('input', (event) => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
      });
    });

    const newLink = document.getElementById('showNewUserBtn');
    if (newLink) newLink.textContent = 'Set up a brand-new care recipient';
    const title = document.querySelector('#authNewUser .auth-card-title');
    if (title) title.textContent = 'Set Up a New Care Recipient';
  }

  function boot() {
    addRestorePanel();
    window.setTimeout(addRestorePanel, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();