/* Care circle screen: shared messages, tasks, visit log, and (for the elder) who-can-do-what. */
(function () {
  'use strict';
  const L = window.CircleLogic;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => new Date(d).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const showError = (e) => { $('error').textContent = e ? (e.message || String(e)) : ''; };

  let client, me, elderId, circle, canWrite = true, timer;
  let settings = null, settingsOk = true, accessRows = [];

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
      .select('elder_id,role,status,recipient_display_name,sections').eq('caregiver_id', me.id).eq('status', 'active');
    const rows = r.data || [];
    // Older invitations may not carry the person's name; read it from their shared profile instead.
    const unnamed = rows.filter((x) => !(x.recipient_display_name || '').trim()).map((x) => x.elder_id);
    if (unnamed.length) {
      const p = await client.from('profiles').select('user_id,profile_data').in('user_id', unnamed);
      (p.data || []).forEach((pr) => {
        const nm = pr.profile_data && typeof pr.profile_data.name === 'string' ? pr.profile_data.name.trim() : '';
        if (nm) rows.filter((x) => x.elder_id === pr.user_id).forEach((x) => { x.recipient_display_name = nm; });
      });
    }
    const circles = L.buildCircles(me.id, rows);
    if (circles.length > 1) {
      $('who').innerHTML = circles.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
      $('who').classList.remove('hidden'); $('whoLabel').classList.remove('hidden');
      $('who').onchange = () => choose(circles.find((x) => x.id === $('who').value));
    }
    const first = L.defaultCircle(circles);
    if (circles.length > 1) $('who').value = first.id;
    choose(first);
    // Only people who help someone else get the alert switch.
    if (circles.length > 1 && window.initPushCard) window.initPushCard(client, me.id);
    timer = setInterval(refresh, 20000);
  }

  function choose(c) {
    circle = c; elderId = c.id; canWrite = L.canWrite(c.role);
    ['composeRow', 'taskRow', 'visitForm'].forEach((i) => $(i).classList.toggle('hidden', !canWrite));
    $('viewerNote').classList.toggle('hidden', canWrite);
    $('quick').parentElement.classList.toggle('hidden', !canWrite);
    settings = null; accessRows = [];
    ['setupCard', 'rolesCard'].forEach((i) => $(i).classList.add('hidden'));
    refresh();
  }

  async function refresh() {
    try {
      showError('');
      const [m, t, v, k] = await Promise.all([
        client.from('circle_messages').select('*').eq('elder_id', elderId).order('created_at', { ascending: false }).limit(50),
        client.from('circle_tasks').select('*').eq('elder_id', elderId).order('created_at', { ascending: false }).limit(50),
        client.from('circle_visits').select('*').eq('elder_id', elderId).order('visited_at', { ascending: false }).limit(30),
        L.canSee(circle, 'checkins')
          ? client.from('checkins').select('occurred_at,mood').eq('user_id', elderId).order('occurred_at', { ascending: false }).limit(1)
          : Promise.resolve({ data: 'not-shared' }),
      ]);
      if (m.error) throw m.error; if (t.error) throw t.error;
      $('messages').innerHTML = (m.data || []).map((x) => `<div class="msg ${x.sender_id === me.id ? 'mine' : ''}"><div class="who">${esc(x.sender_name || 'Someone')} · ${esc(when(x.created_at))}</div><div class="body">${esc(x.body)}</div></div>`).join('') || '<p class="sub">No messages yet.</p>';
      $('tasks').innerHTML = (t.data || []).map((x) => `<div class="task ${x.done ? 'done' : ''}"><span class="t" style="flex:1">${esc(x.title)}${x.done ? `<div class="who">Done by ${esc(x.done_by_name || 'someone')}</div>` : ''}</span>${canWrite && !x.done ? `<button data-t="${esc(x.id)}">Done</button>` : ''}</div>`).join('') || '<p class="sub">No tasks yet.</p>';
      document.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => finish(b.dataset.t); });
      // The visit log is newer than the rest; if it is unavailable, keep every other panel working.
      $('visits').innerHTML = v.error ? '<p class="sub">The visit log is not available yet.</p>' : (v.data || []).map((x) => `<div class="msg"><div class="who">${esc(x.visitor_name || 'Someone')} · ${esc(when(x.visited_at))}${x.minutes ? ' · ' + esc(x.minutes) + ' min' : ''}</div><div class="body">${esc(x.notes || '(no notes)')}</div></div>`).join('') || '<p class="sub">No visits logged yet.</p>';
      const s = L.checkinStatus(k.data === 'not-shared' ? 'not-shared' : k.error ? null : (k.data || [])[0], new Date());
      $('status').className = 'status ' + s.level; $('status').textContent = s.text;
      if (circle.own || circle.role === 'admin') loadManage();
    } catch (e) { showError(e); }
  }

  async function loadManage() {
    const [s, r] = await Promise.all([
      client.from('circle_settings').select('*').eq('elder_id', elderId).maybeSingle(),
      client.from('caregiver_access').select('id,caregiver_email,role,status,sections').eq('elder_id', elderId).in('status', ['pending', 'active']).order('invited_at'),
    ]);
    if (r.error) { showError(r.error); return; }
    settingsOk = !s.error; settings = s.error ? null : s.data; accessRows = r.data || [];
    if (circle.own && !settingsOk) { settings = { mode: 'self' }; } // migration not applied yet: behave as before
    renderSetup();
    renderRoles();
  }

  function renderSetup() {
    const state = L.setupState(settings, accessRows);
    const own = circle.own, manage = L.canManage(circle, settings, accessRows);
    const adminEmails = accessRows.filter((x) => x.role === 'admin').map((x) => x.caregiver_email).join(', ');
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    const card = settingsOk && (own || manage);
    show('setupCard', card);
    if (!card) return;
    show('setupSelf', own && state === 'unset');
    show('setupManaged', own && (state === 'unset' || state === 'self'));
    show('setupBack', (own && state === 'managed_pending') || (!own && manage));
    if (state !== 'unset' && state !== 'self') show('setupForm', false);
    $('setupTitle').textContent = own ? 'Who manages this account?' : 'You manage this circle';
    if (!own) { $('setupText').textContent = 'Only administrators can change who is in this circle and what each person sees.'; $('setupBack').textContent = 'Hand control back to ' + circle.label; }
    else if (state === 'unset') $('setupText').textContent = 'Choose once. You can change it later. If a family member manages it, only they can change who is in your circle, and you can still read and post.';
    else if (state === 'self') $('setupText').textContent = 'You manage this account yourself.';
    else if (state === 'managed_pending') { $('setupText').textContent = 'Waiting for ' + (adminEmails || 'your administrator') + ' to sign in and accept. Until then you stay in control.'; $('setupBack').textContent = 'Cancel, I will manage it myself'; }
    else $('setupText').textContent = (adminEmails || 'Your administrator') + ' manages this account. You can read and post, but only they can change who is in your circle.';
  }

  function renderRoles() {
    const manage = L.canManage(circle, settings, accessRows);
    $('rolesCard').classList.remove('hidden');
    $('inviteBox').classList.toggle('hidden', !manage);
    $('rolesIntro').textContent = manage
      ? 'Administrator can do everything, including managing the circle. Family and onsite caregiver can post, add tasks and log visits. View only can just read. Open "What they can see" to choose more.'
      : 'This is who is in the circle and what they can see.';
    if ($('roles').contains(document.activeElement)) return; // do not rebuild the list while someone is choosing
    if (!accessRows.length) { $('roles').innerHTML = '<p class="sub">No one has been invited yet.</p>'; return; }
    $('roles').innerHTML = accessRows.map((x) => {
      const head = `<div>${esc(x.caregiver_email)}${x.status === 'pending' ? ' <span class="who">(invited, not joined yet)</span>' : ''}</div>`;
      const secs = x.role === 'admin' ? L.SECTIONS : (x.sections || ['circle']);
      if (!manage) return `<div class="rolerow">${head}<div class="who">${esc(L.ROLE_LABELS[x.role] || x.role)}</div></div>`;
      const select = `<select data-role="${esc(x.id)}" aria-label="Role for ${esc(x.caregiver_email)}">${L.ROLES.map((role) => `<option value="${role}" ${role === x.role ? 'selected' : ''}>${esc(L.ROLE_LABELS[role])}</option>`).join('')}</select>`;
      const boxes = L.SECTIONS.map((sec) => `<label class="sec"><input type="checkbox" data-sec="${sec}" data-id="${esc(x.id)}" ${secs.includes(sec) ? 'checked' : ''} ${sec === 'circle' || x.role === 'admin' ? 'disabled' : ''}> ${esc(L.SECTION_LABELS[sec])}</label>`).join('');
      return `<div class="rolerow">${head}${select}<details><summary>What they can see</summary>${boxes}</details></div>`;
    }).join('');
    document.querySelectorAll('[data-role]').forEach((s) => {
      s.onchange = async () => {
        const u = await client.from('caregiver_access').update({ role: s.value, sections: L.sectionsForRole(s.value) }).eq('id', s.dataset.role);
        if (u.error) showError(u.error); s.blur(); loadManage();
      };
    });
    document.querySelectorAll('[data-sec]').forEach((box) => {
      box.onchange = async () => {
        const row = box.closest('.rolerow');
        const sections = [...row.querySelectorAll('[data-sec]')].filter((b) => b.checked || b.dataset.sec === 'circle').map((b) => b.dataset.sec);
        const u = await client.from('caregiver_access').update({ sections }).eq('id', box.dataset.id);
        if (u.error) showError(u.error); box.blur(); loadManage();
      };
    });
  }

  async function saveMode(mode) {
    const r = settings && settings.elder_id
      ? await client.from('circle_settings').update({ mode }).eq('elder_id', elderId)
      : await client.from('circle_settings').insert({ elder_id: elderId, mode });
    if (r.error) throw r.error;
  }

  async function addPerson(email, role) {
    const row = { elder_id: elderId, caregiver_email: email, status: 'pending', role, sections: L.sectionsForRole(role) };
    return client.from('caregiver_access').insert(row);
  }

  async function invite() {
    const email = L.cleanText($('inviteEmail').value, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError(new Error('Enter a full email address, like name@example.com.')); return; }
    if (email === String(me.email || '').toLowerCase()) { showError(new Error('Use a different email for the other person.')); return; }
    try {
      showError('');
      const r = await addPerson(email, $('inviteRole').value);
      if (r.error) throw (r.error.code === '23505' ? new Error('That person is already in the circle. Change their role above.') : r.error);
      $('inviteEmail').value = ''; loadManage();
    } catch (e) { showError(e); }
  }

  async function chooseSelf() { try { showError(''); await saveMode('self'); loadManage(); } catch (e) { showError(e); } }
  async function inviteAdmin() {
    const email = L.cleanText($('setupEmail').value, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError(new Error('Enter a full email address, like name@example.com.')); return; }
    if (email === String(me.email || '').toLowerCase()) { showError(new Error('Your administrator needs a different email from yours.')); return; }
    try {
      showError('');
      let r = await addPerson(email, 'admin');
      if (r.error && r.error.code === '23505') r = await client.from('caregiver_access').update({ role: 'admin', sections: L.sectionsForRole('admin') }).eq('elder_id', elderId).eq('caregiver_email', email);
      if (r.error) throw r.error;
      await saveMode('managed'); $('setupEmail').value = ''; loadManage();
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
  $('setupSelf').onclick = chooseSelf;
  $('setupManaged').onclick = () => $('setupForm').classList.toggle('hidden');
  $('setupInvite').onclick = inviteAdmin;
  $('setupBack').onclick = chooseSelf;
  $('addTask').onclick = addTask;
  $('addVisit').onclick = addVisit;
  $('bigText').onclick = () => { const on = document.body.classList.toggle('text-xl'); try { localStorage.setItem('exc_text_xl', on ? '1' : '0'); } catch {} };
  init().catch(showError);
})();
