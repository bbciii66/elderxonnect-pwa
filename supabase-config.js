/* ElderXonnect public Supabase project configuration */
(() => {
  'use strict';

  const storageKey = 'elderxonnect_supabase_config';
  const projectUrl = 'https://ywazabroczjkpztxhgis.supabase.co';
  const publishableKey = 'sb_publishable_fxLTW8UAx8WCX_4NuOD4ZA_dqM5otNm';

  try {
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');

    localStorage.setItem(storageKey, JSON.stringify({
      ...existing,
      url: existing.url || projectUrl,
      key: existing.key || publishableKey
    }));
  } catch {
    localStorage.setItem(storageKey, JSON.stringify({
      url: projectUrl,
      key: publishableKey
    }));
  }
})();
