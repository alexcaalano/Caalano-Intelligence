// The Blobs-to-Postgres migration, end to end on an in-process Postgres: a
// backup-shaped fixture becomes the organisation, workspaces, connections,
// users, memberships, settings, terms, snapshots, reports, live events and
// logs; a dry run writes nothing; a second run changes nothing; and the rows
// are reachable through the tenant transaction under row level security.
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { applyMigrations } from '../db/migrate.mjs'
import { withOrg } from '../netlify/lib/db.mjs'
import { migrateBlobs, storesFromBackup, formatReport } from '../scripts/migrate-blobs-to-pg.mjs'

const db = new PGlite({ extensions: { citext } })
await applyMigrations(db)
await db.exec(`create role caalano_app nologin; grant usage on schema public to caalano_app;
  grant select, insert, update, delete on all tables in schema public to caalano_app;
  grant usage, select on all sequences in schema public to caalano_app; set role caalano_app`)

const builtin = { 'ablycalm': { meta: '2531025873751747', google: null, ghl: 'KQtHuOcsMrdrADDBl7vD' }, 'pool-haus': { meta: '722206724104428', google: '881-120-8709', ghl: 'bKfWIXrhM5jei4QV5KXs' } }
const backup = { format: 'caalano360-backup/2', at: '2026-09-13T00:00:00Z', stores: {
  'caalano-settings': { data: { all: {
    clients: { 'new-clinic': { name: 'New Clinic', meta: '111', ghl: 'LOCNEW', ghlName: 'New Clinic CRM' }, 'old-one': { name: 'Old', meta: '222', _deleted: true } },
    kpis: { 'ablycalm': { cpl: 40 }, 'pool-haus': { cpl: 90 } },
    goals: { 'new-clinic': { goals: [{ id: 'g1' }] } },
    ui: { crmUrl: 'https://crm.caalano.com.au' },
    insights: { tone: 'plain' },
    enabled: { 'ablycalm': true, 'pool-haus': false, 'not-a-client': true },
    empty: {},
  } } },
  'caalano-auth': { data: {
    'user:alex@example.com': { email: 'alex@example.com', name: 'Alex', role: 'superadmin', status: 'active', passwordHash: 'H', passwordSalt: 'S', createdAt: '2025-01-01T00:00:00Z', lastLogin: '2026-09-01T00:00:00Z', termsVersion: '1.5', termsAcceptedAt: '2026-01-01T00:00:00Z', clients: [], allClients: true },
    'user:viewer@example.com': { email: 'viewer@example.com', name: 'Vee', role: 'viewer', status: 'active', clients: ['ablycalm', 'ghost'], allClients: false, tabs: ['overview', 'actions'], reports: true, crmUsers: { ablycalm: 'CRM1' } },
    'user:rep@example.com': { email: 'rep@example.com', name: 'Rep', role: 'account_user', status: 'invited', inviteToken: 'tok123', clients: ['pool-haus'], allClients: false, invitedBy: 'alex@example.com' },
    'user:odd@example.com': { email: 'odd@example.com', name: 'Odd', role: 'wizard', status: 'active' },
    'invite:tok123': { email: 'rep@example.com', expires: 4102444800000 },
  } },
  'caalano-terms': { data: {
    live: { version: '1.6', title: 'Custom terms' },
    'doc_1.5_abc': { version: '1.5', hash: 'abc', archivedAt: '2026-01-01T00:00:00Z', doc: { title: 'T' } },
    't_alex@example.com': { acceptances: [{ email: 'alex@example.com', name: 'Alex', role: 'superadmin', version: '1.5', hash: 'abc', acceptedAt: '2026-01-01T00:00:00Z', signature: 'data:image/png;base64,AA==' }] },
  } },
  'caalano-health': { data: { 'ablycalm': { days: { '2026-09-01': { composite: 80 } } }, 'stranger': { days: {} } } },
  'caalano-clinic': { data: { 'pool-haus': { days: { '2026-09-01': { ltv: 1 } } } } },
  'caalano-social': { data: { 'pool-haus': { ig: { followers: 10 } } } },
  'caalano-monthly': { data: {
    'ablycalm:2026-08': { client: 'ablycalm', month: '2026-08', report: { spend: 1 }, savedAt: '2026-09-02T00:00:00Z' },
    'pub:ablycalm:2026-08': { client: 'ablycalm', month: '2026-08', report: { spend: 1 }, publishedAt: '2026-09-03T00:00:00Z', publishedBy: 'alex@example.com' },
    'ablycalm:2026-07': { client: 'ablycalm', month: '2026-07', report: { spend: 2 }, savedAt: '2026-08-02T00:00:00Z' },
    'index:ablycalm': ['2026-08', '2026-07'], 'meta:ablycalm': {}, 'pubindex:ablycalm': ['2026-08'],
  } },
  'caalano-live': { data: { 'live:KQtHuOcsMrdrADDBl7vD': { at: 1, events: [{ id: 'won:1:won', kind: 'won', at: 1757700000000, name: 'Deal' }, { id: 'lead:2', kind: 'lead', at: 1757700001000 }] }, 'live:UNKNOWN': { at: 1, events: [{ id: 'x', kind: 'lead', at: 1 }] } } },
  'caalano-audit': { data: { 'audit:2026-09-01': [{ view: 'overview', client: 'ablycalm', user: 'alex@example.com', t: 1756684800000 }, { kind: 'crm-write', client: 'pool-haus', user: 'viewer@example.com', t: 1756684900000 }], 'audit:index': ['2026-09-01'] } },
  'caalano-diag': { data: { 'diag:2026-09-01:00001756684800000-abc': { t: 1756684800000, sev: 'error', scope: 'saleshub', client: 'ablycalm', ms: 1200, error: 'boom' }, 'diag:index': ['2026-09-01'] } },
  'ghl-auth': { data: { agency: { access_token: 'secret', refresh_token: 'r' } } },
} }
const stores = storesFromBackup(backup)
assert.equal(Object.keys(stores).length, 11)

// A dry run reports and writes nothing.
const dry = await migrateBlobs(db, stores, { dry: true, builtin })
assert.equal(dry.dry, true)
assert.equal(dry.counts.workspaces, 3, 'two built-in plus one custom')
assert.equal(dry.counts.workspaces_deleted, 1)
assert.equal(dry.owner, 'alex@example.com')
assert.equal((await db.query('select count(*)::int as n from organisations')).rows[0].n, 0, 'dry run rolled back')
assert.ok(formatReport(dry).startsWith('DRY RUN'))

// The real run.
process.env.KEK_V1 = Buffer.alloc(32, 7).toString('base64')
const r = await migrateBlobs(db, stores, { builtin })
delete process.env.KEK_V1
assert.equal(r.counts.users, 4)
assert.equal(r.counts.memberships, 3, 'the unknown role is skipped')
assert.ok(r.warnings.some((w) => /odd@example.com.*wizard/.test(w)))
assert.ok(r.warnings.some((w) => /viewer@example.com: unknown client ghost/.test(w)))
assert.ok(r.warnings.some((w) => /section enabled mixes/.test(w)))
assert.equal(r.counts.connections_windsor, 4, 'meta x3 + google x1')
assert.equal(r.counts.connections_ghl, 3)
assert.equal(r.counts.invitations, 1)
assert.equal(r.counts.workspace_settings, 2 + 1 + 2, 'kpis x2, goals x1, client records x2 (deleted one too)')
assert.equal(r.counts.org_settings, 4, 'ui, insights, enabled (mixed) and the live terms')
assert.equal(r.counts.terms_docs, 1)
assert.equal(r.counts.terms_acceptances, 1)
assert.equal(r.counts.snapshots_health, 1); assert.equal(r.counts.health_skipped, 1)
assert.equal(r.counts.snapshots_clinic, 1); assert.equal(r.counts.social_cache, 1)
assert.equal(r.counts.monthly_reports, 2)
assert.equal(r.counts.live_events, 2); assert.equal(r.counts.live_skipped, 1)
assert.equal(r.counts.audit_log, 2); assert.equal(r.counts.diag_log, 1)

// Reachable through the tenant transaction, scoped by row level security.
const seen = await withOrg(r.orgId, async (tx) => ({
  ws: (await tx.query('select slug, name, deleted_at is not null as gone from workspaces order by slug')).rows,
  conns: (await tx.query(`select w.slug, c.provider, c.external_id, c.cred_kek_id from connections c join workspaces w on w.id = c.workspace_id order by w.slug, c.external_id`)).rows,
  members: (await tx.query(`select u.email, m.role, m.status, m.tabs, m.reports, m.crm_user_id, cardinality(m.workspace_ids) as n from memberships m join users u on u.id = m.user_id order by u.email`)).rows,
  wsSettings: (await tx.query(`select w.slug, s.section, s.value, s.version from workspace_settings s join workspaces w on w.id = s.workspace_id order by w.slug, s.section`)).rows,
  orgSettings: (await tx.query('select section, value from org_settings order by section')).rows,
  monthly: (await tx.query('select month, published_at is not null as pub, value from monthly_reports order by month')).rows,
  live: (await tx.query('select event_id, kind from live_events order by at')).rows,
  audit: (await tx.query('select action, user_id is not null as who, workspace_id is not null as ws from audit_log order by at')).rows,
  terms: (await tx.query('select email, version, signature is not null as signed from terms_acceptances')).rows,
}), { client: db })
assert.deepEqual(seen.ws.map((w) => [w.slug, w.gone]), [['ablycalm', false], ['new-clinic', false], ['old-one', true], ['pool-haus', false]])
assert.equal(seen.ws.find((w) => w.slug === 'new-clinic').name, 'New Clinic')
assert.deepEqual(seen.conns.map((c) => `${c.slug} ${c.provider} ${c.external_id}`), [
  'ablycalm ghl KQtHuOcsMrdrADDBl7vD', 'ablycalm windsor facebook:2531025873751747',
  'new-clinic ghl LOCNEW', 'new-clinic windsor facebook:111',
  'pool-haus ghl bKfWIXrhM5jei4QV5KXs', 'pool-haus windsor facebook:722206724104428', 'pool-haus windsor google_ads:881-120-8709'])
assert.ok(seen.conns.filter((c) => c.provider === 'ghl').every((c) => c.cred_kek_id === 'KEK_V1'), 'CRM token sealed on every ghl connection')
const vee = seen.members.find((m) => m.email === 'viewer@example.com')
assert.equal(vee.role, 'account_admin'); assert.deepEqual(vee.tabs, ['overview', 'actions']); assert.equal(vee.reports, true); assert.equal(vee.n, 1, 'ghost dropped')
const rep = seen.members.find((m) => m.email === 'rep@example.com')
assert.equal(rep.status, 'invited'); assert.equal(rep.role, 'account_user')
assert.equal(seen.members.find((m) => m.email === 'alex@example.com').n, null, 'all clients = no list')
assert.deepEqual(seen.wsSettings.map((s) => `${s.slug}/${s.section}`), ['ablycalm/kpis', 'new-clinic/client', 'new-clinic/goals', 'old-one/client', 'pool-haus/kpis'])
assert.deepEqual(seen.orgSettings.map((s) => s.section), ['enabled', 'insights', 'terms', 'ui'])
assert.deepEqual(seen.monthly.map((m) => [m.month, m.pub]), [['2026-07', false], ['2026-08', true]])
assert.equal(seen.monthly[1].value.published.publishedBy, 'alex@example.com')
assert.deepEqual(seen.live.map((e) => e.event_id), ['won:1:won', 'lead:2'])
assert.deepEqual(seen.audit, [{ action: 'view', who: true, ws: true }, { action: 'crm-write', who: true, ws: true }])
assert.deepEqual(seen.terms, [{ email: 'alex@example.com', version: '1.5', signed: true }])
const owner = (await db.query(`select r.role from platform_roles r join users u on u.id = r.user_id where u.email = 'alex@example.com'`)).rows
assert.deepEqual(owner, [{ role: 'saas_owner' }])
const pw = (await db.query(`select password_hash from users where email = 'alex@example.com'`)).rows[0].password_hash
assert.equal(pw, 'pbkdf2-sha256$150000$S$H')

// A second run is a no-op in size: same counts, no duplicate rows, versions bumped on settings only.
const again = await migrateBlobs(db, stores, { builtin })
assert.equal(again.counts.invitations, undefined, 'the invitation already exists, so it is not written twice')
assert.deepEqual({ ...again.counts, invitations: 1 }, r.counts, 'everything else upserts to the same counts')
const totals = async () => (await withOrg(r.orgId, async (tx) => (await tx.query(`select
  (select count(*)::int from workspaces) as ws, (select count(*)::int from connections) as c, (select count(*)::int from memberships) as m,
  (select count(*)::int from invitations) as i, (select count(*)::int from monthly_reports) as mr, (select count(*)::int from live_events) as le,
  (select count(*)::int from audit_log) as a, (select count(*)::int from diag_log) as d, (select count(*)::int from terms_acceptances) as t`)).rows[0], { client: db }))
assert.deepEqual(await totals(), { ws: 4, c: 7, m: 3, i: 1, mr: 2, le: 2, a: 2, d: 1, t: 1 })
const v = await withOrg(r.orgId, async (tx) => (await tx.query(`select version from workspace_settings s join workspaces w on w.id = s.workspace_id where w.slug = 'ablycalm' and section = 'kpis'`)).rows[0].version, { client: db })
assert.equal(v, 2, 'a re-run bumps the settings version')
// No tenant set: nothing leaks.
assert.equal((await db.query('select count(*)::int as n from memberships')).rows[0].n, 0)
console.log('migrate_test: ok')
