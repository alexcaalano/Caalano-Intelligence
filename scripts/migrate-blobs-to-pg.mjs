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
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { membershipFromLegacy } from '../netlify/lib/entitle.mjs'
import { asPlatform } from '../netlify/lib/db.mjs'
import { BUILTIN_CLIENTS } from '../netlify/lib/clients.mjs'

export const ORG = { slug: 'caalano', name: 'Caalano Digital', kind: 'agency', plan: 'caalano' }
const ORG_ROLES = new Set(['superadmin', 'admin', 'user', 'viewer', 'account_admin', 'account_user'])
const PBKDF2_ITER = 150000
// Windsor connector per ad-account field on a client record.
const AD_CONNECTORS = { meta: 'facebook', google: 'google_ads', ga4: 'google_analytics_4' }
const CHUNK = 400

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
const iso = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const emailOf = (s) => String(s || '').trim().toLowerCase()

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
    // organisation --------------------------------------------------------
    const [org] = await q(tx, `insert into organisations (slug, name, kind, plan_id, subscription_status)
      values ($1, $2, $3, $4, 'active') on conflict (slug) do update set name = excluded.name returning id`, [ORG.slug, ORG.name, ORG.kind, ORG.plan])
    const orgId = org.id
    bump('organisations')

    // workspaces: built-in registry plus Settings -> Clients (custom and deleted)
    const clientRecs = isObj(settings.clients) ? settings.clients : {}
    const slugs = new Map() // slug -> { rec, deleted }
    for (const [id, v] of Object.entries(builtin || {})) slugs.set(id, { rec: { ...v }, deleted: false })
    for (const [id, v] of Object.entries(clientRecs)) {
      if (!id || !isObj(v)) continue
      const cur = slugs.get(id) || { rec: {}, deleted: false }
      slugs.set(id, { rec: { ...cur.rec, ...v }, deleted: !!v._deleted })
    }
    const wsId = new Map()
    for (const [slug, { rec, deleted }] of slugs) {
      const [w] = await q(tx, `insert into workspaces (org_id, slug, name, timezone, currency, demo, deleted_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (org_id, slug) do update set name = excluded.name, timezone = excluded.timezone, currency = excluded.currency, demo = excluded.demo, deleted_at = excluded.deleted_at
        returning id`, [orgId, slug, String(rec.name || slug), rec.tz || rec.timezone || null, rec.currency || null, !!rec.demo, deleted ? now.toISOString() : null])
      wsId.set(slug, w.id)
      bump(deleted ? 'workspaces_deleted' : 'workspaces')
    }

    // connections: a windsor connection per ad account, a ghl one per CRM location
    let sealed = null
    const ghlTok = get('ghl-auth').agency
    if (ghlTok && process.env.KEK_V1) { const { sealCredential } = await import('../netlify/lib/cred.mjs'); sealed = sealCredential(ghlTok) }
    else if (ghlTok) warn('ghl-auth token present but KEK_V1 is not set: ghl connections created without a credential')
    for (const [slug, { rec, deleted }] of slugs) {
      if (deleted) continue
      const rows = []
      for (const [field, connector] of Object.entries(AD_CONNECTORS)) if (rec[field]) rows.push(['windsor', 'agency', `${connector}:${rec[field]}`, rec[`${field}Name`] || null, null])
      if (rec.ghl) rows.push(['ghl', 'agency', String(rec.ghl), rec.ghlName || null, sealed])
      for (const [provider, kind, ext, name, cred] of rows) {
        await q(tx, `insert into connections (org_id, workspace_id, provider, kind, external_id, external_name, cred_ciphertext, cred_iv, cred_tag, cred_wrapped_key, cred_kek_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          on conflict (workspace_id, provider, external_id) do update set external_name = coalesce(excluded.external_name, connections.external_name), deleted_at = null,
            cred_ciphertext = coalesce(excluded.cred_ciphertext, connections.cred_ciphertext), cred_iv = coalesce(excluded.cred_iv, connections.cred_iv), cred_tag = coalesce(excluded.cred_tag, connections.cred_tag),
            cred_wrapped_key = coalesce(excluded.cred_wrapped_key, connections.cred_wrapped_key), cred_kek_id = coalesce(excluded.cred_kek_id, connections.cred_kek_id)`,
          [orgId, wsId.get(slug), provider, kind, ext, name, cred ? cred.cred_ciphertext : null, cred ? cred.cred_iv : null, cred ? cred.cred_tag : null, cred ? cred.cred_wrapped_key : null, cred ? cred.cred_kek_id : null])
        bump(`connections_${provider}`)
      }
    }

    // users, platform owner, memberships, invitations -------------------------
    const auth = get('caalano-auth')
    const users = Object.entries(auth).filter(([k, v]) => k.startsWith('user:') && isObj(v) && v.email).map(([, v]) => v)
    const userId = new Map()
    for (const u of users) {
      const em = emailOf(u.email)
      const hash = u.passwordHash && u.passwordSalt ? `pbkdf2-sha256$${PBKDF2_ITER}$${u.passwordSalt}$${u.passwordHash}` : null
      const [r] = await q(tx, `insert into users (email, name, password_hash, terms_version, terms_accepted_at, created_at, last_seen_at)
        values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
        on conflict (email) do update set name = excluded.name, password_hash = coalesce(excluded.password_hash, users.password_hash),
          terms_version = coalesce(excluded.terms_version, users.terms_version), terms_accepted_at = coalesce(excluded.terms_accepted_at, users.terms_accepted_at),
          last_seen_at = greatest(excluded.last_seen_at, users.last_seen_at)
        returning id`, [em, String(u.name || ''), hash, u.termsVersion || null, iso(u.termsAcceptedAt), iso(u.createdAt), iso(u.lastSeen || u.lastLogin)])
      userId.set(em, r.id)
      bump('users')
    }
    const supers = users.filter((u) => u.role === 'superadmin' && (u.status || 'active') === 'active').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const ownerEmail = emailOf(owner) || (supers[0] ? emailOf(supers[0].email) : null)
    if (ownerEmail && userId.has(ownerEmail)) {
      await q(tx, `insert into platform_roles (user_id, role) values ($1, 'saas_owner') on conflict (user_id) do update set role = 'saas_owner'`, [userId.get(ownerEmail)])
      bump('platform_owner')
    } else warn(owner ? `owner ${owner} is not a user in caalano-auth: no saas_owner granted` : 'no active superadmin found: no saas_owner granted')

    for (const u of users) {
      const em = emailOf(u.email)
      const m = membershipFromLegacy(u, (slug) => { if (!wsId.has(slug)) { warn(`user ${em}: unknown client ${slug} dropped`); return null } return wsId.get(slug) })
      if (!ORG_ROLES.has(m.role)) { warn(`user ${em}: role ${u.role} is not an organisation role, skipped`); continue }
      const status = u.status && u.status !== 'active' ? u.status : m.status
      const wsIds = m.workspace_ids ? m.workspace_ids.filter(Boolean) : null
      await q(tx, `insert into memberships (org_id, user_id, role, status, workspace_ids, tabs, reports, crm_user_id, invited_by, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))
        on conflict (org_id, user_id) do update set role = excluded.role, status = excluded.status, workspace_ids = excluded.workspace_ids, tabs = excluded.tabs, reports = excluded.reports, crm_user_id = excluded.crm_user_id`,
        [orgId, userId.get(em), m.role, status, wsIds, m.tabs, m.reports, m.crm_user_id, userId.get(emailOf(u.invitedBy)) || null, iso(u.createdAt)])
      bump('memberships')
    }
    const byEmail = new Map(users.map((u) => [emailOf(u.email), u]))
    for (const [k, v] of Object.entries(auth)) {
      if (!k.startsWith('invite:') || !isObj(v) || !v.email) continue
      const u = byEmail.get(emailOf(v.email))
      if (!u) { warn(`invite for ${v.email} has no user record, skipped`); continue }
      const role = membershipFromLegacy(u).role
      if (!ORG_ROLES.has(role)) continue
      const th = sha256(k.slice('invite:'.length))
      const dup = await q(tx, 'select 1 from invitations where org_id = $1 and token_hash = $2', [orgId, th])
      if (dup.length) continue
      await q(tx, `insert into invitations (org_id, email, role, workspace_ids, tabs, token_hash, expires_at, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orgId, emailOf(v.email), role, (u.clients || []).map((s) => wsId.get(s)).filter(Boolean), Array.isArray(u.tabs) ? u.tabs : null, th, iso(v.expires) || now.toISOString(), userId.get(emailOf(u.invitedBy)) || null])
      bump('invitations')
    }

    // settings: client-keyed sections split per workspace, the rest on the organisation
    for (const [section, value] of Object.entries(settings)) {
      if (section === 'clients') {
        for (const [slug, rec] of Object.entries(clientRecs)) if (wsId.has(slug) && isObj(rec)) { await upsertWs(tx, orgId, wsId.get(slug), 'client', rec); bump('workspace_settings') }
        continue
      }
      if (isObj(value) && Object.keys(value).length && Object.keys(value).every((k) => wsId.has(k))) {
        for (const [slug, v] of Object.entries(value)) { await upsertWs(tx, orgId, wsId.get(slug), section, v); bump('workspace_settings') }
        continue
      }
      if (isObj(value) && Object.keys(value).some((k) => wsId.has(k))) warn(`section ${section} mixes client keys with others: stored whole on the organisation`)
      if (value == null || (isObj(value) && !Object.keys(value).length)) continue
      await upsertOrg(tx, orgId, section, value); bump('org_settings')
    }

    // terms: live wording override, archived documents, acceptances ---------
    const terms = get('caalano-terms')
    if (isObj(terms.live)) { await upsertOrg(tx, orgId, 'terms', terms.live); bump('org_settings') }
    for (const [k, v] of Object.entries(terms)) {
      if (k.startsWith('doc_') && isObj(v) && v.version) {
        await q(tx, `insert into terms_docs (version, hash, archived_at, doc) values ($1, $2, coalesce($3::timestamptz, now()), $4) on conflict (version, hash) do nothing`, [String(v.version), String(v.hash || ''), iso(v.archivedAt), JSON.stringify(v.doc ?? null)])
        bump('terms_docs')
      } else if (k.startsWith('t_') && isObj(v) && Array.isArray(v.acceptances)) {
        for (const a of v.acceptances) {
          if (!a || !a.acceptedAt) continue
          const em = emailOf(a.email || k.slice(2))
          await q(tx, `insert into terms_acceptances (org_id, user_id, email, name, role, first_name, last_name, phone, version, hash, accepted_at, signature, typed_name, ip, user_agent)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (org_id, email, version, accepted_at) do nothing`,
            [orgId, userId.get(em) || null, em, String(a.name || ''), a.role || null, a.firstName || null, a.lastName || null, a.phone || null, String(a.version || ''), a.hash || null, iso(a.acceptedAt), a.signature || null, a.typedName || null, a.ip || null, a.userAgent || null])
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
      const value = { ...rec, published: pub ? { report: pub.report ?? null, publishedAt: pub.publishedAt || null, publishedBy: pub.publishedBy || null } : null }
      await q(tx, `insert into monthly_reports (org_id, workspace_id, month, value, published_at, saved_at) values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
        on conflict (workspace_id, month) do update set value = excluded.value, published_at = excluded.published_at, saved_at = excluded.saved_at`,
        [orgId, wsId.get(slug), month, JSON.stringify(value), pub ? iso(pub.publishedAt) : null, iso(rec.savedAt)])
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

async function upsertWs(tx, orgId, wsId, section, value) {
  await tx.query(`insert into workspace_settings (org_id, workspace_id, section, value) values ($1, $2, $3, $4)
    on conflict (workspace_id, section) do update set value = excluded.value, version = workspace_settings.version + 1, updated_at = now()`, [orgId, wsId, section, JSON.stringify(value)])
}
async function upsertOrg(tx, orgId, section, value) {
  await tx.query(`insert into org_settings (org_id, section, value) values ($1, $2, $3)
    on conflict (org_id, section) do update set value = excluded.value, version = org_settings.version + 1, updated_at = now()`, [orgId, section, JSON.stringify(value)])
}
async function insertMany(tx, table, cols, rows, tail = '') {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params = [], tuples = []
    for (const r of chunk) tuples.push('(' + r.map((v) => { params.push(v); return `$${params.length}` }).join(', ') + ')')
    await tx.query(`insert into ${table} (${cols.join(', ')}) values ${tuples.join(', ')} ${tail}`, params)
  }
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
