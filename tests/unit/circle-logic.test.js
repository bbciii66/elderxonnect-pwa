const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../circle-logic.js');

const at = (iso) => new Date(iso);

test('viewer cannot write; unknown roles cannot write', () => {
  assert.equal(L.canWrite('family'), true);
  assert.equal(L.canWrite('onsite'), true);
  assert.equal(L.canWrite('viewer'), false);
  assert.equal(L.canWrite('wizard'), false);
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

test('roles include administrator; defaults match the design', () => {
  assert.deepEqual(L.sectionsForRole('viewer'), ['circle']);
  assert.deepEqual(L.sectionsForRole('onsite'), ['circle', 'reminders']);
  assert.ok(L.sectionsForRole('family').includes('checkins') && !L.sectionsForRole('family').includes('profile'));
  assert.deepEqual(L.sectionsForRole('admin'), L.SECTIONS);
  assert.deepEqual(L.sectionsForRole('nonsense'), ['circle']);
  assert.equal(L.canWrite('admin'), true);
});

test('what a person can see follows their sections; admins and owners see everything', () => {
  assert.equal(L.canSee({ own: true }, 'profile'), true);
  assert.equal(L.canSee({ role: 'admin', sections: ['circle'] }, 'portal'), true);
  assert.equal(L.canSee({ role: 'family', sections: ['circle', 'checkins'] }, 'checkins'), true);
  assert.equal(L.canSee({ role: 'family', sections: ['circle', 'checkins'] }, 'profile'), false);
  assert.equal(L.canSee({ role: 'viewer' }, 'checkins'), false);
});

test('check-in status says "not shared" instead of looking like silence', () => {
  const s = L.checkinStatus('not-shared', at('2026-10-30T15:00:00'));
  assert.equal(s.level, 'unknown');
  assert.match(s.text, /not shared/);
});

test('setup state: unset, self, pending administrator, managed', () => {
  const admin = (status) => [{ role: 'admin', status }];
  assert.equal(L.setupState(null, []), 'unset');
  assert.equal(L.setupState({ mode: 'self' }, admin('active')), 'self');
  assert.equal(L.setupState({ mode: 'managed' }, admin('pending')), 'managed_pending');
  assert.equal(L.setupState({ mode: 'managed' }, []), 'managed_pending');
  assert.equal(L.setupState({ mode: 'managed' }, admin('active')), 'managed');
});

test('who may manage: elder until an administrator accepts; then only administrators', () => {
  const own = { own: true };
  const act = [{ role: 'admin', status: 'active' }], pend = [{ role: 'admin', status: 'pending' }];
  assert.equal(L.canManage(own, null, []), true);
  assert.equal(L.canManage(own, { mode: 'managed' }, pend), true);
  assert.equal(L.canManage(own, { mode: 'managed' }, act), false);
  assert.equal(L.canManage({ role: 'admin' }, { mode: 'managed' }, act), true);
  assert.equal(L.canManage({ role: 'admin' }, { mode: 'self' }, act), false);
  assert.equal(L.canManage({ role: 'family' }, { mode: 'managed' }, act), false);
});
