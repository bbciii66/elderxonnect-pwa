/* Keep the signed-in recipient's display name on caregiver access records. */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  let syncing = false;

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function getName() {
    const profile = parse('me_profile', {});
    const profileName = String(profile?.name || '').trim();
    if (profileName) return profileName;

    const session = parse('auth_session', null);
    const sessionName = String(session?.name || '').trim();
    if (sessionName) return sessionName;

    const users = parse('auth_users', []);
    return String(users?.[0]?.name || '').trim();
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

  async function syncName() {
    if (syncing) return;
    const name = getName();
    const cfg = parse(CFG_KEY, {});
    if (!name || !cfg.url || !cfg.key) return;

    syncing = true;
    try {
      const lib = await loadSupabase();
      const client = lib.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data?.session?.user?.id) return;

      const result = await client.rpc('set_care_recipient_display_name', {
        p_display_name: name
      });
      if (result.error) throw result.error;
    } catch (error) {
      console.warn('Could not sync caregiver display name:', error);
    } finally {
      syncing = false;
    }
  }

  function schedule() {
    [100, 600, 1800].forEach((delay) => setTimeout(() => syncName(), delay));
  }

  function boot() {
    schedule();
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#saveMeBtn, #publishCaregiverName, #cloudUploadDevice, #cloudSyncNow')) {
        setTimeout(schedule, 250);
      }
    }, true);
    window.addEventListener('focus', schedule);
    window.addEventListener('pageshow', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
