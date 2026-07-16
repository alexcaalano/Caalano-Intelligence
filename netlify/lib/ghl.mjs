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
// opportunities/search returns the opportunity, its contact AND an inline
// `attributions` array (first/last touch, UTMs) — one call, no N+1 lookups.
async function allOpportunities(locTok, locationId, from, to, cap = 1500) {
  // GHL opportunities/search has no startDate/endDate range params, so we page
  // newest-first and filter by createdAt in memory, stopping once a page is
  // entirely older than the window.
  const out = []; let startAfter, startAfterId, guard = 0
  const fromMs = from ? new Date(from + 'T00:00:00Z').getTime() : null
  const toMs = to ? new Date(to + 'T23:59:59Z').getTime() : null
  while (guard++ < 25 && out.length < cap) {
    const q = { location_id: locationId, limit: 100, order: 'added_desc' }
    if (startAfter != null) { q.startAfter = startAfter; q.startAfterId = startAfterId }
    const j = await ghlGet(locTok, '/opportunities/search', q)
    const batch = j.opportunities || []
    let oldest = Infinity
    for (const o of batch) { const ms = Date.parse(o.createdAt); if (ms < oldest) oldest = ms; if ((fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs)) out.push(o) }
    const meta = j.meta || {}
    const nextId = meta.startAfterId || (batch.length ? batch[batch.length - 1].id : null)
    const nextAfter = meta.startAfter || (batch.length ? (batch[batch.length - 1].sort || [])[0] : null)
    if (batch.length < 100 || !nextId || nextId === startAfterId) break
    if (fromMs != null && oldest < fromMs) break // page went past the window (newest-first)
    startAfter = nextAfter; startAfterId = nextId
  }
  return out
}
const BOOK_RE = /(book|appointment|\bappt\b|discovery call|consult|scheduled)/i
const SHOW_RE = /(attend|showed|\bheld\b|payment collect|\bpaid\b|qualified|onboard|welcome)/i
const STAGE_EXC = /(cancel|no.?show|no.?answer|disqualif|lost)/i
async function fetchPipelines(locTok, locationId) {
  const j = await ghlGet(locTok, '/opportunities/pipelines', { locationId }).catch(() => ({ pipelines: [] }))
  return j.pipelines || []
}
function stageIndexFrom(pipelines) {
  const idx = new Map()
  for (const p of pipelines) {
    const byId = {}; let bookPos = null, showPos = null
    const stages = (p.stages || []).map((s, i) => ({ id: s.id, name: s.name, pos: s.position ?? i })).sort((a, b) => a.pos - b.pos)
    for (const s of stages) {
      byId[s.id] = { name: s.name, pos: s.pos }
      const nm = String(s.name || '')
      if (STAGE_EXC.test(nm)) continue
      if (BOOK_RE.test(nm)) bookPos = bookPos == null ? s.pos : Math.min(bookPos, s.pos)
      if (SHOW_RE.test(nm)) showPos = showPos == null ? s.pos : Math.min(showPos, s.pos)
    }
    idx.set(p.id, { name: p.name, stages, byId, bookPos, showPos })
  }
  return idx
}
async function pipelineStageIndex(locTok, locationId) {
  return stageIndexFrom(await fetchPipelines(locTok, locationId))
}

// first-touch UTMs from an opportunity's inline `attributions` array
function utmOf(opp) {
  const atts = Array.isArray(opp.attributions) ? opp.attributions : []
  const a = atts.find((x) => x.isFirst) || atts[0] || {}
  // Prefer session source (first-touch channel the visitor arrived from) over
  // the utm_source tag, per the Caalano360 attribution model.
  const source = a.utmSessionSource || a.sessionSource || a.utmSource || a.utm_source || null
  const medium = a.utmMedium || a.utm_medium || a.medium || null
  const campaign = a.utmCampaign || a.utm_campaign || a.campaign || null
  const content = a.utmContent || a.utm_content || null
  const term = a.utmTerm || a.utm_term || a.utmKeyword || null
  return { source, medium, campaign, content, term, adId: a.adId || a.fbAdId || a.gclid || a.fbclid || null }
}

// Classify an opportunity's first-touch UTMs into a paid channel so the whole
// Caalano360 view can pivot Meta-only / Google-only / All. Looks at source +
// medium + click-id fingerprints.
const META_RE = /(facebook|instagram|\bfb\b|\bmeta\b|\big\b|fbclid|fb_|ig_)/i
const GOOGLE_RE = /(google|adwords|youtube|\bgdn\b|gclid|goog|dv360|gclsrc)/i
function channelOf(u) {
  const hay = `${u.source || ''} ${u.medium || ''} ${u.campaign || ''} ${u.adId || ''}`.toLowerCase()
  if (META_RE.test(hay)) return 'meta'
  if (GOOGLE_RE.test(hay)) return 'google'
  return 'other'
}

// Self-booking tag: contacts that booked their own appointment carry a
// "customer booked appointment" style tag. Tags ride inline on the opportunity
// (contact.tags), falling back to a top-level tags array on some API versions.
const BOOK_TAG_RE = /booked\s*app(t|ointment)|self.?book|customer\s*booked|contact\s*booked|book(ed)?\s*by\s*(customer|contact|self)/i
function oppTags(o) { const c = o.contact || {}; return Array.isArray(c.tags) ? c.tags : (Array.isArray(o.tags) ? o.tags : null) }
function isSelfBooked(o) { const t = oppTags(o); return t ? t.some((x) => BOOK_TAG_RE.test(String(x))) : false }

// The contact an opportunity belongs to (used to join calendar appointments to
// opportunities). GHL returns this as a flat contactId and/or a nested contact.
function contactIdOf(o) { return o.contactId || (o.contact && (o.contact.id || o.contact._id)) || null }

// Real booked calendar appointments per contact. GHL keeps appointments
// (calendar events) as a SEPARATE object from the opportunity pipeline stage,
// so a lead can have a genuinely booked call while its opportunity was never
// advanced past intake. We pull appointments directly and return, per contact,
// whether they have any booked / shown appointment. The caller joins these to
// opportunities by contactId, so a lead counts as Booked / Shown on its
// OPPORTUNITY-CREATION date (the day the lead came in) if that contact has an
// appointment, no matter when the call itself is scheduled. Because only lead
// contacts (those with an opportunity in the window) are ever looked up,
// internal/partner meetings on the same calendars never inflate the counts.
// The fetch window reaches back a little and well forward so a far-future call
// booked by an in-period lead is still captured. A no-show still booked the
// call; cancelled/invalid never count. Shown requires the call to be attended.
const APPT_CANCEL_RE = /(cancel|invalid)/i
async function fetchAppointments(locTok, locationId, from, to) {
  const byContact = new Map()
  let calendars = []
  try {
    const j = await ghlGet(locTok, '/calendars/', { locationId })
    calendars = j.calendars || j.calendar || []
  } catch (e) { return { byContact, connected: false, error: String(e.message || e).slice(0, 120) } }
  const DAY = 86400000
  const startMs = (from ? new Date(from + 'T00:00:00Z').getTime() : Date.now() - 400 * DAY) - 7 * DAY
  const endMs = (to ? new Date(to + 'T23:59:59Z').getTime() : Date.now()) + 180 * DAY
  const mark = (contactId, status) => {
    if (!contactId) return
    const s = String(status || '').toLowerCase()
    const e = byContact.get(contactId) || { booked: 0, shown: 0 }
    if (!APPT_CANCEL_RE.test(s)) e.booked++
    if (s === 'showed') e.shown++
    byContact.set(contactId, e)
  }
  let events = 0
  for (const cal of calendars) {
    const calId = cal.id || cal._id || cal.calendarId
    if (!calId) continue
    try {
      const j = await ghlGet(locTok, '/calendars/events', { locationId, calendarId: calId, startTime: startMs, endTime: endMs })
      for (const ev of (j.events || [])) {
        events++
        const cid = ev.contactId || (ev.contact && (ev.contact.id || ev.contact._id)) || null
        mark(cid, ev.appointmentStatus || ev.status)
      }
    } catch { /* skip a calendar we cannot read; others still count */ }
  }
  return { byContact, connected: true, calendars: calendars.length, events }
}

// Full CRM-style rollup over an arbitrary opportunity subset (one channel, or
// all). Mirrors buildCrm's shape so the frontend can render tiles, the ordered
// pipeline funnel, stage pass-through and lost reasons for any channel filter.
function rollupSubset(opps, idx, reasonName) {
  let leads = 0, open = 0, won = 0, lost = 0, abandoned = 0, revenue = 0, openValue = 0, booked = 0, shown = 0, selfBooked = 0, tagSeen = 0, cycleSum = 0, cycleN = 0
  const lostAgg = new Map()
  for (const o of opps) {
    leads++
    const st = String(o.status || '').toLowerCase(); const val = num(o.monetaryValue)
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    const isWon = st === 'won'
    if (oppTags(o) != null) tagSeen++
    if (isWon) {
      won++; revenue += val
      const ca = Date.parse(o.createdAt), sc = Date.parse(o.lastStatusChangeAt)
      if (ca && sc && sc >= ca) { cycleSum += sc - ca; cycleN++ }
    } else if (st === 'lost' || st === 'abandoned') {
      if (st === 'lost') lost++; else abandoned++
      const rn = reasonName[o.lostReasonId] || (o.lostReasonId ? 'Other' : 'Not set')
      lostAgg.set(rn, (lostAgg.get(rn) || 0) + 1)
    } else { open++; openValue += val }
    if (isWon || o._apptBooked || (pi && pi.bookPos != null && pos >= pi.bookPos)) { booked++; if (isSelfBooked(o)) selfBooked++ }
    if (isWon || o._apptShown || (pi && pi.showPos != null && pos >= pi.showPos)) shown++
  }
  // per-pipeline ordered stages with pass-through counts + full crm rollup
  const byPipe = new Map()
  for (const o of opps) { const pid = o.pipelineId || 'none'; if (!byPipe.has(pid)) byPipe.set(pid, []); byPipe.get(pid).push(o) }
  const pipelines = [...byPipe.entries()].map(([pid, rows]) => {
    const pi = idx.get(pid); const at = new Map(), openAt = new Map()
    let l = 0, b = 0, sh = 0, w = 0, ls = 0, op = 0, rev = 0, opv = 0
    for (const o of rows) {
      const sid = o.pipelineStageId; at.set(sid, (at.get(sid) || 0) + 1)
      const st = String(o.status || '').toLowerCase(); const val = num(o.monetaryValue)
      if (st !== 'lost' && st !== 'abandoned') openAt.set(sid, (openAt.get(sid) || 0) + 1)
      l++; const stg = pi ? pi.byId[sid] : null; const pos = stg ? stg.pos : -1; const isWon = st === 'won'
      if (isWon) { w++; rev += val } else if (st === 'lost' || st === 'abandoned') ls++; else { op++; opv += val }
      if (isWon || o._apptBooked || (pi && pi.bookPos != null && pos >= pi.bookPos)) b++; if (isWon || o._apptShown || (pi && pi.showPos != null && pos >= pi.showPos)) sh++
    }
    const stages = (pi ? pi.stages : []).map((s) => ({ name: s.name, pos: s.pos, count: at.get(s.id) || 0, active: openAt.get(s.id) || 0 }))
    const crm = { leads: l, booked: b, shown: sh, won: w, lost: ls, open: op, revenue: Math.round(rev), openValue: Math.round(opv), avgValue: w ? Math.round(rev / w) : 0 }
    return { id: pid, name: (pi && pi.name) || 'Unnamed pipeline', leads: rows.length, stages, funnel: { leads: l, booked: b, shown: sh, won: w }, crm }
  }).sort((a, b) => b.leads - a.leads)
  const closed = won + lost + abandoned
  return {
    totals: {
      leads, open, won, lost, abandoned, booked, shown, revenue: Math.round(revenue), openValue: Math.round(openValue),
      selfBooked, tagReadable: tagSeen > 0,
      avgWonValue: won ? Math.round(revenue / won) : 0,
      closeRate: closed ? +(100 * won / closed).toFixed(1) : 0,
      convRate: leads ? +(100 * won / leads).toFixed(1) : 0,
      avgDaysToWon: cycleN ? +(cycleSum / cycleN / 86400000).toFixed(1) : null,
    },
    pipelines,
    lostReasons: [...lostAgg.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
}

// Booked opportunities over a window, each tagged with its created date and
// first-touch paid channel (meta / google / other) — powers UTM-split
// cost-per-booked in the Daily Performance rolling windows.
export async function bookedTrends(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const [opps, idx] = await Promise.all([
    allOpportunities(locTok, locationId, from, to),
    pipelineStageIndex(locTok, locationId),
  ])
  const out = []
  for (const o of opps) {
    const pi = idx.get(o.pipelineId)
    const st = String(o.status || '').toLowerCase()
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const pos = stg ? stg.pos : -1
    const isWon = st === 'won'
    if (!(isWon || (pi && pi.bookPos != null && pos >= pi.bookPos))) continue
    out.push({ date: String(o.createdAt || '').slice(0, 10), channel: channelOf(utmOf(o)) })
  }
  return out
}

// Deals WON during [from,to] by status-change date, regardless of when the lead
// was created (the "realised revenue" lens). Split by pipeline / paid channel /
// assigned user so the Caalano360 + CRM filters can pivot it too. Looks back so
// old leads that close in-period are captured; capped, so very old-created deals
// may be missed (flagged via `capped`).
export async function wonInPeriod(locationId, from, to, lookbackDays = 400) {
  const locTok = await locationToken(locationId)
  const back = from ? new Date(new Date(from + 'T00:00:00Z').getTime() - lookbackDays * 86400000).toISOString().slice(0, 10) : from
  const CAP = 2500 // allOpportunities pages up to ~25×100
  const opps = await allOpportunities(locTok, locationId, back, to, CAP)
  const fromMs = from ? new Date(from + 'T00:00:00Z').getTime() : null
  const toMs = to ? new Date(to + 'T23:59:59Z').getTime() : null
  const capped = opps.length >= CAP
  const mk = () => ({ won: 0, revenue: 0 })
  const total = mk(), byPipeline = {}, byUser = {}, ch = { meta: mk(), google: mk(), other: mk() }
  for (const o of opps) {
    if (String(o.status || '').toLowerCase() !== 'won') continue
    const sc = Date.parse(o.lastStatusChangeAt); if (!sc) continue
    if (!((fromMs == null || sc >= fromMs) && (toMs == null || sc <= toMs))) continue
    const val = num(o.monetaryValue)
    total.won++; total.revenue += val
    const pid = o.pipelineId || 'none'; (byPipeline[pid] = byPipeline[pid] || mk()); byPipeline[pid].won++; byPipeline[pid].revenue += val
    const uid = o.assignedTo || 'unassigned'; (byUser[uid] = byUser[uid] || mk()); byUser[uid].won++; byUser[uid].revenue += val
    const cc = channelOf(utmOf(o)); ch[cc].won++; ch[cc].revenue += val
  }
  const fin = (x) => ({ won: x.won, revenue: Math.round(x.revenue), avgValue: x.won ? Math.round(x.revenue / x.won) : 0 })
  const finMap = (m) => { const o = {}; for (const k in m) o[k] = fin(m[k]); return o }
  return {
    total: fin(total), byPipeline: finMap(byPipeline), byUser: finMap(byUser),
    channels: { all: fin(total), meta: fin(ch.meta), google: fin(ch.google), other: fin(ch.other) },
    capped,
  }
}

// Lightweight source-tag coverage for one location (no pipeline/stage work):
// how many opportunities carry a UTM, split by classified channel.
export async function attributionCoverage(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const opps = await allOpportunities(locTok, locationId, from, to)
  let attributed = 0; const ch = { meta: 0, google: 0, other: 0 }
  for (const o of opps) { const u = utmOf(o); if (u.source || u.campaign) attributed++; ch[channelOf(u)]++ }
  return { opps: opps.length, attributed, meta: ch.meta, google: ch.google, other: ch.other }
}

export async function buildAttribution(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const [opps, pipelines, reasons, appts] = await Promise.all([
    allOpportunities(locTok, locationId, from, to),
    fetchPipelines(locTok, locationId),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map(), connected: false })),
  ])
  const idx = stageIndexFrom(pipelines)
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  // Join real booked appointments to each opportunity by contactId, so a booked
  // call counts even when the pipeline stage was never advanced. Tags ride on
  // the shared opp objects, so the per-channel buckets + rollups see them too.
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  let apptBookedOpps = 0
  for (const o of opps) {
    const a = apptByContact.get(contactIdOf(o))
    o._apptBooked = !!(a && a.booked > 0)
    o._apptShown = !!(a && a.shown > 0)
    if (o._apptBooked) apptBookedOpps++
  }
  const dim = { source: new Map(), medium: new Map(), campaign: new Map(), content: new Map(), term: new Map() }
  const bump = (map, keyRaw, o, pi) => {
    const key = keyRaw && String(keyRaw).trim() ? String(keyRaw).trim() : '(not set)'
    const e = map.get(key) || { name: key, leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 }
    e.leads++
    const st = String(o.status || '').toLowerCase()
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const pos = stg ? stg.pos : -1
    const isWon = st === 'won'
    if (isWon) { e.won++; e.revenue += num(o.monetaryValue) }
    if (isWon || o._apptBooked || (pi && pi.bookPos != null && pos >= pi.bookPos)) e.booked++
    if (isWon || o._apptShown || (pi && pi.showPos != null && pos >= pi.showPos)) e.shown++
    map.set(key, e)
  }
  // split opportunities by paid channel for the Caalano360 toggle
  const buckets = { meta: [], google: [], other: [] }
  // per-source drill-down: where each source's cohort ended up (pipeline stage,
  // status) plus its medium / campaign / creative breakdown.
  const srcDetail = new Map()
  const sd = (keyRaw) => {
    const key = keyRaw && String(keyRaw).trim() ? String(keyRaw).trim() : '(not set)'
    let e = srcDetail.get(key)
    if (!e) { e = { medium: new Map(), campaign: new Map(), content: new Map(), stages: new Map(), status: { won: 0, lost: 0, abandoned: 0, open: 0 } }; srcDetail.set(key, e) }
    return e
  }
  let attributed = 0
  for (const o of opps) {
    const u = utmOf(o)
    if (u.source || u.campaign) attributed++
    buckets[channelOf(u)].push(o)
    const pi = idx.get(o.pipelineId)
    bump(dim.source, u.source, o, pi)
    bump(dim.medium, u.medium, o, pi)
    bump(dim.campaign, u.campaign, o, pi)
    bump(dim.content, u.content, o, pi)
    bump(dim.term, u.term, o, pi)
    // per-source cohort detail
    const det = sd(u.source)
    const st = String(o.status || '').toLowerCase()
    if (st === 'won') det.status.won++; else if (st === 'lost') det.status.lost++; else if (st === 'abandoned') det.status.abandoned++; else det.status.open++
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const sname = stg ? stg.name : 'Unknown'; const spos = stg ? stg.pos : 999
    const se = det.stages.get(sname) || { name: sname, pos: spos, count: 0 }; se.count++; se.pos = Math.min(se.pos, spos); det.stages.set(sname, se)
    bump(det.medium, u.medium, o, pi)
    bump(det.campaign, u.campaign, o, pi)
    bump(det.content, u.content, o, pi)
  }
  const top = (map, n = 40) => [...map.values()].sort((a, b) => b.leads - a.leads).slice(0, n)
  const bySource = top(dim.source).map((r) => {
    const det = srcDetail.get(r.name)
    if (!det) return r
    return {
      ...r,
      detail: {
        stages: [...det.stages.values()].sort((a, b) => a.pos - b.pos),
        status: det.status,
        byMedium: top(det.medium, 20), byCampaign: top(det.campaign, 20), byCreative: top(det.content, 20),
      },
    }
  })
  return {
    connected: true, opps: opps.length, attributed,
    appointments: { connected: !!(appts && appts.connected), calendars: (appts && appts.calendars) || 0, events: (appts && appts.events) || 0, matchedOpps: apptBookedOpps },
    bySource, byMedium: top(dim.medium), byCampaign: top(dim.campaign, 200), byCreative: top(dim.content, 400), byTerm: top(dim.term, 400),
    channels: {
      all: rollupSubset(opps, idx, reasonName),
      meta: rollupSubset(buckets.meta, idx, reasonName),
      google: rollupSubset(buckets.google, idx, reasonName),
      other: rollupSubset(buckets.other, idx, reasonName),
    },
  }
}

// Full CRM rollup straight from GoHighLevel — richer than Windsor (named lost
// reasons, exact timestamps, per-user). User names come from Windsor for now
// (users.readonly deferred); assignedTo ids are returned for the caller to map.
// Aggregate one opportunity subset (whole account, or one pipeline) into
// totals + per-user + lost-reason breakdowns. Shared by the account view and
// every per-pipeline view so the whole CRM board can pivot by pipeline.
function aggregateCrm(opps, idx, reasonName) {
  let leads = 0, open = 0, won = 0, lost = 0, abandoned = 0, revenue = 0, openValue = 0, cycleSum = 0, cycleN = 0
  const byUser = new Map(), lostAgg = new Map(), lostByStage = new Map()
  for (const o of opps) {
    leads++
    const st = String(o.status || '').toLowerCase(); const val = num(o.monetaryValue); const uid = o.assignedTo || 'unassigned'
    const u = byUser.get(uid) || { id: uid, leads: 0, open: 0, won: 0, lost: 0, wonValue: 0, lostReasons: new Map() }
    u.leads++
    if (st === 'won') {
      won++; revenue += val; u.won++; u.wonValue += val
      const ca = Date.parse(o.createdAt), sc = Date.parse(o.lastStatusChangeAt)
      if (ca && sc && sc >= ca) { cycleSum += sc - ca; cycleN++ }
    } else if (st === 'lost' || st === 'abandoned') {
      if (st === 'lost') lost++; else abandoned++
      u.lost++
      const rn = reasonName[o.lostReasonId] || (o.lostReasonId ? 'Other' : 'Not set')
      lostAgg.set(rn, (lostAgg.get(rn) || 0) + 1)
      u.lostReasons.set(rn, (u.lostReasons.get(rn) || 0) + 1)
      const pi = idx.get(o.pipelineId); const sn = (pi && pi.byId[o.pipelineStageId]?.name) || 'Unknown'
      lostByStage.set(sn, (lostByStage.get(sn) || 0) + 1)
    } else { open++; openValue += val; u.open++ }
    byUser.set(uid, u)
  }
  const closed = won + lost + abandoned
  return {
    totals: {
      leads, open, won, lost, abandoned, revenue: Math.round(revenue), openValue: Math.round(openValue),
      avgWonValue: won ? Math.round(revenue / won) : 0,
      closeRate: closed ? +(100 * won / closed).toFixed(1) : 0,
      avgDaysToWon: cycleN ? +(cycleSum / cycleN / 86400000).toFixed(1) : null,
    },
    byUser: [...byUser.values()].map((u) => ({
      id: u.id, leads: u.leads, open: u.open, won: u.won, lost: u.lost, wonValue: Math.round(u.wonValue),
      convRate: u.leads ? +(100 * u.won / u.leads).toFixed(1) : 0,
      lostReasons: [...u.lostReasons.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    })).sort((a, b) => b.won - a.won || b.leads - a.leads),
    lostReasons: [...lostAgg.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    lostByStage: [...lostByStage.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count),
  }
}

// A full CRM board (totals + ordered per-pipeline funnels + lost reasons + per
// user) for an opportunity subset — the whole account, or one user's slice.
function crmBoard(opps, idx, reasonName) {
  const agg = aggregateCrm(opps, idx, reasonName)
  const byPipe = new Map()
  for (const o of opps) { const pid = o.pipelineId || 'none'; if (!byPipe.has(pid)) byPipe.set(pid, []); byPipe.get(pid).push(o) }
  const pipelines = [...byPipe.entries()].map(([pid, rows]) => {
    const pi = idx.get(pid); const at = new Map(), openAt = new Map()
    let l = 0, b = 0, sh = 0, w = 0
    for (const o of rows) {
      const sid = o.pipelineStageId; at.set(sid, (at.get(sid) || 0) + 1)
      const st = String(o.status || '').toLowerCase(); if (st !== 'lost' && st !== 'abandoned') openAt.set(sid, (openAt.get(sid) || 0) + 1)
      l++; const stg = pi ? pi.byId[sid] : null; const pos = stg ? stg.pos : -1; const isWon = st === 'won'
      if (isWon) w++; if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) b++; if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) sh++
    }
    const stages = (pi ? pi.stages : []).map((s) => ({ name: s.name, pos: s.pos, count: at.get(s.id) || 0, active: openAt.get(s.id) || 0 }))
    const a = aggregateCrm(rows, idx, reasonName)
    return { id: pid, name: (pi && pi.name) || 'Unnamed pipeline', leads: rows.length, stages, funnel: { leads: l, booked: b, shown: sh, won: w }, totals: a.totals, byUser: a.byUser, lostReasons: a.lostReasons, lostByStage: a.lostByStage }
  }).sort((a, b) => b.leads - a.leads)
  return { totals: agg.totals, pipelines, byUser: agg.byUser, lostReasons: agg.lostReasons, lostByStage: agg.lostByStage }
}

export async function buildCrm(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const [opps, pipelines, reasons] = await Promise.all([
    allOpportunities(locTok, locationId, from, to),
    fetchPipelines(locTok, locationId),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
  ])
  const idx = stageIndexFrom(pipelines)
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  const board = crmBoard(opps, idx, reasonName)

  // Per-user boards so the whole CRM view can be filtered to one assigned user.
  const byUid = new Map()
  for (const o of opps) { const uid = o.assignedTo || 'unassigned'; if (!byUid.has(uid)) byUid.set(uid, []); byUid.get(uid).push(o) }
  const users = [...byUid.entries()].map(([uid, rows]) => ({ id: uid, leads: rows.length, ...crmBoard(rows, idx, reasonName) })).sort((a, b) => b.leads - a.leads)

  return {
    connected: true,
    totals: board.totals,
    pipelines: board.pipelines,
    byUser: board.byUser,
    lostReasons: board.lostReasons,
    lostByStage: board.lostByStage,
    users,
  }
}

// Access/scope audit for one sub-account: can we mint a location token, and
// does each read scope work? Used by the agency-wide audit endpoint.
export async function auditLocation(locationId) {
  const out = {}
  let locTok
  try { locTok = await locationToken(locationId); out.access = 'ok' }
  catch (e) { out.access = 'FAIL: ' + String(e.message || e).replace(/\s+/g, ' ').slice(0, 140); return out }
  const probe = async (label, path, query) => {
    try { await ghlGet(locTok, path, query); out[label] = 'ok' }
    catch (e) { out[label] = 'FAIL ' + String(e.message || e).replace(/\s+/g, ' ').slice(0, 90) }
  }
  await probe('opportunities', '/opportunities/search', { location_id: locationId, limit: 1 })
  await probe('pipelines', '/opportunities/pipelines', { locationId })
  await probe('lostReasons', '/opportunities/lost-reason', { locationId, limit: 1 })
  await probe('contacts', '/contacts/', { locationId, limit: 1 })
  await probe('users', '/users/search', { locationId, limit: 1 })
  await probe('conversations', '/conversations/search', { locationId, limit: 1 })
  return out
}

// Contact-tag audit for the client self-booking tag ("customer booked
// appointment"). Reports (1) whether a booking-ish tag is DEFINED in the
// location and (2) how often it is actually APPLIED to opportunities' contacts,
// so we get per-client coverage and a contact self-booking rate (booked deals
// whose contact self-booked, split by paid channel). BOOK_TAG_RE / oppTags are
// shared with the attribution feed (defined near channelOf).
export async function tagAudit(locationId, sample = 400) {
  const locTok = await locationToken(locationId)
  // 1) Tags defined in the location (authoritative existence check).
  let definedCount = null, definedErr = null, definedMatches = []
  try {
    const j = await ghlGet(locTok, `/locations/${locationId}/tags`, {})
    const names = (j.tags || []).map((t) => t && t.name).filter(Boolean)
    definedCount = names.length
    definedMatches = [...new Set(names.filter((n) => BOOK_TAG_RE.test(n)))]
  } catch (e) { definedErr = String(e.message || e).replace(/\s+/g, ' ').slice(0, 120) }
  // 2) Applied coverage across recent opportunities (inline contact tags).
  const [opps, idx] = await Promise.all([
    allOpportunities(locTok, locationId, null, null, sample),
    pipelineStageIndex(locTok, locationId).catch(() => new Map()),
  ])
  const appliedNames = new Set()
  let tagsFieldSeen = 0, contactsWithTag = 0
  const mk = () => ({ booked: 0, self: 0 })
  const ch = { all: mk(), meta: mk(), google: mk(), other: mk() }
  for (const o of opps) {
    const c = o.contact || {}
    const tags = Array.isArray(c.tags) ? c.tags : (Array.isArray(o.tags) ? o.tags : null)
    if (tags != null) tagsFieldSeen++
    const matched = tags ? tags.filter((t) => BOOK_TAG_RE.test(String(t))) : []
    if (matched.length) { contactsWithTag++; matched.forEach((t) => appliedNames.add(String(t))) }
    const pi = idx.get(o.pipelineId); const st = String(o.status || '').toLowerCase()
    const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    const isBooked = st === 'won' || (pi && pi.bookPos != null && pos >= pi.bookPos)
    if (isBooked) {
      const cc = channelOf(utmOf(o))
      ch.all.booked++; ch[cc].booked++
      if (matched.length) { ch.all.self++; ch[cc].self++ }
    }
  }
  const rate = (x) => (x.booked ? Math.round((x.self / x.booked) * 100) : null)
  return {
    hasCrm: true,
    definedCount, definedErr, definedMatches: definedMatches.slice(0, 12),
    appliedNames: [...appliedNames].slice(0, 12),
    sampled: opps.length, contactTagsAvailable: tagsFieldSeen, contactsWithTag,
    booked: ch.all.booked, self: ch.all.self, selfBookRate: rate(ch.all),
    byChannel: { meta: { ...ch.meta, rate: rate(ch.meta) }, google: { ...ch.google, rate: rate(ch.google) }, other: { ...ch.other, rate: rate(ch.other) } },
    hasTag: definedMatches.length > 0 || appliedNames.size > 0,
  }
}

// Debug (PII-free): for a window, how many leads created in it have a booked /
// shown appointment - i.e. exactly what the opportunity-creation-date model
// counts. Returns creative/campaign names and dates only, never contact names.
export async function apptCohortCheck(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const [opps, appts] = await Promise.all([
    allOpportunities(locTok, locationId, from, to),
    fetchAppointments(locTok, locationId, from, to).catch((e) => ({ byContact: new Map(), connected: false, error: String(e.message || e).slice(0, 120) })),
  ])
  const byC = appts.byContact instanceof Map ? appts.byContact : new Map()
  const out = { from, to, oppsInWindow: opps.length, apptConnected: !!appts.connected, apptEvents: appts.events || 0, apptError: appts.error || null, bookedInCohort: 0, shownInCohort: 0, examples: [], leadDates: {} }
  for (const o of opps) {
    const d = String(o.createdAt || '').slice(0, 10); out.leadDates[d] = (out.leadDates[d] || 0) + 1
    const a = byC.get(contactIdOf(o))
    const booked = !!(a && a.booked > 0); const shown = !!(a && a.shown > 0)
    if (booked) out.bookedInCohort++
    if (shown) out.shownInCohort++
    if (booked && out.examples.length < 15) { const u = utmOf(o); out.examples.push({ leadCreated: d, utmContent: u.content, utmCampaign: u.campaign, shown }) }
  }
  return out
}

// Debug: raw opportunity + attribution shapes to confirm paid-UTM field names.
export async function sampleAttribution(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const opps = await allOpportunities(locTok, locationId, from, to, 20)
  const withUtm = opps.find((o) => (o.attributions || []).some((a) => a.utmCampaign || a.utmSource || a.utmContent))
  return {
    total: opps.length,
    firstThree: opps.slice(0, 3).map((o) => ({ status: o.status, source: o.source, pipelineStageId: o.pipelineStageId, attributions: o.attributions })),
    firstPaidExample: withUtm ? { name: withUtm.name, attributions: withUtm.attributions } : null,
  }
}
