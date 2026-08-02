/* Apply display names stored directly on caregiver access records. */
(() => {
  'use strict';

  let names = new Map();
  let loading = false;
  let timer = null;

  function getClient() {
    try { return typeof client !== 'undefined' ? client : null; }
    catch { return null; }
  }

  function applyNames() {
    document.querySelectorAll('.careRecipientCard').forEach((card) => {
      const openButton = card.querySelector('.openCareRecipient');
      const elderId = openButton?.dataset?.elderId;
      const name = String(names.get(elderId) || '').trim();
      if (!elderId || !name) return;

      const title = card.querySelector('strong');
      if (title) title.textContent = name;

      const avatar = card.querySelector('div[aria-hidden="true"]');
      if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    });

    const select = document.getElementById('elderSelect');
    if (select) {
      [...select.options].forEach((option) => {
        const name = String(names.get(option.value) || '').trim();
        if (name) option.textContent = name;
      });
    }

    const selectedId = select?.value || sessionStorage.getItem('elderxonnect_selected_elder') || '';
    const selectedName = String(names.get(selectedId) || '').trim();
    const personName = document.getElementById('personName');
    if (personName && selectedName) personName.textContent = `${selectedName} — Care Overview`;
  }

  async function loadNames() {
    if (loading) return;
    const sb = getClient();
    if (!sb) return;

    loading = true;
    try {
      const result = await sb
        .from('caregiver_access')
        .select('elder_id,recipient_display_name,status')
        .eq('status', 'active');
      if (result.error) throw result.error;

      names = new Map((result.data || []).map((row) => [
        row.elder_id,
        row.recipient_display_name || ''
      ]));
      applyNames();
    } catch (error) {
      console.warn('Could not load recipient display names:', error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      loadNames();
      applyNames();
    }, 150);
  }

  function boot() {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });

    document.addEventListener('change', (event) => {
      if (event.target?.id === 'elderSelect') setTimeout(applyNames, 100);
    });

    [100, 500, 1500, 3500].forEach((delay) => setTimeout(schedule, delay));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
