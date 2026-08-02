/* Load caregiver-visible profile data through the secure Supabase RPC. */
(() => {
  'use strict';

  let profiles = new Map();
  let loading = false;
  let scheduled = null;
  let selectedElderId = sessionStorage.getItem('elderxonnect_selected_elder') || '';

  function getClient() {
    try { return typeof client !== 'undefined' ? client : null; }
    catch { return null; }
  }

  function cleanName(profile) {
    return String(profile?.name || '').trim();
  }

  function applyCareListNames() {
    document.querySelectorAll('.careRecipientCard').forEach((card) => {
      const openButton = card.querySelector('.openCareRecipient');
      const elderId = openButton?.dataset?.elderId;
      if (!elderId) return;

      const profile = profiles.get(elderId) || {};
      const name = cleanName(profile);
      if (!name) return;

      const title = card.querySelector('strong');
      if (title) title.textContent = name;

      const avatar = card.querySelector('div[aria-hidden="true"]');
      if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    });
  }

  function applyDashboardProfile() {
    const portal = document.getElementById('portal');
    if (!portal || portal.classList.contains('hidden')) return;

    const select = document.getElementById('elderSelect');
    const elderId = select?.value || selectedElderId;
    if (!elderId) return;

    const profile = profiles.get(elderId) || {};
    const name = cleanName(profile);

    const personName = document.getElementById('personName');
    if (personName && name) personName.textContent = `${name} — Care Overview`;

    try {
      if (typeof renderProfile === 'function') renderProfile(profile);
    } catch (error) {
      console.warn('Could not render caregiver profile from shared RPC:', error);
    }
  }

  function applyProfiles() {
    applyCareListNames();
    applyDashboardProfile();
  }

  async function loadProfiles() {
    if (loading) return;
    const sb = getClient();
    if (!sb) return;

    loading = true;
    try {
      const result = await sb.rpc('get_caregiver_shared_profiles');
      if (result.error) throw result.error;

      profiles = new Map((result.data || []).map((row) => [
        row.elder_id,
        row.profile_data || {}
      ]));
      applyProfiles();
    } catch (error) {
      console.warn('Could not load caregiver shared profiles:', error);
    } finally {
      loading = false;
    }
  }

  function scheduleLoad() {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      loadProfiles().catch(() => {});
      applyProfiles();
    }, 180);
  }

  function boot() {
    document.addEventListener('click', (event) => {
      const open = event.target.closest?.('.openCareRecipient');
      if (open?.dataset?.elderId) {
        selectedElderId = open.dataset.elderId;
        sessionStorage.setItem('elderxonnect_selected_elder', selectedElderId);
        setTimeout(applyDashboardProfile, 250);
        setTimeout(applyDashboardProfile, 800);
      }
    }, true);

    const select = document.getElementById('elderSelect');
    if (select) {
      select.addEventListener('change', () => {
        selectedElderId = select.value;
        sessionStorage.setItem('elderxonnect_selected_elder', selectedElderId);
        setTimeout(applyDashboardProfile, 150);
      });
    }

    const observer = new MutationObserver(scheduleLoad);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });

    [200, 800, 2000, 5000].forEach((delay) => setTimeout(scheduleLoad, delay));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
