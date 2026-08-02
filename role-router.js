/* ElderXonnect first-use role routing and persistent area switch. */
(() => {
  'use strict';

  const ROLE_KEY = 'elderxonnect_role_mode';
  const LAST_AREA_KEY = 'elderxonnect_last_area';

  function goToCaregiving() {
    localStorage.setItem(LAST_AREA_KEY, 'caregiver');
    location.assign('/caregiver.html');
  }

  function rememberRecipientArea() {
    localStorage.setItem(LAST_AREA_KEY, 'recipient');
  }

  function addCaregivingSwitch() {
    if (document.getElementById('elderxonnectCaregivingSwitch')) return;
    const header = document.querySelector('header');
    if (!header) return;

    const button = document.createElement('button');
    button.id = 'elderxonnectCaregivingSwitch';
    button.type = 'button';
    button.setAttribute('aria-label', 'Open caregiving area');
    button.textContent = '👥 Caregiving';
    button.style.cssText = [
      'border:1px solid rgba(46,204,138,.25)',
      'background:rgba(46,204,138,.09)',
      'color:#2ecc8a',
      'border-radius:999px',
      'padding:7px 10px',
      'font:600 11px DM Sans,system-ui,sans-serif',
      'white-space:nowrap',
      'cursor:pointer',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');
    button.onclick = goToCaregiving;
    header.appendChild(button);
  }

  function closeChooser(role) {
    localStorage.setItem(ROLE_KEY, role);
    rememberRecipientArea();
    document.getElementById('elderxonnectRoleChooser')?.remove();
    document.documentElement.style.overflow = '';
    addCaregivingSwitch();
  }

  function choiceButton(title, description, icon, onClick, emphasis = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = [
      'width:100%',
      'display:grid',
      'grid-template-columns:44px 1fr',
      'gap:12px',
      'align-items:center',
      'text-align:left',
      'border-radius:17px',
      `border:1px solid ${emphasis ? 'rgba(46,204,138,.5)' : 'rgba(255,255,255,.1)'}`,
      `background:${emphasis ? 'rgba(46,204,138,.13)' : 'rgba(255,255,255,.04)'}`,
      'color:#e8ede9',
      'padding:15px',
      'cursor:pointer',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');
    button.innerHTML = `
      <span aria-hidden="true" style="font-size:30px;text-align:center">${icon}</span>
      <span>
        <strong style="display:block;font-size:16px;margin-bottom:3px">${title}</strong>
        <span style="display:block;color:#91aa99;font-size:13px;line-height:1.4">${description}</span>
      </span>`;
    button.onclick = onClick;
    return button;
  }

  function showChooser() {
    if (document.getElementById('elderxonnectRoleChooser')) return;

    const overlay = document.createElement('div');
    overlay.id = 'elderxonnectRoleChooser';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'elderxonnectRoleTitle');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:10000',
      'background:#0e1a14',
      'color:#e8ede9',
      'overflow:auto',
      'padding:max(24px,env(safe-area-inset-top)) 18px max(30px,env(safe-area-inset-bottom))',
      'font-family:DM Sans,system-ui,-apple-system,sans-serif'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = 'max-width:520px;margin:0 auto;padding-top:5vh';
    panel.innerHTML = `
      <div style="font-family:Lora,serif;font-size:30px;font-weight:700;margin-bottom:7px">ElderXonnect</div>
      <h1 id="elderxonnectRoleTitle" style="font-family:Lora,serif;font-size:24px;margin:0 0 8px">How will you use ElderXonnect?</h1>
      <p style="color:#91aa99;font-size:14px;line-height:1.5;margin:0 0 20px">Choose where to begin. You can switch between your own care and caregiving at any time.</p>`;

    const choices = document.createElement('div');
    choices.style.cssText = 'display:grid;gap:11px';
    choices.append(
      choiceButton(
        'Manage My Care',
        'Set reminders, save care information, add contacts, and invite caregivers.',
        '🏠',
        () => closeChooser('recipient'),
        true
      ),
      choiceButton(
        'Care for Someone Else',
        'Accept an invitation and open your list of care recipients.',
        '👥',
        () => {
          localStorage.setItem(ROLE_KEY, 'caregiver');
          goToCaregiving();
        }
      ),
      choiceButton(
        'I Do Both',
        'Manage your own care and access people who have shared care information with you.',
        '↔️',
        () => closeChooser('both')
      )
    );

    const note = document.createElement('p');
    note.style.cssText = 'color:#6f8c79;font-size:12px;line-height:1.45;margin:17px 4px 0';
    note.textContent = 'Caregiver access remains read-only unless the care recipient grants additional permissions in a future version.';

    panel.append(choices, note);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    choices.querySelector('button')?.focus();
  }

  function boot() {
    if (location.pathname.endsWith('/caregiver.html')) return;

    const params = new URLSearchParams(location.search);
    if (params.get('area') === 'recipient') {
      rememberRecipientArea();
      params.delete('area');
      const clean = `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`;
      history.replaceState(null, '', clean);
    }

    const role = localStorage.getItem(ROLE_KEY);
    if (!role) showChooser();
    else addCaregivingSwitch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
