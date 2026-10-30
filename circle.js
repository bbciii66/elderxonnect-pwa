/* Care circle screen: shared messages, tasks, visit log, and (for the elder) who-can-do-what. */
(function () {
  'use strict';
  const L = window.CircleLogic;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => new Date(d).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const showError = (e) => { $('error').textContent = e ? (e.message || String(e)) : ''; };

  let client, me, elderId, circle, canWrite = true, timer;

  const cfg = () => { try { return JSON.parse(localStorage.getItem('elderxonnect_supabase_config') || '{}'); } catch { return {}; } };

  async function init() {
    const c = cfg();
    if (!c.url || !c.key) return;
    client = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    me = data.session.user;
    try { if (localStorage.getItem('exc_text_xl') === '1') document.body.classList.add('text-xl'); } catch {}
    $('signin').classList.add('hidden');
    $('app').classList.remove('hidden');

    $('quick').innerHTML = L.QUICK_MESSAGES.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
    document.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => post(b.dataset.q); });

    const r = await client.from('caregiver_access')
      .select('elder_id,role,status,recipient_display_name').eq('caregiver_id', me.id).eq('status', 'active');
    const circles = L.buildCircles(me.id, r.data || []);
    if (circles.length > 1) {
      $('who').innerHTML = circles.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
      $('who').classList.remove('hidden'); $('whoLabel').classList.remove('hidden');
      $('who').onchange = () => choose(circles.find((x) => x.id === $('who').value));
    }
    const first = L.defaultCircle(circles);
    if (circles.length > 1) $('who').value = first.id;
    choose(first);
    timer = setInterval(refresh, 20000);
  }

  function choose(c) {
    circle = c; elderId = c.id; canWrite = L.canWrite(c.role);
    ['composeRow', 'taskRow', 'visitForm'].forEach((i) => $(i).classList.toggle('hidden', !canWrite));
    $('viewerNote').classList.toggle('hidden', canWrite);
    $('quick').parentElement.classList.toggle('hidden', !canWrite);
    $('rolesCard').classList.toggle('hidden', !c.own);
    refresh();
  }

  async function refresh() {
    try {
      showError('');
      const [m, t, v, k] = await Promise.all([
        client.from('circle_messages').select('*').eq('elder_id', elderId).order('created_at', { ascending: false }).limit(50),
        client.from('circle_tasks').select('*').eq('elder_id', elderId).order('created_at', { ascending: false }).limit(50),
        client.from('circle_visits').select('*').eq('elder_id', elderId).order('visited_at', { ascending: false }).limit(30),
        client.from('checkins').select('occurred_at,mood').eq('user_id', elderId).order('occurred_at', { ascending: false }).limit(1),
      ]);
      if (m.error) throw m.error; if (t.error) throw t.error; if (v.error) throw v.error;
      $('messages').innerHTML = (m.data || []).map((x) => `<div class="msg ${x.sender_id === me.id ? 'mine' : ''}"><div class="who">${esc(x.sender_name || 'Someone')} · ${esc(when(x.created_at))}</div><div class="body">${esc(x.body)}</div></div>`).join('') || '<p class="sub">No messages yet.</p>';
      $('tasks').innerHTML = (t.data || []).map((x) => `<div class="task ${x.done ? 'done' : ''}"><span class="t" style="flex:1">${esc(x.title)}${x.done ? `<div class="who">Done by ${esc(x.done_by_name || 'someone')}</div>` : ''}</span>${canWrite && !x.done ? `<button data-t="${esc(x.id)}">Done</button>` : ''}</div>`).join('') || '<p class="sub">No tasks yet.</p>';
      document.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => finish(b.dataset.t); });
      $('visits').innerHTML = (v.data || []).map((x) => `<div class="msg"><div class="who">${esc(x.visitor_name || 'Someone')} · ${esc(when(x.visited_at))}${x.minutes ? ' · ' + esc(x.minutes) + ' min' : ''}</div><div class="body">${esc(x.notes || '(no notes)')}</div></div>`).join('') || '<p class="sub">No visits logged yet.</p>';
      const s = L.checkinStatus(k.error ? null : (k.data || [])[0], new Date());
      $('status').className = 'status ' + s.level; $('status').textContent = s.text;
      if (circle.own) loadRoles();
    } catch (e) { showError(e); }
  }

  async function loadRoles() {
    const r = await client.from('caregiver_access').select('id,caregiver_email,role,status').eq('elder_id', me.id).in('status', ['pending', 'active']).order('invited_at');
    if (r.error) { showError(r.error); return; }
    const rows = r.data || [];
    if (!rows.length) { $('roles').innerHTML = '<p class="sub">No one has been invited yet.</p>'; return; }
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.role;
    if (focused) return; // do not rebuild the list while someone is choosing
    $('roles').innerHTML = rows.map((x) => `<div class="rolerow"><div>${esc(x.caregiver_email)}${x.status === 'pending' ? ' <span class="who">(invited, not joined yet)</span>' : ''}</div><select data-role="${esc(x.id)}" aria-label="Role for ${esc(x.caregiver_email)}">${L.ROLES.map((role) => `<option value="${role}" ${role === x.role ? 'selected' : ''}>${esc(L.ROLE_LABELS[role])}</option>`).join('')}</select></div>`).join('');
    document.querySelectorAll('[data-role]').forEach((s) => {
      s.onchange = async () => { const u = await client.from('caregiver_access').update({ role: s.value }).eq('id', s.dataset.role); if (u.error) showError(u.error); s.blur(); };
    });
  }

  async function invite() {
    const email = L.cleanText($('inviteEmail').value, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError(new Error('Enter a full email address, like name@example.com.')); return; }
    if (email === String(me.email || '').toLowerCase()) { showError(new Error('Use a different email for the other person.')); return; }
    try {
      showError('');
      const r = await client.from('caregiver_access').insert({ elder_id: me.id, caregiver_email: email, status: 'pending', role: $('inviteRole').value });
      if (r.error) throw (r.error.code === '23505' ? new Error('That person is already in your circle. Change their role above.') : r.error);
      $('inviteEmail').value = ''; loadRoles();
    } catch (e) { showError(e); }
  }

  async function post(body) {
    body = L.cleanText(body, 1000); if (!body) return;
    try { showError(''); const r = await client.from('circle_messages').insert({ elder_id: elderId, body }); if (r.error) throw r.error; $('text').value = ''; refresh(); } catch (e) { showError(e); }
  }
  async function finish(id) {
    try { const r = await client.from('circle_tasks').update({ done: true }).eq('id', id); if (r.error) throw r.error; refresh(); } catch (e) { showError(e); }
  }
  async function addTask() {
    const title = L.cleanText($('taskText').value, 200); if (!title) return;
    try { const r = await client.from('circle_tasks').insert({ elder_id: elderId, title }); if (r.error) throw r.error; $('taskText').value = ''; refresh(); } catch (e) { showError(e); }
  }
  async function addVisit() {
    const notes = L.cleanText($('visitNotes').value, 2000);
    const minutes = L.parseMinutes($('visitMinutes').value);
    if (Number.isNaN(minutes)) { showError(new Error('Minutes must be a whole number from 1 to 1440.')); return; }
    if (!notes && minutes === null) { showError(new Error('Add a note or the minutes first.')); return; }
    try {
      const r = await client.from('circle_visits').insert({ elder_id: elderId, notes, minutes });
      if (r.error) throw r.error;
      $('visitNotes').value = ''; $('visitMinutes').value = ''; refresh();
    } catch (e) { showError(e); }
  }

  $('send').onclick = () => post($('text').value);
  $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') post($('text').value); });
  $('inviteRole').innerHTML = L.ROLES.map((role) => `<option value="${role}">${esc(L.ROLE_LABELS[role])}</option>`).join('');
  $('inviteRole').value = 'viewer';
  $('sendInvite').onclick = invite;
  $('addTask').onclick = addTask;
  $('addVisit').onclick = addVisit;
  $('bigText').onclick = () => { const on = document.body.classList.toggle('text-xl'); try { localStorage.setItem('exc_text_xl', on ? '1' : '0'); } catch {} };
  init().catch(showError);
})();
