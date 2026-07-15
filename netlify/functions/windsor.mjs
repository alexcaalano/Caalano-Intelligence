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
  'swift-emergency': { meta: '1080637839761918', google: '758-072-0309', ghl: 'o7egUI0G0Zg7fUOiYqv1' },
  'ido-ido':         { meta: '1446200046468733', google: null, ghl: '6SmZLew5uXimr99jbuId' },
  'owl-psa':         { meta: '24559773240339868', google: null, ghl: '6hgW5WnFz8drlch9qJzg' },
  'psychology-hub':  { meta: '1849212035791025', google: null, ghl: 'U1Q0S61tIEvrzM4hdZSV' },
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

function rollupMeta(rows) {
  const by = (keyFn) => {
    const m = new Map()
    for (const r of rows) {
      const k = keyFn(r); if (!k) continue
      const e = m.get(k) || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, videoViews: 0 }
      e.spend += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks)
      e.linkClicks += num(r.inline_link_clicks); e.leads += num(r.actions_lead); e.videoViews += num(r.actions_video_view)
      m.set(k, e)
    }
    return m
  }
  const campaigns = [...by((r) => r.campaign).entries()].map(([name, v]) => ({ name, ...v }))
  const adsets = [...by((r) => r.adset_name).entries()].map(([name, v]) => ({ name, ...v }))
  const ads = rows.map((r) => ({
    name: r.ad_name, type: /video/i.test(r.quality_ranking) ? 'Video' : (num(r.actions_video_view) > 0 ? 'Video' : 'Image'),
    quality: r.quality_ranking || 'UNKNOWN', thumb: r.thumbnail_url,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
    linkClicks: num(r.inline_link_clicks), leads: num(r.actions_lead), videoViews: num(r.actions_video_view),
  })).filter((a) => a.name).sort((a, b) => b.spend - a.spend).slice(0, 24)
  return { campaigns: campaigns.sort((a, b) => b.spend - a.spend), adsets: adsets.sort((a, b) => b.spend - a.spend), ads }
}

function rollupGoogle(rows) {
  const cleanAg = (r) => r.ad_group_name || (r.ad_group ? String(r.ad_group).split('/').pop() : null)
  const agg = (rowsIn, keyFn) => {
    const m = new Map()
    for (const r of rowsIn) {
      const k = keyFn(r); if (!k) continue
      const e = m.get(k) || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
      e.cost += num(r.spend); e.impressions += num(r.impressions); e.clicks += num(r.clicks); e.conversions += num(r.conversions)
      m.set(k, e)
    }
    return m
  }
  const campaigns = [...agg(rows, (r) => r.campaign).entries()].map(([name, v]) => ({ name, status: 'Enabled', ...v })).sort((a, b) => b.cost - a.cost)
  const adGroups = [...agg(rows, cleanAg).entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost)
  const kwRows = rows.filter((r) => r.keyword)
  const kwMap = agg(kwRows, (r) => r.keyword)
  const kwMeta = new Map()
  for (const r of kwRows) { const e = kwMeta.get(r.keyword) || { match: r.search_keyword_match_type || '—', qs: '' }; const q = num(r.quality_score); if (q) e.qs = Math.max(e.qs || 0, q); if (!e.match || e.match === '—') e.match = r.search_keyword_match_type || '—'; kwMeta.set(r.keyword, e) }
  const keywords = [...kwMap.entries()].map(([text, v]) => ({ text, match: kwMeta.get(text)?.match || '—', qs: kwMeta.get(text)?.qs ?? '', ...v })).sort((a, b) => b.cost - a.cost).slice(0, 25)
  const mt = new Map()
  for (const r of kwRows) { const t = r.search_keyword_match_type; if (!t) continue; const e = mt.get(t) || { type: t, cost: 0, clicks: 0, conversions: 0 }; e.cost += num(r.spend); e.clicks += num(r.clicks); e.conversions += num(r.conversions); mt.set(t, e) }
  return { campaigns, adGroups, keywords, matchTypes: [...mt.values()].sort((a, b) => b.cost - a.cost), matchTypeNote: 'Live from Windsor.ai — spend by keyword match type.', keywordsTotal: new Set(kwRows.map((r) => r.keyword)).size, searchTermsTotal: null }
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
  const c = CLIENTS[client]
  if (!c) return json({ error: `unknown client ${client}` }, 404)
  const spec = FIELDS[channel]
  if (!spec) return json({ error: `unknown channel ${channel}` }, 400)
  const accountId = c[channel]
  if (!accountId) return json({ error: `no ${channel} account for ${client}` }, 404)

  try {
    const fields = [...spec.dims, ...spec.metrics]
    const rowsAll = await windsorFetch(spec.connector, fields, from, to, preset, key)
    const rows = rowsAll.filter((r) => !r.account_id || norm(r.account_id) === norm(accountId))
    if (debug) return json({ channel, accountId, fieldsRequested: fields, rowCount: rows.length, sample: rows.slice(0, 3), sampleKeys: rows[0] ? Object.keys(rows[0]) : [] })
    const out = channel === 'meta' ? { meta: rollupMeta(rows) } : channel === 'google' ? { google: rollupGoogle(rows) } : { ghl: rollupGhl(rows) }
    return json({ client, channel, period: { from, to, preset }, ...out }, 200, true)
  } catch (e) {
    return json({ error: String(e.message || e) }, 502)
  }
}
