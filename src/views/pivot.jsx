// Pivot report. One client, any period, grouped by day / week / month /
// quarter / year: pick the metrics (Meta, Google, blended, CRM funnel and every
// configured key event), order them, and read them period by period like a
// P&L, with a graph of the ones you chart. Carved out of App.jsx so it loads
// on first open; the helpers it shares with the rest of the app come from there.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dlt, InfoTip, SETTINGS, Spinner, apiJson, bumpSettings, keyEventRows, keyEventsForPipe, loadKeyEvents, saveSettingsRemote, useSettingsSync, writeNavUrl } from '../App.jsx'
import { fmtCompact, fmtCurrency, fmtNumber, fmtPct } from '../lib/format.js'

// ---- periods -------------------------------------------------------------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d }
const firstOfMonth = (d, back = 0) => new Date(d.getFullYear(), d.getMonth() - back, 1, 12)
const lastOfMonth = (d, back = 0) => new Date(d.getFullYear(), d.getMonth() - back + 1, 0, 12)
export const PV_PRESETS = [
  ['last_12m', 'Last 12 months', 'month'],
  ['last_12full', 'Last 12 full months', 'month'],
  ['last_6m', 'Last 6 months', 'month'],
  ['this_year', 'This year', 'month'],
  ['last_year', 'Last year', 'month'],
  ['last_2y', 'Last 2 years', 'quarter'],
  ['this_quarter', 'This quarter', 'week'],
  ['last_90d', 'Last 90 days', 'week'],
  ['last_30d', 'Last 30 days', 'day'],
  ['custom', 'Custom', null],
]
export function presetBounds(id) {
  const t = today()
  switch (id) {
    case 'last_12m': return { from: iso(firstOfMonth(t, 11)), to: iso(t) }
    case 'last_12full': return { from: iso(firstOfMonth(t, 12)), to: iso(lastOfMonth(t, 1)) }
    case 'last_6m': return { from: iso(firstOfMonth(t, 5)), to: iso(t) }
    case 'this_year': return { from: `${t.getFullYear()}-01-01`, to: iso(t) }
    case 'last_year': return { from: `${t.getFullYear() - 1}-01-01`, to: `${t.getFullYear() - 1}-12-31` }
    case 'last_2y': return { from: iso(firstOfMonth(t, 23)), to: iso(t) }
    case 'this_quarter': { const q = Math.floor(t.getMonth() / 3) * 3; return { from: iso(new Date(t.getFullYear(), q, 1, 12)), to: iso(t) } }
    case 'last_90d': { const s = new Date(t); s.setDate(s.getDate() - 89); return { from: iso(s), to: iso(t) } }
    case 'last_30d': { const s = new Date(t); s.setDate(s.getDate() - 29); return { from: iso(s), to: iso(t) } }
    default: return null
  }
}
const BY = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']]

// ---- metrics -------------------------------------------------------------
// Every metric is a function of a bucket's base sums, so the Total column can
// re-derive ratios from summed inputs rather than averaging percentages.
const div = (a, b) => (b ? a / b : null)
export const PV_METRICS = [
  { id: 'm_spend', g: 'Meta', label: 'Spend', kind: 'money', good: 'neu', calc: (b) => b.m_spend, need: 'meta' },
  { id: 'm_results', g: 'Meta', label: (c) => c.resultType || 'Results', kind: 'count', good: 'up', calc: (b) => b.m_results, need: 'meta' },
  { id: 'm_cpr', g: 'Meta', label: (c) => `Cost / ${(c.resultType || 'result').toLowerCase().replace(/s$/, '')}`, kind: 'money', good: 'down', calc: (b) => div(b.m_spend, b.m_results), need: 'meta' },
  { id: 'm_impr', g: 'Meta', label: 'Impressions', kind: 'count', good: 'neu', calc: (b) => b.m_impr, need: 'meta' },
  { id: 'm_clicks', g: 'Meta', label: 'Link clicks', kind: 'count', good: 'up', calc: (b) => b.m_clicks, need: 'meta' },
  { id: 'm_ctr', g: 'Meta', label: 'CTR', kind: 'pct', good: 'up', calc: (b) => (b.m_impr ? (b.m_clicks / b.m_impr) * 100 : null), need: 'meta' },
  { id: 'm_cpm', g: 'Meta', label: 'CPM', kind: 'money', good: 'down', calc: (b) => (b.m_impr ? (b.m_spend / b.m_impr) * 1000 : null), need: 'meta' },
  { id: 'm_cpc', g: 'Meta', label: 'Cost / click', kind: 'money', good: 'down', calc: (b) => div(b.m_spend, b.m_clicks), need: 'meta' },
  { id: 'g_cost', g: 'Google', label: 'Spend', kind: 'money', good: 'neu', calc: (b) => b.g_cost, need: 'google' },
  { id: 'g_conv', g: 'Google', label: 'Conversions', kind: 'count', good: 'up', calc: (b) => b.g_conv, need: 'google' },
  { id: 'g_cpc', g: 'Google', label: 'Cost / conversion', kind: 'money', good: 'down', calc: (b) => div(b.g_cost, b.g_conv), need: 'google' },
  { id: 'g_clicks', g: 'Google', label: 'Clicks', kind: 'count', good: 'up', calc: (b) => b.g_clicks, need: 'google' },
  { id: 'g_impr', g: 'Google', label: 'Impressions', kind: 'count', good: 'neu', calc: (b) => b.g_impr, need: 'google' },
  { id: 'g_cvr', g: 'Google', label: 'Conversion rate', kind: 'pct', good: 'up', calc: (b) => (b.g_clicks ? (b.g_conv / b.g_clicks) * 100 : null), need: 'google' },
  { id: 'g_ctr', g: 'Google', label: 'CTR', kind: 'pct', good: 'up', calc: (b) => (b.g_impr ? (b.g_clicks / b.g_impr) * 100 : null), need: 'google' },
  { id: 'g_cpcl', g: 'Google', label: 'Cost / click', kind: 'money', good: 'down', calc: (b) => div(b.g_cost, b.g_clicks), need: 'google' },
  { id: 't_spend', g: 'Blended', label: 'Total ad spend', kind: 'money', good: 'neu', calc: (b) => b.m_spend + b.g_cost, need: 'ads' },
  { id: 't_results', g: 'Blended', label: 'Ad results (Meta + Google)', kind: 'count', good: 'up', calc: (b) => b.m_results + b.g_conv, need: 'ads' },
  { id: 't_cpr', g: 'Blended', label: 'Blended cost / result', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.m_results + b.g_conv), need: 'ads' },
  { id: 'c_leads', g: 'CRM', label: 'Leads', kind: 'count', good: 'up', calc: (b) => b.c_leads, need: 'crm' },
  { id: 'c_leads_paid', g: 'CRM', label: 'Paid leads (Meta + Google)', kind: 'count', good: 'up', calc: (b) => b.c_leads_meta + b.c_leads_google, need: 'crm' },
  { id: 'c_leads_meta', g: 'CRM', label: 'Leads · Meta', kind: 'count', good: 'up', calc: (b) => b.c_leads_meta, need: 'crm' },
  { id: 'c_leads_google', g: 'CRM', label: 'Leads · Google', kind: 'count', good: 'up', calc: (b) => b.c_leads_google, need: 'crm' },
  { id: 'c_leads_other', g: 'CRM', label: 'Leads · non-paid', kind: 'count', good: 'up', calc: (b) => b.c_leads_other, need: 'crm' },
  { id: 'c_cpl', g: 'CRM', label: 'Cost / lead (all leads)', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_leads), need: 'crmads' },
  { id: 'c_cpl_paid', g: 'CRM', label: 'Cost / paid lead', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_leads_meta + b.c_leads_google), need: 'crmads' },
  { id: 'c_booked', g: 'CRM', label: 'Booked', kind: 'count', good: 'up', calc: (b) => b.c_booked, need: 'crm' },
  { id: 'c_bookrate', g: 'CRM', label: 'Booking rate', kind: 'pct', good: 'up', calc: (b) => (b.c_leads ? (b.c_booked / b.c_leads) * 100 : null), need: 'crm' },
  { id: 'c_cost_booked', g: 'CRM', label: 'Cost / booked', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_booked), need: 'crmads' },
  { id: 'c_won', g: 'CRM', label: 'Won (by lead date)', kind: 'count', good: 'up', calc: (b) => b.c_won, need: 'crm' },
  { id: 'c_winrate', g: 'CRM', label: 'Win rate', kind: 'pct', good: 'up', calc: (b) => (b.c_leads ? (b.c_won / b.c_leads) * 100 : null), need: 'crm' },
  { id: 'c_cost_won', g: 'CRM', label: 'Cost / won', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_won), need: 'crmads' },
  { id: 'c_revenue', g: 'CRM', label: 'Revenue (by lead date)', kind: 'money', good: 'up', calc: (b) => b.c_revenue, need: 'crm' },
  { id: 'c_avgdeal', g: 'CRM', label: 'Avg deal', kind: 'money', good: 'up', calc: (b) => div(b.c_revenue, b.c_won), need: 'crm' },
  { id: 'c_roas', g: 'CRM', label: 'ROAS', kind: 'x', good: 'up', calc: (b) => div(b.c_revenue, b.m_spend + b.g_cost), need: 'crmads' },
  { id: 'c_won_closed', g: 'CRM', label: 'Won (by close date)', kind: 'count', good: 'up', calc: (b) => b.c_won_closed, need: 'crm' },
  { id: 'c_rev_closed', g: 'CRM', label: 'Revenue (by close date)', kind: 'money', good: 'up', calc: (b) => b.c_rev_closed, need: 'crm' },
  { id: 'c_lost', g: 'CRM', label: 'Lost', kind: 'count', good: 'down', calc: (b) => b.c_lost, need: 'crm' },
]
const DEFAULT_IDS = ['m_spend', 'm_results', 'm_cpr', 'g_cost', 'g_conv', 'g_cpc', 't_spend', 'c_leads', 'c_cpl', 'c_booked', 'c_won', 'c_revenue']
const DEFAULT_CHART = ['t_spend', 'c_leads', 'c_cpl']
const GROUP_ORDER = ['Meta', 'Google', 'Blended', 'CRM', 'Key events']
const PALETTE = ['#4f7cff', '#12b886', '#ec4899', '#f59e0b', '#8b5cf6', '#38bdf8']

// The base sums for one bucket (or for the whole range, when summed).
function baseOf(b, keRows) {
  const c = b.crm || {}
  const n = (o, k) => (o && o[k] ? o[k] : 0)
  const base = {
    m_spend: b.meta.spend || 0, m_results: b.meta.results || 0, m_impr: b.meta.impressions || 0, m_clicks: b.meta.linkClicks || 0,
    g_cost: b.google.cost || 0, g_conv: b.google.conversions || 0, g_clicks: b.google.clicks || 0, g_impr: b.google.impressions || 0,
    c_leads: n(c.leads, 'all'), c_leads_meta: n(c.leads, 'meta'), c_leads_google: n(c.leads, 'google'), c_leads_other: n(c.leads, 'other'),
    c_booked: n(c.booked, 'all'), c_won: n(c.won, 'all'), c_revenue: n(c.revenue, 'all'), c_lost: n(c.lost, 'all'),
    c_won_closed: n(c.wonClosed, 'all'), c_rev_closed: n(c.revenueClosed, 'all'),
  }
  for (const r of keRows) base['ke:' + r.label] = r.count || 0
  return base
}
const addBase = (a, b) => { const o = { ...a }; for (const k in b) o[k] = (o[k] || 0) + (b[k] || 0); return o }

const fmtVal = (m, v, currency) => {
  if (v == null || !isFinite(v)) return '-'
  if (m.kind === 'money') return fmtCurrency(v, currency)
  if (m.kind === 'pct') return fmtPct(v, 1)
  if (m.kind === 'x') return `${v.toFixed(2)}×`
  return fmtNumber(Math.round(v * 10) / 10)
}
const labelOf = (m, ctx) => (typeof m.label === 'function' ? m.label(ctx) : m.label)

// ---- the view --------------------------------------------------------------
export function PivotReport({ clients, currency }) {
  useSettingsSync()
  const list = (clients || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  const q0 = useMemo(() => { try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() } }, [])
  const [clientId, setClientId] = useState(() => (q0.get('c') && list.some((c) => c.id === q0.get('c'))) ? q0.get('c') : (list[0] ? list[0].id : ''))
  const client = list.find((c) => c.id === clientId) || null
  const [preset, setPreset] = useState(() => (PV_PRESETS.some(([id]) => id === q0.get('pp')) ? q0.get('pp') : 'last_12m'))
  const [custom, setCustom] = useState(() => ({ from: q0.get('pf') || iso(firstOfMonth(today(), 11)), to: q0.get('pt') || iso(today()) }))
  const [by, setBy] = useState(() => (BY.some(([id]) => id === q0.get('pb')) ? q0.get('pb') : 'month'))
  const [ids, setIds] = useState(() => (q0.get('pm') ? q0.get('pm').split(',').filter(Boolean) : DEFAULT_IDS))
  const [chart, setChart] = useState(() => (q0.get('pch') ? q0.get('pch').split(',').filter(Boolean) : DEFAULT_CHART))
  const [showDelta, setShowDelta] = useState(() => q0.get('pd') !== '0')
  const [pickOpen, setPickOpen] = useState(false)
  const bounds = preset === 'custom' ? custom : (presetBounds(preset) || custom)
  const pickPreset = (id) => { setPreset(id); const p = PV_PRESETS.find(([k]) => k === id); if (p && p[2]) setBy(p[2]) }
  // The shareable link: everything about this view lives in the URL.
  useEffect(() => { writeNavUrl({ v: 'monthly', s: 'pivot', c: clientId, pp: preset, pf: preset === 'custom' ? custom.from : null, pt: preset === 'custom' ? custom.to : null, pb: by, pm: ids.join(','), pch: chart.join(','), pd: showDelta ? null : '0' }, false) }, [clientId, preset, custom.from, custom.to, by, ids, chart, showDelta])

  const [st, setSt] = useState({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!client || !bounds.from || !bounds.to) return
    let alive = true; setSt({ status: 'loading' })
    apiJson(`/.netlify/functions/windsor?scope=pivot&client=${encodeURIComponent(client.id)}&from=${bounds.from}&to=${bounds.to}&by=${by}${nonce ? `&_r=${nonce}` : ''}`, { timeoutMs: 40000, tries: 2 })
      .then((j) => { if (alive) setSt(j && j.buckets ? { status: 'ok', data: j } : { status: 'err', error: (j && j.error) || 'No data.' }) })
      .catch((e) => { if (alive) setSt({ status: 'err', error: String(e.message || e) }) })
    return () => { alive = false }
  }, [clientId, bounds.from, bounds.to, by, nonce])
  const data = st.status === 'ok' ? st.data : null
  const ctx = { resultType: data ? data.resultType : 'Results' }

  // Key events for this client, resolved per bucket from the stages reached.
  const keDefs = useMemo(() => keyEventsForPipe(loadKeyEvents(clientId), 'all'), [clientId, SETTINGS.loaded])
  const stagePosMap = useMemo(() => new Map(Object.entries((data && data.stagePos) || {})), [data])
  const rows = useMemo(() => {
    if (!data) return []
    return data.buckets.map((b) => {
      const c = b.crm
      const ke = c ? keyEventRows(keDefs, { m: new Map(Object.entries(c.reach.all || {})), total: c.leads.all }, new Map(), stagePosMap, c.won.all).filter((r) => r.kind !== 'lead') : []
      return { key: b.key, label: b.label, from: b.from, to: b.to, base: baseOf(b, ke) }
    })
  }, [data, keDefs, stagePosMap])
  const keLabels = useMemo(() => { const s = new Set(); for (const r of rows) for (const k in r.base) if (k.startsWith('ke:')) s.add(k.slice(3)); return [...s] }, [rows])
  // Key-event metrics are added to the registry per client: a count and a cost.
  const metrics = useMemo(() => {
    const ke = keLabels.flatMap((l) => [
      { id: 'ke:' + l, g: 'Key events', label: l, kind: 'count', good: 'up', calc: (b) => b['ke:' + l] || 0, need: 'crm' },
      { id: 'kec:' + l, g: 'Key events', label: `Cost / ${l}`, kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b['ke:' + l] || 0), need: 'crmads' },
    ])
    return [...PV_METRICS, ...ke]
  }, [keLabels])
  const has = { meta: !!(data && data.hasMeta), google: !!(data && data.hasGoogle), crm: !!(data && data.hasCrm) }
  const applies = (m) => (m.need === 'meta' ? has.meta : m.need === 'google' ? has.google : m.need === 'ads' ? (has.meta || has.google) : m.need === 'crm' ? has.crm : m.need === 'crmads' ? has.crm && (has.meta || has.google) : true)
  const byId = useMemo(() => Object.fromEntries(metrics.map((m) => [m.id, m])), [metrics])
  const selected = ids.map((id) => byId[id]).filter((m) => m && applies(m))
  const total = useMemo(() => rows.reduce((a, r) => addBase(a, r.base), {}), [rows])
  const toggle = (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleChart = (id) => setChart((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]))
  // Drag a row's chip to reorder the table.
  const dragFrom = useRef(null)
  const reorder = (from, to) => { if (from == null || to == null || from === to) return; setIds((s) => { const n = s.slice(); const [x] = n.splice(from, 1); n.splice(to, 0, x); return n }) }
  const move = (i, dir) => reorder(i, Math.max(0, Math.min(ids.length - 1, i + dir)))

  // Saved views live in the shared settings blob (Settings section "pivot").
  const views = (SETTINGS.pivot && SETTINGS.pivot.views) || {}
  const saveView = () => {
    const name = window.prompt('Name this view', client ? `${client.name} · ${(PV_PRESETS.find(([k]) => k === preset) || [])[1] || 'Custom'} by ${by}` : 'My view'); if (!name) return
    const next = { ...views, [name.trim()]: { clientId, preset, custom, by, ids, chart, showDelta, savedAt: new Date().toISOString() } }
    SETTINGS.pivot = { ...(SETTINGS.pivot || {}), views: next }; saveSettingsRemote({ pivot: { views: next } }); bumpSettings()
  }
  const loadView = (name) => { const v = views[name]; if (!v) return; if (v.clientId && list.some((c) => c.id === v.clientId)) setClientId(v.clientId); setPreset(v.preset || 'last_12m'); if (v.custom) setCustom(v.custom); setBy(v.by || 'month'); setIds(v.ids || DEFAULT_IDS); setChart(v.chart || DEFAULT_CHART); setShowDelta(v.showDelta !== false) }
  const deleteView = (name) => { if (!window.confirm(`Delete the saved view "${name}"?`)) return; const next = { ...views }; delete next[name]; SETTINGS.pivot = { ...(SETTINGS.pivot || {}), views: next }; saveSettingsRemote({ pivot: { views: next } }); bumpSettings() }
  const [copied, setCopied] = useState(false)
  const copyLink = () => { try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ } }
  const exportCsv = () => {
    const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
    const head = ['Metric', ...rows.map((r) => r.label), 'Total']
    const lines = [head.join(','), ...selected.map((m) => [labelOf(m, ctx), ...rows.map((r) => { const v = m.calc(r.base); return v == null ? '' : Math.round(v * 100) / 100 }), (() => { const v = m.calc(total); return v == null ? '' : Math.round(v * 100) / 100 })()].map(esc).join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pivot-${client ? client.id : 'report'}-${bounds.from}_${bounds.to}-by-${by}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  // Chart: counts as bars on the left axis, money and rates as lines on the right.
  const chartMs = chart.map((id) => byId[id]).filter((m) => m && applies(m))
  const chartData = rows.map((r) => { const o = { label: r.label }; for (const m of chartMs) o[m.id] = m.calc(r.base); return o })
  const isBar = (m) => m.kind === 'count'
  const gTip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    return <div className="tr-gtip"><div className="tr-gtip-d">{label}</div>{payload.map((p) => { const m = byId[p.dataKey]; return m ? <div key={p.dataKey}><span className="tr-gtip-dot" style={{ background: p.color }} />{labelOf(m, ctx)}: <b>{fmtVal(m, p.value, currency)}</b></div> : null })}</div>
  }
  const groups = GROUP_ORDER.filter((g) => metrics.some((m) => m.g === g && applies(m)))
  const periodLabel = `${bounds.from} → ${bounds.to}`
  const notes = data ? [data.metaOk === false ? 'Meta did not answer - its figures are missing.' : null, data.googleOk === false ? 'Google did not answer - its figures are missing.' : null, data.crmOk === false ? `CRM figures are missing${data.crmErr ? ` (${data.crmErr})` : ''}.` : null].filter(Boolean) : []
  let lastGroup = null
  return (
    <div className="pv-page">
      <div className="pv-bar">
        <label className="act-sel">Client<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="act-sel">Period<select value={preset} onChange={(e) => pickPreset(e.target.value)}>{PV_PRESETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        {preset === 'custom' ? <span className="pv-custom"><input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /><span className="cap">to</span><input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></span> : null}
        <div className="chan-toggle sm">{BY.map(([id, l]) => <button key={id} className={by === id ? 'on' : ''} onClick={() => setBy(id)}>{l}</button>)}</div>
        <label className="pv-check"><input type="checkbox" checked={showDelta} onChange={(e) => setShowDelta(e.target.checked)} /> vs previous period</label>
        <span className="spacer" />
        <button className="mr-btn" onClick={() => setPickOpen((v) => !v)}>{pickOpen ? 'Done' : `Metrics · ${selected.length}`}</button>
        <button className="mr-btn" onClick={exportCsv} disabled={!rows.length}>⭳ CSV</button>
        <button className="mr-btn" onClick={copyLink}>{copied ? '✓ Copied' : '🔗 Copy link'}</button>
        <button className="mr-btn" onClick={() => setNonce(Date.now())} title="Rebuild from the sources">↻</button>
        <span className="pv-views">
          <select value="" onChange={(e) => { if (e.target.value === '__save') saveView(); else if (e.target.value.startsWith('__del:')) deleteView(e.target.value.slice(6)); else if (e.target.value) loadView(e.target.value); e.target.value = '' }}>
            <option value="">Saved views…</option>
            <option value="__save">＋ Save this view</option>
            {Object.keys(views).sort().map((n) => <option key={n} value={n}>{n}</option>)}
            {Object.keys(views).length ? <option disabled>──────</option> : null}
            {Object.keys(views).sort().map((n) => <option key={'d' + n} value={'__del:' + n}>✕ Delete “{n}”</option>)}
          </select>
        </span>
      </div>
      {pickOpen && (
        <div className="card pv-pick">
          <div className="set-head"><div className="set-head-t"><h3>Metrics<InfoTip>Tick what to show. Drag a row's handle in the table (or use the arrows) to change the order. The chart icon on a row puts it on the graph - up to four at once; counts draw as bars, money and rates as lines.</InfoTip></h3></div>
            <div className="set-head-a"><button className="btn-ghost sm" onClick={() => setIds(DEFAULT_IDS)}>Reset to default</button><button className="btn-ghost sm" onClick={() => setIds(metrics.filter(applies).map((m) => m.id))}>Select all</button><button className="btn-ghost sm" onClick={() => setIds([])}>Clear</button></div></div>
          <div className="pv-pick-grid">
            {groups.map((g) => (
              <div key={g} className="pv-pick-col">
                <div className="set-sec-t">{g}</div>
                {metrics.filter((m) => m.g === g && applies(m)).map((m) => (
                  <label key={m.id} className={`pv-pick-row${ids.includes(m.id) ? ' on' : ''}`}><input type="checkbox" checked={ids.includes(m.id)} onChange={() => toggle(m.id)} /><span>{labelOf(m, ctx)}</span></label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {st.status === 'loading' ? <div className="card"><Spinner label={`Building ${client ? client.name : ''} by ${by}…`} /></div>
        : st.status === 'err' ? <div className="card"><p className="cap act-bad" style={{ margin: 0 }}>Couldn't build the report: {st.error}</p></div>
          : !data ? null : (
            <>
              {notes.length ? <div className="card pv-note">{notes.map((n, i) => <p key={i} className="cap act-bad" style={{ margin: 0 }}>{n}</p>)}</div> : null}
              {chartMs.length ? (
                <div className="card pv-chart-card">
                  <div className="set-head"><div className="set-head-t"><h3>{client ? client.name : ''} <span className="pv-sub">· {periodLabel} · by {by}</span></h3></div>
                    <div className="set-head-a pv-legend-pick">{chartMs.map((m, i) => <button key={m.id} className="pv-chip on" style={{ '--c': PALETTE[i % PALETTE.length] }} onClick={() => toggleChart(m.id)} title="Remove from the graph"><i />{labelOf(m, ctx)} ✕</button>)}</div></div>
                  <div className="pv-chart">
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={chartData} margin={{ left: -4, right: 8, top: 8 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" minTickGap={16} />
                        <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} tickFormatter={(v) => fmtCompact(v)} hide={!chartMs.some(isBar)} />
                        {/* Bars share the left axis; each line has its own scale (only the
                            first is drawn) so a $50 cost per lead is not flattened under a
                            $6,000 spend line. */}
                        {chartMs.filter((m) => !isBar(m)).map((m, i) => <YAxis key={m.id} yAxisId={m.id} orientation="right" fontSize={10} stroke={PALETTE[chartMs.indexOf(m) % PALETTE.length]} tickFormatter={(v) => (m.kind === 'money' ? '$' + fmtCompact(v) : m.kind === 'pct' ? `${Math.round(v)}%` : fmtCompact(v))} hide={i > 0} />)}
                        <Tooltip content={gTip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => { const m = byId[v]; return m ? labelOf(m, ctx) : v }} />
                        {chartMs.map((m, i) => (isBar(m)
                          ? <Bar key={m.id} yAxisId="l" dataKey={m.id} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                          : <Line key={m.id} yAxisId={m.id} dataKey={m.id} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={rows.length <= 40} connectNulls />))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
              <div className="card pv-tbl-card">
                <div className="set-head"><div className="set-head-t"><h3>Period by period<InfoTip>Each column is one {by}; the last column is the whole range (ratios re-derived from the totals, not averaged). Ad figures are ad-reported by day; CRM figures count on the lead's created date, with "by close date" wins and revenue on the day the deal closed. Green is a move in the right direction against the column before, red the wrong way, grey is spend.</InfoTip></h3><p className="set-sub">{rows.length} {by === 'day' ? 'days' : by === 'week' ? 'weeks' : by === 'month' ? 'months' : by === 'quarter' ? 'quarters' : 'years'} · {periodLabel}</p></div></div>
                {!selected.length ? <p className="cap">Pick some metrics to show.</p> : (
                  <div className="pv-wrap">
                    <table className="mini-tbl pv-tbl">
                      <thead><tr><th className="lft pv-first">Metric</th>{rows.map((r) => <th key={r.key} title={`${r.from} → ${r.to}`}>{r.label}</th>)}<th className="pv-total">Total</th></tr></thead>
                      <tbody>
                        {selected.map((m, i) => {
                          const head = m.g !== lastGroup ? <tr key={'g:' + m.g} className="pv-grp"><td colSpan={rows.length + 2}><span>{m.g}</span></td></tr> : null
                          lastGroup = m.g
                          const onChart = chart.includes(m.id)
                          return (
                            <React.Fragment key={m.id}>
                              {head}
                              <tr draggable onDragStart={() => { dragFrom.current = ids.indexOf(m.id) }} onDragOver={(e) => e.preventDefault()} onDrop={() => { reorder(dragFrom.current, ids.indexOf(m.id)); dragFrom.current = null }}>
                                <td className="lft pv-first">
                                  <span className="pv-handle" title="Drag to reorder">⋮⋮</span>
                                  <span className="pv-lab">{labelOf(m, ctx)}</span>
                                  <span className="pv-row-tools">
                                    <button className={`pv-ico${onChart ? ' on' : ''}`} title={onChart ? 'Remove from the graph' : 'Add to the graph'} onClick={() => toggleChart(m.id)}>📈</button>
                                    <button className="pv-ico" title="Move up" onClick={() => move(ids.indexOf(m.id), -1)}>↑</button>
                                    <button className="pv-ico" title="Move down" onClick={() => move(ids.indexOf(m.id), 1)}>↓</button>
                                    <button className="pv-ico" title="Remove" onClick={() => toggle(m.id)}>✕</button>
                                  </span>
                                </td>
                                {rows.map((r, j) => { const v = m.calc(r.base); const p = j > 0 ? m.calc(rows[j - 1].base) : null; return <td key={r.key}><span className="tr-cell">{fmtVal(m, v, currency)}{showDelta && j > 0 ? <Dlt cur={v} prev={p} good={m.good} pts={m.kind === 'pct'} dp={m.kind === 'pct' ? 1 : 0} /> : null}</span></td> })}
                                <td className="pv-total">{fmtVal(m, m.calc(total), currency)}</td>
                              </tr>
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
    </div>
  )
}
