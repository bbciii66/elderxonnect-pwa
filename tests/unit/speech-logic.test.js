const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../speech-logic.js');

test('phone language picks a supported language, else English', () => {
  assert.equal(L.defaultLanguage('es-MX'), 'es');
  assert.equal(L.defaultLanguage('vi'), 'vi');
  assert.equal(L.defaultLanguage('sw-KE'), 'en');
  assert.equal(L.defaultLanguage(undefined), 'en');
  assert.equal(L.speechTag('fr'), 'fr-FR');
});

test('best voice: exact local, then same language, never another language', () => {
  const voices = [
    { lang: 'es-MX', localService: false, name: 'online mx' },
    { lang: 'es-ES', localService: true, name: 'local es' },
    { lang: 'en-US', localService: true, name: 'english' },
  ];
  assert.equal(L.pickVoice(voices, 'es').name, 'local es');
  assert.equal(L.pickVoice(voices.slice(0, 1), 'es').name, 'online mx');
  assert.equal(L.pickVoice(voices, 'fr'), null);
  assert.equal(L.pickVoice([], 'en'), null);
  assert.equal(L.pickVoice([{ lang: 'es_ES', localService: true, name: 'underscore' }], 'es').name, 'underscore');
});

test('emoji are dropped before reading aloud', () => {
  assert.equal(L.speakable('🏠 Home  ·  Take your pills 💊!'), 'Home · Take your pills !');
  assert.equal(L.speakable(null), '');
  assert.equal(L.speakable('Line one\n\n\nLine two'), 'Line one\nLine two');
});

test('long text is read in short pieces that keep every word', () => {
  const text = 'First sentence here. Second sentence follows! Third one? ' + 'word '.repeat(80);
  const parts = L.chunks(text, 60);
  assert.ok(parts.length > 3);
  assert.ok(parts.every((p) => p.length <= 60 || !p.includes(' ')));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text.trim().replace(/\s+/g, ' '));
  assert.deepEqual(L.chunks(''), []);
  assert.deepEqual(L.chunks('One line\nTwo line'), ['One line', 'Two line']);
});

test('translation input is trimmed and capped', () => {
  assert.equal(L.cleanForTranslate('  hello  '), 'hello');
  assert.equal(L.cleanForTranslate('x'.repeat(5000)).length, L.MAX_TRANSLATE_CHARS);
  assert.equal(L.cleanForTranslate(undefined), '');
});

test('language pack messages are plain', () => {
  assert.equal(L.availabilityMessage('available', 'English', 'Spanish'), '');
  assert.match(L.availabilityMessage('downloadable', 'English', 'Spanish'), /one time, free/);
  assert.match(L.availabilityMessage('unavailable', 'English', 'Spanish'), /cannot translate English to Spanish/);
});

test('fallback link is Google Translate and carries only what the person typed', () => {
  const u = new URL(L.googleTranslateUrl('Where is the bathroom?', 'en', 'es'));
  assert.equal(u.hostname, 'translate.google.com');
  assert.equal(u.searchParams.get('text'), 'Where is the bathroom?');
  assert.equal(u.searchParams.get('tl'), 'es');
});
