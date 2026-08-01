/* ElderXonnect runtime fixes — loaded by the service worker */
(() => {
  'use strict';

  const localDateKey = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  };

  // Correct chart grouping so local check-ins are not shifted by UTC conversion.
  window.getLast14Days = function getLast14DaysFixed() {
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        dateStr: localDateKey(d)
      });
    }
    return days;
  };

  window.buildChartData = function buildChartDataFixed() {
    const checkins = window.S?.get('checkins_v2', []) || [];
    const days = window.getLast14Days();
    const moodScores = window.MOOD_SCORES || { Great: 5, Good: 4, OK: 3, Tired: 2, Low: 1, Anxious: 1 };
    const moodData = [];
    const painData = [];

    days.forEach((day) => {
      const matches = checkins.filter((c) => localDateKey(c.ts) === day.dateStr);
      if (!matches.length) {
        moodData.push(null);
        painData.push(null);
        return;
      }
      moodData.push(matches.reduce((sum, c) => sum + (moodScores[c.mood] || 3), 0) / matches.length);
      painData.push(matches.reduce((sum, c) => sum + Number(c.pain || 0), 0) / matches.length);
    });

    return { days, moodData, painData };
  };

  // Urgent reminders already open full-screen immediately. Prevent a second
  // five-minute escalation and suppress duplicate overlays for the same alert.
  if (typeof window.showBanner === 'function') {
    const originalShowBanner = window.showBanner;
    window.showBanner = function showBannerFixed(title, msg, urgent = false) {
      return originalShowBanner(title, msg, urgent, null);
    };
  }

  if (typeof window.showUrgentOverlay === 'function') {
    const originalShowUrgentOverlay = window.showUrgentOverlay;
    let activeAlertKey = '';
    window.showUrgentOverlay = function showUrgentOverlayFixed(title, body) {
      const overlay = document.getElementById('urgentOverlay');
      const key = `${title}|${body}`;
      if (overlay && !overlay.classList.contains('hidden') && activeAlertKey === key) return;
      activeAlertKey = key;
      return originalShowUrgentOverlay(title, body);
    };

    document.getElementById('urgentDismiss')?.addEventListener('click', () => {
      activeAlertKey = '';
      if (window.urgentEscalationTimers) {
        Object.values(window.urgentEscalationTimers).forEach((timer) => clearTimeout(timer));
        Object.keys(window.urgentEscalationTimers).forEach((key) => delete window.urgentEscalationTimers[key]);
      }
    });
  }

  // Render chat messages as text. Only the app's trusted typing animation uses HTML.
  window.addBubble = function addBubbleSafe(content, cls, id) {
    const log = document.getElementById('chatLog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `bubble ${cls}`;
    if (id) div.id = id;

    const isTypingIndicator = Boolean(id) && String(cls).includes('typing');
    if (isTypingIndicator) {
      div.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    } else {
      div.textContent = String(content ?? '');
    }

    log.appendChild(div);
    log.scrollTop = log.scrollHeight;

    if (cls === 'ai' && !id && typeof window.speak === 'function') {
      const text = div.textContent.trim();
      if (text) setTimeout(() => window.speak(text), 100);
    }
  };

  // Make the limitations of browser-only reminders explicit.
  const status = document.getElementById('notifPermStatus');
  if (status) {
    const warning = document.createElement('div');
    warning.style.marginTop = '6px';
    warning.style.color = 'var(--gold)';
    warning.textContent = 'Reminder alerts require ElderXonnect to remain open or active. Background delivery is not yet guaranteed.';
    status.insertAdjacentElement('afterend', warning);
  }

  // Prevent unbounded legacy fired_* entries from accumulating.
  try {
    const cutoff = Date.now() - (3 * 24 * 60 * 60 * 1000);
    Object.keys(localStorage).forEach((key) => {
      if (!key.startsWith('fired_')) return;
      const parts = key.split('_');
      const created = Number(parts[1]);
      if (!Number.isFinite(created) || created < cutoff) localStorage.removeItem(key);
    });
  } catch (error) {
    console.warn('Unable to clean old reminder flags:', error);
  }

  // Report service-worker failures instead of silently hiding them.
  window.addEventListener('load', async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.error('ElderXonnect service worker failed:', error);
    }
  });

  if (typeof window.refreshChart === 'function') window.refreshChart();
})();
