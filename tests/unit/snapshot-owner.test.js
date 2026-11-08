// The profile snapshot sync must not publish this device's profile under a different signed-in account.
const test = require('node:test'); const assert = require('node:assert'); const vm = require('node:vm'); const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/../../care-recipient-profile-snapshot-sync.js', 'utf8');

async function run(userId, store) {
  const calls = [];
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const sb = { auth: { getSession: async () => ({ data: { session: { user: { id: userId } } } }) }, rpc: async (n, a) => { calls.push([n, a]); return { data: 1 }; } };
  const win = { supabase: { createClient: () => sb }, addEventListener() {}, dispatchEvent() {} };
  const ctx = { window: win, localStorage: storage, document: { readyState: 'complete', addEventListener() {} }, CustomEvent: class {},
    setTimeout: (f) => { ctx.q.push(f); }, setInterval() {}, console: { warn() {} }, q: [] };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  for (const f of ctx.q.splice(0)) await f();
  await new Promise((r) => setImmediate(r));
  return calls;
}
const base = () => ({ elderxonnect_supabase_config: '{"url":"u","key":"k"}', me_profile: '{"name":"Pat","address":"1 Made Up Rd"}' });

test('first account on the device claims the profile and syncs', async () => {
  const store = base(); const calls = await run('elder-1', store);
  assert.ok(calls.length >= 1); assert.equal(store.elderxonnect_snapshot_owner, 'elder-1');
});
test('a different signed-in account cannot publish the device profile', async () => {
  const store = { ...base(), elderxonnect_snapshot_owner: 'elder-1' };
  assert.equal((await run('caregiver-9', store)).length, 0);
});
test('the owner still syncs', async () => {
  const store = { ...base(), elderxonnect_snapshot_owner: 'elder-1' };
  assert.ok((await run('elder-1', store)).length >= 1);
});
