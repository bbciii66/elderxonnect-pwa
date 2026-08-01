/* ElderXonnect public Supabase project configuration */
(() => {
  'use strict';
  const key = 'elderxonnect_supabase_config';
  const projectUrl = 'https://ywazabroczjkpztxhgis.supabase.co';
  try {
    const existing = JSON.parse(localStorage.getItem(key) || '{}');
    if (!existing.url) {
      localStorage.setItem(key, JSON.stringify({ ...existing, url: projectUrl }));
    }
  } catch (error) {
    localStorage.setItem(key, JSON.stringify({ url: projectUrl }));
  }
})();
