/* Backfill a missing care-recipient profile name from the local ElderXonnect account. */
(() => {
  'use strict';

  const PROFILE_KEY = 'me_profile';

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function accountName() {
    const session = parse('auth_session', null);
    const fromSession = String(session?.name || '').trim();
    if (fromSession) return fromSession;

    const users = parse('auth_users', []);
    return String(users?.[0]?.name || '').trim();
  }

  function writeProfileName() {
    const name = accountName();
    if (!name) return false;

    const profile = parse(PROFILE_KEY, {});
    if (String(profile?.name || '').trim()) return false;

    const updated = { ...profile, name };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    window.loadMeProfile?.();
    return true;
  }

  function retriggerCloudSync() {
    const profile = parse(PROFILE_KEY, {});
    if (!String(profile?.name || '').trim()) return;
    // Re-setting the sync key lets supabase-sync upload after its session has initialized.
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function boot() {
    const changed = writeProfileName();
    if (!changed) return;

    [1500, 4000, 8000].forEach((delay) => {
      setTimeout(retriggerCloudSync, delay);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
