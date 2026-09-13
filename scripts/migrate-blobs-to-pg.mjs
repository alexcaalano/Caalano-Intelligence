#!/usr/bin/env node
// One-off: copy Caalano Digital out of Netlify Blobs into the SaaS schema
// (SAAS-DESIGN.md phase 1). Creates organisation `caalano`, one workspace per
// client, a connection per ad account and CRM location, a user and membership
// per caalano-auth record, the settings sections split into workspace and
// organisation rows, and the terms, health, clinic, monthly, social, live,
// audit and reliability records. Safe to run again: every row is upserted or
// deduplicated, so a second run after a week of dual-writing only adds what
// is new.
//
//   node scripts/migrate-blobs-to-pg.mjs --from <backup.json | backups/latest/> --rehearse
//   node scripts/migrate-blobs-to-pg.mjs --from <backup.json> --dry
//   node scripts/migrate-blobs-to-pg.mjs --from <backup.json> [--owner <email>] [--yes]
//   node scripts/migrate-blobs-to-pg.mjs --site <netlify-site-id> --token <personal-token> ...
//
//   --from       a backup-export download (whole file) or a folder of per-store
//                files (backups/latest/). A `?secrets=1` export also carries the
//                CRM token, which is sealed into the ghl connections when KEK_V1 is set.
//   --site/--token  read the live stores instead of a file.
//   --rehearse   run the whole migration on an in-process Postgres (nothing else
//                needed, not even DATABASE_URL) and print the report.
//   --dry        run against DATABASE_URL inside a transaction and roll it back:
//                the report is real, the database is untouched.
//   --owner      the e-mail that gets saas_owner; default: the earliest superadmin.
//
// DATABASE_URL must be an ordinary role (no BYPASSRLS) with the migrations
// already applied (npm run db:migrate); the script refuses a bypassing role.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { asPlatform } from '../netlify/lib/db.mjs'
import { BUILTIN_CLIENTS } from '../netlify/lib/clients.mjs'
import { ORG, syncOrg, workspaceSlugs, syncWorkspaces, syncConnections, syncSettings, syncUser, syncTermsDoc, syncTermsAcceptance, syncMonthly, insertMany, iso, isObj, emailOf } from '../netlify/lib/mirror.mjs'
export { ORG }

class DryRun extends Error {}

// ---- reading the stores --------------------------------------------------
// Either shape a backup comes in: the whole export { stores: { name: { data } } },
// or one per-store file { store, data }. A folder is read file by file.
export function storesFromBackup(raw) {
  if (raw && raw.stores) return Object.fromEntries(Object.entries(raw.stores).map(([n, s]) => [n, (s && s.data) || {}]))
  if (raw && raw.store) return { [raw.store]: raw.data || {} }
  return null
}
export function loadStoresFrom(p) {
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    const out = {}
    for (const f of fs.readdirSync(p).filter((f) => f.endsWith('.json')).sort()) {
      const one = storesFromBackup(JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')))
      if (one) Object.assign(out, one)
    }
    return out
  }
  const s = storesFromBackup(JSON.parse(fs.readFileSync(p, 'utf8')))
  if (!s) throw new Error(`${p} is not a Caalano360 backup file`)
  return s
}
const STORE_NAMES = ['caalano-settings', 'caalano-auth', 'caalano-terms', 'caalano-health', 'caalano-clinic', 'caalano-monthly', 'caalano-social', 'caalano-audit', 'caalano-diag', 'caalano-live', 'ghl-auth']
export async function loadStoresLive({ siteID, token, names = STORE_NAMES, log = () => {} }) {
  const { getStore } = await import('@netlify/blobs')
  const out = {}
  for (const name of names) {
    const store = getStore({ name, siteID, token, consistency: 'strong' })
    const data = {}
    let cursor, keys = []
    do { const page = await store.list({ cursor }); keys.push(...(page.blobs || []).map((b) => b.key)); cursor = page.cursor } while (cursor)
    for (let i = 0; i < keys.length; i += 12) {
      await Promise.all(keys.slice(i, i + 12).map(async (k) => {
        const txt = await store.get(k, { type: 'text' }).catch(() => null)
        if (txt == null) return
        try { data[k] = JSON.parse(txt) } catch { data[k] = { _text: txt } }
      }))
    }
    out[name] = data
    log(`read ${keys.length} keys from ${name}`)
  }
  return out
}

// ---- the migration -------------------------------------------------------
// Runs inside one platform transaction: either everything lands or nothing does.
// Returns the report { counts, warnings, owner }.
export async function migrateBlobs(db, stores, opts = {}) {
  const { dry = false, owner = null, builtin = BUILTIN_CLIENTS, log = () => {}, now = new Date() } = opts
  const get = (name) => (stores && stores[name]) || {}
  const warnings = []
  const counts = {}
  let last = null
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n }
  const warn = (s) => { if (warnings.length < 200) warnings.push(s) }
  const settings = isObj(get('caalano-settings').all) ? get('caalano-settings').all : {}
  const q = async (tx, sql, params) => (await tx.query(sql, params)).rows || []

  const run = async (tx) => {
    // organisation, workspaces, connections ---------------------------------
    const orgId = await syncOrg(tx)
    bump('organisations')
    const slugs = workspaceSlugs(settings, builtin)
    const wsId = await syncWorkspaces(tx, orgId, slugs, { now, counts })
    let sealed = null
    const ghlTok = get('ghl-auth').agency
    if (ghlTok && process.env.KEK_V1) { const { sealCredential } = await import('../netlify/lib/cred.mjs'); sealed = sealCredential(ghlTok) }
    else if (ghlTok) warn('ghl-auth token present but KEK_V1 is not set: ghl connections created without a credential')
    await syncConnections(tx, orgId, slugs, wsId, { sealed, counts })

    // users, platform owner, memberships, invitations -------------------------
    const auth = get('caalano-auth')
    const users = Object.entries(auth).filter(([k, v]) => k.startsWith('user:') && isObj(v) && v.email).map(([, v]) => v)
    const userId = new Map()
    for (const u of users) await syncUser(tx, orgId, u, wsId, { userId, warn, counts })
    const supers = users.filter((u) => u.role === 'superadmin' && (u.status || 'active') === 'active').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const ownerEmail = emailOf(owner) || (supers[0] ? emailOf(supers[0].email) : null)
    if (ownerEmail && userId.has(ownerEmail)) {
      await q(tx, `insert into platform_roles (user_id, role) values ($1, 'saas_owner') on conflict (user_id) do update set role = 'saas_owner'`, [userId.get(ownerEmail)])
      bump('platform_owner')
    } else warn(owner ? `owner ${owner} is not a user in caalano-auth: no saas_owner granted` : 'no active superadmin found: no saas_owner granted')
    // Invite keys whose user record is gone are orphans; the live ones travel on the user.
    for (const [k, v] of Object.entries(auth)) {
      if (!k.startsWith('invite:') || !isObj(v) || !v.email) continue
      if (!userId.has(emailOf(v.email))) warn(`invite for ${v.email} has no user record, skipped`)
    }

    // settings: client-keyed sections split per workspace, the rest on the organisation
    await syncSettings(tx, orgId, settings, wsId, { counts, warn })

    // terms: live wording override, archived documents, acceptances ---------
    const terms = get('caalano-terms')
    if (isObj(terms.live)) { await q(tx, `insert into org_settings (org_id, section, value) values ($1, 'terms', $2) on conflict (org_id, section) do update set value = excluded.value, version = org_settings.version + 1, updated_at = now()`, [orgId, JSON.stringify(terms.live)]); bump('org_settings') }
    for (const [k, v] of Object.entries(terms)) {
      if (k.startsWith('doc_') && isObj(v) && v.version) { await syncTermsDoc(tx, v); bump('terms_docs') }
      else if (k.startsWith('t_') && isObj(v) && Array.isArray(v.acceptances)) {
        for (const a of v.acceptances) {
          if (!a || !a.acceptedAt) continue
          const em = emailOf(a.email || k.slice(2))
          await syncTermsAcceptance(tx, orgId, { ...a, email: em }, userId.get(em) || null)
          bump('terms_acceptances')
        }
      }
    }

    // per-client snapshots: health and clinic keyed by client id -----------
    for (const [store, kind] of [['caalano-health', 'health'], ['caalano-clinic', 'clinic']]) {
      for (const [slug, v] of Object.entries(get(store))) {
        if (!wsId.has(slug)) { bump(`${kind}_skipped`); continue }
        await q(tx, `insert into snapshots (org_id, workspace_id, kind, key, value, built_at) values ($1, $2, $3, '', $4, now())
          on conflict (workspace_id, kind, key) do update set value = excluded.value, built_at = now()`, [orgId, wsId.get(slug), kind, JSON.stringify(v)])
        bump(`snapshots_${kind}`)
      }
    }
    for (const [slug, v] of Object.entries(get('caalano-social'))) {
      if (!wsId.has(slug)) { bump('social_skipped'); continue }
      await q(tx, `insert into social_cache (org_id, workspace_id, key, value, built_at) values ($1, $2, 'snapshot', $3, now())
        on conflict (workspace_id, key) do update set value = excluded.value, built_at = now()`, [orgId, wsId.get(slug), JSON.stringify(v)])
      bump('social_cache')
    }

    // monthly reports: draft per client and month, with the published copy alongside
    const monthly = get('caalano-monthly')
    for (const [k, rec] of Object.entries(monthly)) {
      const m = /^([^:]+):(\d{4}-\d{2})$/.exec(k)
      if (!m || !isObj(rec)) continue
      const [, slug, month] = m
      if (!wsId.has(slug)) { bump('monthly_skipped'); continue }
      const pub = isObj(monthly[`pub:${slug}:${month}`]) ? monthly[`pub:${slug}:${month}`] : null
      await syncMonthly(tx, orgId, wsId.get(slug), month, rec, pub)
      bump('monthly_reports')
    }

    // live CRM events: one row per event, keyed so a re-run adds nothing twice
    const byLoc = new Map([...slugs].filter(([, s]) => s.rec.ghl).map(([slug, s]) => [String(s.rec.ghl), slug]))
    for (const [k, v] of Object.entries(get('caalano-live'))) {
      if (!k.startsWith('live:') || !isObj(v) || !Array.isArray(v.events)) continue
      const slug = byLoc.get(k.slice(5))
      if (!slug) { bump('live_skipped', v.events.length); continue }
      const rows = v.events.filter((e) => e && e.id && e.at).map((e) => [orgId, wsId.get(slug), String(e.id), String(e.kind || 'event'), iso(e.at), JSON.stringify(e)])
      await insertMany(tx, 'live_events', ['org_id', 'workspace_id', 'event_id', 'kind', 'at', 'payload'], rows, 'on conflict (workspace_id, event_id) do nothing')
      bump('live_events', rows.length)
    }

    // logs: replaced wholesale from the Blob copy each run (they have no natural key)
    await q(tx, `delete from audit_log where org_id = $1 and detail->>'_src' = 'blobs'`, [orgId])
    for (const [k, list] of Object.entries(get('caalano-audit'))) {
      if (!/^audit:\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(list)) continue
      const rows = list.filter(isObj).map((e) => [orgId, wsId.get(e.client) || null, userId.get(emailOf(e.user)) || null, String(e.kind || 'view').slice(0, 60), JSON.stringify({ ...e, _src: 'blobs' }), iso(e.t || e.at) || `${k.slice(6)}T00:00:00Z`])
      await insertMany(tx, 'audit_log', ['org_id', 'workspace_id', 'user_id', 'action', 'detail', 'at'], rows)
      bump('audit_log', rows.length)
    }
    await q(tx, `delete from diag_log where org_id = $1 and upstream->>'_src' = 'blobs'`, [orgId])
    const diagRows = []
    for (const [k, e] of Object.entries(get('caalano-diag'))) {
      const m = /^diag:(\d{4}-\d{2}-\d{2}):/.exec(k)
      if (!m || !isObj(e)) continue
      diagRows.push([orgId, wsId.get(e.client) || null, String(e.scope || e.route || '').slice(0, 120) || null, e.q ? String(e.q).slice(0, 500) : null, Number.isFinite(Number(e.ms)) ? Math.round(Number(e.ms)) : null, Number.isFinite(Number(e.status)) ? Number(e.status) : null, JSON.stringify({ ...e, _src: 'blobs' }), iso(e.t) || `${m[1]}T00:00:00Z`])
    }
    await insertMany(tx, 'diag_log', ['org_id', 'workspace_id', 'route', 'q', 'ms', 'status', 'upstream', 'at'], diagRows)
    bump('diag_log', diagRows.length)

    const report = { orgId, owner: ownerEmail, counts, warnings, dry }
    last = report
    log(report)
    if (dry) throw new DryRun('dry run')
    return report
  }

  try { return await asPlatform(run, { client: db }) }
  catch (e) { if (e instanceof DryRun) return { ...last, orgId: null, dry: true }; throw e }
}

export function formatReport(r) {
  const lines = [r.dry ? 'DRY RUN - nothing written' : `written (organisation ${r.orgId})`]
  if (r.owner) lines.push(`saas_owner: ${r.owner}`)
  for (const [k, v] of Object.entries(r.counts).sort()) lines.push(`  ${k.padEnd(24)} ${v}`)
  if (r.warnings.length) { lines.push(`warnings (${r.warnings.length}):`); for (const w of r.warnings.slice(0, 40)) lines.push('  - ' + w) }
  return lines.join('\n')
}

// ---- CLI ---------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const from = opt('--from'), siteID = opt('--site') || process.env.NETLIFY_SITE_ID, token = opt('--token') || process.env.NETLIFY_AUTH_TOKEN
  const rehearse = flags.has('--rehearse'), dry = flags.has('--dry')
  if (!from && !(siteID && token)) { console.error('usage: migrate-blobs-to-pg.mjs --from <backup.json|folder> | --site <id> --token <token>  [--rehearse | --dry] [--owner <email>] [--yes]'); process.exit(2) }

  const stores = from ? loadStoresFrom(from) : await loadStoresLive({ siteID, token, log: console.log })
  console.log(`stores: ${Object.entries(stores).map(([n, d]) => `${n} (${Object.keys(d).length})`).join(', ')}`)

  let client, done = async () => {}
  if (rehearse) {
    const { PGlite } = await import('@electric-sql/pglite')
    const { citext } = await import('@electric-sql/pglite/contrib/citext')
    const { applyMigrations } = await import('../db/migrate.mjs')
    client = new PGlite({ extensions: { citext } })
    await applyMigrations(client)
    console.log('rehearsal on an in-process Postgres; nothing is written anywhere')
  } else {
    const url = process.env.DATABASE_URL
    if (!url) { console.error('DATABASE_URL is not set (or use --rehearse)'); process.exit(2) }
    const { default: pg } = await import('pg')
    client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } })
    await client.connect()
    done = () => client.end()
    const r = await client.query('select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user')
    if (r.rows[0] && r.rows[0].bypass) { console.error('DATABASE_URL connects as a role that bypasses row level security; use the caalano_app role'); await done(); process.exit(2) }
    // Readiness, in the order the failures would otherwise surface: the schema
    // must be reachable, the migrations applied, and the tables writable.
    const schema = await client.query("select has_schema_privilege('public', 'usage') as ok")
    if (!schema.rows[0].ok) { console.error('this role cannot use the public schema: run the grant block (step 4) in the Neon SQL Editor, then try again'); await done(); process.exit(2) }
    const pending = (await (await import('../db/migrate.mjs')).migrationStatus(client)).filter((m) => !m.applied)
    if (pending.length) { console.error(`migrations pending: ${pending.map((m) => m.name).join(', ')} - run npm run db:migrate first`); await done(); process.exit(2) }
    const priv = await client.query("select has_table_privilege('organisations', 'insert') as ins, has_table_privilege('organisations', 'select') as sel, has_sequence_privilege('audit_log_id_seq', 'usage') as seq")
    if (!priv.rows[0].ins || !priv.rows[0].sel || !priv.rows[0].seq) { console.error('this role cannot write the tables: run the grant block (step 4) in the Neon SQL Editor, then try again'); await done(); process.exit(2) }
    if (!dry && !flags.has('--yes')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const ans = await new Promise((res) => rl.question('Write Caalano Digital into this database? Type yes: ', res)); rl.close()
      if (ans.trim() !== 'yes') { console.log('aborted'); await done(); process.exit(1) }
    }
  }
  try {
    const report = await migrateBlobs(client, stores, { dry, owner: opt('--owner') })
    console.log(formatReport(report))
  } finally { await done() }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1) })
