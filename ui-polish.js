/* ElderXonnect screen polish: the calm home summary, tidy Me tab, and safer deletes.
   Runs after the older add-on scripts and only rearranges what they draw; it never changes saved data. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hhmm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // Pure helpers (also used by the tests).
  function dueToday(r, now) {
    var type = r && r.scheduleType || 'daily';
    if (type === 'once') return r.scheduleDate === ymd(now);
    if (type === 'weekly') return (r.scheduleDays || []).map(Number).indexOf(now.getDay()) !== -1;
    return true;
  }
  function reminderTime(r) { return String(r && (r.scheduleTime || r.time) || ''); }
  function todaysReminders(list, now) {
    return (Array.isArray(list) ? list : []).filter(function (r) { return r && dueToday(r, now); })
      .sort(function (a, b) { return reminderTime(a).localeCompare(reminderTime(b)); });
  }
  function greeting(now) {
    var h = now.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  function checkedInToday(list, now) {
    var last = Array.isArray(list) && list[0];
    return !!(last && last.ts && ymd(new Date(last.ts)) === ymd(now));
  }
  function telHref(phone) { var digits = String(phone || '').replace(/[^\d+]/g, ''); return digits ? 'tel:' + digits : ''; }
  function niceTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return '';
    var d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  window.ExcHome = { dueToday: dueToday, todaysReminders: todaysReminders, greeting: greeting, checkedInToday: checkedInToday, telHref: telHref };

  function firstName() {
    var p = read('me_profile', {}) || {}, s = read('auth_session', null) || {};
    return String(p.name || s.name || '').trim().split(/\s+/)[0] || '';
  }

  function refreshHome() {
    var now = new Date();
    var title = $('helloTitle');
    if (title) { var n = firstName(); title.textContent = greeting(now) + (n ? ', ' + n : ''); }

    var done = checkedInToday(read('checkins_v2', []), now);
    var hero = $('checkinHeroCard'); if (hero) hero.classList.toggle('done', done);
    var prompt = $('checkinPrompt'); if (prompt) prompt.textContent = done ? 'You checked in today ✓' : 'How are you feeling today?';
    var heroBtn = $('checkinHeroBtn'); if (heroBtn) heroBtn.textContent = done ? 'Check in again' : 'Check In';

    var ul = $('todayList'), empty = $('todayEmpty');
    if (ul && empty) {
      var items = todaysReminders(read('reminders', []), now), nowKey = hhmm(now);
      ul.innerHTML = items.map(function (r) {
        var t = reminderTime(r), past = t && t < nowKey;
        return '<li class="' + (past ? 'past' : '') + '"><span class="ti" aria-hidden="true">' + esc(r.cat || '⭐') + '</span>' +
          '<span class="tt">' + esc(r.title) + '</span><span class="tm">' + esc(niceTime(t)) + '</span></li>';
      }).join('');
      empty.hidden = items.length > 0;
    }

    var p = read('me_profile', {}) || {}, call = $('homeCallBtn');
    if (call) {
      var href = telHref(p.caregiverPhone);
      call.hidden = !href;
      if (href) {
        call.querySelector('.call-name').textContent = 'Call ' + (String(p.caregiverName || '').trim() || 'my caregiver');
        call.onclick = function () { window.location.href = href; };
      }
    }
  }

  // Me tab: the elder's own things stay on top; setup tools for family helpers fold away.
  var KEEP_ON_ME = { meHero: 1, caregiverBtnWrap: 1, appearanceCard: 1, meInfoCard: 1, cloudSyncCard: 1, caregivingSlot: 1, helperSettings: 1 };
  function organizeMe() {
    var me = $('view-me'), slot = $('helperSlot'), helpers = $('helperSettings');
    if (!me || !slot || !helpers) return;
    Array.prototype.slice.call(me.children).forEach(function (el) {
      if (!KEEP_ON_ME[el.id] && el.tagName !== 'SCRIPT') slot.appendChild(el);
    });
    var slotEl = $('caregivingSlot');
    if (slotEl && helpers.previousElementSibling !== slotEl) me.insertBefore(slotEl, helpers);
    if (me.lastElementChild !== helpers) me.appendChild(helpers);
    var cloud = $('cloudSyncCard');
    if (cloud && !cloud.dataset.polished) polishCloud(cloud);
    var sw = $('elderxonnectCaregivingSwitch');
    if (sw && slotEl && sw.parentElement !== slotEl) {
      sw.removeAttribute('style');
      sw.className = 'btn ghost';
      sw.textContent = '👥 Switch to caregiving';
      slotEl.appendChild(sw);
    }
  }

  // The connection settings are filled in already; keep them out of the elder's way.
  function polishCloud(card) {
    card.dataset.polished = '1';
    var url = $('sbUrl'), save = $('saveSbConfig');
    if (url && save && url.previousElementSibling && url.parentElement === card) {
      var start = url.previousElementSibling, box = document.createElement('details');
      box.className = 'sub-details';
      box.innerHTML = '<summary>Connection settings (already set up)</summary>';
      card.insertBefore(box, start);
      var node = start;
      while (node) { var next = node.nextElementSibling; box.appendChild(node); if (node === save) break; node = next; }
    }
    var useCloud = $('cloudUseCloud');
    var grid = useCloud && useCloud.parentElement;
    if (grid && grid.parentElement === card) {
      var more = document.createElement('details');
      more.className = 'sub-details';
      more.innerHTML = '<summary>More sync options</summary>';
      card.insertBefore(more, grid);
      more.appendChild(grid);
    }
  }

  // Ask before deleting a reminder or a person; a stray tap should not lose anything.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('#remList button, #contactList button');
    if (!btn) return;
    var label = (btn.textContent || '').trim();
    var isDelete = /✕|×|🗑|delete|remove/i.test(label) || btn.dataset.idx != null && !/📞/.test(label);
    if (!isDelete) return;
    var what = btn.closest('#remList') ? 'this reminder' : 'this person';
    if (!window.confirm('Delete ' + what + '?')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // After adding a reminder or a person, fold the form away again.
  document.addEventListener('click', function (e) {
    var add = e.target.closest && e.target.closest('#addReminderBtn, #addContactBtn');
    if (!add) return;
    setTimeout(function () {
      var card = add.closest('details');
      var field = add.id === 'addReminderBtn' ? $('remTitle') : $('cName');
      if (card && field && !field.value) card.open = false;
      refreshHome();
    }, 80);
  });

  document.addEventListener('click', function (e) {
    var go = e.target.closest && e.target.closest('[data-go]');
    if (go && typeof window.showTab === 'function') { window.showTab(go.getAttribute('data-go')); window.scrollTo(0, 0); }
    var drawerText = e.target.closest && e.target.closest('#bigTextBtnDrawer');
    if (drawerText) setTimeout(refreshHome, 0);
    var saveCheckin = e.target.closest && e.target.closest('#saveCheckinBtn, #saveMeBtn');
    if (saveCheckin) setTimeout(refreshHome, 80);
  });

  // The reminder warning belongs under the list, as a short plain note.
  function tidyReminders() {
    var warn = $('backgroundReminderWarning'), empty = $('remEmpty');
    if (!warn || !empty || warn.dataset.polished) return;
    warn.dataset.polished = '1';
    warn.removeAttribute('style');
    warn.className = 'rem-note';
    warn.textContent = 'Alerts sound while ElderXonnect is open on this phone.';
    empty.insertAdjacentElement('afterend', warn);
  }

  function markTabs(name) {
    document.querySelectorAll('.tabbtn').forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  function boot() {
    if (typeof window.showTab === 'function' && !window.showTab.__polished) {
      var original = window.showTab;
      var wrapped = function (name) { original(name); markTabs(name); if (name === 'home') refreshHome(); if (name === 'me') organizeMe(); if (name === 'reminders') tidyReminders(); };
      wrapped.__polished = true;
      window.showTab = wrapped;
    }
    markTabs('home');

    var history = $('historyCard');
    if (history) history.addEventListener('toggle', function () { if (history.open && typeof window.refreshChart === 'function') window.refreshChart(); });

    var pending = false;
    var schedule = function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; organizeMe(); });
    };
    var me = $('view-me'), header = document.querySelector('#mainApp header');
    if (me) new MutationObserver(schedule).observe(me, { childList: true });
    if (header) new MutationObserver(schedule).observe(header, { childList: true });

    organizeMe();
    tidyReminders();
    refreshHome();
    window.addEventListener('storage', refreshHome);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshHome(); });
    setInterval(refreshHome, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
