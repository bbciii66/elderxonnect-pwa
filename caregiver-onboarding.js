/* ElderXonnect caregiver invitation onboarding */
(() => {
  'use strict';

  function ensureAcceptStatus() {
    let el = document.getElementById('acceptInviteStatus');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'acceptInviteStatus';
    el.className = 'status';
    el.style.cssText = 'margin:10px 0;color:#e8c97e;line-height:1.45';
    const list = document.getElementById('invitationList');
    list?.parentElement?.insertBefore(el, list);
    return el;
  }

  async function acceptWithFeedback(button) {
    const status = ensureAcceptStatus();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Accepting…';
    status.textContent = 'Activating caregiver access…';

    try {
      if (!window.client && typeof client === 'undefined') {
        throw new Error('Caregiver connection is not ready. Reload the page and try again.');
      }
      const sb = window.client || client;
      const result = await sb.rpc('accept_caregiver_invitation', {
        invitation_id: button.dataset.id
      });
      if (result.error) throw result.error;

      status.style.color = '#2ecc8a';
      status.textContent = '✅ Invitation accepted. Loading your care dashboard access…';
      if (typeof loadInvitations === 'function') await loadInvitations();
    } catch (error) {
      console.error('Caregiver invitation acceptance failed:', error);
      status.style.color = '#ff7777';
      status.textContent = `⚠️ ${error?.message || String(error)}`;
      button.disabled = false;
      button.textContent = original;
    }
  }

  function wireAcceptButtons() {
    document.querySelectorAll('.acceptInvite').forEach((button) => {
      if (button.dataset.feedbackWired === 'true') return;
      button.dataset.feedbackWired = 'true';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        acceptWithFeedback(button);
      }, true);
    });
  }

  function boot() {
    const emailInput = document.getElementById('email');
    const loginCard = document.getElementById('loginCard');
    if (!emailInput || !loginCard || document.getElementById('inviteSteps')) return;

    const params = new URLSearchParams(location.search);
    const invitedEmail = (params.get('email') || '').trim().toLowerCase();
    if (invitedEmail) {
      emailInput.value = invitedEmail;
      emailInput.readOnly = true;
    }

    const steps = document.createElement('div');
    steps.id = 'inviteSteps';
    steps.style.cssText = 'margin:0 0 15px;padding:14px;border:1px solid rgba(46,204,138,.25);background:rgba(46,204,138,.07);border-radius:14px;line-height:1.45';
    steps.innerHTML = `
      <div style="font-weight:750;margin-bottom:7px;color:#2ecc8a">Caregiver invitation</div>
      <div style="font-size:13px;color:#b8c9bd">
        <strong>New caregiver:</strong> enter a password and tap <strong>Create Account</strong>.<br>
        Confirm the email message, return here, and sign in.<br><br>
        <strong>Existing caregiver:</strong> enter your password and tap <strong>Sign In</strong>.
      </div>`;
    loginCard.insertBefore(steps, loginCard.firstChild);

    const createButton = document.getElementById('createAccount');
    const signInButton = document.getElementById('signIn');
    if (createButton) createButton.textContent = 'Create Caregiver Account';
    if (signInButton) signInButton.textContent = 'Sign In to Accept';

    const observer = new MutationObserver(() => {
      const accessCard = document.getElementById('accessCard');
      const invitationList = document.getElementById('invitationList');
      if (!accessCard || !invitationList || accessCard.classList.contains('hidden')) return;
      const pending = invitationList.querySelector('.acceptInvite');
      if (pending && !document.getElementById('acceptHelp')) {
        const help = document.createElement('div');
        help.id = 'acceptHelp';
        help.className = 'notice';
        help.style.marginBottom = '10px';
        help.textContent = 'Your account is confirmed. Tap Accept Invitation to activate secure read-only access.';
        invitationList.parentElement?.insertBefore(help, invitationList);
      }
      wireAcceptButtons();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    wireAcceptButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
