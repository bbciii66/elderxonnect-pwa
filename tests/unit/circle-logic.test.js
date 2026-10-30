const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../circle-logic.js');

const at = (iso) => new Date(iso);

test('viewer cannot write; unknown roles cannot write', () => {
  assert.equal(L.canWrite('family'), true);
  assert.equal(L.canWrite('onsite'), true);
  assert.equal(L.canWrite('viewer'), false);
  assert.equal(L.canWrite('admin'), false);
  assert.equal(L.canWrite(undefined), false);
});

test('no data is unknown, never a false all-clear', () => {
  assert.equal(L.checkinStatus(null, at('2026-10-30T15:00:00')).level, 'unknown');
  assert.equal(L.checkinStatus({ occurred_at: 'garbage' }, at('2026-10-30T15:00:00')).level, 'unknown');
});

test('checked in today is ok; missed after 11am warns; before 11am is only unknown', () => {
  const last = { occurred_at: '2026-10-29T09:00:00', mood: 'good' };
  assert.equal(L.checkinStatus({ occurred_at: '2026-10-30T08:30:00', mood: 'good' }, at('2026-10-30T15:00:00')).level, 'ok');
  assert.equal(L.checkinStatus(last, at('2026-10-30T11:00:00')).level, 'warn');
  assert.equal(L.checkinStatus(last, at('2026-10-30T10:59:00')).level, 'unknown');
});

test('circles use the saved name, skip inactive links, and default unknown roles to view-only', () => {
  const rows = [
    { elder_id: 'e1', status: 'active', role: 'onsite', recipient_display_name: ' Edna Testerson ' },
    { elder_id: 'e2', status: 'revoked', role: 'family' },
    { elder_id: 'e3', status: 'active', role: 'wizard' },
    { elder_id: 'me', status: 'active', role: 'family' },
  ];
  const c = L.buildCircles('me', rows);
  assert.deepEqual(c.map((x) => x.id), ['me', 'e1', 'e3']);
  assert.equal(c[1].label, 'Edna Testerson');
  assert.equal(c[2].role, 'viewer');
  assert.equal(L.defaultCircle(c).id, 'e1');
  assert.equal(L.defaultCircle(L.buildCircles('me', [])).id, 'me');
});

test('visit minutes and text are validated', () => {
  assert.equal(L.parseMinutes(''), null);
  assert.equal(L.parseMinutes('45'), 45);
  assert.ok(Number.isNaN(L.parseMinutes('0')));
  assert.ok(Number.isNaN(L.parseMinutes('1.5')));
  assert.ok(Number.isNaN(L.parseMinutes('2000')));
  assert.equal(L.cleanText('  hi  ', 10), 'hi');
  assert.equal(L.cleanText('abcdef', 3), 'abc');
  assert.equal(L.cleanText(null, 3), '');
});
