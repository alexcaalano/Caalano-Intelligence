// Phase 1 of the SaaS move (SAAS-DESIGN.md section 10): Blobs stays the source
// of truth, and every write of settings, users, terms, monthly reports and the
// CRM token also lands in Postgres. The mapping from today's records to the
// schema lives here once, shared with scripts/migrate-blobs-to-pg.mjs, so the
// one-off import and the running mirror can never drift apart.
//
// The runtime entry points (`mirror.*`) never throw and never take longer than
// MIRROR_TIMEOUT_MS: a slow or missing database costs a warning in the log and
// nothing else. PG_MIRROR=0 switches the mirror off without a deploy.
import { createHash } from 'node:crypto'
import { withOrg, asPlatform } from './db.mjs'
import { membershipFromLegacy } from './entitle.mjs'
import { BUILTIN_CLIENTS } from './clients.mjs'

export const ORG = { slug: 'caalano', name: 'Caalano Digital', kind: 'agency', plan: 'caalano' }
export const ORG_ROLES = new Set(['superadmin', 'admin', 'user', 'viewer', 'account_admin', 'account_user'])
export const PBKDF2_ITER = 150000
// Windsor connector per ad-account field on a client record.
export const AD_CONNECTORS = { meta: 'facebook', google: 'google_ads', ga4: 'google_analytics_4' }
const CHUNK = 400
export const MIRROR_TIMEOUT_MS = 5000

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
export const iso = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
export const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
export const emailOf = (s) => String(s || '').trim().toLowerCase()
const rows = async (tx, sql, params) => (await tx.query(sql, params)).rows || []

// ---- shared mapping ------------------------------------------------------
// Multi-row insert with an optional conflict clause, in chunks that stay well
// under the parameter limit.
export async function insertMany(tx, table, cols, list, tail = '') {
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    const params = [], tuples = []
    for (const r of chunk) tuples.push('(' + r.map((v) => { params.push(v); return `$${params.length}` }).join(', ') + ')')
    await tx.query(`insert into ${table} (${cols.join(', ')}) values ${tuples.join(', ')} ${tail}`, params)
  }
}

export async function syncOrg(tx) {
  const [org] = await rows(tx, `insert into organisations (slug, name, kind, plan_id, subscription_status)
    values ($1, $2, $3, $4, 'active') on conflict (slug) do update set name = excluded.name returning id`, [ORG.slug, ORG.name, ORG.kind, ORG.plan])
  return org.id
}

// Every workspace slug the settings and the built-in registry know, with the
// merged record and whether Settings -> Clients has deleted it.
export function workspaceSlugs(settings, builtin = BUILTIN_CLIENTS) {
  const clientRecs = isObj(settings && settings.clients) ? settings.clients : {}
  const slugs = new Map()
  for (const [id, v] of Object.entries(builtin || {})) slugs.set(id, { rec: { ...v }, deleted: false })
  for (const [id, v] of Object.entries(clientRecs)) {
    if (!id || !isObj(v)) continue
    const cur = slugs.get(id) || { rec: {}, deleted: false }
    slugs.set(id, { rec: { ...cur.rec, ...v }, deleted: !!v._deleted })
  }
  return slugs
}

// Upsert the workspaces and return slug -> id. `existing` (slug -> id from a
// prior read) lets the running mirror skip rows it already has.
export async function syncWorkspaces(tx, orgId, slugs, { now = new Date(), onlyMissing = false, counts = {} } = {}) {
  const wsId = new Map()
  const have = onlyMissing ? new Map((await rows(tx, 'select id, slug, deleted_at from workspaces where org_id = $1', [orgId])).map((r) => [r.slug, r])) : new Map()
  for (const [slug, { rec, deleted }] of slugs) {
    const h = have.get(slug)
    if (h && (!!h.deleted_at) === deleted) { wsId.set(slug, h.id); continue }
    const [w] = await rows(tx, `insert into workspaces (org_id, slug, name, timezone, currency, demo, deleted_at)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (org_id, slug) do update set name = excluded.name, timezone = excluded.timezone, currency = excluded.currency, demo = excluded.demo, deleted_at = excluded.deleted_at
      returning id`, [orgId, slug, String(rec.name || slug), rec.tz || rec.timezone || null, rec.currency || null, !!rec.demo, deleted ? now.toISOString() : null])
    wsId.set(slug, w.id)
    counts[deleted ? 'workspaces_deleted' : 'workspaces'] = (counts[deleted ? 'workspaces_deleted' : 'workspaces'] || 0) + 1
  }
  return wsId
}

// A windsor connection per ad account and a ghl one per CRM location; the
// sealed CRM token (from cred.mjs) goes on the ghl rows when given.
export async function syncConnections(tx, orgId, slugs, wsId, { sealed = null, counts = {} } = {}) {
  for (const [slug, { rec, deleted }] of slugs) {
    if (deleted || !wsId.has(slug)) continue
    const list = []
    for (const [field, connector] of Object.entries(AD_CONNECTORS)) if (rec[field]) list.push(['windsor', 'agency', `${connector}:${rec[field]}`, rec[`${field}Name`] || null, null])
    if (rec.ghl) list.push(['ghl', 'agency', String(rec.ghl), rec.ghlName || null, sealed])
    for (const [provider, kind, ext, name, cred] of list) {
      await tx.query(`insert into connections (org_id, workspace_id, provider, kind, external_id, external_name, cred_ciphertext, cred_iv, cred_tag, cred_wrapped_key, cred_kek_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (workspace_id, provider, external_id) do update set external_name = coalesce(excluded.external_name, connections.external_name), deleted_at = null,
          cred_ciphertext = coalesce(excluded.cred_ciphertext, connections.cred_ciphertext), cred_iv = coalesce(excluded.cred_iv, connections.cred_iv), cred_tag = coalesce(excluded.cred_tag, connections.cred_tag),
          cred_wrapped_key = coalesce(excluded.cred_wrapped_key, connections.cred_wrapped_key), cred_kek_id = coalesce(excluded.cred_kek_id, connections.cred_kek_id)`,
        [orgId, wsId.get(slug), provider, kind, ext, name, cred ? cred.cred_ciphertext : null, cred ? cred.cred_iv : null, cred ? cred.cred_tag : null, cred ? cred.cred_wrapped_key : null, cred ? cred.cred_kek_id : null])
      counts[`connections_${provider}`] = (counts[`connections_${provider}`] || 0) + 1
    }
  }
}

// Re-seal the CRM token on every ghl connection of the organisation.
export async function syncGhlToken(tx, orgId, sealed) {
  const r = await tx.query(`update connections set cred_ciphertext = $2, cred_iv = $3, cred_tag = $4, cred_wrapped_key = $5, cred_kek_id = $6, last_ok_at = now(), deleted_at = null
    where org_id = $1 and provider = 'ghl'`, [orgId, sealed.cred_ciphertext, sealed.cred_iv, sealed.cred_tag, sealed.cred_wrapped_key, sealed.cred_kek_id])
  return r.rowCount ?? r.affectedRows ?? 0
}

const WS_SETTINGS_TAIL = 'on conflict (workspace_id, section) do update set value = excluded.value, version = workspace_settings.version + 1, updated_at = now()'
const ORG_SETTINGS_TAIL = 'on conflict (org_id, section) do update set value = excluded.value, version = org_settings.version + 1, updated_at = now()'

// Settings sections: `clients` becomes a `client` row per workspace; a section
// whose keys are all workspace slugs is split per workspace; everything else
// is one organisation row. `changes` (the partial body of a save) limits the
// per-workspace rows to the keys that changed; `only` limits the sections.
export async function syncSettings(tx, orgId, settings, wsId, { only = null, changes = null, counts = {}, warn = () => {} } = {}) {
  const wsRows = [], orgRows = []
  for (const [section, value] of Object.entries(settings || {})) {
    if (section === 'updatedAt') continue
    if (only && !only.includes(section)) continue
    const changed = changes && isObj(changes[section]) ? new Set(Object.keys(changes[section])) : null
    if (section === 'clients') {
      for (const [slug, rec] of Object.entries(isObj(value) ? value : {})) {
        if (!wsId.has(slug) || !isObj(rec) || (changed && !changed.has(slug))) continue
        wsRows.push([orgId, wsId.get(slug), 'client', JSON.stringify(rec)])
      }
      continue
    }
    if (isObj(value) && Object.keys(value).length && Object.keys(value).every((k) => wsId.has(k))) {
      for (const [slug, v] of Object.entries(value)) { if (changed && !changed.has(slug)) continue; wsRows.push([orgId, wsId.get(slug), section, JSON.stringify(v)]) }
      continue
    }
    if (isObj(value) && Object.keys(value).some((k) => wsId.has(k))) warn(`section ${section} mixes client keys with others: stored whole on the organisation`)
    if (value == null || (isObj(value) && !Object.keys(value).length)) continue
    orgRows.push([orgId, section, JSON.stringify(value)])
  }
  await insertMany(tx, 'workspace_settings', ['org_id', 'workspace_id', 'section', 'value'], wsRows, WS_SETTINGS_TAIL)
  await insertMany(tx, 'org_settings', ['org_id', 'section', 'value'], orgRows, ORG_SETTINGS_TAIL)
  counts.workspace_settings = (counts.workspace_settings || 0) + wsRows.length
  counts.org_settings = (counts.org_settings || 0) + orgRows.length
  return { workspace: wsRows.length, org: orgRows.length }
}

// One user record -> users row, membership, and its pending invitation.
// Returns the users.id, or null when the role is not an organisation role.
export async function syncUser(tx, orgId, u, wsId, { userId = new Map(), warn = () => {}, counts = {} } = {}) {
  const em = emailOf(u.email)
  if (!em) return null
  const hash = u.passwordHash && u.passwordSalt ? `pbkdf2-sha256$${PBKDF2_ITER}$${u.passwordSalt}$${u.passwordHash}` : null
  const [r] = await rows(tx, `insert into users (email, name, password_hash, terms_version, terms_accepted_at, created_at, last_seen_at)
    values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
    on conflict (email) do update set name = excluded.name, password_hash = coalesce(excluded.password_hash, users.password_hash),
      terms_version = coalesce(excluded.terms_version, users.terms_version), terms_accepted_at = coalesce(excluded.terms_accepted_at, users.terms_accepted_at),
      last_seen_at = greatest(excluded.last_seen_at, users.last_seen_at)
    returning id`, [em, String(u.name || ''), hash, u.termsVersion || null, iso(u.termsAcceptedAt), iso(u.createdAt), iso(u.lastSeen || u.lastLogin)])
  userId.set(em, r.id)
  counts.users = (counts.users || 0) + 1
  const m = membershipFromLegacy(u, (slug) => { if (!wsId.has(slug)) { warn(`user ${em}: unknown client ${slug} dropped`); return null } return wsId.get(slug) })
  if (!ORG_ROLES.has(m.role)) { warn(`user ${em}: role ${u.role} is not an organisation role, skipped`); return r.id }
  const status = u.status && u.status !== 'active' ? u.status : m.status
  const wsIds = m.workspace_ids ? m.workspace_ids.filter(Boolean) : null
  const invitedBy = u.invitedBy ? (userId.get(emailOf(u.invitedBy)) || (await rows(tx, 'select id from users where email = $1', [emailOf(u.invitedBy)]))[0]?.id || null) : null
  await tx.query(`insert into memberships (org_id, user_id, role, status, workspace_ids, tabs, reports, crm_user_id, invited_by, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))
    on conflict (org_id, user_id) do update set role = excluded.role, status = excluded.status, workspace_ids = excluded.workspace_ids, tabs = excluded.tabs, reports = excluded.reports, crm_user_id = excluded.crm_user_id`,
    [orgId, r.id, m.role, status, wsIds, m.tabs, m.reports, m.crm_user_id, invitedBy, iso(u.createdAt)])
  counts.memberships = (counts.memberships || 0) + 1
  // A pending invite travels on the user record (inviteToken); an accepted or
  // withdrawn one is closed out here.
  if (u.inviteToken && u.status === 'invited') {
    const th = sha256(u.inviteToken)
    const dup = await rows(tx, 'select 1 from invitations where org_id = $1 and token_hash = $2', [orgId, th])
    if (!dup.length) {
      await tx.query(`insert into invitations (org_id, email, role, workspace_ids, tabs, token_hash, expires_at, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orgId, em, m.role, wsIds || [], m.tabs, th, iso(u.inviteExpires) || new Date(Date.now() + 7 * 86400000).toISOString(), invitedBy])
      counts.invitations = (counts.invitations || 0) + 1
    }
  } else {
    await tx.query('update invitations set accepted_at = coalesce(accepted_at, now()) where org_id = $1 and email = $2 and accepted_at is null', [orgId, em])
  }
  return r.id
}

// A removed user: membership, invitations and platform role go; the users row
// stays (audit and terms rows point at it) with the membership gone.
export async function removeUser(tx, orgId, email) {
  const em = emailOf(email)
  const [u] = await rows(tx, 'select id from users where email = $1', [em])
  await tx.query('delete from invitations where org_id = $1 and email = $2', [orgId, em])
  if (!u) return false
  await tx.query('delete from memberships where org_id = $1 and user_id = $2', [orgId, u.id])
  await tx.query('delete from platform_roles where user_id = $1', [u.id])
  return true
}

export async function syncTermsDoc(tx, doc) {
  if (!isObj(doc) || !doc.version) return
  await tx.query(`insert into terms_docs (version, hash, archived_at, doc) values ($1, $2, coalesce($3::timestamptz, now()), $4) on conflict (version, hash) do nothing`,
    [String(doc.version), String(doc.hash || ''), iso(doc.archivedAt), JSON.stringify(doc.doc ?? null)])
}
export async function syncTermsAcceptance(tx, orgId, a, userId = null) {
  if (!isObj(a) || !a.acceptedAt) return
  const em = emailOf(a.email)
  const uid = userId || (await rows(tx, 'select id from users where email = $1', [em]))[0]?.id || null
  await tx.query(`insert into terms_acceptances (org_id, user_id, email, name, role, first_name, last_name, phone, version, hash, accepted_at, signature, typed_name, ip, user_agent)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (org_id, email, version, accepted_at) do nothing`,
    [orgId, uid, em, String(a.name || ''), a.role || null, a.firstName || null, a.lastName || null, a.phone || null, String(a.version || ''), a.hash || null, iso(a.acceptedAt), a.signature || null, a.typedName || null, a.ip || null, a.userAgent || null])
}

// Draft per client and month, with the published copy alongside.
export async function syncMonthly(tx, orgId, workspaceId, month, rec, pub = null) {
  const value = { ...rec, published: pub ? { report: pub.report ?? null, publishedAt: pub.publishedAt || null, publishedBy: pub.publishedBy || null } : null }
  await tx.query(`insert into monthly_reports (org_id, workspace_id, month, value, published_at, saved_at) values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
    on conflict (workspace_id, month) do update set value = excluded.value, published_at = excluded.published_at, saved_at = excluded.saved_at`,
    [orgId, workspaceId, month, JSON.stringify(value), pub ? iso(pub.publishedAt) : null, iso(rec.savedAt)])
}

// ---- the running mirror ----------------------------------------------------
let _client = null            // tests hand in an in-process Postgres
let _orgId = null, _orgAt = 0
const state = { lastOk: null, lastError: null, errors: 0, writes: 0 }
export function setMirrorClient(c) { _client = c; _orgId = null }
export const mirrorOn = () => !!_client || (!!process.env.DATABASE_URL && process.env.PG_MIRROR !== '0')
export const mirrorState = () => ({ ...state })
const opts = () => (_client ? { client: _client } : {})

async function orgId() {
  if (_orgId && Date.now() - _orgAt < 10 * 60 * 1000) return _orgId
  const [o] = await asPlatform((tx) => rows(tx, 'select id from organisations where slug = $1', [ORG.slug]), opts())
  if (!o) throw new Error('organisation not imported yet (run npm run db:import)')
  _orgId = o.id; _orgAt = Date.now()
  return _orgId
}
// Bounded and silent: a mirror failure is logged and counted, never surfaced.
async function safe(name, fn) {
  if (!mirrorOn()) return false
  let timer
  try {
    const id = await orgId()
    await Promise.race([
      withOrg(id, fn, opts()),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`mirror ${name} timed out after ${MIRROR_TIMEOUT_MS} ms`)), MIRROR_TIMEOUT_MS) }),
    ])
    state.lastOk = { at: new Date().toISOString(), name }; state.writes++
    return true
  } catch (e) {
    state.lastError = { at: new Date().toISOString(), name, message: String((e && e.message) || e).slice(0, 300) }; state.errors++
    console.warn(`[mirror] ${name}: ${state.lastError.message}`)
    return false
  } finally { clearTimeout(timer) }
}

// The workspace map for a save: read what exists, add only what is new.
async function workspaces(tx, id, settings) {
  return syncWorkspaces(tx, id, workspaceSlugs(settings), { onlyMissing: true })
}
async function sealedToken(t) {
  if (!t || !process.env.KEK_V1) return null
  const { sealCredential } = await import('./cred.mjs')
  return sealCredential(t)
}

export const mirror = {
  // After a settings save: `all` is the merged document, `changes` the body
  // that was posted (limits the rows written to what actually changed).
  settings: (all, changes = null) => safe('settings', async (tx) => {
    const id = await orgId()
    const slugs = workspaceSlugs(all)
    const wsId = await syncWorkspaces(tx, id, slugs, { onlyMissing: true })
    if (!changes || changes.clients) await syncConnections(tx, id, slugs, wsId)
    await syncSettings(tx, id, all, wsId, { only: changes ? Object.keys(changes) : null, changes })
  }),
  user: (u) => safe('user', async (tx) => {
    const id = await orgId()
    const wsId = await workspaces(tx, id, await currentSettings())
    await syncUser(tx, id, u, wsId)
  }),
  userDeleted: (email) => safe('userDeleted', async (tx) => { await removeUser(tx, await orgId(), email) }),
  terms: (acceptance, doc = null) => safe('terms', async (tx) => {
    if (doc) await syncTermsDoc(tx, doc)
    await syncTermsAcceptance(tx, await orgId(), acceptance)
  }),
  monthly: (client, month, rec, pub = null) => safe('monthly', async (tx) => {
    const id = await orgId()
    const wsId = await workspaces(tx, id, await currentSettings())
    if (!wsId.has(client)) throw new Error(`unknown client ${client}`)
    await syncMonthly(tx, id, wsId.get(client), month, rec, pub)
  }),
  ghlToken: (t) => safe('ghlToken', async (tx) => {
    const sealed = await sealedToken(t)
    if (!sealed) throw new Error('KEK_V1 is not set; token not mirrored')
    await syncGhlToken(tx, await orgId(), sealed)
  }),
}

// The settings document, for the workspace map. Provided by the caller side
// (settings.mjs owns the store); the default reads the Blob directly.
let _settingsReader = null
export function setSettingsReader(fn) { _settingsReader = fn }
async function currentSettings() {
  if (_settingsReader) return _settingsReader()
  const { getStore } = await import('@netlify/blobs')
  return (await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }).catch(() => null)) || {}
}

// For the superadmin status card: is the mirror on, what has it done, what is in the database.
export async function mirrorStatus() {
  const out = { on: mirrorOn(), ...mirrorState(), counts: null }
  if (!out.on) return out
  try {
    const id = await orgId()
    const [c] = await withOrg(id, (tx) => rows(tx, `select
      (select count(*)::int from workspaces where deleted_at is null) as workspaces,
      (select count(*)::int from connections where deleted_at is null) as connections,
      (select count(*)::int from memberships) as memberships,
      (select count(*)::int from workspace_settings) as workspace_settings,
      (select count(*)::int from org_settings) as org_settings,
      (select count(*)::int from monthly_reports) as monthly_reports,
      (select count(*)::int from terms_acceptances) as terms_acceptances,
      (select count(*)::int from connections where provider = 'ghl' and cred_kek_id is not null) as sealed_ghl,
      (select max(updated_at) from workspace_settings) as last_settings_write`), opts())
    out.counts = c; out.org = id
  } catch (e) { out.statusError = String((e && e.message) || e).slice(0, 300) }
  return out
}
