// Tenant isolation, proven on a real Postgres engine (PGlite, in-process):
// the migrations apply cleanly, and with two organisations in every tenant
// table, a transaction scoped to one sees only its own rows, cannot write
// another's, sees nothing when no tenant is set, and the platform flag sees all.
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { applyMigrations, migrationStatus } from '../db/migrate.mjs'
import { withOrg, asPlatform } from '../netlify/lib/db.mjs'

const db = new PGlite({ extensions: { citext } })
const applied = await applyMigrations(db)
assert.ok(applied.length >= 2, 'migrations apply')
assert.deepEqual(await applyMigrations(db), [], 'a second run applies nothing')
assert.ok((await migrationStatus(db)).every((m) => m.applied))
assert.equal((await db.query('select count(*)::int as n from plans')).rows[0].n, 5, 'plan rows seeded')
// PGlite runs as a superuser, which bypasses row level security by design, so
// the checks below run as an ordinary role: the same footing the functions
// have on Neon (see db.mjs, which refuses to run as a superuser).
await db.exec(`create role caalano_app nologin; grant usage on schema public to caalano_app;
  grant select, insert, update, delete on all tables in schema public to caalano_app;
  grant usage, select on all sequences in schema public to caalano_app; set role caalano_app`)
assert.equal((await db.query('select current_user as u')).rows[0].u, 'caalano_app')

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const WA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', WB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
// Seed as the platform (the only way to write two organisations in one go).
await asPlatform(async (tx) => {
  await tx.query(`insert into organisations (id, slug, name, kind, plan_id) values ($1, 'a', 'Org A', 'agency', 'agency_starter'), ($2, 'b', 'Org B', 'business', 'business')`, [A, B])
  await tx.query(`insert into workspaces (id, org_id, slug, name) values ($1, $2, 'acme', 'Acme A'), ($3, $4, 'acme', 'Acme B')`, [WA, A, WB, B])
  await tx.query(`insert into workspace_settings (org_id, workspace_id, section, value) values ($1, $2, 'goals', '{"goals":[1]}'), ($3, $4, 'goals', '{"goals":[2]}')`, [A, WA, B, WB])
  await tx.query(`insert into snapshots (org_id, workspace_id, kind, value) values ($1, $2, 'opps', '[]'), ($3, $4, 'opps', '[]')`, [A, WA, B, WB])
  await tx.query(`insert into audit_log (org_id, action) values ($1, 'seed'), ($2, 'seed')`, [A, B])
}, { client: db })

// Two workspaces both called 'acme' can coexist because the key is (org, slug).
const seen = await withOrg(A, async (tx) => ({
  ws: (await tx.query('select slug, org_id from workspaces')).rows,
  settings: (await tx.query('select value from workspace_settings')).rows,
  snaps: (await tx.query('select workspace_id from snapshots')).rows,
  audit: (await tx.query('select org_id from audit_log')).rows,
}), { client: db })
assert.deepEqual(seen.ws, [{ slug: 'acme', org_id: A }], 'org A sees only its workspace')
assert.deepEqual(seen.settings, [{ value: { goals: [1] } }])
assert.deepEqual(seen.snaps, [{ workspace_id: WA }])
assert.deepEqual(seen.audit, [{ org_id: A }])
// A write that names the other organisation is refused, not just hidden.
await assert.rejects(withOrg(A, (tx) => tx.query(`insert into workspaces (org_id, slug, name) values ($1, 'x', 'X')`, [B]), { client: db }), /row-level security|policy/i)
// An update or delete aimed at the other tenant touches nothing.
const upd = await withOrg(A, (tx) => tx.query(`update workspace_settings set value = '{"goals":[9]}' where workspace_id = $1`, [WB]), { client: db })
assert.equal(upd.affectedRows ?? upd.rowCount, 0, 'cannot update the other tenant')
const del = await withOrg(A, (tx) => tx.query('delete from snapshots where workspace_id = $1', [WB]), { client: db })
assert.equal(del.affectedRows ?? del.rowCount, 0, 'cannot delete the other tenant')
// No tenant set: nothing, never everything.
assert.equal((await db.query('select count(*)::int as n from workspaces')).rows[0].n, 0, 'no org set, no rows')
// The platform flag sees both, and the tenant setting does not leak out of its transaction.
const all = await asPlatform((tx) => tx.query('select count(*)::int as n from workspaces'), { client: db })
assert.equal(all.rows[0].n, 2)
assert.equal((await db.query('select count(*)::int as n from workspace_settings')).rows[0].n, 0, 'set_config was transaction-local')
// A failed transaction rolls back and leaves the tenant unset.
await assert.rejects(withOrg(B, async (tx) => { await tx.query(`insert into audit_log (org_id, action) values ($1, 'x')`, [B]); throw new Error('boom') }, { client: db }), /boom/)
assert.equal((await asPlatform((tx) => tx.query(`select count(*)::int as n from audit_log where action = 'x'`), { client: db })).rows[0].n, 0, 'rolled back')
console.log('rls_test ok')
