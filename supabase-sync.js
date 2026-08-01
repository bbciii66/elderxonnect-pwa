/* ElderXonnect Supabase cloud sync */
(() => {
  'use strict';

  const CFG_KEY = 'elderxonnect_supabase_config';
  const ID_KEY = 'elderxonnect_device_id';
  const SYNC_KEYS = ['checkins_v2', 'reminders', 'contacts', 'me_profile'];
  let client = null;
  let session = null;
  let syncing = false;
  let saveTimer = null;

  const parse = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const store = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const uid = () => session?.user?.id || null;
  const deviceId = (() => {
    let value = localStorage.getItem(ID_KEY);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(ID_KEY, value);
    }
    return value;
  })();
  const clientId = (kind, item, index) => String(item.clientId || item.client_id || `${deviceId}:${kind}:${item.created || item.ts || index}`);

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

  function config() { return parse(CFG_KEY, {}); }
  function configured() {
    const c = config();
    return Boolean(c.url && c.key && !c.url.includes('YOUR_'));
  }

  async function initClient() {
    if (!configured()) return null;
    if (client) return client;
    const lib = await loadLibrary();
    const c = config();
    client = lib.createClient(c.url, c.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await client.auth.getSession();
    session = data.session;
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateStatus();
      if (session) pullAll().catch(reportError);
    });
    updateStatus();
    return client;
  }

  function reportError(error) {
    console.error('Supabase sync error:', error);
    const el = document.getElementById('cloudStatus');
    if (el) el.textContent = `⚠️ ${error.message || error}`;
  }

  function ensureIds() {
    ['checkins_v2', 'reminders', 'contacts'].forEach((key) => {
      const list = parse(key, []);
      let changed = false;
      list.forEach((item, index) => {
        if (!item.clientId) {
          item.clientId = clientId(key, item, index);
          changed = true;
        }
      });
      if (changed) store(key, list);
    });
  }

  async function pushAll() {
    if (!client || !uid() || syncing) return;
    syncing = true;
    updateStatus('Syncing…');
    try {
      ensureIds();
      const userId = uid();
      const profile = parse('me_profile', {});
      await throwIfError(client.from('profiles').upsert({ user_id: userId, profile_data: profile }, { onConflict: 'user_id' }));

      const checkins = parse('checkins_v2', []).map((x, i) => ({
        user_id: userId, client_id: clientId('checkin', x, i), occurred_at: new Date(x.ts || Date.now()).toISOString(),
        mood: x.mood || 'OK', pain: Number(x.pain || 0), notes: x.notes || ''
      }));
      if (checkins.length) await throwIfError(client.from('checkins').upsert(checkins, { onConflict: 'user_id,client_id' }));

      const reminders = parse('reminders', []).map((x, i) => ({
        user_id: userId, client_id: clientId('reminder', x, i), title: x.title || '',
        reminder_time: x.time || null, category: x.cat || '⭐', urgent: Boolean(x.urgent),
        created_at: new Date(x.created || Date.now()).toISOString()
      }));
      if (reminders.length) await throwIfError(client.from('reminders').upsert(reminders, { onConflict: 'user_id,client_id' }));

      const contacts = parse('contacts', []).map((x, i) => ({
        user_id: userId, client_id: clientId('contact', x, i), name: x.name || '', phone: x.phone || '',
        relationship: x.rel || 'Other', created_at: new Date(x.created || Date.now()).toISOString()
      }));
      if (contacts.length) await throwIfError(client.from('contacts').upsert(contacts, { onConflict: 'user_id,client_id' }));
      updateStatus('✅ Cloud sync complete');
    } finally {
      syncing = false;
    }
  }

  async function throwIfError(promise) {
    const result = await promise;
    if (result.error) throw result.error;
    return result.data;
  }

  async function pullAll() {
    if (!client || !uid() || syncing) return;
    syncing = true;
    updateStatus('Downloading cloud data…');
    try {
      const userId = uid();
      const [profile, checkins, reminders, contacts] = await Promise.all([
        throwIfError(client.from('profiles').select('profile_data').eq('user_id', userId).maybeSingle()),
        throwIfError(client.from('checkins').select('*').eq('user_id', userId).order('occurred_at', { ascending: false })),
        throwIfError(client.from('reminders').select('*').eq('user_id', userId).order('created_at', { ascending: true })),
        throwIfError(client.from('contacts').select('*').eq('user_id', userId).order('created_at', { ascending: true }))
      ]);

      if (profile?.profile_data) store('me_profile', profile.profile_data);
      if (checkins?.length) store('checkins_v2', checkins.map(x => ({ clientId:x.client_id, ts:new Date(x.occurred_at).getTime(), mood:x.mood, pain:x.pain, notes:x.notes })));
      if (reminders?.length) store('reminders', reminders.map(x => ({ clientId:x.client_id, title:x.title, time:x.reminder_time?.slice(0,5) || '', cat:x.category, urgent:x.urgent, created:new Date(x.created_at).getTime() })));
      if (contacts?.length) store('contacts', contacts.map(x => ({ clientId:x.client_id, name:x.name, phone:x.phone, rel:x.relationship, created:new Date(x.created_at).getTime() })));

      window.renderCheckins?.(); window.renderReminders?.(); window.renderContacts?.();
      window.refreshHomeStats?.(); window.loadMeProfile?.(); window.refreshChart?.();
      updateStatus('✅ Cloud data loaded');
    } finally { syncing = false; }
  }

  function schedulePush() {
    if (!uid()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => pushAll().catch(reportError), 700);
  }

  function watchLocalChanges() {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      original.call(this, key, value);
      if (this === localStorage && SYNC_KEYS.includes(key)) schedulePush();
    };
  }

  function updateStatus(message) {
    const el = document.getElementById('cloudStatus');
    if (!el) return;
    if (message) { el.textContent = message; return; }
    if (!configured()) el.textContent = 'Not configured';
    else if (!session) el.textContent = 'Configured — sign in to sync';
    else el.textContent = `✅ Signed in as ${session.user.email}`;
  }

  function addPanel() {
    const me = document.getElementById('view-me');
    if (!me || document.getElementById('cloudSyncCard')) return;
    const c = config();
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'cloudSyncCard';
    card.innerHTML = `
      <div class="card-title">☁️ Cloud Sync</div>
      <div class="card-sub">Securely sync this profile, check-ins, reminders and contacts across devices.</div>
      <div class="label">Supabase Project URL</div>
      <input id="sbUrl" placeholder="https://your-project.supabase.co" value="${escapeAttr(c.url || '')}">
      <div class="sp8"></div><div class="label">Publishable / Anon Key</div>
      <input id="sbKey" type="password" placeholder="sb_publishable_… or anon key" value="${escapeAttr(c.key || '')}">
      <div class="sp8"></div><button class="btn ghost" id="saveSbConfig">Save Supabase Settings</button>
      <div class="divider"></div><div class="label">Email</div><input id="cloudEmail" type="email" autocomplete="email">
      <div class="sp8"></div><div class="label">Password</div><input id="cloudPassword" type="password" autocomplete="current-password" minlength="8">
      <div class="sp8"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn green" id="cloudSignIn">Sign In</button><button class="btn ghost" id="cloudSignUp">Create Account</button>
      </div>
      <div class="sp8"></div><button class="btn gold" id="cloudSyncNow">Sync Now</button>
      <div class="sp8"></div><button class="btn ghost" id="cloudSignOut">Sign Out</button>
      <p class="small" id="cloudStatus" style="margin-top:10px"></p>`;
    me.appendChild(card);

    document.getElementById('saveSbConfig').onclick = async () => {
      const url = document.getElementById('sbUrl').value.trim().replace(/\/$/, '');
      const key = document.getElementById('sbKey').value.trim();
      if (!url || !key) return reportError(new Error('Enter both the project URL and publishable key'));
      store(CFG_KEY, { url, key }); client = null; session = null;
      await initClient(); updateStatus('✅ Supabase settings saved');
    };
    document.getElementById('cloudSignIn').onclick = () => authAction('signin');
    document.getElementById('cloudSignUp').onclick = () => authAction('signup');
    document.getElementById('cloudSignOut').onclick = async () => { if (client) await client.auth.signOut(); session = null; updateStatus(); };
    document.getElementById('cloudSyncNow').onclick = async () => { await initClient(); if (!session) throw new Error('Sign in first'); await pushAll(); await pullAll(); };
    updateStatus();
  }

  async function authAction(type) {
    try {
      await initClient();
      if (!client) throw new Error('Save Supabase settings first');
      const email = document.getElementById('cloudEmail').value.trim();
      const password = document.getElementById('cloudPassword').value;
      if (!email || password.length < 8) throw new Error('Enter an email and password of at least 8 characters');
      const result = type === 'signup'
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      session = result.data.session;
      updateStatus(type === 'signup' && !session ? 'Check your email to confirm the account' : '✅ Signed in');
      if (session) { await pushAll(); await pullAll(); }
    } catch (error) { reportError(error); }
  }

  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function boot() {
    addPanel(); watchLocalChanges();
    try { await initClient(); if (session) await pullAll(); }
    catch (error) { reportError(error); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
