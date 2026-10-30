// Decides when a family member should get a "no check-in yet today" nudge.
// Pure functions only, so `npm test` can check them without Deno, Supabase or a clock.

export const ALERT_HOUR = 11;          // local hour after which a missing check-in is worth a nudge
export const MAX_QUIET_DAYS = 7;       // stop nudging if the elder has been silent this long (app likely abandoned)

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch { return false; }
}

// Calendar day (YYYY-MM-DD) and hour of an instant in a given time zone.
export function localParts(date, tz) {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

// lastCheckinAt: ISO string or null. Returns { alert, day, reason }.
export function checkinAlertDecision({ lastCheckinAt, now, tz }) {
  const nowParts = localParts(now, tz);
  if (nowParts.hour < ALERT_HOUR) return { alert: false, day: nowParts.day, reason: 'too-early' };
  if (!lastCheckinAt) return { alert: false, day: nowParts.day, reason: 'never-checked-in' };
  const last = new Date(lastCheckinAt);
  if (Number.isNaN(last.getTime())) return { alert: false, day: nowParts.day, reason: 'unreadable' };
  if (localParts(last, tz).day === nowParts.day) return { alert: false, day: nowParts.day, reason: 'checked-in-today' };
  if (now.getTime() - last.getTime() > MAX_QUIET_DAYS * 86400000) return { alert: false, day: nowParts.day, reason: 'long-quiet' };
  return { alert: true, day: nowParts.day, reason: 'missed' };
}

// Notification text. The name comes from the elder's own profile, so keep it short and plain.
export function alertMessage(elderName) {
  const name = String(elderName || '').replace(/[\r\n<>]+/g, ' ').trim().slice(0, 60) || 'Someone you help';
  return { title: 'No check-in yet today', body: `${name} hasn't checked in yet today. Consider a call.`, url: '/circle.html' };
}

// Constant-time comparison for the shared secret that protects the function.
export function safeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0 && x.length > 0;
}

// Who may be nudged about an elder. Membership is the gate: only people with an ACTIVE link in the
// elder's circle count (revoked and pending never do). If the admin/permission model later limits who
// sees check-ins, change only this function; the sender calls nothing else to decide.
export function mayReceiveAlert(link) {
  return !!link && link.status === 'active' && ['family', 'onsite', 'viewer'].includes(link.role);
}
