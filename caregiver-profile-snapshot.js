/* Render shared recipient profiles directly from caregiver-access snapshots. */
(() => {
  'use strict';

  let snapshots = new Map();
  let loading = false;
  let timer = null;
  let selectedElderId = sessionStorage.getItem('elderxonnect_selected_elder') || '';

  function getClient() {
    try { return typeof client !== 'undefined' ? client : null; }
    catch { return null; }
  }

  function getSelectedElderId() {
    const select = document.getElementById('elderSelect');
    if (select?.value) return select.value;
    if (selectedElderId) return selectedElderId;
    const onlyCard = document.querySelector('.careRecipientCard .openCareRecipient');
    return onlyCard?.dataset?.elderId || '';
  }

  function displayName(profile) {
    return String(profile?.name || '').trim();
  }

  function safeText(value) {
    const text = String(value ?? '').trim();
    return text || '—';
  }

  function profileRows(profile) {
    return [
      ['Name', profile?.name],
      ['Date of birth', profile?.dob],
      ['Blood type', profile?.blood],
      ['Allergies', profile?.allergies],
      ['Medical conditions', profile?.conditions],
      ['Doctor', profile?.doctor],
      ['Doctor phone', profile?.doctorPhone],
      ['Home address', profile?.homeAddr],
      ['Primary caregiver', profile?.caregiverName],
      ['Caregiver phone', profile?.caregiverPhone]
    ];
  }

  function renderSnapshot(profile) {
    const container = document.getElementById('profile');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    profileRows(profile).forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'row';

      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = label;

      const val = document.createElement('div');
      val.className = 'value';
      val.textContent = safeText(value);

      row.append(key, val);
      fragment.appendChild(row);
    });

    container.replaceChildren(fragment);
  }

  function applyCardNames() {
    document.querySelectorAll('.careRecipientCard').forEach((card) => {
      const button = card.querySelector('.openCareRecipient');
      const elderId = button?.dataset?.elderId;
      const profile = snapshots.get(elderId) || {};
      const name = displayName(profile);
      if (!elderId || !name) return;

      const title = card.querySelector('strong');
      if (title && title.textContent !== name) title.textContent = name;

      const avatar = card.querySelector('div[aria-hidden="true"]');
      const initial = name.charAt(0).toUpperCase();
      if (avatar && avatar.textContent !== initial) avatar.textContent = initial;
    });
  }

  function applySelectNames() {
    const select = document.getElementById('elderSelect');
    if (!select) return;

    [...select.options].forEach((option) => {
      const name = displayName(snapshots.get(option.value) || {});
      if (name && option.textContent !== name) option.textContent = name;
    });
  }

  function applyDashboard() {
    const portal = document.getElementById('portal');
    if (!portal || portal.classList.contains('hidden')) return;

    const elderId = getSelectedElderId();
    const profile = snapshots.get(elderId);
    if (!elderId || !profile || !Object.keys(profile).length) return;

    const name = displayName(profile);
    const personName = document.getElementById('personName');
    if (personName && name) personName.textContent = `${name} — Care Overview`;

    renderSnapshot(profile);
  }

  function applyAll() {
    applyCardNames();
    applySelectNames();
    applyDashboard();
  }

  async function loadSnapshots() {
    if (loading) return;
    const sb = getClient();
    if (!sb) return;

    loading = true;
    try {
      const result = await sb
        .from('caregiver_access')
        .select('elder_id,recipient_display_name,recipient_profile,status')
        .eq('status', 'active');
      if (result.error) throw result.error;

      snapshots = new Map((result.data || []).map((row) => {
        const profile = row.recipient_profile && typeof row.recipient_profile === 'object'
          ? { ...row.recipient_profile }
          : {};
        if (!profile.name && row.recipient_display_name) profile.name = row.recipient_display_name;
        return [row.elder_id, profile];
      }));

      applyAll();
    } catch (error) {
      console.warn('Could not load caregiver profile snapshots:', error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      loadSnapshots().catch(() => {});
      applyAll();
    }, 160);
  }

  function patchRenderProfile() {
    const original = window.renderProfile;
    if (typeof original !== 'function' || original.__snapshotPatched) return;

    function patched(profile) {
      const snapshot = snapshots.get(getSelectedElderId());
      const effective = snapshot && Object.keys(snapshot).length ? snapshot : profile;
      return original(effective || {});
    }
    patched.__snapshotPatched = true;
    window.renderProfile = patched;
  }

  function boot() {
    patchRenderProfile();

    document.addEventListener('click', (event) => {
      const open = event.target.closest?.('.openCareRecipient, .openElder');
      const elderId = open?.dataset?.elderId || open?.dataset?.elder;
      if (elderId) {
        selectedElderId = elderId;
        sessionStorage.setItem('elderxonnect_selected_elder', elderId);
        setTimeout(applyAll, 250);
        setTimeout(applyAll, 800);
      }

      if (event.target.closest?.('#refresh')) {
        setTimeout(schedule, 350);
        setTimeout(applyAll, 1000);
      }
    }, true);

    document.addEventListener('change', (event) => {
      if (event.target?.id === 'elderSelect') {
        selectedElderId = event.target.value;
        sessionStorage.setItem('elderxonnect_selected_elder', selectedElderId);
        setTimeout(applyAll, 150);
      }
    });

    const observer = new MutationObserver(() => {
      patchRenderProfile();
      schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });

    [100, 500, 1500, 3500].forEach((delay) => setTimeout(schedule, delay));
    setInterval(() => {
      const portal = document.getElementById('portal');
      if (portal && !portal.classList.contains('hidden')) applyAll();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
