/* ElderXonnect caregiver invitation onboarding */
(() => {
  'use strict';

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
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
