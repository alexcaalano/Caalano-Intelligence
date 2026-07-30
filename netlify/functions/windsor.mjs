// Live data backend — Windsor.ai primary. Reads WINDSOR_API_KEY from Netlify env.
// Query params:
//   client   : client id (see CLIENTS map)
//   channel  : meta | google | ghl
//   from,to  : YYYY-MM-DD  (or) preset : e.g. last_30d, last_month, this_month
//   debug    : if set, returns the raw Windsor rows + the fields requested
//              (used to confirm exact Windsor field names against live data)
//
// NOTE: metric field names marked VERIFY are best-guess until confirmed via a
// debug call; they live in one place (FIELDS) so they are trivial to correct.

import { buildAttribution, sampleAttribution, sampleChannels, buildCrm, auditLocation, isConnected, bookedTrends, attributionCoverage, wonInPeriod, monthlyDeals, oppTimestampFields, tagAudit, locationTimezone, periodBounds, listCalendars, listLocations, customClients, sampleForms, buildForms, buildSpeedToLead, speedLeadList, speedScanChunk, finalizeSpeed, buildAppointmentInsights, buildUserPerformance, buildCreativePerf, buildUpdateExtra, fetchOppNotes, deriveBusinessHours, isQualified, buildCohorts as ghlCohorts, buildCcDrill } from '../lib/ghl.mjs'
import { getStore } from '@netlify/blobs'
import { currentUser, canSeeClient } from '../lib/auth.mjs'
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
// Meta "Leads" that matches Ads Manager. The bare `actions_lead` field is a
// superset (native Facebook leads + off-Facebook website-pixel leads) and
// double-counts, over-reporting. Ads Manager's Leads result is the native
// lead-form outcome (Instant Form + on-Facebook lead/Messenger); website
// conversion campaigns report under the pixel field, so use that as a fallback.
const FB_LEAD_FIELDS = ['actions_leadgen_grouped', 'actions_onsite_conversion_lead_grouped', 'actions_offsite_conversion_fb_pixel_lead']
// Candidate Meta conversion events offered in the per-client conversion picker
// (Settings → Meta conversions). We query these for the account and only surface
// the ones that actually fired. Custom pixel conversions (custom_*) are the
// client's own funnel events (e.g. booked_appointment). Extend freely — unknown
// events fall back to a prettified label.
const META_CONV_CANDIDATES = [
  ['actions_leadgen_grouped', 'Lead — Instant Form'],
  ['actions_onsite_conversion_lead_grouped', 'Lead — on-Facebook'],
  ['actions_offsite_conversion_fb_pixel_lead', 'Lead — website pixel'],
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
  ['actions_click_to_call_call_confirm', 'Click to call — confirmed'],
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
  'conversions_submit_application_total',
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
const prettyField = (id) => META_CONV_LABEL[id] || String(id || '').replace(/^(conversions_|actions_)/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// Auto-detect a row's result field + Ads-Manager-style label from its ad set
// optimisation goal + destination + promoted object. Returns null when it can't
// be resolved (e.g. a custom conversion), so the caller falls back to the
// client's configured primary.
function resolveMetaResult(row) {
  const goal = String(row.adsset_optimization_goal || '').toUpperCase()
  const dest = String(row.adset_destination_type || '').toUpperCase()
  let promoted = {}
  try { promoted = row.adset_promoted_object ? (typeof row.adset_promoted_object === 'string' ? JSON.parse(row.adset_promoted_object) : row.adset_promoted_object) : {} } catch { promoted = {} }
  const evt = String(promoted.custom_event_type || '').toUpperCase()
  // Lead-gen = Instant Forms (or on-Facebook leads) — count the native lead form
  // submissions, not the website pixel lead.
  if (goal === 'LEAD_GENERATION' || goal === 'QUALITY_LEAD') return { field: 'leads_native', label: dest === 'ON_AD' || dest === 'MESSENGER' ? 'On-Facebook leads' : 'Instant form leads' }
  if (goal.includes('CONVERSATION') || goal === 'MESSAGING_PURCHASE_CONVERSION') return { field: 'actions_onsite_conversion_messaging_conversation_started_7d', label: 'Messaging conversations' }
  if (goal === 'OFFSITE_CONVERSIONS' || goal === 'ONSITE_CONVERSIONS' || goal === 'CONVERSIONS') {
    const m = META_EVENT_FIELD[evt]; if (!m) return null
    const prefix = DEST_PREFIX[dest] || (goal === 'ONSITE_CONVERSIONS' ? 'On-Facebook' : 'Website')
    return { field: m[0], label: `${prefix} ${m[1]}` }
  }
  if (goal === 'LINK_CLICKS') return { field: 'inline_link_clicks', label: 'Link clicks' }
  return null
}
// Resolve a row's result using auto-detect first, then the client's configured
// primary conversion, then leads as the last resort. Returns {field,label,auto}.
function rowResult(entity, fallback) {
  const auto = resolveMetaResult({ adsset_optimization_goal: entity.optGoal, adset_destination_type: entity.destType, adset_promoted_object: entity.promoted })
  if (auto) return { field: auto.field, label: auto.label, auto: true }
  if (fallback && fallback.field) return { field: fallback.field, label: cap1(prettyField(fallback.field)), auto: false }
  return { field: null, label: 'Leads', auto: false }
}
// 'leads_native' = Instant Form + on-Facebook leads (matches Ads Manager's
// lead-gen "Results"); null field = fbLeads; else the raw conversion field.
const resultCount = (entity, field) => field === 'inline_link_clicks' ? entity.linkClicks
  : field === 'leads_native' ? ((entity._rf ? (entity._rf.actions_leadgen_grouped || 0) + (entity._rf.actions_onsite_conversion_lead_grouped || 0) : 0) || entity.leads)
  : field ? (entity._rf ? entity._rf[field] || 0 : 0) : entity.leads
// All conversion actions an entity accrued (non-zero), for the results hover —
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

// The equal-length period immediately before [from,to] — for ±vs-previous deltas.
function prevRange(from, to) {
  if (!from || !to) return { from: null, to: null }
  const f = new Date(from + 'T00:00:00Z'), t = new Date(to + 'T00:00:00Z')
  const days = Math.round((t - f) / 86400000) + 1
  const pt = new Date(f); pt.setUTCDate(pt.getUTCDate() - 1)
  const pf = new Date(pt); pf.setUTCDate(pf.getUTCDate() - (days - 1))
  const isod = (d) => d.toISOString().slice(0, 10)
  return { from: isod(pf), to: isod(pt) }
}

async function windsorFetch(connector, fields, from, to, preset, key) {
  const p = new URLSearchParams({ api_key: key, fields: fields.join(',') })
  if (from && to) { p.set('date_from', from); p.set('date_to', to) }
  else { p.set('date_preset', preset || 'last_30d') }
  const url = `https://connectors.windsor.ai/${connector}?${p.toString()}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Windsor ${connector} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return j.data || j.result || []
}

// Aggregate a set of Meta rows by a key field into a metrics map. Leads use the
// Ads-Manager-matching definition (fbLeads), not the double-counting superset.
function aggMeta(rows, keyField) {
  const m = new Map()
  for (const r of rows) {
    const k = r[keyField]; if (!k) continue
    let e = m.get(k)
    if (!e) { e = { name: k, campaign: r.campaign || null, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0, _rf: {}, optGoal: null, destType: null, promoted: null }; m.set(k, e) }
    e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks)
    e.linkClicks += num(r.inline_link_clicks); e.leads += fbLeads(r); e.videoViews += num(r.actions_video_view); e.reach += num(r.reach)
    for (const f of META_RESULT_FIELDS) e._rf[f] = (e._rf[f] || 0) + num(r[f])
    if (!e.optGoal && r.adsset_optimization_goal) e.optGoal = r.adsset_optimization_goal
    if (!e.destType && r.adset_destination_type) e.destType = r.adset_destination_type
    if (!e.promoted && r.adset_promoted_object) e.promoted = r.adset_promoted_object
  }
  return [...m.values()]
}
const clean = (e) => { const { _rf, optGoal, destType, promoted, ...v } = e; return v }
function rollupMeta(adRows, dayRows, accRows, campRows, adsetRows, pCampRows, fallback) {
  // FIX A: campaign / ad-set counts come from Meta's own per-level breakdowns
  // (de-duplicated at each level), not from summing the ad rows, so they match
  // Meta Ads Manager instead of inflating via cross-ad attribution.
  const campaignsRaw = aggMeta(campRows, 'campaign').sort((a, b) => b.spend - a.spend)
  const prevCamp = new Map()
  for (const c of aggMeta(pCampRows || [], 'campaign')) prevCamp.set(c.name, c)
  // Ad sets carry the optimisation goal + promoted object, so results resolve
  // here first; campaign + ad results are rolled up / joined from them.
  const adsets = aggMeta(adsetRows, 'adset_name').sort((a, b) => b.spend - a.spend)
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
  const readField = (r, field) => field === 'inline_link_clicks' ? num(r.inline_link_clicks) : field === 'leads_native' ? fbLeads(r) : field ? num(r[field]) : fbLeads(r)
  const ads = adRows.map((r) => {
    const parent = adsetByName.get(r.adset_name)
    const field = parent ? parent.resultField : (fallback && fallback.field) || null
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
    if (mc && mc.primary) return { field: mc.primary, label: prettyField(mc.primary) }
  } catch { /* ignore */ }
  return null
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
  try { Object.assign(CLIENTS, await customClients()) } catch { /* non-fatal */ }
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

async function buildMeta(accountId, from, to, preset, key, fallback) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const pr = prevRange(from, to)
  const accFields = ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, 'actions_video_view']
  const campFields = ['account_id', 'campaign', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...META_RESULT_FIELDS, 'actions_video_view']
  // Ad-set query carries the optimisation goal + promoted object so results
  // auto-detect per ad set.
  const adsetFields = ['account_id', 'campaign', 'adset_name', 'adsset_optimization_goal', 'adset_destination_type', 'adset_promoted_object', 'campaign_objective', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...META_RESULT_FIELDS, 'actions_video_view']
  const [adRows, dayRows, accRows, prevRows, adDayRows, campRows, adsetRows, pCampRows] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'reach', 'instagram_permalink_url', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...META_RESULT_FIELDS, 'actions_video_view'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS], from, to, preset, key).then(filt),
    windsorFetch('facebook', accFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', accFields, pr.from, pr.to, null, key).then(filt) : Promise.resolve([]),
    windsorFetch('facebook', ['account_id', 'date', 'campaign', 'adset_name', 'ad_name', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS], from, to, preset, key).then(filt),
    windsorFetch('facebook', campFields, from, to, preset, key).then(filt),
    windsorFetch('facebook', adsetFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', campFields, pr.from, pr.to, null, key).then(filt) : Promise.resolve([]),
  ])
  const roll = rollupMeta(adRows, dayRows, accRows, campRows, adsetRows, pCampRows, fallback)
  roll.prev = metaTotals(prevRows)
  roll.adDaily = adDayRows.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adset: r.adset_name, ad: r.ad_name, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), linkClicks: num(r.inline_link_clicks), leads: fbLeads(r) })).filter((r) => r.date && r.ad)
  return roll
}

// --- Meta Creative Fatigue (proxy) -----------------------------------------
// Meta's own creative_fatigue signal is webhook-push-only (not queryable), so
// this approximates the same Low/Med/High from the signals we CAN pull via
// Windsor: frequency (impressions / reach — the leading indicator), CTR decline
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
    // Quality ranking is a relevance signal, not fatigue on its own — it can only
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
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const [adRows, dayRows] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'reach', 'impressions', 'clicks', 'spend', 'actions_video_view'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'date', 'ad_name', 'impressions', 'clicks'], from, to, preset, key).then(filt),
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
// stalls and high-spend zero-lead ads. Pure Windsor data — no Meta App needed.
async function buildAnomalies(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const pr = prevRange(from, to)
  const accFields = ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', ...FB_LEAD_FIELDS, 'actions_video_view']
  const [curRows, prevRows, adRows] = await Promise.all([
    windsorFetch('facebook', accFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', accFields, pr.from, pr.to, null, key).then(filt) : Promise.resolve([]),
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'reach', 'spend', 'impressions', 'clicks', ...FB_LEAD_FIELDS], from, to, preset, key).then(filt),
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
    if (ch <= -0.35) alerts.push({ metric: 'ctr', severity: 'high', dir: 'down', pct: Math.round(-ch * 100), cur: c.ctr, prev: p.ctr, title: 'Click-through rate dropped', detail: `down ${Math.round(-ch * 100)}% — creative or audience wearing out` })
    else if (ch <= -0.2) alerts.push({ metric: 'ctr', severity: 'med', dir: 'down', pct: Math.round(-ch * 100), cur: c.ctr, prev: p.ctr, title: 'Click-through rate slipping', detail: `down ${Math.round(-ch * 100)}% vs the prior window` })
  }
  // Frequency (audience saturation) — absolute, not relative.
  if (material && c.freq != null) {
    if (c.freq >= 6) alerts.push({ metric: 'freq', severity: 'high', cur: c.freq, prev: p.freq, title: 'High frequency', detail: `each person saw an ad ${c.freq.toFixed(1)}x on average — audience saturating` })
    else if (c.freq >= 4) alerts.push({ metric: 'freq', severity: 'med', cur: c.freq, prev: p.freq, title: 'Frequency climbing', detail: `${c.freq.toFixed(1)}x average frequency — widen the audience or refresh creative` })
  }
  // Delivery stall — spend collapsed vs a materially-spending prior window.
  if (p.spend >= 100 && c.spend < p.spend * 0.4) {
    alerts.push({ metric: 'spend', severity: 'high', dir: 'down', pct: Math.round((1 - (p.spend ? c.spend / p.spend : 0)) * 100), cur: c.spend, prev: p.spend, title: 'Spend stalled', detail: `only ${p.spend ? Math.round((c.spend / p.spend) * 100) : 0}% of the prior window's spend delivered — check budgets and delivery` })
  }
  // Spend up but leads not keeping pace.
  if (material && p.spend > 0) {
    const sCh = pct(c.spend, p.spend), lCh = p.leads ? pct(c.leads, p.leads) : null
    if (sCh >= 0.6 && (lCh == null || lCh < sCh * 0.5)) alerts.push({ metric: 'spendleads', severity: 'med', dir: 'up', pct: Math.round(sCh * 100), cur: c.spend, prev: p.spend, title: 'Spend up, leads flat', detail: `spend up ${Math.round(sCh * 100)}% but leads ${lCh == null ? 'not tracking' : (lCh < 0 ? `down ${Math.round(-lCh * 100)}%` : `only up ${Math.round(lCh * 100)}%`)}` })
  }
  // Zero-lead spend — the account is spending but reporting no leads at all.
  if (c.spend >= 100 && c.leads === 0) alerts.push({ metric: 'noleads', severity: 'high', cur: c.spend, prev: null, title: 'Spending with no leads', detail: `${Math.round(c.spend)} spent this window with zero reported leads — check tracking and delivery` })
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
  // campaign — this is what makes campaign→ad-group drill-down filter correctly.
  const agM = new Map()
  for (const r of cg) { const ag = cleanAg(r), camp = r.campaign; if (!ag || !camp) continue; const k = camp + '|' + ag; const e = agM.get(k) || { name: ag, campaign: camp, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); agM.set(k, e) }
  const adGroups = [...agM.values()].filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost)
  // Keywords keyed by (campaign, ad group, keyword) — a keyword that runs in two
  // campaigns is two rows, each scoped, so drill-down never loses/merges them.
  const kwM = new Map()
  for (const r of kw) { const t = r.keyword_text; if (!t) continue; const camp = r.campaign || null, ag = cleanAg(r) || null; const k = camp + '|' + ag + '|' + t; const e = kwM.get(k) || { text: t, campaign: camp, adGroup: ag, match: titleCase(r.match_type) || '—', qsSum: 0, qsN: 0, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); if (num(r.quality_score)) { e.qsSum += num(r.quality_score); e.qsN++ } kwM.set(k, e) }
  const keywords = [...kwM.values()].map((e) => ({ text: e.text, campaign: e.campaign, adGroup: e.adGroup, match: e.match, qs: e.qsN ? Math.max(1, Math.min(10, Math.round(e.qsSum / e.qsN))) : '', cost: e.cost, impressions: e.impressions, clicks: e.clicks, conversions: e.conversions })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 400)
  const mt = new Map()
  for (const r of kw) { const t = titleCase(r.match_type); if (!t) continue; const e = mt.get(t) || { type: t, cost: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.clicks += num(r.clicks); e.conversions += num(r.conversions); mt.set(t, e) }
  // Search terms keyed by (campaign, ad group, keyword, term) — carries its
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
async function buildOverview(from, to, preset, key) {
  const metaRev = {}, googleRev = {}, ghlRev = {}
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaRev[norm(c.meta)] = id; if (c.google) googleRev[norm(c.google)] = id; if (c.ghl) ghlRev[norm(c.ghl)] = id }
  // last-8-day daily spend (yesterday + prior week) for zero-spend alerts
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const yest = new Date(today); yest.setUTCDate(yest.getUTCDate() - 1)
  const base0 = new Date(today); base0.setUTCDate(base0.getUTCDate() - 8)
  // Previous equal-length period for the agency comparison table (fast Windsor
  // ad metrics only; the GHL columns fetch their own prev per client lazily).
  const pr = prevRange(from, to)
  const [fb, gg, opps, fbD, ggD, pFb, pGg] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'spend', 'impressions', 'clicks', ...FB_LEAD_FIELDS], from, to, preset, key),
    windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key),
    windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_monetary_value'], from, to, preset, key).catch(() => []),
    windsorFetch('facebook', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
    pr.from ? windsorFetch('facebook', ['account_id', 'spend', ...FB_LEAD_FIELDS], pr.from, pr.to, null, key).catch(() => []) : Promise.resolve([]),
    pr.from ? windsorFetch('google_ads', ['account_id', 'spend', 'conversions'], pr.from, pr.to, null, key).catch(() => []) : Promise.resolve([]),
  ])
  const clients = {}
  const ensure = (id) => (clients[id] = clients[id] || {})
  for (const r of fb) {
    const id = metaRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.meta = e.meta || { spend: 0, impressions: 0, clicks: 0, leads: 0 }
    e.meta.spend += num(r.spend); e.meta.impressions += num(r.impressions); e.meta.clicks += num(r.clicks); e.meta.leads += fbLeads(r)
  }
  for (const r of gg) {
    const id = googleRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.google = e.google || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.google.cost += num(r.spend); e.google.impressions += num(r.impressions); e.google.clicks += num(r.clicks); e.google.conversions += num(r.conversions)
  }
  for (const r of pFb) {
    const id = metaRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.metaPrev = e.metaPrev || { spend: 0, leads: 0 }
    e.metaPrev.spend += num(r.spend); e.metaPrev.leads += fbLeads(r)
  }
  for (const r of pGg) {
    const id = googleRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.googlePrev = e.googlePrev || { cost: 0, conversions: 0 }
    e.googlePrev.cost += num(r.spend); e.googlePrev.conversions += num(r.conversions)
  }
  for (const r of opps) {
    const id = ghlRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.crm = e.crm || { revenue: 0, won: 0 }
    if (String(r.opportunity_status || '').toLowerCase() === 'won') { e.crm.revenue += num(r.opportunity_monetary_value); e.crm.won++ }
  }
  // Zero-spend alerts: an account that spent over the prior week but $0 yesterday
  // has likely paused (failed payment / budget exhausted / manual pause).
  const yStr = dstr(yest)
  const daySplit = (rows, revMap) => {
    const per = {}
    for (const r of rows) { const id = revMap[norm(r.account_id)]; if (!id) continue; const d = String(r.date || '').slice(0, 10); const e = per[id] = per[id] || { yest: 0, base: 0 }; if (d === yStr) e.yest += num(r.spend); else e.base += num(r.spend) }
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
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaId[norm(c.meta)] = id; if (c.google) googleId[norm(c.google)] = id; if (c.ghl) ghlId[norm(c.ghl)] = id }
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - 55)
  const [fb, gg, opps, pipes] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'date', 'spend', ...FB_LEAD_FIELDS], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_created_at'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], dstr(start), dstr(today), null, key).catch(() => []),
  ])
  const days = []; for (let i = 0; i < 56; i++) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); days.push(dstr(d)) }
  const dayIndex = new Map(days.map((d, i) => [d, i])) // 0 = today, larger = older
  const mk = () => new Float64Array(56)
  const cl = {}
  const ensure = (id) => (cl[id] = cl[id] || { metaSpend: mk(), metaLeads: mk(), gSpend: mk(), gConv: mk(), wBooked: mk(), bAll: mk(), bMeta: mk(), bGoogle: mk(), ghlBooked: false })
  for (const r of fb) { const id = metaId[norm(r.account_id)]; if (!id) continue; const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue; const e = ensure(id); e.metaSpend[di] += num(r.spend); e.metaLeads[di] += fbLeads(r) }
  for (const r of gg) { const id = googleId[norm(r.account_id)]; if (!id) continue; const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue; const e = ensure(id); e.gSpend[di] += num(r.spend); e.gConv[di] += num(r.conversions) }
  // Windsor blended booked (fallback when the GHL app isn't connected / a client's fetch fails)
  const idxByAcct = {}; { const byAcct = {}; for (const p of pipes) { const id = ghlId[norm(p.account_id)]; if (!id) continue; (byAcct[id] = byAcct[id] || []).push(p) } for (const [id, arr] of Object.entries(byAcct)) idxByAcct[id] = stageIndex(arr) }
  for (const r of opps) {
    const id = ghlId[norm(r.account_id)]; if (!id) continue
    const di = dayIndex.get(String(r.opportunity_created_at || '').slice(0, 10)); if (di == null) continue
    const e = ensure(id); const idx = idxByAcct[id]; const pi = idx && idx.get(r.opportunity_pipeline_id)
    const st = String(r.opportunity_status || '').toLowerCase(); const stg = pi ? pi.byId[r.opportunity_pipeline_stage_id] : null; const pos = stg ? stg.pos : -1
    if (st === 'won' || (pi && pi.bookPos != null && pos >= pi.bookPos)) e.wBooked[di]++
  }
  // GHL direct API: UTM-split booked calls per channel (meta / google / other).
  const ghlOK = await isConnected().catch(() => false)
  if (ghlOK) {
    const ghlClients = Object.entries(CLIENTS).filter(([, c]) => c.ghl)
    await Promise.all(ghlClients.map(async ([id, c]) => {
      try {
        const rows = await bookedTrends(c.ghl, dstr(start), dstr(today))
        const e = ensure(id); e.ghlBooked = true
        for (const r of rows) { const di = dayIndex.get(r.date); if (di == null) continue; e.bAll[di]++; if (r.channel === 'meta') e.bMeta[di]++; else if (r.channel === 'google') e.bGoogle[di]++ }
      } catch { /* keep Windsor blended fallback */ }
    }))
  }
  const WINDOWS = [3, 7, 14, 21, 28]
  const sumR = (arr, a, b) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s }
  const out = {}
  for (const [id, c] of Object.entries(CLIENTS)) {
    if (!c.meta && !c.google && !c.ghl) continue
    const E = ensure(id)
    const blendedBooked = E.ghlBooked ? E.bAll : E.wBooked
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
      }
    })
    out[id] = { hasMeta: !!c.meta, hasGoogle: !!c.google, hasCrm: !!c.ghl, utmBooked: E.ghlBooked, windows }
  }
  return { clients: out }
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
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
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
async function buildWeekly(c, weeks, key) {
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
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
  const [fb, gg, opps, pipes] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'date', 'spend', ...FB_LEAD_FIELDS], start, end, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], start, end, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at'], start, end, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], start, end, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
  ])
  const B = weekStarts.map((w) => ({ week: w, weekNum: isoWeek(w), metaSpend: 0, gSpend: 0, metaLeads: 0, gConv: 0, crmLeads: 0, booked: 0, shown: 0, won: 0, wonValue: 0 }))
  for (const r of fb) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; B[i].metaSpend += num(r.spend); B[i].metaLeads += fbLeads(r) }
  for (const r of gg) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; B[i].gSpend += num(r.spend); B[i].gConv += num(r.conversions) }
  const idx = stageIndex(pipes)
  for (const r of opps) {
    const i = wkIndex.get(mondayOf(String(r.opportunity_created_at || '').slice(0, 10))); if (i == null) continue
    const b = B[i]; b.crmLeads++
    const pi = idx.get(r.opportunity_pipeline_id); const st = String(r.opportunity_status || '').toLowerCase()
    const stg = pi ? pi.byId[r.opportunity_pipeline_stage_id] : null; const pos = stg ? stg.pos : -1; const isWon = st === 'won'
    if (isWon) { b.won++; b.wonValue += num(r.opportunity_monetary_value) }
    if (isWon || (pi && pi.bookPos != null && pos >= pi.bookPos)) b.booked++
    if (isWon || (pi && pi.showPos != null && pos >= pi.showPos)) b.shown++
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

// Geographic conversions — where conversions happen. Google Ads geo reports
// can't always combine a location dim with other segments, so we probe a few
// candidate Windsor field names one at a time and use the first that returns
// populated, conversion-bearing rows. Returns {dim, locations:[{name,conversions,cost}]}.
async function fetchGeo(accountId, from, to, preset, key) {
  const cands = ['city', 'geo_target_city', 'region_name', 'region', 'country']
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
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
    } catch { /* field not recognised — try the next candidate */ }
  }
  return { dim: null, locations: [] }
}

async function buildGoogle(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const pr = prevRange(from, to)
  const [cg, kw, st, dy, prev, agDay, stDay, ca, geo] = await Promise.all([
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'ad_group', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'keyword_text', 'match_type', 'quality_score', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'search_term', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    pr.from ? windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], pr.from, pr.to, null, key).then(filt) : Promise.resolve([]),
    windsorFetch('google_ads', ['account_id', 'date', 'campaign', 'ad_group_name', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'date', 'campaign', 'ad_group_name', 'search_term', 'spend', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'conversion_action_name', 'conversion_action_category', 'conversions', 'all_conversions', 'conversions_value'], from, to, preset, key).then(filt),
    fetchGeo(accountId, from, to, preset, key).catch(() => ({ dim: null, locations: [] })),
  ])
  const roll = rollupGoogle(cg, kw, st, dy, daysInRange(from, to, preset))
  roll.geo = geo
  // Detailed rows (campaign, ad group, action) so the UI can filter them to the
  // drilled-into campaign / ad group; the front-end aggregates by action name.
  roll.conversionActions = ca.map((r) => ({ campaign: r.campaign || null, adGroup: r.ad_group_name || null, name: r.conversion_action_name, category: titleCase(String(r.conversion_action_category || '').replace(/_/g, ' ')), conversions: num(r.conversions), allConversions: num(r.all_conversions), value: num(r.conversions_value) })).filter((r) => r.name && r.allConversions > 0).slice(0, 3000)
  roll.prev = prev.reduce((a, r) => ({ cost: a.cost + num(r.spend), impressions: a.impressions + num(r.impressions), clicks: a.clicks + num(r.clicks), conversions: a.conversions + num(r.conversions) }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 })
  roll.adGroupDaily = agDay.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adGroup: r.ad_group_name || (r.ad_group ? String(r.ad_group).split('/').pop() : null), cost: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions) })).filter((r) => r.date && r.campaign)
  roll.searchTermDaily = stDay.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adGroup: r.ad_group_name || null, keyword: null, term: r.search_term, cost: num(r.spend), clicks: num(r.clicks), conversions: num(r.conversions) })).filter((r) => r.date && r.term && (r.cost > 0 || r.clicks > 0)).sort((a, b) => b.cost - a.cost).slice(0, 2500)
  return roll
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
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
  const pr = prevRange(from, to)
  const [fb, gg, oppsRaw, pipes, userRows, pFb, pGg, pOppsRaw] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'spend', ...FB_LEAD_FIELDS, 'impressions', 'clicks'], from, to, preset, key).then(filt(c.meta)) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'spend', 'conversions', 'impressions', 'clicks'], from, to, preset, key).then(filt(c.google)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at', 'opportunity_assigned_to'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'user_id', 'user_name'], from, to, preset, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
    pr.from && c.meta ? windsorFetch('facebook', ['account_id', 'spend', ...FB_LEAD_FIELDS], pr.from, pr.to, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    pr.from && c.google ? windsorFetch('google_ads', ['account_id', 'spend', 'conversions'], pr.from, pr.to, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    pr.from && c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at'], pr.from, pr.to, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
  ])
  // Windsor's GoHighLevel feed returns opportunities on a broader basis than
  // "created in period", so a short window (e.g. Today) over-counts leads vs the
  // direct API. Filter to opportunities created inside the window, in the
  // client's timezone, so the blend's leads / per-user / per-pipeline counts
  // reconcile with the Meta and CRM tabs.
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
  // Per-pipeline funnels so the UI can offer a pipeline selector — a "booking"
  // means different things across pipelines, so they're kept separate.
  const nameOf = {}, stagesOf = {}
  for (const p of pipes) {
    if (!p.pipeline_id) continue
    nameOf[p.pipeline_id] = p.pipeline_name || p.pipeline_id
    stagesOf[p.pipeline_id] = asArray(p.pipeline_stages).map((s) => ({ id: s.id, name: s.name, pos: s.position })).sort((a, b) => a.pos - b.pos)
  }
  // Build a full CRM view (account totals + per-pipeline funnels) for any opp
  // subset — the whole account, or one assigned user.
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
// A transparent 0-100 score across four pillars — Marketing, Sales, Operations,
// Revenue — each a small set of real metrics compared to a reference (the
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

async function buildHealth(c, from, to, preset, key, weights) {
  const blend = await buildBlend(c, from, to, preset, key)
  const p = blend.paid, crm = blend.crm || {}, prev = blend.prev || null
  const pc = (prev && prev.crm) || {}
  const pSpend = prev ? prev.adSpend : null
  const has = { crm: !!c.ghl, meta: !!c.meta, google: !!c.google, prev: !!prev }

  // Marketing — lead generation & paid efficiency. CRM lead count is the real
  // signal; a client with no CRM falls back to ad-reported conversions.
  const leads = c.ghl ? crm.leads : p.adConversions
  const pLeads = c.ghl ? (pc.leads != null ? pc.leads : null) : null
  const cpl = p.adSpend > 0 && leads ? p.adSpend / leads : null
  const pCpl = pSpend > 0 && pLeads ? pSpend / pLeads : null
  const marketing = pillar('Marketing', [
    { label: 'Lead volume', actual: leads, ref: pLeads, fmt: 'int', score: scoreVs(leads, pLeads, true) },
    { label: 'Cost per lead', actual: cpl, ref: pCpl, fmt: 'money', score: scoreVs(cpl, pCpl, false) },
  ])

  // Sales — conversion quality through the pipeline.
  const qRate = safeDiv(crm.qualified, crm.leads), pqRate = safeDiv(pc.qualified, pc.leads)
  const bRate = safeDiv(crm.booked, crm.leads), pbRate = safeDiv(pc.booked, pc.leads)
  const wRate = safeDiv(crm.won, crm.leads), pwRate = safeDiv(pc.won, pc.leads)
  const sales = pillar('Sales', [
    { label: 'Lead → qualified', actual: qRate, ref: pqRate, fmt: 'pct', score: scoreVs(qRate, pqRate, true) },
    { label: 'Lead → booked', actual: bRate, ref: pbRate, fmt: 'pct', score: scoreVs(bRate, pbRate, true) },
    { label: 'Lead → won', actual: wRate, ref: pwRate, fmt: 'pct', score: scoreVs(wRate, pwRate, true) },
  ])

  // Operations — execution on the leads booked (did they actually show up).
  const showRate = safeDiv(crm.shown, crm.booked), pShowRate = safeDiv(pc.shown, pc.booked)
  // Prefer a vs-previous score; fall back to an absolute band (80% good, 40% poor)
  // so a first-ever period still scores instead of showing blank.
  const showScore = scoreVs(showRate, pShowRate, true) != null ? scoreVs(showRate, pShowRate, true) : scoreBand(showRate, 0.8, 0.4)
  const ops = pillar('Operations', [
    { label: 'Show rate', actual: showRate, ref: pShowRate, fmt: 'pct', score: showScore },
  ])

  // Revenue — realised money & deal quality.
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

  // Forecast — run-rate projection of the current period from elapsed time,
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
  // No external link ⇒ on-Facebook destination — almost always a Meta lead form
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
async function buildSocial(soc, from, to, key) {
  const igId = soc.ig, fbo = soc.fbo
  const F = (connector, fields) => windsorFetch(connector, fields, from, to, null, key).catch(() => [])
  const byDate = (rows, map) => { const m = new Map(); for (const r of rows) { const d = String(r.date || r.timestamp || '').slice(0, 10); if (!d) continue; const e = m.get(d) || { date: d }; map(e, r); m.set(d, e) } return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0)
  const lastNonNull = (rows, k) => { for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][k] != null && rows[i][k] !== '') return num(rows[i][k]) } return 0 }
  const demo = (rows, nk, sk, cap) => { const out = rows.map((r) => ({ name: r[nk], size: num(r[sk]) })).filter((x) => x.name && x.size).sort((a, b) => b.size - a.size); return cap ? out.slice(0, cap) : out }

  let ig = null
  if (igId) {
    const igFilt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(igId))
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
    const dailyA = byDate(dtv, (e, r) => { e.likes = (e.likes || 0) + num(r.likes); e.comments = (e.comments || 0) + num(r.comments); e.interactions = (e.interactions || 0) + num(r.total_interactions); e.views = (e.views || 0) + num(r.views) })
    const rMap = new Map(byDate(dins, (e, r) => { e.reach = (e.reach || 0) + num(r.reach); e.newFollowers = (e.newFollowers || 0) + num(r.follower_count) }).map((d) => [d.date, d]))
    const daily = dailyA.map((d) => ({ ...d, reach: (rMap.get(d.date) || {}).reach || 0, newFollowers: (rMap.get(d.date) || {}).newFollowers || 0 }))
    const posts = media.map((m) => {
      const eng = num(m.media_engagement) || (num(m.media_like_count) + num(m.media_comments_count) + num(m.media_saved) + num(m.media_shares)); const rch = num(m.media_reach)
      return { id: m.media_id, date: String(m.timestamp || '').slice(0, 10), type: m.media_type || null, caption: String(m.media_caption || '').replace(/\s+/g, ' ').slice(0, 160), permalink: m.media_permalink || null, thumb: m.media_thumbnail_url || m.media_url || null, likes: num(m.media_like_count), comments: num(m.media_comments_count), saves: num(m.media_saved), shares: num(m.media_shares), reach: rch, views: num(m.media_views), engagement: eng, er: rch ? Math.round((eng / rch) * 1000) / 10 : null }
    }).filter((x) => x.id).sort((a, b) => b.engagement - a.engagement).slice(0, 60)
    ig = { profile: { followers: num(p.followers_count), follows: num(p.follows_count), mediaCount: num(p.media_count), username: p.username || null }, totals, daily, posts, demographics: { gender: demo(gender, 'audience_gender_name', 'audience_gender_size'), age: demo(age, 'audience_age_name', 'audience_age_size'), country: demo(country, 'audience_country_name', 'audience_country_size', 8) } }
  }

  let fb = null
  if (fbo) {
    const fbFilt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(fbo))
    const [pageRows, postRows] = await Promise.all([
      F('facebook_organic', ['account_id', 'date', 'page_fans', 'page_follows', 'page_impressions', 'page_impressions_organic', 'page_impressions_paid', 'page_impressions_unique', 'page_post_engagements', 'page_views_total', 'page_video_views', 'page_daily_follows', 'page_daily_unfollows']).then(fbFilt),
      F('facebook_organic', ['account_id', 'post_id', 'post_created_time', 'post_message_oneline', 'permalink_url', 'full_picture', 'post_impressions', 'post_impressions_organic', 'post_engagements', 'post_reactions_total', 'post_comments_total', 'post_clicks', 'post_activity_by_action_type_share']).then(fbFilt),
    ])
    const totals = { impressions: sum(pageRows, 'page_impressions'), impressionsOrganic: sum(pageRows, 'page_impressions_organic'), impressionsPaid: sum(pageRows, 'page_impressions_paid'), reachUnique: sum(pageRows, 'page_impressions_unique'), engagements: sum(pageRows, 'page_post_engagements'), pageViews: sum(pageRows, 'page_views_total'), videoViews: sum(pageRows, 'page_video_views'), newFollows: sum(pageRows, 'page_daily_follows'), unfollows: sum(pageRows, 'page_daily_unfollows') }
    const daily = byDate(pageRows, (e, r) => { e.impressionsOrganic = (e.impressionsOrganic || 0) + num(r.page_impressions_organic); e.impressionsPaid = (e.impressionsPaid || 0) + num(r.page_impressions_paid); e.engagements = (e.engagements || 0) + num(r.page_post_engagements) })
    const posts = postRows.map((p) => { const eng = num(p.post_engagements); const impr = num(p.post_impressions); return { id: p.post_id, date: String(p.post_created_time || '').slice(0, 10), message: String(p.post_message_oneline || '').replace(/\s+/g, ' ').slice(0, 160), permalink: p.permalink_url || null, picture: p.full_picture || null, impressions: impr, impressionsOrganic: num(p.post_impressions_organic), engagements: eng, reactions: num(p.post_reactions_total), comments: num(p.post_comments_total), shares: num(p.post_activity_by_action_type_share), clicks: num(p.post_clicks), er: impr ? Math.round((eng / impr) * 1000) / 10 : null } }).filter((x) => x.id).sort((a, b) => b.engagements - a.engagements).slice(0, 60)
    fb = { page: { fans: lastNonNull(pageRows, 'page_fans'), follows: lastNonNull(pageRows, 'page_follows') }, totals, daily, posts }
  }
  return { ig, fb }
}

export default async (req) => {
  const url = new URL(req.url)
  const client = url.searchParams.get('client')
  const channel = url.searchParams.get('channel') || 'meta'
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to'); const preset = url.searchParams.get('preset')
  const debug = url.searchParams.get('debug')
  const key = process.env.WINDSOR_API_KEY
  // Only cache successful, non-debug responses. Errors and debug must never be
  // cached, or a transient failure gets replayed by the CDN.
  const json = (obj, status = 200, cache = false) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': cache ? 'public, max-age=600' : 'no-store' } })

  if (!key) return json({ error: 'WINDSOR_API_KEY not set' }, 500)
  // Merge any UI-added clients (Settings -> Add client) into the registry so
  // they're recognised across every scope. Mutates the shared object; a removed
  // client clears on the next cold start.
  try { Object.assign(CLIENTS, await customClients()) } catch { /* non-fatal */ }

  // Access control — only active when the multi-user login system is enabled
  // (AUTH_SECRET set). A signed-in caller is checked against their client
  // allocation; a null caller means the trusted Basic-Auth break-glass path,
  // which keeps full access. Client-scoped requests must name an allowed
  // account; agency-wide requests are off-limits to client (viewer) accounts.
  const AUTH_SECRET = process.env.AUTH_SECRET
  const me = AUTH_SECRET ? await currentUser(req, AUTH_SECRET).catch(() => null) : null
  if (me) {
    if (client && !canSeeClient(me, client)) return json({ error: 'You don’t have access to this account.' }, 403)
    if (!client && me.role === 'viewer') return json({ error: 'No access to agency-wide data.' }, 403)
  }
  // Restricted staff (a User limited to specific accounts) only ever see their
  // own accounts inside agency-wide aggregates — enforced server-side so the
  // raw response can't leak other clients. null = no restriction (admin / staff
  // with all-accounts / the trusted Basic-Auth path).
  const restrictTo = me && me.role === 'user' && me.allClients === false ? new Set(me.clients || []) : null
  const pickAllowed = (obj) => restrictTo ? Object.fromEntries(Object.entries(obj || {}).filter(([id]) => restrictTo.has(id))) : (obj || {})

  // ---- Monthly Report ------------------------------------------------------
  // Frozen monthly client reports. The deck itself is assembled on the client
  // from the existing meta/google/blend/attribution scopes plus the two helpers
  // below (won-by-date + 6-month trend), then POSTed back here to freeze so a
  // report you export or reopen never shifts as live data updates.
  //
  // WON ATTRIBUTION: wins/revenue are captured by WON DATE (status-change to
  // "won"), not lead-created date — so a lead created in an earlier month but
  // closed in the report month counts in the report month. See wonInPeriod().
  const monthlyStore = () => getStore({ name: 'caalano-monthly', consistency: 'strong' })
  const monthKey = (cl, m) => `${cl}:${m}`

  if (url.searchParams.get('scope') === 'monthlysnap') {
    if (!client) return json({ error: 'client required' }, 400)
    const store = monthlyStore()
    const idxKey = `index:${client}`
    if (req.method === 'POST') {
      let body; try { body = await req.json() } catch { body = null }
      if (!body || !body.month || !body.report) return json({ error: 'month + report required' }, 400)
      const rec = { client, month: body.month, report: body.report, savedAt: new Date().toISOString(), savedBy: (me && (me.name || me.email)) || null }
      await store.setJSON(monthKey(client, body.month), rec)
      let idx = await store.get(idxKey, { type: 'json' }).catch(() => null); if (!Array.isArray(idx)) idx = []
      if (!idx.includes(body.month)) { idx.push(body.month); idx.sort().reverse(); await store.setJSON(idxKey, idx) }
      return json({ ok: true, savedAt: rec.savedAt, savedBy: rec.savedBy })
    }
    if (url.searchParams.get('list')) {
      const idx = await store.get(idxKey, { type: 'json' }).catch(() => null)
      return json({ months: Array.isArray(idx) ? idx : [] })
    }
    const month = url.searchParams.get('month')
    if (!month) return json({ error: 'month required' }, 400)
    const rec = await store.get(monthKey(client, month), { type: 'json' }).catch(() => null)
    return json(rec ? { saved: true, ...rec } : { saved: false })
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
    if (url.searchParams.get('list')) return json({ clients: Object.keys(SOCIAL).filter((id) => !restrictTo || restrictTo.has(id)) }, 200, true)
    const soc = SOCIAL[client]
    if (!soc) return json({ ig: null, fb: null, connected: false })
    try { const data = await buildSocial(soc, from, to, key); return json({ client, period: { from, to }, ...data }, 200, true) }
    catch (e) { return json({ ig: null, fb: null, error: String(e.message || e) }, 502) }
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
        windsorFetch('gohighlevel', ['account_id', 'user_id', 'user_name'], from, to, preset, key).then((rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(cc.ghl))).catch(() => []),
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
        // windowed conversions per day and under-counts results — the bug that made
        // the trend disagree with the headline. One fetch per month, in parallel.
        const fallback = await readMetaPrimary(client).catch(() => null)
        const adsetFields = ['account_id', 'campaign', 'adset_name', 'adsset_optimization_goal', 'adset_destination_type', 'adset_promoted_object', 'campaign_objective', 'spend', 'inline_link_clicks', ...FB_LEAD_FIELDS, ...META_RESULT_FIELDS, 'actions_video_view']
        const monthList = [...buckets.keys()]
        const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }
        const perMonth = await Promise.all(monthList.map((k) =>
          windsorFetch('facebook', adsetFields, `${k}-01`, lastDay(k), null, key)
            .then((rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(cc.meta)))
            .catch(() => [])
        ))
        monthList.forEach((k, i) => {
          const b = buckets.get(k); if (!b) return
          let results = 0, spend = 0
          for (const a of aggMeta(perMonth[i], 'adset_name')) { const rr = rowResult(a, fallback); results += resultCount(a, rr.field) || 0; spend += a.spend }
          b.spend = spend; b.leads = results
        })
      }
      const trend = [...buckets.values()].map((b) => ({ month: b.month, label: b.label, spend: Math.round(b.spend), leads: Math.round(b.leads), cpl: b.leads ? Math.round(b.spend / b.leads) : null }))
      return json({ trend }, 200)
    } catch (e) { return json({ trend: [], error: String(e.message || e) }, 200) }
  }

  // Agency-wide Caalano Systems access/scope audit across every mapped client.
  if (url.searchParams.get('scope') === 'ghlaudit') {
    if (!(await isConnected().catch(() => false))) return json({ connected: false, needsSetup: true })
    try {
      const entries = Object.entries(CLIENTS).filter(([id, cc]) => cc.ghl && (!restrictTo || restrictTo.has(id)))
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

  // Agency-wide roll-up (no single client) — powers the Overview + leaderboard.
  if (url.searchParams.get('scope') === 'agency') {
    try {
      const ov = await buildOverview(from, to, preset, key)
      if (restrictTo) {
        ov.clients = pickAllowed(ov.clients)
        if (ov.alerts) { ov.alerts.meta = (ov.alerts.meta || []).filter((a) => restrictTo.has(a.id)); ov.alerts.google = (ov.alerts.google || []).filter((a) => restrictTo.has(a.id)) }
      }
      return json({ scope: 'agency', period: { from, to, preset }, ...ov }, 200, !restrictTo)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Rolling-window performance trends across all clients (own date logic).
  if (url.searchParams.get('scope') === 'trends') {
    try { const tr = await buildTrends(key); if (restrictTo) tr.clients = pickAllowed(tr.clients); return json({ scope: 'trends', ...tr }, 200, !restrictTo) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Agency-wide UTM source-tag coverage per client (lazy-loaded for the leaderboard).
  if (url.searchParams.get('scope') === 'coverage') {
    if (!(await isConnected().catch(() => false))) return json({ scope: 'coverage', connected: false, coverage: {} })
    const entries = Object.entries(CLIENTS).filter(([id, cc]) => cc.ghl && (!restrictTo || restrictTo.has(id)))
    const out = {}
    await Promise.all(entries.map(async ([id, cc]) => { try { out[id] = await attributionCoverage(cc.ghl, from, to) } catch { out[id] = null } }))
    return json({ scope: 'coverage', connected: true, coverage: out }, 200, !restrictTo)
  }

  // Weekly (Mon–Sun) traffic-light board for one client.
  if (url.searchParams.get('scope') === 'weekly') {
    const cw = CLIENTS[client]
    if (!cw) return json({ error: `unknown client ${client}` }, 404)
    const weeks = Math.max(2, Math.min(16, parseInt(url.searchParams.get('weeks'), 10) || 6))
    try { const wk = await buildWeekly(cw, weeks, key); return json({ scope: 'weekly', client, weeks, ...wk }, 200, true) }
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
    try { return json({ scope: 'forms', client, period: { from, to, preset }, ...(await buildForms(cc.ghl, from, to)) }, 200, true) }
    catch (e) { return json({ scope: 'forms', client, error: String(e.message || e).slice(0, 200), forms: [] }, 200) }
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

  // Speed to Lead — WHOLE dataset, processed in chunks across polled requests and
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
        const { tz, leads } = await speedLeadList(cc.ghl, from, to)
        state = { tz, leads, idx: 0, total: leads.length, status: leads.length ? 'running' : 'done', agg: { manualRaw: [], onlyAuto: 0, noOutbound: 0, srcCounts: {} } }
      }
      if (state.status !== 'done') {
        state.idx = await speedScanChunk(cc.ghl, state.leads, state.idx, 18000, state.agg)
        if (state.idx >= state.total) state.status = 'done'
        await store.setJSON(key, state)
      }
      const out = finalizeSpeed(state.agg, state.total, state.idx, hours, state.tz)
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
  // Executive health score — the headline of the Caalano 360 executive tab.
  // Live computation for the selected range plus whatever daily trend history the
  // snapshot job has accumulated (empty until it first runs — no fake history).
  if (url.searchParams.get('scope') === 'health') {
    const cc = CLIENTS[client]
    if (!cc) return json({ scope: 'health', client, error: `unknown client ${client}` }, 404)
    try {
      const cfg = await readHealthConfig(client)
      const [health, history] = await Promise.all([
        buildHealth(cc, from, to, preset, key, cfg.weights),
        readHealthHistory(client).catch(() => []),
      ])
      return json({ scope: 'health', client, period: { from, to, preset }, ...health, history }, 200, true)
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

  // On-demand trend backfill for one client — weekly trailing-window points going
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
    const pipeline = url.searchParams.get('pipeline') || null
    const channel = url.searchParams.get('channel') || 'all'
    try {
      const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
      const [perf, fb, gg] = await Promise.all([
        buildUserPerformance(cc.ghl, from, to, { pipeline, channel }),
        cc.meta ? windsorFetch('facebook', ['account_id', 'spend'], from, to, preset, key).then(filt(cc.meta)).catch(() => []) : Promise.resolve([]),
        cc.google ? windsorFetch('google_ads', ['account_id', 'spend'], from, to, preset, key).then(filt(cc.google)).catch(() => []) : Promise.resolve([]),
      ])
      const metaSpend = Math.round(fb.reduce((s, r) => s + num(r.spend), 0))
      const googleSpend = Math.round(gg.reduce((s, r) => s + num(r.spend), 0))
      // Ad spend can't be attributed to an individual rep, but it CAN be scoped to
      // the selected channel. Non-paid has no ad spend, so cost figures are N/A.
      const spendByChannel = { all: metaSpend + googleSpend, paid: metaSpend + googleSpend, meta: metaSpend, google: googleSpend, nonpaid: 0 }
      const totalSpend = spendByChannel[channel] != null ? spendByChannel[channel] : metaSpend + googleSpend
      return json({ scope: 'users', client, period: { from, to, preset }, channel, totalSpend, metaSpend, googleSpend, ...perf }, 200, true)
    } catch (e) { return json({ scope: 'users', client, error: String(e.message || e).slice(0, 200), connected: true }, 200) }
  }

  // Command Centre drill dataset — staff-only. Assembles every clickable
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
    try { return json({ scope: 'calendars', client, connected: true, calendars: await listCalendars(cc.ghl) }, 200, true) }
    catch (e) { return json({ scope: 'calendars', client, error: String(e.message || e).slice(0, 160), calendars: [] }, 200) }
  }

  // Account explorer for adding a new client: every Caalano Systems (GHL) sub-
  // account under the agency, plus the distinct Meta / Google ad accounts Windsor
  // can see. Each is flagged `mapped` when it already belongs to a client, so the
  // UI can surface what's still available to connect.
  if (url.searchParams.get('scope') === 'discover') {
    const usedGhl = new Set(), usedMeta = new Set(), usedGoogle = new Set()
    for (const c of Object.values(CLIENTS)) { if (c.ghl) usedGhl.add(norm(c.ghl)); if (c.meta) usedMeta.add(norm(c.meta)); if (c.google) usedGoogle.add(norm(c.google)) }
    const nameById = (rows) => { const m = new Map(); for (const r of (rows || [])) { const id = r.account_id; if (id == null) continue; const k = String(id); if (!m.has(k) || (!m.get(k) && r.account_name)) m.set(k, r.account_name || '') } return m }
    const [locs, fbRows, ggRows] = await Promise.all([
      (isConnected().then((ok) => (ok ? listLocations() : [])).catch((e) => ({ error: String(e.message || e).slice(0, 160) }))),
      windsorFetch('facebook', ['account_id', 'account_name', 'spend'], from, to, preset, key).catch(() => []),
      windsorFetch('google_ads', ['account_id', 'account_name', 'spend'], from, to, preset, key).catch(() => []),
    ])
    const ghlErr = locs && locs.error ? locs.error : null
    const ghl = Array.isArray(locs) ? locs.map((l) => ({ id: l.id, name: l.name, mapped: usedGhl.has(norm(l.id)) })) : []
    const metaMap = nameById(fbRows), googleMap = nameById(ggRows)
    const meta = [...metaMap.entries()].map(([id, name]) => ({ id, name: name || id, mapped: usedMeta.has(norm(id)) })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const google = [...googleMap.entries()].map(([id, name]) => ({ id, name: name || id, mapped: usedGoogle.has(norm(id)) })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return json({ scope: 'discover', ghl, meta, google, ghlErr, connected: await isConnected().catch(() => false) }, 200)
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
    const ids = META_CONV_CANDIDATES.map(([id]) => id)
    try {
      const rows = (await windsorFetch('facebook', ['account_id', 'spend', ...ids], f90, t0, null, key)).filter((r) => !r.account_id || norm(r.account_id) === norm(cc.meta))
      let spend = 0; const sums = {}
      for (const r of rows) { spend += num(r.spend); for (const id of ids) sums[id] = (sums[id] || 0) + num(r[id]) }
      const actions = ids.map((id) => ({ id, label: META_CONV_LABEL[id] || id, count: Math.round(sums[id] || 0), costPer: sums[id] ? Math.round((spend / sums[id]) * 100) / 100 : null }))
        .filter((a) => a.count > 0).sort((a, b) => b.count - a.count)
      return json({ scope: 'metaactions', client, window: { from: f90, to: t0 }, spend: Math.round(spend), actions }, 200, true)
    } catch (e) { return json({ scope: 'metaactions', client, error: String(e.message || e).slice(0, 200), actions: [] }, 200) }
  }

  // Creative Cockpit — every Meta creative with its performance and (where the
  // client has a CRM) the real funnel behind each ad, joined by first-touch
  // utm_content. Auto-detected fields: format, thumbnail, Instagram permalink.
  // Categorisation tags live client-side (settings), keyed by the creative id.
  if (url.searchParams.get('scope') === 'creatives') {
    const cc = CLIENTS[client]
    if (!cc || !cc.meta) return json({ scope: 'creatives', client, meta: false, creatives: [] })
    try {
      const fallback = await readMetaPrimary(client)
      const filt2 = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(cc.meta))
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
      // The same creative (ad_name) can run across several ad sets — aggregate to
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
  // fans out across active Meta clients). Light fetch — ads + daily only — scored
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
        const rows = (await windsorFetch('facebook', ['account_id', 'ad_id', 'ad_name', 'thumbnail_url'], from, to, preset, key)).filter((r) => !r.account_id || norm(r.account_id) === norm(cc.meta))
        for (const r of rows) if (r.ad_id) nameById[String(r.ad_id)] = { name: r.ad_name, thumb: r.thumbnail_url }
      } catch { /* names optional */ }
      const norml = (l) => /high/i.test(l) ? 'High' : /med/i.test(l) ? 'Medium' : /low/i.test(l) ? 'Low' : l
      const creatives = ids.map((id) => ({ adId: id, level: norml(ads[id].level), rawLevel: ads[id].level, ts: ads[id].ts, name: (nameById[id] || {}).name || null, thumb: (nameById[id] || {}).thumb || null }))
        .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.level] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.level] ?? 3))
      const summary = { high: creatives.filter((c) => c.level === 'High').length, medium: creatives.filter((c) => c.level === 'Medium').length, low: creatives.filter((c) => c.level === 'Low').length, total: creatives.length }
      return json({ scope: 'fatiguewebhook', client, connected: true, updatedAt: rec.updatedAt, verified: !!rec.verified, creatives, summary }, 200, true)
    } catch (e) { return json({ scope: 'fatiguewebhook', client, error: String(e.message || e).slice(0, 200), connected: false, creatives: [] }, 200) }
  }

  // Webhook connection status — lists everything the meta-webhook receiver has
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

  // Meta opportunity score + recommendations — pulled live from the Graph API
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

  // Meta anomaly / delivery-health signal for the Meta Insights tab — one client
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
  // Meta feed exposes (call-to-action, ad copy, destination link, video asset) —
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
        const rows = (await windsorFetch('facebook', ['account_id', 'ad_name', f], from, to, preset, key)).filter((r) => !r.account_id || norm(r.account_id) === norm(cc.meta))
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
    const summ = (attr) => {
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
        out[ch] = { opps: tt.leads || 0, won: tt.won || 0, revenue: tt.revenue || 0, booked, shown }
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
      const attr = await buildAttribution(cc.ghl, fr, t, { lite: true })
      return json({ scope: 'ovrow', client, period, connected: true, data: summ(attr) }, 200, true)
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
        windsorFetch('gohighlevel', ['account_id', 'user_id', 'user_name'], from, to, preset, key).then((rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(c.ghl))).catch(() => []),
        (from && to) ? wonInPeriod(c.ghl, from, to).catch(() => null) : Promise.resolve(null),
      ])
      crm.wonClosed = wonClosed
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
      const attribution = await fn(c.ghl, from, to, pipeline ? { pipeline } : {})
      return json({ client, channel, period: { from, to, preset }, attribution }, 200, !url.searchParams.get('debug'))
    } catch (e) { return json({ connected: true, error: String(e.message || e) }, 502) }
  }

  // Caalano360 — blended paid + CRM aggregate for a single client.
  if (channel === 'blend') {
    try {
      const [blend, wonClosed] = await Promise.all([
        buildBlend(c, from, to, preset, key),
        (c.ghl && from && to) ? wonInPeriod(c.ghl, from, to).catch(() => null) : Promise.resolve(null),
      ])
      blend.wonClosed = wonClosed
      return json({ client, channel, period: { from, to, preset }, blend }, 200, true)
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
      const mine = rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
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
    const rows = rowsAll.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
    if (debug) return json({ channel, accountId, fieldsRequested: fields, rowCount: rows.length, sample: rows.slice(0, 3), sampleKeys: rows[0] ? Object.keys(rows[0]) : [] })
    return json({ client, channel, period: { from, to, preset }, ghl: rollupGhl(rows) }, 200, true)
  } catch (e) {
    return json({ error: String(e.message || e) }, 502)
  }
}
