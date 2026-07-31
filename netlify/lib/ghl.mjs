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

// --- timezone alignment ---
// Every CRM date window is interpreted in the client's Caalano Systems location
// timezone (auto-detected), so a "day" matches Meta (which reports in the ad
// account timezone) and the CRM UI. Without this the window was UTC, so an
// Australian "today" was really 10am->10am and morning leads slipped a day.
const DEF_TZ = 'Australia/Sydney'
const locTzCache = new Map()
export async function locationTimezone(locationId) {
  if (locTzCache.has(locationId)) return locTzCache.get(locationId)
  let tz = DEF_TZ
  try {
    const locTok = await locationToken(locationId)
    const j = await ghlGet(locTok, `/locations/${locationId}`, {})
    const cand = (j.location && j.location.timezone) || j.timezone || null
    if (cand) { try { new Intl.DateTimeFormat('en-US', { timeZone: cand }); tz = cand } catch { /* keep default */ } }
  } catch { /* keep default */ }
  locTzCache.set(locationId, tz)
  return tz
}
// Offset (tz local - UTC) in ms at a given instant, DST-aware.
function tzOffsetMs(tz, atMs) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = {}; for (const x of dtf.formatToParts(new Date(atMs))) p[x.type] = x.value
  const hh = p.hour === '24' ? 0 : +p.hour
  return Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute, +p.second) - atMs
}
// UTC ms for local midnight of `dateStr` (YYYY-MM-DD) in `tz`. Refines once so
// DST-transition days land on the correct instant.
function zonedStartMs(dateStr, tz) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0)
  const off = tzOffsetMs(tz, guess); let ms = guess - off
  const off2 = tzOffsetMs(tz, ms); if (off2 !== off) ms = guess - off2
  return ms
}
// UTC ms for the last millisecond of `dateStr` in `tz` (start of next day - 1).
function zonedEndMs(dateStr, tz) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d)); next.setUTCDate(next.getUTCDate() + 1)
  return zonedStartMs(next.toISOString().slice(0, 10), tz) - 1
}
// Local calendar date (YYYY-MM-DD) of an instant, in `tz`. Use this whenever we
// display which day something happened on, so it matches the counting windows.
function zonedDateStr(ms, tz) {
  if (ms == null || isNaN(ms)) return null
  return new Date(ms + tzOffsetMs(tz, ms)).toISOString().slice(0, 10)
}
// UTC ms bounds of [from,to] in a location's timezone. Lets other feeds (e.g.
// the Windsor CRM blend) filter opportunities to the same day window the direct
// API uses, so lead counts reconcile across the dashboard.
export async function periodBounds(locationId, from, to) {
  const tz = await locationTimezone(locationId)
  return { tz, fromMs: from ? zonedStartMs(from, tz) : null, toMs: to ? zonedEndMs(to, tz) : null }
}

// --- data pulls (paged, bounded) ---
// opportunities/search returns the opportunity, its contact AND an inline
// `attributions` array (first/last touch, UTMs) — one call, no N+1 lookups.
async function allOpportunities(locTok, locationId, from, to, cap = 1500) {
  // GHL opportunities/search has no startDate/endDate range params, so we page
  // newest-first and filter by createdAt in memory, stopping once a page is
  // entirely older than the window.
  const out = []; let startAfter, startAfterId, guard = 0
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
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

// "Qualified lead" — a definition that scales across every business with zero
// per-client setup. The signal is human intent: a lead is qualified once someone
// has actively advanced it past the pipeline's entry stage, OR it was won, OR it
// has a booked appointment, OR a deal value was set. Stage naming is irrelevant,
// so it works on any GoHighLevel pipeline out of the box. An optional per-client
// override (qualStagePos) names a specific stage position that must be reached
// instead of "past entry"; with the override set, only the stage (or a win)
// counts — the appointment / value shortcuts are ignored so the definition stays
// exactly what was configured.
export function isQualified({ status, pos, entryPos, hasAppt, value, qualStagePos }) {
  if (String(status || '').toLowerCase() === 'won') return true
  const threshold = qualStagePos != null ? qualStagePos : (entryPos ?? 0) + 1
  if (pos != null && pos >= 0 && pos >= threshold) return true
  if (qualStagePos != null) return false
  if (hasAppt) return true
  if (num(value) > 0) return true
  return false
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
  // Every string on the attribution that could fingerprint the channel, so
  // classification never depends on a single field (e.g. GHL often reports the
  // session source as "Paid Social" / "Paid Search" while the platform name
  // only appears in utm_source).
  const sig = [a.utmSessionSource, a.sessionSource, a.utmSource, a.utm_source, a.utmMedium, a.utm_medium, a.medium, a.utmCampaign, a.utm_campaign, a.campaign, a.utmAdSource, a.adSource, a.referrer, a.fbclid, a.gclid, a.fbAdId, a.adId]
    .filter(Boolean).join(' ').toLowerCase()
  return { source, medium, campaign, content, term, adId: a.adId || a.fbAdId || a.gclid || a.fbclid || null, sig }
}

// Classify an opportunity's first-touch UTMs into a paid channel so the whole
// Caalano360 view can pivot Meta-only / Google-only / All. Matches across every
// attribution string (utmOf.sig): platform names, click-ids, and the generic
// "Paid Social" (Meta) / "Paid Search" / cpc (Google) session-source labels.
const META_RE = /(facebook|instagram|\bfb\b|\bmeta\b|\big\b|fbclid|fb_|ig_|paid.?social)/i
const GOOGLE_RE = /(google|adwords|youtube|\bgdn\b|gclid|goog|dv360|gclsrc|paid.?search|\bcpc\b|\bppc\b|\bsem\b|search.?engine|google.?ads)/i
function channelOf(u) {
  const hay = u.sig || `${u.source || ''} ${u.medium || ''} ${u.campaign || ''} ${u.adId || ''}`.toLowerCase()
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

// Real booked calendar appointments per contact, on a "date of action" basis.
// GHL keeps appointments (calendar events) as a SEPARATE object from the
// opportunity pipeline stage. We pull appointments directly and tag each
// contact with:
//   bookedInPeriod - a booking was CREATED (dateAdded) within [from,to], so
//     Booked lands on the day the call was booked, no matter when the call is.
//   shownInPeriod  - a call HAPPENED (startTime) within [from,to] and the
//     contact showed, so Shown lands on the day the call took place.
//   cancelledInPeriod - every booking they made in-period was cancelled (a net
//     cancellation, not a reschedule that landed on a live booking).
// A booking counts as Booked on its creation day EVEN IF later cancelled - the
// creative did its job by generating the call - so only truly invalid records
// are excluded. Cancellations are tracked separately for transparency. The
// caller credits these only to lead contacts (those with an opportunity), which
// filters out internal/partner meetings on the same calendars. The fetch window
// (by startTime) reaches back a little and well forward so it captures both
// future-dated bookings made in-period and calls that occurred in-period.
const APPT_INVALID_RE = /invalid/i
const APPT_CANCEL_RE = /cancel/i
async function fetchAppointments(locTok, locationId, from, to) {
  const byContact = new Map()
  const nameByContact = new Map() // contactId -> display name from the calendar event
  // Same flags, but kept per (calendar × contact) so a client with several
  // booking types (e.g. an online consult then an on-site quote) can be split
  // by calendar. Deduping per contact WITHIN a calendar means a reschedule
  // (cancel-and-rebook or a moved startTime) still nets to a single booking,
  // while a genuinely different calendar counts as its own booking.
  const perCalendar = new Map() // calId -> { name, byContact: Map<cid, flags> }
  let calendars = []
  try {
    const j = await ghlGet(locTok, '/calendars/', { locationId })
    calendars = j.calendars || j.calendar || []
  } catch (e) { return { byContact, perCalendar, connected: false, error: String(e.message || e).slice(0, 120) } }
  const DAY = 86400000
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const startMs = (fromMs != null ? fromMs : Date.now() - 400 * DAY) - 7 * DAY
  const endMs = (toMs != null ? toMs : Date.now()) + 180 * DAY
  const inPeriod = (ms) => !isNaN(ms) && (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs)
  const markInto = (map, contactId, status, addedMs, startTimeMs) => {
    if (!contactId) return
    const s = String(status || '').toLowerCase()
    const invalid = APPT_INVALID_RE.test(s), cancelled = APPT_CANCEL_RE.test(s)
    const e = map.get(contactId) || { bookedInPeriod: false, shownByStatus: false, hasCallInPeriod: false, _live: false, _cancelled: false }
    if (!invalid && inPeriod(addedMs)) {
      e.bookedInPeriod = true // cancelled still counts as a booking on its creation day
      if (cancelled) e._cancelled = true; else e._live = true
    }
    if (s === 'showed' && inPeriod(startTimeMs)) e.shownByStatus = true
    // A live (not cancelled/invalid) call that took place in-period. Lets the
    // caller fall back to "shown by pipeline stage" when the appointment status
    // was never set but the opportunity was advanced past the shown stage.
    if (!invalid && !cancelled && inPeriod(startTimeMs)) e.hasCallInPeriod = true
    map.set(contactId, e)
  }
  let events = 0
  function mark(contactId, status, addedMs, startTimeMs) { markInto(byContact, contactId, status, addedMs, startTimeMs) }
  // Fetch every calendar's events in parallel - sequential per-calendar calls
  // were the dominant cost for multi-calendar clients (and pushed the overview
  // rows past the function timeout). Each calendar's events still land in its
  // own perCalendar bucket, so the per-calendar split is unchanged.
  await Promise.all(calendars.map(async (cal) => {
    const calId = cal.id || cal._id || cal.calendarId
    if (!calId) return
    let rec = perCalendar.get(calId)
    if (!rec) { rec = { id: calId, name: cal.name || cal.calendarName || 'Calendar', byContact: new Map() }; perCalendar.set(calId, rec) }
    try {
      const j = await ghlGet(locTok, '/calendars/events', { locationId, calendarId: calId, startTime: startMs, endTime: endMs })
      for (const ev of (j.events || [])) {
        events++
        const cid = ev.contactId || (ev.contact && (ev.contact.id || ev.contact._id)) || null
        // Capture the booked contact's name from the event so drills can show who
        // booked even when the contact has no opportunity created in the period.
        const nm = (ev.contact && (ev.contact.name || [ev.contact.firstName, ev.contact.lastName].filter(Boolean).join(' '))) || ev.contactName || null
        if (cid && nm && nm.trim() && !nameByContact.has(cid)) nameByContact.set(cid, nm.trim())
        // GHL sometimes returns the field misspelled as "appoinmentStatus".
        const st = ev.appointmentStatus || ev.appoinmentStatus || ev.status
        const added = Date.parse(ev.dateAdded), start = Date.parse(ev.startTime)
        mark(cid, st, added, start)
        markInto(rec.byContact, cid, st, added, start)
        // Earliest STAFF-booked (a user created it) live appointment per contact -
        // used as the manual-contact fallback for Speed to Lead when a client has
        // no messaging channel (the booking is a genuine manual action).
        if (cid && apptBookedBy(ev) === 'staff' && isFinite(added) && !/invalid|cancel/.test(String(st || '').toLowerCase())) {
          const e = byContact.get(cid); if (e && (!e.staffBookedMs || added < e.staffBookedMs)) e.staffBookedMs = added
        }
      }
    } catch { /* skip a calendar we cannot read; others still count */ }
  }))
  let bookedContacts = 0, shownContacts = 0, cancelledContacts = 0
  for (const e of byContact.values()) {
    // Net cancellation: they booked in-period and every one of those bookings
    // is cancelled (a reschedule that landed on a live booking is not counted).
    e.cancelledInPeriod = e._cancelled && !e._live
    if (e.bookedInPeriod) bookedContacts++
    if (e.shownByStatus) shownContacts++
    if (e.cancelledInPeriod) cancelledContacts++
  }
  // ADDITIVE: which calendar(s) each contact interacted with in-period, and
  // whether that booking occurred / showed / cancelled. Purely additive - the
  // existing bookedInPeriod / shownByStatus / hasCallInPeriod fields above are
  // untouched, so every other caller keeps working.
  for (const rec of perCalendar.values()) {
    for (const [cid, f] of rec.byContact) {
      if (!f.bookedInPeriod && !f.hasCallInPeriod && !f.shownByStatus) continue
      const e = byContact.get(cid); if (!e) continue
      if (!e.calendars) e.calendars = []
      e.calendars.push({ id: rec.id || null, name: rec.name, occurred: !!f.hasCallInPeriod, shown: !!f.shownByStatus, cancelled: !!(f._cancelled && !f._live) })
    }
  }
  return { byContact, perCalendar, nameByContact, connected: true, calendars: calendars.length, events, bookedContacts, shownContacts, cancelledContacts }
}

// Custom clients added at runtime via Settings -> Add client, stored in the
// shared settings blob's `clients` section: { id: { name, meta, google, ghl } }.
// The dashboard function merges these into its base registry so a client added
// in the UI is recognised across every data scope without a code change.
export async function customClients() {
  try {
    const all = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const c = all && all.clients
    if (!c || typeof c !== 'object') return {}
    const out = {}
    for (const [id, v] of Object.entries(c)) {
      if (!id || !v || typeof v !== 'object') continue
      if (!v.meta && !v.google && !v.ghl) continue
      out[id] = { name: v.name || id, meta: v.meta || null, google: v.google || null, ghl: v.ghl || null }
    }
    return out
  } catch { return {} }
}
// All Caalano Systems (GoHighLevel) sub-accounts under the agency, for the
// "add client" explorer: id + name so a new client can be mapped to its CRM.
export async function listLocations() {
  const t = await agencyToken()
  if (!t.companyId) throw new Error('No agency companyId on the stored token - re-authorise as the Agency (Company).')
  const out = []
  for (let skip = 0; skip < 2000 && out.length < 1000; skip += 100) {
    const url = new URL(API + '/locations/search')
    url.searchParams.set('companyId', t.companyId)
    url.searchParams.set('limit', '100')
    url.searchParams.set('skip', String(skip))
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t.access_token}`, Version: VER, Accept: 'application/json' } })
    const txt = await r.text()
    if (!r.ok) throw new Error(`ghl locations ${r.status}: ${txt.slice(0, 200)}`)
    let j; try { j = JSON.parse(txt) } catch { break }
    const locs = j.locations || j.location || []
    for (const l of locs) { const id = l.id || l._id; if (id) out.push({ id, name: l.name || l.businessName || id }) }
    if (locs.length < 100) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
// Lightweight calendar list for the Settings funnel-step editor: id + name only.
export async function listCalendars(locationId) {
  const locTok = await locationToken(locationId)
  const j = await ghlGet(locTok, '/calendars/', { locationId })
  const cals = j.calendars || j.calendar || []
  return cals.map((c) => ({ id: c.id || c._id || c.calendarId, name: c.name || c.calendarName || 'Calendar' })).filter((c) => c.id)
}

// Per-form performance: group leads by the form they filled out (Meta Lead
// Forms by their real facebookFormName, GHL/website forms by name) and tie each
// contact to its opportunity outcome, so friction / qualification levels can be
// compared (fewer but higher-converting leads vs more but lower-quality).
export async function buildForms(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const DAY = 86400000
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - 120 * DAY).toISOString().slice(0, 10)
  const formName = {}
  const cfById = {} // custom-field id -> human label, so answer keys read as real questions
  await Promise.all([
    ghlGet(locTok, '/forms/', { locationId, limit: 100 }).then((j) => { for (const f of (j.forms || [])) formName[f.id] = f.name }).catch(() => {}),
    ghlGet(locTok, `/locations/${locationId}/customFields`, {}).then((j) => { for (const f of (j.customFields || j.customField || [])) { if (f.id) cfById[f.id] = f.name; if (f.fieldKey) cfById[f.fieldKey] = f.name } }).catch(() => {}),
  ])
  // Turn a raw submission key into a readable question label.
  const labelKey = (k) => cfById[k] || cfById[k.replace(/^contact\./, '')] || k.replace(/^contact\./, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  // All submissions in the window (paginated).
  const subs = []
  try {
    for (let page = 1; page <= 10; page++) {
      const j = await ghlGet(locTok, '/forms/submissions', { locationId, limit: 100, page, startAt: from, endAt: to })
      const arr = j.submissions || []; subs.push(...arr)
      if (arr.length < 100) break
    }
  } catch (e) { return { connected: true, error: String(e.message || e).slice(0, 160), forms: [] } }
  // Credit each contact to the form that BROUGHT THEM IN (their chronologically
  // earliest submission), not whichever the API happened to return first. GHL
  // returns submissions newest-first, so without this a Meta lead who later
  // booked via the calendar form was miscredited to the calendar form.
  const subMs = (s) => {
    const o = s.others || {}
    const raw = s.createdAt || s.dateAdded || s.submittedAt || s.date
      || (o.facebookLeadSubmissionDetails && o.facebookLeadSubmissionDetails.created_time)
      || (o.eventData && o.eventData.timestamp)
    const t = typeof raw === 'number' ? raw : Date.parse(raw || '')
    return Number.isFinite(t) ? t : Infinity
  }
  subs.sort((a, b) => subMs(a) - subMs(b))
  const labelOf = (s) => {
    const o = s.others || {}
    const fb = o.facebookFormName || o['Facebook Form Name'] || o.fbFormName
    if (fb) return { label: String(fb).trim(), kind: 'facebook' }
    const nm = formName[s.formId]
    if (nm) return { label: nm, kind: 'website' }
    return { label: s.formId || 'Unknown form', kind: 'other' }
  }
  // First form each contact submitted in the window (their entry point), plus
  // the ad campaigns / ad sets / creatives that drove each form (from the
  // submission UTMs: utm_campaign = campaign, utm_medium = ad set, utm_content =
  // creative) so the Meta tab can attribute spend and drill in by form.
  // System / free-text / PII answer keys we never segment on.
  const SYS_KEY = /^(formId|location_?id|sessionId|submissionId|timezone|calendar|selected_|source$|^type$|productType|facebookLead|facebookForm|postal_?code|message|additional|comment|first_?name|last_?name|full_?name|^name$|email|phone|signature|^ip$|contact_?id|funnel|page|utm|fbclid|gclid|why do you|how did you hear|organization)/i
  const contactData = new Map() // cid -> { L, answers: {question: value} }
  const formUtm = new Map()
  for (const s of subs) {
    const L = labelOf(s)
    const o = s.others || {}
    const utm = (o.eventData && o.eventData.url_params) || {}
    let fu = formUtm.get(L.label); if (!fu) { fu = { campaigns: new Set(), adsets: new Set(), creatives: new Set() }; formUtm.set(L.label, fu) }
    if (utm.utm_campaign) fu.campaigns.add(String(utm.utm_campaign))
    if (utm.utm_medium) fu.adsets.add(String(utm.utm_medium))
    if (utm.utm_content) fu.creatives.add(String(utm.utm_content))
    const cid = s.contactId; if (!cid || contactData.has(cid)) continue
    const answers = {}
    // Coerce an answer value to a display string. Meta Lead Form answers often
    // arrive as arrays (multi-select) or numbers, and some are nested one level
    // under a container object - website forms use plain top-level strings. All
    // three should segment, so handle each shape instead of dropping non-strings.
    const put = (k, v) => {
      if (SYS_KEY.test(k)) return
      let str = null
      if (Array.isArray(v)) str = v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).join(', ')
      else if (typeof v === 'number' && Number.isFinite(v)) str = String(v)
      else if (typeof v === 'string') str = v.trim()
      if (!str || str.length > 200) return
      answers[labelKey(k)] = str
    }
    for (const [k, v] of Object.entries(o)) {
      // Meta Lead Form answers live in a `customFields` ARRAY of {id/key, value}
      // objects (budget, pool type, timeframe…) - website forms use plain
      // top-level string keys. Parse each element by its custom-field id.
      if (Array.isArray(v)) {
        if (/^(customFields|custom_fields|customData|fields)$/i.test(k)) {
          for (const el of v) {
            if (el && typeof el === 'object') put(el.id || el.key || el.fieldKey || el.name, el.value !== undefined ? el.value : (el.field_value !== undefined ? el.field_value : el.fieldValue))
          }
        } else put(k, v) // array of primitives (a multi-select)
        continue
      }
      // Descend one level into answer containers (customData/formData/…), but not
      // into system envelopes (eventData carries UTMs/page/session, not answers).
      if (v && typeof v === 'object') {
        if (/^(customData|formData|form_data|answers|fields|data)$/i.test(k)) for (const [k2, v2] of Object.entries(v)) put(k2, v2)
        continue
      }
      put(k, v)
    }
    // Postcode is denied for segmentation (PII-ish) but wanted for the location
    // breakdown, so capture it separately from the submission.
    const pc = String(o.postalCode || o.postal_code || o.postal || (o.customFields && '') || '').trim()
    // Contact name for the per-answer people drill (PII stays server-side until a
    // row is expanded). Prefer an explicit full name, else first+last, else email.
    const nm = String(o.full_name || o.fullName || o.name || [o.first_name || o.firstName, o.last_name || o.lastName].filter(Boolean).join(' ') || o.email || '').trim()
    contactData.set(cid, { L, answers, pc, name: nm })
  }
  const [wideOpps, appts, pipelines] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 1800),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map(), connected: false })),
    fetchPipelines(locTok, locationId).catch(() => []),
  ])
  const pipeName = {}; for (const p of pipelines) pipeName[p.id] = p.name
  const idx = stageIndexFrom(pipelines)
  const nowMs = Date.now()
  const nameOfOpp = (o) => (o && ((o.contact && (o.contact.name || [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' '))) || o.contactName || o.name)) || null
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const oppByContact = new Map()
  for (const o of wideOpps) { const cid = contactIdOf(o); if (cid && !oppByContact.has(cid)) oppByContact.set(cid, o) }
  // A question that captures where the lead is (postcode/suburb/area) - used for
  // the location breakdown.
  const LOC_RE = /(location|suburb|postcode|postal|\barea\b|region|\btown\b|\bcity\b|where.*(build|project|located))/i
  const agg = new Map()
  const ent = (L) => { let e = agg.get(L.label); if (!e) { e = { form: L.label, kind: L.kind, leads: 0, booked: 0, shown: 0, won: 0, revenue: 0, seg: new Map(), byPipe: new Map(), loc: new Map(), people: [] } ; agg.set(L.label, e) } return e }
  const bump = (o, booked, shown, won, rev) => { o.leads++; if (booked) o.booked++; if (shown) o.shown++; if (won) { o.won++; o.revenue += rev } }
  const bumpLoc = (m, value, booked, won, lost) => { if (!value) return; let a = m.get(value); if (!a) { a = { value, leads: 0, booked: 0, won: 0, lost: 0 }; m.set(value, a) } a.leads++; if (booked) a.booked++; if (won) a.won++; if (lost) a.lost++ }
  for (const [cid, { L, answers, pc, name }] of contactData) {
    const e = ent(L)
    const f = apptByContact.get(cid); const booked = !!(f && f.bookedInPeriod); const shown = !!(f && f.shownByStatus)
    const o = oppByContact.get(cid); const st = o ? String(o.status || '').toLowerCase() : ''; const won = st === 'won'; const lost = st === 'lost' || st === 'abandoned'; const rev = won ? num(o.monetaryValue) : 0
    bump(e, booked, shown, won, rev)
    // One person record per contact, attached to each answer value they gave, so
    // the Forms drill can list who gave an answer, where they are in the funnel
    // and which key events they reached (frontend reuses the key-event helpers).
    const pi = o ? idx.get(o.pipelineId) : null
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const aMs = o ? Date.parse(o.lastStageChangeAt || o.lastStatusChangeAt || o.createdAt) : NaN
    const cMs = o ? Date.parse(o.createdAt) : NaN
    const person = {
      contactId: cid,
      name: nameOfOpp(o) || name || 'Lead',
      status: won ? 'won' : lost ? 'lost' : 'open',
      stageName: stg ? stg.name : null,
      stagePos: stg ? stg.pos : null,
      pipelineId: (o && o.pipelineId) || null,
      pipelineName: o && o.pipelineId ? (pipeName[o.pipelineId] || 'Pipeline') : null,
      value: o ? num(o.monetaryValue) : 0,
      ageDays: isFinite(aMs) ? Math.max(0, Math.round((nowMs - aMs) / DAY)) : null,
      booked, shown, occurred: !!(f && f.hasCallInPeriod),
      calendars: f && Array.isArray(f.calendars) ? f.calendars.map((c) => ({ name: c.name, occurred: !!c.occurred, shown: !!c.shown })) : [],
      channel: o ? channelOf(utmOf(o)) : null,
      createdMs: isFinite(cMs) ? cMs : null,
      lastActivityDays: isFinite(aMs) ? Math.max(0, Math.round((nowMs - aMs) / DAY)) : null,
    }
    // One record per distinct contact credited to this form (its entry point),
    // so the frontend can run the form's people through the client's key events
    // (same shape as the per-answer people). Capped to keep the payload small.
    if (e.people.length < 120) e.people.push(person)
    // Per-pipeline split, so a multi-pipeline client can categorise a form.
    const pid = o && o.pipelineId
    if (pid) { let bp = e.byPipe.get(pid); if (!bp) { bp = { id: pid, name: pipeName[pid] || 'Pipeline', leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 }; e.byPipe.set(pid, bp) } bump(bp, booked, shown, won, rev) }
    // Location breakdown: postcode + any location-style answer.
    if (pc && /^[0-9A-Za-z\- ]{3,10}$/.test(pc)) bumpLoc(e.loc, pc, booked, won, lost)
    // Answer-level segmentation: per question, per answer value.
    for (const [q, v] of Object.entries(answers)) {
      let qm = e.seg.get(q); if (!qm) { qm = new Map(); e.seg.set(q, qm) }
      let av = qm.get(v); if (!av) { av = { value: v, leads: 0, booked: 0, shown: 0, won: 0, revenue: 0, people: [] }; qm.set(v, av) }
      bump(av, booked, shown, won, rev)
      if (av.people.length < 80) av.people.push(person)
      if (LOC_RE.test(q)) bumpLoc(e.loc, v, booked, won, lost)
    }
  }
  const forms = [...agg.values()].sort((a, b) => b.leads - a.leads).map((e) => {
    const fu = formUtm.get(e.form) || { campaigns: new Set(), adsets: new Set(), creatives: new Set() }
    // Show EVERY question the form captured - multiple-choice AND written/free-text
    // (Suburb, project notes, timeframe, …). Each question is tagged 'choice'
    // (few repeating options) or 'written' (mostly unique answers) so the UI can
    // label it. We only drop a question that is a single constant value given by
    // every lead (a hidden/system field), and cap very long free-text lists.
    const ROW_CAP = 60
    const segments = [...e.seg.entries()]
      .map(([question, qm]) => {
        const answers = [...qm.values()].sort((a, b) => b.leads - a.leads)
        const total = answers.reduce((a, x) => a + x.leads, 0)
        const kind = answers.length > 12 && answers.every((x) => x.leads <= 1) ? 'written' : 'choice'
        // Choice questions keep their per-answer people list (for the drill-down);
        // high-cardinality free-text drops it to avoid bloating the payload.
        const shown = answers.slice(0, ROW_CAP).map((a) => (kind === 'written' ? (({ people, ...rest }) => rest)(a) : a))
        return { question, kind, total, distinct: answers.length, more: Math.max(0, answers.length - shown.length), answers: shown }
      })
      // drop a lone constant answer that every lead gave (system/hidden field)
      .filter((s) => !(s.distinct === 1 && s.total >= e.leads && e.leads > 2))
      .filter((s) => s.total >= 1)
      .sort((a, b) => (a.kind === b.kind ? b.total - a.total : a.kind === 'choice' ? -1 : 1))
    // Auto-description: the questions this form asks (for identifying it).
    const questions = [...e.seg.keys()]
    // Per-pipeline performance (multi-pipeline clients) + location distribution.
    const byPipeline = [...e.byPipe.values()].sort((a, b) => b.leads - a.leads)
    const locations = [...e.loc.values()].sort((a, b) => b.leads - a.leads).slice(0, 200)
    const { seg, byPipe, loc, ...rest } = e
    return { ...rest, capturedQuestions: seg.size, questions, byPipeline, locations, campaigns: [...fu.campaigns], adsets: [...fu.adsets], creatives: [...fu.creatives], segments }
  })
  // Pipelines carry their ordered stages (id + name + position) so the frontend
  // can map configured key events to stage positions for the per-answer funnel.
  return { connected: true, tz, submissions: subs.length, contacts: contactData.size, pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: (p.stages || []).map((s, i) => ({ id: s.id, name: s.name, pos: s.position ?? i })).sort((a, b) => a.pos - b.pos) })), forms }
}

// Read-only probe for the Forms feature: the location's forms (id -> name), a
// few recent submissions with PII redacted, and the custom-field definitions -
// so we can see how Meta Lead Forms vs GHL funnel forms are actually structured
// (form name on the submission vs a "Facebook Form Name" custom field) before
// building the full By-Form performance view.
export async function sampleForms(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const out = { locationId }
  const cfById = {}
  try {
    const j = await ghlGet(locTok, `/locations/${locationId}/customFields`, {})
    const fields = j.customFields || j.customField || []
    out.customFields = fields.slice(0, 80).map((f) => ({ id: f.id, name: f.name, key: f.fieldKey, dataType: f.dataType }))
    for (const f of fields) cfById[f.id] = f.name
    out.formNameFields = fields.filter((f) => /form.?name/i.test(`${f.name || ''} ${f.fieldKey || ''}`)).map((f) => ({ id: f.id, name: f.name, key: f.fieldKey }))
  } catch (e) { out.customFieldsError = String(e.message || e).slice(0, 180) }
  const formName = {}
  try {
    const j = await ghlGet(locTok, '/forms/', { locationId, limit: 100 })
    const forms = j.forms || []
    out.formsCount = forms.length
    out.forms = forms.slice(0, 60).map((f) => ({ id: f.id, name: f.name }))
    for (const f of forms) formName[f.id] = f.name
  } catch (e) { out.formsError = String(e.message || e).slice(0, 180) }
  const PII = /email|phone|first_?name|last_?name|full_?name|^name$|address|signature|^ip$/i
  const redact = (v) => (typeof v === 'string' && /@|\+?\d{7,}/.test(v) ? '***' : v)
  // Describe a value's shape without leaking PII: type, and for objects/arrays
  // their sub-keys / element types, so we can see exactly where Meta Lead Form
  // answers live (top-level string vs array vs nested container).
  const shapeOf = (v) => {
    if (Array.isArray(v)) return `array[${v.length}]<${[...new Set(v.map((x) => (x && typeof x === 'object' ? 'object' : typeof x)))].join('|')}>`
    if (v && typeof v === 'object') return `object{${Object.keys(v).slice(0, 25).join(',')}}`
    return typeof v
  }
  try {
    const q = { locationId, limit: 40 }; if (from) q.startAt = from; if (to) q.endAt = to
    const j = await ghlGet(locTok, '/forms/submissions', q)
    const subs = j.submissions || []
    out.submissionsTotal = (j.meta && j.meta.total != null) ? j.meta.total : subs.length
    const describe = (s) => {
      const o = s.others || {}
      const answers = {}
      for (const [k, v] of Object.entries(o)) {
        if (PII.test(k) || v == null || typeof v === 'object') continue
        answers[cfById[k] || k] = redact(v)
      }
      const utm = (o.eventData && o.eventData.url_params) || null
      const isFb = !!(o.facebookFormName || o['Facebook Form Name'] || o.fbFormName)
      return {
        formId: s.formId,
        formName: formName[s.formId] || null,
        fbFormName: o.facebookFormName || o['Facebook Form Name'] || o.fbFormName || null,
        kind: isFb ? 'facebook' : (formName[s.formId] ? 'website' : 'other'),
        source: o.source || (o.internalSource && o.internalSource.type) || null,
        utm: utm ? { source: utm.utm_source, medium: utm.utm_medium, campaign: utm.utm_campaign, content: utm.utm_content } : null,
        // Full key -> shape map (PII-safe) so nested / array answer stores are visible.
        othersShape: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shapeOf(v)])),
        answerKeys: Object.keys(answers).slice(0, 20),
        answers,
      }
    }
    const fb = subs.filter((s) => { const o = s.others || {}; return o.facebookFormName || o['Facebook Form Name'] || o.fbFormName })
    // Prioritise showing Meta Lead Form submissions (the ones not segmenting).
    out.sample = [...fb.slice(0, 5), ...subs.filter((s) => !fb.includes(s)).slice(0, 5)].map(describe)
  } catch (e) { out.submissionsError = String(e.message || e).slice(0, 200) }
  return out
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
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const capped = opps.length >= CAP
  const mk = () => ({ won: 0, revenue: 0 })
  const total = mk(), byPipeline = {}, byUser = {}, ch = { meta: mk(), google: mk(), other: mk() }
  let cycSum = 0, cycN = 0 // average create->won time, for data-maturity only
  for (const o of opps) {
    if (String(o.status || '').toLowerCase() !== 'won') continue
    const sc = Date.parse(o.lastStatusChangeAt); if (!sc) continue
    // Sales-cycle length across every won deal in the lookback window (not just
    // those won in-period), so the average is stable. Used only to judge data
    // maturity, never shown as a KPI.
    const cr = Date.parse(o.createdAt)
    if (isFinite(cr)) { const d = (sc - cr) / 86400000; if (d >= 0 && d < 400) { cycSum += d; cycN++ } }
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
    avgCloseDays: cycN ? Math.round(cycSum / cycN) : null, avgCloseSample: cycN,
    capped,
  }
}

// Deal-level lists for the Monthly Report — powers drill-downs, the Lost Reasons
// view and the Status-Change vs Created-On revenue split. Two won bases:
//   statusChange = deals whose status became "won" IN the month (any lead date)
//   createdOn    = deals whose LEAD was created in the month and are now won
// plus lost deals (marked lost in the month) with reasons. Each deal carries the
// contact name, lead-created date, status-change (won/lost) date, value, source
// channel, pipeline/stage and assigned user — everything needed to sense-check.
export async function monthlyDeals(locationId, from, to, lookbackDays = 400) {
  const locTok = await locationToken(locationId)
  const back = from ? new Date(new Date(from + 'T00:00:00Z').getTime() - lookbackDays * 86400000).toISOString().slice(0, 10) : from
  const CAP = 3000
  const [opps, pipelines, reasons, tz] = await Promise.all([
    allOpportunities(locTok, locationId, back, to, CAP),
    fetchPipelines(locTok, locationId),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
    locationTimezone(locationId),
  ])
  const idx = stageIndexFrom(pipelines)
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const inWin = (ms) => (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs)
  const nameOf = (o) => (o && ((o.contact && (o.contact.name || [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' ').trim())) || o.contactName || o.name)) || 'Unknown contact'
  const pInfo = (o) => idx.get(o.pipelineId) || null
  const deal = (o, whenMs) => {
    const p = pInfo(o); const stg = p && p.byId ? p.byId[o.pipelineStageId] : null
    return {
      name: nameOf(o),
      createdAt: o.createdAt ? String(o.createdAt).slice(0, 10) : null,
      statusAt: isFinite(whenMs) ? new Date(whenMs).toISOString().slice(0, 10) : null,
      value: num(o.monetaryValue), channel: channelOf(utmOf(o)),
      pipeline: p ? p.name : null, stage: stg ? stg.name : null,
      userId: o.assignedTo || 'unassigned', reason: o.lostReasonId ? (reasonName[o.lostReasonId] || 'Other') : null,
    }
  }
  const wonSC = [], wonCO = [], lost = []
  for (const o of opps) {
    const st = String(o.status || '').toLowerCase()
    const scMs = Date.parse(o.lastStatusChangeAt), crMs = Date.parse(o.createdAt)
    if (st === 'won') {
      if (isFinite(scMs) && inWin(scMs)) wonSC.push(deal(o, scMs))
      if (isFinite(crMs) && inWin(crMs)) wonCO.push(deal(o, scMs))
    } else if (st === 'lost' || st === 'abandoned') {
      if (isFinite(scMs) && inWin(scMs)) lost.push(deal(o, scMs))
    }
  }
  const isPaid = (c) => c === 'meta' || c === 'google'
  const sumV = (arr) => arr.reduce((s, d) => s + d.value, 0)
  const aggWon = (deals) => {
    const paid = deals.filter((d) => isPaid(d.channel))
    const byUser = {}, byChannel = { meta: { count: 0, revenue: 0 }, google: { count: 0, revenue: 0 }, other: { count: 0, revenue: 0 } }
    for (const d of deals) {
      const u = byUser[d.userId] = byUser[d.userId] || { count: 0, revenue: 0 }; u.count++; u.revenue += d.value
      const c = byChannel[isPaid(d.channel) ? d.channel : 'other']; c.count++; c.revenue += d.value
    }
    for (const k in byUser) byUser[k].revenue = Math.round(byUser[k].revenue)
    for (const k in byChannel) byChannel[k].revenue = Math.round(byChannel[k].revenue)
    // Average time to close = days from lead created → deal won, across deals that
    // have both dates.
    const spans = deals.map((d) => { const c = Date.parse(d.createdAt), s = Date.parse(d.statusAt); return (isFinite(c) && isFinite(s) && s >= c) ? (s - c) / 86400000 : null }).filter((v) => v != null)
    return {
      count: deals.length, revenue: Math.round(sumV(deals)), avgValue: deals.length ? Math.round(sumV(deals) / deals.length) : 0,
      avgCloseDays: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null,
      paid: { count: paid.length, revenue: Math.round(sumV(paid)) }, byUser, byChannel,
      deals: deals.sort((a, b) => b.value - a.value).slice(0, 500),
    }
  }
  const lostByReason = {}
  for (const d of lost) { const r = d.reason || 'Not set'; const e = lostByReason[r] = lostByReason[r] || { count: 0, value: 0 }; e.count++; e.value += d.value }
  return {
    statusChange: { won: aggWon(wonSC) },
    createdOn: { won: aggWon(wonCO) },
    lost: {
      total: { count: lost.length, value: Math.round(sumV(lost)) },
      byReason: Object.entries(lostByReason).map(([name, v]) => ({ name, count: v.count, value: Math.round(v.value) })).sort((a, b) => b.count - a.count),
      deals: lost.sort((a, b) => b.value - a.value).slice(0, 500),
    },
    capped: opps.length >= CAP,
  }
}

// Opportunity custom fields for a location, date/time ones first — powers the
// Settings dropdown that links a Key Event stage to the timestamp field GHL
// stamps when a deal enters it. GHL v2 tags each field with a `model`
// (contact|opportunity); if that's absent we keep all and just flag date types.
export async function oppTimestampFields(locationId) {
  const locTok = await locationToken(locationId)
  let fields = []
  try {
    const j = await ghlGet(locTok, `/locations/${locationId}/customFields`, { model: 'opportunity' })
    fields = j.customFields || j.customField || []
  } catch { /* fall back to unfiltered below */ }
  if (!fields.length) {
    try { const j = await ghlGet(locTok, `/locations/${locationId}/customFields`, {}); fields = j.customFields || j.customField || [] } catch { fields = [] }
  }
  const isOpp = (f) => !f.model || /opportunit/i.test(String(f.model))
  const isDate = (f) => /date|time/i.test(String(f.dataType || ''))
  return fields.filter(isOpp).map((f) => ({ id: f.id, key: f.fieldKey || f.id, name: f.name || f.fieldKey || f.id, dataType: f.dataType || null, date: isDate(f) }))
    .sort((a, b) => (Number(b.date) - Number(a.date)) || String(a.name).localeCompare(String(b.name)))
}

// Inbound social DMs from the GoHighLevel inbox — how many conversations were
// started via Instagram / Facebook Messenger in the period. GHL tags each
// conversation/message with a channel type (TYPE_INSTAGRAM / TYPE_FACEBOOK).
// We page conversations newest-first and count those whose channel is IG/FB and
// whose start (dateAdded, falling back to last message) lands in the window.
// opts.debug returns a raw sample so channel field names can be verified live.
export async function socialDMs(locationId, from, to, opts = {}) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const chanOf = (c) => { const t = String(c.type || c.lastMessageType || c.lastOutboundMessageType || '').toUpperCase(); if (/INSTAGRAM|(^|_)IG(_|$)/.test(t)) return 'ig'; if (/FACEBOOK|MESSENGER|(^|_)FB(_|$)/.test(t)) return 'fb'; return null }
  const ms = (v) => (typeof v === 'number' ? v : Date.parse(v))
  const res = { ig: 0, fb: 0, daily: {}, scanned: 0, capped: false }; const sample = []
  let startAfterDate = null, startAfter = null
  const CAP = 25
  for (let page = 0; page < CAP; page++) {
    const q = { locationId, limit: 100, sortBy: 'last_message_date', sort: 'desc' }
    if (startAfterDate) q.startAfterDate = startAfterDate
    if (startAfter) q.startAfter = startAfter
    const j = await ghlGet(locTok, '/conversations/search', q).catch(() => null)
    const convs = (j && (j.conversations || j.conversation)) || []
    if (!convs.length) break
    let oldest = Infinity
    for (const c of convs) {
      res.scanned++
      const startMs = ms(c.dateAdded || c.dateCreated || c.createdAt) || ms(c.lastMessageDate)
      const lastMs = ms(c.lastMessageDate) || startMs
      if (isFinite(lastMs)) oldest = Math.min(oldest, lastMs)
      const ch = chanOf(c)
      if (opts.debug && sample.length < 15) sample.push({ id: c.id, type: c.type, lastMessageType: c.lastMessageType, dateAdded: c.dateAdded, lastMessageDate: c.lastMessageDate, ch })
      if (!ch) continue
      const s = isFinite(startMs) ? startMs : lastMs
      if (fromMs != null && s < fromMs) continue
      if (toMs != null && s > toMs) continue
      res[ch]++
      const d = new Date(s).toISOString().slice(0, 10); (res.daily[d] = res.daily[d] || { ig: 0, fb: 0 })[ch]++
    }
    const last = convs[convs.length - 1]
    startAfterDate = ms(last.lastMessageDate) || null; startAfter = last.id || last._id || null
    if (convs.length < 100) break
    if (fromMs != null && isFinite(oldest) && oldest < fromMs) break
    if (page === CAP - 1) res.capped = true
  }
  const daily = Object.entries(res.daily).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))
  return { ig: res.ig, fb: res.fb, total: res.ig + res.fb, daily, scanned: res.scanned, capped: res.capped, ...(opts.debug ? { sample } : {}) }
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

// --- Speed to Lead ---------------------------------------------------------
// Time from a lead coming in (opportunity created) to the FIRST *manual* (human,
// non-automated) outbound message to that contact. Automated sends (workflows /
// campaigns / bulk) are excluded so this measures how fast a person actually
// reaches out. Expensive (a conversations + messages call per contact), so it
// samples the most recent N leads and runs with a small concurrency pool + a
// wall-clock budget. Returns a distribution + median/avg + a source breakdown so
// the manual-vs-automated classification can be sanity-checked.
const AUTO_SRC_RE = /workflow|campaign|bulk|trigger|automat|api\b|integration|zapier|rule|sequence|reply|auto/i
function msgUserId(m) { return m.userId || m.user_id || (m.meta && m.meta.userId) || null }
function classifyOutbound(m) {
  const src = String(m.source || '').toLowerCase()
  if (AUTO_SRC_RE.test(src)) return 'automated'
  // Manual requires a human user attribution. A send with no userId - even one
  // tagged source "app" - is treated as automated, because an instant auto-reply
  // / integration send carries no user. (This was the Finr false-"under 5 min":
  // app-sourced auto-sends with no userId were counted as human replies.)
  return msgUserId(m) ? 'manual' : 'automated'
}
// Bounded-concurrency map (no external deps) - runs `fn` over items, `n` at once.
async function mapPool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx) } catch { out[idx] = null } }
  })
  await Promise.all(workers)
  return out
}
function nextDateStr(dateStr) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
// Minutes of business time between two instants, given working hours (a set of
// weekdays + open/close minute-of-day) in the location timezone. Without hours
// it's just wall-clock. Used so a lead that arrives at 11pm and gets a reply at
// 9am isn't scored as a 10-hour response - it's ~0 working minutes.
function businessMinutesBetween(aMs, bMs, hours, tz) {
  if (!(bMs > aMs)) return 0
  if (!hours) return (bMs - aMs) / 60000
  let total = 0, guard = 0, dateStr = zonedDateStr(aMs, tz)
  while (guard++ < 120) {
    const dayMid = zonedStartMs(dateStr, tz)
    if (dayMid > bMs) break
    const dow = new Date(dayMid + tzOffsetMs(tz, dayMid)).getUTCDay()
    if (hours.days.includes(dow)) {
      const s = Math.max(dayMid + hours.startMin * 60000, aMs)
      const e = Math.min(dayMid + hours.endMin * 60000, bMs)
      if (e > s) total += (e - s) / 60000
    }
    dateStr = nextDateStr(dateStr)
  }
  return total
}
// Auto-detect a location's working hours from its calendars' openHours (union of
// open weekdays + earliest open / latest close). Falls back to Mon-Fri 9-5.
export async function deriveBusinessHours(locationId) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  let cals = []
  try { const j = await ghlGet(locTok, '/calendars/', { locationId }); cals = j.calendars || j.calendar || [] } catch { /* default below */ }
  const days = new Set(); let minOpen = Infinity, maxClose = -Infinity
  for (const c of cals) {
    const oh = c.openHours || c.availability || c.availabilities || []
    for (const slot of (Array.isArray(oh) ? oh : [])) {
      for (const d of (slot.daysOfWeek || slot.days || [])) days.add(Number(d))
      for (const h of (slot.hours || slot.slots || [])) {
        const o = (h.openHour ?? h.startHour ?? 0) * 60 + (h.openMinute ?? h.startMinute ?? 0)
        const cl = (h.closeHour ?? h.endHour ?? 0) * 60 + (h.closeMinute ?? h.endMinute ?? 0)
        if (cl > o) { if (o < minOpen) minOpen = o; if (cl > maxClose) maxClose = cl }
      }
    }
  }
  const detected = days.size > 0 && isFinite(minOpen) && isFinite(maxClose)
  return { tz, detected, calendars: cals.length, days: detected ? [...days].sort((a, b) => a - b) : [1, 2, 3, 4, 5], startMin: detected ? minOpen : 540, endMin: detected ? maxClose : 1020 }
}
export async function buildSpeedToLead(locationId, from, to, opts = {}) {
  const sample = Math.min(opts.sample || 60, 120)
  const budgetMs = opts.budgetMs || 22000
  const hours = opts.hours || null // { days:[0-6], startMin, endMin } or null (raw)
  const started = Date.now()
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  // Leads = opportunities created in-period; appointments join for downstream
  // booked/shown per speed bucket.
  const [opps, appts] = await Promise.all([
    allOpportunities(locTok, locationId, from, to, 1500),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map() })),
  ])
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const seen = new Set(); const leads = []
  for (const o of opps) {
    const cid = contactIdOf(o); if (!cid || seen.has(cid)) continue
    const created = Date.parse(o.createdAt); if (!isFinite(created)) continue
    if (fromMs != null && created < fromMs) continue
    if (toMs != null && created > toMs) continue
    // True lead-in = when the CONTACT entered the CRM (dateAdded), which can be
    // earlier than the opportunity being created (a workflow / user often makes
    // the opp later). Anchoring on the opp made responses look instant. Use the
    // earliest known of the two.
    const cAdded = Date.parse(o.contact && (o.contact.dateAdded || o.contact.createdAt))
    const leadIn = isFinite(cAdded) ? Math.min(cAdded, created) : created
    const f = apptByContact.get(cid)
    seen.add(cid); leads.push({ cid, created, leadIn, channel: channelOf(utmOf(o)), won: String(o.status || '').toLowerCase() === 'won', booked: !!(f && f.bookedInPeriod), shown: !!(f && f.shownByStatus), staffBookedMs: (f && f.staffBookedMs) || null })
  }
  leads.sort((a, b) => b.leadIn - a.leadIn)
  const pick = leads.slice(0, sample)
  const srcCounts = {} // key: "<source> · user|no-user" -> { count, kind }
  const debugRows = []
  // First manual (and first any) outbound message timestamp for one contact.
  const firstOutbound = async (lead) => {
    if (Date.now() - started > budgetMs) return { ...lead, skipped: true }
    const cs = await ghlGet(locTok, '/conversations/search', { locationId, contactId: lead.cid, limit: 10 }).catch(() => null)
    const convs = (cs && (cs.conversations || cs.conversation)) || []
    let manual = null, any = null
    const outs = [] // for debug: every outbound seen for this lead
    // Most recent few conversations only, to bound message calls per contact.
    for (const cv of convs.slice(0, 3)) {
      if (Date.now() - started > budgetMs) break
      const convId = cv.id || cv._id; if (!convId) continue
      const mj = await ghlGet(locTok, `/conversations/${convId}/messages`, { limit: 100 }).catch(() => null)
      const msgs = (mj && mj.messages && (mj.messages.messages || mj.messages)) || (Array.isArray(mj) ? mj : [])
      for (const m of msgs) {
        if (String(m.direction || '').toLowerCase() !== 'outbound') continue
        const ms = Date.parse(m.dateAdded || m.dateUpdated || m.createdAt); if (!isFinite(ms)) continue
        if (ms < lead.leadIn - 60000) continue // ignore sends before the lead came in
        const kind = classifyOutbound(m)
        const hasUser = !!msgUserId(m)
        const sk = `${String(m.source || 'none').toLowerCase()} · ${hasUser ? 'user' : 'no-user'}`
        if (!srcCounts[sk]) srcCounts[sk] = { count: 0, kind }
        srcCounts[sk].count++
        outs.push({ ms, kind, source: String(m.source || 'none'), hasUser, type: m.messageType || m.type || null })
        if (any == null || ms < any) any = ms
        if (kind === 'manual' && (manual == null || ms < manual)) manual = ms
      }
    }
    // Fallback for clients with no messaging: if there's no manual MESSAGE, use
    // the first STAFF-booked appointment (a manual action) as the speed signal.
    // Automated/self-booked bookings (no user) don't qualify.
    let via = manual != null ? 'message' : null
    if (manual == null && lead.staffBookedMs != null && lead.staffBookedMs >= lead.leadIn - 60000) { manual = lead.staffBookedMs; via = 'appt' }
    if (opts.debug && debugRows.length < 20) {
      outs.sort((a, b) => a.ms - b.ms)
      debugRows.push({
        createdAt: new Date(lead.created).toISOString(),
        leadIn: new Date(lead.leadIn).toISOString(),
        via,
        firstManualMin: manual != null ? Math.round((manual - lead.leadIn) / 60000) : null,
        msgs: outs.slice(0, 5).map((o) => ({ source: o.source, hasUser: o.hasUser, kind: o.kind, type: o.type, minAfterLeadIn: Math.round((o.ms - lead.leadIn) / 60000) })),
      })
    }
    return { ...lead, manual, any, via }
  }
  const results = (await mapPool(pick, 6, firstOutbound)).filter(Boolean)
  // Buckets of manual response time (minutes). "No manual yet" = a lead we saw
  // that has had no human outbound (may have had only automation).
  const BUCKETS = [
    { key: 'u5', label: 'Under 5 min', max: 5 },
    { key: 'u15', label: '5-15 min', max: 15 },
    { key: 'u60', label: '15-60 min', max: 60 },
    { key: 'u240', label: '1-4 hrs', max: 240 },
    { key: 'u1440', label: '4-24 hrs', max: 1440 },
    { key: 'over', label: 'Over 24 hrs', max: Infinity },
  ]
  const bagg = Object.fromEntries(BUCKETS.map((b) => [b.key, { count: 0, booked: 0, shown: 0, won: 0 }]))
  const mins = []
  let measured = 0, onlyAuto = 0, noOutbound = 0, skipped = 0, viaAppt = 0
  for (const r of results) {
    if (r.skipped) { skipped++; continue }
    if (r.manual != null) {
      // Response time honouring working hours (when configured), so after-hours
      // gaps don't count against the team.
      const mm = businessMinutesBetween(r.leadIn, r.manual, hours, tz); if (mm < 0) continue
      measured++; mins.push(mm); if (r.via === 'appt') viaAppt++
      const b = BUCKETS.find((x) => mm < x.max) || BUCKETS[BUCKETS.length - 1]
      const g = bagg[b.key]; g.count++; if (r.booked) g.booked++; if (r.shown) g.shown++; if (r.won) g.won++
    } else if (r.any != null) onlyAuto++
    else noOutbound++
  }
  mins.sort((a, b) => a - b)
  const median = mins.length ? mins[Math.floor((mins.length - 1) / 2)] : null
  const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null
  const within5 = mins.length ? mins.filter((m) => m < 5).length / mins.length : null
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)
  return {
    connected: true, tz,
    totalLeads: leads.length, sampled: pick.length - skipped, skipped,
    measured, onlyAuto, noOutbound, viaAppt, viaMessage: measured - viaAppt,
    medianMin: median == null ? null : Math.round(median),
    avgMin: avg == null ? null : Math.round(avg),
    within5Pct: within5 == null ? null : Math.round(within5 * 100),
    hours: hours ? { days: hours.days, startMin: hours.startMin, endMin: hours.endMin } : null,
    buckets: BUCKETS.map((b) => { const g = bagg[b.key]; return { label: b.label, count: g.count, booked: g.booked, shown: g.shown, won: g.won, bookRate: pct(g.booked, g.count), showRate: pct(g.shown, g.booked), winRate: pct(g.won, g.count) } }),
    sourceBreakdown: Object.entries(srcCounts).map(([source, v]) => ({ source, count: v.count, kind: v.kind })).sort((a, b) => b.count - a.count),
    ...(opts.debug ? { debug: debugRows } : {}),
  }
}

// --- Speed to Lead: whole-dataset scan (chunked across polled requests) -----
// The sampled version reads a bounded number of leads' conversations in one
// call. To cover the WHOLE date range without hitting the function timeout, the
// scan builds the full lead list once, then processes it in chunks across many
// polled requests, accumulating into a blob (managed by the windsor function).
const SPEED_BUCKETS = [
  { key: 'u5', label: 'Under 5 min', max: 5 }, { key: 'u15', label: '5-15 min', max: 15 },
  { key: 'u60', label: '15-60 min', max: 60 }, { key: 'u240', label: '1-4 hrs', max: 240 },
  { key: 'u1440', label: '4-24 hrs', max: 1440 }, { key: 'over', label: 'Over 24 hrs', max: Infinity },
]
async function scanFirstOutbound(locTok, locationId, lead, deadline, srcCounts) {
  if (Date.now() > deadline) return { skipped: true }
  const cs = await ghlGet(locTok, '/conversations/search', { locationId, contactId: lead.cid, limit: 10 }).catch(() => null)
  const convs = (cs && (cs.conversations || cs.conversation)) || []
  let manual = null, any = null
  for (const cv of convs.slice(0, 3)) {
    if (Date.now() > deadline) break
    const convId = cv.id || cv._id; if (!convId) continue
    const mj = await ghlGet(locTok, `/conversations/${convId}/messages`, { limit: 100 }).catch(() => null)
    const msgs = (mj && mj.messages && (mj.messages.messages || mj.messages)) || (Array.isArray(mj) ? mj : [])
    for (const m of msgs) {
      if (String(m.direction || '').toLowerCase() !== 'outbound') continue
      const ms = Date.parse(m.dateAdded || m.dateUpdated || m.createdAt); if (!isFinite(ms)) continue
      if (ms < lead.leadIn - 60000) continue
      const kind = classifyOutbound(m); const hasUser = !!msgUserId(m)
      const sk = `${String(m.source || 'none').toLowerCase()} · ${hasUser ? 'user' : 'no-user'}`
      if (!srcCounts[sk]) srcCounts[sk] = { count: 0, kind }
      srcCounts[sk].count++
      if (any == null || ms < any) any = ms
      if (kind === 'manual' && (manual == null || ms < manual)) manual = ms
    }
  }
  let via = manual != null ? 'message' : null
  if (manual == null && lead.staffBookedMs != null && lead.staffBookedMs >= lead.leadIn - 60000) { manual = lead.staffBookedMs; via = 'appt' }
  return { manual, any, via }
}
// Build the full ordered lead list for a range (no conversation reads yet).
export async function speedLeadList(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const [opps, appts] = await Promise.all([
    allOpportunities(locTok, locationId, from, to, 3000),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map() })),
  ])
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const seen = new Set(); const leads = []
  for (const o of opps) {
    const cid = contactIdOf(o); if (!cid || seen.has(cid)) continue
    const created = Date.parse(o.createdAt); if (!isFinite(created)) continue
    if (fromMs != null && created < fromMs) continue
    if (toMs != null && created > toMs) continue
    const cAdded = Date.parse(o.contact && (o.contact.dateAdded || o.contact.createdAt))
    const leadIn = isFinite(cAdded) ? Math.min(cAdded, created) : created
    const f = apptByContact.get(cid)
    seen.add(cid); leads.push({ cid, leadIn, channel: channelOf(utmOf(o)), won: String(o.status || '').toLowerCase() === 'won', booked: !!(f && f.bookedInPeriod), shown: !!(f && f.shownByStatus), staffBookedMs: (f && f.staffBookedMs) || null })
  }
  leads.sort((a, b) => b.leadIn - a.leadIn)
  return { tz, leads }
}
// Process leads[startIdx..] into `agg` for up to budgetMs; returns the new index.
export async function speedScanChunk(locationId, leads, startIdx, budgetMs, agg) {
  const locTok = await locationToken(locationId)
  const deadline = Date.now() + budgetMs
  let idx = startIdx
  while (idx < leads.length && Date.now() < deadline) {
    const batch = leads.slice(idx, idx + 6)
    const res = await Promise.all(batch.map((l) => scanFirstOutbound(locTok, locationId, l, deadline, agg.srcCounts).catch(() => ({ skipped: true }))))
    let stop = false
    for (let k = 0; k < batch.length; k++) {
      const r = res[k]; if (r.skipped) { stop = true; break }
      const l = batch[k]
      if (r.manual != null) agg.manualRaw.push({ leadIn: l.leadIn, manual: r.manual, via: r.via, booked: l.booked, shown: l.shown, won: l.won })
      else if (r.any != null) agg.onlyAuto++
      else agg.noOutbound++
      idx++
    }
    if (stop) break
  }
  return idx
}
// Turn accumulated scan state into the same shape the sampled endpoint returns.
export function finalizeSpeed(agg, total, processed, hours, tz) {
  const bagg = Object.fromEntries(SPEED_BUCKETS.map((b) => [b.key, { count: 0, booked: 0, shown: 0, won: 0 }]))
  const mins = []; let measured = 0, viaAppt = 0
  for (const r of agg.manualRaw) {
    const mm = businessMinutesBetween(r.leadIn, r.manual, hours, tz); if (mm < 0) continue
    measured++; mins.push(mm); if (r.via === 'appt') viaAppt++
    const b = SPEED_BUCKETS.find((x) => mm < x.max) || SPEED_BUCKETS[SPEED_BUCKETS.length - 1]
    const g = bagg[b.key]; g.count++; if (r.booked) g.booked++; if (r.shown) g.shown++; if (r.won) g.won++
  }
  mins.sort((a, b) => a - b)
  const median = mins.length ? mins[Math.floor((mins.length - 1) / 2)] : null
  const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null
  const within5 = mins.length ? mins.filter((m) => m < 5).length / mins.length : null
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)
  return {
    connected: true, tz, full: true,
    totalLeads: total, sampled: processed, measured, onlyAuto: agg.onlyAuto, noOutbound: agg.noOutbound,
    viaAppt, viaMessage: measured - viaAppt,
    medianMin: median == null ? null : Math.round(median),
    avgMin: avg == null ? null : Math.round(avg),
    within5Pct: within5 == null ? null : Math.round(within5 * 100),
    hours: hours ? { days: hours.days, startMin: hours.startMin, endMin: hours.endMin } : null,
    buckets: SPEED_BUCKETS.map((b) => { const g = bagg[b.key]; return { label: b.label, count: g.count, booked: g.booked, shown: g.shown, won: g.won, bookRate: pct(g.booked, g.count), showRate: pct(g.shown, g.booked), winRate: pct(g.won, g.count) } }),
    sourceBreakdown: Object.entries(agg.srcCounts).map(([source, v]) => ({ source, count: v.count, kind: v.kind })).sort((a, b) => b.count - a.count),
  }
}

// --- Appointment insights (timing + who booked) ----------------------------
// Per-booking analysis for the Appointments tab: booking lead time (booked ->
// appointment date), who booked it (self vs staff), and the downstream show /
// win outcome, split by paid channel. A booking is one (contact x calendar)
// booked in-period; show rate is over bookings whose appointment has ALREADY
// happened (future-dated ones can't have shown yet), so far-out bookings aren't
// unfairly penalised. "Self-booked" = the calendar event carries no user id (the
// contact booked it themselves); "staff-booked" = a user created it.
const LEADTIME_BUCKETS = [
  { key: 'same', label: 'Same day', max: 1 },
  { key: 'd1_3', label: '1-3 days', max: 4 },
  { key: 'd4_7', label: '4-7 days', max: 8 },
  { key: 'd8_14', label: '8-14 days', max: 15 },
  { key: 'd15_30', label: '15-30 days', max: 31 },
  { key: 'd30', label: '30+ days', max: Infinity },
]
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_SLOTS = [
  { label: 'Before 9am', lo: 0, hi: 9 },
  { label: '9am-12pm', lo: 9, hi: 12 },
  { label: '12-3pm', lo: 12, hi: 15 },
  { label: '3-6pm', lo: 15, hi: 18 },
  { label: 'After 6pm', lo: 18, hi: 24 },
]
function apptBookedBy(ev) {
  const cb = ev.createdBy || {}
  const uid = cb.userId || cb.user_id || ev.userId || null
  return uid ? 'staff' : 'self'
}
function apptUserId(ev) { return ev.assignedUserId || ev.assigned_user_id || (Array.isArray(ev.users) && ev.users[0]) || (ev.createdBy && ev.createdBy.userId) || null }
// Normalise a raw appointment status into one outcome bucket. `confirmed` = not
// yet resulted (booked/new/unconfirmed/empty); the rest are real outcomes.
function normApptStatus(s) {
  if (/no.?show/.test(s)) return 'noshow'
  if (/cancel/.test(s)) return 'cancelled'
  if (s === 'showed') return 'showed'
  if (s === '' || /^(confirmed|new|unconfirmed|booked)$/.test(s)) return 'confirmed'
  return 'other'
}
export async function buildAppointmentInsights(locationId, from, to, opts = {}) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const DAY = 86400000
  const now = Date.now()
  const pipeline = opts.pipeline || null
  const calIds = Array.isArray(opts.calIds) && opts.calIds.length ? new Set(opts.calIds) : null
  const userFilter = opts.user || null
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : now) - 180 * DAY).toISOString().slice(0, 10)
  const [oppRows, calRes, pipelines, userRows] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 1800),
    ghlGet(locTok, '/calendars/', { locationId }).then((j) => j.calendars || j.calendar || []).catch(() => []),
    fetchPipelines(locTok, locationId).catch(() => []),
    ghlGet(locTok, '/users/', { locationId }).then((j) => j.users || []).catch(() => []),
  ])
  const oppByContact = new Map()
  for (const o of oppRows) { const cid = contactIdOf(o); if (cid && !oppByContact.has(cid)) oppByContact.set(cid, o) }
  const calName = {}; for (const c of calRes) calName[c.id || c._id || c.calendarId] = c.name || c.calendarName || 'Calendar'
  const userName = {}; for (const u of userRows) userName[u.id || u._id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || ('User ' + String(u.id || '').slice(-4))
  const nameOfUser = (id) => (id ? (userName[id] || 'User ' + String(id).slice(-4)) : 'Unassigned')
  const startMs = (fromMs != null ? fromMs : now - 400 * DAY) - 7 * DAY
  const endMs = (toMs != null ? toMs : now) + 365 * DAY
  const recs = new Map() // contact|cal -> primary booking record
  const evCount = new Map() // contact|cal -> number of events (>1 = reschedule)
  const srcCounts = {}
  const debugRows = []
  await Promise.all(calRes.map(async (cal) => {
    const calId = cal.id || cal._id || cal.calendarId; if (!calId) return
    let j; try { j = await ghlGet(locTok, '/calendars/events', { locationId, calendarId: calId, startTime: startMs, endTime: endMs }) } catch { return }
    for (const ev of (j.events || [])) {
      const cid = ev.contactId || (ev.contact && (ev.contact.id || ev.contact._id)) || null
      if (!cid) continue
      const added = Date.parse(ev.dateAdded), start = Date.parse(ev.startTime)
      if (!isFinite(added) || !isFinite(start)) continue
      if (fromMs != null && added < fromMs) continue
      if (toMs != null && added > toMs) continue // booked in-period (by creation day)
      const st = String(ev.appointmentStatus || ev.appoinmentStatus || ev.status || '').toLowerCase()
      if (/invalid/.test(st)) continue
      const cancelled = /cancel/.test(st)
      const nstatus = normApptStatus(st)
      const evName = (ev.contact && (ev.contact.name || [ev.contact.firstName, ev.contact.lastName].filter(Boolean).join(' '))) || ev.title || null
      const bookedBy = apptBookedBy(ev)
      const cb = ev.createdBy || {}
      const sk = `${String(cb.source || ev.source || 'unknown').toLowerCase()} · ${bookedBy}`
      srcCounts[sk] = (srcCounts[sk] || 0) + 1
      const lead = Math.max(0, (start - added) / DAY)
      const key = cid + '|' + calId
      evCount.set(key, (evCount.get(key) || 0) + 1)
      const cur = recs.get(key)
      // Prefer a live (non-cancelled) booking; otherwise keep the latest-added one.
      if (!cur || (cur.cancelled && !cancelled) || (cur.cancelled === cancelled && added > cur.added)) {
        recs.set(key, { cid, calId, added, start, lead, cancelled, shown: st === 'showed', status: nstatus, name: evName, bookedBy, apptUser: apptUserId(ev) })
      }
    }
  }))
  const CH = () => ({ booked: 0, occurred: 0, shown: 0, won: 0, cancelled: 0, rescheduled: 0, resulted: 0, occurredNotResulted: 0, resultedNotOccurred: 0, byStatus: { showed: 0, noshow: 0, cancelled: 0, confirmed: 0, other: 0 }, people: [], self: 0, staff: 0, leadSum: 0, leads: [], closeSum: 0, closeN: 0, ttbSum: 0, ttbN: 0, ttbList: [], buckets: LEADTIME_BUCKETS.map((b) => ({ key: b.key, label: b.label, booked: 0, occurred: 0, shown: 0, won: 0, cancelled: 0, rescheduled: 0, resulted: 0, closeSum: 0, closeN: 0 })), byBookedBy: { self: { booked: 0, occurred: 0, shown: 0, won: 0, leadSum: 0 }, staff: { booked: 0, occurred: 0, shown: 0, won: 0, leadSum: 0 } }, byUser: new Map(), dow: Array.from({ length: 7 }, () => ({ booked: 0, occurred: 0, shown: 0 })), slots: HOUR_SLOTS.map(() => ({ booked: 0, occurred: 0, shown: 0 })) })
  const chans = { all: CH(), meta: CH(), google: CH(), paid: CH(), other: CH() }
  const calCounts = {} // calId -> bookings (after pipeline filter, before calIds filter)
  const userCounts = {} // uid -> bookings (after pipeline/cal filter, before user filter)
  let userMismatch = 0
  for (const r of recs.values()) {
    const o = oppByContact.get(r.cid)
    if (pipeline && !(o && o.pipelineId === pipeline)) continue // pipeline scope
    calCounts[r.calId] = (calCounts[r.calId] || 0) + 1
    if (calIds && !calIds.has(r.calId)) continue // calendar scope
    const uid = r.apptUser || (o && o.assignedTo) || null
    const ukey = uid || 'unassigned'
    userCounts[ukey] = (userCounts[ukey] || 0) + 1
    if (userFilter && ukey !== userFilter) continue // user scope
    const ch = o ? channelOf(utmOf(o)) : 'other'
    const won = !!(o && String(o.status || '').toLowerCase() === 'won')
    const wonMs = won ? Date.parse(o.lastStatusChangeAt || o.lastStageChangeAt || o.updatedAt || '') : NaN
    const closeDays = won && isFinite(wonMs) ? Math.max(0, (wonMs - r.added) / DAY) : null
    const occurred = r.start <= now
    const resulted = r.status !== 'confirmed'
    const bk = LEADTIME_BUCKETS.findIndex((b) => r.lead < b.max)
    const rescheduled = (evCount.get(r.cid + '|' + r.calId) || 1) > 1
    // Time to book = lead-in (contact created / opp created) -> appointment booked.
    const leadInMs = o ? Date.parse((o.contact && (o.contact.dateAdded || o.contact.createdAt)) || o.createdAt || '') : NaN
    const ttb = isFinite(leadInMs) ? Math.max(0, (r.added - leadInMs) / DAY) : null
    // Local day-of-week + time-of-day slot of the appointment.
    const localStart = new Date(r.start + tzOffsetMs(tz, r.start))
    const dow = localStart.getUTCDay(); const hr = localStart.getUTCHours()
    const slotIdx = HOUR_SLOTS.findIndex((s) => hr >= s.lo && hr < s.hi)
    if (r.apptUser && o && o.assignedTo && r.apptUser !== o.assignedTo) userMismatch++
    const apply = (C) => {
      C.booked++; C.leadSum += r.lead; C.leads.push(r.lead)
      if (r.bookedBy === 'self') C.self++; else C.staff++
      if (r.cancelled) C.cancelled++
      if (rescheduled) C.rescheduled++
      if (ttb != null) { C.ttbSum += ttb; C.ttbN++; C.ttbList.push(ttb) }
      if (occurred) { C.occurred++; if (r.shown) C.shown++ }
      C.byStatus[r.status] = (C.byStatus[r.status] || 0) + 1
      if (resulted) C.resulted++
      if (occurred && !resulted) C.occurredNotResulted++
      if (resulted && !occurred) C.resultedNotOccurred++
      if (won) { C.won++; if (closeDays != null) { C.closeSum += closeDays; C.closeN++ } }
      const b = C.buckets[bk]; if (b) { b.booked++; if (r.cancelled) b.cancelled++; if (rescheduled) b.rescheduled++; if (resulted) b.resulted++; if (occurred) { b.occurred++; if (r.shown) b.shown++ } if (won) { b.won++; if (closeDays != null) { b.closeSum += closeDays; b.closeN++ } } }
      const bb = C.byBookedBy[r.bookedBy]; bb.booked++; bb.leadSum += r.lead; if (occurred) { bb.occurred++; if (r.shown) bb.shown++ } if (won) bb.won++
      let um = C.byUser.get(uid); if (!um) { um = { id: uid, booked: 0, occurred: 0, shown: 0, won: 0 }; C.byUser.set(uid, um) }
      um.booked++; if (occurred) { um.occurred++; if (r.shown) um.shown++ } if (won) um.won++
      const dd2 = C.dow[dow]; dd2.booked++; if (occurred) { dd2.occurred++; if (r.shown) dd2.shown++ }
      const sl = slotIdx >= 0 ? C.slots[slotIdx] : null; if (sl) { sl.booked++; if (occurred) { sl.occurred++; if (r.shown) sl.shown++ } }
    }
    apply(chans.all); apply(chans[ch] || chans.other)
    if (ch === 'meta' || ch === 'google') apply(chans.paid)
    if (chans.all.people.length < 200) {
      const nm = (o && ((o.contact && (o.contact.name || [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' '))) || o.contactName || o.name)) || r.name || ('Contact ' + String(r.cid).slice(-4))
      chans.all.people.push({ contactId: r.cid, name: nm, calendar: calName[r.calId] || 'Calendar', status: r.status, occurred, start: r.start, booked: true, channel: ch, leadBucket: (LEADTIME_BUCKETS[bk] && LEADTIME_BUCKETS[bk].key) || null })
    }
    if (opts.debug && debugRows.length < 25) debugRows.push({ leadDays: Math.round(r.lead), bookedBy: r.bookedBy, occurred, shown: r.shown, cancelled: r.cancelled, won, channel: ch, calendar: calName[r.calId], user: nameOfUser(uid) })
  }
  const finalize = (C) => {
    const leads = C.leads.slice().sort((a, b) => a - b)
    const median = leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null
    const bb = (x) => ({ booked: x.booked, occurred: x.occurred, shown: x.shown, won: x.won, showRate: x.occurred ? Math.round((x.shown / x.occurred) * 100) : null, winRate: x.booked ? Math.round((x.won / x.booked) * 100) : null, avgLeadDays: x.booked ? Math.round(x.leadSum / x.booked) : null })
    const rt = (x) => ({ booked: x.booked, occurred: x.occurred, shown: x.shown, showRate: x.occurred ? Math.round((x.shown / x.occurred) * 100) : null })
    return {
      booked: C.booked, occurred: C.occurred, shown: C.shown, won: C.won, cancelled: C.cancelled, rescheduled: C.rescheduled,
      cancelRate: C.booked ? Math.round((C.cancelled / C.booked) * 100) : null,
      rescheduleRate: C.booked ? Math.round((C.rescheduled / C.booked) * 100) : null,
      self: C.self, staff: C.staff, selfPct: C.booked ? Math.round((C.self / C.booked) * 100) : null,
      avgLeadDays: C.booked ? Math.round(C.leadSum / C.booked) : null,
      medianLeadDays: median == null ? null : Math.round(median),
      avgTimeToBookDays: C.ttbN ? Math.round(C.ttbSum / C.ttbN) : null,
      medianTimeToBookDays: (() => { const a = C.ttbList.slice().sort((x, y) => x - y); return a.length ? Math.round(a[Math.floor((a.length - 1) / 2)]) : null })(),
      showRate: C.occurred ? Math.round((C.shown / C.occurred) * 100) : null,
      resulted: C.resulted, byStatus: C.byStatus,
      occurredNotResulted: C.occurredNotResulted, resultedNotOccurred: C.resultedNotOccurred,
      resultShowRate: C.resulted ? Math.round((C.shown / C.resulted) * 100) : null,
      people: C.people,
      winRate: C.booked ? Math.round((C.won / C.booked) * 100) : null,
      avgCloseDays: C.closeN ? Math.round(C.closeSum / C.closeN) : null,
      buckets: C.buckets.map((b) => ({ key: b.key, label: b.label, booked: b.booked, occurred: b.occurred, shown: b.shown, won: b.won, cancelled: b.cancelled, rescheduled: b.rescheduled, resulted: b.resulted, showRate: b.occurred ? Math.round((b.shown / b.occurred) * 100) : null, winRate: b.booked ? Math.round((b.won / b.booked) * 100) : null, cancelRate: b.booked ? Math.round((b.cancelled / b.booked) * 100) : null, avgCloseDays: b.closeN ? Math.round(b.closeSum / b.closeN) : null })),
      byBookedBy: { self: bb(C.byBookedBy.self), staff: bb(C.byBookedBy.staff) },
      byUser: [...C.byUser.values()].map((u) => ({ name: nameOfUser(u.id), booked: u.booked, occurred: u.occurred, shown: u.shown, won: u.won, showRate: u.occurred ? Math.round((u.shown / u.occurred) * 100) : null, winRate: u.booked ? Math.round((u.won / u.booked) * 100) : null })).sort((a, b) => b.booked - a.booked),
      byDow: C.dow.map((x, i) => ({ label: DOW_NAMES[i], ...rt(x) })),
      byTimeOfDay: C.slots.map((x, i) => ({ label: HOUR_SLOTS[i].label, ...rt(x) })),
    }
  }
  const calendars = Object.entries(calCounts).map(([id, count]) => ({ id, name: calName[id] || 'Calendar', count })).sort((a, b) => b.count - a.count)
  const users = Object.entries(userCounts).map(([id, count]) => ({ id, name: id === 'unassigned' ? 'Unassigned' : nameOfUser(id), count })).sort((a, b) => b.count - a.count)
  return {
    connected: true, tz, pipeline, user: userFilter,
    allPipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: (p.stages || []).map((s, i) => ({ id: s.id, name: s.name, pos: s.position ?? i })).sort((a, b) => a.pos - b.pos) })),
    calendars, usedCalendars: calIds ? [...calIds] : calendars.map((c) => c.id),
    users, userMismatch,
    channels: { all: finalize(chans.all), meta: finalize(chans.meta), google: finalize(chans.google), paid: finalize(chans.paid), other: finalize(chans.other) },
    bookedBySources: Object.entries(srcCounts).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    ...(opts.debug ? { debug: debugRows } : {}),
  }
}

// --- Per-user (sales rep) performance --------------------------------------
// Aggregates the opportunity cohort by assigned user: leads, per-stage reach
// (for the key-events funnel), booked / shown (from the appointment feed joined
// by contact), won / revenue / lost / open, average close time, and a per-
// pipeline split. Used by the client's Users tab. Optionally scoped to one
// pipeline. Ad-cost-per-outcome is added by the caller (spend isn't per-user).
export async function buildUserPerformance(locationId, from, to, opts = {}) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const DAY = 86400000
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - 120 * DAY).toISOString().slice(0, 10)
  const [wideOpps, pipelines, appts, userRows, reasons] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 2000),
    fetchPipelines(locTok, locationId),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map() })),
    ghlGet(locTok, '/users/', { locationId }).then((j) => j.users || []).catch(() => []),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
  ])
  const idx = stageIndexFrom(pipelines)
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  const lostReasonOf = (o) => {
    const rid = o.lostReasonId || o.lost_reason_id || (o.lostReason && (o.lostReason.id || o.lostReason._id)) || null
    return (rid && reasonName[rid]) || (typeof o.lostReason === 'string' && o.lostReason) || 'Unspecified'
  }
  const pipeName = {}; for (const p of pipelines) pipeName[p.id] = p.name
  const userName = {}; for (const u of userRows) userName[u.id || u._id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || ('User ' + String(u.id || '').slice(-4))
  const nameOf = (id) => (id === 'unassigned' ? 'Unassigned' : (userName[id] || 'User ' + String(id).slice(-4)))
  const opps = wideOpps.filter((o) => { const ms = Date.parse(o.createdAt); return (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs) })
  let cohort = opts.pipeline ? opps.filter((o) => o.pipelineId === opts.pipeline) : opps
  // Optional channel filter (first-touch UTM): all | paid | nonpaid | meta | google.
  const chan = opts.channel && opts.channel !== 'all' ? opts.channel : null
  if (chan) cohort = cohort.filter((o) => { const c = channelOf(utmOf(o)); return chan === 'paid' ? (c === 'meta' || c === 'google') : chan === 'nonpaid' ? c === 'other' : c === chan })
  const U = new Map()
  const nowMs = Date.now()
  const contactNameOf = (o) => (o.contact && (o.contact.name || [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' '))) || o.contactName || o.name || '—'
  const getU = (uid) => { let u = U.get(uid); if (!u) { u = { id: uid, leads: 0, qualified: 0, won: 0, revenue: 0, lost: 0, open: 0, booked: 0, shown: 0, cancelled: 0, closeSum: 0, closeN: 0, totalValue: 0, openValue: 0, lostValue: 0, stages: new Map(), stageOpen: new Map(), reasons: new Map(), openList: [], byPipe: new Map() }; U.set(uid, u) } return u }
  const qualStagePos = opts.qualStagePos != null ? opts.qualStagePos : null
  let totQualified = 0
  for (const o of cohort) {
    const uid = o.assignedTo || 'unassigned'
    const u = getU(uid)
    u.leads++
    const st = String(o.status || '').toLowerCase(); const val = num(o.monetaryValue)
    const isOpen = st !== 'won' && st !== 'lost' && st !== 'abandoned'
    u.totalValue += val
    if (st === 'won') { u.won++; u.revenue += val; const w = Date.parse(o.lastStatusChangeAt || o.lastStageChangeAt || ''); const c = Date.parse(o.createdAt); if (isFinite(w) && isFinite(c)) { const d = (w - c) / DAY; if (d >= 0 && d < 400) { u.closeSum += d; u.closeN++ } } }
    else if (st === 'lost' || st === 'abandoned') { u.lost++; u.lostValue += val; const rn = lostReasonOf(o); const rr = u.reasons.get(rn) || { count: 0, value: 0 }; rr.count++; rr.value += val; u.reasons.set(rn, rr) }
    else { u.open++; u.openValue += val }
    // Cumulative stage reach: an opp at position P reached every stage with pos<=P;
    // a won opp reached them all.
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    if (pi) for (const s of pi.stages) { if (st === 'won' || (pos >= 0 && s.pos <= pos)) u.stages.set(s.name, (u.stages.get(s.name) || 0) + 1) }
    // Deals sitting OPEN at their current stage right now (live, still capturable)
    // — per-stage counts/values, plus the individual deals for the drill-down.
    if (isOpen && stg) {
      const so = u.stageOpen.get(stg.name) || { open: 0, value: 0 }; so.open++; so.value += val; u.stageOpen.set(stg.name, so)
      const aMs = Date.parse(o.lastStageChangeAt || o.lastStatusChangeAt || o.createdAt)
      u.openList.push({ id: o.id || o._id || null, contactId: contactIdOf(o), name: o.name || o.title || '(unnamed opportunity)', contact: contactNameOf(o), value: Math.round(val), stage: stg.name, stagePos: stg.pos, pipeline: pipeName[o.pipelineId] || 'Pipeline', ageDays: isFinite(aMs) ? Math.max(0, Math.round((nowMs - aMs) / DAY)) : null, email: (o.contact && o.contact.email) || null, phone: (o.contact && o.contact.phone) || null })
    }
    const pid = o.pipelineId || 'none'; let bp = u.byPipe.get(pid); if (!bp) { bp = { id: pid, name: pipeName[pid] || 'Pipeline', leads: 0, won: 0, revenue: 0 }; u.byPipe.set(pid, bp) } bp.leads++; if (st === 'won') { bp.won++; bp.revenue += val }
    const cid = contactIdOf(o); const f = cid && apptByContact.get(cid)
    if (f) { if (f.bookedInPeriod) u.booked++; if (f.shownByStatus) u.shown++; if (f.cancelledInPeriod) u.cancelled++ }
    // Qualified lead (scalable definition — see isQualified). Counted per rep and
    // for the whole client so the funnel can show Lead → Qualified → Booked → Won.
    const entryPos = pi && pi.stages.length ? pi.stages[0].pos : 0
    if (isQualified({ status: st, pos, entryPos, hasAppt: !!(f && f.bookedInPeriod), value: val, qualStagePos })) { u.qualified++; totQualified++ }
  }
  const users = [...U.values()].map((u) => ({
    id: u.id, name: nameOf(u.id),
    leads: u.leads, qualified: u.qualified, open: u.open, lost: u.lost, booked: u.booked, shown: u.shown, cancelled: u.cancelled, won: u.won, revenue: Math.round(u.revenue),
    qualRate: u.leads ? Math.round((u.qualified / u.leads) * 100) : null,
    bookRate: u.leads ? Math.round((u.booked / u.leads) * 100) : null,
    showRate: u.booked ? Math.round((u.shown / u.booked) * 100) : null,
    winRate: u.leads ? Math.round((u.won / u.leads) * 100) : null,
    avgDeal: u.won ? Math.round(u.revenue / u.won) : null,
    avgCloseDays: u.closeN ? Math.round(u.closeSum / u.closeN) : null,
    pipelineValue: Math.round(u.totalValue), openValue: Math.round(u.openValue), lostValue: Math.round(u.lostValue), wonValue: Math.round(u.revenue),
    stages: Object.fromEntries(u.stages),
    stageOpen: Object.fromEntries([...u.stageOpen.entries()].map(([k, v]) => [k, { open: v.open, value: Math.round(v.value) }])),
    openDeals: u.openList.slice().sort((a, b) => (a.stagePos - b.stagePos) || (b.value - a.value)),
    lostReasons: [...u.reasons.entries()].map(([reason, v]) => ({ reason, count: v.count, value: Math.round(v.value) })).sort((a, b) => b.count - a.count),
    byPipeline: [...u.byPipe.values()].map((p) => ({ ...p, revenue: Math.round(p.revenue) })).sort((a, b) => b.leads - a.leads),
  })).sort((a, b) => b.leads - a.leads)
  const totLeads = cohort.length
  return {
    connected: true, tz, users,
    qualified: totQualified, leads: totLeads, qualRate: totLeads ? Math.round((totQualified / totLeads) * 100) : null,
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((s) => s.name) })),
  }
}

// Per-contact form answers for a location in [from,to]: contactId -> [{q,a}].
// Reuses buildForms's submission -> answer parsing (custom-field labels, Meta
// Lead Form customFields arrays, nested answer containers) but returns just the
// raw answers so the Command Centre lost-reason drill can join a lost contact to
// what they typed (e.g. a "location" loss shows the suburb they gave). Kept
// standalone so buildForms stays untouched.
async function formAnswersByContact(locTok, locationId, from, to) {
  const cfById = {}
  await ghlGet(locTok, `/locations/${locationId}/customFields`, {})
    .then((j) => { for (const f of (j.customFields || j.customField || [])) { if (f.id) cfById[f.id] = f.name; if (f.fieldKey) cfById[f.fieldKey] = f.name } })
    .catch(() => {})
  const labelKey = (k) => cfById[k] || cfById[k.replace(/^contact\./, '')] || k.replace(/^contact\./, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const subs = []
  try {
    for (let page = 1; page <= 10; page++) {
      const j = await ghlGet(locTok, '/forms/submissions', { locationId, limit: 100, page, startAt: from, endAt: to })
      const arr = j.submissions || []; subs.push(...arr)
      if (arr.length < 100) break
    }
  } catch { return new Map() }
  const subMs = (s) => { const raw = s.createdAt || s.dateAdded || s.submittedAt || s.date; const t = typeof raw === 'number' ? raw : Date.parse(raw || ''); return Number.isFinite(t) ? t : Infinity }
  subs.sort((a, b) => subMs(a) - subMs(b))
  const SYS_KEY = /^(formId|location_?id|sessionId|submissionId|timezone|calendar|selected_|source$|^type$|productType|facebookLead|facebookForm|postal_?code|message|additional|comment|first_?name|last_?name|full_?name|^name$|email|phone|signature|^ip$|contact_?id|funnel|page|utm|fbclid|gclid|why do you|how did you hear|organization)/i
  const out = new Map()
  for (const s of subs) {
    const cid = s.contactId; if (!cid || out.has(cid)) continue
    const o = s.others || {}
    const answers = []
    const put = (k, v) => {
      if (!k || SYS_KEY.test(k)) return
      let str = null
      if (Array.isArray(v)) str = v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).join(', ')
      else if (typeof v === 'number' && Number.isFinite(v)) str = String(v)
      else if (typeof v === 'string') str = v.trim()
      if (!str || str.length > 200) return
      answers.push({ q: labelKey(k), a: str })
    }
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) {
        if (/^(customFields|custom_fields|customData|fields)$/i.test(k)) { for (const el of v) { if (el && typeof el === 'object') put(el.id || el.key || el.fieldKey || el.name, el.value !== undefined ? el.value : (el.field_value !== undefined ? el.field_value : el.fieldValue)) } }
        else put(k, v)
        continue
      }
      if (v && typeof v === 'object') { if (/^(customData|formData|form_data|answers|fields|data)$/i.test(k)) for (const [k2, v2] of Object.entries(v)) put(k2, v2); continue }
      put(k, v)
    }
    if (answers.length) out.set(cid, answers.slice(0, 12))
  }
  return out
}

// Command Centre drill dataset — assembles, from a single load of the client's
// opportunities + pipelines + calendar appointments + form answers, the tables
// behind every clickable command-centre tile: opportunities by source, won
// revenue deals, open deals, lost-by-reason (joined to form answers), per-
// calendar booking/show, and per-channel close rate. Spend / paid-lead figures
// are added by the caller (windsor) from the health feed. Each opp is classified
// to a paid channel via channelOf(utmOf()) with a friendly source label.
export async function buildCcDrill(locationId, from, to, channel) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const DAY = 86400000
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - 120 * DAY).toISOString().slice(0, 10)
  const [wideOpps, pipelines, appts, reasons, formAns, userRows] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 2000),
    fetchPipelines(locTok, locationId),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map(), perCalendar: new Map() })),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
    formAnswersByContact(locTok, locationId, from, to).catch(() => new Map()),
    ghlGet(locTok, '/users/', { locationId }).then((j) => j.users || []).catch(() => []),
  ])
  const idx = stageIndexFrom(pipelines)
  const pipeName = {}; for (const p of pipelines) pipeName[p.id] = p.name
  const userName = {}; for (const u of userRows) userName[u.id || u._id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || ('User ' + String(u.id || '').slice(-4))
  const userNameOf = (id) => (!id ? 'Unassigned' : (userName[id] || 'User ' + String(id).slice(-4)))
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  const lostReasonOf = (o) => { const rid = o.lostReasonId || o.lost_reason_id || (o.lostReason && (o.lostReason.id || o.lostReason._id)) || null; return (rid && reasonName[rid]) || (typeof o.lostReason === 'string' && o.lostReason) || 'Unspecified' }
  const nowMs = Date.now()
  const contactNameOf = (o) => (o.contact && (o.contact.name || [o.contact.firstName, o.contact.lastName].filter(Boolean).join(' '))) || o.contactName || o.name || '—'
  // Optional channel filter (first-touch UTM): all | paid | nonpaid | meta | google.
  // When set, the whole drill (funnel, open-by-stage, sources, revenue, lost,
  // close, and calendar bookings) reflects only opportunities on that channel.
  const chan = channel && channel !== 'all' ? channel : null
  let opps = wideOpps.filter((o) => { const ms = Date.parse(o.createdAt); return (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs) })
  if (chan) opps = opps.filter((o) => { const c = channelOf(utmOf(o)); return chan === 'paid' ? (c === 'meta' || c === 'google') : chan === 'nonpaid' ? c === 'other' : c === chan })
  // Contacts that belong to this channel — used to scope calendar bookings, which
  // aren't UTM-tagged themselves, to the same channel as the opportunities.
  const chanContacts = chan ? new Set(opps.map((o) => contactIdOf(o)).filter(Boolean)) : null
  // Name lookup for booked contacts: prefer the appointment's own contact name,
  // then any opportunity in the wide window (not just the in-period cohort) so a
  // lead booked this period whose opp was created earlier still resolves.
  const apptNames = appts && appts.nameByContact instanceof Map ? appts.nameByContact : new Map()
  const oppNameById = new Map(); for (const o of wideOpps) { const cid = contactIdOf(o); if (cid) { const nm = contactNameOf(o); if (nm && nm !== '—' && !oppNameById.has(cid)) oppNameById.set(cid, nm) } }
  // Friendly source label + kind from the first-touch UTMs. Paid channels map to
  // Paid Social / Paid Search; everything else reads from the utm source.
  const capFirst = (s) => { const t = String(s || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t }
  const sourceLabel = (u, ch) => {
    if (ch === 'meta') return 'Paid Social'
    if (ch === 'google') return 'Paid Search'
    const hay = `${u.source || ''} ${u.medium || ''}`.toLowerCase()
    if (/referr/.test(hay)) return 'Referral'
    if (/organic|seo|search/.test(hay)) return 'Organic'
    if (!hay.trim() || /direct|typein|\bnone\b/.test(hay)) return 'Direct'
    return u.source ? capFirst(u.source).slice(0, 40) : 'Other'
  }
  const kindOf = (ch, label) => (ch === 'meta' || ch === 'google') ? 'paid' : (label === 'Referral' || label === 'Organic' || label === 'Direct') ? 'organic' : 'other'
  const bySource = new Map()
  const wonDeals = [], openDeals = []
  const openByStage = new Map() // pipelineId::stageId -> open deals currently sitting there
  const lostByReason = new Map()
  const closeByChannel = new Map()
  let revenueTotal = 0, openValueTotal = 0, openCount = 0, wonCount = 0, lostCount = 0, leadCount = 0
  let paidWon = 0, metaWon = 0, googleWon = 0
  const stageAt = new Map() // pipelineId -> Map(stageId -> count), for the key-events funnel
  for (const o of opps) {
    const st = String(o.status || '').toLowerCase()
    const val = num(o.monetaryValue)
    const u = utmOf(o); const ch = channelOf(u)
    const label = sourceLabel(u, ch); const kind = kindOf(ch, label)
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null
    const name = contactNameOf(o)
    if (o.pipelineId && o.pipelineStageId) { let sm = stageAt.get(o.pipelineId); if (!sm) { sm = new Map(); stageAt.set(o.pipelineId, sm) } sm.set(o.pipelineStageId, (sm.get(o.pipelineStageId) || 0) + 1) }
    const isWon = st === 'won', isLost = st === 'lost' || st === 'abandoned'
    leadCount++; if (isWon) wonCount++; if (isLost) lostCount++
    let bs = bySource.get(label); if (!bs) { bs = { source: label, channel: ch, kind, count: 0, value: 0, opps: [] }; bySource.set(label, bs) }
    bs.count++; bs.value += val
    if (bs.opps.length < 100) bs.opps.push({ name, status: isWon ? 'won' : isLost ? 'lost' : 'open', stage: stg ? stg.name : null, value: Math.round(val), channel: ch })
    let cc = closeByChannel.get(ch); if (!cc) { cc = { channel: ch, won: 0, lost: 0, deals: [] }; closeByChannel.set(ch, cc) }
    if (isWon) {
      revenueTotal += val
      if (ch === 'meta') { metaWon++; paidWon++ } else if (ch === 'google') { googleWon++; paidWon++ }
      const closeMs = Date.parse(o.lastStatusChangeAt || o.lastStageChangeAt || o.createdAt)
      const closeDate = isFinite(closeMs) ? new Date(closeMs).toISOString().slice(0, 10) : null
      if (wonDeals.length < 300) wonDeals.push({ name, value: Math.round(val), closeDate, channel: ch })
      cc.won++; if (cc.deals.length < 120) cc.deals.push({ name, closeDate, value: Math.round(val) })
    } else if (isLost) {
      cc.lost++
      const rn = lostReasonOf(o)
      let lr = lostByReason.get(rn); if (!lr) { lr = { reason: rn, count: 0, value: 0, people: [] }; lostByReason.set(rn, lr) }
      lr.count++; lr.value += val
      const cid = contactIdOf(o)
      if (lr.people.length < 60) lr.people.push({ contactId: cid, name, stage: stg ? stg.name : null, pipeline: pipeName[o.pipelineId] || null, value: Math.round(val), oppSource: o.source || null, channelSource: label, utmSource: u.source || null, utmContent: u.content || null, formAnswers: (cid && formAns.get(cid)) || [] })
    } else {
      openCount++; openValueTotal += val
      const aMs = Date.parse(o.lastStageChangeAt || o.lastStatusChangeAt || o.createdAt)
      const ageDays = isFinite(aMs) ? Math.max(0, Math.round((nowMs - aMs) / DAY)) : null
      if (openDeals.length < 150) openDeals.push({ name, value: Math.round(val), stage: stg ? stg.name : null, pipeline: pipeName[o.pipelineId] || 'Pipeline', source: label, channel: ch, ageDays })
      // Open deals grouped by their CURRENT stage — the "who's sitting where, still
      // in play" view. Full counts/values; a generous per-stage people cap.
      if (o.pipelineId && o.pipelineStageId) {
        const key = o.pipelineId + '::' + o.pipelineStageId
        let g = openByStage.get(key)
        if (!g) { g = { key, stage: stg ? stg.name : 'Stage', stageId: o.pipelineStageId, pipeline: pipeName[o.pipelineId] || 'Pipeline', pipelineId: o.pipelineId, pos: stg ? stg.pos : 999, count: 0, value: 0, deals: [] }; openByStage.set(key, g) }
        g.count++; g.value += val
        if (g.deals.length < 200) g.deals.push({ name, contactId: contactIdOf(o) || null, assignedUser: userNameOf(o.assignedTo), value: Math.round(val), source: label, channel: ch, ageDays })
      }
    }
  }
  const perCal = appts && appts.perCalendar instanceof Map ? appts.perCalendar : new Map()
  const bookingByCalendar = [...perCal.values()].map((rec) => {
    let booked = 0, occurred = 0, shown = 0; const people = []
    for (const [cid, f] of rec.byContact) {
      if (chanContacts && !chanContacts.has(cid)) continue
      const isBooked = !!f.bookedInPeriod, isOcc = !!f.hasCallInPeriod, isShown = !!f.shownByStatus
      if (!isBooked && !isOcc && !isShown) continue
      if (isBooked) booked++; if (isOcc) occurred++; if (isShown) shown++
      if (people.length < 100) people.push({ name: apptNames.get(cid) || oppNameById.get(cid) || 'Lead', occurred: isOcc, shown: isShown })
    }
    return { id: rec.id || null, calendar: rec.name || 'Calendar', booked, occurred, shown, people }
  }).filter((c) => c.booked || c.occurred || c.shown).sort((a, b) => b.booked - a.booked)
  const closeArr = [...closeByChannel.values()].map((c) => { const closed = c.won + c.lost; return { channel: c.channel, won: c.won, closed, closeRate: closed ? Math.round((c.won / closed) * 100) : null, deals: c.deals.slice(0, 100) } }).sort((a, b) => b.won - a.won)
  openDeals.sort((a, b) => b.value - a.value)
  // Per-pipeline stage AT-counts (funnel order) so the frontend key-events
  // funnel can compute cumulative reach via reachedByStage().
  const pipelinesFunnel = pipelines.map((p) => {
    const pi = idx.get(p.id); const sm = stageAt.get(p.id) || new Map()
    const stages = (pi ? pi.stages : []).map((s) => ({ id: s.id, name: s.name, pos: s.pos, count: sm.get(s.id) || 0 }))
    return { id: p.id, name: p.name, stages }
  }).filter((p) => p.stages.some((s) => s.count > 0))
  return {
    connected: true, tz, channel: chan || 'all',
    totals: { leads: leadCount, won: wonCount, lost: lostCount, open: openCount },
    oppsBySource: [...bySource.values()].map((s) => ({ ...s, value: Math.round(s.value) })).sort((a, b) => b.count - a.count),
    revenue: { total: Math.round(revenueTotal), count: wonCount, deals: wonDeals },
    open: { total: openCount, value: Math.round(openValueTotal), deals: openDeals },
    openByStage: [...openByStage.values()].map((g) => ({ key: g.key, stage: g.stage, stageId: g.stageId, pipeline: g.pipeline, pipelineId: g.pipelineId, pos: g.pos, count: g.count, value: Math.round(g.value), deals: g.deals.sort((a, b) => b.value - a.value) })).sort((a, b) => a.pos - b.pos),
    lostByReason: [...lostByReason.values()].map((r) => ({ ...r, value: Math.round(r.value) })).sort((a, b) => b.count - a.count),
    bookingByCalendar,
    closeByChannel: closeArr,
    pipelinesFunnel,
    wonByChannel: { paidWon, metaWon, googleWon },
  }
}

// Per-creative CRM performance for the Creative Cockpit: group every
// opportunity by the creative that brought it in (first-touch utm_content) and
// compute the real funnel — leads, qualified, booked, won, revenue — so each ad
// can be ranked by cost per qualified / booked / won. Keyed by the raw
// utm_content string; the caller joins it to the Meta ad name.
export async function buildCreativePerf(locationId, from, to, opts = {}) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const DAY = 86400000
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - 120 * DAY).toISOString().slice(0, 10)
  const [wideOpps, pipelines, appts] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 2000),
    fetchPipelines(locTok, locationId),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map() })),
  ])
  const idx = stageIndexFrom(pipelines)
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const opps = wideOpps.filter((o) => { const ms = Date.parse(o.createdAt); return (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs) })
  const qualStagePos = opts.qualStagePos != null ? opts.qualStagePos : null
  const C = new Map(); const M = new Map()
  const mk = (key, dimKey) => ({ [dimKey]: key, leads: 0, qualified: 0, booked: 0, shown: 0, won: 0, lost: 0, revenue: 0 })
  const getC = (key) => { let c = C.get(key); if (!c) { c = mk(key, 'content'); C.set(key, c) } return c }
  const getM = (key) => { let m = M.get(key); if (!m) { m = mk(key, 'medium'); M.set(key, m) } return m }
  for (const o of opps) {
    const u = utmOf(o); const content = u && u.content ? String(u.content) : null
    // utm_medium carries the ad set name, so it's the segment / sub-campaign key.
    const medium = u && u.medium ? String(u.medium) : null
    if (!content && !medium) continue
    const st = String(o.status || '').toLowerCase(); const val = num(o.monetaryValue)
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    const cid = contactIdOf(o); const f = cid && apptByContact.get(cid)
    // Booked call = calendar booking in period OR the opp reached this pipeline's
    // booked stage (bookPos) OR it was won. Matches the blended "booked".
    const isBooked = !!((f && f.bookedInPeriod) || (pi && pi.bookPos != null && pos >= pi.bookPos) || st === 'won')
    const isShown = !!((f && f.shownByStatus) || (pi && pi.showPos != null && pos >= pi.showPos) || st === 'won')
    const entryPos = pi && pi.stages.length ? pi.stages[0].pos : 0
    const isQual = isQualified({ status: st, pos, entryPos, hasAppt: !!(f && f.bookedInPeriod), value: val, qualStagePos })
    const bump = (e) => { e.leads++; if (st === 'won') { e.won++; e.revenue += val } else if (st === 'lost' || st === 'abandoned') e.lost++; if (isBooked) e.booked++; if (isShown) e.shown++; if (isQual) e.qualified++ }
    if (content) bump(getC(content))
    if (medium) bump(getM(medium))
  }
  const slim = (e) => ({ leads: e.leads, qualified: e.qualified, booked: e.booked, shown: e.shown, won: e.won, lost: e.lost, revenue: Math.round(e.revenue) })
  const byContent = {}; for (const c of C.values()) byContent[c.content] = slim(c)
  const byMedium = {}; for (const m of M.values()) byMedium[m.medium] = slim(m)
  return { connected: true, tz, byContent, byMedium }
}

// Extra intelligence for the Client Update module: appointment reporting nuance,
// lost-reason trends, average close time, and (for poor lead→booking cohorts) a
// sample of the notes on contacts who did NOT book, so the AI can suggest a
// likely cause. One opportunities+appointments pass; notes fetched only for the
// small non-booker sample.
export async function buildUpdateExtra(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const DAY = 86400000
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - 200 * DAY).toISOString().slice(0, 10)
  const [wideOpps, pipelines, appts, reasons] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, 2500),
    fetchPipelines(locTok, locationId),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map() })),
    ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
  ])
  const idx = stageIndexFrom(pipelines)
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  const lostReasonOf = (o) => { const rid = o.lostReasonId || o.lost_reason_id || (o.lostReason && (o.lostReason.id || o.lostReason._id)) || null; return (rid && reasonName[rid]) || (typeof o.lostReason === 'string' && o.lostReason) || 'Unspecified' }
  const NOSHOW_RE = /no.?show/i
  const inWin = wideOpps.filter((o) => { const ms = Date.parse(o.createdAt); return (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs) })
  // Appointment reporting nuance.
  let booked = 0, upcoming = 0, occurred = 0, attended = 0, noShow = 0, stageOnlyShown = 0
  // Lost-reason trend.
  const lostAgg = new Map()
  // Non-booker sample (leads with no booking, still open) for the notes dig.
  const nonBookers = []
  for (const o of inWin) {
    const st = String(o.status || '').toLowerCase()
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    const stageName = stg ? stg.name : ''
    const cid = contactIdOf(o); const f = cid && apptByContact.get(cid)
    const calBooked = !!(f && f.bookedInPeriod)
    const reachedBook = !!(pi && pi.bookPos != null && pos >= pi.bookPos)
    const isBooked = calBooked || reachedBook || st === 'won'
    const callOccurred = !!(f && f.hasCallInPeriod)
    const shown = !!(f && f.shownByStatus)
    const isNoShow = NOSHOW_RE.test(stageName)
    if (calBooked) {
      booked++
      if (shown) { attended++; occurred++ }
      else if (isNoShow) { noShow++; occurred++ }
      else if (callOccurred) { occurred++; if (pi && pi.showPos != null && pos >= pi.showPos) stageOnlyShown++ }
      else upcoming++
    } else if (isBooked && (pi && pi.showPos != null && pos >= pi.showPos) && !shown && !isNoShow) {
      // Advanced past the show stage but no appointment marked shown: reporting gap.
      stageOnlyShown++
    }
    if (st === 'lost' || st === 'abandoned') { const rn = lostReasonOf(o); const e = lostAgg.get(rn) || 0; lostAgg.set(rn, e + 1) }
    // Non-booker: an open lead with no booking and not past the booked stage.
    if (!isBooked && st !== 'lost' && st !== 'abandoned' && cid && nonBookers.length < 40) nonBookers.push({ cid, pipeline: (pi && pi.name) || 'Pipeline', created: Date.parse(o.createdAt) || 0 })
  }
  // Average close time (won opps, wide set), to judge if "no wins yet" is expected.
  let cycSum = 0, cycN = 0
  for (const o of wideOpps) { if (String(o.status || '').toLowerCase() !== 'won') continue; const c = Date.parse(o.createdAt); const w = Date.parse(o.lastStatusChangeAt || o.lastStageChangeAt || o.updatedAt || ''); if (!isFinite(c) || !isFinite(w)) continue; const d = (w - c) / DAY; if (d >= 0 && d < 400) { cycSum += d; cycN++ } }
  const avgCloseDays = cycN ? Math.round(cycSum / cycN) : null
  const lostReasons = [...lostAgg.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  // Sample the most recent non-bookers and read a short note each (light: notes
  // endpoint only, no user-name resolution). Themes only; never surfaced verbatim.
  nonBookers.sort((a, b) => b.created - a.created)
  const sample = nonBookers.slice(0, 15)
  const notes = (await mapPool(sample, 5, async (nb) => {
    try {
      const cn = await ghlGet(locTok, `/contacts/${nb.cid}/notes`, {}).then((j) => j.notes || []).catch(() => [])
      const sorted = (cn || []).slice().sort((a, b) => String(b.dateAdded || b.createdAt || '').localeCompare(String(a.dateAdded || a.createdAt || '')))
      const latest = sorted.map((n) => htmlToText(n.body || n.note || '')).filter(Boolean)[0]
      return latest ? { pipeline: nb.pipeline, note: latest.slice(0, 240) } : null
    } catch { return null }
  })).filter(Boolean)
  return {
    connected: true, tz,
    appts: { booked, upcoming, occurred, attended, noShow, stageOnlyShown },
    lostReasons, avgCloseDays, nonBookerNotes: notes.slice(0, 12), nonBookerSampled: sample.length,
  }
}

// GHL note bodies are often HTML — convert to clean text (lists → bullets,
// block tags → line breaks, entities decoded) rather than render markup.
function htmlToText(s) {
  return String(s || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, '’').replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}
// Notes on a deal's contact (Caalano Systems), newest first — the on-demand
// "why is this stuck?" context for the Users open-deal drill-down.
export async function fetchOppNotes(locationId, { contactId }) {
  if (!contactId) return { notes: [] }
  const locTok = await locationToken(locationId)
  const [cn, un] = await Promise.all([
    ghlGet(locTok, `/contacts/${contactId}/notes`, {}).then((j) => j.notes || []).catch(() => []),
    ghlGet(locTok, '/users/', { locationId }).then((j) => j.users || []).catch(() => []),
  ])
  const uName = {}; for (const u of un) uName[u.id || u._id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null
  const notes = (cn || []).map((n) => ({ body: htmlToText(n.body || n.note || ''), createdAt: n.dateAdded || n.createdAt || n.updatedAt || null, author: uName[n.userId] || null }))
    .filter((n) => n.body)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { notes }
}

export async function buildAttribution(locationId, from, to, opts = {}) {
  // Lite mode (agency overview rows): a shorter opportunity lookback + smaller
  // cap and no lost-reason fetch, so the ~13 rows each stay well under the
  // function timeout. Booked/shown still come from the (now parallel) real
  // appointment feed, so the leaderboard's numbers match the client view.
  const lite = !!opts.lite
  const locTok = await locationToken(locationId)
  // Wide opportunity lookback so a booking made in-period by a lead who first
  // came in earlier can still be credited to the creative that brought them in.
  const DAY = 86400000
  const tz = await locationTimezone(locationId)
  const fromMs = from ? zonedStartMs(from, tz) : null
  const toMs = to ? zonedEndMs(to, tz) : null
  const wideFrom = new Date((fromMs != null ? fromMs : Date.now()) - (lite ? 60 : 120) * DAY).toISOString().slice(0, 10)
  const [wideOppsAll, pipelines, reasons, appts] = await Promise.all([
    allOpportunities(locTok, locationId, wideFrom, to, lite ? 900 : 1800),
    fetchPipelines(locTok, locationId),
    lite ? Promise.resolve([]) : ghlGet(locTok, '/opportunities/lost-reason', { locationId, limit: 200 }).then((j) => j.lostReasons || []).catch(() => []),
    fetchAppointments(locTok, locationId, from, to).catch(() => ({ byContact: new Map(), connected: false })),
  ])
  // Optional pipeline scope: filter the opportunity set to a single pipeline so
  // every per-entity outcome, funnel and calendar attribution downstream is that
  // pipeline's alone. The appointment feed joins on the (now scoped) contact set,
  // so calendar bookings scope too. `pipelines` (all of them) is kept intact so
  // the UI can still offer the full pipeline picker.
  const wideOpps = opts.pipeline ? wideOppsAll.filter((o) => o.pipelineId === opts.pipeline) : wideOppsAll
  const idx = stageIndexFrom(pipelines)
  const reasonName = {}; for (const r of reasons) reasonName[r._id || r.id] = r.name
  // Lead cohort = opportunities created within [from,to]. Leads / won / revenue
  // are anchored to this - the day the lead came in.
  const opps = wideOpps.filter((o) => { const ms = Date.parse(o.createdAt); return (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs) })
  // contactId -> opportunity across the wide window, so a booking's contact can
  // be resolved to the creative that first brought them in (newest opp wins).
  const contactUtm = new Map()
  for (const o of wideOpps) { const cid = contactIdOf(o); if (cid && !contactUtm.has(cid)) contactUtm.set(cid, o) }
  const apptByContact = appts && appts.byContact instanceof Map ? appts.byContact : new Map()
  const useAppts = !!(appts && appts.connected)

  const dim = { source: new Map(), medium: new Map(), campaign: new Map(), content: new Map(), term: new Map() }
  const ent = (map, keyRaw) => {
    const key = keyRaw && String(keyRaw).trim() ? String(keyRaw).trim() : '(not set)'
    let e = map.get(key)
    if (!e) { e = { name: key, leads: 0, booked: 0, shown: 0, shownStage: 0, cancelled: 0, won: 0, revenue: 0 }; map.set(key, e) }
    return e
  }
  // Per-entity breakdowns for the green Caalano360 columns: cals[calId] = booked
  // into that calendar, stages[name] = reached that pipeline stage. Lazily
  // allocated so entities with no bookings / stages stay small.
  const bumpKey = (e, prop, key) => { if (!e || !key) return; const m = e[prop] || (e[prop] = {}); m[key] = (m[key] || 0) + 1 }
  // Cohort bump: leads / won / revenue on the lead-creation date. When
  // appointments are unavailable, fall back to pipeline-stage detection for
  // booked / shown so those clients are not left blank.
  const bumpLead = (map, keyRaw, o, pi) => {
    const e = ent(map, keyRaw)
    e.leads++
    const st = String(o.status || '').toLowerCase(); const isWon = st === 'won'
    if (isWon) { e.won++; e.revenue += num(o.monetaryValue) }
    if (!useAppts) {
      const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
      if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) e.booked++
      if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) e.shown++
    }
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
  // Opportunity source (GHL's own field, e.g. "CRM UI" for manually-added ones,
  // "public api", a form name, etc.) so tracking health can exclude manual
  // entries and show the true ad-vs-CRM gap.
  const MANUAL_RE = /crm\s*ui|manual/i
  const oppSourceCounts = new Map()
  let manualLeads = 0
  let attributed = 0
  for (const o of opps) {
    const osrc = String(o.source || '').trim() || '(not set)'
    oppSourceCounts.set(osrc, (oppSourceCounts.get(osrc) || 0) + 1)
    if (MANUAL_RE.test(osrc)) manualLeads++
    const u = utmOf(o)
    if (u.source || u.campaign) attributed++
    buckets[channelOf(u)].push(o)
    const pi = idx.get(o.pipelineId)
    bumpLead(dim.source, u.source, o, pi)
    bumpLead(dim.medium, u.medium, o, pi)
    bumpLead(dim.campaign, u.campaign, o, pi)
    bumpLead(dim.content, u.content, o, pi)
    bumpLead(dim.term, u.term, o, pi)
    // Per-entity stage reach for the green key-event columns: which stages this
    // lead reached (all stages at/behind its current stage; won reaches all).
    if (pi && pi.stages && pi.stages.length) {
      const pos = (pi.byId[o.pipelineStageId] || {}).pos
      const isWonS = String(o.status || '').toLowerCase() === 'won'
      const reached = isWonS ? pi.stages : (pos == null ? [] : pi.stages.filter((s) => s.pos <= pos))
      // Key each reached stage by name AND pipelineId::name, so a calendar/stage
      // key event linked to a specific pipeline resolves correctly in
      // multi-pipeline clients (e.g. FINR) without over-counting a same-named
      // stage in another pipeline.
      const pid = o.pipelineId
      for (const s of reached) {
        for (const key of pid ? [s.name, pid + '::' + s.name] : [s.name]) {
          bumpKey(ent(dim.campaign, u.campaign), 'stages', key)
          bumpKey(ent(dim.medium, u.medium), 'stages', key)
          bumpKey(ent(dim.content, u.content), 'stages', key)
          bumpKey(ent(dim.term, u.term), 'stages', key)
        }
      }
    }
    // Data-quality flag: a deal marked Won with no monetary value distorts
    // revenue / ROAS. Record the name so the UI can surface who to fix.
    if (String(o.status || '').toLowerCase() === 'won' && !num(o.monetaryValue)) {
      const nm = o.name || (o.contact && (o.contact.name || `${o.contact.firstName || ''} ${o.contact.lastName || ''}`.trim())) || o.contactName || 'Unnamed'
      for (const [map, key] of [[dim.campaign, u.campaign], [dim.medium, u.medium], [dim.content, u.content], [dim.term, u.term]]) {
        const e = ent(map, key); if (!e.wonNoVal) e.wonNoVal = []
        if (e.wonNoVal.length < 20 && nm) e.wonNoVal.push(nm)
      }
    }
    // per-source cohort detail
    const det = sd(u.source)
    const st = String(o.status || '').toLowerCase()
    if (st === 'won') det.status.won++; else if (st === 'lost') det.status.lost++; else if (st === 'abandoned') det.status.abandoned++; else det.status.open++
    const stg = pi ? pi.byId[o.pipelineStageId] : null
    const sname = stg ? stg.name : 'Unknown'; const spos = stg ? stg.pos : 999
    const se = det.stages.get(sname) || { name: sname, pos: spos, count: 0 }; se.count++; se.pos = Math.min(se.pos, spos); det.stages.set(sname, se)
    bumpLead(det.medium, u.medium, o, pi)
    bumpLead(det.campaign, u.campaign, o, pi)
    bumpLead(det.content, u.content, o, pi)
  }

  // Date-of-action booked / shown: a booking counts on the day it was booked; a
  // show on the day the call happened. Each is credited to the creative that
  // first brought that contact in (their opportunity's UTMs). Only contacts with
  // an opportunity are counted, so internal / partner meetings never inflate it.
  const mkAct = () => ({ booked: 0, shown: 0, shownStage: 0, cancelled: 0 })
  const chanAct = { all: mkAct(), meta: mkAct(), google: mkAct(), other: mkAct() }
  let bookedActions = 0, shownActions = 0, shownStageActions = 0, cancelledActions = 0
  if (useAppts) {
    for (const [cid, f] of apptByContact) {
      if (!f.bookedInPeriod && !f.shownByStatus && !f.hasCallInPeriod) continue
      const o = contactUtm.get(cid); if (!o) continue // no lead we can attribute to
      const u = utmOf(o); const ch = channelOf(u)
      if (f.bookedInPeriod) {
        bookedActions++; chanAct.all.booked++; chanAct[ch].booked++
        ent(dim.source, u.source).booked++; ent(dim.medium, u.medium).booked++; ent(dim.campaign, u.campaign).booked++; ent(dim.content, u.content).booked++; ent(dim.term, u.term).booked++
        const det = sd(u.source); ent(det.medium, u.medium).booked++; ent(det.campaign, u.campaign).booked++; ent(det.content, u.content).booked++
      }
      if (f.cancelledInPeriod) {
        cancelledActions++; chanAct.all.cancelled++; chanAct[ch].cancelled++
        ent(dim.source, u.source).cancelled++; ent(dim.medium, u.medium).cancelled++; ent(dim.campaign, u.campaign).cancelled++; ent(dim.content, u.content).cancelled++; ent(dim.term, u.term).cancelled++
        const det = sd(u.source); ent(det.medium, u.medium).cancelled++; ent(det.campaign, u.campaign).cancelled++; ent(det.content, u.content).cancelled++
      }
      // Shown = explicit "showed" status; else a fallback when the opportunity is
      // at/beyond the shown pipeline stage (teams who advance the stage instead
      // of marking the appointment). Both are dated by the in-period call, and
      // the stage-inferred ones are tracked separately for the (Np) marker.
      let shownHit = !!f.shownByStatus, viaStage = false
      if (!shownHit && f.hasCallInPeriod) {
        const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
        if (String(o.status || '').toLowerCase() === 'won' || (pi && pi.showPos != null && pos >= pi.showPos)) { shownHit = true; viaStage = true }
      }
      if (shownHit) {
        shownActions++; chanAct.all.shown++; chanAct[ch].shown++
        ent(dim.source, u.source).shown++; ent(dim.medium, u.medium).shown++; ent(dim.campaign, u.campaign).shown++; ent(dim.content, u.content).shown++; ent(dim.term, u.term).shown++
        const det = sd(u.source); ent(det.medium, u.medium).shown++; ent(det.campaign, u.campaign).shown++; ent(det.content, u.content).shown++
        if (viaStage) {
          shownStageActions++; chanAct.all.shownStage++; chanAct[ch].shownStage++
          ent(dim.source, u.source).shownStage++; ent(dim.medium, u.medium).shownStage++; ent(dim.campaign, u.campaign).shownStage++; ent(dim.content, u.content).shownStage++; ent(dim.term, u.term).shownStage++
          ent(det.medium, u.medium).shownStage++; ent(det.campaign, u.campaign).shownStage++; ent(det.content, u.content).shownStage++
        }
      }
    }
  }

  // Per-calendar booking funnel: split booked / shown / cancelled by which
  // calendar the appointment was in, so a multi-step sales process (e.g. an
  // online consult then an on-site quote) can be measured step by step. Only
  // contacts we can attribute to a lead are counted (same policy as the totals),
  // and each is split by channel (ch.meta / ch.google / ch.other) so the funnel
  // honours the Meta / Google channel toggle. A reschedule is already deduped to
  // one booking per (contact × calendar) upstream in fetchAppointments.
  const byCalendar = []
  if (useAppts && appts.perCalendar instanceof Map) {
    const mkCh = () => ({ booked: 0, shown: 0, cancelled: 0 })
    for (const [calId, rec] of appts.perCalendar) {
      const cal = { id: calId, name: rec.name, booked: 0, shown: 0, cancelled: 0, ch: { meta: mkCh(), google: mkCh(), other: mkCh() } }
      for (const [cid, f] of rec.byContact) {
        f.cancelledInPeriod = f._cancelled && !f._live
        if (!f.bookedInPeriod && !f.shownByStatus && !f.cancelledInPeriod) continue
        const o = contactUtm.get(cid); if (!o) continue // only attributable leads
        const u = utmOf(o); const ch = channelOf(u)
        if (f.bookedInPeriod) {
          cal.booked++; cal.ch[ch].booked++
          // Per-entity booked-into-this-calendar for the green key-event columns.
          bumpKey(ent(dim.campaign, u.campaign), 'cals', calId)
          bumpKey(ent(dim.medium, u.medium), 'cals', calId)
          bumpKey(ent(dim.content, u.content), 'cals', calId)
          bumpKey(ent(dim.term, u.term), 'cals', calId)
        }
        if (f.shownByStatus) {
          cal.shown++; cal.ch[ch].shown++
          // Per-entity shown-on-this-calendar for the green key-event columns.
          bumpKey(ent(dim.campaign, u.campaign), 'calsShown', calId)
          bumpKey(ent(dim.medium, u.medium), 'calsShown', calId)
          bumpKey(ent(dim.content, u.content), 'calsShown', calId)
          bumpKey(ent(dim.term, u.term), 'calsShown', calId)
        }
        if (f.cancelledInPeriod) { cal.cancelled++; cal.ch[ch].cancelled++ }
      }
      if (cal.booked || cal.shown || cal.cancelled) byCalendar.push(cal)
    }
    byCalendar.sort((a, b) => b.booked - a.booked)
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
  // Channel rollups: leads / won / pipelines from the cohort; booked / shown
  // overridden with the date-of-action totals so the blend agrees with the dims.
  const chan = {
    all: rollupSubset(opps, idx, reasonName),
    meta: rollupSubset(buckets.meta, idx, reasonName),
    google: rollupSubset(buckets.google, idx, reasonName),
    other: rollupSubset(buckets.other, idx, reasonName),
  }
  if (useAppts) { for (const k of ['all', 'meta', 'google', 'other']) { chan[k].totals.booked = chanAct[k].booked; chan[k].totals.shown = chanAct[k].shown; chan[k].totals.shownStage = chanAct[k].shownStage; chan[k].totals.cancelled = chanAct[k].cancelled } }

  const oppSources = [...oppSourceCounts.entries()].map(([name, count]) => ({ name, count, manual: MANUAL_RE.test(name) })).sort((a, b) => b.count - a.count)
  // Average sales-cycle length: how long a won deal takes from creation to won.
  // Used only to judge data maturity (never shown as a KPI). Measured across the
  // wide opp set (not just this range) so the average is stable; deltas outside
  // 0..400 days are ignored as data errors / re-opened deals.
  let cycSum = 0, cycN = 0
  for (const o of wideOpps) {
    if (String(o.status || '').toLowerCase() !== 'won') continue
    const c = Date.parse(o.createdAt)
    const w = Date.parse(o.lastStatusChangeAt || o.lastStageChangeAt || o.updatedAt || o.dateUpdated || '')
    if (!isFinite(c) || !isFinite(w)) continue
    const d = (w - c) / 86400000
    if (d >= 0 && d < 400) { cycSum += d; cycN++ }
  }
  const avgCloseDays = cycN ? Math.round(cycSum / cycN) : null
  return {
    connected: true, opps: opps.length, attributed, tz,
    avgCloseDays, avgCloseSample: cycN,
    allPipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    pipeline: opts.pipeline || null,
    manualLeads, oppSources,
    appointments: { connected: useAppts, calendars: (appts && appts.calendars) || 0, events: (appts && appts.events) || 0, booked: bookedActions, shown: shownActions, shownStage: shownStageActions, cancelled: cancelledActions, byCalendar },
    bySource, byMedium: top(dim.medium, 300), byCampaign: top(dim.campaign, 200), byCreative: top(dim.content, 400), byTerm: top(dim.term, 400),
    channels: chan,
  }
}

// --- Cohort maturation (leads grouped by the week they were created) ---
// "Ever" appointment state per contact: has a live (non-cancelled) booking,
// has shown, and the earliest booking timestamp (for lead->booking timing).
async function cohortAppointments(locTok, locationId, from, to) {
  const byContact = new Map()
  let calendars = []
  try { const j = await ghlGet(locTok, '/calendars/', { locationId }); calendars = j.calendars || j.calendar || [] }
  catch { return { byContact, connected: false } }
  const DAY = 86400000
  const tz = await locationTimezone(locationId)
  const startMs = (from ? zonedStartMs(from, tz) : Date.now() - 400 * DAY) - 7 * DAY
  const endMs = (to ? zonedEndMs(to, tz) : Date.now()) + 180 * DAY
  const mark = (cid, status, addedMs) => {
    if (!cid) return
    const s = String(status || '').toLowerCase()
    if (APPT_INVALID_RE.test(s)) return
    const e = byContact.get(cid) || { live: false, cancelled: false, shown: false, firstBookedMs: null }
    if (APPT_CANCEL_RE.test(s)) e.cancelled = true; else e.live = true
    if (s === 'showed') e.shown = true
    if (!isNaN(addedMs) && (e.firstBookedMs == null || addedMs < e.firstBookedMs)) e.firstBookedMs = addedMs
    byContact.set(cid, e)
  }
  for (const cal of calendars) {
    const calId = cal.id || cal._id || cal.calendarId; if (!calId) continue
    try {
      const j = await ghlGet(locTok, '/calendars/events', { locationId, calendarId: calId, startTime: startMs, endTime: endMs })
      for (const ev of (j.events || [])) mark(ev.contactId || (ev.contact && (ev.contact.id || ev.contact._id)), ev.appointmentStatus || ev.status, Date.parse(ev.dateAdded))
    } catch { /* skip a calendar we cannot read */ }
  }
  return { byContact, connected: true }
}

// Per-cohort-week CRM funnel from the direct API - appointment-accurate, with
// maturation timing. `weekIndexOf(localCreatedDate)` maps a lead's created date
// (in the location timezone) to its week-bucket index, or null if out of range.
export async function buildCohorts(locationId, from, to, weekCount, weekIndexOf) {
  const locTok = await locationToken(locationId)
  const tz = await locationTimezone(locationId)
  const [opps, pipelines, appts] = await Promise.all([
    allOpportunities(locTok, locationId, from, to, 3000),
    fetchPipelines(locTok, locationId),
    cohortAppointments(locTok, locationId, from, to),
  ])
  const idx = stageIndexFrom(pipelines)
  // Bucket each week's funnel by the lead's first-touch paid channel, so the
  // caller can view All / Meta / Google / Paid. "All" includes organic; "Paid"
  // is Meta + Google only (excludes organic/referral).
  const mk = () => ({ leads: 0, booked: 0, cancelled: 0, shown: 0, shownStage: 0, won: 0, revenue: 0, dBookSum: 0, dBookN: 0, dWonSum: 0, dWonN: 0 })
  const B = Array.from({ length: weekCount }, () => ({ meta: mk(), google: mk(), other: mk() }))
  for (const o of opps) {
    const createdMs = Date.parse(o.createdAt); if (isNaN(createdMs)) continue
    const wi = weekIndexOf(zonedDateStr(createdMs, tz)); if (wi == null || wi < 0 || wi >= B.length) continue
    const b = B[wi][channelOf(utmOf(o))]; b.leads++
    const ap = appts.byContact.get(contactIdOf(o))
    const pi = idx.get(o.pipelineId); const stg = pi ? pi.byId[o.pipelineStageId] : null; const pos = stg ? stg.pos : -1
    const isWon = String(o.status || '').toLowerCase() === 'won'
    const stageBooked = !!(pi && pi.bookPos != null && pos >= pi.bookPos)
    const stageShown = !!(pi && pi.showPos != null && pos >= pi.showPos)
    const apLive = !!(ap && ap.live), anyAppt = !!(ap && (ap.live || ap.cancelled)), apShown = !!(ap && ap.shown)
    if (isWon || anyAppt || stageBooked) {
      b.booked++
      if (anyAppt && !apLive) b.cancelled++ // booked but every appointment cancelled
      if (ap && ap.firstBookedMs != null) { const dd = (ap.firstBookedMs - createdMs) / 86400000; if (dd >= 0) { b.dBookSum += dd; b.dBookN++ } }
    }
    if (isWon || apShown || stageShown) { b.shown++; if (!apShown && !isWon && stageShown) b.shownStage++ }
    if (isWon) { b.won++; b.revenue += num(o.monetaryValue); const sc = Date.parse(o.lastStatusChangeAt); if (sc && sc >= createdMs) { b.dWonSum += (sc - createdMs) / 86400000; b.dWonN++ } }
  }
  const fin = (b) => ({ leads: b.leads, booked: b.booked, cancelled: b.cancelled, shown: b.shown, shownStage: b.shownStage, won: b.won, revenue: Math.round(b.revenue), avgDaysToBook: b.dBookN ? +(b.dBookSum / b.dBookN).toFixed(1) : null, avgDaysToWon: b.dWonN ? +(b.dWonSum / b.dWonN).toFixed(1) : null })
  const sum = (...bs) => { const s = mk(); for (const b of bs) for (const k in s) s[k] += b[k]; return s }
  return {
    connected: true,
    weeks: B.map((w) => ({ meta: fin(w.meta), google: fin(w.google), other: fin(w.other), all: fin(sum(w.meta, w.google, w.other)), paid: fin(sum(w.meta, w.google)) })),
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

// Debug (PII-free): how leads classify into meta / google / other, and the
// distinct source|medium combos landing in "other" (so we can see what a
// mis-classified paid lead looks like). No contact data.
export async function sampleChannels(locationId, from, to) {
  const locTok = await locationToken(locationId)
  const opps = await allOpportunities(locTok, locationId, from, to, 2000)
  const counts = { meta: 0, google: 0, other: 0 }
  const otherSigs = new Map()
  for (const o of opps) {
    const u = utmOf(o); const ch = channelOf(u); counts[ch]++
    if (ch === 'other') { const key = `${u.source || '(none)'} | ${u.medium || '(none)'} | ${u.campaign || '(none)'}`; otherSigs.set(key, (otherSigs.get(key) || 0) + 1) }
  }
  return {
    opps: opps.length, counts,
    otherExamples: [...otherSigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([sourceMediumCampaign, count]) => ({ sourceMediumCampaign, count })),
  }
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
