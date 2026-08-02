/* Label caregiver access by shared profile/data and allow caregivers to remove their own access. */
(() => {
  'use strict';

  const escText = (value) => String(value ?? '');
  let refreshTimer = null;
  let lastSignature = '';

  function getClient() {
    try {
      return typeof client !== 'undefined' ? client : null;
    } catch {
      return null;
    }
  }

  async function loadAccessDetails() {
    const sb = getClient();
    const list = document.getElementById('invitationList');
    const accessCard = document.getElementById('accessCard');
    if (!sb || !list || !accessCard || accessCard.classList.contains('hidden')) return;

    const accessResult = await sb
      .from('caregiver_access')
      .select('id,elder_id,status,accepted_at')
      .eq('status', 'active')
      .order('accepted_at', { ascending: true });
    if (accessResult.error) return;

    const accessRows = accessResult.data || [];
    const elderIds = [...new Set(accessRows.map((row) => row.elder_id).filter(Boolean))];
    if (!elderIds.length) return;

    const [profileResult, reminderResult] = await Promise.all([
      sb.from('profiles').select('user_id,profile_data').in('user_id', elderIds),
      sb.from('reminders').select('user_id').in('user_id', elderIds)
    ]);

    const profiles = new Map();
    (profileResult.data || []).forEach((row) => profiles.set(row.user_id, row.profile_data || {}));
    const reminderCounts = new Map(elderIds.map((id) => [id, 0]));
    (reminderResult.data || []).forEach((row) => {
      reminderCounts.set(row.user_id, (reminderCounts.get(row.user_id) || 0) + 1);
    });

    const signature = JSON.stringify(accessRows.map((row) => [row.id, row.elder_id, reminderCounts.get(row.elder_id) || 0, profiles.get(row.elder_id)?.name || '']));
    if (signature === lastSignature && list.querySelector('.removeCaregiverAccess')) return;
    lastSignature = signature;

    accessRows.forEach((access) => {
      const openButton = list.querySelector(`.openElder[data-elder="${CSS.escape(access.elder_id)}"]`);
      if (!openButton) return;
      const row = openButton.closest('.row');
      if (!row) return;

      const profile = profiles.get(access.elder_id) || {};
      const reminderCount = reminderCounts.get(access.elder_id) || 0;
      const displayName = (profile.name || '').trim() || `Shared person ${access.elder_id.slice(0, 8)}`;
      const dataNote = reminderCount === 1 ? '1 reminder' : `${reminderCount} reminders`;

      const title = row.querySelector('strong');
      if (title) title.textContent = displayName;

      let detail = row.querySelector('.sharedAccessDetail');
      if (!detail) {
        detail = document.createElement('div');
        detail.className = 'key sharedAccessDetail';
        openButton.insertAdjacentElement('beforebegin', detail);
      }
      detail.textContent = `${dataNote} · Account ${access.elder_id.slice(0, 8)}`;

      if (!row.querySelector('.removeCaregiverAccess')) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary removeCaregiverAccess';
        remove.style.marginTop = '8px';
        remove.textContent = 'Remove This Access';
        remove.dataset.accessId = access.id;
        remove.dataset.label = displayName;
        openButton.insertAdjacentElement('afterend', remove);
        remove.onclick = () => removeAccess(remove);
      }
    });

    const select = document.getElementById('elderSelect');
    if (select) {
      [...select.options].forEach((option) => {
        const profile = profiles.get(option.value) || {};
        const count = reminderCounts.get(option.value) || 0;
        const name = (profile.name || '').trim() || `Shared person ${option.value.slice(0, 8)}`;
        option.textContent = `${name} — ${count} reminder${count === 1 ? '' : 's'}`;
      });
    }
  }

  async function removeAccess(button) {
    const sb = getClient();
    if (!sb) return;
    const label = button.dataset.label || 'this shared person';
    const confirmed = window.confirm(`Remove your caregiver access to ${label}?\n\nThis removes only your read-only caregiver link. It does not delete the elder's data.`);
    if (!confirmed) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Removing…';
    try {
      const result = await sb.rpc('leave_caregiver_access', {
        access_id: button.dataset.accessId
      });
      if (result.error) throw result.error;
      lastSignature = '';
      if (typeof loadInvitations === 'function') await loadInvitations();
      scheduleRefresh();
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      window.alert(`Could not remove access: ${error?.message || escText(error)}`);
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadAccessDetails().catch(() => {}), 120);
  }

  function boot() {
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });
    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
