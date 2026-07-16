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

import { buildAttribution, sampleAttribution, buildCrm, auditLocation, isConnected, bookedTrends, attributionCoverage, wonInPeriod } from '../lib/ghl.mjs'

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

// Windsor field ids per connector. CONFIRMED via MCP where noted; others VERIFY.
const FIELDS = {
  meta: {
    connector: 'facebook',
    dims: ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking'], // CONFIRMED
    metrics: ['spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead', 'actions_video_view'], // spend/impr/clicks + video CONFIRMED; inline_link_clicks + actions_lead VERIFY
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

function rollupMeta(adRows, dayRows, accRows) {
  const by = (keyFn) => {
    const m = new Map()
    for (const r of adRows) {
      const k = keyFn(r); if (!k) continue
      const e = m.get(k) || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0 }
      e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks)
      e.linkClicks += num(r.inline_link_clicks); e.leads += num(r.actions_lead); e.videoViews += num(r.actions_video_view)
      m.set(k, e)
    }
    return m
  }
  const campaigns = [...by((r) => r.campaign).entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.spend - a.spend)
  const adsets = [...by((r) => r.adset_name).entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.spend - a.spend)
  // rebuild adset->campaign so ad sets can carry their parent campaign for drill-down
  const adsetCampaign = {}
  for (const r of adRows) { if (r.adset_name && r.campaign && !adsetCampaign[r.adset_name]) adsetCampaign[r.adset_name] = r.campaign }
  const adsetsWithParent = adsets.map((a) => ({ ...a, campaign: adsetCampaign[a.name] || null }))
  const ads = adRows.map((r) => ({
    name: r.ad_name, campaign: r.campaign, adset: r.adset_name,
    type: num(r.actions_video_view) > 0 ? 'Video' : 'Image',
    quality: r.quality_ranking || 'UNKNOWN', thumb: r.thumbnail_url, igUrl: r.instagram_permalink_url || null,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
    linkClicks: num(r.inline_link_clicks), leads: num(r.actions_lead), videoViews: num(r.actions_video_view),
  })).filter((a) => a.name).sort((a, b) => b.spend - a.spend)
  // daily series, sorted ascending by date
  const dmap = new Map()
  for (const r of dayRows) {
    const d = String(r.date || '').slice(0, 10); if (!d) continue
    const e = dmap.get(d) || { date: d, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 }
    e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.linkClicks += num(r.inline_link_clicks); e.leads += num(r.actions_lead)
    dmap.set(d, e)
  }
  const daily = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date))
  // account totals (reach/frequency are only correct from an account-level pull)
  const totals = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0 }
  for (const r of accRows) { totals.spend += num(r.spend); totals.impressions += num(r.impressions); totals.clicks += num(r.clicks); totals.linkClicks += num(r.inline_link_clicks); totals.leads += num(r.actions_lead); totals.videoViews += num(r.actions_video_view); totals.reach += num(r.reach) }
  return { campaigns, adsets: adsetsWithParent, ads, daily, totals }
}
function metaTotals(accRows) {
  const t = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0, reach: 0 }
  for (const r of accRows) { t.spend += num(r.spend); t.impressions += num(r.impressions); t.clicks += num(r.clicks); t.linkClicks += num(r.inline_link_clicks); t.leads += num(r.actions_lead); t.videoViews += num(r.actions_video_view); t.reach += num(r.reach) }
  return t
}
async function buildMeta(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const pr = prevRange(from, to)
  const accFields = ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead', 'actions_video_view']
  const [adRows, dayRows, accRows, prevRows, adDayRows] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'instagram_permalink_url', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead', 'actions_video_view'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead'], from, to, preset, key).then(filt),
    windsorFetch('facebook', accFields, from, to, preset, key).then(filt),
    pr.from ? windsorFetch('facebook', accFields, pr.from, pr.to, null, key).then(filt) : Promise.resolve([]),
    windsorFetch('facebook', ['account_id', 'date', 'campaign', 'adset_name', 'ad_name', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead'], from, to, preset, key).then(filt),
  ])
  const roll = rollupMeta(adRows, dayRows, accRows)
  roll.prev = metaTotals(prevRows)
  roll.adDaily = adDayRows.map((r) => ({ date: String(r.date || '').slice(0, 10), campaign: r.campaign, adset: r.adset_name, ad: r.ad_name, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), linkClicks: num(r.inline_link_clicks), leads: num(r.actions_lead) })).filter((r) => r.date && r.ad)
  return roll
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
async function buildOverview(from, to, preset, key) {
  const metaRev = {}, googleRev = {}, ghlRev = {}
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaRev[norm(c.meta)] = id; if (c.google) googleRev[norm(c.google)] = id; if (c.ghl) ghlRev[norm(c.ghl)] = id }
  // last-8-day daily spend (yesterday + prior week) for zero-spend alerts
  const today = tzToday()
  const dstr = (d) => d.toISOString().slice(0, 10)
  const yest = new Date(today); yest.setUTCDate(yest.getUTCDate() - 1)
  const base0 = new Date(today); base0.setUTCDate(base0.getUTCDate() - 8)
  const [fb, gg, opps, fbD, ggD] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'spend', 'impressions', 'clicks', 'actions_lead'], from, to, preset, key),
    windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key),
    windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_monetary_value'], from, to, preset, key).catch(() => []),
    windsorFetch('facebook', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'spend'], dstr(base0), dstr(yest), null, key).catch(() => []),
  ])
  const clients = {}
  const ensure = (id) => (clients[id] = clients[id] || {})
  for (const r of fb) {
    const id = metaRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.meta = e.meta || { spend: 0, impressions: 0, clicks: 0, leads: 0 }
    e.meta.spend += num(r.spend); e.meta.impressions += num(r.impressions); e.meta.clicks += num(r.clicks); e.meta.leads += num(r.actions_lead)
  }
  for (const r of gg) {
    const id = googleRev[norm(r.account_id)]; if (!id) continue
    const e = ensure(id); e.google = e.google || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.google.cost += num(r.spend); e.google.impressions += num(r.impressions); e.google.clicks += num(r.clicks); e.google.conversions += num(r.conversions)
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
    windsorFetch('facebook', ['account_id', 'date', 'spend', 'actions_lead'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_created_at'], dstr(start), dstr(today), null, key).catch(() => []),
    windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], dstr(start), dstr(today), null, key).catch(() => []),
  ])
  const days = []; for (let i = 0; i < 56; i++) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); days.push(dstr(d)) }
  const dayIndex = new Map(days.map((d, i) => [d, i])) // 0 = today, larger = older
  const mk = () => new Float64Array(56)
  const cl = {}
  const ensure = (id) => (cl[id] = cl[id] || { metaSpend: mk(), metaLeads: mk(), gSpend: mk(), gConv: mk(), wBooked: mk(), bAll: mk(), bMeta: mk(), bGoogle: mk(), ghlBooked: false })
  for (const r of fb) { const id = metaId[norm(r.account_id)]; if (!id) continue; const di = dayIndex.get(String(r.date || '').slice(0, 10)); if (di == null) continue; const e = ensure(id); e.metaSpend[di] += num(r.spend); e.metaLeads[di] += num(r.actions_lead) }
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
    c.meta ? windsorFetch('facebook', ['account_id', 'date', 'spend', 'actions_lead'], start, end, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'date', 'spend', 'conversions'], start, end, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at'], start, end, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], start, end, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
  ])
  const B = weekStarts.map((w) => ({ week: w, weekNum: isoWeek(w), metaSpend: 0, gSpend: 0, metaLeads: 0, gConv: 0, crmLeads: 0, booked: 0, shown: 0, won: 0, wonValue: 0 }))
  for (const r of fb) { const i = wkIndex.get(mondayOf(String(r.date || '').slice(0, 10))); if (i == null) continue; B[i].metaSpend += num(r.spend); B[i].metaLeads += num(r.actions_lead) }
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
    const byId = {}; let bookPos = null, showPos = null
    for (const s of stages) {
      byId[s.id] = { name: s.name, pos: s.position }
      const nm = String(s.name || '')
      if (STAGE_EXC.test(nm)) continue
      if (BOOK_RE.test(nm)) bookPos = bookPos == null ? s.position : Math.min(bookPos, s.position)
      if (SHOW_RE.test(nm)) showPos = showPos == null ? s.position : Math.min(showPos, s.position)
    }
    if (p.pipeline_id) idx.set(p.pipeline_id, { byId, bookPos, showPos })
  }
  return idx
}
function blendCrm(oppRows, idx) {
  let leads = 0, booked = 0, shown = 0, won = 0, lost = 0, open = 0, revenue = 0, openValue = 0
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
  }
  return {
    leads, booked, shown, won, lost, open,
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
  const m = new Map()
  for (const r of rows) { const n = r.campaign; if (!n) continue; const e = m.get(n) || { name: n, source, spend: 0, conv: 0 }; e.spend += num(r.spend); e.conv += num(r[convField]); m.set(n, e) }
  return [...m.values()]
}
async function buildBlend(c, from, to, preset, key) {
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
  const pr = prevRange(from, to)
  const [fb, gg, opps, pipes, userRows, pFb, pGg, pOpps] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'campaign', 'spend', 'actions_lead'], from, to, preset, key).then(filt(c.meta)) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'campaign', 'spend', 'conversions'], from, to, preset, key).then(filt(c.google)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at', 'opportunity_assigned_to'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'user_id', 'user_name'], from, to, preset, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
    pr.from && c.meta ? windsorFetch('facebook', ['account_id', 'spend'], pr.from, pr.to, null, key).then(filt(c.meta)).catch(() => []) : Promise.resolve([]),
    pr.from && c.google ? windsorFetch('google_ads', ['account_id', 'spend'], pr.from, pr.to, null, key).then(filt(c.google)).catch(() => []) : Promise.resolve([]),
    pr.from && c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value'], pr.from, pr.to, null, key).then(filt(c.ghl)).catch(() => []) : Promise.resolve([]),
  ])
  const metaCamps = campAgg(fb, 'Meta', 'actions_lead')
  const googleCamps = campAgg(gg, 'Google', 'conversions')
  const metaSpend = metaCamps.reduce((a, r) => a + r.spend, 0)
  const metaLeads = metaCamps.reduce((a, r) => a + r.conv, 0)
  const googleSpend = googleCamps.reduce((a, r) => a + r.spend, 0)
  const googleConv = googleCamps.reduce((a, r) => a + r.conv, 0)
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
    .map((x) => ({ name: x.name, source: x.source, spend: Math.round(x.spend), conv: Math.round(x.conv), auto: auto.get(x.name) || 'all' }))
    .sort((a, b) => b.spend - a.spend)
  // Previous equal-length period (account level) for ±vs-previous deltas.
  let prev = null
  if (pr.from) {
    const pMetaSpend = pFb.reduce((a, r) => a + num(r.spend), 0)
    const pGoogleSpend = pGg.reduce((a, r) => a + num(r.spend), 0)
    prev = {
      adSpend: Math.round(pMetaSpend + pGoogleSpend), metaSpend: Math.round(pMetaSpend), googleSpend: Math.round(pGoogleSpend),
      crm: blendCrm(pOpps, idx),
    }
  }
  return {
    hasCrm: !!c.ghl, hasMeta: !!c.meta, hasGoogle: !!c.google,
    paid: {
      adSpend: Math.round(metaSpend + googleSpend), metaSpend: Math.round(metaSpend), googleSpend: Math.round(googleSpend),
      metaLeads: Math.round(metaLeads), googleConv: Math.round(googleConv), adConversions: Math.round(metaLeads + googleConv),
    },
    crm: account.crm, pipelines: account.pipelines, users, campaigns, prev,
  }
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

  // Agency-wide Caalano Systems access/scope audit across every mapped client.
  if (url.searchParams.get('scope') === 'ghlaudit') {
    if (!(await isConnected().catch(() => false))) return json({ connected: false, needsSetup: true })
    try {
      const entries = Object.entries(CLIENTS).filter(([, cc]) => cc.ghl)
      const audit = await Promise.all(entries.map(async ([id, cc]) => ({ client: id, location: cc.ghl, ...(await auditLocation(cc.ghl)) })))
      return json({ audit }, 200)
    } catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Agency-wide roll-up (no single client) — powers the Overview + leaderboard.
  if (url.searchParams.get('scope') === 'agency') {
    try { const ov = await buildOverview(from, to, preset, key); return json({ scope: 'agency', period: { from, to, preset }, ...ov }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Rolling-window performance trends across all clients (own date logic).
  if (url.searchParams.get('scope') === 'trends') {
    try { const tr = await buildTrends(key); return json({ scope: 'trends', ...tr }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Agency-wide UTM source-tag coverage per client (lazy-loaded for the leaderboard).
  if (url.searchParams.get('scope') === 'coverage') {
    if (!(await isConnected().catch(() => false))) return json({ scope: 'coverage', connected: false, coverage: {} })
    const entries = Object.entries(CLIENTS).filter(([, cc]) => cc.ghl)
    const out = {}
    await Promise.all(entries.map(async ([id, cc]) => { try { out[id] = await attributionCoverage(cc.ghl, from, to) } catch { out[id] = null } }))
    return json({ scope: 'coverage', connected: true, coverage: out }, 200, true)
  }

  // Weekly (Mon–Sun) traffic-light board for one client.
  if (url.searchParams.get('scope') === 'weekly') {
    const cw = CLIENTS[client]
    if (!cw) return json({ error: `unknown client ${client}` }, 404)
    const weeks = Math.max(2, Math.min(16, parseInt(url.searchParams.get('weeks'), 10) || 6))
    try { const wk = await buildWeekly(cw, weeks, key); return json({ scope: 'weekly', client, weeks, ...wk }, 200, true) }
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
      const fn = url.searchParams.get('debug') ? sampleAttribution : buildAttribution
      const attribution = await fn(c.ghl, from, to)
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
      const meta = await buildMeta(accountId, from, to, preset, key)
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
