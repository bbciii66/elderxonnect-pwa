/* Click-through robot for the elder's main app (home, reminders, people, me) in light and dark.
   The add-on scripts are injected exactly as the service worker does on a real phone.
   Run: node tests/e2e/home.e2e.js   (SHOTS=/some/dir also saves screenshots) */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const injected = [...sw.split('return injectScripts(response, [').pop().matchAll(/"([^"]+\.js)"/g)].map((m) => m[1]);
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  let body = fs.readFileSync(f);
  if (u === '/' || u === '/index.html') {
    const html = body.toString();
    const tags = injected.filter((s) => !html.includes(`src="${s}"`)).map((s) => `<script src="${s}" defer></script>`).join('\n');
    body = html.replace('</body>', `${tags}\n</body>`);
  }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(body);
});

let failures = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failures++; };
const SHOTS = process.env.SHOTS;

function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function open(browser, scheme, { profile, checkins } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const seed = { me: null, tables: {} };
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify(seed)};\n` + fake }));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, body: '' }));
  await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const today = new Date(), other = new Date(Date.now() + 3 * 86400000);
  const notToday = (today.getDay() + 1) % 7;
  await p.addInitScript(({ profile, checkins, todayKey, otherKey, notToday }) => {
    const h = (pin) => { let x = 0; for (let i = 0; i < pin.length; i++) { x = ((x << 5) - x) + pin.charCodeAt(i); x |= 0; } return x.toString(36); };
    if (localStorage.getItem('__seeded')) return;
    const u = { name: 'Edna Testerson', username: 'edna', pinHash: h('1234'), created: Date.now() };
    localStorage.setItem('elderxonnect_role_mode', 'recipient');
    localStorage.setItem('auth_users', JSON.stringify([u]));
    localStorage.setItem('auth_session', JSON.stringify({ ...u, ts: Date.now() }));
    localStorage.setItem('checkins_v2', JSON.stringify(checkins));
    localStorage.setItem('reminders', JSON.stringify([
      { title: 'Drink water', cat: '💧', scheduleType: 'daily', scheduleTime: '14:00' },
      { title: 'Blood pressure pill', cat: '💊', scheduleType: 'daily', scheduleTime: '09:00' },
      { title: 'Dentist <b>visit</b>', cat: '🏥', scheduleType: 'once', scheduleDate: todayKey, scheduleTime: '11:30' },
      { title: 'Not today: once', cat: '⭐', scheduleType: 'once', scheduleDate: otherKey, scheduleTime: '10:00' },
      { title: 'Not today: weekly', cat: '⭐', scheduleType: 'weekly', scheduleDays: [notToday], scheduleTime: '10:00' },
    ]));
    localStorage.setItem('contacts', JSON.stringify([{ name: 'Susan', phone: '5550100', rel: 'Family', created: Date.now() }]));
    localStorage.setItem('me_profile', JSON.stringify(profile));
    localStorage.setItem('__seeded', '1');
  }, { profile: profile || { name: 'Edna Testerson', caregiverName: 'Susan (daughter)', caregiverPhone: '(555) 010-0100' }, checkins: checkins || [], todayKey: ymd(today), otherKey: ymd(other), notToday });
  await p.goto('http://127.0.0.1:' + port + '/');
  await p.waitForTimeout(900);
  return { p, ctx, errors };
}

const tab = async (p, name) => { await p.evaluate((n) => showTab(n), name); await p.waitForTimeout(200); };
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

let port;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  const browser = await chromium.launch();

  for (const scheme of ['light', 'dark']) {
    const { p, ctx, errors } = await open(browser, scheme);
    for (const t of ['home', 'reminders', 'chat', 'games', 'contacts', 'me']) {
      await tab(p, t);
      check(await noSideScroll(p), `${scheme}: ${t} fits the screen (no sideways scrolling)`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${scheme}-${t}.png`, fullPage: true });
    }
    check(errors.length === 0, `${scheme}: no script errors ` + errors.join(' | '));
    await ctx.close();
  }

  // Home summary
  {
    const { p, ctx } = await open(browser, 'light');
    const hello = await p.textContent('#helloTitle');
    check(/^Good (morning|afternoon|evening), Edna$/.test(hello), 'home greets the elder by first name: ' + hello);
    const items = await p.$$eval('#todayList li .tt', (els) => els.map((e) => e.textContent));
    check(JSON.stringify(items) === JSON.stringify(['Blood pressure pill', 'Dentist <b>visit</b>', 'Drink water']), 'Today shows only today\'s reminders, earliest first: ' + JSON.stringify(items));
    check((await p.$$('#todayList b')).length === 0, 'reminder titles are shown as text, never as page code');
    check(await p.isVisible('#homeCallBtn') && /Call Susan \(daughter\)/.test(await p.textContent('#homeCallBtn')), 'home shows a big call button for the caregiver');
    check(await p.evaluate(() => ExcHome.telHref('(555) 010-0100')) === 'tel:5550100100', 'call button dials only the digits');
    check(/How are you feeling today\?/.test(await p.textContent('#checkinPrompt')), 'not checked in yet: home asks how they feel');
    check(await p.evaluate(() => !document.querySelector('header .brand p').offsetParent), 'header does not repeat the greeting');
    check(!(await p.isVisible('.status-dot')), 'online badge is hidden while online');

    await p.click('#checkinHeroBtn');
    await p.click('.mood-btn[data-mood="Good"]');
    await p.click('#saveCheckinBtn');
    await p.waitForTimeout(250);
    check(/checked in today/.test(await p.textContent('#checkinPrompt')), 'after checking in, home says so');
    check(await p.evaluate(() => document.getElementById('checkinHeroCard').classList.contains('done')), 'check-in card shows the done state');

    await p.click('#todayCard [data-go="reminders"]');
    check(await p.isVisible('#view-reminders'), '"See all reminders" opens the Reminders tab');
    check(await p.evaluate(() => document.querySelector('.tabbtn[data-tab="reminders"]').getAttribute('aria-current') === 'page'), 'current tab is announced to screen readers');
    await ctx.close();
  }

  // Reminders and people: list first, add form folded, deletes ask first
  {
    const { p, ctx } = await open(browser, 'dark');
    await tab(p, 'reminders');
    const order = await p.evaluate(() => [...document.getElementById('view-reminders').children].map((c) => c.id || c.className));
    check(order.indexOf('addReminderCard') > 0, 'reminder list comes before the add form');
    check(!(await p.isVisible('#remTitle')), 'add-reminder form starts folded');
    check(/Alerts sound while/.test(await p.textContent('#backgroundReminderWarning')), 'reminder warning is short and plain');
    const before = await p.$$eval('#remList li', (l) => l.length);
    p.once('dialog', (d) => d.dismiss());
    await p.click('#remList li button');
    await p.waitForTimeout(150);
    check((await p.$$eval('#remList li', (l) => l.length)) === before, 'cancelling the delete question keeps the reminder');
    p.once('dialog', (d) => d.accept());
    await p.click('#remList li button');
    await p.waitForTimeout(150);
    check((await p.$$eval('#remList li', (l) => l.length)) === before - 1, 'confirming deletes the reminder');

    await p.click('#addReminderCard summary');
    check(await p.isVisible('#remTitle'), 'tapping "+ Add a reminder" opens the form');
    await p.fill('#remTitle', 'Call the pharmacy');
    await p.fill('#remTime', '16:00');
    await p.click('#addReminderBtn');
    await p.waitForTimeout(250);
    check((await p.$$eval('#remList li', (l) => l.length)) === before, 'new reminder is added to the list');
    check(!(await p.evaluate(() => document.getElementById('addReminderCard').open)), 'add form folds away after saving');

    await tab(p, 'contacts');
    p.once('dialog', (d) => d.dismiss());
    await p.click('#contactList button:has-text("🗑")');
    await p.waitForTimeout(150);
    check(/Susan/.test(await p.textContent('#contactList')), 'cancelling keeps the person');
    await ctx.close();
  }

  // Me: elder basics up top, helper tools folded away
  {
    const { p, ctx } = await open(browser, 'light');
    await tab(p, 'me');
    await p.waitForTimeout(400);
    const ids = await p.evaluate(() => [...document.getElementById('view-me').children].map((c) => c.id));
    check(ids[0] === 'meHero' && ids[ids.length - 1] === 'helperSettings', 'Me starts with the profile and ends with helper settings: ' + ids.join(','));
    check(await p.evaluate(() => !!document.querySelector('#helperSlot #voiceSettingsCard')), 'voice tuning is in the helper settings');
    check(await p.evaluate(() => !!document.querySelector('#helperSlot #caregiverAccessCard')), 'caregiver invitations are in the helper settings');
    check(!(await p.isVisible('#sbUrl')), 'database connection fields are hidden from the elder');
    check(await p.evaluate(() => !!document.querySelector('#caregivingSlot #elderxonnectCaregivingSwitch')), 'caregiving switch moved off the header into Me');
    check(await p.evaluate(() => !document.querySelector('header #elderxonnectCaregivingSwitch')), 'header has no caregiving button');
    await p.click('[data-theme-choice="dark"]');
    check((await p.getAttribute('html', 'data-theme')) === 'dark', 'colors can be switched from Me');
    await p.click('#bigTextBtn');
    check(await p.evaluate(() => document.body.classList.contains('text-xl')), 'text size can be raised from Me');
    check(await noSideScroll(p), 'bigger text still fits the screen');
    await p.click('#editMeBtn');
    await p.waitForTimeout(200);
    check(await p.evaluate(() => { const m = document.getElementById('meModal'); return !!m && getComputedStyle(m).zoom !== '1' && getComputedStyle(m).zoom !== 'normal'; }), 'bigger text also enlarges the profile editor');
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.getElementById('meModal')?.classList.add('hidden'));
    await p.click('#bigTextBtn');
    await ctx.close();
  }

  // No caregiver phone: no call button
  {
    const { p, ctx } = await open(browser, 'light', { profile: { name: 'Edna Testerson' } });
    check(!(await p.isVisible('#homeCallBtn')), 'no call button when no caregiver phone is saved');
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL HOME CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
