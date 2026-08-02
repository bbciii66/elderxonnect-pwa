/* ElderXonnect multi-recipient caregiver Care List. */
(() => {
  'use strict';

  const LAST_AREA_KEY = 'elderxonnect_last_area';
  let rendering = false;
  let scheduled = null;
  let lastSignature = '';

  function getClient() {
    try { return typeof client !== 'undefined' ? client : null; }
    catch { return null; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function displayDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
  }

  function addMyCareSwitch() {
    if (document.getElementById('elderxonnectMyCareSwitch')) return;
    const subtitle = document.querySelector('body > .sub');
    if (!subtitle) return;
    const button = document.createElement('button');
    button.id = 'elderxonnectMyCareSwitch';
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '← My Care';
    button.style.cssText = 'width:auto;display:inline-block;padding:8px 13px;margin:0 0 16px';
    button.onclick = () => {
      localStorage.setItem(LAST_AREA_KEY, 'recipient');
      location.assign('/?area=recipient');
    };
    subtitle.insertAdjacentElement('afterend', button);
  }

  function summaryForRecipient(reminders, checkins) {
    const urgent = reminders.filter((item) => item.urgent).length;
    const latest = [...checkins].sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))[0];
    return {
      reminderCount: reminders.length,
      urgentCount: urgent,
      latestCheckin: latest?.occurred_at || null
    };
  }

  async function acceptInvitation(sb, id, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Accepting…';
    try {
      const result = await sb.rpc('accept_caregiver_invitation', { invitation_id: id });
      if (result.error) throw result.error;
      lastSignature = '';
      if (typeof loadInvitations === 'function') await loadInvitations();
      scheduleRender();
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      window.alert(error?.message || String(error));
    }
  }

  async function removeAccess(sb, access, label, button) {
    const confirmed = window.confirm(
      `Remove caregiver access to ${label}?\n\nThis removes only your read-only link. It does not delete the care recipient's information.`
    );
    if (!confirmed) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Removing…';
    try {
      const result = await sb.rpc('leave_caregiver_access', { access_id: access.id });
      if (result.error) throw result.error;
      lastSignature = '';
      if (typeof loadInvitations === 'function') await loadInvitations();
      scheduleRender();
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      window.alert(`Could not remove access: ${error?.message || String(error)}`);
    }
  }

  function cardMarkup(access, profile, recipientReminders, recipientCheckins) {
    const name = String(profile?.name || '').trim() || 'Unnamed care recipient';
    const summary = summaryForRecipient(recipientReminders, recipientCheckins);
    const initial = (name.match(/[A-Za-z0-9]/)?.[0] || '•').toUpperCase();
    const urgentText = summary.urgentCount
      ? `<span style="color:#ff7777;font-weight:700">${summary.urgentCount} urgent</span>`
      : '<span>No urgent items</span>';
    const lastCheckin = summary.latestCheckin
      ? `Latest check-in ${escapeHtml(displayDate(summary.latestCheckin))}`
      : 'No check-ins recorded';

    return `
      <article class="careRecipientCard" data-access-id="${escapeHtml(access.id)}" style="border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:15px;margin:11px 0;background:#101b14">
        <div style="display:flex;align-items:center;gap:12px">
          <div aria-hidden="true" style="width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(46,204,138,.14);color:#2ecc8a;font-size:20px;font-weight:800">${escapeHtml(initial)}</div>
          <div style="min-width:0;flex:1">
            <strong style="display:block;font-size:18px;overflow-wrap:anywhere">${escapeHtml(name)}</strong>
            <div class="key">Care recipient · Read only</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px">
          <div style="background:#0b1510;border-radius:12px;padding:10px;text-align:center"><strong style="font-size:20px">${summary.reminderCount}</strong><div class="key">Reminders</div></div>
          <div style="background:#0b1510;border-radius:12px;padding:10px;text-align:center"><strong style="font-size:14px">${urgentText}</strong><div class="key">Priority</div></div>
        </div>
        <div class="key" style="margin-top:10px">${escapeHtml(lastCheckin)}</div>
        <button class="openCareRecipient" data-elder-id="${escapeHtml(access.elder_id)}">Open Care Dashboard</button>
        <button class="secondary removeCareRecipientAccess" data-access-id="${escapeHtml(access.id)}" style="margin-top:8px">Remove Access</button>
      </article>`;
  }

  async function renderCareList() {
    if (rendering) return;
    const sb = getClient();
    const accessCard = document.getElementById('accessCard');
    const list = document.getElementById('invitationList');
    if (!sb || !accessCard || !list || accessCard.classList.contains('hidden')) return;

    rendering = true;
    try {
      const accessResult = await sb
        .from('caregiver_access')
        .select('id,elder_id,caregiver_email,status,invited_at,accepted_at')
        .order('accepted_at', { ascending: true, nullsFirst: false });
      if (accessResult.error) throw accessResult.error;

      const rows = accessResult.data || [];
      const active = rows.filter((row) => row.status === 'active' && row.elder_id);
      const pending = rows.filter((row) => row.status === 'pending');
      const elderIds = [...new Set(active.map((row) => row.elder_id))];

      let profileRows = [];
      let reminderRows = [];
      let checkinRows = [];
      if (elderIds.length) {
        const [profilesResult, remindersResult, checkinsResult] = await Promise.all([
          sb.from('profiles').select('user_id,profile_data').in('user_id', elderIds),
          sb.from('reminders').select('*').in('user_id', elderIds),
          sb.from('checkins').select('user_id,occurred_at,mood,pain').in('user_id', elderIds)
        ]);
        if (profilesResult.error) throw profilesResult.error;
        if (remindersResult.error) throw remindersResult.error;
        if (checkinsResult.error) throw checkinsResult.error;
        profileRows = profilesResult.data || [];
        reminderRows = remindersResult.data || [];
        checkinRows = checkinsResult.data || [];
      }

      const profiles = new Map(profileRows.map((row) => [row.user_id, row.profile_data || {}]));
      const remindersByElder = new Map(elderIds.map((id) => [id, []]));
      const checkinsByElder = new Map(elderIds.map((id) => [id, []]));
      reminderRows.forEach((row) => remindersByElder.get(row.user_id)?.push(row));
      checkinRows.forEach((row) => checkinsByElder.get(row.user_id)?.push(row));

      const signature = JSON.stringify({
        rows: rows.map((row) => [row.id, row.elder_id, row.status, row.accepted_at]),
        profiles: profileRows.map((row) => [row.user_id, row.profile_data?.name || '']),
        reminders: elderIds.map((id) => [id, remindersByElder.get(id)?.length || 0, remindersByElder.get(id)?.filter((x) => x.urgent).length || 0]),
        checkins: elderIds.map((id) => [id, checkinsByElder.get(id)?.length || 0])
      });
      if (signature === lastSignature && list.querySelector('.careRecipientCard')) return;
      lastSignature = signature;

      accessCard.querySelector('h2').textContent = 'My Care List';
      const signedIn = document.getElementById('signedInAs');
      if (signedIn && !document.getElementById('careListHelp')) {
        const lineBreak = document.createElement('br');
        const help = document.createElement('span');
        help.id = 'careListHelp';
        help.style.color = '#e8c97e';
        help.textContent = 'Choose a care recipient to open their read-only dashboard.';
        signedIn.append(lineBreak, help);
      }

      const activeMarkup = active.length
        ? active.map((access) => cardMarkup(
            access,
            profiles.get(access.elder_id),
            remindersByElder.get(access.elder_id) || [],
            checkinsByElder.get(access.elder_id) || []
          )).join('')
        : '<div class="empty" style="padding:12px 0">No active care recipients yet.</div>';

      const pendingMarkup = pending.length
        ? `<div style="margin-top:18px"><h3 style="font-size:16px;margin-bottom:8px">Pending Invitations</h3>${pending.map((invite) => `
            <div class="row">
              <strong>Invitation waiting</strong>
              <div class="key">Received ${escapeHtml(displayDate(invite.invited_at))}</div>
              <button class="gold careListAccept" data-invitation-id="${escapeHtml(invite.id)}">Accept Invitation</button>
            </div>`).join('')}</div>`
        : '';

      list.innerHTML = `<div id="activeCareRecipients">${activeMarkup}</div>${pendingMarkup}`;

      list.querySelectorAll('.openCareRecipient').forEach((button) => {
        button.onclick = () => {
          localStorage.setItem(LAST_AREA_KEY, 'caregiver');
          if (typeof openDashboard === 'function') openDashboard(button.dataset.elderId);
        };
      });
      list.querySelectorAll('.careListAccept').forEach((button) => {
        button.onclick = () => acceptInvitation(sb, button.dataset.invitationId, button);
      });
      list.querySelectorAll('.removeCareRecipientAccess').forEach((button) => {
        const access = active.find((row) => row.id === button.dataset.accessId);
        if (!access) return;
        const label = String(profiles.get(access.elder_id)?.name || '').trim() || 'this care recipient';
        button.onclick = () => removeAccess(sb, access, label, button);
      });
    } catch (error) {
      console.error('Could not build caregiver Care List:', error);
    } finally {
      rendering = false;
    }
  }

  function scheduleRender() {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => renderCareList().catch(() => {}), 180);
  }

  function boot() {
    addMyCareSwitch();
    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });
    scheduleRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
