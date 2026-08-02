/* Keep the My Care profile summary synchronized with the saved local profile. */
(() => {
  'use strict';

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function formatDob(value) {
    if (!value) return '';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function setText(id, value, fallback = '—') {
    const element = document.getElementById(id);
    if (element) element.textContent = value || fallback;
  }

  function applySavedProfile() {
    const view = document.getElementById('view-me');
    if (!view || view.classList.contains('hidden')) return;

    const profile = readJson('me_profile', {});
    const authSession = readJson('auth_session', null);
    const name = String(profile?.name || authSession?.name || '').trim();
    const dob = formatDob(profile?.dob);

    try { window.loadMeProfile?.(); }
    catch (error) { console.warn('Profile display refresh failed:', error); }

    setText('meNameDisplay', name, 'Tap ✏️ Edit to set up your profile');
    setText('meDobDisplay', dob ? `Born: ${dob}` : '', '');
    setText('diDob', dob);
    setText('diBlood', profile?.blood);
    setText('diHome', profile?.homeAddr);
    setText('diMail', profile?.mailAddr || profile?.homeAddr);
    setText('diAllergies', profile?.allergies);
    setText('diConditions', profile?.conditions);
    setText('diDoctor', profile?.doctor);
    setText('diDoctorPhone', profile?.doctorPhone);

    const avatar = document.getElementById('meAvatarEmoji');
    if (avatar && name) avatar.textContent = name.charAt(0).toUpperCase();
  }

  function scheduleRefresh() {
    requestAnimationFrame(() => {
      applySavedProfile();
      setTimeout(applySavedProfile, 120);
      setTimeout(applySavedProfile, 600);
    });
  }

  function boot() {
    const view = document.getElementById('view-me');
    if (view) {
      new MutationObserver(scheduleRefresh).observe(view, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    document.addEventListener('click', (event) => {
      const target = event.target.closest?.('#meFabBtn, #saveMeBtn, [data-tab="me"], [data-view="me"]');
      if (target) scheduleRefresh();
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRefresh();
    });
    window.addEventListener('pageshow', scheduleRefresh);

    setInterval(() => {
      const currentView = document.getElementById('view-me');
      if (currentView && !currentView.classList.contains('hidden')) applySavedProfile();
    }, 1500);

    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
