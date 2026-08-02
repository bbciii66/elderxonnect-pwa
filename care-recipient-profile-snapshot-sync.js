/* Keep a complete recipient profile snapshot on active caregiver-access records. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const PROFILE_KEY = 'me_profile';
  let syncing = false;
  let lastSent = '';

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function profileSnapshot() {
    const profile = parse(PROFILE_KEY, {});
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return {};

    const authSession = parse('auth_session', null);
    const users = parse('auth_users', []);
    const fallbackName = String(authSession?.name || users?.[0]?.name || '').trim();
    const name = String(profile.name || fallbackName).trim();

    return name && !profile.name ? { ...profile, name } : profile;
  }

  function configured() {
    const cfg = parse(CFG_KEY, {});
    return Boolean(cfg.url && cfg.key);
  }

  async function loadSupabase() {
    if (window.supabase?.createClient) return window.supabase;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Supabase.'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function syncProfile({ force = false } = {}) {
    if (syncing || !configured()) return;

    const profile = profileSnapshot();
    const payload = JSON.stringify(profile);
    if (payload === '{}' || (!force && payload === lastSent)) return;

    syncing = true;
    try {
      const cfg = parse(CFG_KEY, {});
      const lib = await loadSupabase();
      const sb = lib.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });

      const sessionResult = await sb.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data?.session?.user?.id) return;

      const result = await sb.rpc('set_care_recipient_profile', {
        p_profile: profile
      });
      if (result.error) throw result.error;

      lastSent = payload;
      window.dispatchEvent(new CustomEvent('elderxonnect-profile-snapshot-synced', {
        detail: { profile, updatedRows: result.data || 0 }
      }));
    } catch (error) {
      console.warn('Could not sync caregiver profile snapshot:', error);
    } finally {
      syncing = false;
    }
  }

  function schedule(force = false) {
    [120, 700, 2200].forEach((delay) => {
      setTimeout(() => syncProfile({ force }), delay);
    });
  }

  function boot() {
    schedule(true);

    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#saveMeBtn, #cloudUploadDevice, #cloudSyncNow, #publishCaregiverName')) {
        setTimeout(() => schedule(true), 250);
      }
    }, true);

    window.addEventListener('focus', () => schedule(false));
    window.addEventListener('pageshow', () => schedule(false));
    setInterval(() => syncProfile({ force: false }), 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
