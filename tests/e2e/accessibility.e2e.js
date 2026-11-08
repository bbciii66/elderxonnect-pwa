// Run with Playwright Chromium and axe-core installed. All requests are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const axe = require.resolve('axe-core/axe.min.js');

const root = path.resolve(process.env.APP_ROOT || path.join(__dirname, '../..'));
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const origin = 'http://localhost';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json' };
const shots = process.env.SHOTS;
const capture = (page, name) => shots && page.screenshot({ path: path.join(shots, name + '.png') });

async function open(browser, theme, width, large = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme,
    serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net') {
      return route.fulfill({ contentType: types['.js'], body: 'window.__SEED__={me:null,tables:{}};\n' + fake });
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/supabase-config.js') return route.fulfill({ contentType: types['.js'], body: '' });
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
    return route.fulfill({ path: file, contentType: types[path.extname(file)] });
  });
  await context.addInitScript(large => {
    if (location.protocol !== 'http:') return;
    const user = { name: 'Edna Example', username: 'edna', created: Date.now() };
    if (localStorage.getItem('auth_session')) return;
    localStorage.setItem('elderxonnect_role_mode', 'recipient');
    localStorage.setItem('auth_users', JSON.stringify([user]));
    localStorage.setItem('auth_session', JSON.stringify({ ...user, ts: Date.now() }));
    localStorage.setItem('exc_text_xl', large ? '1' : '0');
    localStorage.setItem('reminders', JSON.stringify([{ title: 'Drink water', cat: '💧', scheduleTime: '14:00' }]));
    localStorage.setItem('contacts', JSON.stringify([{ name: 'Susan Example', phone: '5550100', rel: 'Family' }]));
  }, large);
  const page = await context.newPage();
  await page.goto(origin + '/');
  await page.locator('#mainNav').waitFor();
  await page.locator('#remScheduleType').waitFor({ state: 'attached' });
  return page;
}

async function fits(page, label) {
  const overflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
    return [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.right > innerWidth + 1;
    }).slice(0, 8).map(el => el.id || el.className || el.tagName);
  });
  assert.deepEqual(overflow, [], label);
}

async function focused(page, selector) {
  assert.ok(await page.locator(selector).evaluate(el => document.activeElement === el), selector + ' receives focus');
}

async function scan(page, label) {
  await page.addScriptTag({ path: axe });
  const results = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  }));
  const issues = results.violations.map(issue => ({ rule: issue.id, nodes: issue.nodes.map(node => node.target.join(' ')) }));
  if (process.env.AXE_REPORT) console.log(label, JSON.stringify(issues));
  else assert.deepEqual(issues, [], label);
}

(async () => {
  const args = process.env.SINGLE_PROCESS_CHROMIUM ? ['--single-process', '--no-zygote', '--disable-gpu'] : [];
  let browser;
  const newPage = async (...options) => {
    await browser?.close();
    browser = await chromium.launch({ args });
    return open(browser, ...options);
  };
  try {
    if (shots) fs.mkdirSync(shots, { recursive: true });
    const photoPage = await newPage('light', 320, true);
    await capture(photoPage, 'home-320-large');
    await photoPage.locator('#openSettingsBtn').click();
    await capture(photoPage, 'settings-320-large');
    await photoPage.context().close();
    if (process.env.CAPTURE_ONLY) return;

    for (const theme of ['light', 'dark']) {
      const page = await newPage(theme, 390);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.keyboard.press('Tab');
      await focused(page, '.skip-link');
      await page.keyboard.press('Enter');
      await focused(page, '#mainContent');
      await scan(page, theme + ' home');

      await page.locator('#checkinHeroBtn').press('Enter');
      await focused(page, '#checkinHeading');
      await page.locator('#saveCheckinBtn').press('Enter');
      await focused(page, '#moodGrid');
      assert.match(await page.locator('#moodGridError').textContent(), /Choose how you feel/);
      const mood = page.getByRole('button', { name: 'Good', exact: true });
      await mood.press('Space');
      assert.equal(await mood.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#moodGridError').textContent(), '');
      await scan(page, theme + ' check-in');
      await page.locator('#saveCheckinBtn').press('Enter');
      await focused(page, '#checkinHeroBtn');
      assert.match(await page.locator('#toast').textContent(), /Check-in saved/);

      await page.getByRole('button', { name: 'Reminders', exact: true }).press('Enter');
      await focused(page, '#remindersHeading');
      await page.locator('#addReminderCard summary').press('Enter');
      await page.locator('#addReminderBtn').press('Enter');
      await focused(page, '#remTitle');
      assert.equal(await page.getByLabel('Reminder title').getAttribute('aria-invalid'), 'true');
      await page.getByLabel('Reminder title').fill('Call Susan');
      await page.getByLabel('Time', { exact: true }).fill('09:00');
      await page.getByLabel('When', { exact: true }).selectOption('once');
      await page.locator('#addReminderBtn').press('Enter');
      await focused(page, '#remCalendar');
      const today = page.locator('#remCalendar [aria-current="date"]');
      await today.press('Space');
      await focused(page, '#remCalendar [aria-current="date"]');
      assert.equal(await today.getAttribute('aria-pressed'), 'true');
      await scan(page, theme + ' reminder form');
      await page.locator('#addReminderBtn').press('Enter');
      await focused(page, '#addReminderCard summary');
      assert.equal(await page.getByRole('button', { name: 'Delete reminder: Call Susan' }).count(), 1);

      await page.locator('#openSettingsBtn').press('Enter');
      const settings = page.getByRole('dialog', { name: 'Settings' });
      assert.ok(await settings.isVisible());
      await focused(page, '#settingsClose');
      const switchBox = settings.getByRole('checkbox', { name: 'Voice Input', exact: true });
      await switchBox.focus();
      assert.equal(await switchBox.evaluate(el => getComputedStyle(el.nextElementSibling).outlineStyle), 'solid');
      await scan(page, theme + ' settings');
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement === document.body ||
          !!document.activeElement.closest('#settingsDrawer')), true, 'Tab never reaches background content');
      }
      await page.keyboard.press('Escape');
      await focused(page, '#openSettingsBtn');

      await page.locator('#meFabBtn').press('Enter');
      await page.locator('#editMeBtn').click();
      assert.equal(await page.getByRole('dialog', { name: 'Edit My Profile' }).getByLabel('Full Name').count(), 1);
      await scan(page, theme + ' profile editor');
      await page.keyboard.press('Escape');
      await focused(page, '#editMeBtn');
      await page.getByRole('button', { name: 'People', exact: true }).press('Enter');
      await scan(page, theme + ' people');
      await page.getByRole('button', { name: 'Chat', exact: true }).press('Enter');
      await scan(page, theme + ' companion chat');
      await page.getByRole('button', { name: /Say hello/ }).press('Space');
      await focused(page, '#chatInput');
      assert.match(await page.getByRole('log').textContent(), /How are you today/);
      page.once('dialog', dialog => dialog.dismiss());
      await page.locator('#clearChatBtn').press('Enter');
      assert.match(await page.getByRole('log').textContent(), /How are you today/);
      assert.deepEqual(errors, []);
      await page.context().close();
    }

    for (const width of [320, 768]) {
      const page = await newPage('light', width, true);
      await page.addStyleTag({ content: 'html { font-size: 200% }' });
      for (const tab of ['home', 'reminders', 'chat', 'games', 'contacts', 'me']) {
        await page.evaluate(name => window.showTab(name), tab);
        await fits(page, width + 'px, enlarged text: ' + tab);
      }
      for (const button of await page.locator('#mainNav button').all()) {
        const size = await button.boundingBox();
        assert.ok(size.width >= 44 && size.height >= 44, 'Navigation targets are at least 44 × 44 CSS pixels');
      }
      await page.context().close();
    }
    console.log('PASS keyboard, validation, status, reflow, touch targets, and axe checks');
  } finally {
    await browser?.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
