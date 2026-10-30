const test = require('node:test');
const assert = require('node:assert');
const load = () => import('../../supabase/functions/send-checkin-alerts/alert-logic.mjs');
const TZ = 'America/Chicago';
const at = (iso) => new Date(iso);

test('no nudge before 11am local, even with no check-in', async () => {
  const { checkinAlertDecision } = await load();
  // 10:30 Chicago (CDT) on Oct 30
  const d = checkinAlertDecision({ lastCheckinAt: '2026-10-29T15:00:00Z', now: at('2026-10-30T15:30:00Z'), tz: TZ });
  assert.strictEqual(d.alert, false); assert.strictEqual(d.reason, 'too-early');
});

test('nudge after 11am when last check-in was a previous local day', async () => {
  const { checkinAlertDecision } = await load();
  const d = checkinAlertDecision({ lastCheckinAt: '2026-10-29T15:00:00Z', now: at('2026-10-30T17:00:00Z'), tz: TZ });
  assert.deepStrictEqual([d.alert, d.day], [true, '2026-10-30']);
});

test('no nudge once checked in today (local day, not UTC day)', async () => {
  const { checkinAlertDecision } = await load();
  // 11pm Oct 29 Chicago is already Oct 30 in UTC; a 9am Oct 30 check-in is "today" locally
  const d = checkinAlertDecision({ lastCheckinAt: '2026-10-30T14:00:00Z', now: at('2026-10-30T18:00:00Z'), tz: TZ });
  assert.strictEqual(d.reason, 'checked-in-today');
  const late = checkinAlertDecision({ lastCheckinAt: '2026-10-30T04:30:00Z', now: at('2026-10-30T18:00:00Z'), tz: TZ });
  assert.strictEqual(late.alert, true); // 11:30pm Oct 29 locally is yesterday
});

test('never alerts for someone with no check-ins, unreadable dates, or a week of silence', async () => {
  const { checkinAlertDecision } = await load();
  const now = at('2026-10-30T18:00:00Z');
  assert.strictEqual(checkinAlertDecision({ lastCheckinAt: null, now, tz: TZ }).alert, false);
  assert.strictEqual(checkinAlertDecision({ lastCheckinAt: 'nope', now, tz: TZ }).alert, false);
  assert.strictEqual(checkinAlertDecision({ lastCheckinAt: '2026-10-01T15:00:00Z', now, tz: TZ }).reason, 'long-quiet');
});

test('bad time zone falls back to UTC instead of throwing', async () => {
  const { localParts, isValidTimeZone } = await load();
  assert.strictEqual(isValidTimeZone('Not/AZone'), false);
  assert.strictEqual(localParts(at('2026-10-30T12:00:00Z'), 'Not/AZone').hour, 12);
});

test('message is plain text with a fallback name, and the shared secret check is exact', async () => {
  const { alertMessage, safeEqual } = await load();
  assert.ok(!alertMessage('<b>x</b>\nBcc').body.includes('<'));
  assert.ok(alertMessage('').body.startsWith('Someone you help'));
  assert.strictEqual(safeEqual('abc', 'abc'), true);
  for (const bad of [['abc', 'abd'], ['abc', 'abcd'], ['', ''], [null, null], ['abc', undefined]]) assert.strictEqual(safeEqual(...bad), false);
});

test('only active circle members may be nudged', async () => {
  const { mayReceiveAlert } = await load();
  assert.strictEqual(mayReceiveAlert({ status: 'active', role: 'family' }), true);
  assert.strictEqual(mayReceiveAlert({ status: 'active', role: 'viewer' }), true);
  for (const bad of [{ status: 'revoked', role: 'family' }, { status: 'pending', role: 'family' }, { status: 'active', role: 'stranger' }, null])
    assert.strictEqual(mayReceiveAlert(bad), false);
});
