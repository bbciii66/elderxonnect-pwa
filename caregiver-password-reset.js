/* ElderXonnect caregiver password recovery */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const byId = (id) => document.getElementById(id);
  let recoveryObserver = null;

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch { return {}; }
  }

  function emailFromUrl() {
    return new URLSearchParams(location.search).get('email')?.trim().toLowerCase() || '';
  }

  function recoveryInUrl() {
    return /(?:^|[?#&])type=recovery(?:&|$)/i.test(`${location.search}${location.hash}`)
      || new URLSearchParams(location.search).get('recovery') === '1';
  }

  function enforceRecoveryView() {
    byId('loginCard')?.classList.remove('hidden');
    byId('accessCard')?.classList.add('hidden');
    byId('portal')?.classList.add('hidden');
  }

  function showResetForm(client) {
    const loginCard = byId('loginCard');
    if (!loginCard) return;

    enforceRecoveryView();
    document.documentElement.dataset.caregiverRecovery = 'true';

    if (!recoveryObserver) {
      recoveryObserver = new MutationObserver(enforceRecoveryView);
      recoveryObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }

    if (byId('saveCaregiverPassword')) return;

    const email = emailFromUrl();
    loginCard.innerHTML = `
      <div style="margin:0 0 15px;padding:14px;border:1px solid rgba(46,204,138,.25);background:rgba(46,204,138,.07);border-radius:14px;line-height:1.45">
        <div style="font-weight:750;margin-bottom:7px;color:#2ecc8a">Set caregiver password</div>
        <div style="font-size:13px;color:#b8c9bd">The secure email link verified your identity. Now choose the password you will use for future caregiver sign-ins.</div>
      </div>
      <label for="newCaregiverPassword">New password</label>
      <input id="newCaregiverPassword" type="password" autocomplete="new-password" minlength="8" />
      <label for="confirmCaregiverPassword">Confirm new password</label>
      <input id="confirmCaregiverPassword" type="password" autocomplete="new-password" minlength="8" />
      <button id="saveCaregiverPassword">Save New Password</button>
      <div class="error" id="passwordResetError"></div>
      <div class="status" id="passwordResetStatus"></div>`;

    byId('saveCaregiverPassword').onclick = async () => {
      const button = byId('saveCaregiverPassword');
      const error = byId('passwordResetError');
      const status = byId('passwordResetStatus');
      try {
        error.textContent = '';
        const password = byId('newCaregiverPassword').value;
        const confirm = byId('confirmCaregiverPassword').value;
        if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
        if (password !== confirm) throw new Error('The two passwords do not match.');
        button.disabled = true;
        button.textContent = 'Saving…';
        status.textContent = 'Updating caregiver password…';
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        await client.auth.signOut();
        recoveryObserver?.disconnect();
        const next = new URL('/caregiver.html', location.origin);
        if (email) next.searchParams.set('email', email);
        next.searchParams.set('reset', 'done');
        location.replace(next.toString());
      } catch (e) {
        button.disabled = false;
        button.textContent = 'Save New Password';
        status.textContent = '';
        error.textContent = e?.message || String(e);
      }
    };
  }

  async function boot() {
    const emailInput = byId('email');
    const loginCard = byId('loginCard');
    const buttonGrid = loginCard?.querySelector('.buttonGrid');
    if (!emailInput || !loginCard || !window.supabase?.createClient) return;

    const cfg = getConfig();
    if (!cfg.url || !cfg.key) return;
    const client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && recoveryInUrl())) {
        showResetForm(client);
      }
    });

    const sessionResult = await client.auth.getSession();
    if (sessionResult.data.session && recoveryInUrl()) {
      showResetForm(client);
      return;
    }

    if (!buttonGrid) return;

    if (!byId('forgotCaregiverPassword')) {
      const forgot = document.createElement('button');
      forgot.id = 'forgotCaregiverPassword';
      forgot.type = 'button';
      forgot.className = 'secondary';
      forgot.textContent = 'Forgot or Set Password';
      buttonGrid.insertAdjacentElement('afterend', forgot);

      forgot.onclick = async () => {
        const status = byId('loginStatus');
        const error = byId('error');
        try {
          error.textContent = '';
          const email = emailInput.value.trim().toLowerCase();
          if (!email) throw new Error('Enter the caregiver email address first.');
          forgot.disabled = true;
          forgot.textContent = 'Sending…';
          status.textContent = 'Requesting a secure password link…';
          const returnUrl = new URL('/caregiver.html', location.origin);
          returnUrl.searchParams.set('email', email);
          returnUrl.searchParams.set('recovery', '1');
          const result = await client.auth.resetPasswordForEmail(email, {
            redirectTo: returnUrl.toString()
          });
          if (result.error) throw result.error;
          status.textContent = 'Password email requested. Check the inbox and spam folder, then open the link to set a new password.';
        } catch (e) {
          status.textContent = '';
          error.textContent = e?.message || String(e);
        } finally {
          forgot.disabled = false;
          forgot.textContent = 'Forgot or Set Password';
        }
      };
    }

    if (new URLSearchParams(location.search).get('reset') === 'done') {
      byId('loginStatus').textContent = 'Password updated. Enter the new password and tap Sign In to Accept.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
