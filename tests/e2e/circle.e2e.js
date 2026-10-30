/* Click-through robot for the Care Circle screen. Run: node tests/e2e/circle.e2e.js */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
});

const EDNA = { id: 'elder-1', email: 'edna@example.com', name: 'Edna Testerson' };
const FRAN = { id: 'fam-1', email: 'fran@example.com', name: 'Fran Testerson' };
const VIC = { id: 'view-1', email: 'vic@example.com', name: 'Vic Viewer' };
const DANA = { id: 'adm-1', email: 'dana@example.com', name: 'Dana Testerson' };
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const seed = (me) => ({
  me,
  tables: {
    caregiver_access: [
      { id: 'a1', elder_id: 'elder-1', caregiver_id: 'fam-1', caregiver_email: 'fran@example.com', role: 'family', sections: ['circle', 'checkins', 'reminders', 'contacts'], status: 'active', recipient_display_name: 'Edna Testerson', invited_at: hoursAgo(50) },
      { id: 'a2', elder_id: 'elder-1', caregiver_id: 'view-1', caregiver_email: 'vic@example.com', role: 'viewer', sections: ['circle'], status: 'active', invited_at: hoursAgo(40) },
      { id: 'a3', elder_id: 'elder-1', caregiver_id: null, caregiver_email: 'new@example.com', role: 'viewer', sections: ['circle'], status: 'pending', invited_at: hoursAgo(1) },
    ],
    circle_messages: [{ id: 'm0', elder_id: 'elder-1', sender_id: 'elder-1', sender_name: 'Edna Testerson', body: '<img src=x onerror="window.__xss=1">', created_at: hoursAgo(3) }],
    circle_tasks: [], circle_visits: [],
    profiles: [{ user_id: 'elder-1', profile_data: { name: 'Edna Testerson' } }],
    checkins: [{ user_id: 'elder-1', occurred_at: hoursAgo(1), mood: 'good' }],
  },
});

let failures = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failures++; };

async function open(browser, me, page = '/circle.html', checkins, failTables, mutate) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const s = seed(me); if (checkins) s.tables.checkins = checkins; if (failTables) s.failTables = failTables; if (mutate) mutate(s);
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify(s)};\n` + fake }));
  await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `localStorage.setItem('elderxonnect_supabase_config', JSON.stringify({url:'https://x.test',key:'k'}));` }));
  await p.goto('http://127.0.0.1:' + port + page);
  return { p, errors, ctx };
}
let port;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  const browser = await chromium.launch();

  // Elder
  let { p, errors, ctx } = await open(browser, EDNA);
  await p.waitForSelector('#messages .msg');
  check(await p.evaluate(() => window.__xss === undefined), 'message text is shown as text, not run as code');
  check((await p.textContent('#status')).startsWith('Checked in today'), 'elder sees checked-in-today status');
  check(await p.isVisible('#rolesCard'), 'elder sees the who-can-do-what card on their own circle');
  check((await p.locator('#roles select').count()) === 3, 'roles card lists all three invited people');
  await p.selectOption('[data-role="a2"]', 'onsite');
  check(await p.evaluate(() => window.__FAKE_DB__.tables.caregiver_access.find((r) => r.id === 'a2').role) === 'onsite', 'elder can change a role');
  check(await p.$$eval('select', (ss) => ss.filter((s) => s.offsetParent).every((s) => { const c = getComputedStyle(s); return c.color !== c.backgroundColor; })), 'dropdown text is readable against its background');
  check(await p.$eval('#inviteRole', (s) => [...s.options].map((o) => o.text).join('|')) === 'Administrator|Family|Onsite caregiver|View only', 'invite dropdown lists the three roles');
  await p.fill('#inviteEmail', 'nope'); await p.click('#sendInvite');
  check((await p.textContent('#error')).includes('full email'), 'bad invite email gets a plain message');
  await p.fill('#inviteEmail', 'Omar.Aide@Example.com'); await p.selectOption('#inviteRole', 'onsite'); await p.click('#sendInvite');
  await p.waitForFunction(() => document.querySelectorAll('#roles select').length === 4);
  check(await p.evaluate(() => { const r = window.__FAKE_DB__.tables.caregiver_access.find((x) => x.caregiver_email === 'omar.aide@example.com'); return r && r.status === 'pending' && r.role === 'onsite'; }), 'elder can invite someone with a chosen role');
  await p.fill('#inviteEmail', 'omar.aide@example.com'); await p.click('#sendInvite');
  check((await p.textContent('#error')).includes('already in the circle'), 'inviting the same person twice is explained');
  await p.fill('#inviteEmail', 'edna@example.com'); await p.click('#sendInvite');
  check((await p.textContent('#error')).includes('different email'), 'cannot invite yourself');
  await p.click('[data-q="Need help"]');
  await p.waitForFunction(() => document.querySelectorAll('#messages .msg').length === 2);
  check((await p.textContent('#messages .msg')).includes('Need help'), 'quick message posts');
  await p.fill('#taskText', 'Refill pills'); await p.click('#addTask');
  await p.waitForSelector('#tasks [data-t]'); await p.click('#tasks [data-t]');
  await p.waitForSelector('#tasks .task.done');
  check(true, 'task added and ticked');
  await p.fill('#visitNotes', 'Brought groceries'); await p.fill('#visitMinutes', '45'); await p.click('#addVisit');
  await p.waitForFunction(() => document.querySelector('#visits').textContent.includes('Brought groceries'));
  check((await p.textContent('#visits')).includes('45 min'), 'visit logged with minutes');
  await p.fill('#visitMinutes', '0'); await p.fill('#visitNotes', 'x'); await p.click('#addVisit');
  check((await p.textContent('#error')).includes('whole number'), 'bad minutes show a plain message');
  const btnH = await p.$$eval('button', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
  check(btnH.every((h) => h >= 44), 'every visible button is at least 44px tall');
  await p.click('#bigText');
  check(await p.evaluate(() => document.body.classList.contains('text-xl')), 'bigger text toggles');
  check(errors.length === 0, 'no script errors (elder) ' + errors.join(' | ')); await ctx.close();

  // Family caregiver opens the elder's circle by saved name and can write
  ({ p, errors, ctx } = await open(browser, FRAN));
  await p.waitForSelector('#messages .msg');
  check((await p.textContent('#who')).includes('Edna Testerson'), 'caregiver sees the person by name, not a code');
  check(!(await p.isVisible('#rolesCard')), 'caregiver does not see the roles card');
  check(await p.isVisible('#composeRow') && await p.isVisible('#visitForm'), 'family role can post and log visits');
  await ctx.close();

  // View-only caregiver
  ({ p, errors, ctx } = await open(browser, VIC));
  await p.waitForSelector('#messages .msg');
  check((await p.textContent('#who')).includes('Edna Testerson'), 'name falls back to the shared profile when the invitation has none');
  check(!(await p.isVisible('#composeRow')) && !(await p.isVisible('#taskRow')) && !(await p.isVisible('#visitForm')), 'viewer cannot see any write controls');
  check(await p.isVisible('#viewerNote'), 'viewer is told why');
  check(errors.length === 0, 'no script errors (viewer) ' + errors.join(' | ')); await ctx.close();

  // No data and missed check-in
  ({ p, ctx } = await open(browser, VIC, '/circle.html', [])); await p.waitForSelector('#messages .msg');
  check((await p.getAttribute('#status', 'class')).includes('unknown'), 'no check-in data shows unknown, not all-clear'); await ctx.close();

  // Administrator setup, role defaults and per-section switches (elder, nothing chosen yet)
  ({ p, ctx, errors } = await open(browser, EDNA)); await p.waitForSelector('#messages .msg');
  check(await p.isVisible('#setupCard') && await p.isVisible('#setupSelf') && await p.isVisible('#setupManaged'), 'elder is asked who manages the account');
  await p.click('#setupManaged'); await p.fill('#setupEmail', 'not an email'); await p.click('#setupInvite');
  check((await p.textContent('#error')).includes('full email'), 'administrator email is checked');
  await p.fill('#setupEmail', 'dana@example.com'); await p.click('#setupInvite');
  await p.waitForFunction(() => document.getElementById('setupText').textContent.includes('Waiting for dana@example.com'));
  check(await p.evaluate(() => { const d = window.__FAKE_DB__.tables; const a = d.caregiver_access.find((r) => r.caregiver_email === 'dana@example.com'); return a && a.role === 'admin' && a.status === 'pending' && d.circle_settings[0].mode === 'managed'; }), 'inviting an administrator saves them and managed mode');
  check(await p.isVisible('#setupBack') && (await p.locator('#roles select').count()) >= 3, 'while the administrator is pending the elder keeps control');
  await p.click('#setupBack');
  await p.waitForFunction(() => window.__FAKE_DB__.tables.circle_settings[0].mode === 'self');
  check(true, 'elder can cancel and manage it themselves');
  await p.selectOption('[data-role="a2"]', 'onsite');
  await p.waitForFunction(() => window.__FAKE_DB__.tables.caregiver_access.find((r) => r.id === 'a2').role === 'onsite');
  check(await p.evaluate(() => JSON.stringify(window.__FAKE_DB__.tables.caregiver_access.find((r) => r.id === 'a2').sections)) === '["circle","reminders"]', 'changing a role applies that role\'s default sections');
  await p.waitForTimeout(400);
  await p.locator('.rolerow:has([data-id="a1"]) summary').click();
  check(await p.locator('[data-id="a1"][data-sec="circle"]').isDisabled(), 'the circle section cannot be switched off');
  await p.locator('[data-id="a1"][data-sec="profile"]').check();
  await p.waitForFunction(() => window.__FAKE_DB__.tables.caregiver_access.find((r) => r.id === 'a1').sections.includes('profile'));
  check(true, 'elder can open a section for one person');
  check(errors.length === 0, 'no script errors (admin setup) ' + errors.join(' | ')); await ctx.close();

  // Managed and accepted: the elder can look and post but not manage
  const managed = (s) => { s.tables.circle_settings = [{ elder_id: 'elder-1', mode: 'managed' }]; s.tables.caregiver_access.push({ id: 'a9', elder_id: 'elder-1', caregiver_id: 'adm-1', caregiver_email: 'dana@example.com', role: 'admin', sections: [], status: 'active', recipient_display_name: 'Edna Testerson', invited_at: hoursAgo(60) }); };
  ({ p, ctx } = await open(browser, EDNA, '/circle.html', undefined, undefined, managed)); await p.waitForSelector('#messages .msg');
  await p.waitForFunction(() => document.getElementById('setupText').textContent.includes('manages this account'));
  check(!(await p.isVisible('#inviteBox')) && (await p.locator('#roles select').count()) === 0, 'managed: elder cannot invite or change roles');
  check(await p.isVisible('#composeRow'), 'managed: elder can still post');
  check(!(await p.isVisible('#setupBack')), 'managed: elder has no way to take control back'); await ctx.close();

  // The administrator manages the elder's circle and can hand control back
  ({ p, ctx } = await open(browser, DANA, '/circle.html', undefined, undefined, managed)); await p.waitForSelector('#messages .msg');
  await p.waitForSelector('#setupBack:not(.hidden)');
  check((await p.textContent('#setupBack')).includes('Hand control back'), 'administrator sees the hand-back button');
  check(await p.isVisible('#inviteBox') && (await p.locator('#roles select').count()) >= 3, 'administrator can invite and change roles');
  check(!(await p.isVisible('#setupSelf')), 'administrator is not shown the elder setup questions');
  await p.click('#setupBack');
  await p.waitForFunction(() => window.__FAKE_DB__.tables.circle_settings[0].mode === 'self');
  check(true, 'administrator can hand control back'); await ctx.close();

  // A caregiver without the check-ins section is told so, not shown a false picture
  ({ p, ctx } = await open(browser, VIC)); await p.waitForSelector('#messages .msg');
  check((await p.textContent('#status')).includes('not shared with you'), 'caregiver without check-ins sees "not shared"'); await ctx.close();

  // Visit log table missing (migration not applied): everything else still works
  ({ p, ctx } = await open(browser, EDNA, '/circle.html', undefined, ['circle_visits'])); await p.waitForSelector('#messages .msg');
  check((await p.textContent('#visits')).includes('not available yet'), 'missing visit log is explained');
  check((await p.locator('#messages .msg').count()) >= 1, 'messages still load without the visit log');
  check((await p.locator('#roles select').count()) === 3, 'roles still load without the visit log'); await ctx.close();

  // Signed-out visitor
  const ctx2 = await browser.newContext(); const q = await ctx2.newPage();
  await q.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__={me:null,tables:{}};\n` + fake }));
  await q.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `localStorage.setItem('elderxonnect_supabase_config', JSON.stringify({url:'https://x.test',key:'k'}));` }));
  await q.goto('http://127.0.0.1:' + port + '/circle.html'); await q.waitForTimeout(300);
  check(await q.isVisible('#signin') && !(await q.isVisible('#app')), 'signed-out visitor sees only the sign-in hint'); await ctx2.close();

  // Main app: no key box, companion still answers, no network call to the AI relay
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const m = await ctx3.newPage();
  const errs = []; m.on('pageerror', (e) => errs.push(e.message));
  const hits = []; m.on('request', (r) => { if (/workers\.dev|anthropic|deepseek/.test(r.url())) hits.push(r.url()); });
  await m.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.supabase={createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}}}}}' }));
  await m.addInitScript(() => { try { localStorage.setItem('anthropic_key', 'sk-ant-FAKE'); } catch {} });
  await m.goto('http://127.0.0.1:' + port + '/'); await m.waitForTimeout(500);
  check((await m.locator('#apiKeyInput, #saveApiKeyBtn').count()) === 0, 'main app no longer asks the elder for an API key');
  await m.evaluate(() => { document.getElementById('chatInput').value = 'hello'; return sendChat(); });
  await m.waitForSelector('.bubble.ai:not(.typing)', { state: 'attached', timeout: 4000 });
  check(hits.length === 0, 'chat makes no call to any AI service ' + hits.join(','));
  check(errs.length === 0, 'main page has no script errors ' + errs.join(' | '));
  await ctx3.close();

  await browser.close(); server.close();
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL SCREEN CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
