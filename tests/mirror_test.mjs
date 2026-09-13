// The phase 1 dual-write mirror on an in-process Postgres: after the one-off
// import, each runtime entry point lands its change in the right table, never
// throws, reports through mirrorStatus, and stays silent when switched off.
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { applyMigrations } from '../db/migrate.mjs'
import { withOrg } from '../netlify/lib/db.mjs'
import { migrateBlobs } from '../scripts/migrate-blobs-to-pg.mjs'
import { mirror, mirrorOn, mirrorStatus, mirrorState, setMirrorClient, setSettingsReader } from '../netlify/lib/mirror.mjs'
import { BUILTIN_CLIENTS } from '../netlify/lib/clients.mjs'

// Off by default: no DATABASE_URL, no client -> every call is a cheap false.
delete process.env.DATABASE_URL
assert.equal(mirrorOn(), false)
assert.equal(await mirror.settings({ ui: { a: 1 } }), false)
assert.equal(await mirror.user({ email: 'x@y.z' }), false)

const db = new PGlite({ extensions: { citext } })
await applyMigrations(db)
await db.exec(`create role caalano_app nologin; grant usage on schema public to caalano_app;
  grant select, insert, update, delete on all tables in schema public to caalano_app;
  grant usage, select on all sequences in schema public to caalano_app; set role caalano_app`)
const builtin = { 'ablycalm': { meta: '2531025873751747', google: null, ghl: 'KQtHuOcsMrdrADDBl7vD' } }
let settings = { ui: { crmUrl: 'https://crm.example.com' }, kpis: { 'ablycalm': { cpl: 40 } }, clients: {} }
const stores = {
  'caalano-settings': { all: settings },
  'caalano-auth': { 'user:alex@example.com': { email: 'alex@example.com', name: 'Alex', role: 'superadmin', status: 'active', createdAt: '2025-01-01T00:00:00Z' } },
  'ghl-auth': { agency: { access_token: 'old' } },
}
process.env.KEK_V1 = Buffer.alloc(32, 9).toString('base64')
const r = await migrateBlobs(db, stores, { builtin })
setMirrorClient(db)
setSettingsReader(async () => settings)
assert.equal(mirrorOn(), true)

// The running mirror maps workspaces from the real built-in registry plus the
// settings, so every built-in client appears once the first save is mirrored.
const BUILTIN_GHL = Object.values(BUILTIN_CLIENTS).filter((c) => c.ghl).length
const q = (sql, p) => withOrg(r.orgId, async (tx) => (await tx.query(sql, p)).rows, { client: db })

// 1. A settings save: one changed KPI row and one new custom client with its connections.
settings = { ...settings, kpis: { ...settings.kpis, 'ablycalm': { cpl: 55 } }, clients: { 'new-clinic': { name: 'New Clinic', meta: '111', ghl: 'LOCNEW' } }, updatedAt: 'x' }
assert.equal(await mirror.settings(settings, { kpis: { 'ablycalm': { cpl: 55 } }, clients: { 'new-clinic': settings.clients['new-clinic'] } }), true)
const kpi = await q(`select value, version from workspace_settings s join workspaces w on w.id = s.workspace_id where w.slug = 'ablycalm' and section = 'kpis'`)
assert.deepEqual(kpi[0].value, { cpl: 55 }); assert.equal(kpi[0].version, 2, 'version bumped on the changed row')
const ws = await q(`select slug from workspaces order by slug`)
assert.ok(ws.some((w) => w.slug === 'new-clinic'), 'the new client became a workspace')
const conns = await q(`select provider, external_id from connections c join workspaces w on w.id = c.workspace_id where w.slug = 'new-clinic' order by external_id`)
assert.deepEqual(conns.map((c) => c.external_id), ['LOCNEW', 'facebook:111'])
const cl = await q(`select value from workspace_settings s join workspaces w on w.id = s.workspace_id where w.slug = 'new-clinic' and section = 'client'`)
assert.equal(cl[0].value.name, 'New Clinic')
// Sections not in the body are untouched: ui stays at version 1.
assert.equal((await q(`select version from org_settings where section = 'ui'`))[0].version, 1)

// 2. A user write: invite -> accept -> update -> delete.
const rep = { email: 'rep@example.com', name: 'Rep', role: 'account_user', status: 'invited', inviteToken: 'tok9', inviteExpires: Date.now() + 86400000, clients: ['new-clinic'], allClients: false, invitedBy: 'alex@example.com', createdAt: '2026-09-13T00:00:00Z' }
assert.equal(await mirror.user(rep), true)
let m = await q(`select m.role, m.status, cardinality(m.workspace_ids) as n, (select count(*)::int from invitations i where i.email = u.email and accepted_at is null) as open from memberships m join users u on u.id = m.user_id where u.email = 'rep@example.com'`)
assert.deepEqual(m, [{ role: 'account_user', status: 'invited', n: 1, open: 1 }])
assert.equal(await mirror.user({ ...rep, status: 'active', inviteToken: null, passwordHash: 'H', passwordSalt: 'S' }), true)
m = await q(`select m.status, u.password_hash, (select count(*)::int from invitations i where i.email = u.email and accepted_at is null) as open from memberships m join users u on u.id = m.user_id where u.email = 'rep@example.com'`)
assert.deepEqual(m, [{ status: 'active', password_hash: 'pbkdf2-sha256$150000$S$H', open: 0 }])
assert.equal(await mirror.userDeleted('rep@example.com'), true)
assert.equal((await q(`select count(*)::int as n from memberships m join users u on u.id = m.user_id where u.email = 'rep@example.com'`))[0].n, 0)
assert.equal((await db.query(`select count(*)::int as n from users where email = 'rep@example.com'`)).rows[0].n, 1, 'the users row stays for the audit trail')

// 3. Terms: acceptance plus the archived wording.
assert.equal(await mirror.terms({ email: 'alex@example.com', name: 'Alex', role: 'superadmin', version: '1.5', hash: 'abc', acceptedAt: '2026-09-13T01:00:00Z', signature: 'sig' }, { version: '1.5', hash: 'abc', archivedAt: '2026-09-13T01:00:00Z', doc: { title: 'T' } }), true)
assert.equal((await q(`select count(*)::int as n from terms_acceptances where email = 'alex@example.com' and user_id is not null`))[0].n, 1)
assert.equal((await db.query(`select count(*)::int as n from terms_docs where version = '1.5'`)).rows[0].n, 1)

// 4. Monthly: save, publish, unpublish.
assert.equal(await mirror.monthly('ablycalm', '2026-08', { report: { spend: 1 }, savedAt: '2026-09-01T00:00:00Z' }), true)
assert.equal(await mirror.monthly('ablycalm', '2026-08', { report: { spend: 1 }, savedAt: '2026-09-01T00:00:00Z' }, { report: { spend: 1 }, publishedAt: '2026-09-02T00:00:00Z', publishedBy: 'Alex' }), true)
let mr = await q(`select published_at is not null as pub, value->'published'->>'publishedBy' as by from monthly_reports where month = '2026-08'`)
assert.deepEqual(mr, [{ pub: true, by: 'Alex' }])
assert.equal(await mirror.monthly('ablycalm', '2026-08', { report: { spend: 1 }, savedAt: '2026-09-01T00:00:00Z' }, null), true)
mr = await q(`select published_at is not null as pub from monthly_reports where month = '2026-08'`)
assert.deepEqual(mr, [{ pub: false }])
assert.equal(await mirror.monthly('ghost', '2026-08', { report: {} }), false, 'an unknown client is a logged failure, not a throw')
assert.match(mirrorState().lastError.message, /unknown client ghost/)

// 5. The CRM token: re-sealed on every ghl connection.
assert.equal(await mirror.ghlToken({ access_token: 'new' }), true)
const { openCredential } = await import('../netlify/lib/cred.mjs')
const sealedRows = await q(`select cred_ciphertext, cred_iv, cred_tag, cred_wrapped_key, cred_kek_id from connections where provider = 'ghl'`)
assert.equal(sealedRows.length, BUILTIN_GHL + 1, 'every built-in CRM location plus the new client')
assert.ok(sealedRows.every((row) => openCredential(row).access_token === 'new'))
delete process.env.KEK_V1
assert.equal(await mirror.ghlToken({ access_token: 'x' }), false, 'no key, no write, no throw')

// 6. Status for the superadmin card.
const st = await mirrorStatus()
assert.equal(st.on, true); assert.ok(st.writes >= 6); assert.equal(st.errors, 2)
assert.equal(st.counts.workspaces, Object.keys(BUILTIN_CLIENTS).length + 1); assert.equal(st.counts.sealed_ghl, BUILTIN_GHL + 1); assert.equal(st.counts.monthly_reports, 1)
console.log('mirror_test: ok')
