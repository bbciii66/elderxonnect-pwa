/* Keep caregiver account creation and confirmation inside the caregiver portal. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const byId = (id) => document.getElementById(id);

  function config() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch { return {}; }
  }

  function invitedEmail() {
    return new URLSearchParams(location.search).get('email')?.trim().toLowerCase() || '';
  }

  async function boot() {
    const emailInput = byId('email');
    const passwordInput = byId('password');
    const createButton = byId('createAccount');
    const status = byId('loginStatus');
    const error = byId('error');
    if (!emailInput || !passwordInput || !createButton || !window.supabase?.createClient) return;

    const invited = invitedEmail();
    if (invited && !emailInput.value) emailInput.value = invited;

    const cfg = config();
    if (!cfg.url || !cfg.key) return;
    const client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    createButton.onclick = async () => {
      try {
        error.textContent = '';
        status.textContent = 'Creating caregiver account…';
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        if (!email || password.length < 8) throw new Error('Enter an email and password of at least 8 characters.');
        if (invited && email !== invited) throw new Error(`Use the invited email address: ${invited}`);

        const returnUrl = new URL('/caregiver.html', location.origin);
        returnUrl.searchParams.set('email', email);
        const result = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: returnUrl.toString() }
        });
        if (result.error) throw result.error;

        if (result.data.session) {
          location.assign(returnUrl.toString());
          return;
        }
        status.textContent = 'Account created. Check your email, confirm the account, and the confirmation link will return you here.';
      } catch (e) {
        status.textContent = '';
        error.textContent = e?.message || String(e);
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
