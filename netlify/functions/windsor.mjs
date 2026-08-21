// Live data backend - Windsor.ai primary. Reads WINDSOR_API_KEY from Netlify env.
// Query params:
//   client   : client id (see CLIENTS map)
//   channel  : meta | google | ghl
//   from,to  : YYYY-MM-DD  (or) preset : e.g. last_30d, last_month, this_month
//   debug    : if set, returns the raw Windsor rows + the fields requested
//              (used to confirm exact Windsor field names against live data)
//
// NOTE: metric field names marked VERIFY are best-guess until confirmed via a
// debug call; they live in one place (FIELDS) so they are trivial to correct.

import { buildAttribution, sampleAttribution, sampleChannels, buildCrm, auditLocation, isConnected, bookedTrends, crmTrends, attributionCoverage, wonInPeriod, monthlyDeals, oppTimestampFields, socialDMs, tagAudit, locationTimezone, locationProfile, periodBounds, listCalendars, listPipelines, ghlOpportunityRows, ghlPipelineRows, ghlUserRows, listLocations, checkLocationAccess, customClients, deletedClients, sampleForms, buildForms, buildSpeedToLead, speedLeadList, speedScanChunk, finalizeSpeed, buildAppointmentInsights, buildUserPerformance, buildUserPerformanceCombos, buildCreativePerf, buildUpdateExtra, fetchOppNotes, deriveBusinessHours, isQualified, buildCohorts as ghlCohorts, buildCcDrill, buildKeyPeople, buildStageTiming, buildUserCalls, warmOppSnapshot, resilientFetch } from '../lib/ghl.mjs'
import { getStore } from '@netlify/blobs'
import { currentUser, canSeeClient, isAdminish, canSeeReports } from '../lib/auth.mjs'
// Parse working-hours query params (bhDays / bhStart / bhEnd) into an hours object.
function parseHours(url) {
  const bhStart = url.searchParams.get('bhStart'), bhEnd = url.searchParams.get('bhEnd'), bhDays = url.searchParams.get('bhDays')
  if (bhStart == null || bhEnd == null || !bhDays) return null
  const days = bhDays.split(',').map(Number).filter((n) => n >= 0 && n <= 6)
  return days.length ? { days, startMin: Number(bhStart), endMin: Number(bhEnd) } : null
}

const CLIENTS = {
  'ablycalm':        { meta: '2531025873751747', google: null, ghl: 'KQtHuOcsMrdrADDBl7vD' },
  'finr-advisory':   { meta: '562656435170426',  google: null, ghl: 'A2lu96mobIYMdB9gcHte' },
  'nexia-health':    { meta: '538799668712983',  google: '774-276-3045', ghl: 'rQJAY6L6qt1JJfj16fZ8' },
  'pool-haus':       { meta: '722206724104428',  google: '881-120-8709', ghl: 'bKfWIXrhM5jei4QV5KXs' },
  'healan-centre':   { meta: '1332047794857601', google: '709-021-2791', ghl: 'wjqXt6asni9BYa2UxdrE' },
  'simchat':         { meta: '3329764523983981', google: '224-672-0300', ghl: 'DuAQ1SCknvlMWBV0M3YZ' },
  'swift-emergency': { meta: '1080637839761918', google: '388-494-0021', ghl: 'o7egUI0G0Zg7fUOiYqv1' },
  'ido-ido':         { meta: '1446200046468733', google: null, ghl: '6SmZLew5uXimr99jbuId' },
  'owl-psa':         { meta: '24559773240339868', google: null, ghl: '6hgW5WnFz8drlch9qJzg' },
  'psychology-hub':  { meta: '1849212035791025', google: '607-821-6945', ghl: 'U1Q0S61tIEvrzM4hdZSV' },
  'a2z':             { meta: '3872288763038641', google: null, ghl: 'cwJOi5EYLe2AzYjHmOWk' },
  'book-a-midwife':  { meta: '1234556101481974', google: null, ghl: null },
  'rlm-telehealth':  { meta: '1179972323913025', google: null, ghl: 'jZxjJ53Xz6JW2Cgn7Fv7' },
}

// Organic social accounts per client (Instagram business id + Facebook Page id),
// separate from the ad accounts in CLIENTS. Only clients with a connected organic
// profile appear here.
const SOCIAL = {
  'pool-haus':       { ig: '17841458350214779', fbo: '269909922862743' },
  'nexia-health':    { ig: '17841468241791448', fbo: '426741757185139' },
  'swift-emergency': { ig: '17841459789234916', fbo: '104111172706199' },
  'healan-centre':   { ig: '17841463191046298', fbo: null },
  'simchat':         { ig: '17841467452051447', fbo: null },
}

// Windsor field ids per connector. CONFIRMED via MCP where noted; others VERIFY.
const FIELDS = {
  meta: {
    connector: 'facebook',
    dims: ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking'], // CONFIRMED
    metrics: ['spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_leadgen_grouped', 'actions_onsite_conversion_lead_grouped', 'actions_offsite_conversion_fb_pixel_lead', 'actions_video_view'], // leads use native FB lead-form fields (Ads-Manager match), not the actions_lead superset
  },
  google: {
    connector: 'google_ads',
    // CONFIRMED via debug: campaign/keyword/match_type/spend/conversions/quality_score.
    // ad_group returns a resource path, so also request ad_group_name for a readable label.
    dims: ['account_id', 'campaign', 'ad_group_name', 'ad_group', 'keyword', 'search_keyword_match_type'],
    metrics: ['spend', 'impressions', 'clicks', 'conversions', 'quality_score'],
  },
  ghl: {
    connector: 'gohighlevel',
    dims: ['account_id', 'opportunity_name', 'opportunity_status', 'opportunity_source', 'opportunity_pipeline_stage_id', 'opportunity_lost_reason_id', 'opportunity_created_at', 'opportunity_assigned_to'], // CONFIRMED
    metrics: ['opportunity_monetary_value'], // CONFIRMED
  },
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const norm = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]/g, '')
// Match an ad-account id tolerant of Meta's "act_" prefix - Windsor may return
// "act_1234" while the stored/linked id is just "1234" (or the reverse). Without
// this the account filter drops every row and the deep pull comes back empty even
// though the account is correctly linked. Ad-account ids are numeric, so stripping
// a leading "act" after normalising is safe and can't collide two real accounts.
const acctKey = (s) => norm(s).replace(/^act/i, '')
const acctEq = (a, b) => { const na = acctKey(a); return na !== '' && na === acctKey(b) }
// Meta "Leads" that matches Ads Manager. The bare `actions_lead` field is a
// superset (native Facebook leads + off-Facebook website-pixel leads) and
// double-counts, over-reporting. Ads Manager's Leads result is the native
// lead-form outcome (Instant Form + on-Facebook lead/Messenger); website
// conversion campaigns report under the pixel field, so use that as a fallback.
const FB_LEAD_FIELDS = ['actions_leadgen_grouped', 'actions_onsite_conversion_lead_grouped', 'actions_offsite_conversion_fb_pixel_lead']
// Candidate Meta conversion events offered in the per-client conversion picker
// (Settings → Meta conversions). We query these for the account and only surface
// the ones that actually fired. Custom pixel conversions (custom_*) are the
// client's own funnel events (e.g. booked_appointment). Extend freely - unknown
// events fall back to a prettified label.
const META_CONV_CANDIDATES = [
  ['actions_leadgen_grouped', 'Lead - Instant Form'],
  ['actions_onsite_conversion_lead_grouped', 'Lead - on-Facebook'],
  ['actions_offsite_conversion_fb_pixel_lead', 'Lead - website pixel'],
  ['conversions_schedule_total', 'Schedule (booking)'],
  ['conversions_contact_total', 'Contact'],
  ['conversions_submit_application_total', 'Submit application'],
  ['conversions_subscribe_total', 'Subscribe'],
  ['conversions_start_trial_total', 'Start trial'],
  ['conversions_find_location_total', 'Find location'],
  ['conversions_donate_total', 'Donate'],
  ['actions_complete_registration', 'Complete registration'],
  ['actions_purchase', 'Purchase'],
  ['actions_initiate_checkout', 'Initiate checkout'],
  ['actions_add_to_cart', 'Add to cart'],
  ['actions_onsite_conversion_messaging_conversation_started_7d', 'Messaging conversation started'],
  ['actions_landing_page_view', 'Landing page views'],
  ['actions_click_to_call_call_confirm', 'Click to call - confirmed'],
  ['conversions_offsite_conversion_fb_pixel_custom_new_lead', 'New lead (custom pixel)'],
  ['conversions_offsite_conversion_fb_pixel_custom_booked_appointment', 'Booked appointment (custom pixel)'],
  ['conversions_offsite_conversion_fb_pixel_custom_booking_confirmed', 'Booking confirmed (custom pixel)'],
  ['conversions_offsite_conversion_fb_pixel_custom_shown_to_appointment', 'Shown to appointment (custom pixel)'],
  ['conversions_offsite_conversion_fb_pixel_custom_no_show_to_appointment', 'No-show to appointment (custom pixel)'],
  ['conversions_offsite_conversion_fb_pixel_custom_client_lost', 'Client lost (custom pixel)'],
]
const META_CONV_LABEL = Object.fromEntries(META_CONV_CANDIDATES)
// Result fields pulled per entity so we can report each row's OWN optimisation
// result (Ads-Manager "Results"), auto-detected from the ad set's optimisation
// goal. Every id is verified against the live Meta schema.
const META_RESULT_FIELDS = [
  'conversions_schedule_total', 'actions_leadgen_grouped', 'actions_onsite_conversion_lead_grouped',
  'actions_offsite_conversion_fb_pixel_lead', 'actions_purchase', 'conversions_contact_total',
  'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_complete_registration',
  'conversions_submit_application_total', 'actions_landing_page_view',
]
// Meta standard event (from the ad set's promoted_object.custom_event_type) →
// [result field, event noun]. The noun is combined with the ad set's destination
// to name the result exactly like Ads Manager ("Website leads", "Website
// schedule", …).
const META_EVENT_FIELD = {
  LEAD: ['actions_offsite_conversion_fb_pixel_lead', 'leads'],
  SCHEDULE: ['conversions_schedule_total', 'schedule'],
  PURCHASE: ['actions_purchase', 'purchases'],
  CONTACT: ['conversions_contact_total', 'contacts'],
  COMPLETE_REGISTRATION: ['actions_complete_registration', 'registrations'],
  SUBMIT_APPLICATION: ['conversions_submit_application_total', 'applications'],
}
const DEST_PREFIX = { WEBSITE: 'Website', MESSENGER: 'Messenger', ON_AD: 'On-Facebook', ON_POST: 'On-Facebook', ON_PAGE: 'On-Facebook', ON_VIDEO: 'On-Facebook', PHONE_CALL: 'Call', APP: 'App' }
const prettyField = (id) => META_CONV_LABEL[id] || String(id || '')
  .replace(/^(conversions|actions)_offsite_conversion_fb_pixel_custom_/, '')
  .replace(/^(conversions_|actions_)/, '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())
// Candidate Windsor field ids for a custom Meta conversion, from its Ads-Manager
// event name (e.g. "B_Page_View"). Custom pixel conversions surface as
// conversions_offsite_conversion_fb_pixel_custom_<snake>; we also try the actions_
// prefix. Used by the add-custom-conversion probe so any business's own event works.
const customConvSnake = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const customConvCandidates = (name) => {
  const s = customConvSnake(name); if (!s) return []
  return [...new Set([
    `conversions_offsite_conversion_fb_pixel_custom_${s}`,
    `actions_offsite_conversion_fb_pixel_custom_${s}`,
    `conversions_offsite_conversion_custom_${s}`,
    `actions_offsite_conversion_custom_${s}`,
    `conversions_onsite_conversion_custom_${s}`,
    `conversions_custom_${s}`,
    `actions_custom_${s}`,
  ])]
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// Windsor exposes Meta custom conversions ONLY through its separate "Custom
// Conversions" table (custom_conversion_action_name + custom_conversion_action_count).
// The per-id insights columns the app used to probe
// (conversions_offsite_conversion_custom_<id>) are unknown fields that Windsor
// rejects, which is why a custom conversion always read 0. This helper reads that
// table for one account and returns { total, perCamp } name→count maps. Both the
// friendly name ("A_event_pageview") and Meta's action-type name
// ("offsite_conversion_custom_<id>") appear as rows, so callers can look up by either.
async function fetchCustomConvCounts(cc, from, to, key, byCampaign = false, preset = null) {
  if (!cc || !cc.meta) return { total: new Map(), perCamp: new Map() }
  const flds = ['account_id', 'custom_conversion_action_name', 'custom_conversion_action_count']
  if (byCampaign) flds.splice(1, 0, 'campaign')
  const rows = (await windsorFetch('facebook', flds, from, to, preset, key)).filter((r) => !r.account_id || acctEq(r.account_id, cc.meta))
  const total = new Map(); const perCamp = new Map()
  for (const r of rows) {
    const nm = String(r.custom_conversion_action_name || '').trim().toLowerCase(); if (!nm) continue
    const n = num(r.custom_conversion_action_count)
    total.set(nm, (total.get(nm) || 0) + n)
    if (byCampaign && r.campaign) { let m = perCamp.get(r.campaign); if (!m) { m = new Map(); perCamp.set(r.campaign, m) } m.set(nm, (m.get(nm) || 0) + n) }
  }
  return { total, perCamp }
}
// Resolve a stored custom-conversion FIELD id to its Custom-Conversions-table
// action-name key. Handles the legacy insights-style ids the app stored
// (conversions_/actions_offsite_conversion_[fb_pixel_]custom_<id>) and the new
// cc:<name> scheme. Returns null for non-custom fields.
function ccActionName(fieldId) {
  const s = String(fieldId || '')
  let m = s.match(/^cc:(.+)$/i); if (m) return m[1].trim().toLowerCase()
  m = s.match(/offsite_conversion_(?:fb_pixel_)?custom_(\d{6,})/i); if (m) return `offsite_conversion_custom_${m[1]}`.toLowerCase()
  return null
}
const isCustomConvField = (f) => ccActionName(f) != null
// Friendly label for a custom-conversion field id. cc:<name> carries the name;
// a legacy insights-style id (…custom_<id>) recovers its real name from the
// Custom Conversion Definition map (id → name) when available, else a generic.
function ccLabel(fieldId, names) {
  const s = String(fieldId || '')
  const m = s.match(/^cc:(.+)$/i); if (m) return m[1].trim()
  const idm = s.match(/custom_(\d{6,})/); if (idm && names && names.get(idm[1])) return names.get(idm[1])
  return 'Custom conversion'
}
// Windsor's "Custom Conversion Definition" table maps each custom conversion id to
// its real name (e.g. 1339475751097032 → "B_Page_View"). Fetch it for one account
// so labels read as names instead of "Offsite Conversion Custom <id>".
async function fetchCustomConvNames(cc, from, to, key, preset = null) {
  if (!cc || !cc.meta) return new Map()
  try {
    const rows = (await windsorFetch('facebook', ['account_id', 'custom_conversion_id', 'custom_conversion_name'], from, to, preset, key)).filter((r) => !r.account_id || acctEq(r.account_id, cc.meta))
    const m = new Map()
    for (const r of rows) { const id = String(r.custom_conversion_id || '').trim(); const nm = String(r.custom_conversion_name || '').trim(); if (id && nm) m.set(id, nm) }
    return m
  } catch { return new Map() }
}
// Auto-detect a row's result field + Ads-Manager-style label from its ad set
// optimisation goal + destination + promoted object. Returns null when it can't
// be resolved (e.g. a custom conversion), so the caller falls back to the
// client's configured primary.
function resolveMetaResult(row) {
  const goal = String(row.adset_optimization_goal || '').toUpperCase()
  const dest = String(row.adset_destination_type || '').toUpperCase()
  let promoted = {}
  try { promoted = row.adset_promoted_object ? (typeof row.adset_promoted_object === 'string' ? JSON.parse(row.adset_promoted_object) : row.adset_promoted_object) : {} } catch { promoted = {} }
  const evt = String(promoted.custom_event_type || '').toUpperCase()
  // Lead-gen = Instant Forms (or on-Facebook leads) - count the native lead form
  // submissions, not the website pixel lead.
  if (goal === 'LEAD_GENERATION' || goal === 'QUALITY_LEAD') return { field: 'leads_native', label: dest === 'ON_AD' || dest === 'MESSENGER' ? 'On-Facebook leads' : 'Instant form leads' }
  if (goal.includes('CONVERSATION') || goal === 'MESSAGING_PURCHASE_CONVERSION') return { field: 'actions_onsite_conversion_messaging_conversation_started_7d', label: 'Messaging conversations' }
  if (goal === 'OFFSITE_CONVERSIONS' || goal === 'ONSITE_CONVERSIONS' || goal === 'CONVERSIONS') {
    const m = META_EVENT_FIELD[evt]; if (!m) return null
    const prefix = DEST_PREFIX[dest] || (goal === 'ONSITE_CONVERSIONS' ? 'On-Facebook' : 'Website')
    return { field: m[0], label: `${prefix} ${m[1]}` }
  }
  if (goal === 'LINK_CLICKS') return { field: 'inline_link_clicks', label: 'Link clicks' }
  // Traffic campaigns optimised to landing-page views (e.g. a "Page View" campaign)
  // count those views as their result - so they don't read as 0 against a lead primary.
  if (goal === 'LANDING_PAGE_VIEWS') return { field: 'actions_landing_page_view', label: 'Landing page views' }
  return null
}
// Resolve a row's result using auto-detect first, then the client's configured
// primary conversion, then leads as the last resort. Returns {field,label,auto}.
function rowResult(entity, fallback) {
  const auto = resolveMetaResult({ adset_optimization_goal: entity.optGoal, adset_destination_type: entity.destType, adset_promoted_object: entity.promoted })
  if (auto) return { field: auto.field, label: auto.label, auto: true }
  // Multiple configured primary conversions → sum them; the field becomes an array.
  const fields = (fallback && fallback.fields && fallback.fields.length) ? fallback.fields : (fallback && fallback.field ? [fallback.field] : [])
  if (fields.length > 1) return { field: fields, label: fallback.label || 'Results', auto: false }
  // Prefer the fallback's (name-resolved) label so a single custom-conversion
  // primary reads e.g. "B_Page_View" rather than "Offsite Conversion Custom <id>".
  if (fields.length === 1) return { field: fields[0], label: (fallback && fallback.label) || cap1(prettyField(fields[0])), auto: false }
  return { field: null, label: 'Leads', auto: false }
}
// 'leads_native' = Instant Form + on-Facebook leads (matches Ads Manager's
// lead-gen "Results"); null field = fbLeads; else the raw conversion field. An array
// of fields (multiple configured primaries) sums each.
const resultCountOne = (entity, field) => field === 'inline_link_clicks' ? entity.linkClicks
  : field === 'leads_native' ? ((entity._rf ? (entity._rf.actions_leadgen_grouped || 0) + (entity._rf.actions_onsite_conversion_lead_grouped || 0) : 0) || entity.leads)
  : field ? (entity._rf ? entity._rf[field] || 0 : 0) : entity.leads
const resultCount = (entity, field) => Array.isArray(field) ? field.reduce((s, f) => s + resultCountOne(entity, f), 0) : resultCountOne(entity, field)
// All conversion actions an entity accrued (non-zero), for the results hover -
// so a Lead campaign can still show it also drove messaging, website leads, etc.
const META_BREAKDOWN = [
  ['actions_leadgen_grouped', 'Instant form leads'], ['actions_onsite_conversion_lead_grouped', 'On-Facebook leads'],
  ['actions_offsite_conversion_fb_pixel_lead', 'Website leads'], ['conversions_schedule_total', 'Schedule'],
  ['actions_purchase', 'Purchase'], ['conversions_contact_total', 'Contact'],
  ['actions_onsite_conversion_messaging_conversation_started_7d', 'Messaging conversations'],
  ['actions_complete_registration', 'Registration'], ['conversions_submit_application_total', 'Application'],
]
const breakdownOf = (e) => META_BREAKDOWN.map(([f, lbl]) => ({ label: lbl, count: Math.round((e._rf && e._rf[f]) || 0) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count)
const fbLeads = (r) => { const native = num(r.actions_leadgen_grouped) + num(r.actions_onsite_conversion_lead_grouped); return native || num(r.actions_offsite_conversion_fb_pixel_lead) }

// Everything reports against Australian Eastern time (Sydney). "Today" is the
// current calendar day there, represented as a UTC-midnight Date so the existing
// getUTCDay / setUTCDate arithmetic operates on the correct local day.
const TZ = 'Australia/Sydney'
function tzToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t) => p.find((x) => x.type === t).value
  return new Date(`${g('year')}-${g('month')}-${g('day')}T00:00:00Z`)
}

// The equal-length period immediately before [from,to] - for ±vs-previous deltas.
function prevRange(from, to) {
  if (!from || !to) return { from: null, to: null }
  const f = new Date(from + 'T00:00:00Z'), t = new Date(to + 'T00:00:00Z')
  const days = Math.round((t - f) / 86400000) + 1
  const pt = new Date(f); pt.setUTCDate(pt.getUTCDate() - 1)
  const pf = new Date(pt); pf.setUTCDate(pf.getUTCDate() - (days - 1))
  const isod = (d) => d.toISOString().slice(0, 10)
  return { from: isod(pf), to: isod(pt) }
}

// Rough span of the requested window in days (for preset windows we approximate).
function windowDays(from, to, preset) {
  if (from && to) { const d = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1; return Number.isFinite(d) && d > 0 ? d : 30 }
  if (preset === 'this_year' || preset === 'last_year') return 365
  if (preset === 'last_90d' || preset === 'this_quarter') return 90
  if (String(preset || '').includes('month')) return 31
  return 30
}
async function windsorFetch(connector, fields, from, to, preset, key) {
  const p = new URLSearchParams({ api_key: key, fields: fields.join(',') })
  if (from && to) { p.set('date_from', from); p.set('date_to', to) }
  else { p.set('date_preset', preset || 'last_30d') }
  const url = `https://connectors.windsor.ai/${connector}?${p.toString()}`
  // The Netlify function is hard-stopped at ~10s, so EVERY attempt must finish
  // inside that budget - otherwise the whole function is killed mid-flight and the
  // browser gets a raw 502 it can't explain (looks like "nothing loads"). So cap
  // the per-attempt timeout under the limit and skip the retry on larger windows,
  // where there's no time for a second try. buildMeta / buildGoogle fire their
  // Windsor calls in parallel, so the wall-clock is ~one attempt, not the sum -
  // and the heavy optional queries each .catch to []. A window too big to return
  // in time aborts cleanly and the caller surfaces a real "try a smaller range"
  // message instead of hanging.
  const days = windowDays(from, to, preset)
  const timeoutMs = days > 120 ? 8500 : days > 60 ? 8000 : 7500
  const retries = days > 60 ? 0 : 1
  const r = await resilientFetch(url, {}, { label: `Windsor ${connector}`, timeoutMs, retries })
  if (!r.ok) throw new Error(`Windsor ${connector} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return j.data || j.result || []
}

// Aggregate a set of Meta rows by a key field into a metrics map. Leads use the
// Ads-Manager-matching definition (fbLeads), not the double-counting superset.
function aggMeta(rows, keyField, extra = []) {
  const m = new Map()
  const resultFields = extra.length ? [...META_RESULT_FIELDS, ...extra] : META_RESULT_FIELDS
  for (const r of rows) {
    const k = r[keyField]; if (!k) continue
    let e = m.get(k)
    if (!e) { e = { name: k, campaign: r.campaign || null, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0, _rf: {}, optGoal: null, destType: null, promoted: null }; m.set(k, e) }
    e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks)
    e.linkClicks += num(r.inline_link_clicks); e.leads += fbLeads(r); e.videoViews += num(r.actions_video_view); e.reach += num(r.reach)
    for (const f of resultFields) e._rf[f] = (e._rf[f] || 0) + num(r[f])
    if (!e.optGoal && r.adset_optimization_goal) e.optGoal = r.adset_optimization_goal
    if (!e.destType && r.adset_destination_type) e.destType = r.adset_destination_type
    if (!e.promoted && r.adset_promoted_object) e.promoted = r.adset_promoted_object
  }
  return [...m.values()]
}
const clean = (e) => { const { _rf, optGoal, destType, promoted, ...v } = e; return v }
function rollupMeta(adRows, dayRows, accRows, campRows, adsetRows, pCampRows, fallback, extra = []) {
  // FIX A: campaign / ad-set counts come from Meta's own per-level breakdowns
  // (de-duplicated at each level), not from summing the ad rows, so they match
  // Meta Ads Manager instead of inflating via cross-ad attribution.
  const campaignsRaw = aggMeta(campRows, 'campaign', extra).sort((a, b) => b.spend - a.spend)
  const prevCamp = new Map()
  for (const c of aggMeta(pCampRows || [], 'campaign', extra)) prevCamp.set(c.name, c)
  // Ad sets carry the optimisation goal + promoted object, so results resolve
  // here first; campaign + ad results are rolled up / joined from them.
  const adsets = aggMeta(adsetRows, 'adset_name', extra).sort((a, b) => b.spend - a.spend)
  for (const a of adsets) {
    const rr = rowResult(a, fallback)
    a.resultField = rr.field; a.resultType = rr.label; a.resultAuto = rr.auto
    a.results = resultCount(a, rr.field)
    a.costPerResult = a.results ? Math.round((a.spend / a.results) * 100) / 100 : null
    a.breakdown = breakdownOf(a)
  }
  const adsetByName = new Map(adsets.map((a) => [a.name, a]))
  // Per-campaign result: sum of its ad sets' own results; type is uniform label
  // or "Mixed" when a campaign runs ad sets optimising to different events.
  const campRes = new Map()
  for (const a of adsets) { if (!a.campaign) continue; let e = campRes.get(a.campaign); if (!e) { e = { labels: new Set(), results: 0 }; campRes.set(a.campaign, e) } e.labels.add(a.resultType); e.results += a.results }
  const campaigns = campaignsRaw.map((c) => {
    const e = campRes.get(c.name)
    if (e) { c.resultType = e.labels.size === 1 ? [...e.labels][0] : 'Mixed'; c.results = e.results }
    else { const rr = rowResult(c, fallback); c.resultType = rr.label; c.results = resultCount(c, rr.field) }
    c.costPerResult = c.results ? Math.round((c.spend / c.results) * 100) / 100 : null
    c.breakdown = breakdownOf(c)
    const p = prevCamp.get(c.name)
    c.prev = p ? { spend: p.spend, impressions: p.impressions, clicks: p.clicks, linkClicks: p.linkClicks, leads: p.leads, videoViews: p.videoViews, reach: p.reach } : null
    return clean(c)
  })
  const readFieldOne = (r, field) => field === 'inline_link_clicks' ? num(r.inline_link_clicks) : field === 'leads_native' ? fbLeads(r) : field ? num(r[field]) : fbLeads(r)
  const readField = (r, field) => Array.isArray(field) ? field.reduce((s, f) => s + readFieldOne(r, f), 0) : readFieldOne(r, field)
  const ads = adRows.map((r) => {
    const parent = adsetByName.get(r.adset_name)
    const field = parent ? parent.resultField : ((fallback && fallback.fields && fallback.fields.length ? (fallback.fields.length > 1 ? fallback.fields : fallback.fields[0]) : (fallback && fallback.field)) || null)
    const label = parent ? parent.resultType : (fallback ? fallback.label : 'Leads')
    const results = readField(r, field)
    const spend = num(r.spend)
    return {
      name: r.ad_name, campaign: r.campaign, adset: r.adset_name,
      type: num(r.actions_video_view) > 0 ? 'Video' : 'Image',
      quality: r.quality_ranking || 'UNKNOWN', thumb: r.thumbnail_url, igUrl: r.instagram_permalink_url || null,
      reach: num(r.reach),
      spend, impressions: num(r.impressions), clicks: num(r.clicks),
      linkClicks: num(r.inline_link_clicks), leads: fbLeads(r), videoViews: num(r.actions_video_view),
      resultType: label, results, costPerResult: results ? Math.round((spend / results) * 100) / 100 : null,
    }
  }).filter((a) => a.name).sort((a, b) => b.spend - a.spend)
  // daily series, sorted ascending by date
  const dmap = new Map()
  for (const r of dayRows) {
    const d = String(r.date || '').slice(0, 10); if (!d) continue
    const e = dmap.get(d) || { date: d, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 }
    e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.linkClicks += num(r.inline_link_clicks); e.leads += fbLeads(r)
    dmap.set(d, e)
  }
  const daily = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date))
  // account totals (reach/frequency are only correct from an account-level pull)
  const totals = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0 }
  for (const r of accRows) { totals.spend += num(r.spend); totals.impressions += num(r.impressions); totals.clicks += num(r.clicks); totals.linkClicks += num(r.inline_link_clicks); totals.leads += fbLeads(r); totals.videoViews += num(r.actions_video_view); totals.reach += num(r.reach) }
  // Results can't be one number when ad sets optimise to different events, so the
  // account total is a per-result-type breakdown (like Ads Manager).
  const bd = {}
  for (const a of adsets) { if (a.results) bd[a.resultType] = (bd[a.resultType] || 0) + a.results }
  totals.resultBreakdown = Object.entries(bd).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  totals.results = totals.resultBreakdown.reduce((s, x) => s + x.count, 0)
  totals.costPerResult = totals.results ? Math.round((totals.spend / totals.results) * 100) / 100 : null
  return { campaigns, adsets: adsets.map(clean), ads, daily, totals }
}
function metaTotals(accRows) {
  const t = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0 }
  for (const r of accRows) { t.spend += num(r.spend); t.impressions += num(r.impressions); t.clicks += num(r.clicks); t.linkClicks += num(r.inline_link_clicks); t.leads += fbLeads(r); t.videoViews += num(r.actions_video_view); t.reach += num(r.reach) }
  return t
}
// The client's configured PRIMARY Meta conversion (Settings → Meta conversions),
// used as the result fallback when auto-detect can't resolve a row (e.g. a custom
// conversion). Read from the shared settings blob.
async function readMetaPrimary(clientId) {
  try {
    const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const mc = s && s.metaconv && s.metaconv[clientId]
    const primary = mc ? (Array.isArray(mc.primary) ? mc.primary.filter(Boolean) : (mc.primary ? [mc.primary] : [])) : []
    if (primary.length) {
      // Custom conversion fields (not in the standard result set) must be fetched +
      // captured explicitly so resultCount can read them - return them as `extra`.
      const ids = [...primary, ...(mc.secondary || [])].filter(Boolean)
      const std = new Set(META_RESULT_FIELDS)
      // Custom-conversion ids are NOT real Windsor insights columns (Windsor serves
      // custom conversions only via its separate Custom Conversions table), so never
      // request them as columns - they'd null out at best and can error the query at
      // worst. They still travel in `fields` for labelling / future table injection.
      const extra = [...new Set(ids.filter((f) => !std.has(f) && !isCustomConvField(f)))]
      const label = primary.length === 1 ? cap1(prettyField(primary[0])) : `${cap1(prettyField(primary[0]))} +${primary.length - 1} more`
      return { field: primary[0], fields: primary, label, extra }
    }
  } catch { /* ignore */ }
  return null
}
// Every client's configured PRIMARY Meta conversion field id, keyed by client id, in
// one settings read - so the cross-client trends builder can count each client's own
// optimised event (custom conversions included) instead of just standard leads.
async function readAllMetaPrimary() {
  const out = {}
  try {
    const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const mc = (s && s.metaconv) || {}
    for (const [cid, v] of Object.entries(mc)) { const p = v ? (Array.isArray(v.primary) ? v.primary.filter(Boolean) : (v.primary ? [v.primary] : [])) : []; if (p.length) out[cid] = p }
  } catch { /* ignore */ }
  return out
}
// Health-score config for a client: pillar weights + optional qualified-stage
// override. Falls back to equal 25/25/25/25 weights and the zero-config
// qualified default when nothing is configured.
async function readHealthConfig(clientId) {
  const out = { weights: { marketing: 25, sales: 25, ops: 25, revenue: 25 }, qualStagePos: null }
  try {
    const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const h = s && s.health
    const glob = h && h._global
    const per = h && h[clientId]
    const wOf = (o) => (o && o.weights && typeof o.weights === 'object') ? o.weights : null
    const gw = wOf(glob), pw = wOf(per)
    if (gw) out.weights = { ...out.weights, ...gw }
    if (pw) out.weights = { ...out.weights, ...pw }
    if (per && per.qualStagePos != null) out.qualStagePos = num(per.qualStagePos)
  } catch { /* defaults */ }
  return out
}

// Daily health-score history per client (Netlify Blobs). One object per client,
// keyed by ISO date, capped so it can't grow without bound. The interactive
// scope reads it for the trend; the snapshot job writes it once a day on a fixed
// trailing window so points are comparable over time.
const healthStore = () => getStore({ name: 'caalano-health', consistency: 'strong' })
async function readHealthHistory(clientId) {
  try {
    const rec = await healthStore().get(clientId, { type: 'json' })
    const days = (rec && rec.days) || {}
    return Object.entries(days).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))
  } catch { return [] }
}
async function writeHealthSnapshot(clientId, date, point) {
  const st = healthStore()
  const rec = (await st.get(clientId, { type: 'json' }).catch(() => null)) || { days: {} }
  rec.days = rec.days || {}
  rec.days[date] = point
  // Keep the most recent ~400 days.
  const keys = Object.keys(rec.days).sort()
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete rec.days[k]
  rec.updatedAt = new Date().toISOString()
  await st.setJSON(clientId, rec)
  return rec.days[date]
}

// Compute a fixed trailing-window health point for one client and store it under
// `date`, so daily points stay comparable regardless of the UI's selected range.
const addDaysStr = (dateStr, delta) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10) }
async function snapshotClient(clientId, cc, key, date, windowDays = 30) {
  const to = date
  const from = addDaysStr(date, -(windowDays - 1))
  const cfg = await readHealthConfig(clientId)
  const h = await buildHealth(cc, from, to, null, key, cfg.weights)
  const s = h.score
  const point = {
    composite: s.composite, marketing: s.marketing, sales: s.sales, ops: s.ops, revenue: s.revenue,
    leads: h.kpis.leads || 0, qualified: h.kpis.qualified || 0, spend: h.kpis.adSpend || 0, revenue$: h.kpis.revenue || 0, won: h.kpis.won || 0,
    window: windowDays,
  }
  await writeHealthSnapshot(clientId, date, point)
  return point
}
// Daily snapshot across every client (scheduled). Sequential + resilient: one
// client failing never aborts the rest. `dates` optional (defaults to today).
export async function runHealthSnapshots(dates) {
  const key = process.env.WINDSOR_API_KEY
  if (!key) return { ok: false, error: 'WINDSOR_API_KEY not set' }
  try { Object.assign(CLIENTS, await customClients()); for (const id of await deletedClients()) delete CLIENTS[id] } catch { /* non-fatal */ }
  const today = new Date().toISOString().slice(0, 10)
  const targets = (dates && dates.length) ? dates : [today]
  const results = []
  for (const [id, cc] of Object.entries(CLIENTS)) {
    if (!cc.ghl && !cc.meta && !cc.google) continue
    for (const date of targets) {
      try { const p = await snapshotClient(id, cc, key, date); results.push({ client: id, date, composite: p.composite }) }
      catch (e) { results.push({ client: id, date, error: String(e.message || e).slice(0, 120) }) }
    }
  }
  return { ok: true, count: results.length, results }
}

// Scheduled warmer: refresh every CRM client's shared opportunity snapshot so the
// interactive scopes (users / ccdrill / speed / appts / forms / health) read the
// Blobs cache instead of each re-paging /opportunities/search. That endpoint is the
// source of nearly every 429 in the reliability log; keeping the snapshot hot moves
// the opp pulls off the user path and out of concurrent bursts. Sequential on
// purpose - one gentle pull at a time, never a fan-out - and resilient per client.
export async function runOppWarm() {
  try { Object.assign(CLIENTS, await customClients()); for (const id of await deletedClients()) delete CLIENTS[id] } catch { /* non-fatal */ }
  const results = []
  for (const [id, cc] of Object.entries(CLIENTS)) {
    if (!cc.ghl) continue
    try { const r = await warmOppSnapshot(cc.ghl); results.push({ client: id, ...r }) }
    catch (e) { results.push({ client: id, error: String(e.message || e).slice(0, 120) }) }
  }
  return { ok: true, count: results.length, warmed: results.filter((r) => !r.error).length, results }
}

// Windsor id→name maps for ad campaign / ad set / creative. CRM UTMs often carry a
// numeric platform id (very common for utm_campaign), so a raw UTM can't be shown as
// a name without this lookup. Lightweight Windsor reads (Meta + Google id+name
// pairs) - these hit the ad platforms via Windsor, NOT GoHighLevel, so they don't
// touch the CRM rate limit the reliability work is protecting. Best-effort: any miss
// just leaves the raw value untouched. Same pairing the `attribution` channel builds.
async function fetchAdIdNameMaps(cc, from, to, preset, key) {
  const filtG = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, cc.google))
  const filtM = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, cc.meta))
  const [ggIds, fbIds, ggAdIds] = await Promise.all([
    cc.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'campaign_id', 'ad_group_name', 'ad_group_id'], from, to, preset, key).then(filtG).catch(() => []) : Promise.resolve([]),
    cc.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'campaign_id', 'adset_name', 'adset_id', 'ad_name', 'ad_id'], from, to, preset, key).then(filtM).catch(() => []) : Promise.resolve([]),
    cc.google ? windsorFetch('google_ads', ['account_id', 'ad_group_name', 'ad_id'], from, to, preset, key).then(filtG).catch(() => []) : Promise.resolve([]),
  ])
  const campaign = {}, medium = {}, content = {}
  const put = (m, id, nm) => { const i = String(id ?? '').trim(); if (i && nm && !m[i]) m[i] = nm }
  for (const r of ggIds) { put(campaign, r.campaign_id, r.campaign); put(medium, r.ad_group_id, r.ad_group_name) }
  for (const r of ggAdIds) { put(medium, r.ad_id, r.ad_group_name) } // Google ad-id → ad group
  for (const r of fbIds) { put(campaign, r.campaign_id, r.campaign); put(medium, r.adset_id, r.adset_name); put(content, r.ad_id, r.ad_name) }
  return { campaign, medium, content }
}
// Rewrite each Forms person's campaign / ad set / creative from a numeric id to its
// name using the maps above. Idempotent + best-effort (an unresolved value stays as
// it was), and dedupes by object identity since form-people and answer-people share
// the same person object references.
function resolveFormsAttribution(data, maps) {
  if (!maps || !data) return
  const seen = new Set()
  const rz = (v, m) => { if (v == null) return v; const s = String(v).trim(); return (m && m[s]) || v }
  const fix = (p) => { if (!p || seen.has(p)) return; seen.add(p); p.campaign = rz(p.campaign, maps.campaign); p.adset = rz(p.adset, maps.medium); p.creative = rz(p.creative, maps.content) }
  for (const f of (data.forms || [])) {
    for (const p of (f.people || [])) fix(p)
    for (const s of (f.segments || [])) for (const a of (s.answers || [])) for (const p of (a.people || [])) fix(p)
  }
}

async function buildMeta(accountId, from, to, preset, key, fallback) {
  const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, accountId))
  const pr = prevRange(from, to)
  // The client's configured CUSTOM conversion fields (Settings → Meta conversions) are
  // pulled + counted alongside the standard result set, so a non-standard optimised
  // event (e.g. B_Page_View) reports its own "Results" everywhere, matching Ads Manager.
  const extra = (fallback && fallback.extra) || []
  const RESULT_FIELDS = extra.length ? [...META_RESULT_FIELDS, ...extra] : META_RESULT_FIELDS
  const accFields = ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, 'actions_video_view']
  const campFields = ['account_id', 'campaign', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...RESULT_FIELDS, 'actions_video_view']
  // Ad-set query carries the optimisation goal + promoted object so results
  // auto-detect per ad set.
  const adsetFields = ['account_id', 'campaign', 'adset_name', 'adset_optimization_goal', 'adset_destination_type', 'adset_promoted_object', 'campaign_objective', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...RESULT_FIELDS, 'actions_video_view']
  // The per-ad-per-day breakdown (adDaily) is by far the heaviest query - for a
  // year that's (#ads x 365) rows, which blows the payload and the time budget.
  // For big windows drop it to campaign x day (10-50x smaller); the campaign
  // daily chart and the day drill's campaign split still work - only the
  // per-creative day drill is coarser over long ranges.
  const bigWin = windowDays(from, to, preset) > 120
  const adDayFields = bigWin
    ? ['account_id', 'date', 'campaign', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS]
    : ['account_id', 'date', 'campaign', 'adset_name', 'ad_name', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS]
  // On a big window the per-creative pull is the heaviest essential query. Let it
  // degrade to [] (empty creative section) rather than abort the whole Meta tab -
  // the campaign / ad-set tables + totals come from the lighter campRows/adsetRows
  // and still render. Small windows are cheap, so this rarely triggers there.
  const adCatch = windowDays(from, to, preset) > 90
  const [adRows, dayRows, accRows, prevRows, adDayRows, campRows, adsetRows, pCampRows] = await Promise.all([
    (adCatch
      ? windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'reach', 'instagram_permalink_url', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...RESULT_FIELDS, 'actions_video_view'], from, to, preset, key).then(filt).catch(() => [])
      : windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'reach', 'instagram_permalink_url', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...RESULT_FIELDS, 'actions_video_view'], from, to, preset, key).then(filt)),
    windsorFetch('facebook', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS], from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('facebook', accFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', accFields, pr.from, pr.to, null, key).then(filt).catch(() => []) : Promise.resolve([]),
    windsorFetch('facebook', adDayFields, from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('facebook', campFields, from, to, preset, key).then(filt),
    windsorFetch('facebook', adsetFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', campFields, pr.from, pr.to, null, key).then(filt).catch(() => []) : Promise.resolve([]),
  ])
  // Resolve custom-conversion primaries to their real names (Custom Conversion
  // Definition table: id → name) so the Results label reads e.g. "B_Page_View"
  // instead of "Offsite Conversion Custom <id>". Rebuild the fallback label
  // rollupMeta stamps onto every row before the rollup runs.
  let ccNames = null
  if (fallback && (fallback.fields || []).some(isCustomConvField)) {
    ccNames = await fetchCustomConvNames({ meta: accountId }, from, to, key, preset)
    const lab1 = (f) => isCustomConvField(f) ? ccLabel(f, ccNames) : cap1(META_CONV_LABEL[f] || prettyField(f))
    const fs = fallback.fields
    fallback = { ...fallback, label: fs.length === 1 ? lab1(fs[0]) : `${lab1(fs[0])} +${fs.length - 1} more` }
  }
  const roll = rollupMeta(adRows, dayRows, accRows, campRows, adsetRows, pCampRows, fallback, extra)
  roll.prev = metaTotals(prevRows)
  // Custom-conversion RESULTS injection. Windsor serves custom conversions only via
  // its separate Custom Conversions table, so they never reach the insights rollup
  // above (every custom field reads 0 there). For a client whose configured PRIMARY
  // includes a custom conversion, add that conversion's real count - per campaign and
  // to the account total - on top of the standard results, honouring the Settings
  // promise "headline = the sum of every primary you tick". Add-only: since the
  // insights value for a custom field is always 0, this can never double-count.
  const ccPrimary = ((fallback && fallback.fields) || []).filter(isCustomConvField)
  if (ccPrimary.length) {
    try {
      const { total, perCamp } = await fetchCustomConvCounts({ meta: accountId }, from, to, key, true, preset)
      const sumFor = (m) => ccPrimary.reduce((s, f) => { const an = ccActionName(f); return s + (an && m ? (m.get(an) || 0) : 0) }, 0)
      const addTotal = sumFor(total)
      if (addTotal > 0) {
        const bd = { ...(Object.fromEntries((roll.totals.resultBreakdown || []).map((b) => [b.label, b.count]))) }
        for (const f of ccPrimary) { const an = ccActionName(f); const c = an ? (total.get(an) || 0) : 0; if (c > 0) { const lab = ccLabel(f, ccNames); bd[lab] = (bd[lab] || 0) + c } }
        roll.totals.results = (roll.totals.results || 0) + addTotal
        roll.totals.resultBreakdown = Object.entries(bd).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
        roll.totals.costPerResult = roll.totals.results ? Math.round((roll.totals.spend / roll.totals.results) * 100) / 100 : null
      }
      const campCustom = new Map(); const campSpend = new Map()
      for (const c of roll.campaigns || []) {
        const add = sumFor(perCamp.get(c.name))
        campSpend.set(c.name, c.spend || 0)
        if (add > 0) { campCustom.set(c.name, add); c.results = (c.results || 0) + add; c.costPerResult = c.results ? Math.round((c.spend / c.results) * 100) / 100 : null }
      }
      // Windsor breaks custom conversions down only to campaign, so allocate each
      // campaign's count to its ad sets / ads by spend share - the drill-downs then
      // reflect the custom conversion too, and each campaign's total stays exact.
      if (campCustom.size) {
        const allocate = (rows) => { for (const r of rows || []) { const cust = campCustom.get(r.campaign); if (!cust) continue; const cs = campSpend.get(r.campaign) || 0; const add = Math.round(cust * (cs > 0 ? (r.spend || 0) / cs : 0)); if (add > 0) { r.results = (r.results || 0) + add; r.costPerResult = r.results ? Math.round((r.spend / r.results) * 100) / 100 : null } } }
        allocate(roll.adsets); allocate(roll.ads)
      }
    } catch { /* leave standard results unchanged on any failure */ }
  }
  roll.adDaily = adDayRows.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adset: r.adset_name || null, ad: r.ad_name || null, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), linkClicks: num(r.inline_link_clicks), leads: fbLeads(r) })).filter((r) => r.date && (r.ad || r.campaign))
  roll.adDailyLevel = bigWin ? 'campaign' : 'ad'
  return roll
}

// --- Meta Creative Fatigue (proxy) -----------------------------------------
// Meta's own creative_fatigue signal is webhook-push-only (not queryable), so
// this approximates the same Low/Med/High from the signals we CAN pull via
// Windsor: frequency (impressions / reach - the leading indicator), CTR decline
// across the period (first half vs second half), and Meta's quality ranking.
// Scored per creative (aggregated by ad name); indicative, not Meta's exact call.
const FATIGUE_DEFAULTS = { freqMed: 3, freqHigh: 5, ctrDropMed: 0.15, ctrDropHigh: 0.35, minImpr: 800 }
function metaFatigue(ads, daily, cfg) {
  const c = { ...FATIGUE_DEFAULTS, ...(cfg || {}) }
  const C = new Map()
  for (const a of ads) {
    if (!a.name) continue
    const e = C.get(a.name) || { name: a.name, campaign: a.campaign, adset: a.adset, thumb: a.thumb || null, format: a.type || null, quality: null, reach: 0, impressions: 0, clicks: 0, spend: 0 }
    e.impressions += num(a.impressions); e.clicks += num(a.clicks); e.spend += num(a.spend); e.reach += num(a.reach)
    if (!e.thumb && a.thumb) e.thumb = a.thumb
    // Keep the worst (below-average) quality ranking we see for the creative.
    if (a.quality && a.quality !== 'UNKNOWN' && (!e.quality || /BELOW_AVERAGE/i.test(a.quality))) e.quality = a.quality
    C.set(a.name, e)
  }
  // Daily impressions/clicks per creative for the CTR trend.
  const D = new Map()
  for (const r of (daily || [])) { const ad = r.ad || r.ad_name; const date = r.date; if (!ad || !date) continue; let m = D.get(ad); if (!m) { m = new Map(); D.set(ad, m) } const d = m.get(date) || { i: 0, k: 0 }; d.i += num(r.impressions); d.k += num(r.clicks); m.set(date, d) }
  const ctrDropOf = (name) => {
    const m = D.get(name); if (!m || m.size < 4) return null
    const days = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const mid = Math.floor(days.length / 2); let i1 = 0, k1 = 0, i2 = 0, k2 = 0
    days.forEach(([, v], i) => { if (i < mid) { i1 += v.i; k1 += v.k } else { i2 += v.i; k2 += v.k } })
    // Need a real baseline both halves, else a couple of clicks fake a 100% "drop".
    if (k1 < 4 || i1 < 200 || i2 < 200) return null
    const ctr1 = i1 ? k1 / i1 : null, ctr2 = i2 ? k2 / i2 : null
    if (ctr1 == null || ctr2 == null || !ctr1) return null
    return (ctr1 - ctr2) / ctr1 // positive = CTR declined over the period
  }
  const out = []; let high = 0, medium = 0, low = 0
  for (const e of C.values()) {
    if (e.impressions < c.minImpr) continue
    const freq = e.reach ? e.impressions / e.reach : null
    const drop = ctrDropOf(e.name)
    const belowAvg = /BELOW_AVERAGE/i.test(e.quality || '')
    const reasons = []
    let s = 0, declining = false
    // Fatigue = actual wear: rising frequency and/or a falling CTR. These are the
    // only things that can raise a flag.
    if (freq != null) { if (freq >= c.freqHigh) { s += 2; declining = true; reasons.push(`high frequency (${freq.toFixed(1)}x)`) } else if (freq >= c.freqMed) { s += 1; declining = true; reasons.push(`rising frequency (${freq.toFixed(1)}x)`) } }
    if (drop != null) { if (drop >= c.ctrDropHigh) { s += 2; declining = true; reasons.push(`CTR down ${Math.round(drop * 100)}%`) } else if (drop >= c.ctrDropMed) { s += 1; declining = true; reasons.push(`CTR down ${Math.round(drop * 100)}%`) } }
    // Quality ranking is a relevance signal, not fatigue on its own - it can only
    // escalate a creative that's already showing wear, never trigger a flag alone.
    if (belowAvg && declining) { s += 1; reasons.push('below-average quality ranking') }
    const level = !declining ? 'Low' : s >= 3 ? 'High' : 'Medium'
    if (level === 'High') high++; else if (level === 'Medium') medium++; else low++
    out.push({ name: e.name, campaign: e.campaign, adset: e.adset, thumb: e.thumb, format: e.format, spend: Math.round(e.spend), impressions: e.impressions, frequency: freq != null ? Math.round(freq * 10) / 10 : null, ctrDrop: drop != null ? Math.round(drop * 100) : null, quality: e.quality || null, level, score: s, reasons })
  }
  out.sort((a, b) => b.score - a.score || b.spend - a.spend)
  return { creatives: out, summary: { high, medium, low, total: out.length } }
}
// Light fetch for the agency fatigue tab (ads + daily only, no CRM/campaign roll-up).
async function buildFatigue(accountId, from, to, preset, key, cfg) {
  const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, accountId))
  const [adRows, dayRows] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'reach', 'impressions', 'clicks', 'spend', 'actions_video_view'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'date', 'ad_name', 'impressions', 'clicks'], from, to, preset, key).then(filt).catch(() => []),
  ])
  const ads = adRows.map((r) => ({ name: r.ad_name, campaign: r.campaign, adset: r.adset_name, thumb: r.thumbnail_url, type: num(r.actions_video_view) > 0 ? 'Video' : 'Image', quality: r.quality_ranking, reach: num(r.reach), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend) }))
  return metaFatigue(ads, dayRows, cfg)
}
async function readFatigueConfig() {
  try {
    const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const f = s && s.fatigue && s.fatigue._global
    // Settings store CTR drops as whole percents (15, 35); score against fractions.
    if (f && typeof f === 'object') return { ...FATIGUE_DEFAULTS, freqMed: num(f.freqMed) || FATIGUE_DEFAULTS.freqMed, freqHigh: num(f.freqHigh) || FATIGUE_DEFAULTS.freqHigh, ctrDropMed: f.ctrDropMed != null ? num(f.ctrDropMed) / 100 : FATIGUE_DEFAULTS.ctrDropMed, ctrDropHigh: f.ctrDropHigh != null ? num(f.ctrDropHigh) / 100 : FATIGUE_DEFAULTS.ctrDropHigh, minImpr: num(f.minImpr) || FATIGUE_DEFAULTS.minImpr }
  } catch { /* defaults */ }
  return { ...FATIGUE_DEFAULTS }
}

// --- Meta anomaly / delivery-health signal (Meta Insights tab) --------------
// Compares the selected window against the equal prior window at account level
// and flags material moves (CPL, CTR, frequency, spend/leads) plus delivery
// stalls and high-spend zero-lead ads. Pure Windsor data - no Meta App needed.
async function buildAnomalies(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, accountId))
  const pr = prevRange(from, to)
  const accFields = ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, 'actions_video_view']
  const [curRows, prevRows, adRows] = await Promise.all([
    windsorFetch('facebook', accFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', accFields, pr.from, pr.to, null, key).then(filt).catch(() => []) : Promise.resolve([]),
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'reach', 'spend', 'impressions', 'clicks', ...FB_LEAD_FIELDS], from, to, preset, key).then(filt).catch(() => []),
  ])
  const cur = metaTotals(curRows), prev = metaTotals(prevRows)
  const met = (t) => ({ spend: t.spend, leads: t.leads, impressions: t.impressions, clicks: t.clicks, reach: t.reach, cpl: t.leads ? t.spend / t.leads : null, ctr: t.impressions ? t.clicks / t.impressions : null, freq: t.reach ? t.impressions / t.reach : null })
  const c = met(cur), p = met(prev)
  const pct = (a, b) => (b ? (a - b) / b : null) // change of a vs b
  const alerts = []
  const material = c.spend >= 50 // ignore trivially small accounts/windows
  // CPL movement (the headline efficiency metric).
  if (material && c.cpl != null && p.cpl != null && p.leads > 0) {
    const ch = pct(c.cpl, p.cpl)
    if (ch >= 0.5) alerts.push({ metric: 'cpl', severity: 'high', dir: 'up', pct: Math.round(ch * 100), cur: c.cpl, prev: p.cpl, title: 'Cost per lead jumped', detail: `up ${Math.round(ch * 100)}% vs the prior window` })
    else if (ch >= 0.25) alerts.push({ metric: 'cpl', severity: 'med', dir: 'up', pct: Math.round(ch * 100), cur: c.cpl, prev: p.cpl, title: 'Cost per lead rising', detail: `up ${Math.round(ch * 100)}% vs the prior window` })
    else if (ch <= -0.25) alerts.push({ metric: 'cpl', severity: 'good', dir: 'down', pct: Math.round(-ch * 100), cur: c.cpl, prev: p.cpl, title: 'Cost per lead improving', detail: `down ${Math.round(-ch * 100)}% vs the prior window` })
  }
  // CTR decline (creative/audience wear).
  if (material && c.ctr != null && p.ctr != null && p.ctr > 0) {
    const ch = pct(c.ctr, p.ctr)
    if (ch <= -0.35) alerts.push({ metric: 'ctr', severity: 'high', dir: 'down', pct: Math.round(-ch * 100), cur: c.ctr, prev: p.ctr, title: 'Click-through rate dropped', detail: `down ${Math.round(-ch * 100)}% - creative or audience wearing out` })
    else if (ch <= -0.2) alerts.push({ metric: 'ctr', severity: 'med', dir: 'down', pct: Math.round(-ch * 100), cur: c.ctr, prev: p.ctr, title: 'Click-through rate slipping', detail: `down ${Math.round(-ch * 100)}% vs the prior window` })
  }
  // Frequency (audience saturation) - absolute, not relative.
  if (material && c.freq != null) {
    if (c.freq >= 6) alerts.push({ metric: 'freq', severity: 'high', cur: c.freq, prev: p.freq, title: 'High frequency', detail: `each person saw an ad ${c.freq.toFixed(1)}x on average - audience saturating` })
    else if (c.freq >= 4) alerts.push({ metric: 'freq', severity: 'med', cur: c.freq, prev: p.freq, title: 'Frequency climbing', detail: `${c.freq.toFixed(1)}x average frequency - widen the audience or refresh creative` })
  }
  // Delivery stall - spend collapsed vs a materially-spending prior window.
  if (p.spend >= 100 && c.spend < p.spend * 0.4) {
    alerts.push({ metric: 'spend', severity: 'high', dir: 'down', pct: Math.round((1 - (p.spend ? c.spend / p.spend : 0)) * 100), cur: c.spend, prev: p.spend, title: 'Spend stalled', detail: `only ${p.spend ? Math.round((c.spend / p.spend) * 100) : 0}% of the prior window's spend delivered - check budgets and delivery` })
  }
  // Spend up but leads not keeping pace.
  if (material && p.spend > 0) {
    const sCh = pct(c.spend, p.spend), lCh = p.leads ? pct(c.leads, p.leads) : null
    if (sCh >= 0.6 && (lCh == null || lCh < sCh * 0.5)) alerts.push({ metric: 'spendleads', severity: 'med', dir: 'up', pct: Math.round(sCh * 100), cur: c.spend, prev: p.spend, title: 'Spend up, leads flat', detail: `spend up ${Math.round(sCh * 100)}% but leads ${lCh == null ? 'not tracking' : (lCh < 0 ? `down ${Math.round(-lCh * 100)}%` : `only up ${Math.round(lCh * 100)}%`)}` })
  }
  // Zero-lead spend - the account is spending but reporting no leads at all.
  if (c.spend >= 100 && c.leads === 0) alerts.push({ metric: 'noleads', severity: 'high', cur: c.spend, prev: null, title: 'Spending with no leads', detail: `${Math.round(c.spend)} spent this window with zero reported leads - check tracking and delivery` })
  // Worst-offender ads: highest spend with zero leads (aggregated by ad name).
  const adAgg = new Map()
  for (const r of adRows) { const n = r.ad_name; if (!n) continue; const e = adAgg.get(n) || { name: n, campaign: r.campaign, adset: r.adset_name, thumb: r.thumbnail_url, spend: 0, leads: 0, clicks: 0 }; e.spend += num(r.spend); e.leads += fbLeads(r); e.clicks += num(r.clicks); if (!e.thumb && r.thumbnail_url) e.thumb = r.thumbnail_url; adAgg.set(n, e) }
  const zeroLeadAds = [...adAgg.values()].filter((a) => a.spend >= 50 && a.leads === 0).sort((a, b) => b.spend - a.spend).slice(0, 6).map((a) => ({ ...a, spend: Math.round(a.spend) }))
  const order = { high: 0, med: 1, good: 2 }
  alerts.sort((a, b) => (order[a.severity] - order[b.severity]))
  const sev = { high: alerts.filter((a) => a.severity === 'high').length, med: alerts.filter((a) => a.severity === 'med').length, good: alerts.filter((a) => a.severity === 'good').length }
  return { metrics: { cur: c, prev: p }, alerts, zeroLeadAds, summary: sev, period: { from, to }, prevPeriod: pr }
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
function daysInRange(from, to, preset) {
  if (from && to) { const d = Math.round((new Date(to) - new Date(from)) / 86400000) + 1; return d > 0 ? d : 30 }
  const m = { today: 1, last_7d: 7, last_14d: 14, last_30d: 30, this_month: 30, last_month: 30 }
  return m[preset] || 30
}
function aggBy(rowsIn, keyFn) {
  const m = new Map()
  for (const r of rowsIn) {
    const k = keyFn(r); if (!k) continue
    const e = m.get(k) || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions)
    m.set(k, e)
  }
  return m
}
// cg = campaign/adgroup rows, kw = keyword rows, st = search-term rows, dy = daily rows.
function rollupGoogle(cg, kw, st, dy, days) {
  const cleanAg = (r) => r.ad_group_name || (r.ad_group ? String(r.ad_group).split('/').pop() : null)
  const campaigns = [...aggBy(cg, (r) => r.campaign).entries()].map(([name, v]) => ({ name, status: 'Enabled', ...v })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost)
  // Ad groups keyed by (campaign, ad group) so each row belongs to exactly one
  // campaign - this is what makes campaign→ad-group drill-down filter correctly.
  const agM = new Map()
  for (const r of cg) { const ag = cleanAg(r), camp = r.campaign; if (!ag || !camp) continue; const k = camp + '|' + ag; const e = agM.get(k) || { name: ag, campaign: camp, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); agM.set(k, e) }
  const adGroups = [...agM.values()].filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost)
  // Keywords keyed by (campaign, ad group, keyword) - a keyword that runs in two
  // campaigns is two rows, each scoped, so drill-down never loses/merges them.
  const kwM = new Map()
  for (const r of kw) { const t = r.keyword_text; if (!t) continue; const camp = r.campaign || null, ag = cleanAg(r) || null; const k = camp + '|' + ag + '|' + t; const e = kwM.get(k) || { text: t, campaign: camp, adGroup: ag, match: titleCase(r.match_type) || '-', qsSum: 0, qsN: 0, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); if (num(r.quality_score)) { e.qsSum += num(r.quality_score); e.qsN++ } kwM.set(k, e) }
  const keywords = [...kwM.values()].map((e) => ({ text: e.text, campaign: e.campaign, adGroup: e.adGroup, match: e.match, qs: e.qsN ? Math.max(1, Math.min(10, Math.round(e.qsSum / e.qsN))) : '', cost: e.cost, impressions: e.impressions, clicks: e.clicks, conversions: e.conversions })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 400)
  const mt = new Map()
  for (const r of kw) { const t = titleCase(r.match_type); if (!t) continue; const e = mt.get(t) || { type: t, cost: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.clicks += num(r.clicks); e.conversions += num(r.conversions); mt.set(t, e) }
  // Search terms keyed by (campaign, ad group, keyword, term) - carries its
  // matched keyword so keyword↔search-term cross-filtering works both ways.
  const stM = new Map()
  for (const r of st) { const term = r.search_term; if (!term) continue; const camp = r.campaign || null, ag = cleanAg(r) || null; const k = camp + '|' + ag + '|' + term; const e = stM.get(k) || { term, campaign: camp, adGroup: ag, keyword: null, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); stM.set(k, e) }
  const searchTerms = [...stM.values()].filter((x) => x.cost > 0 || x.clicks > 0).sort((a, b) => b.cost - a.cost).slice(0, 400)
  const dmap = new Map()
  for (const r of dy) { const d = String(r.date || '').slice(0, 10); if (!d) continue; const e = dmap.get(d) || { date: d, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); dmap.set(d, e) }
  const daily = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totals = campaigns.reduce((a, c) => ({ cost: a.cost + c.cost, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 })
  const keywordsTotal = new Set(kw.map((r) => r.keyword_text).filter(Boolean)).size
  const searchTermsTotal = new Set(st.map((r) => r.search_term).filter(Boolean)).size
  return { campaigns, adGroups, keywords, matchTypes: [...mt.values()].sort((a, b) => b.cost - a.cost), searchTerms, daily, totals, keywordsTotal, searchTermsTotal }
}
// Agency roll-up: pull all Meta + Google accounts in two calls, map each back
// to its client, and return per-client paid metrics for the whole roster.
// Cumulative "reached this stage or beyond" for one channel rollup (from
// buildAttribution's channels[ch].pipelines), summed across pipelines.
function reachedInChannel(chanObj, stageName) {
  if (!chanObj || !chanObj.pipelines) return 0
  let total = 0
  for (const p of chanObj.pipelines) {
    const sts = (p.stages || []).slice().sort((a, b) => a.pos - b.pos)
    const i = sts.findIndex((s) => s.name === stageName); if (i < 0) continue
    for (let j = i; j < sts.length; j++) total += sts[j].count || 0
  }
  return total
}
async function buildOverview(from, to, preset, key, wonBasis = 'created') {
  const metaRev = {}, googleRev = {}, ghlRev = {}
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaRev[acctKey(c.meta)] = id; if (c.google) googleRev[acctKey(c.google)] = id; if (c.ghl) ghlRev[norm(c.ghl)] = id }
  // last-8-day daily spend (yesterday + prior week) for zero-spend alerts
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const yest = new Date(today); yest.setUTCDate(yest.getUTCDate() - 1)
  const base0 = new Date(today); base0.setUTCDate(base0.getUTCDate() - 8)
  // Previous equal-length period for the agency comparison table (fast Windsor
  // ad metrics only; the GHL columns fetch their own prev per client lazily).
  const pr = prevRange(from, to)
  // Per-client won revenue + won count - straight from the GoHighLevel API, fanned
  // out across accounts with a small concurrency pool and a hard time budget so a
  // large agency can't push the function past its ~10s limit. Any account that is
  // slow or whose marketplace app isn't installed is simply skipped (partial CRM),
  // exactly the graceful degradation the old Windsor best-effort call gave. Runs in
  // parallel with the Windsor ad calls, so it adds little wall-clock. The Windsor
  // GHL call remains only as a fallback for the (frontend-never) preset-only path.
  const ghlWonByClient = async () => {
    const out = {}
    // Only attach CRM to a client that actually had opportunities in the window
    // (matches the previous behaviour: no rows → no crm key, rather than $0/0).
    const tally = (id, rows) => { if (!rows.length) return; let revenue = 0, won = 0; for (const r of rows) if (String(r.opportunity_status || '').toLowerCase() === 'won') { revenue += num(r.opportunity_monetary_value); won++ } out[id] = { revenue, won } }
    if (!(from && to)) {
      const rows = await windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_monetary_value'], from, to, preset, key).catch(() => [])
      const by = {}; for (const r of rows) { const id = ghlRev[norm(r.account_id)]; if (!id) continue; (by[id] = by[id] || []).push(r) }
      for (const id in by) tally(id, by[id])
      return out
    }
    const list = Object.entries(CLIENTS).filter(([, c]) => c.ghl)
    const deadline = Date.now() + 7000
    let i = 0
    const one = async (id, c) => {
      if (wonBasis === 'closed') { const w = await wonInPeriod(c.ghl, from, to); if (w && w.total) out[id] = { revenue: w.total.revenue, won: w.total.won } }
      else tally(id, await ghlOpportunityRows(c.ghl, from, to))
    }
    const worker = async () => { while (i < list.length && Date.now() < deadline) { const [id, c] = list[i++]; try { await one(id, c) } catch { /* app not installed / slow → skip */ } } }
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker))
    return out
  }
  const [[fb, gg, fbD, ggD, pFb, pGg], crmByClient] = await Promise.all([
    Promise.all([
      windsorFetch('facebook', ['account_id', 'spend', 'impressions', 'clicks', ...FB_LEAD_FIELDS], from, to, preset, key),
      windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key),
      windsorFetch('facebook', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
      windsorFetch('google_ads', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
      pr.from ? windsorFetch('facebook', ['account_id', 'spend', ...FB_LEAD_FIELDS], pr.from, pr.to, null, key).catch(() => []) : Promise.resolve([]),
      pr.from ? windsorFetch('google_ads', ['account_id', 'spend', 'conversions'], pr.from, pr.to, null, key).catch(() => []) : Promise.resolve([]),
    ]),
    ghlWonByClient(),
  ])
  const clients = {}
  const ensure = (id) => (clients[id] = clients[id] || {})
  for (const r of fb) {
    const id = metaRev[acctKey(r.account_id)]; if (!id) continue
    const e = ensure(id); e.meta = e.meta || { spend: 0, impressions: 0, clicks: 0, leads: 0 }
    e.meta.spend += num(r.spend); e.meta.impressions += num(r.impressions); e.meta.clicks += num(r.clicks); e.meta.leads += fbLeads(r)
  }
  for (const r of gg) {
    const id = googleRev[acctKey(r.account_id)]; if (!id) continue
    const e = ensure(id); e.google = e.google || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.google.cost += num(r.spend); e.google.impressions += num(r.impressions); e.google.clicks += num(r.clicks); e.google.conversions += num(r.conversions)
  }
  for (const r of pFb) {
    const id = metaRev[acctKey(r.account_id)]; if (!id) continue
    const e = ensure(id); e.metaPrev = e.metaPrev || { spend: 0, leads: 0 }
    e.metaPrev.spend += num(r.spend); e.metaPrev.leads += fbLeads(r)
  }
  for (const r of pGg) {
    const id = googleRev[acctKey(r.account_id)]; if (!id) continue
    const e = ensure(id); e.googlePrev = e.googlePrev || { cost: 0, conversions: 0 }
    e.googlePrev.cost += num(r.spend); e.googlePrev.conversions += num(r.conversions)
  }
  for (const [id, cr] of Object.entries(crmByClient)) { const e = ensure(id); e.crm = { revenue: cr.revenue, won: cr.won } }
  // Zero-spend alerts: an account that spent over the prior week but $0 yesterday
  // has likely paused (failed payment / budget exhausted / manual pause).
  const yStr = dstr(yest)
  const daySplit = (rows, revMap) => {
    const per = {}
    for (const r of rows) { const id = revMap[acctKey(r.account_id)]; if (!id) continue; const d = String(r.date || '').slice(0, 10); const e = per[id] = per[id] || { yest: 0, base: 0 }; if (d === yStr) e.yest += num(r.spend); else e.base += num(r.spend) }
    return per
  }
  const perMeta = daySplit(fbD, metaRev), perGoogle = daySplit(ggD, googleRev)
  const flag = (per, hasKey) => {
    const out = []
    for (const [id, c] of Object.entries(CLIENTS)) { if (!c[hasKey]) continue; const e = per[id] || { yest: 0, base: 0 }; if (e.base > 1 && e.yest < 0.01) out.push({ id, avgDaily: Math.round(e.base / 7) }) }
    return out.sort((a, b) => b.avgDaily - a.avgDaily)
  }
  const alerts = { checkedDate: yStr, meta: flag(perMeta, 'meta'), google: flag(perGoogle, 'google') }
  return { clients, alerts }
}

// Rolling-window trends: for each client, blended/Meta/Google spend + results +
// booked calls over the last 3/7/14/21/28 days, each vs the equal prior window.
async function buildTrends(key) {
  const metaId = {}, googleId = {}, ghlId = {}
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaId[acctKey(c.meta)] = id; if (c.google) googleId[acctKey(c.google)] = id; if (c.ghl) ghlId[norm(c.ghl)] = id }
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - 55)
  // Saved campaign→pipeline links, so per-pipeline spend can be split by the actual
  // Settings mapping (Phase 2) rather than a blunt lead-share allocation.
  const savedCampmap = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }).then((s) => (s && s.campmap) || {}).catch(() => ({}))
  // Each client's configured primary Meta conversion, so the daily "results" match its
  // optimised event (custom conversions included) instead of standard leads only.
  const metaPrimaryByClient = await readAllMetaPrimary()
  const baseFbFields = ['account_id', 'campaign', 'date', 'spend', ...FB_LEAD_FIELDS]
  const primaryFields = [...new Set(Object.values(metaPrimaryByClient).flat())].filter((f) => f && !baseFbFields.includes(f))
  const metaResultOf = (id, r) => { const pf = metaPrimaryByClient[id]; return (pf && pf.length) ? pf.reduce((s, f) => s + num(r[f]), 0) : fbLeads(r) }
  // Track whether the Meta / Google pulls actually SUCCEEDED (vs. legitimately
  // returned no rows). This 56-day, all-accounts Meta query sits near the function
  // timeout, so when it times out we must NOT let the blank result get cached and
  // shown as "0 Meta results" - the caller uses these flags to skip caching and
  // auto-retry instead of the user hammering Refresh.
  let metaOk = true, googleOk = true
  const [fb, gg, opps, pipes] = await Promise.all([
    // If an added custom field is unexpectedly rejected, fall back to the standard
    // fields so a single client can't blank out everyone's Meta trends. Only a
    // failure of BOTH shapes counts as a Meta failure (a real timeout).
    windsorFetch('facebook', [...baseFbFields, ...primaryFields], dstr(start), dstr(today), null, key)
      .catch(() => windsorFetch('facebook', baseFbFields, dstr(start), dstr(today), null, key))
      .catch(() => { metaOk = false; return [] }),
    windsorFetch('google_ads', ['account_id', 'campaign', 'date', 'spend', 'conversions'], dstr(start), dstr(today), null, key).catch(() => { googleOk = false; return [] }),
    windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_created_at', 'opportunity_source'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], dstr(start), dstr(today), null, key).catch(() => []),
  ])
  const days = []; for (let i = 0; i < 56; i++) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); days.push(dstr(d)) }
  const dayIndex = new Map(days.map((d, i) => [d, i])) // 0 = today, larger = older
  const mk = () => new Float64Array(56)
  const cl = {}
  // Per-client: account daily arrays + per-pipeline daily (leads/booked/won) + raw
  // per-campaign daily spend (resolved to pipelines at the end).
  // Classify a GHL opportunity_source (lead source) into a paid channel, so the
  // key-events breakdown can be split Meta / Google / Non-paid. Anything that doesn't
  // fingerprint as a paid platform is "other" (non-paid: organic / referral / direct).
  const SRC_META = /(facebook|instagram|\bfb\b|\bmeta\b|\big\b|fbclid|fb_|ig_|paid.?social)/i
  const SRC_GOOGLE = /(google|adwords|youtube|\bgdn\b|gclid|goog|paid.?search|\bcpc\b|\bppc\b|\bsem\b|search.?engine)/i
  const classifySrc = (s) => { const h = String(s || '').toLowerCase(); if (SRC_META.test(h)) return 'meta'; if (SRC_GOOGLE.test(h)) return 'google'; return 'other' }
  const CH = ['meta', 'google', 'other']
  const ensure = (id) => (cl[id] = cl[id] || { metaSpend: mk(), metaLeads: mk(), gSpend: mk(), gConv: mk(), wBooked: mk(), wonAll: mk(), leadsAll: mk(), leadsCh: { meta: mk(), google: mk(), other: mk() }, wonCh: { meta: mk(), google: mk(), other: mk() }, bAll: mk(), bMeta: mk(), bGoogle: mk(), ghlBooked: false, pipe: new Map(), campMeta: new Map(), campMetaLeads: new Map(), campGoogle: new Map(), campGoogleConv: new Map(), reach: new Map(), reachCh: { meta: new Map(), google: new Map(), other: new Map() } })
  const ensureReachIn = (m, key) => { let a = m.get(key); if (!a) { a = mk(); m.set(key, a) } return a }
  const ensureReach = (e, key) => ensureReachIn(e.reach, key)
  const ensurePipe = (e, pid, name) => { let p = e.pipe.get(pid); if (!p) { p = { id: pid, name: name || 'Pipeline', leads: mk(), booked: mk(), won: mk(), leadsCh: { meta: mk(), google: mk(), other: mk() }, wonCh: { meta: mk(), google: mk(), other: mk() } }; e.pipe.set(pid, p) } else if (name && (!p.name || p.name === 'Pipeline')) p.name = name; return p }
  const ensureCamp = (m, name) => { let a = m.get(name); if (!a) { a = mk(); m.set(name, a) } return a }
  for (const r of fb) { const id = metaId[acctKey(r.account_id)]; if (!id) continue; const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue; const e = ensure(id); const sp = num(r.spend); const ld = metaResultOf(id, r); e.metaSpend[di] += sp; e.metaLeads[di] += ld; if (r.campaign) { ensureCamp(e.campMeta, r.campaign)[di] += sp; ensureCamp(e.campMetaLeads, r.campaign)[di] += ld } }
  // Custom-conversion primaries aren't insights columns, so the metaResultOf sum
  // above misses them. Windsor DOES serve custom conversions by day + campaign via
  // its Custom Conversions table, so for each client whose primary includes a
  // custom conversion, fetch the EXACT per-day-per-campaign counts and add them to
  // the daily Meta results (and the per-campaign daily). Match only the action-name
  // each primary maps to (the friendly name OR the offsite_conversion_custom_<id>
  // alias - never both) so a conversion is never double-counted. Add-only,
  // per-client try/catch, parallel; only runs for custom-primary clients.
  const ccTrendClients = Object.entries(metaPrimaryByClient).filter(([, fs]) => fs.some(isCustomConvField))
  if (ccTrendClients.length) {
    await Promise.all(ccTrendClients.map(async ([id, fs]) => {
      const cfg = CLIENTS[id]; const e = cl[id]; if (!cfg || !cfg.meta || !e) return
      const tset = new Set(fs.filter(isCustomConvField).map(ccActionName).filter(Boolean).map((t) => t.toLowerCase()))
      if (!tset.size) return
      let rows
      try { rows = await windsorFetch('facebook', ['account_id', 'date', 'campaign', 'custom_conversion_action_name', 'custom_conversion_action_count'], dstr(start), dstr(today), null, key) } catch { return }
      for (const r of rows) {
        if (r.account_id && !acctEq(r.account_id, cfg.meta)) continue
        if (!tset.has(String(r.custom_conversion_action_name || '').trim().toLowerCase())) continue
        const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue
        const c = num(r.custom_conversion_action_count)
        e.metaLeads[di] += c
        if (r.campaign) { const cml = e.campMetaLeads.get(r.campaign); if (cml) cml[di] += c }
      }
    }))
  }
  for (const r of gg) { const id = googleId[acctKey(r.account_id)]; if (!id) continue; const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue; const e = ensure(id); const sp = num(r.spend); const cv = num(r.conversions); e.gSpend[di] += sp; e.gConv[di] += cv; if (r.campaign) { ensureCamp(e.campGoogle, r.campaign)[di] += sp; ensureCamp(e.campGoogleConv, r.campaign)[di] += cv } }
  // Windsor blended booked (fallback when the GHL app isn't connected / a client's fetch fails)
  const idxByAcct = {}; const pipeNameByAcct = {}
  { const byAcct = {}; for (const p of pipes) { const id = ghlId[norm(p.account_id)]; if (!id) continue; (byAcct[id] = byAcct[id] || []).push(p); (pipeNameByAcct[id] = pipeNameByAcct[id] || {})[p.pipeline_id] = p.pipeline_name || 'Pipeline' } for (const [id, arr] of Object.entries(byAcct)) idxByAcct[id] = stageIndex(arr) }
  for (const r of opps) {
    const id = ghlId[norm(r.account_id)]; if (!id) continue
    const di = dayIndex.get(String(r.opportunity_created_at || '').slice(0, 10)); if (di == null) continue
    const e = ensure(id); const idx = idxByAcct[id]; const pi = idx && idx.get(r.opportunity_pipeline_id)
    const st = String(r.opportunity_status || '').toLowerCase(); const stg = pi ? pi.byId[r.opportunity_pipeline_stage_id] : null; const pos = stg ? stg.pos : -1
    const isWon = st === 'won'; const isBooked = isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)
    const chan = classifySrc(r.opportunity_source)
    if (isBooked) e.wBooked[di]++
    if (isWon) { e.wonAll[di]++; e.wonCh[chan][di]++ }
    e.leadsAll[di]++; e.leadsCh[chan][di]++
    // Per-pipeline daily CRM (created-on): every opp is a lead for its pipeline.
    const pid = r.opportunity_pipeline_id || 'none'
    const pp = ensurePipe(e, pid, (pipeNameByAcct[id] || {})[pid]); pp.leads[di]++; pp.leadsCh[chan][di]++; if (isBooked) pp.booked[di]++; if (isWon) { pp.won[di]++; pp.wonCh[chan][di]++ }
    // Cumulative stage reach (for the per-window key-events breakdown): an opp at
    // position P reached every stage with pos ≤ P; a won opp reached them all. Keyed
    // by bare name (aggregated across pipelines) AND pipeline-scoped name, mirroring
    // the frontend reachedByStage so keyEventRows can resolve either. Tracked for the
    // total AND per lead-source channel so the breakdown can filter Meta / Google /
    // Non-paid.
    if (pi && pi.byId) for (const sid in pi.byId) { const s = pi.byId[sid]; if (isWon || (pos >= 0 && s.pos <= pos)) { ensureReach(e, s.name)[di]++; ensureReach(e, pid + '::' + s.name)[di]++; const cm = e.reachCh[chan]; ensureReachIn(cm, s.name)[di]++; ensureReachIn(cm, pid + '::' + s.name)[di]++ } }
  }
  // GHL direct API: booked calls per channel + the accurate UTM-based per-channel key
  // event split (dc). Replaces the crude Windsor opportunity_source classification when
  // the app is connected; opportunity_source stays as the fallback for the rest.
  const ghlOK = await isConnected().catch(() => false)
  if (ghlOK) {
    const ghlClients = Object.entries(CLIENTS).filter(([, c]) => c.ghl)
    await Promise.all(ghlClients.map(async ([id, c]) => {
      try {
        const rows = await crmTrends(c.ghl, dstr(start), dstr(today))
        const e = ensure(id); e.ghlBooked = true
        const dc = { ok: true, leads: { all: mk(), meta: mk(), google: mk(), other: mk() }, won: { all: mk(), meta: mk(), google: mk(), other: mk() }, reach: { all: new Map(), meta: new Map(), google: new Map(), other: new Map() }, pipe: new Map() }
        const dEnsurePipe = (pid) => { let p = dc.pipe.get(pid); if (!p) { p = { leads: { all: mk(), meta: mk(), google: mk(), other: mk() }, won: { all: mk(), meta: mk(), google: mk(), other: mk() } }; dc.pipe.set(pid, p) } return p }
        for (const r of rows) {
          const di = dayIndex.get(r.date); if (di == null) continue
          const ch = r.channel === 'meta' ? 'meta' : r.channel === 'google' ? 'google' : 'other'
          // Booked-calls split (was bookedTrends).
          if (r.booked) { e.bAll[di]++; if (ch === 'meta') e.bMeta[di]++; else if (ch === 'google') e.bGoogle[di]++ }
          dc.leads.all[di]++; dc.leads[ch][di]++
          if (r.won) { dc.won.all[di]++; dc.won[ch][di]++ }
          const pp = dEnsurePipe(r.pipelineId); pp.leads.all[di]++; pp.leads[ch][di]++; if (r.won) { pp.won.all[di]++; pp.won[ch][di]++ }
          for (const nm of r.reached) {
            ensureReachIn(dc.reach.all, nm)[di]++; ensureReachIn(dc.reach.all, r.pipelineId + '::' + nm)[di]++
            ensureReachIn(dc.reach[ch], nm)[di]++; ensureReachIn(dc.reach[ch], r.pipelineId + '::' + nm)[di]++
          }
        }
        e.dc = dc
      } catch { /* keep Windsor opportunity_source fallback */ }
    }))
  }
  const WINDOWS = [3, 7, 14, 21, 28]
  const sumR = (arr, a, b) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s }
  const out = {}
  for (const [id, c] of Object.entries(CLIENTS)) {
    if (!c.meta && !c.google && !c.ghl) continue
    const E = ensure(id)
    const blendedBooked = E.ghlBooked ? E.bAll : E.wBooked
    // Per-window stage reach (for the key-events breakdown popup), from a given reach
    // Map. filterPid limits to one pipeline's scoped keys; null returns every key.
    const reachWinFrom = (m, n, filterPid) => { const o = {}; for (const [k, arr] of m) { if (filterPid && !k.startsWith(filterPid + '::')) continue; const v = Math.round(sumR(arr, 0, n)); if (v) o[k] = v } return o }
    // CRM breakdown for one window, split by lead-source channel (all / meta / google /
    // other=non-paid) for the key-events popup. L / W are {all, meta, google, other}
    // daily-array bundles for leads / won; RM is the matching {all, meta, google, other}
    // reach Maps. When the GHL app is connected we use the accurate UTM-based split
    // (E.dc); otherwise the Windsor opportunity_source classification.
    const crmWin = (n, L, W, RM, filterPid) => ({
      leads: { all: Math.round(sumR(L.all, 0, n)), meta: Math.round(sumR(L.meta, 0, n)), google: Math.round(sumR(L.google, 0, n)), other: Math.round(sumR(L.other, 0, n)) },
      won: { all: Math.round(sumR(W.all, 0, n)), meta: Math.round(sumR(W.meta, 0, n)), google: Math.round(sumR(W.google, 0, n)), other: Math.round(sumR(W.other, 0, n)) },
      reach: { all: reachWinFrom(RM.all, n, filterPid), meta: reachWinFrom(RM.meta, n, filterPid), google: reachWinFrom(RM.google, n, filterPid), other: reachWinFrom(RM.other, n, filterPid) },
      utm: !!(E.dc && E.dc.ok),
    })
    const dcOK = !!(E.dc && E.dc.ok)
    const wsReach = { all: E.reach, meta: E.reachCh.meta, google: E.reachCh.google, other: E.reachCh.other }
    const acctReach = dcOK ? E.dc.reach : wsReach
    const acctL = dcOK ? E.dc.leads : { all: E.leadsAll, meta: E.leadsCh.meta, google: E.leadsCh.google, other: E.leadsCh.other }
    const acctW = dcOK ? E.dc.won : { all: E.wonAll, meta: E.wonCh.meta, google: E.wonCh.google, other: E.wonCh.other }
    const ZBUN = { all: mk(), meta: mk(), google: mk(), other: mk() }
    // Per-pipeline CRM source bundle (direct API when connected, else Windsor).
    const pipeCrmSrc = (p) => (dcOK
      ? { L: (E.dc.pipe.get(p.id) || { leads: ZBUN }).leads, W: (E.dc.pipe.get(p.id) || { won: ZBUN }).won, RM: E.dc.reach }
      : { L: { all: p.leads, meta: p.leadsCh.meta, google: p.leadsCh.google, other: p.leadsCh.other }, W: { all: p.won, meta: p.wonCh.meta, google: p.wonCh.google, other: p.wonCh.other }, RM: wsReach })
    // stage name → funnel position (bare + pipeline-scoped) so the frontend can order
    // and resolve the configured key events, same as everywhere else.
    const stagePos = {}
    const info0 = idxByAcct[id]
    if (info0) for (const [pid, pinfo] of info0) for (const sid in pinfo.byId) { const s = pinfo.byId[sid]; if (stagePos[s.name] == null || s.pos < stagePos[s.name]) stagePos[s.name] = s.pos; stagePos[pid + '::' + s.name] = s.pos }
    const windows = WINDOWS.map((n) => {
      const ms = sumR(E.metaSpend, 0, n), msp = sumR(E.metaSpend, n, 2 * n)
      const ml = sumR(E.metaLeads, 0, n), mlp = sumR(E.metaLeads, n, 2 * n)
      const gs = sumR(E.gSpend, 0, n), gsp = sumR(E.gSpend, n, 2 * n)
      const gc = sumR(E.gConv, 0, n), gcp = sumR(E.gConv, n, 2 * n)
      return {
        n,
        meta: { spend: ms, spendPrev: msp, results: ml, resultsPrev: mlp, booked: sumR(E.bMeta, 0, n), bookedPrev: sumR(E.bMeta, n, 2 * n) },
        google: { spend: gs, spendPrev: gsp, results: gc, resultsPrev: gcp, booked: sumR(E.bGoogle, 0, n), bookedPrev: sumR(E.bGoogle, n, 2 * n) },
        blended: { spend: ms + gs, spendPrev: msp + gsp, results: ml + gc, resultsPrev: mlp + gcp, booked: sumR(blendedBooked, 0, n), bookedPrev: sumR(blendedBooked, n, 2 * n) },
        crm: crmWin(n, acctL, acctW, acctReach, null),
      }
    })
    // Last 28 days, chronological (oldest first), per channel: ad spend + ad-reported
    // results (Meta leads / Google conversions) + booked calls + deals won - for the
    // daily graph and its key-event overlay (Phase 3: booked / won markers by day).
    const daily = []
    for (let i = 27; i >= 0; i--) daily.push({ date: days[i], metaSpend: Math.round(E.metaSpend[i] * 100) / 100, metaLeads: Math.round(E.metaLeads[i]), gSpend: Math.round(E.gSpend[i] * 100) / 100, gConv: Math.round(E.gConv[i]), booked: Math.round(blendedBooked[i]), won: Math.round(E.wonAll[i]) })

    // ---- Per-pipeline split (Phase 2) ----
    // Each pipeline is emitted as a FULL, self-contained tile (same shape as the
    // client tile): channel-split spend + ad-reported results (Meta leads / Google
    // conversions) allocated by the saved campaign→pipeline map (explicit link, else
    // name auto-match), plus that pipeline's own CRM booked / won. Campaigns that
    // resolve to nothing become an "Unlinked campaigns" tile so every dollar of spend
    // stays visible. The UI shows the client as one tile per pipeline when >1.
    // Only split a client into per-pipeline tiles when it genuinely runs more than one
    // pipeline. Single-pipeline clients keep the one combined tile (splitting there
    // adds nothing and would wrongly carve off an "Unlinked" tile).
    const realPipes = [...E.pipe.values()].filter((p) => p.id !== 'none' && sumR(p.leads, 0, 56) > 0)
    const pipeList = realPipes
    let pipelinesOut = null
    if (pipeList.length > 1) {
      // Campaign→pipeline links are stored per client: campmap[clientId][campaignName].
      const clientCampmap = (savedCampmap && savedCampmap[id]) || {}
      // Lead totals per pipeline (28d) drive the auto-matcher's tie-breaks.
      const pArr = pipeList.map((p) => ({ id: p.id, name: p.name, crm: { leads: sumR(p.leads, 0, 28) } }))
      const validPid = new Set(pArr.map((p) => p.id))
      const allCampNames = [...new Set([...E.campMeta.keys(), ...E.campGoogle.keys()])].map((name) => ({ name }))
      const auto = autoMatch(pArr, allCampNames)
      const resolvePid = (name) => {
        const saved = clientCampmap[name]
        if (saved && saved !== 'all' && validPid.has(saved)) return saved
        const a = auto.get(name)
        return (a && a !== 'all' && validPid.has(a)) ? a : null
      }
      // Route a per-campaign daily map into per-pipeline arrays (+ an unlinked bucket).
      const newTargets = () => { const m = new Map(); for (const p of pipeList) m.set(p.id, mk()); return m }
      const pMS = newTargets(), pML = newTargets(), pGS = newTargets(), pGC = newTargets()
      const uMS = mk(), uML = mk(), uGS = mk(), uGC = mk()
      const route = (src, tMap, uArr) => { for (const [name, arr] of src) { const pid = resolvePid(name); const t = pid ? tMap.get(pid) : uArr; for (let i = 0; i < 56; i++) t[i] += arr[i] } }
      route(E.campMeta, pMS, uMS); route(E.campMetaLeads, pML, uML)
      route(E.campGoogle, pGS, uGS); route(E.campGoogleConv, pGC, uGC)
      // Full tr-shaped windows: meta / google / blended, with booked from the
      // pipeline's own CRM (blended across channels - used only for the booking-rate
      // sub-stat, matching how the client tile reads booked ÷ results).
      const r2 = (v) => Math.round(v * 100) / 100
      const tileWindows = (mS, mL, gS, gC, booked, pipeObj) => {
        const src = pipeObj ? pipeCrmSrc(pipeObj) : null
        return WINDOWS.map((n) => {
          const ms = sumR(mS, 0, n), msp = sumR(mS, n, 2 * n), ml = sumR(mL, 0, n), mlp = sumR(mL, n, 2 * n)
          const gs = sumR(gS, 0, n), gsp = sumR(gS, n, 2 * n), gc = sumR(gC, 0, n), gcp = sumR(gC, n, 2 * n)
          const bk = sumR(booked, 0, n), bkp = sumR(booked, n, 2 * n)
          return {
            n,
            meta: { spend: r2(ms), spendPrev: r2(msp), results: ml, resultsPrev: mlp, booked: bk, bookedPrev: bkp },
            google: { spend: r2(gs), spendPrev: r2(gsp), results: gc, resultsPrev: gcp, booked: bk, bookedPrev: bkp },
            blended: { spend: r2(ms + gs), spendPrev: r2(msp + gsp), results: ml + gc, resultsPrev: mlp + gcp, booked: bk, bookedPrev: bkp },
            crm: src ? crmWin(n, src.L, src.W, src.RM, pipeObj.id) : null,
          }
        })
      }
      const tileDaily = (mS, mL, gS, gC, booked, won) => { const d = []; for (let i = 27; i >= 0; i--) d.push({ date: days[i], metaSpend: r2(mS[i]), metaLeads: Math.round(mL[i]), gSpend: r2(gS[i]), gConv: Math.round(gC[i]), booked: Math.round(booked[i]), won: Math.round(won[i]) }); return d }
      const realTiles = pipeList
        .map((p) => {
          const mS = pMS.get(p.id), mL = pML.get(p.id), gS = pGS.get(p.id), gC = pGC.get(p.id)
          return {
            id: p.id, name: p.name, hasCrm: true,
            hasMeta: sumR(mS, 0, 56) > 0.5, hasGoogle: sumR(gS, 0, 56) > 0.5,
            leads28: sumR(p.leads, 0, 28), spend28: sumR(mS, 0, 28) + sumR(gS, 0, 28),
            windows: tileWindows(mS, mL, gS, gC, p.booked, p), daily: tileDaily(mS, mL, gS, gC, p.booked, p.won),
          }
        })
        .filter((po) => po.leads28 > 0 || po.spend28 > 0.5)
        .sort((a, b) => (b.leads28 - a.leads28) || (b.spend28 - a.spend28))
      // Still worth splitting only if ≥2 pipelines actually have activity.
      if (realTiles.length > 1) {
        pipelinesOut = realTiles
        // Unlinked campaigns (spend with no resolvable pipeline) → its own tile so
        // totals still reconcile; no CRM, so booked-rate is hidden. Only worth showing
        // when it's a material slice of spend (>5% of the 28-day total).
        const unSpend28 = sumR(uMS, 0, 28) + sumR(uGS, 0, 28)
        const linkedSpend28 = realTiles.reduce((s, t) => s + t.spend28, 0)
        if (unSpend28 > 1 && unSpend28 > linkedSpend28 * 0.05) {
          pipelinesOut.push({
            id: '_unlinked', name: 'Unlinked campaigns', hasCrm: false, unlinked: true,
            hasMeta: sumR(uMS, 0, 56) > 0.5, hasGoogle: sumR(uGS, 0, 56) > 0.5,
            leads28: 0, spend28: unSpend28,
            windows: tileWindows(uMS, uML, uGS, uGC, mk()), daily: tileDaily(uMS, uML, uGS, uGC, mk(), mk()),
          })
        }
      }
    }
    out[id] = { hasMeta: !!c.meta, hasGoogle: !!c.google, hasCrm: !!c.ghl, utmBooked: E.ghlBooked, windows, daily, pipelines: pipelinesOut, stagePos }
  }
  return { clients: out, metaOk, googleOk }
}

// ISO week number for a YYYY-MM-DD date.
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const fd = (firstThu.getUTCDay() + 6) % 7
  firstThu.setUTCDate(firstThu.getUTCDate() - fd + 3)
  return 1 + Math.round((d - firstThu) / (7 * 86400000))
}
// Monday-of-week (UTC) for a date string, as YYYY-MM-DD.
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dw = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dw)
  return d.toISOString().slice(0, 10)
}
// Cohort maturation: leads grouped by the week they were created, tracked
// through the funnel with maturation timing. Ad spend by week comes from
// Windsor; the funnel comes from the accurate direct API (appointment-based).
// Includes the current (in-progress) week so its "still maturing" state shows.
async function buildCohortsView(c, weeks, key) {
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const curDow = (today.getUTCDay() + 6) % 7 // 0 = Mon .. 6 = Sun
  const curMon = new Date(today); curMon.setUTCDate(curMon.getUTCDate() - curDow)
  const weekStarts = []
  for (let i = weeks - 1; i >= 0; i--) { const w = new Date(curMon); w.setUTCDate(w.getUTCDate() - 7 * i); weekStarts.push(dstr(w)) }
  const wkIndex = new Map(weekStarts.map((w, i) => [w, i]))
  const start = weekStarts[0]; const end = dstr(today)
  const weekIndexOf = (localDate) => { const i = wkIndex.get(mondayOf(localDate)); return i == null ? null : i }
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,id))
  const [fb, gg, crm] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'date', 'spend', ...FB_LEAD_FIELDS], start, end, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], start, end, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    (c.ghl && await isConnected().catch(() => false)) ? ghlCohorts(c.ghl, start, end, weeks, weekIndexOf).catch(() => ({ connected: false, weeks: [] })) : Promise.resolve({ connected: false, weeks: [] }),
  ])
  const S = weekStarts.map(() => ({ metaSpend: 0, googleSpend: 0, metaLeads: 0, googleConv: 0 }))
  for (const r of fb) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; S[i].metaSpend += num(r.spend); S[i].metaLeads += fbLeads(r) }
  for (const r of gg) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; S[i].googleSpend += num(r.spend); S[i].googleConv += num(r.conversions) }
  const cw = crm.weeks || []
  const out = weekStarts.map((w, i) => {
    const s = S[i]; const cc = cw[i] || {}
    const metaSpend = Math.round(s.metaSpend), googleSpend = Math.round(s.googleSpend), adSpend = metaSpend + googleSpend
    return {
      week: w, weekNum: isoWeek(w), label: `W${isoWeek(w)}`,
      metaSpend, googleSpend, adSpend, adLeads: Math.round(s.metaLeads + s.googleConv),
      ch: cc, // funnel per channel: all / meta / google / other / paid
    }
  })
  return { hasCrm: !!c.ghl, crmConnected: !!crm.connected, weeks: out, currentWeek: weekStarts[weekStarts.length - 1] }
}

// Weekly (Mon–Sun) traffic-light data for one client over the last N weeks.
async function buildWeekly(c, weeks, key, wonBasis = 'created') {
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  // Only report fully completed weeks: the current (in-progress) week is excluded,
  // so the newest bucket is the week ending last Sunday. If today IS Sunday, this
  // week has just completed and counts.
  const curDow = (today.getUTCDay() + 6) % 7 // 0 = Mon .. 6 = Sun
  const curMon = new Date(today); curMon.setUTCDate(curMon.getUTCDate() - curDow)
  const anchorMon = new Date(curMon); if (curDow !== 6) anchorMon.setUTCDate(anchorMon.getUTCDate() - 7)
  const weekStarts = []
  for (let i = weeks - 1; i >= 0; i--) { const w = new Date(anchorMon); w.setUTCDate(w.getUTCDate() - 7 * i); weekStarts.push(dstr(w)) }
  const wkIndex = new Map(weekStarts.map((w, i) => [w, i]))
  const start = weekStarts[0]
  const endSun = new Date(anchorMon); endSun.setUTCDate(endSun.getUTCDate() + 6) // last completed Sunday
  const end = dstr(endSun)
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,id))
  // Closed won basis buckets wins by their WON-date, which can fall in a week for a
  // deal created months earlier - so widen the opp fetch back ~180 days to catch them.
  const oppFrom = wonBasis === 'closed' ? new Date(new Date(start + 'T00:00:00Z').getTime() - 180 * 86400000).toISOString().slice(0, 10) : start
  // CRM (opportunities + pipelines) straight from the GoHighLevel API; Meta / Google from Windsor.
  const [fb, gg, opps, pipes] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'date', 'spend', ...FB_LEAD_FIELDS], start, end, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], start, end, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    c.ghl ? ghlOpportunityRows(c.ghl, oppFrom, end).catch(() => []) : Promise.resolve([]),
    c.ghl ? ghlPipelineRows(c.ghl).catch(() => []) : Promise.resolve([]),
  ])
  const B = weekStarts.map((w) => ({ week: w, weekNum: isoWeek(w), metaSpend: 0, gSpend: 0, metaLeads: 0, gConv: 0, crmLeads: 0, booked: 0, shown: 0, won: 0, wonValue: 0 }))
  for (const r of fb) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; B[i].metaSpend += num(r.spend); B[i].metaLeads += fbLeads(r) }
  for (const r of gg) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; B[i].gSpend += num(r.spend); B[i].gConv += num(r.conversions) }
  const idx = stageIndex(pipes)
  for (const r of opps) {
    const ci = wkIndex.get(mondayOf(String(r.opportunity_created_at || '').slice(0, 10)))
    const pi = idx.get(r.opportunity_pipeline_id); const st = String(r.opportunity_status || '').toLowerCase()
    const stg = pi ? pi.byId[r.opportunity_pipeline_stage_id] : null; const pos = stg ? stg.pos : -1; const isWon = st === 'won'
    const val = num(r.opportunity_monetary_value)
    // Leads / booked / shown are always created-basis (bucket by the week created).
    if (ci != null) {
      const b = B[ci]; b.crmLeads++
      if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) b.booked++
      if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) b.shown++
      if (wonBasis !== 'closed' && isWon) { b.won++; b.wonValue += val }
    }
    // Closed basis: bucket the win by its won-date week (may be outside the created week).
    if (wonBasis === 'closed' && isWon) {
      const wi = wkIndex.get(mondayOf(String(r.opportunity_won_at || '').slice(0, 10)))
      if (wi != null) { B[wi].won++; B[wi].wonValue += val }
    }
  }
  const out = B.map((b) => {
    const spend = b.metaSpend + b.gSpend, leads = b.metaLeads + b.gConv
    return {
      week: b.week, weekNum: b.weekNum, label: `W${b.weekNum}`,
      spend: Math.round(spend), metaSpend: Math.round(b.metaSpend), googleSpend: Math.round(b.gSpend),
      metaLeads: Math.round(b.metaLeads), googleConv: Math.round(b.gConv), leads: Math.round(leads),
      booked: b.booked, shown: b.shown, won: b.won, wonValue: Math.round(b.wonValue),
    }
  })
  // Named lost reasons over the window (GHL direct API) for the lost-reasons pie.
  let lostReasons = []
  if (c.ghl && await isConnected().catch(() => false)) {
    try { const crm = await buildCrm(c.ghl, start, end); lostReasons = crm.lostReasons || [] } catch {}
  }
  return { hasMeta: !!c.meta, hasGoogle: !!c.google, hasCrm: !!c.ghl, weeks: out, lostReasons }
}

// Geographic conversions - where conversions happen. Google Ads geo reports
// can't always combine a location dim with other segments, so we probe a few
// candidate Windsor field names one at a time and use the first that returns
// populated, conversion-bearing rows. Returns {dim, locations:[{name,conversions,cost}]}.
async function fetchGeo(accountId, from, to, preset, key) {
  const cands = ['city', 'geo_target_city', 'region_name', 'region', 'country']
  const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, accountId))
  for (const dim of cands) {
    try {
      const rows = filt(await windsorFetch('google_ads', ['account_id', dim, 'conversions', 'spend'], from, to, preset, key))
      const m = new Map()
      for (const r of rows) {
        const raw = r[dim]
        if (raw == null || raw === '' || String(raw).toLowerCase() === 'null') continue
        const e = m.get(raw) || { name: String(raw), conversions: 0, cost: 0 }
        e.conversions += num(r.conversions); e.cost += num(r.spend); m.set(raw, e)
      }
      const list = [...m.values()].filter((x) => x.conversions > 0).sort((a, b) => b.conversions - a.conversions)
      if (list.length) return { dim, locations: list.slice(0, 40) }
    } catch { /* field not recognised - try the next candidate */ }
  }
  return { dim: null, locations: [] }
}

async function buildGoogle(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, accountId))
  const pr = prevRange(from, to)
  const [cg, kw, st, dy, prev, agDay, stDay, ca, geo, lp, ads, adLabelRows] = await Promise.all([
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'ad_group', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'keyword_text', 'match_type', 'quality_score', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'search_term', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    pr.from ? windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], pr.from, pr.to, null, key).then(filt).catch(() => []) : Promise.resolve([]),
    windsorFetch('google_ads', ['account_id', 'date', 'campaign', 'ad_group_name', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'campaign', 'ad_group_name', 'search_term', 'spend', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'conversion_action_name', 'conversion_action_category', 'conversions', 'all_conversions', 'conversions_value'], from, to, preset, key).then(filt).catch(() => []),
    fetchGeo(accountId, from, to, preset, key).catch(() => ({ dim: null, locations: [] })),
    // Landing Page Performance (Google's expanded landing-page report). Its own
    // query so a failure can't blank the campaigns/keywords; aggregated by URL.
    windsorFetch('google_ads', ['account_id', 'expanded_landing_page_view_expanded_final_url', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    // Ad-level (ad_id) rows - Google Search RSAs have no creative name, so the UI
    // labels them by ad ID (+ a friendly-name map from Settings) and scopes them
    // to the drilled-into campaign / ad group. Own query so a field mismatch can't
    // blank the rest of the Google view.
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'ad_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt).catch(() => []),
    // Google Ads labels applied to each ad (if the connector exposes them) → used
    // as the ad's friendly name automatically. Own guarded query: if the `labels`
    // field isn't available the whole call 400s and we fall back to Settings names.
    windsorFetch('google_ads', ['account_id', 'ad_id', 'labels'], from, to, preset, key).then(filt).catch(() => []),
  ])
  const roll = rollupGoogle(cg, kw, st, dy, daysInRange(from, to, preset))
  roll.geo = geo
  // Landing pages by spend: which destination PAGES the budget drove traffic to.
  // Google's expanded URL carries every UTM / gclid param, so strip the query
  // string to the origin+path - otherwise each keyword variant is a separate
  // "page". Aggregate by that clean page URL.
  const cleanUrl = (u) => { try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/$/, '') || x.origin } catch { return String(u).split('?')[0].split('#')[0].replace(/\/$/, '') } }
  const lpM = new Map()
  for (const r of lp) {
    const raw = r.expanded_landing_page_view_expanded_final_url; if (!raw) continue
    const url = cleanUrl(raw); if (!url) continue
    const e = lpM.get(url) || { url, cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions)
    lpM.set(url, e)
  }
  roll.landingPages = [...lpM.values()].filter((x) => x.cost > 0 || x.clicks > 0).sort((a, b) => b.cost - a.cost).slice(0, 200)
  // Ads keyed by (campaign, ad group, ad id) so each ad belongs to exactly one
  // ad group - this lets the UI filter ads by the drilled-into campaign/ad group.
  const adM = new Map()
  for (const r of ads) {
    const id = r.ad_id != null && String(r.ad_id).trim() ? String(r.ad_id).trim() : null; if (!id) continue
    const camp = r.campaign || null, ag = r.ad_group_name || null; const k = camp + '|' + ag + '|' + id
    const e = adM.get(k) || { id, campaign: camp, adGroup: ag, cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions)
    adM.set(k, e)
  }
  roll.ads = [...adM.values()].filter((x) => x.cost > 0 || x.clicks > 0).sort((a, b) => b.cost - a.cost).slice(0, 500)
  // Ad labels from Google Ads (if the connector exposes them): { ad_id -> label }.
  // Read a few possible field spellings defensively; Settings names override these.
  const adLabels = {}
  for (const r of (adLabelRows || [])) {
    const id = r.ad_id != null && String(r.ad_id).trim() ? String(r.ad_id).trim() : null; if (!id) continue
    const lab = String(r.labels ?? r.label ?? r.ad_labels ?? '').trim().replace(/[[\]"]/g, '').replace(/\s*,\s*/g, ', ').trim()
    if (lab && !adLabels[id]) adLabels[id] = lab
  }
  roll.adLabels = adLabels
  // Detailed rows (campaign, ad group, action) so the UI can filter them to the
  // drilled-into campaign / ad group; the front-end aggregates by action name.
  roll.conversionActions = ca.map((r) => ({ campaign: r.campaign || null, adGroup: r.ad_group_name || null, name: r.conversion_action_name, category: titleCase(String(r.conversion_action_category || '').replace(/_/g, ' ')), conversions: num(r.conversions), allConversions: num(r.all_conversions), value: num(r.conversions_value) })).filter((r) => r.name && r.allConversions > 0).slice(0, 3000)
  roll.prev = prev.reduce((a, r) => ({ cost: a.cost + num(r.spend), impressions: a.impressions + num(r.impressions), clicks: a.clicks + num(r.clicks), conversions: a.conversions + num(r.conversions) }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 })
  roll.adGroupDaily = agDay.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adGroup: r.ad_group_name || (r.ad_group ? String(r.ad_group).split('/').pop() : null), cost: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions) })).filter((r) => r.date && r.campaign)
  roll.searchTermDaily = stDay.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adGroup: r.ad_group_name || null, keyword: null, term: r.search_term, cost: num(r.spend), clicks: num(r.clicks), conversions: num(r.conversions) })).filter((r) => r.date && r.term && (r.cost > 0 || r.clicks > 0)).sort((a, b) => b.cost - a.cost).slice(0, 2500)
  return roll
}

// Google Analytics 4 via the Windsor.ai connector. Scoped to one client's GA4
// property by `account_id` (Windsor normalises the property id into account_id,
// same as Meta/Google). Every query is guarded (.catch → null) so an unknown
// field can't blank the whole tab; _diag records which queries returned rows so
// empty sections are explainable. Rates are normalised to 0–100 percent.
const GA4_CONNECTOR = 'google_analytics_4'
// Windsor's GA4 connector slug has changed across their API versions, and calling
// an unknown slug returns HTTP 400 `{"error":"We don't have this connector yet!"}`
// - which is exactly what was blanking the Analytics discovery even though the
// account HAS GA4 properties connected. So we probe a short candidate list once
// and cache whichever slug Windsor actually accepts. Ordered most-likely first.
const GA4_SLUG_CANDIDATES = ['googleanalytics4', 'google_analytics_4', 'google_analytics', 'ga4', 'google_analytics4']
let _ga4Slug = null, _ga4SlugInflight = null
async function resolveGa4Slug(key) {
  if (_ga4Slug) return _ga4Slug
  // Share one probe across concurrent callers (buildGanalytics fires many GA4
  // queries at once) so a cold start doesn't run the candidate loop N times.
  if (_ga4SlugInflight) return _ga4SlugInflight
  _ga4SlugInflight = (async () => {
    for (const slug of GA4_SLUG_CANDIDATES) {
      try {
        const p = new URLSearchParams({ api_key: key, fields: 'account_id', date_preset: 'last_7d' })
        const r = await resilientFetch(`https://connectors.windsor.ai/${slug}?${p.toString()}`, {}, { label: `Windsor ga4-probe ${slug}`, timeoutMs: 6000, retries: 0 })
        const txt = await r.text().catch(() => '')
        // A recognised connector answers 200 (rows or empty) or a param/auth error -
        // but never "we don't have this connector". Anything else means valid slug.
        if (r.status !== 404 && !/don'?t\s+have\s+this\s+connector/i.test(txt)) { _ga4Slug = slug; return slug }
      } catch { /* transient - try the next candidate */ }
    }
    _ga4Slug = GA4_SLUG_CANDIDATES[0]
    return _ga4Slug
  })()
  try { return await _ga4SlugInflight } finally { _ga4SlugInflight = null }
}
// GA4 fetch that always targets the resolved slug (not the stale const).
async function windsorGa4(fields, from, to, preset, key) {
  const slug = await resolveGa4Slug(key)
  return windsorFetch(slug, fields, from, to, preset, key)
}
function ga4Agg(rows, keyFn) {
  const m = new Map()
  for (const r of (rows || [])) {
    const k = keyFn(r); if (!k) continue
    const e = m.get(k) || { name: k, sessions: 0, engaged: 0, keyEvents: 0, eventCount: 0 }
    e.sessions += num(r.sessions); e.engaged += num(r.engaged_sessions); e.keyEvents += num(r.conversions); e.eventCount += num(r.event_count)
    m.set(k, e)
  }
  return [...m.values()].map((e) => ({ ...e, engagementRate: e.sessions ? e.engaged / e.sessions * 100 : 0 })).sort((a, b) => b.sessions - a.sessions).slice(0, 50)
}
// GA rate fields arrive as a ratio (0–1) or already a percent; normalise to %.
const ga4Pct = (v) => { const n = num(v); return n > 0 && n <= 1 ? n * 100 : n }
async function buildGanalytics(propertyId, from, to, preset, key) {
  const filt = (rows) => (rows || []).filter((r) => r.account_id == null || acctEq(r.account_id, propertyId))
  const pr = prevRange(from, to)
  const q = (fields, f = from, t = to, p = preset) => windsorGa4(['account_id', ...fields], f, t, p, key).then(filt).catch(() => null)
  // Fallback query: if the rich field set fails (one unknown field 400s the whole
  // Windsor call), retry with a minimal always-present set so the tab still renders
  // the core metrics instead of showing empty.
  const qF = async (fields, safe, f = from, t = to, p = preset) => { const r = await q(fields, f, t, p); return (r && r.length) ? r : await q(safe, f, t, p) }
  const [totalRows, dayRows, srcRows, chanRows, evtRows, lpRows, prevRows, devRows] = await Promise.all([
    qF(['sessions', 'engaged_sessions', 'bounce_rate', 'event_count', 'conversions', 'screen_page_views', 'total_users', 'new_users', 'average_session_duration'], ['sessions', 'engaged_sessions']),
    qF(['date', 'sessions', 'engaged_sessions', 'conversions', 'screen_page_views', 'total_users'], ['date', 'sessions']),
    q(['session_source', 'session_medium', 'sessions', 'engaged_sessions', 'conversions', 'event_count']),
    q(['session_default_channel_grouping', 'sessions', 'engaged_sessions', 'conversions']),
    q(['event_name', 'event_count', 'conversions']),
    q(['landing_page', 'sessions', 'engaged_sessions', 'bounce_rate', 'conversions']),
    pr.from ? q(['sessions', 'engaged_sessions', 'conversions', 'screen_page_views', 'total_users'], pr.from, pr.to, null) : Promise.resolve(null),
    q(['device_category', 'sessions', 'engaged_sessions', 'conversions']),
  ])
  const sum = (rows, f) => (rows || []).reduce((a, r) => a + num(r[f]), 0)
  const wpct = (rows, f, wf) => { let s = 0, w = 0; for (const r of (rows || [])) { const ww = num(r[wf]); s += ga4Pct(r[f]) * ww; w += ww } return w ? s / w : 0 }
  const totals = (totalRows && totalRows.length) ? {
    sessions: sum(totalRows, 'sessions'), engagedSessions: sum(totalRows, 'engaged_sessions'),
    engagementRate: sum(totalRows, 'sessions') ? sum(totalRows, 'engaged_sessions') / sum(totalRows, 'sessions') * 100 : 0,
    bounceRate: wpct(totalRows, 'bounce_rate', 'sessions'),
    eventCount: sum(totalRows, 'event_count'), keyEvents: sum(totalRows, 'conversions'),
    pageViews: sum(totalRows, 'screen_page_views'), users: sum(totalRows, 'total_users'),
    newUsers: sum(totalRows, 'new_users'),
    avgSessionDuration: (() => { let s = 0, w = 0; for (const r of totalRows) { const ww = num(r.sessions); s += num(r.average_session_duration) * ww; w += ww } return w ? s / w : 0 })(),
  } : null
  const daily = (dayRows || []).map((r) => ({ date: String(r.date || '').slice(0, 10), sessions: num(r.sessions), engaged: num(r.engaged_sessions), keyEvents: num(r.conversions), pageViews: num(r.screen_page_views), users: num(r.total_users) })).filter((r) => /^\d{4}-\d\d-\d\d$/.test(r.date)).sort((a, b) => a.date.localeCompare(b.date))
  const bySource = ga4Agg(srcRows, (r) => `${r.session_source || '(direct)'} / ${r.session_medium || '(none)'}`)
  const byChannel = ga4Agg(chanRows, (r) => r.session_default_channel_grouping || 'Unassigned')
  const events = (evtRows || []).reduce((m, r) => { const n = r.event_name; if (!n) return m; const e = m.get(n) || { name: n, count: 0, keyEvents: 0 }; e.count += num(r.event_count); e.keyEvents += num(r.conversions); m.set(n, e); return m }, new Map())
  const eventsArr = [...events.values()].sort((a, b) => b.count - a.count).slice(0, 40)
  const landingPages = (lpRows || []).map((r) => ({ url: r.landing_page, sessions: num(r.sessions), engaged: num(r.engaged_sessions), engagementRate: num(r.sessions) ? num(r.engaged_sessions) / num(r.sessions) * 100 : 0, bounceRate: ga4Pct(r.bounce_rate), keyEvents: num(r.conversions) })).filter((r) => r.url && r.sessions > 0).sort((a, b) => b.sessions - a.sessions).slice(0, 100)
  const byDevice = ga4Agg(devRows, (r) => r.device_category || 'unknown')
  const prev = (prevRows && prevRows.length) ? { sessions: sum(prevRows, 'sessions'), engagedSessions: sum(prevRows, 'engaged_sessions'), keyEvents: sum(prevRows, 'conversions'), pageViews: sum(prevRows, 'screen_page_views'), users: sum(prevRows, 'total_users') } : null
  const _diag = { totals: !!(totalRows && totalRows.length), daily: !!daily.length, source: !!bySource.length, channel: !!byChannel.length, events: !!eventsArr.length, landingPages: !!landingPages.length, device: !!byDevice.length, connector: _ga4Slug || GA4_CONNECTOR }
  return { property: propertyId, totals, prev, daily, bySource, byChannel, events: eventsArr, landingPages, byDevice, _diag }
}

/* ===== Caalano360 blend: paid + CRM in one call =====
   Stage names come from the Pipelines table (pipeline_stages), so we can
   classify each opportunity as "booked" / "shown" by the POSITION of its
   current stage vs the first booking/attended stage in its own pipeline.
   Won always implies booked+shown. */
const BOOK_RE = /(book|appointment|\bappt\b|discovery call|consult|scheduled)/i
const SHOW_RE = /(attend|showed|\bheld\b|payment collect|\bpaid\b|qualified|onboard|welcome)/i
const STAGE_EXC = /(cancel|no.?show|no.?answer|disqualif|not booked|lost)/i

const asArray = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const j = JSON.parse(v); return Array.isArray(j) ? j : [] } catch { return [] } }
  return []
}
function stageIndex(pipeRows) {
  const idx = new Map()
  for (const p of pipeRows) {
    const stages = asArray(p.pipeline_stages)
    const byId = {}; let bookPos = null, showPos = null, minPos = null
    for (const s of stages) {
      byId[s.id] = { name: s.name, pos: s.position }
      if (minPos == null || s.position < minPos) minPos = s.position
      const nm = String(s.name || '')
      if (STAGE_EXC.test(nm)) continue
      if (BOOK_RE.test(nm)) bookPos = bookPos == null ? s.position : Math.min(bookPos, s.position)
      if (SHOW_RE.test(nm)) showPos = showPos == null ? s.position : Math.min(showPos, s.position)
    }
    if (p.pipeline_id) idx.set(p.pipeline_id, { byId, bookPos, showPos, minPos: minPos == null ? 0 : minPos })
  }
  return idx
}
function blendCrm(oppRows, idx) {
  let leads = 0, qualified = 0, booked = 0, shown = 0, won = 0, lost = 0, open = 0, revenue = 0, openValue = 0
  for (const r of oppRows) {
    leads++
    const st = String(r.opportunity_status || '').toLowerCase()
    const val = num(r.opportunity_monetary_value)
    const pi = idx.get(r.opportunity_pipeline_id)
    const stage = pi ? pi.byId[r.opportunity_pipeline_stage_id] : null
    const pos = stage ? stage.pos : -1
    const isWon = st === 'won'
    if (isWon) { won++; revenue += val }
    else if (st === 'lost' || st === 'abandoned') lost++
    else { open++; openValue += val }
    if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) booked++
    if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) shown++
    const entryPos = pi && pi.minPos != null ? pi.minPos : 0
    if (isQualified({ status: st, pos, entryPos, value: val })) qualified++
  }
  return {
    leads, qualified, booked, shown, won, lost, open,
    revenue: Math.round(revenue), openValue: Math.round(openValue),
    avgValue: won ? Math.round(revenue / won) : 0,
  }
}
// Campaign ↔ pipeline auto-matching by name. Splits camelCase, drops
// boilerplate + geo/date tokens, folds known synonyms (BA≈Buyers Advocacy,
// FIN≈Finance, ASD≈Autism), then scores each campaign against every pipeline
// weighting rarer shared tokens higher. Unconfident matches default to 'all'.
const SYN_GROUPS = [['ba', 'buyers', 'buyer', 'advocacy'], ['fin', 'finr', 'finance', 'financial'], ['asd', 'autism', 'autistic'], ['adhd'], ['property', 'pp', 'properties'], ['investment', 'invest', 'investing'], ['allied', 'alliedhealth'], ['sensory']]
const synKey = (w) => { for (const g of SYN_GROUPS) if (g.includes(w)) return g[0]; return w }
const BLEND_STOP = new Set('web leads lead gen sales pipeline campaign funnel new ads ad national melbourne sydney brisbane perth adelaide search brand impression awareness reach traffic conversion conversions share cd cdc leadgen abo cbo asc test copy the and for of to with prospecting retargeting remarketing simon follow up'.split(' '))
function blendToks(name) {
  const out = new Set()
  const spaced = String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[\[\]]/g, ' ').toLowerCase()
  for (const w of spaced.split(/[^a-z0-9]+/)) { if (!w || /^\d+$/.test(w) || w.length < 2 || BLEND_STOP.has(w)) continue; out.add(synKey(w)) }
  return out
}
function autoMatch(pipelinesArr, camps) {
  const pInfo = pipelinesArr.map((p) => ({ id: p.id, leads: p.crm.leads, keys: blendToks(p.name) }))
  const df = new Map()
  for (const p of pInfo) for (const k of p.keys) df.set(k, (df.get(k) || 0) + 1)
  const res = new Map()
  for (const c of camps) {
    const ck = blendToks(c.name)
    let best = null, bestScore = 0
    for (const p of pInfo) {
      let s = 0; for (const k of p.keys) if (ck.has(k)) s += 1 / (df.get(k) || 1)
      if (s > bestScore || (s === bestScore && s > 0 && best && p.leads > best.leads)) { bestScore = s; best = p }
    }
    res.set(c.name, best && bestScore >= 0.5 ? best.id : 'all')
  }
  return res
}
function campAgg(rows, source, convField) {
  const conv = typeof convField === 'function' ? convField : (r) => num(r[convField])
  const m = new Map()
  for (const r of rows) { const n = r.campaign; if (!n) continue; const e = m.get(n) || { name: n, source, spend: 0, conv: 0, impressions: 0, clicks: 0 }; e.spend += num(r.spend); e.conv += conv(r); e.impressions += num(r.impressions); e.clicks += num(r.clicks); m.set(n, e) }
  return [...m.values()]
}
async function buildBlend(c, from, to, preset, key) {
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,id))
  const pr = prevRange(from, to)
  // GHL opportunities / pipelines / users come straight from the GoHighLevel API
  // (not Windsor), so the blend reconciles with the CRM tab and works the moment a
  // client is linked (Windsor lags on newly-connected accounts). Meta / Google
  // still come from Windsor. All fired in parallel so wall-clock ≈ the slowest one.
  const [fb, gg, oppsRaw, pipes, userRows, pFb, pGg, pOppsRaw] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'spend', ...FB_LEAD_FIELDS, 'impressions', 'clicks'], from, to, preset, key).then(filt(c.meta)) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'spend', 'conversions', 'impressions', 'clicks'], from, to, preset, key).then(filt(c.google)) : Promise.resolve([]),
    c.ghl ? ghlOpportunityRows(c.ghl, from, to).catch(() => []) : Promise.resolve([]),
    c.ghl ? ghlPipelineRows(c.ghl).catch(() => []) : Promise.resolve([]),
    c.ghl ? ghlUserRows(c.ghl).catch(() => []) : Promise.resolve([]),
    pr.from && c.meta ? windsorFetch('facebook', ['account_id', 'spend', ...FB_LEAD_FIELDS], pr.from, pr.to, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    pr.from && c.google ? windsorFetch('google_ads', ['account_id', 'spend', 'conversions'], pr.from, pr.to, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    pr.from && c.ghl ? ghlOpportunityRows(c.ghl, pr.from, pr.to).catch(() => []) : Promise.resolve([]),
  ])
  // Opportunities now come straight from the GoHighLevel API, already filtered to
  // "created inside the window" in the client's timezone, so this is a defensive
  // no-op that keeps the counts reconciled with the Meta and CRM tabs (and would
  // still clamp any out-of-window row that slipped through).
  let opps = oppsRaw, pOpps = pOppsRaw
  if (c.ghl && from && to) {
    try {
      const { fromMs, toMs } = await periodBounds(c.ghl, from, to)
      const inWin = (lo, hi) => (r) => { const ms = Date.parse(r.opportunity_created_at); return isNaN(ms) ? true : ((lo == null || ms >= lo) && (hi == null || ms <= hi)) }
      if (fromMs != null || toMs != null) opps = oppsRaw.filter(inWin(fromMs, toMs))
      if (pr.from && pr.to) { const pb = await periodBounds(c.ghl, pr.from, pr.to); pOpps = pOppsRaw.filter(inWin(pb.fromMs, pb.toMs)) }
    } catch { /* keep unfiltered on error */ }
  }
  const metaCamps = campAgg(fb, 'Meta', fbLeads)
  const googleCamps = campAgg(gg, 'Google', 'conversions')
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0)
  const metaSpend = sum(metaCamps, 'spend'), metaLeads = sum(metaCamps, 'conv'), metaImpr = sum(metaCamps, 'impressions'), metaClicks = sum(metaCamps, 'clicks')
  const googleSpend = sum(googleCamps, 'spend'), googleConv = sum(googleCamps, 'conv'), googleImpr = sum(googleCamps, 'impressions'), googleClicks = sum(googleCamps, 'clicks')
  const idx = stageIndex(pipes)
  // Per-pipeline funnels so the UI can offer a pipeline selector - a "booking"
  // means different things across pipelines, so they're kept separate.
  const nameOf = {}, stagesOf = {}
  for (const p of pipes) {
    if (!p.pipeline_id) continue
    nameOf[p.pipeline_id] = p.pipeline_name || p.pipeline_id
    stagesOf[p.pipeline_id] = asArray(p.pipeline_stages).map((s) => ({ id: s.id, name: s.name, pos: s.position })).sort((a, b) => a.pos - b.pos)
  }
  // Build a full CRM view (account totals + per-pipeline funnels) for any opp
  // subset - the whole account, or one assigned user.
  const crmView = (rows) => {
    const byPipe = new Map()
    for (const r of rows) { const pid = r.opportunity_pipeline_id || 'none'; if (!byPipe.has(pid)) byPipe.set(pid, []); byPipe.get(pid).push(r) }
    const pipelines = [...byPipe.entries()]
      .map(([id, prows]) => {
        const at = new Map(); const openAt = new Map()
        for (const r of prows) { const sid = r.opportunity_pipeline_stage_id; at.set(sid, (at.get(sid) || 0) + 1); const st = String(r.opportunity_status || '').toLowerCase(); if (st !== 'lost' && st !== 'abandoned') openAt.set(sid, (openAt.get(sid) || 0) + 1) }
        const stages = (stagesOf[id] || []).map((s) => ({ name: s.name, pos: s.pos, count: at.get(s.id) || 0, active: openAt.get(s.id) || 0 }))
        return { id, name: nameOf[id] || 'Unnamed pipeline', crm: blendCrm(prows, idx), stages }
      })
      .sort((a, b) => b.crm.leads - a.crm.leads)
    return { crm: blendCrm(rows, idx), pipelines }
  }
  const account = crmView(opps)
  // Per-assigned-user boards for the Caalano360 user filter.
  const uName = {}; for (const u of userRows) if (u.user_id) uName[u.user_id] = u.user_name
  const byUid = new Map()
  for (const r of opps) { const uid = r.opportunity_assigned_to || 'unassigned'; if (!byUid.has(uid)) byUid.set(uid, []); byUid.get(uid).push(r) }
  const users = [...byUid.entries()]
    .map(([uid, rows]) => ({ id: uid, name: uName[uid] || (uid === 'unassigned' ? 'Unassigned' : 'User ' + String(uid).slice(-4)), leads: rows.length, ...crmView(rows) }))
    .sort((a, b) => b.leads - a.leads)
  const allCamps = [...metaCamps, ...googleCamps]
  const auto = autoMatch(account.pipelines, allCamps)
  const campaigns = allCamps
    .map((x) => ({ name: x.name, source: x.source, spend: Math.round(x.spend), conv: Math.round(x.conv), impressions: Math.round(x.impressions), clicks: Math.round(x.clicks), auto: auto.get(x.name) || 'all' }))
    .sort((a, b) => b.spend - a.spend)
  // Previous equal-length period (account level) for ±vs-previous deltas.
  let prev = null
  if (pr.from) {
    const pMetaSpend = pFb.reduce((a, r) => a + num(r.spend), 0)
    const pGoogleSpend = pGg.reduce((a, r) => a + num(r.spend), 0)
    const pMetaLeads = pFb.reduce((a, r) => a + fbLeads(r), 0)
    const pGoogleConv = pGg.reduce((a, r) => a + num(r.conversions), 0)
    prev = {
      adSpend: Math.round(pMetaSpend + pGoogleSpend), metaSpend: Math.round(pMetaSpend), googleSpend: Math.round(pGoogleSpend),
      metaLeads: Math.round(pMetaLeads), googleConv: Math.round(pGoogleConv),
      crm: blendCrm(pOpps, idx),
    }
  }
  return {
    hasCrm: !!c.ghl, hasMeta: !!c.meta, hasGoogle: !!c.google,
    paid: {
      adSpend: Math.round(metaSpend + googleSpend), metaSpend: Math.round(metaSpend), googleSpend: Math.round(googleSpend),
      metaLeads: Math.round(metaLeads), googleConv: Math.round(googleConv), adConversions: Math.round(metaLeads + googleConv),
      impressions: Math.round(metaImpr + googleImpr), clicks: Math.round(metaClicks + googleClicks),
      metaImpr: Math.round(metaImpr), metaClicks: Math.round(metaClicks), googleImpr: Math.round(googleImpr), googleClicks: Math.round(googleClicks),
    },
    crm: account.crm, pipelines: account.pipelines, users, campaigns, prev,
  }
}

// --- Executive health score ------------------------------------------------
// A transparent 0-100 score across four pillars - Marketing, Sales, Operations,
// Revenue - each a small set of real metrics compared to a reference (the
// previous equal-length period, the honest baseline until daily snapshots build
// a rolling average). NO AI is used here: every figure is a plain calculation
// the UI shows the working for. Pillars with no data drop out and the composite
// re-weights across whatever has data, so a client with no CRM still scores on
// what it does have.
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// Map a metric to 0-100 vs a reference. 50 = at reference; a full doubling in
// the good direction → ~100, collapsing to zero → ~0. Linear + clamped so it is
// explainable rather than a black box.
function scoreVs(actual, ref, higherBetter) {
  if (actual == null || ref == null || !isFinite(actual) || !isFinite(ref) || ref === 0) return null
  const rel = (actual - ref) / Math.abs(ref)
  return clampN(Math.round(50 + 50 * (higherBetter ? rel : -rel)), 0, 100)
}
// Absolute good→bad band (e.g. show rate where an industry norm exists), used
// when a prior-period reference is missing or a universal standard applies.
function scoreBand(actual, good, bad) {
  if (actual == null || !isFinite(actual) || good === bad) return null
  return clampN(Math.round(100 - 100 * ((actual - good) / (bad - good))), 0, 100)
}
const avgScores = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null }
const safeDiv = (a, b) => (b ? a / b : null)
const pillar = (label, comps) => { const score = avgScores(comps.map((c) => c.score)); return { label, score, components: comps.filter((c) => c.score != null || c.actual != null) } }

async function buildHealth(c, from, to, preset, key, weights, wonBasis = 'created') {
  const blend = await buildBlend(c, from, to, preset, key)
  // Closed won basis: overlay the blend's won/revenue with won-in-period (banked)
  // before deriving the score, so the Executive's revenue/ROAS reflect it. Leads
  // and the funnel stay created-basis. Default 'created' → unchanged for snapshot
  // and other callers.
  if (wonBasis === 'closed' && c.ghl && from && to) {
    const wc = await wonInPeriod(c.ghl, from, to).catch(() => null)
    if (wc) applyClosedBasisBlend(blend, wc)
  }
  const p = blend.paid, crm = blend.crm || {}, prev = blend.prev || null
  const pc = (prev && prev.crm) || {}
  const pSpend = prev ? prev.adSpend : null
  const has = { crm: !!c.ghl, meta: !!c.meta, google: !!c.google, prev: !!prev }

  // Marketing - lead generation & paid efficiency. CRM lead count is the real
  // signal; a client with no CRM falls back to ad-reported conversions.
  const leads = c.ghl ? crm.leads : p.adConversions
  const pLeads = c.ghl ? (pc.leads != null ? pc.leads : null) : null
  const cpl = p.adSpend > 0 && leads ? p.adSpend / leads : null
  const pCpl = pSpend > 0 && pLeads ? pSpend / pLeads : null
  const marketing = pillar('Marketing', [
    { label: 'Lead volume', actual: leads, ref: pLeads, fmt: 'int', score: scoreVs(leads, pLeads, true) },
    { label: 'Cost per lead', actual: cpl, ref: pCpl, fmt: 'money', score: scoreVs(cpl, pCpl, false) },
  ])

  // Sales - conversion quality through the pipeline.
  const qRate = safeDiv(crm.qualified, crm.leads), pqRate = safeDiv(pc.qualified, pc.leads)
  const bRate = safeDiv(crm.booked, crm.leads), pbRate = safeDiv(pc.booked, pc.leads)
  const wRate = safeDiv(crm.won, crm.leads), pwRate = safeDiv(pc.won, pc.leads)
  const sales = pillar('Sales', [
    { label: 'Lead → qualified', actual: qRate, ref: pqRate, fmt: 'pct', score: scoreVs(qRate, pqRate, true) },
    { label: 'Lead → booked', actual: bRate, ref: pbRate, fmt: 'pct', score: scoreVs(bRate, pbRate, true) },
    { label: 'Lead → won', actual: wRate, ref: pwRate, fmt: 'pct', score: scoreVs(wRate, pwRate, true) },
  ])

  // Operations - execution on the leads booked (did they actually show up).
  const showRate = safeDiv(crm.shown, crm.booked), pShowRate = safeDiv(pc.shown, pc.booked)
  // Prefer a vs-previous score; fall back to an absolute band (80% good, 40% poor)
  // so a first-ever period still scores instead of showing blank.
  const showScore = scoreVs(showRate, pShowRate, true) != null ? scoreVs(showRate, pShowRate, true) : scoreBand(showRate, 0.8, 0.4)
  const ops = pillar('Operations', [
    { label: 'Show rate', actual: showRate, ref: pShowRate, fmt: 'pct', score: showScore },
  ])

  // Revenue - realised money & deal quality.
  const revenue = pillar('Revenue', [
    { label: 'Revenue', actual: crm.revenue, ref: pc.revenue, fmt: 'money', score: scoreVs(crm.revenue, pc.revenue, true) },
    { label: 'Deals won', actual: crm.won, ref: pc.won, fmt: 'int', score: scoreVs(crm.won, pc.won, true) },
    { label: 'Avg deal value', actual: crm.avgValue, ref: pc.avgValue, fmt: 'money', score: scoreVs(crm.avgValue, pc.avgValue, true) },
  ])

  const w = { marketing: 25, sales: 25, ops: 25, revenue: 25, ...(weights || {}) }
  const pillars = { marketing, sales, ops, revenue }
  const wKeys = ['marketing', 'sales', 'ops', 'revenue']
  let wSum = 0, acc = 0
  for (const k of wKeys) { const s = pillars[k].score; const wt = num(w[k]); if (s != null && wt > 0) { acc += s * wt; wSum += wt } }
  const composite = wSum ? Math.round(acc / wSum) : null

  // Forecast - run-rate projection of the current period from elapsed time,
  // against the previous full period. Elapsed fraction from the client timezone
  // period bounds; a completed period paces at 100%.
  let forecast = null
  try {
    let frac = 1
    if (c.ghl && from && to) { const { fromMs, toMs } = await periodBounds(c.ghl, from, to); const now = Date.now(); if (fromMs != null && toMs != null && toMs > fromMs) frac = clampN((now - fromMs) / (toMs - fromMs), 0.02, 1) }
    const proj = (v) => (frac > 0 ? Math.round(v / frac) : v)
    forecast = {
      elapsedPct: Math.round(frac * 100),
      projectedRevenue: proj(crm.revenue || 0), prevRevenue: pc.revenue != null ? pc.revenue : null,
      projectedLeads: proj(leads || 0), prevLeads: pLeads,
      projectedWon: proj(crm.won || 0), prevWon: pc.won != null ? pc.won : null,
      pacePct: pc.revenue ? Math.round((proj(crm.revenue || 0) / pc.revenue) * 100) : null,
    }
  } catch { /* forecast is best-effort */ }

  const kpis = {
    adSpend: p.adSpend, leads, qualified: crm.qualified != null ? crm.qualified : null,
    booked: crm.booked != null ? crm.booked : null, shown: crm.shown != null ? crm.shown : null,
    won: crm.won != null ? crm.won : null, revenue: crm.revenue != null ? crm.revenue : null,
    openValue: crm.openValue != null ? crm.openValue : null,
    cpl: cpl != null ? Math.round(cpl) : null,
    cpql: (p.adSpend > 0 && crm.qualified) ? Math.round(p.adSpend / crm.qualified) : null,
    cpBooked: (p.adSpend > 0 && crm.booked) ? Math.round(p.adSpend / crm.booked) : null,
    cpWon: (p.adSpend > 0 && crm.won) ? Math.round(p.adSpend / crm.won) : null,
    avgDeal: crm.avgValue != null ? crm.avgValue : null,
    prev: prev ? { adSpend: pSpend, leads: pLeads, qualified: pc.qualified, booked: pc.booked, shown: pc.shown, won: pc.won, revenue: pc.revenue, openValue: pc.openValue } : null,
  }
  // Paid channel split + ad-reported leads (current & previous), so the client
  // update reports leads/cost-per-lead on the SAME basis as Meta/Google Ads
  // Manager rather than mixing in CRM opportunities from other sources.
  const channels = { metaSpend: p.metaSpend, googleSpend: p.googleSpend, metaLeads: p.metaLeads, googleConv: p.googleConv, prevMetaLeads: prev ? prev.metaLeads : null, prevGoogleConv: prev ? prev.googleConv : null }
  // Per-pipeline funnels + where open deals are sitting (for the client update's
  // per-pipeline commentary and the "no wins? here's where deals got to" note).
  const pipelines = (blend.pipelines || []).map((pp) => ({
    name: pp.name, leads: pp.crm.leads, booked: pp.crm.booked, shown: pp.crm.shown, won: pp.crm.won, lost: pp.crm.lost, open: pp.crm.open, revenue: pp.crm.revenue, openValue: pp.crm.openValue,
    // Stages in pipeline (funnel) order, open deals only.
    stages: (pp.stages || []).slice().sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).filter((s) => s.active > 0).map((s) => ({ name: s.name, open: s.active })),
  })).sort((a, b) => b.leads - a.leads)

  return {
    score: { composite, weights: w, marketing: marketing.score, sales: sales.score, ops: ops.score, revenue: revenue.score, pillars },
    kpis, channels, pipelines, forecast, has,
  }
}

// Creative Cockpit auto-fill helpers: prettify Meta's CTA enum, and best-effort
// classify the destination from the ad's link (user can override in the UI).
function prettyCta(v) { return v ? titleCase(String(v).replace(/_/g, ' ')) : '' }
function classifyDest(link, objType) {
  const l = String(link || '').toLowerCase()
  // No external link ⇒ on-Facebook destination - almost always a Meta lead form
  // for lead-gen accounts. (User can override in the cockpit.)
  if (!l) return 'Meta Lead Form'
  if (/leadconnector|gohighlevel|msgsndr/.test(l)) return 'Caalano Systems landing'
  if (/calendly|\/book|schedul|appointment|\/calendar|acuity|tidycal/.test(l)) return 'Schedule page'
  if (/facebook\.com\/.*lead|fb\.me\b|\/instant.?form|leadgen/.test(l)) return 'Meta lead form'
  return 'Landing page'
}

function rollupGhl(rows) {
  let open = 0, won = 0, lost = 0, wonValue = 0, openValue = 0
  const lostR = new Map(), src = new Map(), wonMonth = new Map(), stage = new Map()
  for (const r of rows) {
    const st = String(r.opportunity_status || '').toLowerCase()
    const val = num(r.opportunity_monetary_value)
    if (st === 'won') { won++; wonValue += val; const mo = String(r.opportunity_created_at || '').slice(0, 7); if (mo) wonMonth.set(mo, (wonMonth.get(mo) || 0) + 1) }
    else if (st === 'lost' || st === 'abandoned') { lost++; const lr = r.opportunity_lost_reason_id || 'Not set'; lostR.set(lr, (lostR.get(lr) || 0) + 1) }
    else { open++; openValue += val; const s = r.opportunity_pipeline_stage_id || 'stage'; stage.set(s, (stage.get(s) || 0) + 1) }
    const s = (r.opportunity_source || 'unknown').trim() || 'unknown'; const e = src.get(s) || { name: s, won: 0, open: 0, lostSampled: 0 }; if (st === 'won') e.won++; else if (st === 'lost') e.lostSampled++; else e.open++; src.set(s, e)
  }
  const closed = won + lost
  const sources = [...src.values()].sort((a, b) => (b.won + b.open + b.lostSampled) - (a.won + a.open + a.lostSampled)).slice(0, 8)
  const top = sources[0]
  const total = open + won + lost
  const biggestLeak = total
    ? `${open} of ${total} opportunities are still open and ${lost} were lost, for a ${closed ? (100 * won / closed).toFixed(1) : 0}% close rate.${top ? ` "${top.name}" is the largest lead source.` : ''}`
    : 'No opportunities in this range.'
  return {
    summary: { open, openValue: Math.round(openValue), won, wonValue: Math.round(wonValue), avgWonValue: won ? Math.round(wonValue / won) : 0, lostTotal: lost, lostSampled: lost, closedWinRatePct: closed ? +(100 * won / closed).toFixed(1) : 0 },
    biggestLeak,
    lostReasons: [...lostR.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 11),
    sources,
    wonByMonth: [...wonMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    stages: [...stage.entries()].map(([id, count]) => ({ id, count })),
  }
}

// Organic social (Instagram business + Facebook Page) for one client. Each query
// stays within a single Windsor "table" so cross-table joins don't drop rows;
// everything is best-effort (a failed sub-fetch yields [] and the rest renders).
async function buildSocial(soc, from, to, key, clientId) {
  const igId = soc.ig, fbo = soc.fbo
  const F = (connector, fields) => windsorFetch(connector, fields, from, to, null, key).catch(() => [])
  const byDate = (rows, map) => { const m = new Map(); for (const r of rows) { const d = String(r.date || r.timestamp || '').slice(0, 10); if (!d) continue; const e = m.get(d) || { date: d }; map(e, r); m.set(d, e) } return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0)
  const lastNonNull = (rows, k) => { for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][k] != null && rows[i][k] !== '') return num(rows[i][k]) } return 0 }
  const demo = (rows, nk, sk, cap) => { const out = rows.map((r) => ({ name: r[nk], size: num(r[sk]) })).filter((x) => x.name && x.size).sort((a, b) => b.size - a.size); return cap ? out.slice(0, cap) : out }

  let ig = null
  if (igId) {
    const igFilt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,igId))
    const [dtv, dins, prof, media, gender, age, country] = await Promise.all([
      F('instagram', ['account_id', 'date', 'views', 'accounts_engaged', 'likes', 'comments', 'shares', 'saves', 'replies', 'profile_links_taps', 'total_interactions']).then(igFilt),
      F('instagram', ['account_id', 'date', 'reach', 'follower_count']).then(igFilt),
      F('instagram', ['account_id', 'followers_count', 'follows_count', 'media_count', 'username']).then(igFilt),
      F('instagram', ['account_id', 'media_id', 'timestamp', 'media_type', 'media_caption', 'media_permalink', 'media_thumbnail_url', 'media_url', 'media_like_count', 'media_comments_count', 'media_reach', 'media_views', 'media_saved', 'media_shares', 'media_engagement']).then(igFilt),
      F('instagram', ['account_id', 'audience_gender_name', 'audience_gender_size']).then(igFilt),
      F('instagram', ['account_id', 'audience_age_name', 'audience_age_size']).then(igFilt),
      F('instagram', ['account_id', 'audience_country_name', 'audience_country_size']).then(igFilt),
    ])
    const p = prof[0] || {}
    const likes = sum(dtv, 'likes'), comments = sum(dtv, 'comments'), shares = sum(dtv, 'shares'), saves = sum(dtv, 'saves')
    const reach = sum(dins, 'reach'), interactions = sum(dtv, 'total_interactions')
    const totals = { reach, views: sum(dtv, 'views'), engaged: sum(dtv, 'accounts_engaged'), likes, comments, shares, saves, replies: sum(dtv, 'replies'), linkTaps: sum(dtv, 'profile_links_taps'), interactions, engagement: likes + comments + shares + saves, newFollowers: sum(dins, 'follower_count'), er: reach ? Math.round((interactions / reach) * 1000) / 10 : null }
    // Posts per day from the FULL media set (before the top-60 slice), so the
    // posting-cadence line is accurate.
    const postsByDay = {}; for (const m of media) { const d = String(m.timestamp || '').slice(0, 10); if (d) postsByDay[d] = (postsByDay[d] || 0) + 1 }
    const dtvMap = new Map(byDate(dtv, (e, r) => { e.likes = (e.likes || 0) + num(r.likes); e.comments = (e.comments || 0) + num(r.comments); e.saves = (e.saves || 0) + num(r.saves); e.shares = (e.shares || 0) + num(r.shares); e.replies = (e.replies || 0) + num(r.replies); e.interactions = (e.interactions || 0) + num(r.total_interactions); e.views = (e.views || 0) + num(r.views) }).map((d) => [d.date, d]))
    const dinsMap = new Map(byDate(dins, (e, r) => { e.reach = (e.reach || 0) + num(r.reach); e.newFollowers = (e.newFollowers || 0) + num(r.follower_count) }).map((d) => [d.date, d]))
    const allDates = [...new Set([...dtvMap.keys(), ...dinsMap.keys(), ...Object.keys(postsByDay)])].sort()
    const daily = allDates.map((date) => { const a = dtvMap.get(date) || {}, b = dinsMap.get(date) || {}; return { date, reach: b.reach || 0, newFollowers: b.newFollowers || 0, interactions: a.interactions || 0, views: a.views || 0, likes: a.likes || 0, comments: a.comments || 0, saves: a.saves || 0, shares: a.shares || 0, replies: a.replies || 0, posts: postsByDay[date] || 0 } })
    const posts = media.map((m) => {
      const eng = num(m.media_engagement) || (num(m.media_like_count) + num(m.media_comments_count) + num(m.media_saved) + num(m.media_shares)); const rch = num(m.media_reach)
      const isVid = /VIDEO|REEL/i.test(String(m.media_type || ''))
      return { id: m.media_id, date: String(m.timestamp || '').slice(0, 10), type: m.media_type || null, caption: String(m.media_caption || '').replace(/\s+/g, ' ').slice(0, 160), permalink: m.media_permalink || null, thumb: isVid ? (m.media_thumbnail_url || null) : (m.media_url || m.media_thumbnail_url || null), video: isVid ? (m.media_url || null) : null, likes: num(m.media_like_count), comments: num(m.media_comments_count), saves: num(m.media_saved), shares: num(m.media_shares), reach: rch, views: num(m.media_views), engagement: eng, er: rch ? Math.round((eng / rch) * 1000) / 10 : null }
    }).filter((x) => x.id).sort((a, b) => b.engagement - a.engagement).slice(0, 60)
    ig = { profile: { followers: num(p.followers_count), follows: num(p.follows_count), mediaCount: num(p.media_count), username: p.username || null }, totals, daily, posts, demographics: { gender: demo(gender, 'audience_gender_name', 'audience_gender_size'), age: demo(age, 'audience_age_name', 'audience_age_size'), country: demo(country, 'audience_country_name', 'audience_country_size', 8) } }
  }

  let fb = null
  if (fbo) {
    const fbFilt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,fbo))
    const [pageRows, postRows] = await Promise.all([
      F('facebook_organic', ['account_id', 'date', 'page_fans', 'page_follows', 'page_impressions', 'page_impressions_organic', 'page_impressions_paid', 'page_impressions_unique', 'page_post_engagements', 'page_views_total', 'page_video_views', 'page_daily_follows', 'page_daily_unfollows']).then(fbFilt),
      F('facebook_organic', ['account_id', 'post_id', 'post_created_time', 'post_message_oneline', 'permalink_url', 'full_picture', 'post_impressions', 'post_impressions_organic', 'post_engagements', 'post_reactions_total', 'post_comments_total', 'post_clicks', 'post_activity_by_action_type_share']).then(fbFilt),
    ])
    const totals = { impressions: sum(pageRows, 'page_impressions'), impressionsOrganic: sum(pageRows, 'page_impressions_organic'), impressionsPaid: sum(pageRows, 'page_impressions_paid'), reachUnique: sum(pageRows, 'page_impressions_unique'), engagements: sum(pageRows, 'page_post_engagements'), pageViews: sum(pageRows, 'page_views_total'), videoViews: sum(pageRows, 'page_video_views'), newFollows: sum(pageRows, 'page_daily_follows'), unfollows: sum(pageRows, 'page_daily_unfollows') }
    const fbPostsByDay = {}
    for (const p of postRows) { const d = String(p.post_created_time || '').slice(0, 10); if (!d) continue; const e = fbPostsByDay[d] = fbPostsByDay[d] || { posts: 0, reactions: 0, comments: 0, shares: 0 }; e.posts++; e.reactions += num(p.post_reactions_total); e.comments += num(p.post_comments_total); e.shares += num(p.post_activity_by_action_type_share) }
    const pageMap = new Map(byDate(pageRows, (e, r) => { e.impressionsOrganic = (e.impressionsOrganic || 0) + num(r.page_impressions_organic); e.impressionsPaid = (e.impressionsPaid || 0) + num(r.page_impressions_paid); e.engagements = (e.engagements || 0) + num(r.page_post_engagements); e.follows = (e.follows || 0) + num(r.page_daily_follows); e.unfollows = (e.unfollows || 0) + num(r.page_daily_unfollows) }).map((d) => [d.date, d]))
    const fbDates = [...new Set([...pageMap.keys(), ...Object.keys(fbPostsByDay)])].sort()
    const daily = fbDates.map((date) => { const a = pageMap.get(date) || {}, b = fbPostsByDay[date] || {}; return { date, impressionsOrganic: a.impressionsOrganic || 0, impressionsPaid: a.impressionsPaid || 0, engagements: a.engagements || 0, netFollowers: (a.follows || 0) - (a.unfollows || 0), posts: b.posts || 0, reactions: b.reactions || 0, comments: b.comments || 0, shares: b.shares || 0 } })
    const posts = postRows.map((p) => { const eng = num(p.post_engagements); const impr = num(p.post_impressions); return { id: p.post_id, date: String(p.post_created_time || '').slice(0, 10), message: String(p.post_message_oneline || '').replace(/\s+/g, ' ').slice(0, 160), permalink: p.permalink_url || null, picture: p.full_picture || null, impressions: impr, impressionsOrganic: num(p.post_impressions_organic), engagements: eng, reactions: num(p.post_reactions_total), comments: num(p.post_comments_total), shares: num(p.post_activity_by_action_type_share), clicks: num(p.post_clicks), er: impr ? Math.round((eng / impr) * 1000) / 10 : null } }).filter((x) => x.id).sort((a, b) => b.engagements - a.engagements).slice(0, 60)
    fb = { page: { fans: lastNonNull(pageRows, 'page_fans'), follows: lastNonNull(pageRows, 'page_follows') }, totals, daily, posts }
  }
  // Auto-fill from the saved snapshot store: the Meta/IG organic API only returns
  // roughly the last 90 days of insights (and followers/demographics are "now
  // only"), so beyond that window the live pull is empty. We merge in the daily
  // history we captured while it was still available, and fall back to the last
  // stored followers/demographics when the live ones are gone.
  if (clientId) {
    try {
      const snap = await loadSocialSnap(clientId)
      if (snap) {
        const inWin = (d) => (!from || d >= from) && (!to || d <= to)
        const latestBefore = (obj) => { const ds = Object.keys(obj || {}).filter((d) => !to || d <= to).sort(); return ds.length ? { date: ds[ds.length - 1], v: obj[ds[ds.length - 1]] } : null }
        if (ig && snap.ig) {
          const live = new Set(ig.daily.map((d) => d.date))
          const extra = []
          for (const [d, e] of Object.entries(snap.ig.daily || {})) {
            if (!inWin(d) || live.has(d)) continue
            extra.push({ date: d, reach: e.reach || 0, newFollowers: e.newFollowers || 0, interactions: e.interactions || 0, views: e.views || 0, likes: e.likes || 0, comments: e.comments || 0, saves: e.saves || 0, shares: e.shares || 0, replies: e.replies || 0, posts: e.posts || 0 })
            const t = ig.totals
            t.reach += e.reach || 0; t.views += e.views || 0; t.engaged += e.engaged || 0; t.likes += e.likes || 0; t.comments += e.comments || 0; t.shares += e.shares || 0; t.saves += e.saves || 0; t.replies += e.replies || 0; t.linkTaps += e.linkTaps || 0; t.interactions += e.interactions || 0; t.newFollowers += e.newFollowers || 0
          }
          if (extra.length) {
            ig.daily = [...ig.daily, ...extra].sort((a, b) => a.date.localeCompare(b.date))
            ig.totals.engagement = ig.totals.likes + ig.totals.comments + ig.totals.shares + ig.totals.saves
            ig.totals.er = ig.totals.reach ? Math.round((ig.totals.interactions / ig.totals.reach) * 1000) / 10 : null
            ig.fromStore = extra.length
          }
          if (!ig.profile.followers) { const f = latestBefore(snap.ig.followers); if (f) ig.profile = { ...ig.profile, followers: f.v.followers || 0, follows: f.v.follows || ig.profile.follows || 0, mediaCount: f.v.mediaCount || ig.profile.mediaCount || 0, asOf: f.date } }
          if (!ig.demographics.gender.length && !ig.demographics.age.length && !ig.demographics.country.length) { const dm = latestBefore(snap.ig.demographics); if (dm) ig.demographics = { ...dm.v, asOf: dm.date } }
        }
        if (fb && snap.fb) {
          const live = new Set(fb.daily.map((d) => d.date))
          const extra = []
          for (const [d, e] of Object.entries(snap.fb.daily || {})) {
            if (!inWin(d) || live.has(d)) continue
            extra.push({ date: d, impressionsOrganic: e.impressionsOrganic || 0, impressionsPaid: e.impressionsPaid || 0, engagements: e.engagements || 0, netFollowers: (e.newFollows || 0) - (e.unfollows || 0), posts: e.posts || 0, reactions: e.reactions || 0, comments: e.comments || 0, shares: e.shares || 0 })
            const t = fb.totals
            t.impressions += e.impressions || 0; t.impressionsOrganic += e.impressionsOrganic || 0; t.impressionsPaid += e.impressionsPaid || 0; t.reachUnique += e.reachUnique || 0; t.engagements += e.engagements || 0; t.pageViews += e.pageViews || 0; t.videoViews += e.videoViews || 0; t.newFollows += e.newFollows || 0; t.unfollows += e.unfollows || 0
          }
          if (extra.length) { fb.daily = [...fb.daily, ...extra].sort((a, b) => a.date.localeCompare(b.date)); fb.fromStore = extra.length }
          if (!fb.page.fans) { const f = latestBefore(snap.fb.followers); if (f) fb.page = { ...fb.page, fans: f.v.fans || 0, follows: f.v.follows || fb.page.follows || 0, asOf: f.date } }
        }
      }
    } catch { /* store optional - never block the live view */ }
  }
  return { ig, fb }
}

// --- Organic social snapshot store: preserve the metrics that vanish once they
// fall outside the Meta/IG API's ~90-day insights window (daily series, and the
// point-in-time followers + demographics). Written daily by social-snapshot.
const socialStore = () => getStore({ name: 'caalano-social', consistency: 'strong' })
async function loadSocialSnap(clientId) { try { return (await socialStore().get(clientId, { type: 'json' })) || null } catch { return null } }
// Lean per-day capture (everything the totals + daily views need), plus the
// point-in-time followers/media count and audience demographics. No heavy media
// bodies - this is the durable, storable core.
async function socialPerDay(soc, from, to, key) {
  const igId = soc.ig, fbo = soc.fbo
  const F = (c, f) => windsorFetch(c, f, from, to, null, key).catch(() => [])
  const demoArr = (rows, nk, sk, cap) => { const out = rows.map((r) => ({ name: r[nk], size: num(r[sk]) })).filter((x) => x.name && x.size).sort((a, b) => b.size - a.size); return cap ? out.slice(0, cap) : out }
  const lastNonNull = (rows, k) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null && rows[i][k] !== '') return num(rows[i][k]); return 0 }
  let ig = null, fb = null
  if (igId) {
    const flt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, igId))
    const [dtv, dins, prof, media, gender, age, country] = await Promise.all([
      F('instagram', ['account_id', 'date', 'views', 'accounts_engaged', 'likes', 'comments', 'shares', 'saves', 'replies', 'profile_links_taps', 'total_interactions']).then(flt),
      F('instagram', ['account_id', 'date', 'reach', 'follower_count']).then(flt),
      F('instagram', ['account_id', 'followers_count', 'follows_count', 'media_count', 'username']).then(flt),
      F('instagram', ['account_id', 'media_id', 'timestamp']).then(flt),
      F('instagram', ['account_id', 'audience_gender_name', 'audience_gender_size']).then(flt),
      F('instagram', ['account_id', 'audience_age_name', 'audience_age_size']).then(flt),
      F('instagram', ['account_id', 'audience_country_name', 'audience_country_size']).then(flt),
    ])
    const perDay = {}; const D = (d) => (perDay[d] = perDay[d] || {})
    for (const r of dtv) { const d = String(r.date || '').slice(0, 10); if (!d) continue; const e = D(d); e.views = (e.views || 0) + num(r.views); e.engaged = (e.engaged || 0) + num(r.accounts_engaged); e.likes = (e.likes || 0) + num(r.likes); e.comments = (e.comments || 0) + num(r.comments); e.shares = (e.shares || 0) + num(r.shares); e.saves = (e.saves || 0) + num(r.saves); e.replies = (e.replies || 0) + num(r.replies); e.linkTaps = (e.linkTaps || 0) + num(r.profile_links_taps); e.interactions = (e.interactions || 0) + num(r.total_interactions) }
    for (const r of dins) { const d = String(r.date || '').slice(0, 10); if (!d) continue; const e = D(d); e.reach = (e.reach || 0) + num(r.reach); e.newFollowers = (e.newFollowers || 0) + num(r.follower_count) }
    for (const m of media) { const d = String(m.timestamp || '').slice(0, 10); if (!d) continue; const e = D(d); e.posts = (e.posts || 0) + 1 }
    const p = prof[0] || {}
    ig = { perDay, profile: { followers: num(p.followers_count), follows: num(p.follows_count), mediaCount: num(p.media_count), username: p.username || null }, demographics: { gender: demoArr(gender, 'audience_gender_name', 'audience_gender_size'), age: demoArr(age, 'audience_age_name', 'audience_age_size'), country: demoArr(country, 'audience_country_name', 'audience_country_size', 8) } }
  }
  if (fbo) {
    const flt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, fbo))
    const [pageRows, postRows] = await Promise.all([
      F('facebook_organic', ['account_id', 'date', 'page_fans', 'page_follows', 'page_impressions', 'page_impressions_organic', 'page_impressions_paid', 'page_impressions_unique', 'page_post_engagements', 'page_views_total', 'page_video_views', 'page_daily_follows', 'page_daily_unfollows']).then(flt),
      F('facebook_organic', ['account_id', 'post_id', 'post_created_time', 'post_reactions_total', 'post_comments_total', 'post_activity_by_action_type_share']).then(flt),
    ])
    const perDay = {}; const D = (d) => (perDay[d] = perDay[d] || {})
    for (const r of pageRows) { const d = String(r.date || '').slice(0, 10); if (!d) continue; const e = D(d); e.impressions = (e.impressions || 0) + num(r.page_impressions); e.impressionsOrganic = (e.impressionsOrganic || 0) + num(r.page_impressions_organic); e.impressionsPaid = (e.impressionsPaid || 0) + num(r.page_impressions_paid); e.reachUnique = (e.reachUnique || 0) + num(r.page_impressions_unique); e.engagements = (e.engagements || 0) + num(r.page_post_engagements); e.pageViews = (e.pageViews || 0) + num(r.page_views_total); e.videoViews = (e.videoViews || 0) + num(r.page_video_views); e.newFollows = (e.newFollows || 0) + num(r.page_daily_follows); e.unfollows = (e.unfollows || 0) + num(r.page_daily_unfollows) }
    for (const r of postRows) { const d = String(r.post_created_time || '').slice(0, 10); if (!d) continue; const e = D(d); e.posts = (e.posts || 0) + 1; e.reactions = (e.reactions || 0) + num(r.post_reactions_total); e.comments = (e.comments || 0) + num(r.post_comments_total); e.shares = (e.shares || 0) + num(r.post_activity_by_action_type_share) }
    fb = { perDay, page: { fans: lastNonNull(pageRows, 'page_fans'), follows: lastNonNull(pageRows, 'page_follows') } }
  }
  return { ig, fb }
}
// Merge a fresh capture into the stored blob (upsert daily by date; stamp today's
// followers + demographics). Bounded to the last ~800 days so it can't grow forever.
function mergeSocialSnap(existing, fresh, today) {
  const out = existing && typeof existing === 'object' ? { ...existing } : {}
  const prune = (obj) => { const ks = Object.keys(obj).sort(); return ks.length > 800 ? Object.fromEntries(ks.slice(ks.length - 800).map((k) => [k, obj[k]])) : obj }
  const side = (name) => {
    const cur = (out[name] && typeof out[name] === 'object') ? out[name] : {}
    const nf = fresh[name]; if (!nf) return cur.daily ? cur : null
    const daily = { ...(cur.daily || {}) }; for (const [d, e] of Object.entries(nf.perDay || {})) daily[d] = e
    const followers = { ...(cur.followers || {}) }
    if (name === 'ig' && nf.profile && (nf.profile.followers || nf.profile.mediaCount)) followers[today] = { followers: nf.profile.followers || 0, follows: nf.profile.follows || 0, mediaCount: nf.profile.mediaCount || 0 }
    if (name === 'fb' && nf.page && nf.page.fans) followers[today] = { fans: nf.page.fans || 0, follows: nf.page.follows || 0 }
    const demographics = { ...(cur.demographics || {}) }
    if (name === 'ig' && nf.demographics && (nf.demographics.gender.length || nf.demographics.age.length || nf.demographics.country.length)) demographics[today] = nf.demographics
    return { daily: prune(daily), followers: prune(followers), demographics: prune(demographics) }
  }
  const ig = side('ig'), fb = side('fb')
  if (ig) out.ig = ig; if (fb) out.fb = fb
  out.updatedAt = today
  return out
}
// Daily snapshot of every social-connected client. First run per client backfills
// ~90 days (whatever the API still returns); later runs roll a 35-day window and
// upsert, so a missed day self-heals. Called by the social-snapshot scheduled fn.
export async function runSocialSnapshots() {
  const key = process.env.WINDSOR_API_KEY
  if (!key) return { ok: false, error: 'WINDSOR_API_KEY not set' }
  const store = socialStore()
  const today = new Date().toISOString().slice(0, 10)
  const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
  const results = []
  for (const [id, soc] of Object.entries(SOCIAL)) {
    if (!soc || (!soc.ig && !soc.fbo)) continue
    try {
      const existing = await store.get(id, { type: 'json' }).catch(() => null)
      const has = existing && ((existing.ig && Object.keys(existing.ig.daily || {}).length) || (existing.fb && Object.keys(existing.fb.daily || {}).length))
      const from = has ? dayStr(35) : dayStr(90)
      const fresh = await socialPerDay(soc, from, today, key)
      const merged = mergeSocialSnap(existing, fresh, today)
      await store.set(id, JSON.stringify(merged))
      results.push({ client: id, ok: true, igDays: merged.ig ? Object.keys(merged.ig.daily || {}).length : 0, fbDays: merged.fb ? Object.keys(merged.fb.daily || {}).length : 0, seeded: !has })
    } catch (e) { results.push({ client: id, ok: false, error: String((e && e.message) || e).slice(0, 140) }) }
  }
  return { ok: true, count: results.length, results }
}

// Lean per-month organic rollup (aggregate metrics only - no media/demographics),
// for the KPI + 6-month trend view. Net followers come from the daily follower
// deltas, so they're historically accurate even though absolute followers is
// "current only". Returns per-platform + a blended summary for one month.
async function socialMonth(soc, from, to, key) {
  const F = (c, f) => windsorFetch(c, f, from, to, null, key).catch(() => [])
  const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0)
  let ig = null, fb = null
  if (soc.ig) {
    const igFilt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,soc.ig))
    const [dtv, dins, media] = await Promise.all([
      F('instagram', ['account_id', 'date', 'views', 'accounts_engaged', 'likes', 'comments', 'shares', 'saves', 'replies', 'profile_links_taps', 'total_interactions']).then(igFilt),
      F('instagram', ['account_id', 'date', 'reach', 'follower_count']).then(igFilt),
      F('instagram', ['account_id', 'media_id', 'timestamp']).then(igFilt),
    ])
    const likes = sum(dtv, 'likes'), comments = sum(dtv, 'comments'), shares = sum(dtv, 'shares'), saves = sum(dtv, 'saves')
    ig = { reach: sum(dins, 'reach'), views: sum(dtv, 'views'), engaged: sum(dtv, 'accounts_engaged'), likes, comments, shares, saves, replies: sum(dtv, 'replies'), linkTaps: sum(dtv, 'profile_links_taps'), interactions: sum(dtv, 'total_interactions'), engagement: likes + comments + shares + saves, netFollowers: sum(dins, 'follower_count'), posts: media.filter((m) => m.media_id).length }
  }
  if (soc.fbo) {
    const fbFilt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,soc.fbo))
    // ORGANIC-only fields (page_impressions_organic / _organic_unique / video
    // views organic) so paid-boosted impressions & reach are never counted. The
    // organic-reach + organic-video pulls are isolated so, if a field is
    // unavailable, only those two zero out rather than the whole month failing.
    const [pageRows, orgRows, postRows] = await Promise.all([
      F('facebook_organic', ['account_id', 'date', 'page_impressions_organic', 'page_post_engagements', 'page_daily_follows', 'page_daily_unfollows']).then(fbFilt),
      F('facebook_organic', ['account_id', 'date', 'page_impressions_organic_unique', 'page_video_views_organic']).then(fbFilt),
      F('facebook_organic', ['account_id', 'post_id', 'post_created_time']).then(fbFilt),
    ])
    fb = { impressions: sum(pageRows, 'page_impressions_organic'), reachUnique: sum(orgRows, 'page_impressions_organic_unique'), engagements: sum(pageRows, 'page_post_engagements'), videoViews: sum(orgRows, 'page_video_views_organic'), netFollowers: sum(pageRows, 'page_daily_follows') - sum(pageRows, 'page_daily_unfollows'), posts: postRows.filter((p) => p.post_id).length }
  }
  const blend = {
    netFollowers: ((ig && ig.netFollowers) || 0) + ((fb && fb.netFollowers) || 0),
    reach: ((ig && ig.reach) || 0) + ((fb && fb.reachUnique) || 0),
    views: ((ig && ig.views) || 0) + ((fb && fb.videoViews) || 0),
    impressions: ((fb && fb.impressions) || 0),
    engagement: ((ig && ig.engagement) || 0) + ((fb && fb.engagements) || 0),
    likes: ((ig && ig.likes) || 0), comments: ((ig && ig.comments) || 0),
    posts: ((ig && ig.posts) || 0) + ((fb && fb.posts) || 0),
  }
  blend.er = blend.reach ? Math.round((blend.engagement / blend.reach) * 1000) / 10 : null
  return { ig, fb, blend }
}

// Viewer (client) tab enforcement. A viewer may only reach the windsor requests
// that the tabs allocated to them actually fetch - every other scope/channel
// (agency tools, report generation, diagnostics, and tabs they weren't given) is
// denied even for a client they can otherwise see. Keyed `scope:<x>` (the scope
// endpoints) or `channel:<x>` (the bare channel fetches: blend/meta/google). The
// value is the set of tabs that legitimately issue it - a viewer passes if they
// hold at least one. Anything not listed here is admin/agency-only for viewers.
const VIEWER_TABS_ALL = ['overall', 'users', 'meta', 'google', 'cohorts', 'forms', 'location', 'appts', 'timing', 'optlog']
const VIEWER_REQ_TABS = {
  'channel:blend': ['overall'],
  'channel:meta': ['meta'],
  'channel:google': ['google'],
  'scope:health': ['overall'],
  'scope:ccdrill': ['overall'],
  'scope:users': ['overall', 'users'],
  'scope:forms': ['meta', 'forms', 'location'],
  'scope:cohorts': ['cohorts'],
  'scope:appts': ['appts'],
  'scope:speed': ['timing'],
  'scope:speedscan': ['timing'],
  // Contact-notes drill - reachable from several tabs' drill-downs; allow for any.
  'scope:oppnotes': VIEWER_TABS_ALL,
  // Key-event people drill - reachable from the Meta/Google/Caalano360 funnels.
  'scope:keypeople': VIEWER_TABS_ALL,
}
function viewerAllowed(me, scope, channel) {
  // Attribution loads at the workspace shell on every tab, so it's always allowed
  // for a client the viewer can see (the client check runs separately).
  if (channel === 'attribution') return true
  // Monthly Reports: a viewer with the reports grant may reach the monthlysnap
  // scope. The handler itself restricts them to PUBLISHED reads (no drafts, no
  // publishing) for the client they're allowed to see.
  if (scope === 'monthlysnap') return me.reports === true
  const kkey = scope ? 'scope:' + scope : (channel ? 'channel:' + channel : null)
  const permit = kkey && VIEWER_REQ_TABS[kkey]
  if (!permit) return false // agency/admin scope, or an unmapped request → deny
  const myTabs = Array.isArray(me.tabs) ? me.tabs : VIEWER_TABS_ALL
  return permit.some((t) => myTabs.includes(t))
}

// Overlay closed-basis (won-by-won-date) figures onto a created-basis CRM board.
// Only Won / revenue / avg-won-value / close-rate flip; leads, open, lost, the
// funnel steps and stages stay created-basis. wonClosed (from wonInPeriod) gives
// total + per-pipeline + per-user closed figures; a level with no closed wins is
// zeroed. Per-pipeline-per-user isn't in wonClosed, so that deep table keeps its
// created basis (noted in the UI).
function applyClosedBasis(crm, wc) {
  const setTot = (t, w) => { if (!t) return; t.won = w ? w.won : 0; t.revenue = w ? w.revenue : 0; t.avgWonValue = w ? w.avgValue : 0; const denom = t.won + (t.lost || 0) + (t.abandoned || 0); t.closeRate = denom ? +((100 * t.won) / denom).toFixed(1) : 0 }
  setTot(crm.totals, wc.total)
  for (const p of crm.pipelines || []) { const w = wc.byPipeline ? wc.byPipeline[p.id] : null; if (p.funnel) p.funnel.won = w ? w.won : 0; setTot(p.totals, w) }
  const setUser = (u, w) => { u.won = w ? w.won : 0; u.wonValue = w ? w.revenue : 0; u.convRate = u.leads ? +((100 * u.won) / u.leads).toFixed(1) : 0 }
  for (const u of crm.byUser || []) setUser(u, wc.byUser ? wc.byUser[u.id] : null)
}
// Same overlay for a Caalano360 blend payload (its CRM sub-objects use won /
// revenue / avgValue). Account + per-pipeline + per-user headline flip; the deep
// per-user-per-pipeline drill and the prev-period delta stay created-basis.
function applyClosedBasisBlend(blend, wc) {
  if (!blend || !wc) return
  const setC = (crm, w) => { if (!crm) return; crm.won = w ? w.won : 0; crm.revenue = w ? w.revenue : 0; crm.avgValue = w ? w.avgValue : 0 }
  setC(blend.crm, wc.total)
  for (const p of blend.pipelines || []) setC(p.crm, wc.byPipeline ? wc.byPipeline[p.id] : null)
  for (const u of blend.users || []) setC(u.crm, wc.byUser ? wc.byUser[u.id] : null)
}

// ---------------------------------------------------------------------------
// Server-side result cache + reliability telemetry
// ---------------------------------------------------------------------------
// The heavy client-scoped views (Users, CRM, Meta, Google, appointments…) each
// rebuild from Windsor / GoHighLevel on every request - multi-second work that
// bumps the ~10s function ceiling and 502s when an upstream is slow. A short
// blob cache lets repeat loads (tab switches, teammates, the same client
// reopened) return in <1s and, crucially, lets a rebuild that fails fall back
// to the last good payload instead of an error. Access control runs BEFORE the
// cache is read, so a hit can never leak across accounts.
const RESULT_TTL_MS = 10 * 60 * 1000            // serve a cached payload fresh for 10 min
const STALE_ON_ERROR_MS = 6 * 60 * 60 * 1000    // on a rebuild failure, fall back to a payload up to 6h old
const cacheStore = () => getStore({ name: 'caalano-cache', consistency: 'strong' })
// Scopes safe to cache: client-scoped, GET, identical for every authorised
// caller. (Agency-wide aggregates are filtered per-caller, so they're excluded.)
const CACHEABLE_SCOPES = new Set(['users', 'ccdrill', 'speed', 'appts', 'cohorts', 'forms', 'weekly', 'ovrow', 'health', 'updateextra', 'anomalies', 'social', 'socialtrend', 'stagetiming', 'usercalls'])
const CACHEABLE_CHANNELS = new Set(['meta', 'google', 'attribution', 'blend'])
// Agency-wide scopes that carry NO client param. They ARE the slowest first-load
// calls (whole-roster Windsor + GHL fan-out), so caching them is the single
// biggest load-time win. Safe to cache only for UNRESTRICTED callers (no
// per-caller filtering) - the gate below enforces that, and each builder already
// returns cache=!filtered, so a restricted caller still rebuilds live.
const CACHEABLE_SCOPES_NOCLIENT = new Set(['agency', 'coverage'])
async function readResultCache(key) { try { return await cacheStore().get(key, { type: 'json' }) } catch { return null } }
function writeResultCache(key, payload) { try { cacheStore().setJSON(key, { at: Date.now(), payload }).catch(() => {}) } catch { /* non-fatal */ } }
function cacheKeyFrom(url) {
  const p = new URLSearchParams(url.search)
  p.delete('_r'); p.delete('debug'); p.delete('nonce')
  const entries = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)))
  return 'v1:' + encodeURIComponent(entries.map(([k, v]) => `${k}=${v}`).join('&'))
}

// Reliability log - a capped, per-day ring buffer of failures + slow builds so we
// can see WHICH scope/client/upstream is unreliable and drive those toward live
// (no cache). Blobs have no atomic append, so we read-modify-write the day's
// bucket; failures are rare enough that the occasional lost concurrent write is
// an acceptable trade for zero extra infrastructure. Never throws into the
// request path.
const diagStore = () => getStore({ name: 'caalano-diag', consistency: 'strong' })
const DIAG_DAY_CAP = 400
function diagDayKey(d) { return 'diag:' + new Date(d).toISOString().slice(0, 10) }
async function diagLog(entry) {
  try {
    const now = Date.now()
    const dayKey = diagDayKey(now)
    const store = diagStore()
    const cur = (await store.get(dayKey, { type: 'json' }).catch(() => null)) || []
    cur.push({ t: now, ...entry })
    const trimmed = cur.length > DIAG_DAY_CAP ? cur.slice(cur.length - DIAG_DAY_CAP) : cur
    await store.setJSON(dayKey, trimmed)
    // Maintain a small index of which days have logs, so the viewer can page back.
    const idx = (await store.get('diag:index', { type: 'json' }).catch(() => null)) || []
    const day = dayKey.slice(5)
    if (!idx.includes(day)) { idx.push(day); idx.sort().reverse(); await store.setJSON('diag:index', idx.slice(0, 60)) }
  } catch { /* diagnostics must never break the request */ }
}

export default async (req) => {
  const _t0 = Date.now()
  const url = new URL(req.url)
  const client = url.searchParams.get('client')
  const scope = url.searchParams.get('scope')
  const channel = url.searchParams.get('channel') || 'meta'
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to'); const preset = url.searchParams.get('preset')
  const debug = url.searchParams.get('debug')
  const key = process.env.WINDSOR_API_KEY
  // Only cache successful, non-debug responses. Errors and debug must never be
  // cached, or a transient failure gets replayed by the CDN.
  // SECURITY: when the multi-user login system is active (AUTH_SECRET set), the
  // per-caller access checks below (canSeeClient / restrictTo) run INSIDE this
  // function - a shared-CDN cache hit would skip them and could replay one
  // caller's authorised payload to another (cross-client leak). So cache only in
  // the browser (`private`) when auth is on; keep shared-CDN caching (`public`)
  // only in single-user mode where every caller has identical access.
  const cacheScope = process.env.AUTH_SECRET ? 'private' : 'public'
  // Populated after access control (below) for cacheable client-scoped requests.
  let _ckey = null       // blob cache key for this request
  let _staleHit = null   // last cached payload (any age) - for stale-on-error fallback
  const mkResponse = (obj, status, cache) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': cache ? `${cacheScope}, max-age=600` : 'no-store' } })
  const json = async (obj, status = 200, cache = false) => {
    const softErr = status === 200 && obj && obj.error
    // Stale-on-error: a transient rebuild failure (upstream timeout / 5xx that the
    // branch caught and returned as a 200 { error }) falls back to the last good
    // payload instead of surfacing an error to the user. Only for cacheable
    // requests that actually have a recent-enough cached copy. The diag write is
    // awaited so the failure is durably recorded before the lambda can freeze.
    if (_ckey && _staleHit && softErr && (Date.now() - _staleHit.at) < STALE_ON_ERROR_MS) {
      await diagLog({ sev: 'error-stale', scope: scope || `channel:${channel}`, client, ms: Date.now() - _t0, error: String(obj.error).slice(0, 240), ageMs: Date.now() - _staleHit.at })
      return mkResponse({ ..._staleHit.payload, _cache: { age: Math.round((Date.now() - _staleHit.at) / 1000), stale: true } }, 200, true)
    }
    if (softErr) await diagLog({ sev: 'error', scope: scope || `channel:${channel}`, client, ms: Date.now() - _t0, error: String(obj.error).slice(0, 240) })
    // Write-through: cache a freshly-built success, and flag builds that came close
    // to the timeout so we can see which scopes to make live-safe first.
    if (_ckey && cache && status === 200 && obj && !obj.error && !obj._cache) {
      writeResultCache(_ckey, obj)
      const ms = Date.now() - _t0
      if (ms > 6000) await diagLog({ sev: 'slow', scope: scope || `channel:${channel}`, client, ms })
    }
    return mkResponse(obj, status, cache)
  }

  if (!key) return json({ error: 'WINDSOR_API_KEY not set' }, 500)
  // Merge any UI-added clients (Settings -> Add client) into the registry so
  // they're recognised across every scope. Mutates the shared object; a removed
  // client clears on the next cold start.
  try { Object.assign(CLIENTS, await customClients()); for (const id of await deletedClients()) delete CLIENTS[id] } catch { /* non-fatal */ }

  // Access control - only active when the multi-user login system is enabled
  // (AUTH_SECRET set). A signed-in caller is checked against their client
  // allocation; a null caller means the trusted Basic-Auth break-glass path,
  // which keeps full access. Client-scoped requests must name an allowed
  // account; agency-wide requests are off-limits to client (viewer) accounts.
  const AUTH_SECRET = process.env.AUTH_SECRET
  const me = AUTH_SECRET ? await currentUser(req, AUTH_SECRET).catch(() => null) : null
  // Clients marked "Super-Admin only" in Settings are hidden from everyone who
  // isn't a superadmin. A null caller is the trusted Basic-Auth / legacy path
  // (owner) and a superadmin both see everything, so we only load + apply the
  // set for a non-super signed-in caller.
  let restrictedSet = new Set()
  if (me && me.role !== 'superadmin') {
    try {
      const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
      if (s && s.restricted) for (const id in s.restricted) if (s.restricted[id]) restrictedSet.add(id)
    } catch { /* fail open to the OTHER checks below; a restricted client still needs canSeeClient */ }
  }
  if (me) {
    if (client && !canSeeClient(me, client)) return json({ error: 'You don’t have access to this account.' }, 403)
    if (client && restrictedSet.has(client)) return json({ error: 'You don’t have access to this account.' }, 403)
    if (!client && me.role === 'viewer') return json({ error: 'No access to agency-wide data.' }, 403)
    // Viewers are further limited to the exact scopes their allocated tabs fetch -
    // so a client can never reach an unassigned view, an agency tool (creative
    // cockpit, report generation, diagnostics) or another view's data by crafting
    // a direct request, even for a client they're allowed to see.
    if (client && me.role === 'viewer' && !viewerAllowed(me, scope, channel)) return json({ error: 'This view isn’t available on your account.' }, 403)
  }
  // Restricted staff (a User limited to specific accounts) only ever see their
  // own accounts inside agency-wide aggregates - enforced server-side so the
  // raw response can't leak other clients. null = no restriction (admin / staff
  // with all-accounts / the trusted Basic-Auth path). `canView` also drops any
  // Super-Admin-only client for a non-super caller.
  const restrictTo = me && me.role === 'user' && me.allClients === false ? new Set(me.clients || []) : null
  const canView = (id) => (!restrictTo || restrictTo.has(id)) && !restrictedSet.has(id)
  const filtered = !!restrictTo || restrictedSet.size > 0
  const pickAllowed = (obj) => filtered ? Object.fromEntries(Object.entries(obj || {}).filter(([id]) => canView(id))) : (obj || {})

  // ---- Server result cache (fresh-hit fast path) ---------------------------
  // Now that access control has run, a cache hit for this client-scoped request
  // is safe to serve. `_ckey` also arms the write-through + stale-on-error paths
  // inside json() above. The Refresh button (which appends `_r=<nonce>`) bypasses
  // the fresh window so a manual refresh is always fully live.
  const _isCacheable = req.method === 'GET' && !debug && !restrictTo && restrictedSet.size === 0 &&
    ((client && (CACHEABLE_SCOPES.has(scope) || (!scope && CACHEABLE_CHANNELS.has(channel)))) ||
     (!client && CACHEABLE_SCOPES_NOCLIENT.has(scope)))
  if (_isCacheable) {
    _ckey = cacheKeyFrom(url)
    _staleHit = await readResultCache(_ckey)
    const bust = !!url.searchParams.get('_r')
    if (_staleHit && !bust && (Date.now() - _staleHit.at) < RESULT_TTL_MS) {
      return json({ ..._staleHit.payload, _cache: { age: Math.round((Date.now() - _staleHit.at) / 1000) } }, 200, true)
    }
  }

  // ---- Reliability log reader (staff/admin) --------------------------------
  // Reads the failure/slow-build ring buffer so the Settings → Reliability panel
  // can show what's failing, where, and how close to the timeout each scope runs.
  if (scope === 'diaglog') {
    if (me && me.role !== 'superadmin') return json({ error: 'Not authorised.' }, 403)
    try {
      const store = diagStore()
      const idx = (await store.get('diag:index', { type: 'json' }).catch(() => null)) || []
      const days = idx.slice(0, Math.max(1, Math.min(14, Number(url.searchParams.get('days')) || 3)))
      let entries = []
      for (const day of days) { const rows = await store.get(`diag:${day}`, { type: 'json' }).catch(() => null); if (Array.isArray(rows)) entries = entries.concat(rows) }
      entries.sort((a, b) => b.t - a.t)
      const summary = {}
      for (const e of entries) { const k = `${e.sev}|${e.scope}`; summary[k] = (summary[k] || 0) + 1 }
      return json({ scope: 'diaglog', days, count: entries.length, summary, entries: entries.slice(0, 400) })
    } catch (e) { return json({ scope: 'diaglog', error: String(e.message || e).slice(0, 200) }) }
  }
  // Client-side failure beacon: the browser POSTs a failure (502 / timeout /
  // parse error it saw) so the same log captures browser-visible breakages the
  // function itself never got to record.
  if (scope === 'clientlog' && req.method === 'POST') {
    try { const b = await req.json().catch(() => ({})); await diagLog({ sev: 'client', scope: String(b.scope || 'unknown').slice(0, 60), client: b.client || client || null, ms: Number(b.ms) || null, error: String(b.error || '').slice(0, 240) }) } catch { /* ignore */ }
    return json({ ok: true })
  }

  // ---- Monthly Report ------------------------------------------------------
  // Frozen monthly client reports. The deck itself is assembled on the client
  // from the existing meta/google/blend/attribution scopes plus the two helpers
  // below (won-by-date + 6-month trend), then POSTed back here to freeze so a
  // report you export or reopen never shifts as live data updates.
  //
  // WON ATTRIBUTION: wins/revenue are captured by WON DATE (status-change to
  // "won"), not lead-created date - so a lead created in an earlier month but
  // closed in the report month counts in the report month. See wonInPeriod().
  const monthlyStore = () => getStore({ name: 'caalano-monthly', consistency: 'strong' })
  const monthKey = (cl, m) => `${cl}:${m}`

  if (url.searchParams.get('scope') === 'monthlysnap') {
    if (!client) return json({ error: 'client required' }, 400)
    const store = monthlyStore()
    const idxKey = `index:${client}`      // months that have been generated (staff)
    const metaKey = `meta:${client}`      // per-month headers: savedAt/publishedAt/etc
    const pubIdxKey = `pubindex:${client}` // months a client may see (published)
    const pubKey = (m) => `pub:${client}:${m}` // frozen PUBLISHED copy (client-facing)
    const isViewer = !!(me && me.role === 'viewer')
    const loadMeta = async () => { const m = await store.get(metaKey, { type: 'json' }).catch(() => null); return (m && typeof m === 'object') ? m : {} }

    // ---- Client (viewer): PUBLISHED reports only, for a client they can see ----
    if (isViewer) {
      if (req.method === 'POST') return json({ error: 'Not authorised.' }, 403)
      if (url.searchParams.get('list')) {
        const pubIdx = await store.get(pubIdxKey, { type: 'json' }).catch(() => null)
        const months = Array.isArray(pubIdx) ? pubIdx : []
        const meta = await loadMeta()
        // Whether the client may download the PDF is an agency-wide, admin-toggled
        // flag (default OFF). Read it server-side so a viewer can't force it on.
        const settings = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }).catch(() => null)
        const downloadAllowed = !!(settings && settings.pdfdl && settings.pdfdl[client])
        return json({ months: months.map((m) => ({ month: m, publishedAt: (meta[m] && meta[m].publishedAt) || null })), downloadAllowed })
      }
      const month = url.searchParams.get('month')
      if (!month) return json({ error: 'month required' }, 400)
      const pub = await store.get(pubKey(month), { type: 'json' }).catch(() => null)
      return json(pub ? { saved: true, published: true, month, report: pub.report, publishedAt: pub.publishedAt, publishedBy: pub.publishedBy } : { saved: false })
    }

    // ---- Staff (admin / user / owner): generate, list-with-status, publish ----
    if (req.method === 'POST') {
      let body; try { body = await req.json() } catch { body = null }
      const action = body && body.action
      // Publish / unpublish an already-generated month.
      if (action === 'publish' || action === 'unpublish') {
        const m = body && body.month; if (!m) return json({ error: 'month required' }, 400)
        const meta = await loadMeta()
        let pubIdx = await store.get(pubIdxKey, { type: 'json' }).catch(() => null); if (!Array.isArray(pubIdx)) pubIdx = []
        const rec = await store.get(monthKey(client, m), { type: 'json' }).catch(() => null)
        if (action === 'publish') {
          if (!rec || !rec.report) return json({ error: 'Generate the report before publishing.' }, 400)
          const at = new Date().toISOString(), by = (me && (me.name || me.email)) || null
          await store.setJSON(pubKey(m), { client, month: m, report: rec.report, publishedAt: at, publishedBy: by, savedAt: rec.savedAt || null })
          meta[m] = { ...(meta[m] || {}), savedAt: rec.savedAt || (meta[m] && meta[m].savedAt) || null, publishedAt: at, publishedBy: by }
          await store.setJSON(metaKey, meta)
          if (!pubIdx.includes(m)) { pubIdx.push(m); pubIdx.sort().reverse(); await store.setJSON(pubIdxKey, pubIdx) }
          return json({ ok: true, month: m, published: true, publishedAt: at, publishedBy: by })
        }
        await store.delete(pubKey(m)).catch(() => {})
        pubIdx = pubIdx.filter((x) => x !== m); await store.setJSON(pubIdxKey, pubIdx)
        meta[m] = { ...(meta[m] || {}), publishedAt: null, publishedBy: null }; await store.setJSON(metaKey, meta)
        return json({ ok: true, month: m, published: false })
      }
      // Default POST = generate/freeze a month (does NOT touch the published copy -
      // a re-generated report stays on the previously-published version for clients
      // until it's re-published).
      if (!body || !body.month || !body.report) return json({ error: 'month + report required' }, 400)
      const at = new Date().toISOString(), by = (me && (me.name || me.email)) || null
      const meta = await loadMeta()
      const rec = { client, month: body.month, report: body.report, savedAt: at, savedBy: by }
      await store.setJSON(monthKey(client, body.month), rec)
      meta[body.month] = { ...(meta[body.month] || {}), savedAt: at, savedBy: by }
      await store.setJSON(metaKey, meta)
      let idx = await store.get(idxKey, { type: 'json' }).catch(() => null); if (!Array.isArray(idx)) idx = []
      if (!idx.includes(body.month)) { idx.push(body.month); idx.sort().reverse(); await store.setJSON(idxKey, idx) }
      return json({ ok: true, savedAt: at, savedBy: by, publishedAt: (meta[body.month] && meta[body.month].publishedAt) || null })
    }
    // Staff list: every generated month with its saved + published status (from the
    // light meta header, so we never read the heavy report blobs to build the list).
    if (url.searchParams.get('list')) {
      const idx = await store.get(idxKey, { type: 'json' }).catch(() => null)
      const months = Array.isArray(idx) ? idx : []
      const meta = await loadMeta()
      const rows = months.map((m) => { const h = meta[m] || {}; return { month: m, savedAt: h.savedAt || null, savedBy: h.savedBy || null, publishedAt: h.publishedAt || null, publishedBy: h.publishedBy || null, published: !!h.publishedAt, edited: !!(h.publishedAt && h.savedAt && h.savedAt > h.publishedAt) } })
      return json({ months, rows })
    }
    const month = url.searchParams.get('month')
    if (!month) return json({ error: 'month required' }, 400)
    const rec = await store.get(monthKey(client, month), { type: 'json' }).catch(() => null)
    const meta = await loadMeta(); const h = meta[month] || {}
    return json(rec ? { saved: true, ...rec, published: !!h.publishedAt, publishedAt: h.publishedAt || null, publishedBy: h.publishedBy || null, edited: !!(h.publishedAt && rec.savedAt && rec.savedAt > h.publishedAt) } : { saved: false })
  }

  // Realised wins for the report month, attributed by WON DATE (regardless of
  // when the lead came in). Account total + per-user + per-channel.
  if (url.searchParams.get('scope') === 'monthlywon') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    if (!cc.ghl) return json({ won: null, connected: false })
    if (!(await isConnected().catch(() => false))) return json({ won: null, connected: false, needsSetup: true })
    try { return json({ won: await wonInPeriod(cc.ghl, from, to), period: { from, to } }, 200) }
    catch (e) { return json({ won: null, error: String(e.message || e) }, 200) }
  }

  // Organic social (Instagram + Facebook Page). `list` returns the client ids
  // that have an organic profile connected, for the dashboard's dropdown.
  if (url.searchParams.get('scope') === 'social') {
    if (url.searchParams.get('list')) {
      // Only list clients whose organic profile is actually returning data from
      // Windsor right now - so removing a connector drops it from the dropdown.
      // A light probe (followers / page fans) per client; falls back to the full
      // set if every probe fails (transient), so the dropdown never goes empty.
      const ids = Object.keys(SOCIAL).filter((id) => canView(id))
      const live = async (soc) => {
        const jobs = []
        if (soc.ig) jobs.push(windsorFetch('instagram', ['account_id', 'followers_count', 'media_count'], null, null, 'last_30d', key).then((rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,soc.ig))).catch(() => []))
        if (soc.fbo) jobs.push(windsorFetch('facebook_organic', ['account_id', 'page_fans'], null, null, 'last_30d', key).then((rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,soc.fbo))).catch(() => []))
        const res = await Promise.all(jobs)
        return res.some((rows) => rows && rows.some((r) => num(r.followers_count) || num(r.media_count) || num(r.page_fans)))
      }
      const connected = (await Promise.all(ids.map(async (id) => ((await live(SOCIAL[id]).catch(() => false)) ? id : null)))).filter(Boolean)
      return json({ clients: connected.length ? connected : ids }, 200, true)
    }
    const soc = SOCIAL[client]
    if (!soc) return json({ ig: null, fb: null, connected: false })
    try { const data = await buildSocial(soc, from, to, key, client); return json({ client, period: { from, to }, ...data }, 200, true) }
    catch (e) { return json({ ig: null, fb: null, error: String(e.message || e) }, 502) }
  }

  // Month-by-month organic rollups (default last 6 complete months, anchored on
  // the `to` month or the current month) for the KPI panel + rolling trend graphs.
  if (url.searchParams.get('scope') === 'socialtrend') {
    const soc = SOCIAL[client]
    if (!soc) return json({ months: [], connected: false })
    const n = Math.max(1, Math.min(12, parseInt(url.searchParams.get('months') || '6', 10)))
    // Rolling window - always ends on the current month so the absolute-follower
    // reconstruction (from today's count back through the monthly net deltas) is exact.
    const anchor = new Date()
    let y = anchor.getUTCFullYear(), mo = anchor.getUTCMonth() // 0-based
    const list = []
    for (let i = 0; i < n; i++) {
      const mFrom = `${y}-${String(mo + 1).padStart(2, '0')}-01`
      const end = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
      const mTo = `${y}-${String(mo + 1).padStart(2, '0')}-${String(end).padStart(2, '0')}`
      const label = new Date(Date.UTC(y, mo, 1)).toLocaleString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      list.push({ key: `${y}-${String(mo + 1).padStart(2, '0')}`, from: mFrom, to: mTo, label })
      mo--; if (mo < 0) { mo = 11; y-- }
    }
    list.reverse() // oldest → newest for charting
    try {
      // Current absolute follower counts (per platform) - the anchor for
      // reconstructing each month's total followers (start → end).
      let curIg = 0, curFb = 0
      if (soc.ig) { const r = await windsorFetch('instagram', ['account_id', 'followers_count'], null, null, 'last_30d', key).then((rows) => rows.filter((x) => !x.account_id || norm(x.account_id) === norm(soc.ig))).catch(() => []); curIg = Math.max(0, ...r.map((x) => num(x.followers_count)), 0) }
      if (soc.fbo) { const r = await windsorFetch('facebook_organic', ['account_id', 'page_fans'], null, null, 'last_30d', key).then((rows) => rows.filter((x) => !x.account_id || norm(x.account_id) === norm(soc.fbo))).catch(() => []); curFb = Math.max(0, ...r.map((x) => num(x.page_fans)), 0) }
      const curTotal = curIg + curFb
      const months = await Promise.all(list.map((m) => socialMonth(soc, m.from, m.to, key).then((d) => ({ month: m.key, label: m.label, ig: d.ig, fb: d.fb, ...d.blend }))))
      // Walk newest → oldest: end-of-latest ≈ today's count; each earlier month's
      // end is the next month's start (end minus that month's net gain). Per platform + blended.
      let rIg = curIg, rFb = curFb, rAll = curTotal
      for (let i = months.length - 1; i >= 0; i--) {
        const m = months[i]
        m.followersEnd = rAll; m.followersStart = Math.max(0, rAll - (m.netFollowers || 0)); rAll = m.followersStart
        if (m.ig) { m.ig.followersEnd = rIg; m.ig.followersStart = Math.max(0, rIg - (m.ig.netFollowers || 0)); rIg = m.ig.followersStart }
        if (m.fb) { m.fb.followersEnd = rFb; m.fb.followersStart = Math.max(0, rFb - (m.fb.netFollowers || 0)); rFb = m.fb.followersStart }
      }
      // Facebook paid vs organic new followers. Windsor flattens Facebook's
      // paid/non-paid fan-add breakdown into suffixed fields; names vary, so probe
      // a few candidates over the whole window (each returns daily rows we bucket by
      // month - no per-month calls) and fall back to total−paid where needed.
      let followerSplitField = null
      if (soc.fbo) {
        const fbFilt = (rows) => rows.filter((x) => !x.account_id || norm(x.account_id) === norm(soc.fbo))
        const w0 = list[0].from, w1 = list[list.length - 1].to
        const probe = async (cands) => {
          for (const f of cands) {
            const rows = await windsorFetch('facebook_organic', ['account_id', 'date', f], w0, w1, null, key).then(fbFilt).catch(() => null)
            if (rows && rows.some((r) => r[f] != null)) return { field: f, rows }
          }
          return null
        }
        const pd = await probe(['page_fan_adds_by_paid_non_paid_unique_paid', 'page_fan_adds_by_paid_unique', 'page_paid_fan_adds'])
        const og = await probe(['page_fan_adds_by_paid_non_paid_unique_unpaid', 'page_fan_adds_by_paid_non_paid_unique_organic', 'page_organic_fan_adds'])
        if (pd || og) {
          const byMonth = (probeRes) => { const map = {}; if (probeRes) for (const r of probeRes.rows) { const mk = String(r.date || '').slice(0, 7); map[mk] = (map[mk] || 0) + num(r[probeRes.field]) } return map }
          const paidM = byMonth(pd), orgM = byMonth(og)
          for (const m of months) {
            if (!m.fb) continue
            let paid = pd ? (paidM[m.month] || 0) : null
            let organic = og ? (orgM[m.month] || 0) : null
            const total = m.fb.netFollowers
            if (paid != null && organic == null && total != null) organic = Math.max(0, total - paid)
            if (organic != null && paid == null && total != null) paid = Math.max(0, total - organic)
            m.fb.followerSource = { paid: paid || 0, organic: organic || 0, known: true }
          }
          followerSplitField = (pd && pd.field) || (og && og.field)
        }
      }
      return json({ client, months, currentFollowers: curTotal, currentIg: curIg, currentFb: curFb, followerSplitField, hasIg: !!soc.ig, hasFb: !!soc.fbo }, 200, true)
    } catch (e) { return json({ months: [], error: String(e.message || e) }, 200) }
  }

  // Public social accounts available in Windsor (the competitor profiles you've
  // added), so each competitor can be mapped to a Windsor account in the UI.
  // Tries the public connector slug(s); override with ?ig= / ?fb=.
  if (url.searchParams.get('scope') === 'socialaccounts') {
    if (me && me.role === 'viewer') return json({ error: 'not allowed' }, 403)
    const igSlugs = (url.searchParams.get('ig') || 'instagram_public').split(',').map((s) => s.trim()).filter(Boolean)
    const fbSlugs = (url.searchParams.get('fb') || 'facebook_public').split(',').map((s) => s.trim()).filter(Boolean)
    // Prefer the profile display name (e.g. "JJ Pools Brisbane") for the label,
    // falling back to the handle/username. profile_name/profile_username exist on
    // instagram_public; the fallback field sets cover connectors that lack them.
    const tryFields = [['account_id', 'account_name', 'profile_name', 'profile_username'], ['account_id', 'account_name', 'username'], ['account_id', 'account_name'], ['account_id']]
    const pull = async (slugs) => {
      for (const s of slugs) for (const f of tryFields) {
        try {
          const rows = await windsorFetch(s, f, null, null, 'last_90d', key)
          if (rows && rows.length) { const m = new Map(); for (const r of rows) { const id = r.account_id; if (!id) continue; if (!m.has(norm(id))) { const handle = r.profile_username || r.username || r.account_name || String(id); m.set(norm(id), { id, name: r.profile_name || r.account_name || handle, handle }) } } return { connector: s, accounts: [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 200) } }
        } catch { /* try next field set / slug */ }
      }
      return { connector: null, accounts: [] }
    }
    const [ig, fb] = await Promise.all([pull(igSlugs), pull(fbSlugs)])
    return json({ ig, fb }, 200)
  }

  // One competitor's public Instagram summary (followers + public posts). Reach /
  // impressions are private, so engagement rate is estimated from likes+comments.
  if (url.searchParams.get('scope') === 'competitor') {
    if (me && me.role === 'viewer') return json({ error: 'not allowed' }, 403)
    const connector = url.searchParams.get('connector') || 'instagram_public'
    const account = url.searchParams.get('account')
    if (!account) return json({ error: 'account required' }, 400)
    const filt = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,account))
    const safe = async (variants, pre) => { for (const ff of variants) { try { const rows = await windsorFetch(connector, ff, pre ? null : from, pre ? null : to, pre || null, key); return filt(rows) } catch { /* try simpler field set */ } } return [] }
    try {
      // Public IG connector field names differ from the owned `instagram` one:
      // profile_followers_count / profile_media_count / profile_username (user_info
      // table) and media_timestamp for post date (media_info table).
      const prof = (await safe([['account_id', 'profile_username', 'profile_followers_count', 'profile_media_count'], ['account_id', 'profile_followers_count']], 'last_30d'))[0] || {}
      const media = await safe([
        ['account_id', 'media_id', 'media_timestamp', 'media_type', 'media_product_type', 'media_caption', 'media_permalink', 'media_url', 'media_thumbnail_url', 'media_like_count', 'media_comments_count'],
        ['account_id', 'media_id', 'media_timestamp', 'media_type', 'media_like_count', 'media_comments_count'],
        ['account_id', 'media_id', 'media_timestamp', 'media_like_count', 'media_comments_count'],
      ])
      const followers = num(prof.profile_followers_count)
      // For images/carousels the still lives in media_url; videos/reels expose
      // media_thumbnail_url. Format label prefers the surface (REELS/FEED/STORY).
      const perEr = (eng) => (followers ? Math.round((eng / followers) * 1000) / 10 : null)
      const posts = media.map((m) => { const likes = num(m.media_like_count), comments = num(m.media_comments_count), engagement = likes + comments; return { id: m.media_id, date: String(m.media_timestamp || '').slice(0, 10), type: m.media_product_type || m.media_type || null, mediaType: m.media_type || null, caption: String(m.media_caption || '').replace(/\s+/g, ' ').slice(0, 160), permalink: m.media_permalink || null, thumb: m.media_thumbnail_url || m.media_url || null, likes, comments, engagement, er: perEr(engagement) } }).filter((p) => p.id).sort((a, b) => b.engagement - a.engagement)
      const formats = {}; for (const p of posts) { const f = (p.type || 'OTHER').toUpperCase(); formats[f] = (formats[f] || 0) + 1 }
      const totalEng = posts.reduce((a, p) => a + p.engagement, 0)
      const totalLikes = posts.reduce((a, p) => a + p.likes, 0), totalComments = posts.reduce((a, p) => a + p.comments, 0)
      const er = (followers && posts.length) ? Math.round((totalEng / posts.length / followers) * 1000) / 10 : null
      // Per-day series across the whole selected range (zero-filled) so the
      // posting-cadence + engagement chart draws a continuous axis.
      const byDay = {}
      for (const p of posts) { if (!p.date) continue; const e = byDay[p.date] || { date: p.date, posts: 0, engagement: 0, likes: 0, comments: 0 }; e.posts++; e.likes += p.likes; e.comments += p.comments; e.engagement += p.engagement; byDay[p.date] = e }
      const dayMs = 86400000; const span = []
      if (from && to) { const t1 = Date.parse(from + 'T00:00:00Z'), t2 = Date.parse(to + 'T00:00:00Z'); if (!isNaN(t1) && !isNaN(t2) && t2 >= t1 && (t2 - t1) / dayMs < 400) for (let t = t1; t <= t2; t += dayMs) span.push(new Date(t).toISOString().slice(0, 10)) }
      const daily = (span.length ? span : Object.keys(byDay).sort()).map((d) => byDay[d] || { date: d, posts: 0, engagement: 0, likes: 0, comments: 0 })
      // Weekday cadence (posts + avg engagement per weekday) - "best day to post".
      const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const wdPosts = [0, 0, 0, 0, 0, 0, 0], wdEng = [0, 0, 0, 0, 0, 0, 0]
      for (const p of posts) { const t = Date.parse(p.date + 'T00:00:00Z'); if (isNaN(t)) continue; const wd = new Date(t).getUTCDay(); wdPosts[wd]++; wdEng[wd] += p.engagement }
      const weekday = WD.map((name, i) => ({ name, posts: wdPosts[i], avgEng: wdPosts[i] ? Math.round(wdEng[i] / wdPosts[i]) : 0 }))
      return json({ ig: {
        username: prof.profile_username || account, followers, mediaCount: num(prof.profile_media_count),
        postCount: posts.length, likes: totalLikes, comments: totalComments, engagement: totalEng, er,
        avgLikes: posts.length ? Math.round(totalLikes / posts.length) : 0,
        avgComments: posts.length ? Math.round(totalComments / posts.length) : 0,
        avgEng: posts.length ? Math.round(totalEng / posts.length) : 0,
        formats, weekday, daily, posts: posts.slice(0, 24),
      } }, 200)
    } catch (e) { return json({ ig: null, error: String(e.message || e) }, 200) }
  }

  // Generic Windsor connector probe - hit any connector slug and see the accounts
  // + field shape it returns. Used to wire the public IG/FB competitor connector
  // once its exact slug/fields are known. e.g.
  //   ?scope=windsorprobe&connector=instagram_public&wfields=account_id,account_name,username,followers_count&from=2026-06-01&to=2026-06-30
  if (url.searchParams.get('scope') === 'windsorprobe') {
    if (me && me.role === 'viewer') return json({ error: 'not allowed' }, 403)
    const connector = url.searchParams.get('connector')
    if (!connector) return json({ error: 'connector slug required (e.g. instagram_public)' }, 400)
    const wfields = (url.searchParams.get('wfields') || 'account_id,account_name').split(',').map((s) => s.trim()).filter(Boolean)
    try {
      const rows = await windsorFetch(connector, wfields, from, to, preset || 'last_30d', key)
      const accounts = [...new Map(rows.map((r) => [norm(r.account_id), { account_id: r.account_id, account_name: r.account_name || r.username || r.name || null }])).values()].slice(0, 100)
      return json({ connector, rowCount: rows.length, accounts, sampleKeys: rows[0] ? Object.keys(rows[0]) : [], sample: rows.slice(0, 5) }, 200)
    } catch (e) { return json({ connector, error: String(e.message || e) }, 502) }
  }

  // Inbound social DMs (Instagram / Facebook) started in the period, from the
  // client's GoHighLevel inbox. `probe` returns a raw conversation sample.
  if (url.searchParams.get('scope') === 'socialdm') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ dm: null, connected: false })
    if (!(await isConnected().catch(() => false))) return json({ dm: null, connected: false, needsSetup: true })
    try { return json({ dm: await socialDMs(cc.ghl, from, to, { debug: !!url.searchParams.get('probe') }) }, 200, !url.searchParams.get('probe')) }
    catch (e) { return json({ dm: null, error: String(e.message || e) }, 200) }
  }

  // Opportunity custom fields (date-first) for the Settings Key Events
  // timestamp-field dropdown.
  if (url.searchParams.get('scope') === 'oppfields') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    if (!cc.ghl) return json({ fields: [], connected: false })
    if (!(await isConnected().catch(() => false))) return json({ fields: [], connected: false, needsSetup: true })
    try { return json({ fields: await oppTimestampFields(cc.ghl) }, 200) }
    catch (e) { return json({ fields: [], error: String(e.message || e) }, 200) }
  }

  // Deal-level won/lost lists (both attribution bases) for drill-downs, the Lost
  // Reasons view and the Status-Change vs Created-On revenue split.
  if (url.searchParams.get('scope') === 'monthlydeals') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    if (!cc.ghl) return json({ deals: null, connected: false })
    if (!(await isConnected().catch(() => false))) return json({ deals: null, connected: false, needsSetup: true })
    try {
      const [md, usersRows] = await Promise.all([
        monthlyDeals(cc.ghl, from, to),
        ghlUserRows(cc.ghl).catch(() => []),
      ])
      const uName = {}; for (const u of usersRows) if (u.user_id) uName[u.user_id] = u.user_name
      const nm = (id) => uName[id] || (id === 'unassigned' ? 'Unassigned' : 'User ' + String(id).slice(-4))
      for (const d of md.statusChange.won.deals) d.userName = nm(d.userId)
      for (const d of md.createdOn.won.deals) d.userName = nm(d.userId)
      for (const d of md.lost.deals) d.userName = nm(d.userId)
      md.userNames = uName
      return json({ deals: md, period: { from, to } }, 200)
    } catch (e) { return json({ deals: null, error: String(e.message || e) }, 200) }
  }

  // Up to N (default 6) months of Meta platform spend + leads + CPL, ending on
  // the report month, for the campaign-performance trend graph.
  if (url.searchParams.get('scope') === 'monthlytrend') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    if (!from || !to) return json({ error: 'from/to required' }, 400)
    const months = Math.max(1, Math.min(12, parseInt(url.searchParams.get('months') || '6', 10)))
    // Anchor on the range's END month so a multi-month report shows the correct
    // trailing months (for a single month, from and to share a month → identical).
    const anchor = new Date((to || from) + 'T00:00:00Z')
    const startD = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (months - 1), 1))
    const winFrom = startD.toISOString().slice(0, 10)
    const buckets = new Map()
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth() + i, 1))
      buckets.set(d.toISOString().slice(0, 7), { month: d.toISOString().slice(0, 7), label: d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' }), spend: 0, leads: 0 })
    }
    try {
      if (cc.meta) {
        // Compute each month with the SAME per-ad-set rollup the campaign slide's
        // headline uses (adset fields, no `date` dimension), so the trend's latest
        // point matches the headline exactly. A `date`-dimension pull splits
        // windowed conversions per day and under-counts results - the bug that made
        // the trend disagree with the headline. One fetch per month, in parallel.
        const fallback = await readMetaPrimary(client).catch(() => null)
        const adsetFields = ['account_id', 'campaign', 'adset_name', 'adset_optimization_goal', 'adset_destination_type', 'adset_promoted_object', 'campaign_objective', 'spend', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...META_RESULT_FIELDS, 'actions_video_view']
        const monthList = [...buckets.keys()]
        const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }
        const perMonth = await Promise.all(monthList.map((k) =>
          windsorFetch('facebook', adsetFields, `${k}-01`, lastDay(k), null, key)
            .then((rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,cc.meta)))
            .catch(() => [])
        ))
        // Custom-conversion primaries aren't insights columns, so add each month's
        // count from the Custom Conversions table (same as the headline).
        const ccPrimary = ((fallback && fallback.fields) || []).filter(isCustomConvField)
        const ccPerMonth = ccPrimary.length
          ? await Promise.all(monthList.map((k) => fetchCustomConvCounts(cc, `${k}-01`, lastDay(k), key, false).then((d) => d.total).catch(() => new Map())))
          : null
        monthList.forEach((k, i) => {
          const b = buckets.get(k); if (!b) return
          let results = 0, spend = 0
          for (const a of aggMeta(perMonth[i], 'adset_name')) { const rr = rowResult(a, fallback); results += resultCount(a, rr.field) || 0; spend += a.spend }
          if (ccPerMonth) { const tm = ccPerMonth[i]; for (const f of ccPrimary) { const an = ccActionName(f); results += an ? (tm.get(an) || 0) : 0 } }
          b.spend = spend; b.leads = results
        })
      }
      const trend = [...buckets.values()].map((b) => ({ month: b.month, label: b.label, spend: Math.round(b.spend), leads: Math.round(b.leads), cpl: b.leads ? Math.round(b.spend / b.leads) : null }))
      return json({ trend }, 200)
    } catch (e) { return json({ trend: [], error: String(e.message || e) }, 200) }
  }

  // Business profile (website + uploaded logo) per mapped client, for real brand
  // logos as avatars. Batched across every GHL client so the frontend can sync
  // them all in one call and cache the result.
  if (url.searchParams.get('scope') === 'logos') {
    if (!(await isConnected().catch(() => false))) return json({ scope: 'logos', connected: false, logos: {} })
    try {
      const entries = Object.entries(CLIENTS).filter(([id, cc]) => cc.ghl && canView(id))
      const results = await Promise.all(entries.map(async ([id, cc]) => {
        try { const p = await locationProfile(cc.ghl); return [id, { website: p.website || null, logoUrl: p.logoUrl || null }] }
        catch { return [id, { website: null, logoUrl: null }] }
      }))
      return json({ scope: 'logos', connected: true, logos: Object.fromEntries(results) }, 200, !filtered)
    } catch (e) { return json({ scope: 'logos', error: String((e && e.message) || e).slice(0, 160), logos: {} }, 200) }
  }

  // Agency-wide Caalano Systems access/scope audit across every mapped client.
  if (url.searchParams.get('scope') === 'ghlaudit') {
    if (!(await isConnected().catch(() => false))) return json({ connected: false, needsSetup: true })
    try {
      const entries = Object.entries(CLIENTS).filter(([id, cc]) => cc.ghl && canView(id))
      const audit = await Promise.all(entries.map(async ([id, cc]) => ({ client: id, location: cc.ghl, ...(await auditLocation(cc.ghl)) })))
      return json({ audit }, 200)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Contact self-booking tag audit. Per-client (client=<id>) to stay well under
  // the function timeout; the UI walks the client list one at a time.
  if (url.searchParams.get('scope') === 'tagaudit') {
    if (!(await isConnected().catch(() => false))) return json({ scope: 'tagaudit', connected: false, needsSetup: true })
    const single = CLIENTS[client]
    try {
      if (client && single) {
        if (!single.ghl) return json({ scope: 'tagaudit', connected: true, client, audit: { client, location: null, hasCrm: false } })
        return json({ scope: 'tagaudit', connected: true, client, audit: { client, location: single.ghl, ...(await tagAudit(single.ghl)) } }, 200)
      }
      // No client given: return the list of GHL-enabled client ids to walk.
      const clients = Object.entries(CLIENTS).filter(([, cc]) => cc.ghl).map(([id]) => id)
      return json({ scope: 'tagaudit', connected: true, clients }, 200)
    } catch (e) { return json({ scope: 'tagaudit', connected: true, client, audit: { client, error: String(e.message || e).slice(0, 140) } }, 200) }
  }

  // Timezone alignment: the client's Caalano Systems location timezone (which
  // now drives every CRM date window) plus a best-effort read of the Meta ad
  // account timezone, so Settings can show they line up. The Meta probe is
  // isolated - if the field name is not recognised it just returns null and
  // never affects the main Meta data.
  if (url.searchParams.get('scope') === 'tz') {
    const c = CLIENTS[client]
    if (!c) return json({ error: `unknown client ${client}` }, 404)
    const out = { client, crmTz: null, metaTz: null, aligned: null }
    if (c.ghl && (await isConnected().catch(() => false))) { try { out.crmTz = await locationTimezone(c.ghl) } catch { /* leave null */ } }
    if (c.meta) {
      for (const f of ['account_timezone_name', 'timezone_name', 'account_timezone']) {
        try {
          const rows = await windsorFetch('facebook', ['account_id', f], null, null, 'last_7d', key)
          const v = rows && rows.length ? (rows[0][f] || null) : null
          if (v) { out.metaTz = v; break }
        } catch { /* unknown field / no data - try next */ }
      }
    }
    if (out.crmTz && out.metaTz) out.aligned = out.crmTz === out.metaTz
    return json({ scope: 'tz', ...out }, 200, true)
  }

  // Agency-wide roll-up (no single client) - powers the Overview + leaderboard.
  if (url.searchParams.get('scope') === 'agency') {
    try {
      // Backend default stays 'created' (unchanged); the frontend passes 'closed'
      // for the global default, so no-param callers are unaffected.
      const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
      const ov = await buildOverview(from, to, preset, key, wonBasis)
      ov.wonBasis = wonBasis
      if (filtered) {
        ov.clients = pickAllowed(ov.clients)
        if (ov.alerts) { ov.alerts.meta = (ov.alerts.meta || []).filter((a) => canView(a.id)); ov.alerts.google = (ov.alerts.google || []).filter((a) => canView(a.id)) }
      }
      return json({ scope: 'agency', period: { from, to, preset }, ...ov }, 200, !filtered)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Rolling-window performance trends across all clients (own date logic).
  if (url.searchParams.get('scope') === 'trends') {
    // Don't cache a partial pull (Meta or Google timed out) - otherwise the blank
    // result is served for 10 min and the user has to hammer Refresh. Skipping the
    // cache lets the client's auto-retry get a fresh, complete pull.
    try { const tr = await buildTrends(key); if (filtered) tr.clients = pickAllowed(tr.clients); const complete = tr.metaOk !== false && tr.googleOk !== false; return json({ scope: 'trends', ...tr }, 200, !filtered && complete) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Agency-wide UTM source-tag coverage per client (lazy-loaded for the leaderboard).
  if (url.searchParams.get('scope') === 'coverage') {
    if (!(await isConnected().catch(() => false))) return json({ scope: 'coverage', connected: false, coverage: {} })
    const entries = Object.entries(CLIENTS).filter(([id, cc]) => cc.ghl && canView(id))
    const out = {}
    await Promise.all(entries.map(async ([id, cc]) => { try { out[id] = await attributionCoverage(cc.ghl, from, to) } catch { out[id] = null } }))
    return json({ scope: 'coverage', connected: true, coverage: out }, 200, !filtered)
  }

  // Weekly (Mon–Sun) traffic-light board for one client.
  if (url.searchParams.get('scope') === 'weekly') {
    const cw = CLIENTS[client]
    if (!cw) return json({ error: `unknown client ${client}` }, 404)
    const weeks = Math.max(2, Math.min(16, parseInt(url.searchParams.get('weeks'), 10) || 6))
    const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
    try { const wk = await buildWeekly(cw, weeks, key, wonBasis); return json({ scope: 'weekly', client, weeks, wonBasis, ...wk }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Debug (PII-free): channel classification breakdown for one client + window.
  if (url.searchParams.get('scope') === 'chandebug') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ error: `client ${client} has no Caalano Systems location` }, 404)
    try { return json({ scope: 'chandebug', client, ...(await sampleChannels(cc.ghl, from, to)) }, 200) }
    catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 200) }
  }

  // Per-form performance: leads → booked → shown → won by form (friction /
  // qualification comparison). Meta Lead Forms grouped by facebookFormName.
  if (url.searchParams.get('scope') === 'forms') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'forms', client, ghl: false, forms: [] })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'forms', client, connected: false, forms: [] })
    try {
      // Build the CRM forms AND (in parallel) the ad id→name maps, then resolve each
      // person's campaign / ad set / creative from a numeric UTM id to its real name.
      // The map fetch runs alongside buildForms (no added latency) and hits Windsor,
      // not GHL, so it doesn't add to the CRM rate limit.
      const [formsData, idMaps] = await Promise.all([
        buildForms(cc.ghl, from, to),
        (cc.meta || cc.google) ? fetchAdIdNameMaps(cc, from, to, preset, key).catch(() => null) : Promise.resolve(null),
      ])
      if (idMaps) resolveFormsAttribution(formsData, idMaps)
      return json({ scope: 'forms', client, period: { from, to, preset }, ...formsData }, 200, true)
    } catch (e) { return json({ scope: 'forms', client, error: String(e.message || e).slice(0, 200), forms: [] }, 200) }
  }

  // Speed to Lead: time from lead-in to first manual (human) outbound message.
  if (url.searchParams.get('scope') === 'speed') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'speed', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'speed', client, connected: false })
    const sample = Math.min(Number(url.searchParams.get('sample')) || 60, 120)
    const dbg = url.searchParams.get('debug') === '1'
    const hours = parseHours(url) // working-hours adjustment (business minutes only)
    try { return json({ scope: 'speed', client, period: { from, to, preset }, ...(await buildSpeedToLead(cc.ghl, from, to, { sample, debug: dbg, hours })) }, 200, !dbg) }
    catch (e) { return json({ scope: 'speed', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Speed to Lead - WHOLE dataset, processed in chunks across polled requests and
  // accumulated in a blob. The frontend calls with reset=1 to start, then polls
  // (reset absent) until status === 'done'.
  if (url.searchParams.get('scope') === 'speedscan') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'speedscan', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'speedscan', client, connected: false })
    const hours = parseHours(url)
    const reset = url.searchParams.get('reset') === '1'
    const store = getStore({ name: 'caalano-speedscan', consistency: 'strong' })
    const key = `${client}|${from || ''}|${to || ''}`
    try {
      let state = reset ? null : await store.get(key, { type: 'json' }).catch(() => null)
      if (!state) {
        const { tz, leads, outcome } = await speedLeadList(cc.ghl, from, to)
        state = { tz, leads, outcome, idx: 0, total: leads.length, status: leads.length ? 'running' : 'done', agg: { manualRaw: [], onlyAuto: 0, noOutbound: 0, srcCounts: {}, contact: { messaged: [], userBooked: [], selfBooked: [], booked: [], contacted: [], none: [] }, contactBase: 0 } }
      }
      if (state.status !== 'done') {
        state.idx = await speedScanChunk(cc.ghl, state.leads, state.idx, 18000, state.agg)
        if (state.idx >= state.total) state.status = 'done'
        await store.setJSON(key, state)
      }
      const out = finalizeSpeed(state.agg, state.total, state.idx, hours, state.tz, state.outcome)
      return json({ scope: 'speedscan', client, period: { from, to, preset }, status: state.status, processed: state.idx, total: state.total, ...out }, 200)
    } catch (e) { return json({ scope: 'speedscan', client, status: 'err', error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Auto-detected working hours (from the client's calendars) for the Settings
  // active-hours editor to prefill.
  if (url.searchParams.get('scope') === 'hours') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'hours', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'hours', client, connected: false })
    try { return json({ scope: 'hours', client, ...(await deriveBusinessHours(cc.ghl)) }, 200, true) }
    catch (e) { return json({ scope: 'hours', client, error: String(e.message || e).slice(0, 200) }, 200) }
  }

  // Per-user (sales rep) performance for the client's Users tab.
  // Executive health score - the headline of the Caalano 360 executive tab.
  // Live computation for the selected range plus whatever daily trend history the
  // snapshot job has accumulated (empty until it first runs - no fake history).
  if (url.searchParams.get('scope') === 'health') {
    const cc = CLIENTS[client]
    if (!cc) return json({ scope: 'health', client, error: `unknown client ${client}` }, 404)
    try {
      const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
      const cfg = await readHealthConfig(client)
      const [health, history] = await Promise.all([
        buildHealth(cc, from, to, preset, key, cfg.weights, wonBasis),
        readHealthHistory(client).catch(() => []),
      ])
      return json({ scope: 'health', client, period: { from, to, preset }, wonBasis, ...health, history }, 200, true)
    } catch (e) { return json({ scope: 'health', client, error: String(e.message || e).slice(0, 200) }, 200) }
  }

  // Extra CRM intelligence for the Client Update module: appointment reporting
  // nuance, lost-reason trends, average close time, and non-booker note themes.
  if (url.searchParams.get('scope') === 'updateextra') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'updateextra', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'updateextra', client, connected: false })
    try { return json({ scope: 'updateextra', client, period: { from, to, preset }, ...(await buildUpdateExtra(cc.ghl, from, to)) }, 200, true) }
    catch (e) { return json({ scope: 'updateextra', client, error: String(e.message || e).slice(0, 200) }, 200) }
  }

  // On-demand trend backfill for one client - weekly trailing-window points going
  // back in time. Bounded per call (staff only) with a `before` cursor so the UI
  // can seed ~12 months of history across several quick calls without a timeout.
  if (url.searchParams.get('scope') === 'healthbackfill') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc) return json({ scope: 'healthbackfill', client, error: `unknown client ${client}` }, 404)
    const key2 = process.env.WINDSOR_API_KEY
    const today = new Date().toISOString().slice(0, 10)
    const before = url.searchParams.get('before') || today
    // Each point is a full blend computation; keep the batch small so a single
    // call stays well under the function timeout. The UI walks the cursor.
    const perCall = 3
    const done = []
    let cursor = before
    for (let i = 0; i < perCall; i++) {
      try { const p = await snapshotClient(client, cc, key2, cursor); done.push({ date: cursor, composite: p.composite }) }
      catch (e) { done.push({ date: cursor, error: String(e.message || e).slice(0, 100) }) }
      cursor = addDaysStr(cursor, -7)
    }
    // Stop ~12 months back.
    const limit = addDaysStr(today, -364)
    const next = cursor > limit ? cursor : null
    return json({ scope: 'healthbackfill', client, done, nextBefore: next }, 200)
  }

  if (url.searchParams.get('scope') === 'users') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'users', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'users', client, connected: false })
    try {
      // One response now carries EVERY channel × pipeline combo, plus the won-in-
      // period (closed-basis) per-user figures and channel-scoped ad spend, so the
      // Users tab switches channel / pipeline / won-basis client-side with no
      // refetch. All three filters only change which opportunities are counted;
      // the expensive fetches are identical, so we do them once.
      const filt = (id) => (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, id))
      const [perf, fb, gg, wonClosed] = await Promise.all([
        buildUserPerformanceCombos(cc.ghl, from, to, {}),
        cc.meta ? windsorFetch('facebook', ['account_id', 'spend'], from, to, preset, key).then(filt(cc.meta)).catch(() => []) : Promise.resolve([]),
        cc.google ? windsorFetch('google_ads', ['account_id', 'spend'], from, to, preset, key).then(filt(cc.google)).catch(() => []) : Promise.resolve([]),
        (from && to) ? wonInPeriod(cc.ghl, from, to).catch(() => null) : Promise.resolve(null),
      ])
      const metaSpend = Math.round(fb.reduce((s, r) => s + num(r.spend), 0))
      const googleSpend = Math.round(gg.reduce((s, r) => s + num(r.spend), 0))
      // Ad spend can't be attributed to an individual rep, but it CAN be scoped to
      // the selected channel. Non-paid has no ad spend, so cost figures are N/A.
      const spendByChannel = { all: metaSpend + googleSpend, paid: metaSpend + googleSpend, meta: metaSpend, google: googleSpend, nonpaid: 0 }
      return json({ scope: 'users', client, period: { from, to, preset }, metaSpend, googleSpend, spendByChannel, wonByUser: (wonClosed && wonClosed.byUser) || null, ...perf }, 200, true)
    } catch (e) { return json({ scope: 'users', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Command Centre drill dataset - staff-only. Assembles every clickable
  // command-centre tile's backing data (opps by source, revenue deals, open
  // deals, lost-by-reason joined to form answers, per-calendar booking, per-
  // channel close) from a single direct-GHL load, and grafts on the paid spend /
  // CPL / CPA figures from the health feed so cost-per is paid-attributed, not
  // spend ÷ all-CRM. Cached like scope=users. Partial + error string on failure.
  if (url.searchParams.get('scope') === 'ccdrill') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'ccdrill', client, ghl: false })
    if (me && me.role === 'viewer') return json({ scope: 'ccdrill', client, error: 'Staff only.' }, 403)
    if (!(await isConnected().catch(() => false))) return json({ scope: 'ccdrill', client, connected: false })
    const channel = url.searchParams.get('channel') || 'all'
    try {
      const [drill, health] = await Promise.all([
        buildCcDrill(cc.ghl, from, to, channel),
        buildHealth(cc, from, to, preset, key).catch(() => null),
      ])
      const chn = (health && health.channels) || {}
      const metaSpend = num(chn.metaSpend), googleSpend = num(chn.googleSpend)
      const metaLeads = num(chn.metaLeads), googleLeads = num(chn.googleConv)
      const paidLeads = metaLeads + googleLeads, totalSpend = metaSpend + googleSpend
      const wbc = drill.wonByChannel || {}
      const r2 = (v) => Math.round(v * 100) / 100
      const paid = {
        metaLeads, googleLeads, paidLeads,
        metaCpl: metaLeads ? r2(metaSpend / metaLeads) : null,
        googleCpl: googleLeads ? r2(googleSpend / googleLeads) : null,
        paidCpl: paidLeads ? r2(totalSpend / paidLeads) : null,
        paidWon: wbc.paidWon || 0, metaWon: wbc.metaWon || 0, googleWon: wbc.googleWon || 0,
        paidCpa: wbc.paidWon ? r2(totalSpend / wbc.paidWon) : null,
        metaCpa: wbc.metaWon ? r2(metaSpend / wbc.metaWon) : null,
        googleCpa: wbc.googleWon ? r2(googleSpend / wbc.googleWon) : null,
      }
      const { wonByChannel, connected, tz, ...rest } = drill
      return json({ scope: 'ccdrill', client, period: { from, to, preset }, spend: { meta: metaSpend, google: googleSpend, total: totalSpend }, paid, ...rest }, 200, true)
    } catch (e) {
      return json({ scope: 'ccdrill', client, error: String(e.message || e).slice(0, 200), connected: true }, 200)
    }
  }

  // Notes on a specific deal's contact, for the Users open-deal drill-down.
  if (url.searchParams.get('scope') === 'oppnotes') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'oppnotes', notes: [] })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'oppnotes', connected: false, notes: [] })
    const contactId = url.searchParams.get('contact') || null
    if (!contactId) return json({ scope: 'oppnotes', notes: [] })
    try { return json({ scope: 'oppnotes', client, ...(await fetchOppNotes(cc.ghl, { contactId })) }, 200) }
    catch (e) { return json({ scope: 'oppnotes', client, error: String(e.message || e).slice(0, 200), notes: [] }, 200) }
  }

  // The people behind ONE key event (funnel/scorecard click-through). Channel-
  // scoped so a Meta key event lists only Meta-attributed people.
  if (url.searchParams.get('scope') === 'keypeople') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'keypeople', client, people: [] })
    if (me && me.role === 'viewer' && !viewerAllowed(me, 'keypeople', channel)) return json({ scope: 'keypeople', client, error: 'Not allowed.' }, 403)
    if (!(await isConnected().catch(() => false))) return json({ scope: 'keypeople', client, connected: false, people: [] })
    const kind = url.searchParams.get('kind') || 'stage'
    const stage = url.searchParams.get('stage') || null
    const pipeline = url.searchParams.get('pipeline') || null
    const cals = (url.searchParams.get('cals') || '').split(',').filter(Boolean)
    const ad = url.searchParams.get('ad') || null // scope to one creative (utm_content ≈ ad name)
    try { return json({ scope: 'keypeople', client, ...(await buildKeyPeople(cc.ghl, from, to, { channel: channel === 'attribution' || channel === 'blend' ? 'all' : channel, pipeline, stage, kind, cals, ad })) }, 200, true) }
    catch (e) { return json({ scope: 'keypeople', client, error: String(e.message || e).slice(0, 200), people: [] }, 200) }
  }

  // Appointment insights: booking lead time, self vs staff booked, downstream
  // show / win outcomes, split by channel.
  if (url.searchParams.get('scope') === 'appts') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'appts', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'appts', client, connected: false })
    const dbg = url.searchParams.get('debug') === '1'
    const pipeline = url.searchParams.get('pipeline') || null
    const calIds = (url.searchParams.get('cals') || '').split(',').filter(Boolean)
    const user = url.searchParams.get('user') || null
    try { return json({ scope: 'appts', client, period: { from, to, preset }, ...(await buildAppointmentInsights(cc.ghl, from, to, { debug: dbg, pipeline, calIds, user })) }, 200, !dbg) }
    catch (e) { return json({ scope: 'appts', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Time in stage - for every OPEN deal, how long it's been sitting in its current
  // stage (now − lastStageChangeAt), aggregated per stage/pipeline. No date window
  // (it's live pipeline state). Cached like other CRM scopes.
  if (url.searchParams.get('scope') === 'stagetiming') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'stagetiming', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'stagetiming', client, connected: false })
    try { return json({ scope: 'stagetiming', client, ...(await buildStageTiming(cc.ghl)) }, 200, true) }
    catch (e) { return json({ scope: 'stagetiming', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Per-user call activity (GHL dialer): outbound volume, talk minutes, connect
  // rate, inbound handled - from the bulk Call export. Cached like other CRM scopes.
  if (url.searchParams.get('scope') === 'usercalls') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'usercalls', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'usercalls', client, connected: false })
    // callsonly=1 skips the opportunities pull + speed-to-lead so a single-day
    // chunk returns fast; the frontend batches the wide range day-by-day and merges.
    const callsOnly = url.searchParams.get('callsonly') === '1'
    try { return json({ scope: 'usercalls', client, period: { from, to, preset }, ...(await buildUserCalls(cc.ghl, from, to, callsOnly)) }, 200, true) }
    catch (e) { return json({ scope: 'usercalls', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Read-only probe of a client's forms / submissions / custom fields, to see
  // how Meta Lead Forms are structured before building the By-Form view.
  if (url.searchParams.get('scope') === 'formsprobe') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'formsprobe', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'formsprobe', client, connected: false })
    try { return json({ scope: 'formsprobe', client, ...(await sampleForms(cc.ghl, from, to)) }, 200) }
    catch (e) { return json({ scope: 'formsprobe', client, error: String(e.message || e).slice(0, 200) }, 200) }
  }

  // Calendar list for one client, for the Settings booking-funnel-step editor.
  if (url.searchParams.get('scope') === 'calendars') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'calendars', client, calendars: [] })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'calendars', client, connected: false, calendars: [] })
    try {
      // Pipelines come from the DIRECT GHL API (not Windsor), so the Key-events
      // editor lists stages the instant a client is linked - before Windsor has
      // synced any opportunity data for the account.
      const [calendars, pipelines] = await Promise.all([
        listCalendars(cc.ghl),
        listPipelines(cc.ghl).catch(() => []),
      ])
      return json({ scope: 'calendars', client, connected: true, calendars, pipelines }, 200, true)
    }
    catch (e) { return json({ scope: 'calendars', client, error: String(e.message || e).slice(0, 160), calendars: [] }, 200) }
  }

  // Account explorer for adding a new client: every Caalano Systems (GHL) sub-
  // account under the agency, plus the distinct Meta / Google ad accounts Windsor
  // can see. Each is flagged `mapped` when it already belongs to a client, so the
  // UI can surface what's still available to connect.
  if (url.searchParams.get('scope') === 'discover') {
    const usedGhl = new Set(), usedMeta = new Set(), usedGoogle = new Set(), usedGa4 = new Set()
    for (const c of Object.values(CLIENTS)) { if (c.ghl) usedGhl.add(norm(c.ghl)); if (c.meta) usedMeta.add(norm(c.meta)); if (c.google) usedGoogle.add(norm(c.google)); if (c.ga4) usedGa4.add(norm(c.ga4)) }
    const nameById = (rows) => { const m = new Map(); for (const r of (rows || [])) { const id = r.account_id; if (id == null) continue; const k = String(id); if (!m.has(k) || (!m.get(k) && r.account_name)) m.set(k, r.account_name || '') } return m }
    // Discover over a WIDE window (last 12 months), NOT the selected range - Windsor
    // only returns accounts that have data IN the queried window, so using the
    // (possibly narrow) dashboard range hides accounts with no recent spend. That's
    // why fewer accounts showed than are actually connected. A fixed 12-month lookup
    // lists every account with any activity in the last year.
    // 12-month window: wide enough to list accounts with any activity this year,
    // but short enough that Windsor's per-account aggregation returns inside the
    // ~10s function budget. A 2-year window timed out (Windsor took too long),
    // which surfaced as "a connector is erroring" with 0 accounts.
    const dTo = new Date().toISOString().slice(0, 10)
    const dFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    // A metric-based listing (spend / sessions) only surfaces accounts that had
    // DELIVERY in the window - so a connected-but-paused ad account (zero spend,
    // zero impressions) is silently dropped, which is why fewer Meta/Google show
    // than are connected in Windsor. GA4 didn't suffer this because `sessions`
    // exists for any property with traffic. So for each connector we ALSO run a
    // dimension-only query (account_id + account_name, no metric) - which lists
    // every configured account regardless of delivery - and merge the two. Both
    // run in parallel so wall-clock stays ~one query; each catches independently.
    let metaErr = null, googleErr = null, ga4Err = null
    const listAccts = async (fetchFields, metric, onErr) => {
      const merged = new Map()
      const add = (rows) => { for (const r of (rows || [])) { const id = r.account_id; if (id == null) continue; const k = String(id); const nm = r.account_name || ''; if (!merged.has(k) || (!merged.get(k) && nm)) merged.set(k, merged.get(k) || nm) } }
      const [dimRes, metRes] = await Promise.allSettled([
        fetchFields(['account_id', 'account_name']),
        fetchFields(['account_id', 'account_name', metric]),
      ])
      if (dimRes.status === 'fulfilled') add(dimRes.value)
      if (metRes.status === 'fulfilled') add(metRes.value)
      // Only report an error if BOTH shapes failed (so a metric-less-query that
      // Windsor rejects doesn't mask a working metric query, and vice-versa).
      if (!merged.size && dimRes.status === 'rejected' && metRes.status === 'rejected') { onErr(String((metRes.reason && metRes.reason.message) || metRes.reason || 'error').slice(0, 200)) }
      return merged
    }
    const [locs, metaMap, googleMap, ga4Map] = await Promise.all([
      (isConnected().then((ok) => (ok ? listLocations() : [])).catch((e) => ({ error: String(e.message || e).slice(0, 160) }))),
      listAccts((f) => windsorFetch('facebook', f, dFrom, dTo, null, key), 'spend', (e) => { metaErr = e }),
      listAccts((f) => windsorFetch('google_ads', f, dFrom, dTo, null, key), 'spend', (e) => { googleErr = e }),
      // GA4 uses the auto-resolved connector slug (Windsor's GA4 slug varies).
      listAccts((f) => windsorGa4(f, dFrom, dTo, null, key), 'sessions', (e) => { ga4Err = e }),
    ])
    const ghlErr = locs && locs.error ? locs.error : null
    const ghl = Array.isArray(locs) ? locs.map((l) => ({ id: l.id, name: l.name, mapped: usedGhl.has(norm(l.id)) })) : []
    const meta = [...metaMap.entries()].map(([id, name]) => ({ id, name: name || id, mapped: usedMeta.has(norm(id)) })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const google = [...googleMap.entries()].map(([id, name]) => ({ id, name: name || id, mapped: usedGoogle.has(norm(id)) })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const ga4 = [...ga4Map.entries()].map(([id, name]) => ({ id, name: name || id, mapped: usedGa4.has(norm(id)) })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return json({ scope: 'discover', ghl, meta, google, ga4, ghlErr, metaErr, googleErr, ga4Err, metaCount: meta.length, googleCount: google.length, ga4Count: ga4.length, ga4Slug: _ga4Slug || null, fetchedAt: new Date().toISOString(), connected: await isConnected().catch(() => false) }, 200)
  }

  // Onboarding readiness: for each agency Caalano Systems location NOT yet linked
  // to a client, test whether its API is actually reachable (a location token can
  // only be minted when the marketplace app is installed on that sub-account). So
  // Auto-onboard only offers locations you can really pull, and flags the rest as
  // "install the app first". Bounded + pooled to stay inside the function limit.
  if (url.searchParams.get('scope') === 'onboardscan') {
    if (me && me.role === 'viewer') return json({ error: 'Not authorised.' }, 403)
    if (!(await isConnected().catch(() => false))) return json({ scope: 'onboardscan', connected: false, locations: [] })
    try {
      const locs = await listLocations()
      const mapped = new Set(); for (const c of Object.values(CLIENTS)) if (c.ghl) mapped.add(norm(c.ghl))
      const unmapped = locs.filter((l) => !mapped.has(norm(l.id)))
      const SCAN_CAP = 60
      const toScan = unmapped.slice(0, SCAN_CAP)
      // Test readiness with a small concurrency pool so a big agency doesn't blow
      // the time budget; anything beyond the cap is reported as unknown.
      const ready = {}
      let i = 0
      const worker = async () => { while (i < toScan.length) { const l = toScan[i++]; ready[l.id] = await checkLocationAccess(l.id).catch(() => false) } }
      await Promise.all(Array.from({ length: Math.min(6, toScan.length) }, worker))
      const out = locs.map((l) => ({ id: l.id, name: l.name, mapped: mapped.has(norm(l.id)), ready: mapped.has(norm(l.id)) ? true : (l.id in ready ? ready[l.id] : null) }))
      return json({ scope: 'onboardscan', connected: true, scanned: toScan.length, unmapped: unmapped.length, locations: out, fetchedAt: new Date().toISOString() }, 200)
    } catch (e) { return json({ scope: 'onboardscan', error: String(e.message || e).slice(0, 200), locations: [] }, 200) }
  }

  // Meta conversion actions that actually fired for a client's ad account, for
  // the per-client "primary / secondary conversion" picker in Settings. Queries
  // a wide (90-day) window so a rarely-firing event still appears, and returns
  // only non-zero events with their count + blended cost-per.
  if (url.searchParams.get('scope') === 'metaactions') {
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'metaactions', client, meta: false, actions: [] })
    const DAY = 86400000
    const f90 = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10)
    const t0 = new Date().toISOString().slice(0, 10)
    // Candidate list + any custom conversion fields this client already saved, so a
    // previously-added custom event still shows its live count.
    let savedCustom = []
    try { const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }); const mc = s && s.metaconv && s.metaconv[client]; if (mc) { const std = new Set(META_CONV_CANDIDATES.map(([id]) => id)); savedCustom = [mc.primary, ...(mc.secondary || [])].filter(Boolean).filter((f) => !std.has(f)) } } catch { /* ignore */ }
    const ids = [...new Set([...META_CONV_CANDIDATES.map(([id]) => id), ...savedCustom])]
    try {
      const rows = (await windsorFetch('facebook', ['account_id', 'spend', ...ids], f90, t0, null, key)).filter((r) => !r.account_id || acctEq(r.account_id,cc.meta))
      let spend = 0; const sums = {}
      for (const r of rows) { spend += num(r.spend); for (const id of ids) sums[id] = (sums[id] || 0) + num(r[id]) }
      const savedSet = new Set(savedCustom)
      const actions = ids.map((id) => ({ id, label: META_CONV_LABEL[id] || prettyField(id), count: Math.round(sums[id] || 0), costPer: sums[id] ? Math.round((spend / sums[id]) * 100) / 100 : null, custom: savedSet.has(id) }))
        .filter((a) => a.count > 0 || savedSet.has(a.id)).sort((a, b) => b.count - a.count)
      return json({ scope: 'metaactions', client, window: { from: f90, to: t0 }, spend: Math.round(spend), actions }, 200, true)
    } catch (e) { return json({ scope: 'metaactions', client, error: String(e.message || e).slice(0, 200), actions: [] }, 200) }
  }

  // Probe a custom Meta conversion by its Ads-Manager event name (e.g. "B_Page_View").
  // Tries the standard custom-pixel field-name variants and returns whichever have data,
  // so any business's own custom conversion can be added in Settings → Meta conversions.
  if (url.searchParams.get('scope') === 'metaprobe') {
    const cc = CLIENTS[client]
    const event = url.searchParams.get('event') || ''
    if (!cc || !cc.meta) return json({ scope: 'metaprobe', client, meta: false, found: [] })
    const ev = event.trim()
    if (!ev) return json({ scope: 'metaprobe', client, found: [], error: 'Enter a conversion event name.' })
    const DAY = 86400000
    const f90 = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10)
    const t0 = new Date().toISOString().slice(0, 10)
    try {
      // Primary source: Windsor's Custom Conversions table (the only place custom
      // conversions live - the per-id insights columns don't exist). Match the typed
      // name against the friendly name, its slug, or the offsite_conversion_custom_<id>
      // alias, case-insensitively.
      const { total } = await fetchCustomConvCounts(cc, f90, t0, key, false).catch(() => ({ total: new Map() }))
      const want = ev.toLowerCase(); const wantSlug = customConvSnake(ev)
      const found = []
      for (const [nm, cnt] of total) {
        if (nm === want || customConvSnake(nm) === wantSlug) { found.push({ id: `cc:${ev}`, label: `${ev} (custom conversion)`, count: Math.round(cnt || 0), costPer: null, custom: true }); break }
      }
      if (found.length) {
        let spend = 0
        try { const rows = (await windsorFetch('facebook', ['account_id', 'spend'], f90, t0, null, key)).filter((r) => !r.account_id || acctEq(r.account_id, cc.meta)); for (const r of rows) spend += num(r.spend) } catch { /* ignore */ }
        for (const a of found) a.costPer = a.count ? Math.round((spend / a.count) * 100) / 100 : null
      }
      return json({ scope: 'metaprobe', client, event: ev, window: { from: f90, to: t0 }, found }, 200, false)
    } catch (e) { return json({ scope: 'metaprobe', client, error: String(e.message || e).slice(0, 200), found: [] }, 200) }
  }

  // Auto-detect a client's optimisation event + every conversion field that's firing.
  // Reads the ad sets' optimisation goal + promoted object to learn WHICH custom event
  // the account optimises to (matching Ads Manager's Results column), then probes the
  // standard set + variants derived from that event - in small batches with per-batch
  // try/catch over a 30-day window, so an unknown field name or a big account can't
  // time out the whole call. Returns firing conversions + a suggested primary.
  if (url.searchParams.get('scope') === 'metadetect') {
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'metadetect', client, meta: false, actions: [] })
    const DAY = 86400000
    const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)
    const t0 = new Date().toISOString().slice(0, 10)
    const acct = (r) => !r.account_id || acctEq(r.account_id, cc.meta)
    // 1. Optimisation intent - the highest-spend ad set's goal, any custom event names,
    //    and any custom-conversion IDs named in its promoted object (a custom conversion
    //    is identified by a numeric id, which is the most reliable field-name seed).
    let goal = null, promotedSample = null, optConv = null, optConvSpend = -1; const evNames = new Set(); const customIds = new Set(); const convById = new Map()
    // The human event name lives inside the pixel_rule ("event":{"eq":"B_page_view"}).
    const evFromRule = (rule) => { try { const s = typeof rule === 'string' ? rule : JSON.stringify(rule); const m = s.match(/"event"\s*:\s*\{\s*"eq"\s*:\s*"([^"]+)"/); return m ? m[1] : null } catch { return null } }
    try {
      const adsets = (await windsorFetch('facebook', ['account_id', 'adset_optimization_goal', 'adset_destination_type', 'adset_promoted_object', 'spend'], from, t0, null, key)).filter(acct)
      let best = -1
      for (const a of adsets) {
        const sp = num(a.spend); if (sp > best && a.adset_optimization_goal) { best = sp; goal = a.adset_optimization_goal }
        let p = null
        try { p = typeof a.adset_promoted_object === 'string' ? JSON.parse(a.adset_promoted_object) : a.adset_promoted_object } catch { p = null }
        if (p && typeof p === 'object') {
          if (!promotedSample && (p.custom_conversion_id || p.custom_event_str || String(p.custom_event_type || '').toUpperCase() === 'OTHER')) promotedSample = a.adset_promoted_object
          for (const k of ['custom_event_str', 'custom_conversion_name', 'pixel_rule_name', 'application_name']) if (p[k]) evNames.add(String(p[k]))
          if (p.custom_event_type && !['OTHER', 'CONTENT_VIEW'].includes(String(p.custom_event_type).toUpperCase())) evNames.add(String(p.custom_event_type))
          const cid = p.custom_conversion_id && /^\d{6,}$/.test(String(p.custom_conversion_id)) ? String(p.custom_conversion_id) : null
          if (cid) {
            customIds.add(cid)
            const evName = evFromRule(p.pixel_rule) || p.custom_event_str || `Custom conversion ${cid.slice(-6)}`
            if (!convById.has(cid)) convById.set(cid, evName)
            // The custom conversion the highest-spend ad set optimises to is the true
            // "Results" event for the account - suggest it as primary.
            if (sp > optConvSpend) { optConvSpend = sp; optConv = { id: cid, event: evName } }
          }
          for (const k of ['custom_conversion', 'offline_conversion_data_set_id']) { const v = p[k]; if (v && /^\d{6,}$/.test(String(v))) customIds.add(String(v)) }
        }
      }
    } catch { /* ignore */ }
    // Canonical Windsor field for a custom conversion id (verified valid on the account).
    const convField = (id) => `conversions_offsite_conversion_custom_${id}`
    const auto = resolveMetaResult({ adset_optimization_goal: goal })
    let spend = 0
    try { const rows = (await windsorFetch('facebook', ['account_id', 'spend'], from, t0, null, key)).filter(acct); for (const r of rows) spend += num(r.spend) } catch { /* ignore */ }
    // Real custom-conversion counts come from Windsor's Custom Conversions table
    // (the per-id insights columns are unknown fields → always 0). Keyed by both the
    // friendly name and the offsite_conversion_custom_<id> alias.
    const ccCounts = await fetchCustomConvCounts(cc, from, t0, key, false).catch(() => ({ total: new Map() }))
    const ccNames = await fetchCustomConvNames(cc, from, t0, key).catch(() => new Map())
    // This client's saved primary/secondary custom-conversion fields, so a saved
    // choice (e.g. A_event_pageview) shows its real count even if it isn't the
    // account's current optimisation event (so not in convById).
    let savedCustomIds = []
    try { const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }); const mc = s && s.metaconv && s.metaconv[client]; if (mc) savedCustomIds = [...(mc.primary || []), ...(mc.secondary || [])].filter(Boolean).filter(isCustomConvField) } catch { /* ignore */ }
    const ccLookup = (fieldId, evName) => {
      const an = ccActionName(fieldId)
      let v = an != null ? ccCounts.total.get(an) : undefined
      if ((v == null || v === 0) && evName) v = ccCounts.total.get(String(evName).trim().toLowerCase())
      return Math.round(v || 0)
    }
    const sums = {}
    // 2a. Known-good standard candidates - safe to batch 8-at-a-time.
    const stdCands = META_CONV_CANDIDATES.map(([id]) => id)
    for (let i = 0; i < stdCands.length; i += 8) {
      const batch = stdCands.slice(i, i + 8)
      try { const rows = (await windsorFetch('facebook', ['account_id', ...batch], from, t0, null, key)).filter(acct); for (const r of rows) for (const f of batch) sums[f] = (sums[f] || 0) + num(r[f]) } catch { /* skip */ }
    }
    // 2b. Experimental candidates (constructed custom field-name variants by name AND by
    //     numeric id, plus Meta's native `results`) - an unknown field errors the whole
    //     query, so probe these ONE AT A TIME so one bad name can't drop the others.
    const expCands = [...new Set([
      ...[...evNames].flatMap(customConvCandidates),
      ...[...customIds].flatMap((id) => [`conversions_offsite_conversion_custom_${id}`, `actions_offsite_conversion_custom_${id}`, `conversions_offsite_conversion_fb_pixel_custom_${id}`, `conversions_custom_${id}`, `conversions_custom_conversion_${id}`, `custom_conversion_${id}`]),
      // Meta's native computed metrics - the account's per-campaign "Results", whatever
      // it optimises to (custom conversions included). The prize field if Windsor has it.
      'results', 'cost_per_result', 'result_rate', 'conversions', 'cost_per_conversion',
    ])]
    // Track per-field outcome so the diagnostic can tell "Windsor rejected this field"
    // apart from "valid field but zero" - that's what tells us which field actually exists.
    const expStatus = {}
    for (const f of expCands) {
      try { const rows = (await windsorFetch('facebook', ['account_id', f], from, t0, null, key)).filter(acct); let s = 0; for (const r of rows) s += num(r[f]); if (s > 0) sums[f] = s; expStatus[f] = s > 0 ? 'data' : 'zero' } catch { expStatus[f] = 'invalid' }
    }
    const allCands = [...stdCands, ...expCands]
    const actions = allCands.map((id) => ({ id, label: META_CONV_LABEL[id] || (id === 'results' ? 'Results (Meta optimised)' : prettyField(id)), count: Math.round(sums[id] || 0), costPer: sums[id] ? Math.round((spend / sums[id]) * 100) / 100 : null }))
      .filter((a) => a.count > 0).sort((a, b) => b.count - a.count)
    // Always surface every DETECTED optimisation custom conversion (labelled by its
    // event name from the pixel rule) whose Windsor field is valid - even at 0 count,
    // since a rarely-firing custom conversion is still the account's true "Results"
    // event and should be selectable / auto-suggested.
    for (const [id, evName] of convById) {
      const f = convField(id)
      const cnt = ccLookup(f, evName)
      // Prefer the real custom-conversion name (Definition table) over the pixel-rule
      // event name so it reads e.g. "B_Page_View".
      const nm = ccNames.get(String(id)) || evName
      if (!actions.some((a) => a.id === f)) actions.push({ id: f, label: `${nm} (custom conversion)`, count: cnt, costPer: cnt ? Math.round((spend / cnt) * 100) / 100 : null, custom: true, optimised: !!(optConv && optConv.id === id) })
      else { const ex = actions.find((a) => a.id === f); ex.label = `${nm} (custom conversion)`; ex.count = cnt; ex.costPer = cnt ? Math.round((spend / cnt) * 100) / 100 : null; ex.optimised = !!(optConv && optConv.id === id) }
    }
    // Saved custom conversions (from Settings) that aren't the current optimisation
    // event: surface them with their real count from the Custom Conversions table.
    for (const f of savedCustomIds) {
      if (actions.some((a) => a.id === f)) continue
      const cnt = ccLookup(f, null)
      const nm = ccLabel(f, ccNames)
      const lab = nm === 'Custom conversion' ? prettyField(f).replace(/^(Conversions|Actions)\s+/i, '') : nm
      actions.push({ id: f, label: `${lab} (custom conversion)`, count: cnt, costPer: cnt ? Math.round((spend / cnt) * 100) / 100 : null, custom: true })
    }
    const autoField = auto && auto.field && auto.field !== 'leads_native' ? auto.field : (auto && auto.field === 'leads_native' ? 'actions_leadgen_grouped' : null)
    // Prefer the detected optimisation custom conversion (the real per-campaign Results
    // event) as the suggested primary; else the objective's field; else top-firing.
    // The optimisation custom conversion is resolvable via the Custom Conversions
    // table (its insights column doesn't exist), so suggest it whenever detected.
    const optConvField = optConv ? convField(optConv.id) : null
    const suggest = optConvField || ((autoField && actions.some((a) => a.id === autoField)) ? autoField : (actions[0] ? actions[0].id : null))
    // Which experimental fields Windsor ACCEPTED (valid, even if zero) - the shortlist of
    // real fields we can use; 'invalid' ones don't exist on the connector.
    const acceptedFields = expCands.filter((f) => expStatus[f] && expStatus[f] !== 'invalid')
    return json({ scope: 'metadetect', client, window: { from, to: t0 }, goal: goal || null, evNames: [...evNames], customIds: [...customIds], promoted: promotedSample || null, spend: Math.round(spend), actions, suggest, tried: allCands, expStatus, acceptedFields }, 200, false)
  }

  // Creative Cockpit - every Meta creative with its performance and (where the
  // client has a CRM) the real funnel behind each ad, joined by first-touch
  // utm_content. Auto-detected fields: format, thumbnail, Instagram permalink.
  // Categorisation tags live client-side (settings), keyed by the creative id.
  if (url.searchParams.get('scope') === 'creatives') {
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'creatives', client, meta: false, creatives: [] })
    try {
      const fallback = await readMetaPrimary(client)
      const filt2 = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id,cc.meta))
      const [meta, perf, creRows] = await Promise.all([
        buildMeta(cc.meta, from, to, preset, key, fallback),
        (cc.ghl && (await isConnected().catch(() => false))) ? buildCreativePerf(cc.ghl, from, to).catch(() => ({ byContent: {} })) : Promise.resolve({ byContent: {} }),
        // Confirmed Windsor creative fields → auto-fill CTA / copy / destination.
        windsorFetch('facebook', ['account_id', 'ad_name', 'call_to_action_type', 'body', 'title', 'link_url', 'website_destination_url', 'ad_preview_shareable_link', 'creative_id', 'object_type'], from, to, preset, key).then(filt2).catch(() => []),
      ])
      // First non-empty value per ad name (an ad can span rows/placements).
      const creBy = new Map()
      for (const r of creRows) { const n = r.ad_name; if (!n) continue; const e = creBy.get(n) || {}; for (const k of ['call_to_action_type', 'body', 'title', 'link_url', 'website_destination_url', 'ad_preview_shareable_link', 'creative_id', 'object_type']) if (!e[k] && r[k]) e[k] = r[k]; creBy.set(n, e) }
      const byContent = perf.byContent || {}
      // Join Meta ad name ↔ utm_content by a loose normalised key (lower-case,
      // alphanumerics only) so minor punctuation/case differences still match.
      const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const perfByKey = {}; for (const [k, v] of Object.entries(byContent)) perfByKey[nk(k)] = v
      const usedKeys = new Set()
      // The same creative (ad_name) can run across several ad sets - aggregate to
      // one row per name so spend/leads total correctly and ids stay unique.
      const adAgg = new Map()
      for (const a of (meta.ads || [])) {
        const e = adAgg.get(a.name) || { name: a.name, campaign: a.campaign, adset: a.adset, adsetN: 0, type: a.type, quality: a.quality, thumb: a.thumb, igUrl: a.igUrl, spend: 0, impressions: 0, clicks: 0, leads: 0, results: 0, resultType: a.resultType }
        e.spend += a.spend; e.impressions += a.impressions; e.clicks += a.clicks; e.leads += a.leads; e.results += (a.results || 0); e.adsetN++
        if (a.type === 'Video') e.type = 'Video'
        if (!e.thumb && a.thumb) e.thumb = a.thumb
        if (!e.resultType && a.resultType) e.resultType = a.resultType
        adAgg.set(a.name, e)
      }
      const creatives = [...adAgg.values()].map((a) => {
        const key2 = nk(a.name); const crm = perfByKey[key2] || null; if (crm) usedKeys.add(key2)
        const ex = creBy.get(a.name) || {}
        const link = ex.link_url || ex.website_destination_url || null
        return {
          id: a.name, name: a.name, campaign: a.campaign, adset: a.adsetN > 1 ? `${a.adsetN} ad sets` : a.adset, creativeId: ex.creative_id || null,
          format: a.type, quality: a.quality, thumb: a.thumb,
          igUrl: ex.ad_preview_shareable_link || a.igUrl, previewUrl: ex.ad_preview_shareable_link || null,
          spend: Math.round(a.spend), impressions: a.impressions, clicks: a.clicks, leads: a.leads,
          results: a.results, resultType: a.resultType, costPerResult: a.results ? Math.round((a.spend / a.results) * 100) / 100 : null,
          autoCta: prettyCta(ex.call_to_action_type), autoCopy: ex.body || '', headline: ex.title || '', link, autoDest: classifyDest(link, ex.object_type),
          crm: crm ? { ...crm, costPerQualified: crm.qualified ? Math.round(a.spend / crm.qualified) : null, costPerBooked: crm.booked ? Math.round(a.spend / crm.booked) : null, costPerWon: crm.won ? Math.round(a.spend / crm.won) : null } : null,
        }
      }).sort((a, b) => b.spend - a.spend)
      // CRM outcomes whose utm_content matched no live ad (paused/old creatives).
      const unmatched = Object.entries(byContent).filter(([k]) => !usedKeys.has(nk(k))).map(([content, v]) => ({ content, ...v })).sort((a, b) => b.leads - a.leads).slice(0, 50)
      // Ad-set "segments" (sub-campaigns): Meta ad-set spend/leads joined to the
      // per-ad-set CRM funnel (utm_medium). Drives the update's per-segment insight.
      const byMedium = perf.byMedium || {}
      const medByKey = {}; for (const [k, v] of Object.entries(byMedium)) medByKey[nk(k)] = v
      const segments = (meta.adsets || []).map((a) => { const crm = medByKey[nk(a.name)] || null; return { name: a.name, campaign: a.campaign, spend: Math.round(a.spend), leads: crm ? crm.leads : a.leads, booked: crm ? crm.booked : null, won: crm ? crm.won : null, revenue: crm ? crm.revenue : null } }).sort((a, b) => b.spend - a.spend)
      // Flat per-(campaign, ad set, creative) rows for the drill-down + thumbnails.
      const adRows = (meta.ads || []).map((a) => { const ex = creBy.get(a.name) || {}; const crm = perfByKey[nk(a.name)] || null; return { name: a.name, campaign: a.campaign, adset: a.adset, format: a.type, thumb: a.thumb, previewUrl: ex.ad_preview_shareable_link || a.igUrl || null, spend: Math.round(a.spend), leads: a.leads, booked: crm ? crm.booked : 0 } })
      // Which UTM values actually carry the bookings, so unattributed bookings are
      // visible. Resolve each utm_content back to a live ad by creative_id or name.
      const creById = {}; const nameByKey = {}
      for (const [an, ex] of creBy.entries()) { if (ex.creative_id) creById[String(ex.creative_id)] = an; nameByKey[nk(an)] = an }
      const resolveContent = (v) => creById[String(v)] || nameByKey[nk(v)] || null
      const bkContent = Object.entries(byContent).filter(([, x]) => (x.booked || 0) > 0).map(([utm, x]) => ({ utm, matchedAd: resolveContent(utm), booked: x.booked, leads: x.leads, won: x.won })).sort((a, b) => b.booked - a.booked).slice(0, 40)
      const bkMedium = Object.entries(byMedium).filter(([, x]) => (x.booked || 0) > 0).map(([utm, x]) => ({ utm, booked: x.booked, leads: x.leads, won: x.won })).sort((a, b) => b.booked - a.booked).slice(0, 40)
      // Creative fatigue signal (frequency + CTR decline + quality ranking) so the
      // Cockpit can badge tiring creatives inline without a second round-trip.
      let fatigue = null
      try { fatigue = metaFatigue(meta.ads || [], meta.adDaily || [], await readFatigueConfig()) } catch { /* non-fatal */ }
      return json({ scope: 'creatives', client, period: { from, to, preset }, hasCrm: !!cc.ghl, creatives, segments, ads: adRows, bookingsByUtm: { content: bkContent, medium: bkMedium }, unmatched, fatigue }, 200, true)
    } catch (e) { return json({ scope: 'creatives', client, error: String(e.message || e).slice(0, 200), creatives: [] }, 200) }
  }

  // Meta Creative Fatigue for the agency-wide tab: one client per request (the UI
  // fans out across active Meta clients). Light fetch - ads + daily only - scored
  // by frequency, CTR decline and quality ranking against the shared thresholds.
  if (url.searchParams.get('scope') === 'fatigue') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'fatigue', client, meta: false, creatives: [], summary: { high: 0, medium: 0, low: 0, total: 0 } })
    try {
      const cfg = await readFatigueConfig()
      const res = await buildFatigue(cc.meta, from, to, preset, key, cfg)
      return json({ scope: 'fatigue', client, period: { from, to, preset }, ...res }, 200, true)
    } catch (e) { return json({ scope: 'fatigue', client, error: String(e.message || e).slice(0, 200), creatives: [], summary: { high: 0, medium: 0, low: 0, total: 0 } }, 200) }
  }

  // Meta's OWN creative-fatigue verdicts, as pushed to the meta-webhook function
  // and stored in Blobs. Read-only; joins each ad id to a name/thumbnail from
  // Windsor so the "Creative fatigue · Meta" tab reads like the proxy tab. Shows
  // connected:false until the webhook is set up and Meta sends its first event.
  if (url.searchParams.get('scope') === 'fatiguewebhook') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'fatiguewebhook', client, meta: false, connected: false, creatives: [] })
    try {
      const key2 = 'acct:' + String(cc.meta).replace(/\D/g, '')
      const rec = await getStore({ name: 'meta-webhooks', consistency: 'strong' }).get(key2, { type: 'json' }).catch(() => null)
      const ads = (rec && rec.ads) || {}
      const ids = Object.keys(ads)
      if (!ids.length) return json({ scope: 'fatiguewebhook', client, connected: !!rec, updatedAt: rec ? rec.updatedAt : null, creatives: [] }, 200, true)
      // Best-effort join ad_id → name/thumbnail via Windsor (field may be absent).
      let nameById = {}
      try {
        const rows = (await windsorFetch('facebook', ['account_id', 'ad_id', 'ad_name', 'thumbnail_url'], from, to, preset, key)).filter((r) => !r.account_id || acctEq(r.account_id,cc.meta))
        for (const r of rows) if (r.ad_id) nameById[String(r.ad_id)] = { name: r.ad_name, thumb: r.thumbnail_url }
      } catch { /* names optional */ }
      const norml = (l) => /high/i.test(l) ? 'High' : /med/i.test(l) ? 'Medium' : /low/i.test(l) ? 'Low' : l
      const creatives = ids.map((id) => ({ adId: id, level: norml(ads[id].level), rawLevel: ads[id].level, ts: ads[id].ts, name: (nameById[id] || {}).name || null, thumb: (nameById[id] || {}).thumb || null }))
        .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.level] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.level] ?? 3))
      const summary = { high: creatives.filter((c) => c.level === 'High').length, medium: creatives.filter((c) => c.level === 'Medium').length, low: creatives.filter((c) => c.level === 'Low').length, total: creatives.length }
      return json({ scope: 'fatiguewebhook', client, connected: true, updatedAt: rec.updatedAt, verified: !!rec.verified, creatives, summary }, 200, true)
    } catch (e) { return json({ scope: 'fatiguewebhook', client, error: String(e.message || e).slice(0, 200), connected: false, creatives: [] }, 200) }
  }

  // Webhook connection status - lists everything the meta-webhook receiver has
  // stored across all accounts, so the UI can confirm the pipe works the moment
  // a test (or real) event lands, even for accounts not mapped to a client.
  if (url.searchParams.get('scope') === 'webhookstatus') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    try {
      const store = getStore({ name: 'meta-webhooks', consistency: 'strong' })
      const { blobs } = await store.list()
      // Map each stored account id back to a client name where we can.
      const acctToClient = {}
      for (const [cid, cc] of Object.entries(CLIENTS)) if (cc.meta) acctToClient[String(cc.meta).replace(/\D/g, '')] = cid
      const accounts = []; let events = []
      for (const b of (blobs || [])) {
        const rec = await store.get(b.key, { type: 'json' }).catch(() => null); if (!rec) continue
        const acctDigits = b.key.replace(/^acct:/, '')
        accounts.push({ acct: acctDigits, client: acctToClient[acctDigits] || null, ads: Object.keys(rec.ads || {}).length, updatedAt: rec.updatedAt || null, verified: !!rec.verified })
        for (const e of (rec.events || [])) events.push({ acct: acctDigits, client: acctToClient[acctDigits] || null, adId: e.adId, level: e.level, field: e.field, ts: e.ts })
      }
      events.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))); events = events.slice(0, 30)
      return json({ scope: 'webhookstatus', endpoint: '/.netlify/functions/meta-webhook', accounts, events, everReceived: events.length > 0 }, 200)
    } catch (e) { return json({ scope: 'webhookstatus', error: String(e.message || e).slice(0, 200), accounts: [], events: [] }, 200) }
  }

  // Meta's own ad recommendations (webhook field ad_recommendations), grouped by
  // client. The webhook flags that a recommendation exists for an ad/account; we
  // surface the events and whatever detail the payload carried, newest first.
  if (url.searchParams.get('scope') === 'recommendations') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    try {
      const store = getStore({ name: 'meta-webhooks', consistency: 'strong' })
      const { blobs } = await store.list()
      const acctToClient = {}
      for (const [cid, cc] of Object.entries(CLIENTS)) if (cc.meta) acctToClient[String(cc.meta).replace(/\D/g, '')] = cid
      // Pull a few interpretable fields out of whatever shape Meta sent.
      const detailOf = (raw) => {
        if (!raw || typeof raw !== 'object') return null
        const pick = (...keys) => { for (const k of keys) if (raw[k] != null && raw[k] !== '') return String(raw[k]); return null }
        const type = pick('recommendation_type', 'type', 'category', 'name')
        const message = pick('message', 'title', 'recommendation', 'description', 'text', 'body')
        const adId = pick('ad_id', 'adgroup_id', 'id')
        // Fall back to a compact key list so nothing is silently hidden.
        const other = Object.keys(raw).filter((k) => !['recommendation_type', 'type', 'category', 'name', 'message', 'title', 'recommendation', 'description', 'text', 'body', 'ad_id', 'adgroup_id', 'id'].includes(k)).slice(0, 6)
        return { type, message, adId, extra: other.map((k) => `${k}: ${JSON.stringify(raw[k]).slice(0, 60)}`) }
      }
      const groups = {}
      for (const b of (blobs || [])) {
        const rec = await store.get(b.key, { type: 'json' }).catch(() => null); if (!rec) continue
        const acctDigits = b.key.replace(/^acct:/, ''); const client = acctToClient[acctDigits] || null
        for (const e of (rec.events || [])) {
          if (e.field !== 'ad_recommendations') continue
          const gk = client || `acct:${acctDigits}`
          const g = groups[gk] || (groups[gk] = { client, acct: acctDigits, items: [] })
          g.items.push({ ts: e.ts, adId: e.adId, detail: detailOf(e.raw) })
        }
      }
      // Newest first per client; collapse exact repeats (same ad + same detail).
      const out = Object.values(groups).map((g) => {
        const seen = new Set(); const items = []
        for (const it of g.items.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))) {
          const sig = `${it.adId}|${it.detail ? it.detail.type + it.detail.message : ''}`
          if (seen.has(sig)) continue; seen.add(sig); items.push(it)
        }
        return { ...g, items: items.slice(0, 40), count: items.length, latest: items[0] ? items[0].ts : null }
      }).sort((a, b) => String(b.latest || '').localeCompare(String(a.latest || '')))
      return json({ scope: 'recommendations', groups: out, total: out.reduce((n, g) => n + g.count, 0) }, 200)
    } catch (e) { return json({ scope: 'recommendations', error: String(e.message || e).slice(0, 200), groups: [] }, 200) }
  }

  // Meta opportunity score + recommendations - pulled live from the Graph API
  // using the stored System User token (META_SYSTEM_TOKEN). One client per call.
  if (url.searchParams.get('scope') === 'opportunity') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'opportunity', client, meta: false })
    const token = process.env.META_SYSTEM_TOKEN
    if (!token) return json({ scope: 'opportunity', client, configured: false })
    try {
      const gv = 'v21.0'
      const acct = `act_${String(cc.meta).replace(/^act_/, '')}`
      const api = `https://graph.facebook.com/${gv}/${acct}/recommendations?access_token=${encodeURIComponent(token)}`
      const r = await fetch(api)
      const j = await r.json().catch(() => ({}))
      if (j && j.error) return json({ scope: 'opportunity', client, configured: true, error: (j.error.message || 'Graph error').slice(0, 240), code: j.error.code || null }, 200)
      const arr = j.recommendations || j.data || []
      const recs = arr.map((x) => { const c = x.recommendation_content || x
        return { type: x.type || x.recommendation_type || null, body: c.body || x.body || x.message || null, lift: c.lift_estimate || x.lift_estimate || null, points: num(c.opportunity_score_lift != null ? c.opportunity_score_lift : x.opportunity_score_lift) || null, stage: x.recommendation_stage || null, url: x.url || null } })
        .sort((a, b) => (b.points || 0) - (a.points || 0))
      const score = j.opportunity_score != null ? num(j.opportunity_score) : (j.summary && j.summary.opportunity_score != null ? num(j.summary.opportunity_score) : null)
      return json({ scope: 'opportunity', client, configured: true, score, recommendations: recs.slice(0, 12) }, 200, true)
    } catch (e) { return json({ scope: 'opportunity', client, configured: true, error: String(e.message || e).slice(0, 240) }, 200) }
  }

  // Meta anomaly / delivery-health signal for the Meta Insights tab - one client
  // per request, current vs prior-window movement in the key delivery metrics.
  if (url.searchParams.get('scope') === 'anomalies') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'anomalies', client, meta: false, alerts: [], summary: { high: 0, med: 0, good: 0 } })
    try {
      const res = await buildAnomalies(cc.meta, from, to, preset, key)
      return json({ scope: 'anomalies', client, ...res }, 200, true)
    } catch (e) { return json({ scope: 'anomalies', client, error: String(e.message || e).slice(0, 200), alerts: [], summary: { high: 0, med: 0, good: 0 } }, 200) }
  }

  // Field probe for the Creative Cockpit: which creative-level fields Windsor's
  // Meta feed exposes (call-to-action, ad copy, destination link, video asset) -
  // used to confirm what can be auto-filled and whether a video URL is available
  // for transcription. Reports recognised + populated counts, like the Google
  // probe. Staff only; never cached.
  if (url.searchParams.get('scope') === 'creativefields') {
    if (me && me.role === 'viewer') return json({ error: 'Staff only.' }, 403)
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'creativefields', client, meta: false })
    const cand = ['ad_name', 'title', 'body', 'call_to_action_type', 'link', 'link_url', 'object_type', 'object_story_id', 'creative_id', 'video_id', 'video_url', 'creative_video_url', 'source_url', 'image_url', 'thumbnail_url', 'instagram_permalink_url', 'permalink_url', 'effective_object_story_id']
    const out = {}
    for (const f of cand) {
      try {
        const rows = (await windsorFetch('facebook', ['account_id', 'ad_name', f], from, to, preset, key)).filter((r) => !r.account_id || acctEq(r.account_id,cc.meta))
        const populated = rows.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== '').length
        out[f] = { recognised: true, populated, sample: (rows.find((r) => r[f]) || {})[f] || null }
      } catch (e) { out[f] = { recognised: false, error: String(e.message || e).slice(0, 80) } }
    }
    return json({ scope: 'creativefields', client, fields: out }, 200)
  }

  // Lean per-client GHL metrics for the Agency Overview comparison table:
  // opportunities / booked / shown / won / revenue split by channel (all / paid
  // (meta+google) / meta / google / other), for the current and previous period.
  // booked / shown use the primary key-event calendar (cal=) + its linked stage
  // (stage=) when given, else the whole-channel booked/shown. Lazy-loaded per
  // client from the frontend so the fast Windsor columns render first.
  if (url.searchParams.get('scope') === 'ovrow') {
    const cc = CLIENTS[client]
    if (!cc || !cc.ghl) return json({ scope: 'ovrow', client, ghl: false })
    if (!(await isConnected().catch(() => false))) return json({ scope: 'ovrow', client, connected: false })
    const cals = (url.searchParams.get('cal') || '').split(',').filter(Boolean)
    const stage = url.searchParams.get('stage')
    const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
    // Closed basis: swap won/revenue per channel to won-in-period (banked); leads,
    // booked, shown stay created-basis. `wc` = wonInPeriod.channels or null.
    const summ = (attr, wc) => {
      const chans = attr.channels || {}
      const byCal = (attr.appointments && attr.appointments.byCalendar) || []
      const calRecs = cals.length ? byCal.filter((c) => cals.includes(c.id)) : null
      const out = {}
      for (const ch of ['all', 'meta', 'google', 'other']) {
        const tt = (chans[ch] && chans[ch].totals) || { leads: 0, won: 0, revenue: 0, booked: 0, shown: 0 }
        let booked, shown
        if (calRecs && calRecs.length) {
          booked = 0; shown = 0
          for (const cr of calRecs) { const src = ch === 'all' ? cr : ((cr.ch && cr.ch[ch]) || {}); booked += src.booked || 0; shown += src.shown || 0 }
          if (stage) booked += Math.max(0, reachedInChannel(chans[ch], stage) - booked)
        } else { booked = tt.booked || 0; shown = tt.shown || 0 }
        const wcc = wc && wc[ch]
        out[ch] = { opps: tt.leads || 0, won: wcc ? wcc.won : (tt.won || 0), revenue: wcc ? wcc.revenue : (tt.revenue || 0), booked, shown }
      }
      const add = (a, b) => ({ opps: a.opps + b.opps, won: a.won + b.won, revenue: a.revenue + b.revenue, booked: a.booked + b.booked, shown: a.shown + b.shown })
      out.paid = add(out.meta, out.google)
      out.avgCloseDays = attr.avgCloseDays == null ? null : attr.avgCloseDays
      out.avgCloseSample = attr.avgCloseSample || 0
      return out
    }
    // One buildAttribution per request (period=cur | prev) so a request never
    // exceeds the function timeout - the frontend fires both and merges.
    const period = url.searchParams.get('period') === 'prev' ? 'prev' : 'cur'
    let fr = from, t = to
    if (period === 'prev') { const pr = prevRange(from, to); if (!pr.from) return json({ scope: 'ovrow', client, period, data: null }); fr = pr.from; t = pr.to }
    try {
      const [attr, wcp] = await Promise.all([
        buildAttribution(cc.ghl, fr, t, { lite: true }),
        (wonBasis === 'closed' && fr && t) ? wonInPeriod(cc.ghl, fr, t).catch(() => null) : Promise.resolve(null),
      ])
      return json({ scope: 'ovrow', client, period, connected: true, wonBasis, data: summ(attr, wcp && wcp.channels) }, 200, true)
    } catch (e) { return json({ scope: 'ovrow', client, period, error: String(e.message || e).slice(0, 160), data: null }, 200) }
  }

  // Cohort maturation: leads by acquisition week through the funnel.
  if (url.searchParams.get('scope') === 'cohorts') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    const weeks = Math.max(4, Math.min(26, parseInt(url.searchParams.get('weeks'), 10) || 12))
    try { const co = await buildCohortsView(cc, weeks, key); return json({ scope: 'cohorts', client, weeks, ...co }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Lightweight current-name lists (campaign / ad set / ad) for the UTM-alias
  // editor. Just the name dimensions - no metrics, no daily rows - so it stays
  // fast and complete even for large accounts where the full buildMeta pull can
  // time out and leave the alias editor with no names to match against.
  if (url.searchParams.get('scope') === 'adnames') {
    const cc = CLIENTS[client]
    if (!cc) return json({ error: `unknown client ${client}` }, 404)
    // These names are the CURRENT / live entities to link renamed UTMs to. A
    // recent window is (a) lighter - a 90-day Meta ad-level pull often times out
    // and silently drops all Meta names, leaving only Google - and (b) more
    // correct, since "live" means active lately. Clamp to ~35 days.
    const namesFrom = (() => { const t = Date.parse(to); if (!isFinite(t)) return from; const s = new Date(t - 35 * 86400000).toISOString().slice(0, 10); return (from && from > s) ? from : s })()
    const filt = (id) => (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, id))
    try {
      // Split the Meta pull: campaign + ad-set names (light) separately from the
      // ad-level names (heavier), so a slow ad pull can't wipe out the campaign /
      // ad-set names. Also pull the entity IDs so a UTM that carries a raw
      // campaign/ad-set ID (instead of the name) still matches a live entity.
      const [fbCA, fbAds, gg] = await Promise.all([
        cc.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'campaign_id', 'adset_name', 'adset_id'], namesFrom, to, '', key).then(filt(cc.meta)).catch(() => []) : Promise.resolve([]),
        cc.meta ? windsorFetch('facebook', ['account_id', 'ad_name', 'ad_id'], namesFrom, to, '', key).then(filt(cc.meta)).catch(() => []) : Promise.resolve([]),
        cc.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'campaign_id', 'ad_group_name', 'ad_group_id'], namesFrom, to, '', key).then(filt(cc.google)).catch(() => []) : Promise.resolve([]),
      ])
      // Tag every name with the channel it came from so the linker can group
      // Meta vs Google. First channel to claim a name wins (rare cross-channel dupes).
      const uniqTag = (pairs) => { const m = new Map(); for (const [n, ch] of pairs) { const s = String(n || '').trim(); if (s && !m.has(s)) m.set(s, ch) } return [...m.entries()].map(([name, channel]) => ({ name, channel })).sort((a, b) => a.name.localeCompare(b.name)) }
      const idList = (arr) => [...new Set(arr.map((v) => String(v ?? '').trim()).filter(Boolean))]
      return json({
        scope: 'adnames', client,
        campaigns: uniqTag([...fbCA.map((r) => [r.campaign, 'meta']), ...gg.map((r) => [r.campaign, 'google'])]),
        adsets: uniqTag([...fbCA.map((r) => [r.adset_name, 'meta']), ...gg.map((r) => [r.ad_group_name, 'google'])]),
        ads: uniqTag(fbAds.map((r) => [r.ad_name, 'meta'])),
        ids: {
          campaign: idList([...fbCA.map((r) => r.campaign_id), ...gg.map((r) => r.campaign_id)]),
          medium: idList([...fbCA.map((r) => r.adset_id), ...gg.map((r) => r.ad_group_id)]),
          content: idList(fbAds.map((r) => r.ad_id)),
        },
      }, 200, true)
    } catch (e) { return json({ scope: 'adnames', client, error: String((e && e.message) || e).slice(0, 160), campaigns: [], adsets: [], ads: [], ids: { campaign: [], medium: [], content: [] } }, 200) }
  }

  const c = CLIENTS[client]
  if (!c) return json({ error: `unknown client ${client}` }, 404)

  // Full CRM straight from the GoHighLevel API (richer than Windsor: named
  // lost reasons, exact timings, per-user). Assigned-user names are resolved
  // from Windsor's users table until users.readonly is added to the OAuth app.
  if (channel === 'crm') {
    if (!c.ghl) return json({ error: `no Caalano Systems account for ${client}` }, 404)
    if (!(await isConnected().catch(() => false))) return json({ connected: false, needsSetup: true })
    try {
      // Pull CRM + user-name lookup + won-in-period (realised revenue) in parallel.
      const [crm, usersRows, wonClosed] = await Promise.all([
        buildCrm(c.ghl, from, to),
        ghlUserRows(c.ghl).catch(() => []),
        (from && to) ? wonInPeriod(c.ghl, from, to).catch(() => null) : Promise.resolve(null),
      ])
      crm.wonClosed = wonClosed
      // Won basis: 'created' (default - won among leads created in the window) or
      // 'closed' (won by their won-date, i.e. banked in the window, regardless of
      // when created). Only Won/revenue/derived flip; leads, funnel, appts stay
      // created-basis. Default stays 'created' server-side so callers that don't
      // opt in (e.g. Monthly Report) are unaffected; the global "Closed" default
      // is applied by the frontend passing wonBasis=closed.
      const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
      crm._wonBasis = wonBasis
      if (wonBasis === 'closed' && wonClosed) applyClosedBasis(crm, wonClosed)
      const uName = {}; for (const u of usersRows) if (u.user_id) uName[u.user_id] = u.user_name
      const nameOf = (id) => uName[id] || (id === 'unassigned' ? 'Unassigned' : 'User ' + String(id).slice(-4))
      const nameRows = (rows) => rows.map((r) => ({ ...r, name: nameOf(r.id) }))
      crm.byUser = nameRows(crm.byUser)
      for (const p of crm.pipelines || []) if (p.byUser) p.byUser = nameRows(p.byUser)
      for (const u of crm.users || []) {
        u.name = nameOf(u.id)
        if (u.byUser) u.byUser = nameRows(u.byUser)
        for (const p of u.pipelines || []) if (p.byUser) p.byUser = nameRows(p.byUser)
      }
      return json({ client, channel, period: { from, to, preset }, crm }, 200, true)
    } catch (e) { return json({ connected: true, error: String(e.message || e) }, 502) }
  }

  // UTM attribution via the GoHighLevel API (Windsor can't provide UTMs).
  if (channel === 'attribution') {
    if (!c.ghl) return json({ error: `no Caalano Systems account for ${client}` }, 404)
    if (!(await isConnected().catch(() => false))) return json({ connected: false, needsSetup: true })
    try {
      const pipeline = url.searchParams.get('pipeline') || null
      const fn = url.searchParams.get('debug') ? sampleAttribution : buildAttribution
      // Google/Meta UTMs often carry the numeric campaign ID (e.g. utm_campaign=
      // 24053934849), not the name - so CRM outcomes keyed by that ID never match
      // the ad tables (keyed by name). Windsor returns campaign_id alongside the
      // campaign name, so pull that pairing and hand the UI a {id -> name} map to
      // auto-resolve the IDs. Own queries, each .catch → nothing blanks attribution.
      const filtG = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, c.google))
      const filtM = (rows) => rows.filter((r) => !r.account_id || acctEq(r.account_id, c.meta))
      const [attribution, ggIds, fbIds, ggAdIds] = await Promise.all([
        fn(c.ghl, from, to, pipeline ? { pipeline } : {}),
        // Google: campaign + ad-group (id ↔ name) so both levels' UTM IDs resolve.
        c.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'campaign_id', 'ad_group_name', 'ad_group_id'], from, to, preset, key).then(filtG).catch(() => []) : Promise.resolve([]),
        // Meta: campaign + ad-set (id ↔ name) + ad (id ↔ name).
        c.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'campaign_id', 'adset_name', 'adset_id', 'ad_name', 'ad_id'], from, to, preset, key).then(filtM).catch(() => []) : Promise.resolve([]),
        // Google ad_id → its ad group. Google has no ad-level table (RSAs have no
        // names), so if the CRM's utm_content carries the AD id rather than the
        // ad-group id, fold it to the ad group so the ad-group green columns still
        // populate. Own query so a field mismatch can't blank the campaign/ad-group
        // resolution above.
        c.google ? windsorFetch('google_ads', ['account_id', 'ad_group_name', 'ad_id'], from, to, preset, key).then(filtG).catch(() => []) : Promise.resolve([]),
      ])
      // {id -> name} maps per level, so a CRM UTM carrying the numeric ID resolves
      // to the live entity name for the Caalano360 outcome columns. campaign =
      // utm_campaign, medium = ad group / ad set. (Meta ad-level uses names, so its
      // creatives aren't ID-resolved here.)
      const campIdMap = {}, mediumIdMap = {}, contentIdMap = {}
      const put = (m, id, nm) => { const i = String(id ?? '').trim(); if (i && nm && !m[i]) m[i] = nm }
      for (const r of ggIds) { put(campIdMap, r.campaign_id, r.campaign); put(mediumIdMap, r.ad_group_id, r.ad_group_name) }
      for (const r of ggAdIds) { put(mediumIdMap, r.ad_id, r.ad_group_name) } // Google ad-id → ad group
      for (const r of fbIds) { put(campIdMap, r.campaign_id, r.campaign); put(mediumIdMap, r.adset_id, r.adset_name); put(contentIdMap, r.ad_id, r.ad_name) }
      attribution.campIdMap = campIdMap; attribution.mediumIdMap = mediumIdMap; attribution.contentIdMap = contentIdMap
      return json({ client, channel, period: { from, to, preset }, attribution }, 200, !url.searchParams.get('debug'))
    } catch (e) { return json({ connected: true, error: String(e.message || e) }, 502) }
  }

  // Caalano360 - blended paid + CRM aggregate for a single client.
  if (channel === 'blend') {
    try {
      const [blend, wonClosed] = await Promise.all([
        buildBlend(c, from, to, preset, key),
        (c.ghl && from && to) ? wonInPeriod(c.ghl, from, to).catch(() => null) : Promise.resolve(null),
      ])
      blend.wonClosed = wonClosed
      const wonBasis = url.searchParams.get('wonBasis') === 'closed' ? 'closed' : 'created'
      blend._wonBasis = wonBasis
      if (wonBasis === 'closed' && wonClosed) applyClosedBasisBlend(blend, wonClosed)
      return json({ client, channel, period: { from, to, preset }, blend }, 200, true)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Google Analytics 4 - its own connector + mapping key (c.ga4), so it's routed
  // before the generic FIELDS lookup.
  if (channel === 'ganalytics') {
    const propertyId = c.ga4
    if (!propertyId) return json({ error: `no GA4 property for ${client}. Add one in Settings.` }, 404)
    if (url.searchParams.get('probe') === '1') {
      // Field probe: report which GA4 field names Windsor recognises + populates,
      // so the exact spellings can be confirmed against the live account.
      const cand = ['date', 'sessions', 'engaged_sessions', 'engagement_rate', 'bounce_rate', 'event_count', 'conversions', 'key_events', 'screen_page_views', 'page_views', 'total_users', 'new_users', 'active_users', 'average_session_duration', 'session_source', 'session_medium', 'session_source_medium', 'source_medium', 'session_default_channel_grouping', 'default_channel_group', 'landing_page', 'landing_page_plus_query_string', 'event_name', 'device_category']
      const results = {}
      await Promise.all(cand.map(async (f) => {
        try { const rows = await windsorGa4(['account_id', f], from, to, preset, key); results[f] = { ok: true, rows: rows.length, sample: rows[0] ? rows[0][f] : null } }
        catch (e) { results[f] = { ok: false, error: String(e.message || e).slice(0, 80) } }
      }))
      return json({ probe: await resolveGa4Slug(key), propertyId, fields: results })
    }
    try {
      const ganalytics = await buildGanalytics(propertyId, from, to, preset, key)
      return json({ client, channel, period: { from, to, preset }, ganalytics }, 200, true)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  const spec = FIELDS[channel]
  if (!spec) return json({ error: `unknown channel ${channel}` }, 400)
  const accountId = c[channel]
  if (!accountId) return json({ error: `no ${channel} account for ${client}` }, 404)

  // Field probe: request a broad set of candidate google keyword/search-term
  // field names and report which Windsor recognises + which carry data.
  if (url.searchParams.get('probe') === '1') {
    const cand = ['campaign', 'ad_group_name', 'keyword', 'criteria', 'keyword_text', 'search_keyword', 'search_term', 'search_query', 'query', 'search_keyword_match_type', 'keyword_match_type', 'match_type', 'quality_score', 'historical_quality_score', 'spend', 'clicks', 'conversions']
    try {
      const rows = await windsorFetch('google_ads', ['account_id', ...cand], from, to, preset, key)
      const mine = rows.filter((r) => !r.account_id || acctEq(r.account_id,accountId))
      const recognised = mine[0] ? Object.keys(mine[0]) : []
      const populated = {}
      for (const f of cand) populated[f] = mine.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== '').length
      return json({ probe: 'google_ads', accountId, rowCount: mine.length, recognisedFields: recognised, populatedCounts: populated, sample: mine.slice(0, 3) })
    } catch (e) { return json({ probe: 'google_ads', error: String(e.message || e) }, 502) }
  }

  try {
    if (channel === 'google') {
      const google = await buildGoogle(accountId, from, to, preset, key)
      return json({ client, channel, period: { from, to, preset }, google }, 200, true)
    }
    if (channel === 'meta') {
      const fallback = await readMetaPrimary(client)
      const meta = await buildMeta(accountId, from, to, preset, key, fallback)
      return json({ client, channel, period: { from, to, preset }, meta }, 200, true)
    }
    const fields = [...spec.dims, ...spec.metrics]
    const rowsAll = await windsorFetch(spec.connector, fields, from, to, preset, key)
    const rows = rowsAll.filter((r) => !r.account_id || acctEq(r.account_id,accountId))
    if (debug) return json({ channel, accountId, fieldsRequested: fields, rowCount: rows.length, sample: rows.slice(0, 3), sampleKeys: rows[0] ? Object.keys(rows[0]) : [] })
    return json({ client, channel, period: { from, to, preset }, ghl: rollupGhl(rows) }, 200, true)
  } catch (e) {
    return json({ error: String(e.message || e) }, 502)
  }
}
