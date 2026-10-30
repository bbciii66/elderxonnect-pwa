/* Care circle rules that do not touch the screen or the network, so they can be tested alone. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircleLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = ['admin', 'family', 'onsite', 'viewer'];
  const ROLE_LABELS = { admin: 'Administrator', family: 'Family', onsite: 'Onsite caregiver', viewer: 'View only' };
  // What each person may see. 'circle' (messages, tasks, visits) is always on.
  const SECTIONS = ['circle', 'checkins', 'reminders', 'profile', 'contacts', 'portal'];
  const SECTION_LABELS = {
    circle: 'Messages, tasks and visits', checkins: 'Check-ins (mood, pain, notes)', reminders: 'Reminders and medications',
    profile: 'Profile and medical details (includes address)', contacts: 'Contacts', portal: 'Health portal button',
  };
  const ROLE_DEFAULT_SECTIONS = {
    admin: SECTIONS.slice(), family: ['circle', 'checkins', 'reminders', 'contacts'], onsite: ['circle', 'reminders'], viewer: ['circle'],
  };
  const QUICK_MESSAGES = ['I’m okay today', 'Need help', 'Running late', 'Please call me'];
  const NUDGE_HOUR = 11;

  function canWrite(role) { return ROLES.includes(role) && role !== 'viewer'; }
  function sectionsForRole(role) { return (ROLE_DEFAULT_SECTIONS[role] || ROLE_DEFAULT_SECTIONS.viewer).slice(); }

  // May this person see a section of this circle? Mirrors the database rule; the database is what enforces it.
  function canSee(circle, section) {
    if (circle.own || circle.role === 'admin') return true;
    return Array.isArray(circle.sections) && circle.sections.includes(section);
  }

  // Own circle: 'unset' (never chosen), 'self', 'managed_pending' (admin invited, not yet accepted), 'managed'.
  function setupState(settings, accessRows) {
    if (!settings) return 'unset';
    if (settings.mode !== 'managed') return 'self';
    const active = (accessRows || []).some((r) => r.role === 'admin' && r.status === 'active');
    return active ? 'managed' : 'managed_pending';
  }

  // Who may change who is in the circle and what they see (mirrors circle_can_manage in the database).
  function canManage(circle, settings, accessRows) {
    if (circle.own) return setupState(settings, accessRows) !== 'managed';
    return circle.role === 'admin' && !!settings && settings.mode === 'managed';
  }

  // Silence must never look like "all clear": no data and old data are different from "checked in today".
  function checkinStatus(lastCheckin, now) {
    if (lastCheckin === 'not-shared') return { level: 'unknown', text: 'Check-in status is not shared with you.' };
    if (!lastCheckin || !lastCheckin.occurred_at) return { level: 'unknown', text: 'No check-in information yet. We can’t say whether all is well.' };
    const d = new Date(lastCheckin.occurred_at);
    if (Number.isNaN(d.getTime())) return { level: 'unknown', text: 'The last check-in could not be read. We can’t say whether all is well.' };
    const when = d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) {
      const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return { level: 'ok', text: 'Checked in today at ' + t + (lastCheckin.mood ? ' (' + lastCheckin.mood + ')' : '') };
    }
    if (now.getHours() >= NUDGE_HOUR) return { level: 'warn', text: 'No check-in yet today. Last check-in: ' + when + '. Consider a call.' };
    return { level: 'unknown', text: 'No check-in yet today (before ' + NUDGE_HOUR + 'am). Last: ' + when };
  }

  // Build the "whose circle?" list: my own, then each person I help, labelled by their saved name.
  function buildCircles(meId, accessRows) {
    const circles = [{ id: meId, label: 'My own circle', role: 'family', own: true }];
    (accessRows || []).forEach((r, i) => {
      if (!r || r.status !== 'active' || r.elder_id === meId) return;
      const name = (r.recipient_display_name || '').trim();
      circles.push({ id: r.elder_id, label: name || 'Person I help #' + (i + 1), role: ROLES.includes(r.role) ? r.role : 'viewer', sections: Array.isArray(r.sections) ? r.sections : ['circle'], own: false });
    });
    return circles;
  }

  // Which circle to open first: the first person I help, otherwise my own.
  function defaultCircle(circles) { return circles.length > 1 ? circles[1] : circles[0]; }

  function cleanText(value, max) {
    const s = String(value == null ? '' : value).trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function parseMinutes(value) {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : NaN;
  }

  return { ROLES, ROLE_LABELS, SECTIONS, SECTION_LABELS, ROLE_DEFAULT_SECTIONS, QUICK_MESSAGES, canWrite, sectionsForRole, canSee, setupState, canManage, checkinStatus, buildCircles, defaultCircle, cleanText, parseMinutes };
});
