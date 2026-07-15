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
async function buildMeta(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const [adRows, dayRows, accRows] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'campaign', 'adset_name', 'ad_name', 'thumbnail_url', 'quality_ranking', 'instagram_permalink_url', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead', 'actions_video_view'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead'], from, to, preset, key).then(filt),
    windsorFetch('facebook', ['account_id', 'reach', 'spend', 'impressions', 'clicks', 'inline_link_clicks', 'actions_lead', 'actions_video_view'], from, to, preset, key).then(filt),
  ])
  return rollupMeta(adRows, dayRows, accRows)
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
  const agCampaign = {}
  for (const r of cg) { const ag = cleanAg(r); if (ag && r.campaign && !agCampaign[ag]) agCampaign[ag] = r.campaign }
  const adGroups = [...aggBy(cg, cleanAg).entries()].map(([name, v]) => ({ name, campaign: agCampaign[name] || null, ...v })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost)
  // keywords: aggregate by text, carry campaign/ad group, dominant match type + approx quality score
  const kwAgg = aggBy(kw, (r) => r.keyword_text)
  const kwMeta = new Map()
  for (const r of kw) { const t = r.keyword_text; if (!t) continue; const e = kwMeta.get(t) || { match: titleCase(r.match_type) || '—', qsSum: 0, campaign: r.campaign || null, adGroup: cleanAg(r) || null }; e.qsSum += num(r.quality_score); if (!e.match || e.match === '—') e.match = titleCase(r.match_type) || '—'; kwMeta.set(t, e) }
  const keywords = [...kwAgg.entries()].map(([text, v]) => { const m = kwMeta.get(text) || {}; const qs = m.qsSum ? Math.max(1, Math.min(10, Math.round(m.qsSum / days))) : ''; return { text, match: m.match || '—', qs, campaign: m.campaign, adGroup: m.adGroup, ...v } }).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 60)
  const mt = new Map()
  for (const r of kw) { const t = titleCase(r.match_type); if (!t) continue; const e = mt.get(t) || { type: t, cost: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.clicks += num(r.clicks); e.conversions += num(r.conversions); mt.set(t, e) }
  // search terms with parent campaign / ad group / matched keyword
  const stAgg = new Map(), stMeta = new Map()
  for (const r of st) { const term = r.search_term; if (!term) continue; const e = stAgg.get(term) || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); stAgg.set(term, e); if (!stMeta.has(term)) stMeta.set(term, { campaign: r.campaign || null, adGroup: cleanAg(r) || null, keyword: r.keyword_text || null }) }
  const searchTerms = [...stAgg.entries()].map(([term, v]) => ({ term, ...(stMeta.get(term) || {}), ...v })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 80)
  const dmap = new Map()
  for (const r of dy) { const d = String(r.date || '').slice(0, 10); if (!d) continue; const e = dmap.get(d) || { date: d, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions); dmap.set(d, e) }
  const daily = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totals = campaigns.reduce((a, c) => ({ cost: a.cost + c.cost, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 })
  return { campaigns, adGroups, keywords, matchTypes: [...mt.values()].sort((a, b) => b.cost - a.cost), searchTerms, daily, totals, keywordsTotal: kwAgg.size, searchTermsTotal: stAgg.size }
}
// Agency roll-up: pull all Meta + Google accounts in two calls, map each back
// to its client, and return per-client paid metrics for the whole roster.
async function buildOverview(from, to, preset, key) {
  const metaRev = {}, googleRev = {}
  for (const [id, c] of Object.entries(CLIENTS)) { if (c.meta) metaRev[norm(c.meta)] = id; if (c.google) googleRev[norm(c.google)] = id }
  const [fb, gg] = await Promise.all([
    windsorFetch('facebook', ['account_id', 'spend', 'impressions', 'clicks', 'actions_lead'], from, to, preset, key),
    windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key),
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
  return { clients }
}

async function buildGoogle(accountId, from, to, preset, key) {
  const filt = (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
  const [cg, kw, st, dy] = await Promise.all([
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'ad_group', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'keyword_text', 'match_type', 'quality_score', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'campaign', 'ad_group_name', 'keyword_text', 'search_term', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
    windsorFetch('google_ads', ['account_id', 'date', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt),
  ])
  return rollupGoogle(cg, kw, st, dy, daysInRange(from, to, preset))
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
async function buildBlend(c, from, to, preset, key) {
  const filt = (id) => (rows) => rows.filter((r) => !r.account_id || norm(r.account_id) === norm(id))
  const [fb, gg, opps, pipes] = await Promise.all([
    c.meta ? windsorFetch('facebook', ['account_id', 'spend', 'impressions', 'clicks', 'actions_lead'], from, to, preset, key).then(filt(c.meta)) : Promise.resolve([]),
    c.google ? windsorFetch('google_ads', ['account_id', 'spend', 'impressions', 'clicks', 'conversions'], from, to, preset, key).then(filt(c.google)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'opportunity_status', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_monetary_value', 'opportunity_created_at'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
    c.ghl ? windsorFetch('gohighlevel', ['account_id', 'pipeline_id', 'pipeline_name', 'pipeline_stages'], from, to, preset, key).then(filt(c.ghl)) : Promise.resolve([]),
  ])
  const metaSpend = fb.reduce((a, r) => a + num(r.spend), 0)
  const metaLeads = fb.reduce((a, r) => a + num(r.actions_lead), 0)
  const googleSpend = gg.reduce((a, r) => a + num(r.spend), 0)
  const googleConv = gg.reduce((a, r) => a + num(r.conversions), 0)
  const idx = stageIndex(pipes)
  const crm = blendCrm(opps, idx)
  // Per-pipeline funnels so the UI can offer a pipeline selector — a "booking"
  // means different things across pipelines, so they're kept separate.
  const nameOf = {}, stagesOf = {}
  for (const p of pipes) {
    if (!p.pipeline_id) continue
    nameOf[p.pipeline_id] = p.pipeline_name || p.pipeline_id
    stagesOf[p.pipeline_id] = asArray(p.pipeline_stages).map((s) => ({ id: s.id, name: s.name, pos: s.position })).sort((a, b) => a.pos - b.pos)
  }
  const byPipe = new Map()
  for (const r of opps) { const pid = r.opportunity_pipeline_id || 'none'; if (!byPipe.has(pid)) byPipe.set(pid, []); byPipe.get(pid).push(r) }
  const pipelines = [...byPipe.entries()]
    .map(([id, rows]) => {
      // opps currently sitting at each stage, in pipeline order (won/lost/open all counted where they sit)
      const at = new Map(); const openAt = new Map()
      for (const r of rows) { const sid = r.opportunity_pipeline_stage_id; at.set(sid, (at.get(sid) || 0) + 1); const st = String(r.opportunity_status || '').toLowerCase(); if (st !== 'lost' && st !== 'abandoned') openAt.set(sid, (openAt.get(sid) || 0) + 1) }
      const stages = (stagesOf[id] || []).map((s) => ({ name: s.name, pos: s.pos, count: at.get(s.id) || 0, active: openAt.get(s.id) || 0 }))
      return { id, name: nameOf[id] || 'Unnamed pipeline', crm: blendCrm(rows, idx), stages }
    })
    .sort((a, b) => b.crm.leads - a.crm.leads)
  return {
    hasCrm: !!c.ghl, hasMeta: !!c.meta, hasGoogle: !!c.google,
    paid: {
      adSpend: metaSpend + googleSpend, metaSpend, googleSpend,
      metaLeads, googleConv, adConversions: metaLeads + googleConv,
    },
    crm, pipelines,
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

  // Agency-wide roll-up (no single client) — powers the Overview + leaderboard.
  if (url.searchParams.get('scope') === 'agency') {
    try { const ov = await buildOverview(from, to, preset, key); return json({ scope: 'agency', period: { from, to, preset }, ...ov }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  const c = CLIENTS[client]
  if (!c) return json({ error: `unknown client ${client}` }, 404)

  // Caalano360 — blended paid + CRM aggregate for a single client.
  if (channel === 'blend') {
    try { const blend = await buildBlend(c, from, to, preset, key); return json({ client, channel, period: { from, to, preset }, blend }, 200, true) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
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
