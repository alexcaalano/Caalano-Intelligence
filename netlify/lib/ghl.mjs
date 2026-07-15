// GoHighLevel (Caalano Systems) direct API — the UTM/attribution layer that
// Windsor can't provide. Agency OAuth: one company token is stored in Netlify
// Blobs, then per-sub-account "location tokens" are minted on demand to read
// each client's contacts (attributionSource = first-touch UTMs) + opportunities.
import { getStore } from '@netlify/blobs'

const API = 'https://services.leadconnectorhq.com'
const VER = '2021-07-28'
const store = () => getStore({ name: 'ghl-auth', consistency: 'strong' })
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

export async function loadTokens() { try { return await store().get('agency', { type: 'json' }) } catch { return null } }
export async function saveTokens(t) { await store().setJSON('agency', t) }
export async function isConnected() { return !!(await loadTokens()) }

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: process.env.GHL_CLIENT_ID, client_secret: process.env.GHL_CLIENT_SECRET, ...params })
  const r = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body })
  const txt = await r.text()
  if (!r.ok) throw new Error(`ghl token ${r.status}: ${txt.slice(0, 300)}`)
  return JSON.parse(txt)
}
export async function exchangeCode(code, redirect_uri) {
  const j = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri, user_type: 'Company' })
  const t = { access_token: j.access_token, refresh_token: j.refresh_token, companyId: j.companyId || j.company_id || null, userType: j.userType, expires_at: Date.now() + num(j.expires_in) * 1000 }
  await saveTokens(t); return t
}
async function agencyToken() {
  let t = await loadTokens()
  if (!t) throw new Error('GoHighLevel not connected')
  if (Date.now() > t.expires_at - 120000) {
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, user_type: 'Company' })
    t = { access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, companyId: j.companyId || t.companyId, userType: j.userType || t.userType, expires_at: Date.now() + num(j.expires_in) * 1000 }
    await saveTokens(t)
  }
  return t
}

// Location tokens are short-lived; cache per warm lambda.
const locCache = new Map()
async function locationToken(locationId) {
  const c = locCache.get(locationId)
  if (c && Date.now() < c.exp) return c.tok
  const t = await agencyToken()
  const body = new URLSearchParams({ companyId: t.companyId, locationId })
  const r = await fetch(`${API}/oauth/locationToken`, { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, Version: VER, Accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body })
  const txt = await r.text()
  if (!r.ok) throw new Error(`ghl locationToken ${r.status}: ${txt.slice(0, 300)}`)
  const j = JSON.parse(txt)
  const tok = j.access_token
  locCache.set(locationId, { tok, exp: Date.now() + (num(j.expires_in) || 82800) * 1000 })
  return tok
}

async function ghlGet(locTok, path, query) {
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v)
  const r = await fetch(url, { headers: { Authorization: `Bearer ${locTok}`, Version: VER, Accept: 'application/json' } })
  const txt = await r.text()
  if (!r.ok) throw new Error(`ghl GET ${path} ${r.status}: ${txt.slice(0, 200)}`)
  return JSON.parse(txt)
}
async function ghlPost(locTok, path, bodyObj) {
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${locTok}`, Version: VER, Accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) })
  const txt = await r.text()
  if (!r.ok) throw new Error(`ghl POST ${path} ${r.status}: ${txt.slice(0, 200)}`)
  return JSON.parse(txt)
}

// --- data pulls (paged, bounded) ---
async function allOpportunities(locTok, locationId, from, to, cap = 2000) {
  const out = []; let startAfter, startAfterId, guard = 0
  while (guard++ < 40 && out.length < cap) {
    const q = { location_id: locationId, limit: 100 }
    if (from) q.startDate = new Date(from + 'T00:00:00Z').getTime()
    if (to) q.endDate = new Date(to + 'T23:59:59Z').getTime()
    if (startAfter) { q.startAfter = startAfter; q.startAfterId = startAfterId }
    const j = await ghlGet(locTok, '/opportunities/search', q)
    const batch = j.opportunities || []
    out.push(...batch)
    const meta = j.meta || {}
    if (!batch.length || !meta.startAfterId || meta.startAfterId === startAfterId) break
    startAfter = meta.startAfter; startAfterId = meta.startAfterId
  }
  return out
}
async function contactsByIds(locTok, ids) {
  // hydrate attribution for a set of contact ids (bounded)
  const map = new Map(); const list = [...new Set(ids.filter(Boolean))].slice(0, 2000)
  const CH = 8
  for (let i = 0; i < list.length; i += CH) {
    const chunk = list.slice(i, i + CH)
    const res = await Promise.all(chunk.map((id) => ghlGet(locTok, `/contacts/${id}`, {}).then((j) => j.contact || j).catch(() => null)))
    for (const c of res) if (c && c.id) map.set(c.id, c)
  }
  return map
}
async function pipelineStageIndex(locTok, locationId) {
  const j = await ghlGet(locTok, '/opportunities/pipelines', { locationId }).catch(() => ({ pipelines: [] }))
  const idx = new Map()
  for (const p of (j.pipelines || [])) {
    const byId = {}; let bookPos = null, showPos = null
    const stages = (p.stages || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
    stages.forEach((s, i) => {
      const pos = s.position ?? i; byId[s.id] = { name: s.name, pos }
      const nm = String(s.name || '')
      if (/(cancel|no.?show|no.?answer|disqualif|lost)/i.test(nm)) return
      if (/(book|appointment|\bappt\b|discovery call|consult|scheduled)/i.test(nm)) bookPos = bookPos == null ? pos : Math.min(bookPos, pos)
      if (/(attend|showed|\bheld\b|payment collect|\bpaid\b|qualified|onboard|welcome)/i.test(nm)) showPos = showPos == null ? pos : Math.min(showPos, pos)
    })
    idx.set(p.id, { byId, bookPos, showPos })
  }
  return idx
}

// first-touch attribution → normalised utm fields
function utmOf(contact) {
  const a = (contact && (contact.attributionSource || {})) || {}
  const g = (k) => a[k] || a[k?.toLowerCase?.()] || null
  const source = g('utmSource') || a.utm_source || a.sessionSource || a.source || null
  const medium = g('utmMedium') || a.utm_medium || a.medium || null
  const campaign = g('utmCampaign') || a.utm_campaign || a.campaign || null
  const content = g('utmContent') || a.utm_content || null
  const term = g('utmTerm') || a.utm_term || null
  return { source, medium, campaign, content, term, adId: a.adId || a.fbAdId || null }
}

export async function buildAttribution(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const [opps, idx] = await Promise.all([
    allOpportunities(locTok, locationId, from, to),
    pipelineStageIndex(locTok, locationId),
  ])
  const contactIds = opps.map((o) => o.contactId || o.contact?.id).filter(Boolean)
  const contacts = await contactsByIds(locTok, contactIds)

  const dim = { source: new Map(), medium: new Map(), campaign: new Map(), content: new Map() }
  const bump = (map, keyRaw, o, pi) => {
    const key = keyRaw && String(keyRaw).trim() ? String(keyRaw).trim() : '(not set)'
    const e = map.get(key) || { name: key, leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 }
    e.leads++
    const st = String(o.status || '').toLowerCase()
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const pos = stg ? stg.pos : -1
    const isWon = st === 'won'
    if (isWon) { e.won++; e.revenue += num(o.monetaryValue) }
    if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) e.booked++
    if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) e.shown++
    map.set(key, e)
  }
  let matched = 0
  for (const o of opps) {
    const c = contacts.get(o.contactId || o.contact?.id)
    const u = utmOf(c)
    if (u.source || u.campaign) matched++
    const pi = idx.get(o.pipelineId)
    bump(dim.source, u.source, o, pi)
    bump(dim.medium, u.medium, o, pi)
    bump(dim.campaign, u.campaign, o, pi)
    bump(dim.content, u.content, o, pi)
  }
  const top = (map) => [...map.values()].sort((a, b) => b.leads - a.leads).slice(0, 30)
  return {
    connected: true,
    opps: opps.length, contactsResolved: contacts.size, attributed: matched,
    bySource: top(dim.source), byMedium: top(dim.medium), byCampaign: top(dim.campaign), byCreative: top(dim.content),
  }
}

// Debug: raw shapes to confirm field names once connected.
export async function sampleAttribution(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const opps = await allOpportunities(locTok, locationId, from, to, 5)
  const ids = opps.map((o) => o.contactId || o.contact?.id).filter(Boolean).slice(0, 3)
  const contacts = await contactsByIds(locTok, ids)
  return { oppSample: opps.slice(0, 3), contactSample: [...contacts.values()].map((c) => ({ id: c.id, attributionSource: c.attributionSource, lastAttributionSource: c.lastAttributionSource })) }
}
