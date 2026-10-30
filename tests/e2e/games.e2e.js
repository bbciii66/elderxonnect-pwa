/* Click-through robot for the weather card and the built-in games, in light and dark.
   Open-Meteo and the phone's location are faked, so nothing leaves this machine.
   Run: node tests/e2e/games.e2e.js   (SHOTS=/some/dir also saves screenshots) */
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

const hours = Array.from({ length: 48 }, (_, i) => `2026-10-30T${String(i % 24).padStart(2, '0')}:00`);
const probs = hours.map((_, i) => (i === 15 ? 70 : 0));
const forecast = {
  current: { time: '2026-10-30T10:00', temperature_2m: 71.4, apparent_temperature: 78, weather_code: 2, wind_speed_10m: 5 },
  daily: { weather_code: [61, 3], temperature_2m_max: [80.2, 75], temperature_2m_min: [62.6, 60], precipitation_probability_max: [70, 10] },
  hourly: { time: hours, precipitation_probability: probs },
};

async function open(browser, scheme, { geo = true, failForecast = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'en-US',
    permissions: geo ? ['geolocation'] : [], geolocation: { latitude: 29.951066, longitude: -90.071532 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const calls = [];
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify({ me: null, tables: {} })};\n` + fake }));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, body: '' }));
  await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api.open-meteo.com/**', (r) => { calls.push(r.request().url()); return failForecast ? r.abort() : r.fulfill({ contentType: 'application/json', body: JSON.stringify(forecast) }); });
  await p.route('**/geocoding-api.open-meteo.com/**', (r) => { calls.push(r.request().url()); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [
    { name: 'Metairie', admin1: 'Louisiana', country: 'United States', country_code: 'US', latitude: 29.98412, longitude: -90.15285 },
    { name: 'Metairie Terrace', admin1: 'Louisiana', country: 'United States', country_code: 'US', latitude: 29.97, longitude: -90.16 },
  ] }) }); });
  await p.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;
    const h = (pin) => { let x = 0; for (let i = 0; i < pin.length; i++) { x = ((x << 5) - x) + pin.charCodeAt(i); x |= 0; } return x.toString(36); };
    const u = { name: 'Edna Testerson', username: 'edna', pinHash: h('1234'), created: Date.now() };
    localStorage.setItem('elderxonnect_role_mode', 'recipient');
    localStorage.setItem('auth_users', JSON.stringify([u]));
    localStorage.setItem('auth_session', JSON.stringify({ ...u, ts: Date.now() }));
    localStorage.setItem('me_profile', JSON.stringify({ name: 'Edna Testerson' }));
    localStorage.setItem('__seeded', '1');
  });
  await p.goto('http://127.0.0.1:' + port + '/');
  await p.waitForTimeout(900);
  return { p, ctx, errors, calls };
}

const tab = async (p, name) => { await p.evaluate((n) => showTab(n), name); await p.waitForTimeout(200); };
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
const stageOpen = (p) => p.evaluate(() => !document.getElementById('gameStage').classList.contains('hidden'));

let port;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  const browser = await chromium.launch();

  // ── Weather ──
  {
    const { p, ctx, errors, calls } = await open(browser, 'light');
    check(await visible(p, '#weatherSetup') && !(await visible(p, '#weatherView')), 'weather: first visit asks where you are, sends nothing yet');
    check(calls.length === 0, 'weather: no network call before the person chooses');
    await p.click('#weatherUseLocation'); await p.waitForTimeout(400);
    check(await visible(p, '#weatherView'), 'weather: location shows the forecast');
    const url = new URL(calls.find((c) => c.includes('api.open-meteo.com')));
    check(url.searchParams.get('latitude') === '29.95' && url.searchParams.get('longitude') === '-90.07', 'weather: only rounded coordinates leave the phone');
    check(url.searchParams.get('temperature_unit') === 'fahrenheit', 'weather: US phone gets Fahrenheit');
    check(await p.textContent('#wxTemp') === '71°' && await p.textContent('#wxWords') === 'Partly cloudy', 'weather: temperature and words shown');
    check(/High 80° · Low 63°/.test(await p.textContent('#wxHiLo')), 'weather: high and low shown');
    check(await p.textContent('#wxAdvice') === 'Rain likely this afternoon.', 'weather: rain advice shown');
    check(/Open-Meteo/.test(await p.textContent('#weatherCard')), 'weather: Open-Meteo credit shown');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/weather-light.png` });

    // Reload: comes from the cache, no new call.
    const before = calls.length;
    await p.reload(); await p.waitForTimeout(700);
    check(await visible(p, '#weatherView') && calls.length === before, 'weather: reopening within 30 minutes uses the saved forecast');

    // Offline with an old forecast: still shown, but labelled.
    await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('exc_weather_cache')); c.at -= 3 * 3600 * 1000; localStorage.setItem('exc_weather_cache', JSON.stringify(c)); });
    await ctx.setOffline(true);
    await p.reload().catch(() => {}); await p.waitForTimeout(700);
    if (await p.$('#weatherCard')) {
      check(await visible(p, '#weatherView') && /last weather/i.test(await p.textContent('#weatherNote')), 'weather: offline with an old forecast says it is the last one we had');
    } else check(true, 'weather: offline reload skipped (no service worker in test)');
    await ctx.setOffline(false);
    await p.reload(); await p.waitForTimeout(700);

    // A slow Refresh must not come back and undo Change place.
    await p.unroute('**/api.open-meteo.com/**');
    await p.route('**/api.open-meteo.com/**', async (r) => { await new Promise((ok) => setTimeout(ok, 600)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(forecast) }).catch(() => {}); });
    await p.click('#weatherRefresh'); await p.waitForTimeout(100);
    await p.click('#weatherChange'); await p.waitForTimeout(900);
    check(await visible(p, '#weatherSetup') && !(await visible(p, '#weatherView')), 'weather: a late reply does not undo Change place');
    await p.unroute('**/api.open-meteo.com/**');
    await p.route('**/api.open-meteo.com/**', (r) => { calls.push(r.request().url()); r.fulfill({ contentType: 'application/json', body: JSON.stringify(forecast) }); });

    // Change place (done just above), then search a town.
    check(await visible(p, '#weatherSetup'), 'weather: Change place goes back to setup');
    await p.evaluate(() => { document.getElementById('weatherCityBox').open = true; });
    await p.fill('#weatherCity', 'Metairie'); await p.press('#weatherCity', 'Enter'); await p.waitForTimeout(300);
    const choices = await p.$$eval('.wx-choice', (b) => b.map((x) => x.textContent));
    check(choices[0] === 'Metairie, Louisiana' && choices.length === 2, 'weather: town search lists matching places');
    await p.click('.wx-choice'); await p.waitForTimeout(300);
    check(await visible(p, '#weatherView') && await p.textContent('#wxPlace') === 'Metairie, Louisiana', 'weather: picking a town shows its weather');
    check(await noSideScroll(p), 'weather: fits the screen');
    check(errors.length === 0, 'weather: no script errors ' + errors.join(' | '));
    await ctx.close();
  }
  {
    const { p, ctx, errors } = await open(browser, 'dark', { geo: false });
    await p.click('#weatherUseLocation'); await p.waitForTimeout(400);
    check(await visible(p, '#weatherSetup') && /type your town/i.test(await p.textContent('#weatherNote')), 'weather: location refused offers typing a town');
    check(await p.evaluate(() => document.getElementById('weatherCityBox').open), 'weather: town box opens by itself');
    check(errors.length === 0, 'weather (refused): no script errors ' + errors.join(' | '));
    await ctx.close();
  }
  {
    const { p, ctx } = await open(browser, 'light', { failForecast: true });
    await p.click('#weatherUseLocation'); await p.waitForTimeout(400);
    check(await visible(p, '#weatherSetup') && /internet/i.test(await p.textContent('#weatherNote')), 'weather: no internet says so plainly');
    await ctx.close();
  }

  // ── Games ──
  for (const scheme of ['light', 'dark']) {
    const { p, ctx, errors } = await open(browser, scheme);
    await tab(p, 'games');
    check(await p.$$eval('[data-game]', (t) => t.length) === 4, `${scheme}: four games on the Games tab`);
    const chess = await p.getAttribute('.chess-link', 'href');
    check(chess.startsWith('https://lichess.org/') && await p.getAttribute('.chess-link', 'rel') === 'noopener noreferrer', `${scheme}: chess links to Lichess safely`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${scheme}-games-tab.png`, fullPage: true });

    for (const g of ['match', 'sudoku', 'solitaire', 'tiles']) {
      await p.click(`[data-game="${g}"]`); await p.waitForTimeout(200);
      check(await stageOpen(p), `${scheme}: ${g} opens full screen`);
      const box = await p.$eval('#stageClose', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; });
      check(box.w >= 56 && box.h >= 56 && box.right <= 390, `${scheme}: ${g} close ✕ is big and on screen`);
      check(await noSideScroll(p), `${scheme}: ${g} fits the screen`);
      const overflow = await p.$eval('#stageBody', (b) => [...b.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
      check(overflow === 0, `${scheme}: ${g} nothing runs off the right edge`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${scheme}-game-${g}.png` });

      if (g === 'match') {
        const cards = await p.$$('.mm-card');
        check(cards.length === 12, `${scheme}: memory has 12 cards`);
        // Turn card 0 with each other card until a pair is found; a miss flips both back.
        let found = false;
        for (let i = 1; i < cards.length && !found; i++) {
          await cards[0].click(); await cards[i].click(); await p.waitForTimeout(100);
          if (await cards[i].evaluate((b) => b.classList.contains('done'))) found = true;
          else {
            await p.waitForTimeout(1200);
            check(await cards[i].evaluate((b) => !b.classList.contains('up') && b.textContent === ''), `${scheme}: memory turns a wrong pair back over`);
          }
        }
        check(found && await p.$$eval('.mm-card.done', (d) => d.length) === 2, `${scheme}: memory keeps a matched pair face up`);
      }
      if (g === 'sudoku') {
        const cell = await p.$('.sd-cell:not(.given)');
        await cell.click();
        const given = await p.$eval('.sd-cell.given', (b) => b.textContent);
        // Put the same number as a given in its row: should clash or be accepted, and the status explains.
        await p.click(`.sd-pad >> text="${given}"`); await p.waitForTimeout(100);
        check((await p.$$('.sd-cell.sel')).length === 1, `${scheme}: sudoku keeps the chosen square selected`);
        await p.click('.sd-pad >> text=Erase');
        check(/Keep going|Tap/.test(await p.textContent('.stage-status')), `${scheme}: sudoku erase works`);
        await p.click('text=Full 9×9'); await p.waitForTimeout(100);
        check((await p.$$('.sd-cell')).length === 81 && await noSideScroll(p), `${scheme}: sudoku 9×9 fits the screen`);
        if (SHOTS) await p.screenshot({ path: `${SHOTS}/${scheme}-game-sudoku9.png` });
      }
      if (g === 'solitaire') {
        check((await p.$$('.sol-pile')).length === 7, `${scheme}: solitaire has 7 piles`);
        const stockBefore = await p.getAttribute('.sol-top > :first-child', 'aria-label');
        await p.click('.sol-top > :first-child'); await p.waitForTimeout(100);
        check(/Moves: 1/.test(await p.textContent('.stage-status')) && stockBefore.includes('24'), `${scheme}: solitaire deck turns a card`);
        await p.click('text=↩ Undo'); await p.waitForTimeout(100);
        check((await p.getAttribute('.sol-top > :first-child', 'aria-label')).includes('24'), `${scheme}: solitaire undo puts it back`);
      }
      if (g === 'tiles') {
        check((await p.$$('.tm-tile')).length === 34, `${scheme}: tile match deals 34 tiles`);
        await p.click('text=💡 Hint'); await p.waitForTimeout(100);
        const hinted = await p.$$('.tm-tile.hint');
        check(hinted.length === 2, `${scheme}: tile hint lights two tiles`);
        const spots = await p.$$eval('.tm-tile.hint', (h) => h.map((b) => b.getAttribute('style')));
        for (const s of spots) { await p.click(`.tm-tile[style="${s}"]`); await p.waitForTimeout(50); }
        await p.waitForTimeout(100);
        check((await p.$$('.tm-tile')).length === 32, `${scheme}: matching a hinted pair removes it`);
        const blocked = await p.$('.tm-tile:not(.free)');
        if (blocked) { await blocked.click({ force: true }); check(/blocked/.test(await p.textContent('.stage-status')), `${scheme}: a blocked tile says so`); }
        await p.click('text=🔀 Shuffle'); await p.waitForTimeout(100);
        check((await p.$$('.tm-tile')).length === 32, `${scheme}: shuffle keeps the tiles`);
      }

      if (g === 'tiles') { await p.keyboard.press('Escape'); await p.waitForTimeout(200); check(!(await stageOpen(p)), `${scheme}: Escape closes the game`); }
      else if (g === 'solitaire') { await p.goBack(); await p.waitForTimeout(300); check(!(await stageOpen(p)), `${scheme}: phone Back button closes the game`); }
      else { await p.click('#stageClose'); await p.waitForTimeout(200); check(!(await stageOpen(p)), `${scheme}: ✕ closes the game`); }
      check(await p.evaluate(() => location.pathname === '/'), `${scheme}: closing ${g} stays in the app`);
    }
    // "Make text bigger" zooms the page; the boards must still fit.
    await p.evaluate(() => document.body.classList.add('text-xl'));
    for (const g of ['solitaire', 'tiles', 'sudoku', 'match']) {
      await p.evaluate((k) => ExcGames.open(k), g); await p.waitForTimeout(150);
      if (g === 'sudoku') { await p.click('text=Full 9×9'); await p.waitForTimeout(100); }
      const off = await p.$eval('#stageBody', (b) => [...b.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
      check(off === 0 && await noSideScroll(p), `${scheme}: ${g} fits with large text on`);
      if (SHOTS && scheme === 'light') await p.screenshot({ path: `${SHOTS}/xl-game-${g}.png` });
      await p.evaluate(() => ExcGames.close()); await p.waitForTimeout(200);
    }
    await p.evaluate(() => document.body.classList.remove('text-xl'));
    check(errors.length === 0, `${scheme}: games, no script errors ` + errors.join(' | '));
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL GAME AND WEATHER CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
