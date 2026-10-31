/* Click-through robot for opening the app: PIN, Face ID / fingerprint (Chrome's virtual authenticator), and "just open it".
   Run: node tests/e2e/unlock.e2e.js   (SHOTS=/some/dir also saves screenshots) */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
});

let failures = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failures++; };
const SHOTS = process.env.SHOTS;
const HOUR = 3600 * 1000;

async function open(browser, { ageHours = 0, unlock = null, bio = false, noBio = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify({ me: null, tables: {} })};\n` + fake }));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, body: '' }));
  await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  let auth = null;
  if (bio) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    auth = { cdp, authenticatorId };
  }
  if (noBio) await p.addInitScript(() => { if (window.PublicKeyCredential) Object.defineProperty(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', { value: () => Promise.resolve(false), configurable: true }); });
  await p.addInitScript(({ ageHours, unlock }) => {
    if (localStorage.getItem('__seeded')) return;
    const h = (pin) => { let x = 0; for (let i = 0; i < pin.length; i++) { x = ((x << 5) - x) + pin.charCodeAt(i); x |= 0; } return x.toString(36); };
    const u = { name: 'Edna Testerson', username: 'edna', pinHash: h('1234'), created: Date.now() };
    localStorage.setItem('elderxonnect_role_mode', 'recipient');
    localStorage.setItem('auth_users', JSON.stringify([u]));
    localStorage.setItem('auth_session', JSON.stringify({ ...u, ts: Date.now() - ageHours * 3600 * 1000 }));
    if (unlock) localStorage.setItem('exc_unlock', unlock);
    localStorage.setItem('__seeded', '1');
  }, { ageHours, unlock });
  await p.goto('http://localhost:' + port + '/');
  await p.waitForTimeout(800);
  return { p, ctx, errors, auth };
}
const inApp = (p) => p.evaluate(() => !document.getElementById('mainApp').classList.contains('hidden'));
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);
const age = (p, hours) => p.evaluate((h) => { const s = JSON.parse(localStorage.getItem('auth_session')); s.ts = Date.now() - h * 3600 * 1000; localStorage.setItem('auth_session', JSON.stringify(s)); }, hours);
const typePin = async (p, pin) => { for (const d of pin) await p.click(`.pin-key[data-val="${d}"]`); await p.waitForTimeout(400); };
const meCard = async (p) => { await p.evaluate(() => showTab('me')); await p.waitForTimeout(200); };

let port;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  const browser = await chromium.launch();

  // PIN (today's default)
  {
    const { p, ctx, errors } = await open(browser, { ageHours: 13 });
    check(!(await inApp(p)) && await shown(p, '#pinArea') && !(await shown(p, '#biometricLoginBtn')), 'pin: after 12 idle hours the PIN pad shows, no Face ID button');
    check(!(await shown(p, '#recipientAccountRestoreCard')) && !(await shown(p, '#showNewUserBtn')) && await shown(p, '#authMoreOptions > summary'), 'pin: restore form and new-person link are folded under More options');
    await p.click('#authMoreOptions > summary'); await p.waitForTimeout(100);
    check(await shown(p, '#recipientAccountRestoreCard') && await shown(p, '#showNewUserBtn'), 'pin: More options shows them');
    await p.click('#authMoreOptions > summary');
    await typePin(p, '9999');
    check(!(await inApp(p)) && /Wrong PIN/.test(await p.textContent('#loginError')), 'pin: a wrong PIN is refused');
    await typePin(p, '1234');
    check(await inApp(p), 'pin: the right PIN opens the app');
    await age(p, 11);
    await p.mouse.click(200, 400); await p.waitForTimeout(100);
    const ts = await p.evaluate(() => JSON.parse(localStorage.getItem('auth_session')).ts);
    check(Date.now() - ts < 60000, 'pin: using the app keeps it open (12 hours counts from last use)');
    await p.reload(); await p.waitForTimeout(700);
    check(await inApp(p), 'pin: reopening soon after does not ask again');
    await age(p, 13);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(900);
    check(!(await inApp(p)), 'pin: coming back to the app after 12 idle hours locks it');
    check(errors.length === 0, 'pin: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // Just open it
  {
    const { p, ctx, errors } = await open(browser, { noBio: true });
    await meCard(p);
    check(!(await shown(p, '[data-unlock="bio"]')), 'none: Face ID choice hidden on a phone without it');
    check(await p.getAttribute('[data-unlock="pin"]', 'aria-pressed') === 'true', 'none: PIN is the starting choice');
    await p.click('[data-unlock="none"]'); await p.waitForTimeout(100);
    check(await p.getAttribute('[data-unlock="none"]', 'aria-pressed') === 'true' && /phone itself is locked/.test(await p.textContent('#unlockNote')), 'none: choosing "Just open it" says to lock the phone');
    await age(p, 200);
    await p.reload(); await p.waitForTimeout(700);
    check(await inApp(p), 'none: opens straight in even days later');
    await meCard(p);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/unlock-me.png`, fullPage: true });
    await p.click('[data-unlock="pin"]'); await age(p, 13); await p.reload(); await p.waitForTimeout(700);
    check(!(await inApp(p)), 'none: switching back to PIN asks again');
    check(errors.length === 0, 'none: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // Face ID / fingerprint
  {
    const { p, ctx, errors, auth } = await open(browser, { bio: true });
    await meCard(p);
    check(await shown(p, '[data-unlock="bio"]'), 'bio: Face ID choice shows on a phone that has it');
    await p.click('[data-unlock="bio"]'); await p.waitForTimeout(800);
    check(await p.getAttribute('[data-unlock="bio"]', 'aria-pressed') === 'true' && /Done/.test(await p.textContent('#unlockNote')), 'bio: setting up Face ID works from Me');
    await age(p, 13);
    await p.reload(); await p.waitForTimeout(1200);
    check(await inApp(p), 'bio: after 12 idle hours, Face ID opens the app without typing');
    // Face ID fails: the big button and "Use my PIN instead" remain.
    await auth.cdp.send('WebAuthn.setUserVerified', { authenticatorId: auth.authenticatorId, isUserVerified: false });
    await age(p, 13);
    await p.reload(); await p.waitForTimeout(1200);
    check(!(await inApp(p)) && await shown(p, '#biometricLoginBtn') && !(await shown(p, '#pinArea')), 'bio: when Face ID does not match, the PIN pad stays tucked away');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/unlock-faceid.png` });
    const btn = await p.$eval('#biometricLoginBtn', (b) => b.getBoundingClientRect().height);
    check(btn >= 80, 'bio: the Face ID button is big');
    await p.click('#usePinBtn'); await p.waitForTimeout(100);
    check(await shown(p, '#pinArea'), 'bio: "Use my PIN instead" shows the PIN pad');
    await typePin(p, '1234');
    check(await inApp(p), 'bio: the PIN still works as a backup');
    check(errors.length === 0, 'bio: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // New account: no pop-up, goes straight in.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    let dialogs = 0; p.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify({ me: null, tables: {} })};\n` + fake }));
    await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await p.addInitScript(() => localStorage.setItem('elderxonnect_role_mode', 'recipient'));
    await p.goto('http://localhost:' + port + '/'); await p.waitForTimeout(700);
    await p.fill('#setupName', 'Walt Example'); await p.fill('#setupUsername', 'walt');
    for (const d of '2468') await p.click(`.pin-key[data-new="${d}"]`);
    check(await shown(p, '#recipientAccountRestoreCard') && !(await p.$('#authMoreOptions')), 'new phone: restore form is shown openly');
    await p.click('#createAccountBtn'); await p.waitForTimeout(400);
    check(await inApp(p) && dialogs === 0, 'new account: goes straight in with no pop-up');
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL UNLOCK CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
