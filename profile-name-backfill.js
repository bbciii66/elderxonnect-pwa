/* Backfill a missing care-recipient profile name and write it directly to Supabase. */
(() => {
  'use strict';

  const PROFILE_KEY = 'me_profile';
  const CFG_KEY = 'elderxonnect_supabase_config';

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function localAccountName() {
    const session = parse('auth_session', null);
    const fromSession = String(session?.name || '').trim();
    if (fromSession) return fromSession;

    const users = parse('auth_users', []);
    return String(users?.[0]?.name || '').trim();
  }

  function ensureLocalProfileName() {
    const profile = parse(PROFILE_KEY, {});
    if (String(profile?.name || '').trim()) return profile;

    const name = localAccountName();
    if (!name) return profile;

    const updated = { ...profile, name };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    window.loadMeProfile?.();
    return updated;
  }

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return window.supabase;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-profile-name-supabase]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.dataset.profileNameSupabase = '1';
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Supabase library'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function writeNameToCloud() {
    const cfg = parse(CFG_KEY, {});
    if (!cfg.url || !cfg.key) return false;

    const profile = ensureLocalProfileName();
    const localName = String(profile?.name || localAccountName() || '').trim();
    if (!localName) return false;

    const lib = await loadSupabaseLibrary();
    const client = lib.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    const sessionResult = await client.auth.getSession();
    const session = sessionResult.data?.session;
    if (!session?.user?.id) return false;

    const serverResult = await client
      .from('profiles')
      .select('profile_data')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (serverResult.error) throw serverResult.error;

    const serverProfile = serverResult.data?.profile_data || {};
    const serverName = String(serverProfile?.name || '').trim();
    if (serverName) {
      if (!String(profile?.name || '').trim()) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, name: serverName }));
        window.loadMeProfile?.();
      }
      return true;
    }

    const metadataName = String(
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      ''
    ).trim();
    const finalName = localName || metadataName;
    if (!finalName) return false;

    const merged = { ...serverProfile, ...profile, name: finalName };
    const upsertResult = await client
      .from('profiles')
      .upsert(
        { user_id: session.user.id, profile_data: merged },
        { onConflict: 'user_id' }
      );
    if (upsertResult.error) throw upsertResult.error;

    localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    window.loadMeProfile?.();
    return true;
  }

  function boot() {
    ensureLocalProfileName();
    [500, 2000, 5000, 10000].forEach((delay) => {
      setTimeout(() => writeNameToCloud().catch((error) => {
        console.warn('Profile name backfill retry failed:', error);
      }), delay);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
