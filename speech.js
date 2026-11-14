/* Read aloud, a language choice, and an on-phone translator.
   Uses the phone's own voice, microphone and (where it has one) built-in translator: free, no account,
   and nothing typed here leaves the phone. The only exception is the "Open Google Translate" link,
   which appears only when the phone has no translator and is tapped by the person. */
(function () {
  'use strict';
  var L = window.SpeechLogic;
  var $ = function (id) { return document.getElementById(id); };
  if (!L) return;

  function read(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function myLang() { return L.info(read('voice_lang', L.defaultLanguage(navigator.language))).code; }
  function setStatus(id, text) { var n = $(id); if (n) n.textContent = text || ''; }

  // ── Speaking ──
  var canSpeak = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  var speakToken = 0;
  function stopSpeaking() { speakToken++; if (canSpeak) { try { window.speechSynthesis.cancel(); } catch (e) {} } }
  function say(text, code, onEnd) {
    var token = ++speakToken, done = function () { if (token === speakToken && onEnd) onEnd(); };
    var parts = L.chunks(L.speakable(text));
    if (!canSpeak || !parts.length) { done(); return false; }
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var voice = L.pickVoice(window.speechSynthesis.getVoices(), code);
    parts.forEach(function (part, i) {
      var u = new window.SpeechSynthesisUtterance(part);
      u.lang = L.speechTag(code);
      if (voice) u.voice = voice;
      u.rate = parseFloat(read('voice_speed', 0.9)) || 0.9;
      u.pitch = parseFloat(read('voice_pitch', 1)) || 1;
      if (i === parts.length - 1) { u.onend = done; }
      u.onerror = done;
      window.speechSynthesis.speak(u);
    });
    return true;
  }

  // ── Translating (the phone's own translator) ──
  var translators = {};
  function translatorAvailable() { return typeof window.Translator === 'object' || typeof window.Translator === 'function'; }
  function availability(from, to) {
    if (!translatorAvailable()) return Promise.resolve('unavailable');
    if (from === to) return Promise.resolve('available');
    return Promise.resolve(window.Translator.availability({ sourceLanguage: from, targetLanguage: to })).catch(function () { return 'unavailable'; });
  }
  function getTranslator(from, to, onProgress) {
    var key = from + '>' + to;
    if (translators[key]) return Promise.resolve(translators[key]);
    return Promise.resolve(window.Translator.create({
      sourceLanguage: from, targetLanguage: to,
      monitor: function (m) { m.addEventListener('downloadprogress', function (e) { if (onProgress) onProgress(e.loaded); }); },
    })).then(function (t) { translators[key] = t; return t; });
  }
  function translate(text, from, to, onProgress) {
    var clean = L.cleanForTranslate(text);
    if (!clean || from === to) return Promise.resolve(clean);
    return getTranslator(from, to, onProgress).then(function (t) { return t.translate(clean); });
  }
  function langName(code) { return L.info(code).name; }

  // ── Language lists ──
  function fillLangSelect(sel, value) {
    if (!sel) return;
    sel.innerHTML = '';
    L.LANGUAGES.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.code; o.textContent = l.native; o.lang = l.speech;
      sel.appendChild(o);
    });
    sel.value = value;
  }

  // ── "My language" setting (Me → Voice) ──
  var langSel = $('voiceLangSelect');
  fillLangSelect(langSel, myLang());
  if (langSel) langSel.addEventListener('change', function () {
    write('voice_lang', langSel.value);
    refreshReadAloud();
  });

  // ── Read this page aloud ──
  var reading = null;
  function pageText(view) { return (view.innerText || '').replace(/(🔊 Read this page aloud|⏹ Stop reading)/g, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 4000); }
  function resetReadButtons() {
    reading = null;
    document.querySelectorAll('.readaloud').forEach(function (b) {
      b.classList.remove('speaking'); b.setAttribute('aria-pressed', 'false'); b.textContent = '🔊 Read this page aloud';
    });
  }
  function readView(view, btn) {
    if (reading === view) { stopSpeaking(); resetReadButtons(); return; }
    stopSpeaking(); resetReadButtons();
    reading = view;
    btn.classList.add('speaking'); btn.setAttribute('aria-pressed', 'true'); btn.textContent = '⏹ Stop reading';
    var text = pageText(view), target = myLang();
    var go = function (t, code) { if (reading !== view) return; if (!say(t, code, resetReadButtons)) resetReadButtons(); };
    if (target === 'en') return go(text, 'en');
    availability('en', target).then(function (state) {
      if (reading !== view) return;
      if (state !== 'available') { setStatus('readAloudStatus', 'Reading in English: this phone has no ' + langName(target) + ' translator ready.'); return go(text, 'en'); }
      var paras = text.split('\n'), groups = [], cur = '';
      paras.forEach(function (p) { if ((cur + '\n' + p).length > 1500 && cur) { groups.push(cur); cur = p; } else cur = cur ? cur + '\n' + p : p; });
      if (cur) groups.push(cur);
      return groups.reduce(function (acc, g) { return acc.then(function (out) { return translate(g, 'en', target).then(function (t) { return out + '\n' + t; }); }); }, Promise.resolve(''))
        .then(function (t) { go(t, target); })
        .catch(function () { setStatus('readAloudStatus', 'Translation did not work, reading in English.'); go(text, 'en'); });
    });
  }
  function refreshReadAloud() { setStatus('readAloudStatus', ''); }
  function addReadAloud(viewId) {
    var view = $(viewId);
    if (!view || view.querySelector('.readaloud')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ghost readaloud'; b.setAttribute('aria-pressed', 'false');
    b.textContent = '🔊 Read this page aloud';
    b.addEventListener('click', function () { readView(view, b); });
    view.insertBefore(b, view.firstChild);
    if (!canSpeak) b.hidden = true;
  }
  ['view-home', 'view-reminders', 'view-contacts'].forEach(addReadAloud);
  if (canSpeak && !$('readAloudStatus')) {
    var st = document.createElement('p'); st.id = 'readAloudStatus'; st.className = 'small'; st.setAttribute('role', 'status');
    var home = $('view-home'); if (home) home.insertBefore(st, home.children[1] || null);
  }
  // Leaving a screen stops the reading.
  document.querySelectorAll('.tabbtn').forEach(function (b) { b.addEventListener('click', function () { stopSpeaking(); resetReadButtons(); }); });

  // ── Translate card ──
  var card = $('translateCard');
  if (!card) return;
  var from = $('trFrom'), to = $('trTo'), input = $('trInput'), out = $('trOut'), result = $('trResult');
  var mine = myLang();
  fillLangSelect(from, mine === 'en' ? 'en' : mine);
  fillLangSelect(to, mine === 'en' ? 'es' : 'en');
  var lastTo = to.value;

  function showFallback() {
    var a = $('trFallback');
    a.href = L.googleTranslateUrl(input.value, from.value, to.value);
    a.hidden = false;
  }
  function hideFallback() { $('trFallback').hidden = true; }
  function showResult(text) {
    out.textContent = text; out.lang = L.speechTag(to.value);
    result.hidden = false; lastTo = to.value;
  }

  $('trSwap').addEventListener('click', function () {
    var f = from.value; from.value = to.value; to.value = f;
    if (!result.hidden) { var t = out.textContent; input.value = t; result.hidden = true; }
    hideFallback(); setStatus('trStatus', '');
  });
  [from, to].forEach(function (s) { s.addEventListener('change', function () { result.hidden = true; hideFallback(); setStatus('trStatus', ''); }); });

  $('trGo').addEventListener('click', function () {
    var text = L.cleanForTranslate(input.value);
    hideFallback(); result.hidden = true;
    if (!text) { setStatus('trStatus', 'Type or speak some words first.'); input.focus(); return; }
    var f = from.value, t = to.value;
    if (f === t) { showResult(text); setStatus('trStatus', 'Both languages are the same.'); return; }
    var btn = $('trGo'); btn.disabled = true;
    setStatus('trStatus', 'Translating…');
    availability(f, t).then(function (state) {
      if (state === 'unavailable') {
        setStatus('trStatus', translatorAvailable()
          ? L.availabilityMessage(state, langName(f), langName(t))
          : 'This phone has no built-in translator. You can use Google Translate instead; your words will be sent to Google.');
        showFallback(); return;
      }
      var msg = L.availabilityMessage(state, langName(f), langName(t));
      if (msg) setStatus('trStatus', msg);
      return translate(text, f, t, function (p) { setStatus('trStatus', 'Downloading the language pack… ' + Math.round(p * 100) + '%'); })
        .then(function (res) { showResult(res); setStatus('trStatus', ''); });
    }).catch(function () {
      setStatus('trStatus', 'The translation did not work. Please try again.'); showFallback();
    }).then(function () { btn.disabled = false; });
  });

  var listen = $('trListen');
  listen.addEventListener('click', function () {
    if (listen.classList.contains('speaking')) { stopSpeaking(); listen.classList.remove('speaking'); listen.textContent = '🔊 Listen'; return; }
    var ok = say(out.textContent, lastTo, function () { listen.classList.remove('speaking'); listen.textContent = '🔊 Listen'; });
    if (!ok) { setStatus('trStatus', 'This phone cannot read aloud.'); return; }
    if (!L.pickVoice(window.speechSynthesis.getVoices(), lastTo)) setStatus('trStatus', 'This phone has no ' + langName(lastTo) + ' voice installed, so it may sound wrong.');
    listen.classList.add('speaking'); listen.textContent = '⏹ Stop';
  });

  // Microphone for the "From" language
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var mic = $('trMic'), rec = null;
  if (!Rec) { mic.hidden = true; }
  mic.addEventListener('click', function () {
    if (rec) { try { rec.stop(); } catch (e) {} return; }
    stopSpeaking();
    rec = new Rec(); rec.continuous = false; rec.interimResults = true; rec.lang = L.speechTag(from.value);
    var got = '';
    rec.onresult = function (e) {
      var text = '';
      for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      got = text; input.value = text;
    };
    rec.onend = function () { rec = null; mic.classList.remove('listening'); mic.textContent = '🎙️ Speak'; setStatus('trStatus', got ? 'Got it. Tap Translate.' : 'No speech heard. Please try again.'); };
    rec.onerror = function (e) {
      rec = null; mic.classList.remove('listening'); mic.textContent = '🎙️ Speak';
      setStatus('trStatus', e.error === 'not-allowed' ? 'Microphone permission was denied. Check the phone settings.' : e.error === 'no-speech' ? 'No speech heard. Please try again.' : 'The microphone did not work (' + e.error + ').');
    };
    try { rec.start(); mic.classList.add('listening'); mic.textContent = '⏹ Stop'; setStatus('trStatus', 'Listening in ' + langName(from.value) + '…'); }
    catch (e) { rec = null; setStatus('trStatus', 'Could not start the microphone.'); }
  });

  window.ExcSpeech = { say: say, stop: stopSpeaking, translate: translate, availability: availability };
})();
