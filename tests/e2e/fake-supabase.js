/* In-memory stand-in for supabase-js, used only by the browser tests. Made-up people only.
   It does not enforce database rules; those are tested separately in tests/rls. */
(function () {
  const DB = window.__FAKE_DB__ = window.__FAKE_DB__ || JSON.parse(sessionStorage.getItem('fakedb') || 'null') || window.__SEED__;
  const save = () => sessionStorage.setItem('fakedb', JSON.stringify(DB));
  let n = 1000;
  function table(name) {
    const st = { name, filters: [], order: null, limit: null, op: 'select', payload: null };
    const run = () => {
      const rows = DB.tables[name] = DB.tables[name] || [];
      let out;
      if (st.op === 'insert') {
        const row = Object.assign({ id: 'id' + (++n), created_at: new Date().toISOString() }, defaults(name), st.payload);
        rows.unshift(row); out = [row];
      } else {
        const hit = rows.filter((r) => st.filters.every((f) => f(r)));
        if (st.op === 'update') { hit.forEach((r) => Object.assign(r, st.payload)); out = hit; }
        else out = hit.slice();
        if (st.order) out.sort((a, b) => (a[st.order.col] < b[st.order.col] ? 1 : -1) * (st.order.asc ? -1 : 1));
        if (st.limit) out = out.slice(0, st.limit);
      }
      save();
      return { data: JSON.parse(JSON.stringify(out)), error: null };
    };
    const defaults = (t) => ({
      circle_messages: { sender_id: DB.me.id, sender_name: DB.me.name },
      circle_tasks: { done: false, done_by_name: '', created_by_name: DB.me.name },
      circle_visits: { visitor_id: DB.me.id, visitor_name: DB.me.name, visited_at: new Date().toISOString() },
    }[t] || {});
    const q = {
      select() { return q; }, insert(p) { st.op = 'insert'; st.payload = p; return q; }, update(p) { st.op = 'update'; st.payload = p; return q; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return q; }, in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return q; },
      order(col, o) { st.order = { col, asc: !(o && o.ascending === false) }; return q; }, limit(k) { st.limit = k; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return q;
  }
  window.supabase = { createClient() {
    return { from: table, auth: { getSession: async () => ({ data: { session: DB.me ? { user: { id: DB.me.id, email: DB.me.email, user_metadata: { full_name: DB.me.name } } } : null } }) } };
  } };
})();
