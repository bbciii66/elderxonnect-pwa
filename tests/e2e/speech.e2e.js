/* Click-through robot for read aloud, the language choice and the translator.
   The phone's voice, microphone and translator are faked, so nothing real is spoken or sent.
   Run: node tests/e2e/speech.e2e.js   (SHOTS=/some/dir also saves screenshots) */
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

// Faked phone features. translator: 'ok' | 'download' | 'none' (no Translator at all) | 'nopair'.
function fakes({ translator, recognizer }) {
  window.__spoken = []; window.__outside = []; window.__recLang = null;
  const voices = [{ lang: 'en-US', localService: true, name: 'English' }, { lang: 'es-ES', localService: true, name: 'Spanish' }];
  const def = (k, v) => Object.defineProperty(window, k, { value: v, configurable: true, writable: true });
  def('speechSynthesis', { getVoices: () => voices, cancel() { window.__spoken.push('[cancel]'); }, speak(u) { window.__spoken.push(u.lang + '|' + (u.voice && u.voice.name) + '|' + u.text); setTimeout(() => u.onend && u.onend(), 20); }, onvoiceschanged: null });
  def('SpeechSynthesisUtterance', function (t) { this.text = t; });
  delete window.Translator; delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  if (translator !== 'none') {
    def('Translator', {
      availability: async ({ sourceLanguage, targetLanguage }) => translator === 'nopair' ? 'unavailable' : translator === 'download' ? 'downloadable' : 'available',
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        if (monitor) { const l = {}; monitor({ addEventListener: (n, f) => { l[n] = f; } }); l.downloadprogress && l.downloadprogress({ loaded: 1 }); }
        return { translate: async (t) => `[${sourceLanguage}>${targetLanguage}] ${t}` };
      },
    });
  }
  if (recognizer) {
    def('SpeechRecognition', function () { window.__rec = this; this.start = () => { window.__recLang = this.lang; setTimeout(() => { this.onresult({ results: [[{ transcript: 'Where is the pharmacy' }]] }); this.onend(); }, 30); }; this.stop = () => {}; });
  }
}

async function open(browser, scheme, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: opts.locale || 'en-US' });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__SEED__=${JSON.stringify({ me: null, tables: {} })};\n` + fake }));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, body: '' }));
  await p.route('**/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { r.abort(); });
  await p.addInitScript(`(${fakes.toString()})(${JSON.stringify({ translator: opts.translator || 'ok', recognizer: opts.recognizer !== false })});`);
  await p.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;
    const u = { name: 'Edna Testerson', username: 'edna', created: Date.now() };
    localStorage.setItem('elderxonnect_role_mode', 'recipient');
    localStorage.setItem('auth_users', JSON.stringify([u]));
    localStorage.setItem('auth_session', JSON.stringify({ ...u, ts: Date.now() }));
    localStorage.setItem('reminders', JSON.stringify([{ title: 'Drink water', cat: '💧', scheduleType: 'daily', scheduleTime: '14:00' }]));
    localStorage.setItem('__seeded', '1');
  });
  await p.goto('http://127.0.0.1:' + port + '/');
  await p.waitForTimeout(700);
  return { p, ctx, errors };
}
const tab = async (p, name) => { await p.evaluate((n) => showTab(n), name); await p.waitForTimeout(150); };
const spoken = (p) => p.evaluate(() => window.__spoken.filter((s) => s !== '[cancel]'));

let port;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  const browser = await chromium.launch();

  // Read aloud, English
  {
    const { p, ctx, errors } = await open(browser, 'light');
    check(await p.isVisible('#view-home .readaloud'), 'home has a "Read this page aloud" button');
    await p.click('#view-home .readaloud');
    await p.waitForTimeout(100);
    const s = await spoken(p);
    check(s.length > 0 && s[0].startsWith('en-US|English|'), 'reading uses the English voice: ' + (s[0] || '').slice(0, 60));
    check(s.join(' ').includes('Drink water') && !/[\u{1F300}-\u{1FAFF}]/u.test(s.join(' ')), 'it reads the reminder and no emoji');
    await p.waitForTimeout(150);
    check(/Read this page aloud/.test(await p.textContent('#view-home .readaloud')), 'button returns to normal when reading ends');
    await p.evaluate(() => { window.speechSynthesis.speak = (u) => window.__spoken.push('held|' + u.text); });
    await p.click('#view-home .readaloud');
    check(/Stop reading/.test(await p.textContent('#view-home .readaloud')), 'while reading the button says Stop');
    await p.click('#view-home .readaloud');
    check(/Read this page aloud/.test(await p.textContent('#view-home .readaloud')), 'tapping while reading stops it');
    await tab(p, 'reminders');
    check(await p.isVisible('#view-reminders .readaloud'), 'reminders page has the button too');
    check(errors.length === 0, 'no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // Read aloud in Spanish with a working translator
  {
    const { p, ctx } = await open(browser, 'light', { locale: 'es-MX' });
    await tab(p, 'me');
    check((await p.inputValue('#voiceLangSelect')) === 'es', 'phone set to Spanish starts with Spanish as my language');
    await tab(p, 'home');
    await p.click('#view-home .readaloud'); await p.waitForTimeout(300);
    const s = await spoken(p);
    check(s[0] && s[0].startsWith('es-ES|Spanish|') && s.join(' ').includes('[en>es]'), 'page is translated then read with the Spanish voice: ' + (s[0] || '').slice(0, 70));
    await ctx.close();
  }

  // Read aloud falls back to English when the phone cannot translate
  {
    const { p, ctx } = await open(browser, 'light', { locale: 'es-MX', translator: 'none' });
    await p.click('#view-home .readaloud'); await p.waitForTimeout(250);
    const s = await spoken(p);
    check(s[0] && s[0].startsWith('en-US|'), 'no translator: reads in English instead of staying silent');
    check(/English/.test(await p.textContent('#readAloudStatus')), 'and says why');
    await ctx.close();
  }

  // Translate card
  for (const scheme of ['light', 'dark']) {
    const { p, ctx, errors } = await open(browser, scheme);
    await tab(p, 'chat');
    check(await p.isVisible('#translateCard'), `${scheme}: translate card is on the Chat tab`);
    check((await p.inputValue('#trFrom')) === 'en' && (await p.inputValue('#trTo')) === 'es', `${scheme}: English to Spanish by default`);
    await p.click('#trGo');
    check(/Type or speak/.test(await p.textContent('#trStatus')), `${scheme}: empty box asks for words`);
    await p.fill('#trInput', 'Where is the pharmacy?');
    await p.click('#trGo'); await p.waitForTimeout(200);
    check(await p.isVisible('#trResult') && (await p.textContent('#trOut')) === '[en>es] Where is the pharmacy?', `${scheme}: translation shown`);
    check(!(await p.isVisible('#trFallback')), `${scheme}: no outside link when the phone can translate`);
    await p.click('#trListen'); await p.waitForTimeout(120);
    const s = await spoken(p);
    check(s.some((x) => x.startsWith('es-ES|Spanish|[en>es]')), `${scheme}: Listen speaks the translation in Spanish`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/translate-${scheme}.png`, fullPage: true });
    await p.click('#trSwap');
    check((await p.inputValue('#trFrom')) === 'es' && (await p.inputValue('#trTo')) === 'en' && (await p.inputValue('#trInput')).startsWith('[en>es]'), `${scheme}: swap flips languages and moves the result into the box`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scheme}: translate card fits the screen`);
    check(errors.length === 0, `${scheme}: no script errors ` + errors.join(' | '));
    await ctx.close();
  }

  // Microphone listens in the From language
  {
    const { p, ctx } = await open(browser, 'light');
    await tab(p, 'chat');
    await p.selectOption('#trFrom', 'vi');
    await p.click('#trMic'); await p.waitForTimeout(150);
    check((await p.evaluate(() => window.__recLang)) === 'vi-VN', 'microphone listens in the From language (Vietnamese)');
    check((await p.inputValue('#trInput')) === 'Where is the pharmacy', 'spoken words land in the box');
    await ctx.close();
  }
  {
    const { p, ctx } = await open(browser, 'light', { recognizer: false });
    await tab(p, 'chat');
    check(!(await p.isVisible('#trMic')), 'no microphone button when the phone cannot listen');
    await ctx.close();
  }

  // Language pack download and unavailable pair
  {
    const { p, ctx } = await open(browser, 'light', { translator: 'download' });
    await tab(p, 'chat'); await p.fill('#trInput', 'Good morning'); await p.click('#trGo'); await p.waitForTimeout(250);
    check(await p.isVisible('#trResult'), 'first-time language pack: translation still arrives');
    await ctx.close();
  }
  {
    const { p, ctx } = await open(browser, 'light', { translator: 'nopair' });
    await tab(p, 'chat'); await p.fill('#trInput', 'Good morning'); await p.click('#trGo'); await p.waitForTimeout(200);
    check(/cannot translate English to Spanish/.test(await p.textContent('#trStatus')) && await p.isVisible('#trFallback'), 'pair not supported: says so plainly and offers the link');
    await ctx.close();
  }
  {
    const { p, ctx } = await open(browser, 'light', { translator: 'none' });
    await tab(p, 'chat'); await p.fill('#trInput', 'Good morning'); await p.click('#trGo'); await p.waitForTimeout(200);
    const href = await p.getAttribute('#trFallback', 'href');
    check(/no built-in translator/.test(await p.textContent('#trStatus')) && /^https:\/\/translate\.google\.com\//.test(href || ''), 'no translator: offers the Google Translate link, tapped by the person');
    check(!(await p.isVisible('#trResult')), 'and shows no fake result');
    await ctx.close();
  }

  // Form microphones follow My language, chat microphone stays English
  {
    const { p, ctx } = await open(browser, 'light', { locale: 'fr-FR' });
    await p.evaluate(() => { localStorage.setItem('voice_input', 'true'); localStorage.setItem('voice_forms', 'true'); });
    await p.reload(); await p.waitForTimeout(600);
    await p.evaluate(() => startVoice('chatInput')); await p.waitForTimeout(100);
    check((await p.evaluate(() => window.__recLang)) === 'fr-FR', 'form microphones listen in My language');
    await p.waitForTimeout(150);
    await p.evaluate(() => startVoice('chat')); await p.waitForTimeout(100);
    check((await p.evaluate(() => window.__recLang)) === 'en-US', 'the English-only companion chat microphone stays English');
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL SPEECH CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
