// A caregiver's screen must not keep showing a recipient's profile after access ended or the profile stopped being shared.
const test = require('node:test'); const assert = require('node:assert'); const vm = require('node:vm'); const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/../../caregiver-profile-snapshot.js', 'utf8');

function el(extra) {
  const e = Object.assign({ children: [], dataset: {}, textContent: '', className: '', classList: { contains: () => false },
    get childElementCount() { return this.children.length; }, get firstElementChild() { return this.children[0] || null; },
    replaceChildren(...k) { this.children = k.flat().flatMap((x) => (x && x.__fragment ? x.children : [x])); },
    append(...k) { this.children.push(...k); }, appendChild(k) { this.children.push(k); return k; }, querySelector: () => null, querySelectorAll: () => [] }, extra);
  return e;
}

async function run(rows) {
  const profile = el(), personName = el({ textContent: 'Pat Example — Care Overview' }), select = el({ value: 'elder-1', options: [] });
  profile.children = [el({ textContent: 'old copy of the profile' }), el()];
  const byId = { profile, personName, elderSelect: select, portal: el() };
  const timers = [];
  const doc = { readyState: 'complete', addEventListener() {}, getElementById: (id) => byId[id] || null, createElement: () => el(), createDocumentFragment: () => Object.assign(el(), { __fragment: true }),
    querySelectorAll: () => [], querySelector: () => null, body: {} };
  const ctx = { document: doc, sessionStorage: { getItem: () => '', setItem() {} }, console: { warn() {} }, MutationObserver: class { observe() {} },
    setTimeout: (f) => { timers.push(f); return 1; }, clearTimeout() {}, setInterval() {}, window: {}, client: { from: () => ({ select: () => ({ eq: async () => ({ data: typeof rows === 'function' ? rows() : rows, error: null }) }) }) } };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  for (let i = 0; i < 3; i++) for (const f of timers.splice(0)) await f();
  await new Promise((r) => setImmediate(r));
  return { profile, personName };
}

test('a revoked caregiver does not keep seeing the earlier copy of the profile', async () => {
  let calls = 0; // first read: access is active; every later read: access has ended
  const active = [{ elder_id: 'elder-1', status: 'active', recipient_display_name: 'Pat Example', recipient_profile: { name: 'Pat Example' } }];
  const { profile, personName } = await run(() => (++calls === 1 ? active : []));
  assert.strictEqual(profile.children.length, 1);
  assert.strictEqual(profile.children[0].textContent, 'No profile is shared with you.');
  assert.strictEqual(personName.textContent, 'Care Overview');
});

test('a recipient never shared with this caregiver does not trigger the message', async () => {
  const { profile } = await run([]);
  assert.strictEqual(profile.children.length, 2); // left as drawn; nothing was ever held
});

test('a shared profile is still shown while access is active', async () => {
  const { profile, personName } = await run([{ elder_id: 'elder-1', status: 'active', recipient_display_name: 'Pat Example', recipient_profile: { name: 'Pat Example', blood: 'O+' } }]);
  assert.ok(profile.children.length >= 10);
  assert.ok(personName.textContent.includes('Pat Example'));
});
