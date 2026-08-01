/* ElderXonnect caregiver invitation management */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  let client = null;
  let session = null;

  const parse = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  async function loadLibrary() {
    if (window.supabase?.createClient) return window.supabase;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Supabase library'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function init() {
    const cfg = parse(CFG_KEY, {});
    if (!cfg.url || !cfg.key) throw new Error('Cloud Sync must be configured first.');
    if (!client) {
      const lib = await loadLibrary();
      client = lib.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    const result = await client.auth.getSession();
    session = result.data.session;
    return client;
  }

  function status(message, error = false) {
    const el = document.getElementById('caregiverAccessStatus');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = error ? '#e05252' : '';
  }

  async function refreshInvites() {
    await init();
    const list = document.getElementById('caregiverInviteList');
    if (!list) return;
    if (!session) {
      list.innerHTML = '<div class="small">Sign into Cloud Sync above to manage caregiver access.</div>';
      return;
    }

    const { data, error } = await client
      .from('caregiver_access')
      .select('id,caregiver_email,status,invited_at,accepted_at')
      .eq('elder_id', session.user.id)
      .order('invited_at', { ascending: false });
    if (error) throw error;

    if (!data?.length) {
      list.innerHTML = '<div class="small">No caregiver invitations yet.</div>';
      return;
    }

    list.innerHTML = data.map((item) => `
      <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">
        <div style="font-weight:700">${esc(item.caregiver_email)}</div>
        <div class="small" style="margin-top:3px">Status: ${esc(item.status)} · Invited ${new Date(item.invited_at).toLocaleString()}</div>
        <button class="btn ghost revokeCaregiver" data-id="${esc(item.id)}" style="margin-top:8px">Revoke Access</button>
      </div>`).join('');

    list.querySelectorAll('.revokeCaregiver').forEach((button) => {
      button.addEventListener('click', async () => {
        const ok = window.confirm('Revoke this caregiver’s access?');
        if (!ok) return;
        const { error } = await client.from('caregiver_access').delete().eq('id', button.dataset.id);
        if (error) return status(error.message, true);
        status('✅ Caregiver access revoked');
        await refreshInvites();
      });
    });
  }

  async function sendInvite() {
    try {
      await init();
      if (!session) throw new Error('Sign into Cloud Sync first.');
      const input = document.getElementById('caregiverInviteEmail');
      const email = input.value.trim().toLowerCase();
      if (!email || !email.includes('@')) throw new Error('Enter a valid caregiver email address.');
      if (email === String(session.user.email || '').toLowerCase()) throw new Error('Use a different email for the caregiver account.');

      const { error } = await client.from('caregiver_access').upsert({
        elder_id: session.user.id,
        caregiver_email: email,
        caregiver_id: null,
        status: 'pending',
        accepted_at: null
      }, { onConflict: 'elder_id,caregiver_email' });
      if (error) throw error;

      input.value = '';
      const portal = `${location.origin}/caregiver.html`;
      status(`✅ Invitation created. Send the caregiver this link: ${portal}`);
      await refreshInvites();
    } catch (error) {
      status(`⚠️ ${error.message || error}`, true);
    }
  }

  function addPanel() {
    const me = document.getElementById('view-me');
    if (!me || document.getElementById('caregiverAccessCard')) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'caregiverAccessCard';
    card.innerHTML = `
      <div class="card-title">👥 Caregiver Access</div>
      <div class="card-sub">Invite a caregiver to create their own account and view your shared information without using your password.</div>
      <div class="label">Caregiver email</div>
      <input id="caregiverInviteEmail" type="email" autocomplete="email" placeholder="caregiver@example.com">
      <div class="sp8"></div><button class="btn green" id="sendCaregiverInvite">Create Invitation</button>
      <p class="small" id="caregiverAccessStatus" style="margin-top:10px"></p>
      <div class="divider"></div>
      <div class="label">Invitations and access</div>
      <div id="caregiverInviteList"><div class="small">Loading…</div></div>`;
    me.appendChild(card);
    document.getElementById('sendCaregiverInvite').addEventListener('click', sendInvite);
    refreshInvites().catch((error) => status(`⚠️ ${error.message || error}`, true));
  }

  function boot() {
    addPanel();
    window.addEventListener('focus', () => refreshInvites().catch(() => {}));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
