// Appearance: Auto (follows the phone), Light or Dark. Runs in <head> so the page never flashes the wrong colors.
(function () {
  var KEY = 'exc-theme', root = document.documentElement;
  function stored() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function resolved(mode) {
    if (mode !== 'auto') return mode;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function apply(mode) {
    var t = resolved(mode);
    root.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#dde4ee' : '#1a6b4a');
  }
  function set(mode) {
    try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) {}
    apply(mode); mark();
  }
  function mark() {
    var m = stored(), btns = document.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-theme-choice') === m));
  }
  apply(stored());
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)'), onChange = function () { if (stored() === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var hosts = document.querySelectorAll('[data-theme-control]');
    for (var i = 0; i < hosts.length; i++) {
      hosts[i].innerHTML = '<div class="theme-picker" role="group" aria-label="Appearance">' +
        '<button type="button" data-theme-choice="auto">Auto</button>' +
        '<button type="button" data-theme-choice="light">☀️ Light</button>' +
        '<button type="button" data-theme-choice="dark">🌙 Dark</button></div>';
      hosts[i].addEventListener('click', function (e) { var c = e.target.closest && e.target.closest('[data-theme-choice]'); if (c) set(c.getAttribute('data-theme-choice')); });
    }
    mark();
  });
  window.ExcTheme = { set: set, get: stored };
})();
