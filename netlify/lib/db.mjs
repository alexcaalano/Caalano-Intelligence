// The one way to talk to Postgres from a function: a transaction with the
// tenant set, so row level security scopes every statement inside it.
//
//   await withOrg(orgId, async (tx) => { const r = await tx.query('select ...', [..]); ... })
//   await asPlatform(async (tx) => ...)   // platform console only, audited by the caller
//
// A missing or foreign org_id yields no rows, never someone else's. The pool
// is created lazily from DATABASE_URL; tests pass their own client (an
// in-process Postgres) as opts.client.
let _pool = null
async function pool() {
  if (_pool) return _pool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { default: pg } = await import('pg')
  _pool = new pg.Pool({ connectionString: url, max: 4, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } })
  // A superuser or a BYPASSRLS role ignores the policies, which would make
  // every query below a cross-tenant read. Refuse rather than run unsafely.
  const r = await _pool.query('select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user')
  if (r.rows[0] && r.rows[0].bypass) { const p = _pool; _pool = null; await p.end(); throw new Error('DATABASE_URL connects as a role that bypasses row level security; use an ordinary role') }
  return _pool
}
async function transaction(client, settings, fn) {
  await client.query('begin')
  try {
    for (const [k, v] of settings) await client.query('select set_config($1, $2, true)', [k, v])
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) { try { await client.query('rollback') } catch { /* already gone */ } throw e }
}
export async function withOrg(orgId, fn, opts = {}) {
  if (!orgId) throw new Error('withOrg: orgId is required')
  if (opts.client) return transaction(opts.client, [['app.org_id', String(orgId)]], fn)
  const c = await (await pool()).connect()
  try { return await transaction(c, [['app.org_id', String(orgId)]], fn) } finally { c.release() }
}
export async function asPlatform(fn, opts = {}) {
  if (opts.client) return transaction(opts.client, [['app.platform_admin', 'true']], fn)
  const c = await (await pool()).connect()
  try { return await transaction(c, [['app.platform_admin', 'true']], fn) } finally { c.release() }
}
export async function endPool() { if (_pool) { await _pool.end(); _pool = null } }
