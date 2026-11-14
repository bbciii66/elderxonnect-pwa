/* Plain rules for talking, listening and translating. No screen, speaker or network code here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpeechLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // code = short language code the on-phone translator uses; speech = the tag the voice and microphone use.
  const LANGUAGES = [
    { code: 'en', speech: 'en-US', name: 'English', native: 'English' },
    { code: 'es', speech: 'es-ES', name: 'Spanish', native: 'Español' },
    { code: 'fr', speech: 'fr-FR', name: 'French', native: 'Français' },
    { code: 'vi', speech: 'vi-VN', name: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'zh', speech: 'zh-CN', name: 'Chinese', native: '中文' },
    { code: 'pt', speech: 'pt-BR', name: 'Portuguese', native: 'Português' },
    { code: 'de', speech: 'de-DE', name: 'German', native: 'Deutsch' },
    { code: 'it', speech: 'it-IT', name: 'Italian', native: 'Italiano' },
    { code: 'ko', speech: 'ko-KR', name: 'Korean', native: '한국어' },
    { code: 'ja', speech: 'ja-JP', name: 'Japanese', native: '日本語' },
    { code: 'ru', speech: 'ru-RU', name: 'Russian', native: 'Русский' },
  ];

  function shortCode(code) { return String(code || '').toLowerCase().split(/[-_]/)[0]; }
  function info(code) {
    const c = shortCode(code);
    return LANGUAGES.find((l) => l.code === c) || LANGUAGES[0];
  }
  // The phone's own language if we support it, otherwise English.
  function defaultLanguage(navigatorLanguage) { return info(navigatorLanguage).code; }
  function speechTag(code) { return info(code).speech; }

  // Best installed voice: exact tag, then same language, preferring voices that run on the phone itself.
  function pickVoice(voices, code) {
    const list = Array.from(voices || []);
    const tag = speechTag(code).toLowerCase().replace('_', '-');
    const short = shortCode(code);
    const same = list.filter((v) => shortCode(v.lang) === short);
    return same.find((v) => String(v.lang).toLowerCase().replace('_', '-') === tag && v.localService)
      || same.find((v) => String(v.lang).toLowerCase().replace('_', '-') === tag)
      || same.find((v) => v.localService)
      || same[0] || null;
  }

  // Emoji and symbols are read out as nonsense ("house with garden"), so drop them. Keep letters, digits and punctuation.
  function speakable(text) {
    return String(text == null ? '' : text)
      .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{2022}]/gu, ' ')
      .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/ ?\n ?/g, '\n').trim();
  }

  // Some phones cut off long speech, so read a sentence or two at a time.
  function chunks(text, max) {
    const limit = max || 200;
    const out = [];
    String(text || '').split(/\n+/).forEach((line) => {
      const sentences = line.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [];
      let cur = '';
      sentences.forEach((s) => {
        if ((cur + s).length > limit && cur) { out.push(cur.trim()); cur = ''; }
        while (s.length > limit) {
          const cut = s.lastIndexOf(' ', limit) > 0 ? s.lastIndexOf(' ', limit) : limit;
          out.push(s.slice(0, cut).trim()); s = s.slice(cut);
        }
        cur += s;
      });
      if (cur.trim()) out.push(cur.trim());
    });
    return out.filter(Boolean);
  }

  const MAX_TRANSLATE_CHARS = 2000;
  function cleanForTranslate(text) { return String(text == null ? '' : text).trim().slice(0, MAX_TRANSLATE_CHARS); }

  // Plain sentence for what the on-phone translator said about a language pair.
  function availabilityMessage(state, fromName, toName) {
    if (state === 'available') return '';
    if (state === 'downloadable') return `The first ${fromName} to ${toName} translation downloads a small language pack to this phone (one time, free).`;
    if (state === 'downloading') return 'The language pack is still downloading. Please wait a moment.';
    return `This phone cannot translate ${fromName} to ${toName} on its own.`;
  }

  // Fallback only when the phone has no translator: a link the person taps themselves. The text leaves the phone.
  function googleTranslateUrl(text, from, to) {
    const q = new URLSearchParams({ sl: from || 'auto', tl: to, text: cleanForTranslate(text), op: 'translate' });
    return 'https://translate.google.com/?' + q.toString();
  }

  return { LANGUAGES, shortCode, info, defaultLanguage, speechTag, pickVoice, speakable, chunks, cleanForTranslate,
    availabilityMessage, googleTranslateUrl, MAX_TRANSLATE_CHARS };
});
