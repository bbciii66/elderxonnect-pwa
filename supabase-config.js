/* ElderXonnect public Supabase project configuration (elderxonnect-v2) */
(() => {
  'use strict';

  const storageKey = 'elderxonnect_supabase_config';
  const projectUrl = 'https://gqudbzrcvrnzvtkdhhxp.supabase.co';
  const publishableKey = 'sb_publishable_4ovibBLkip350vz_OZjQ0w_URkM3OKk';

  /* Always use the current project; older saved values pointed at the previous project. */
  try {
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');

    localStorage.setItem(storageKey, JSON.stringify({
      ...existing,
      url: projectUrl,
      key: publishableKey
    }));
  } catch {
    localStorage.setItem(storageKey, JSON.stringify({
      url: projectUrl,
      key: publishableKey
    }));
  }
})();
