/* Explicitly publish the care recipient's display name to the signed-in Supabase profile. */
(() => {
  'use strict';

  const PROFILE_KEY = 'me_profile';
  const CFG_KEY = 'elderxonnect_supabase_config';

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function localName() {
    const profile = parse(PROFILE_KEY, {});
    const profileName = String(profile?.name || '').trim();
    if (profileName) return profileName;

    const localSession = parse('auth_session', null);
    const sessionName = String(localSession?.name || '').trim();
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

  async function publish(button, status) {
    const name = localName();
    if (!name) throw new Error('Save a full name in My Profile first.');

    const cfg = parse(CFG_KEY, {});
    if (!cfg.url || !cfg.key) throw new Error('Cloud Sync is not configured on this device.');

    const lib = await loadSupabase();
    const client = lib.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const session = sessionResult.data?.session;
    if (!session?.user?.id) throw new Error('Sign in under Cloud Sync first.');

    status.textContent = `Publishing “${name}” for ${session.user.email}…`;

    const currentResult = await client
      .from('profiles')
      .select('profile_data')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (currentResult.error) throw currentResult.error;

    const current = currentResult.data?.profile_data || {};
    const result = await client
      .from('profiles')
      .upsert(
        { user_id: session.user.id, profile_data: { ...current, name } },
        { onConflict: 'user_id' }
      )
      .select('profile_data')
      .single();
    if (result.error) throw result.error;

    const verified = String(result.data?.profile_data?.name || '').trim();
    if (verified !== name) throw new Error('The cloud profile did not verify the saved name.');

    status.textContent = `✅ Caregiver display name published as ${name} for ${session.user.email}.`;
    button.textContent = 'Name Published';
  }

  function addControl() {
    if (document.getElementById('publishCaregiverNameCard')) return;
    const me = document.getElementById('view-me');
    if (!me) return;

    const card = document.createElement('div');
    card.id = 'publishCaregiverNameCard';
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">👥 Caregiver Display Name</div>
      <div class="card-sub">Publish your saved profile name so caregivers see your name instead of “Unnamed care recipient.”</div>
      <button class="btn green" id="publishCaregiverName">Publish My Name to Caregivers</button>
      <p class="small" id="publishCaregiverNameStatus" style="margin-top:10px"></p>`;

    const cloudCard = document.getElementById('cloudSyncCard');
    if (cloudCard) cloudCard.insertAdjacentElement('afterend', card);
    else me.appendChild(card);

    const button = document.getElementById('publishCaregiverName');
    const status = document.getElementById('publishCaregiverNameStatus');
    button.onclick = async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Publishing…';
      status.textContent = '';
      try {
        await publish(button, status);
      } catch (error) {
        button.textContent = original;
        status.textContent = `⚠️ ${error?.message || String(error)}`;
      } finally {
        button.disabled = false;
      }
    };
  }

  function boot() {
    addControl();
    setTimeout(addControl, 800);
    setTimeout(addControl, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
