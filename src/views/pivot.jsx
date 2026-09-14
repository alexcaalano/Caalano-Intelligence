// Trend Report. One client, any period, grouped by day / week / month /
// quarter / year: pick the metrics (Meta, Google, blended, CRM funnel and every
// configured key event), order them, and read them period by period like a
// P&L, with a graph of the ones you chart. Carved out of App.jsx so it loads
// on first open; the helpers it shares with the rest of the app come from there.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dlt, InfoTip, SETTINGS, Spinner, apiJson, bumpSettings, keyEventRows, keyEventsForPipe, loadCashOn, loadKeyEvents, saveSettingsRemote, useSettingsSync, writeNavUrl } from '../App.jsx'
import { fmtCompact, fmtCurrency, fmtNumber, fmtPct } from '../lib/format.js'

// ---- periods -------------------------------------------------------------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d }
const firstOfMonth = (d, back = 0) => new Date(d.getFullYear(), d.getMonth() - back, 1, 12)
const lastOfMonth = (d, back = 0) => new Date(d.getFullYear(), d.getMonth() - back + 1, 0, 12)
// Shortest to longest. The financial year runs 1 July to 30 June.
export const PV_PRESETS = [
  ['last_30d', 'Last 30 days', 'day'],
  ['last_60d', 'Last 60 days', 'week'],
  ['last_90d', 'Last 90 days', 'week'],
  ['this_quarter', 'This quarter', 'week'],
  ['last_quarter', 'Last quarter', 'week'],
  ['ytd', 'Calendar year to date', 'month'],
  ['fytd', 'Financial year to date', 'month'],
  ['last_12m', 'Last 12 months', 'month'],
  ['last_12full', 'Last 12 full months', 'month'],
  ['last_year', 'Last calendar year', 'month'],
  ['last_fy', 'Last financial year', 'month'],
  ['last_2y', 'Last 2 years', 'quarter'],
  ['custom', 'Custom', null],
]
export function presetBounds(id) {
  const t = today()
  const daysBack = (n) => { const s = new Date(t); s.setDate(s.getDate() - (n - 1)); return { from: iso(s), to: iso(t) } }
  const fyStart = (y) => new Date(y, 6, 1, 12)
  const fy = t.getMonth() >= 6 ? t.getFullYear() : t.getFullYear() - 1
  switch (id) {
    case 'last_30d': return daysBack(30)
    case 'last_60d': return daysBack(60)
    case 'last_90d': return daysBack(90)
    case 'this_quarter': { const q = Math.floor(t.getMonth() / 3) * 3; return { from: iso(new Date(t.getFullYear(), q, 1, 12)), to: iso(t) } }
    case 'last_quarter': { const q = Math.floor(t.getMonth() / 3) * 3; return { from: iso(new Date(t.getFullYear(), q - 3, 1, 12)), to: iso(new Date(t.getFullYear(), q, 0, 12)) } }
    case 'ytd': return { from: `${t.getFullYear()}-01-01`, to: iso(t) }
    case 'fytd': return { from: iso(fyStart(fy)), to: iso(t) }
    case 'last_12m': return { from: iso(firstOfMonth(t, 11)), to: iso(t) }
    case 'last_12full': return { from: iso(firstOfMonth(t, 12)), to: iso(lastOfMonth(t, 1)) }
    case 'last_year': return { from: `${t.getFullYear() - 1}-01-01`, to: `${t.getFullYear() - 1}-12-31` }
    case 'last_fy': return { from: iso(fyStart(fy - 1)), to: iso(new Date(fy, 5, 30, 12)) }
    case 'last_2y': return { from: iso(firstOfMonth(t, 23)), to: iso(t) }
    // Older links used these ids.
    case 'this_year': return { from: `${t.getFullYear()}-01-01`, to: iso(t) }
    case 'last_6m': return { from: iso(firstOfMonth(t, 5)), to: iso(t) }
    default: return null
  }
}
// A long range is built in parts so each fits the server's time budget: the
// CRM in one call, the ad platforms a calendar month at a time. Every base
// figure is a sum, so the parts add up per bucket.
export function monthChunks(from, to) {
  const out = []
  let d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)
    out.push({ from: iso(d), to: iso(last < end ? last : end) })
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12)
  }
  return out
}
const mergeBuckets = (into, part) => {
  const m = new Map(into.map((b) => [b.key, b]))
  for (const p of part) {
    const b = m.get(p.key); if (!b) continue
    for (const k in p.meta) b.meta[k] = (b.meta[k] || 0) + (p.meta[k] || 0)
    for (const k in p.google) b.google[k] = (b.google[k] || 0) + (p.google[k] || 0)
    if (p.crm) {
      if (!b.crm) { b.crm = p.crm; continue }
      for (const k in p.crm) {
        if (k === 'reach') { for (const ch in p.crm.reach) { b.crm.reach[ch] = b.crm.reach[ch] || {}; for (const nm in p.crm.reach[ch]) b.crm.reach[ch][nm] = (b.crm.reach[ch][nm] || 0) + p.crm.reach[ch][nm] } }
        else if (p.crm[k] && typeof p.crm[k] === 'object') { b.crm[k] = b.crm[k] || {}; for (const ch in p.crm[k]) b.crm[k][ch] = (b.crm[k][ch] || 0) + (p.crm[k][ch] || 0) }
      }
    }
  }
}
const dmy = (ds) => { const [y, m, d] = String(ds || '').split('-'); return d ? `${d}/${m}/${y}` : ds }
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
  { id: 'm_allclicks', g: 'Meta', label: 'Clicks (all)', kind: 'count', good: 'up', calc: (b) => b.m_allclicks, need: 'meta' },
  { id: 'm_ctr', g: 'Meta', label: 'Link CTR', kind: 'pct', good: 'up', calc: (b) => (b.m_impr ? (b.m_clicks / b.m_impr) * 100 : null), need: 'meta' },
  { id: 'm_ctr_all', g: 'Meta', label: 'CTR (all clicks)', kind: 'pct', good: 'up', calc: (b) => (b.m_impr ? (b.m_allclicks / b.m_impr) * 100 : null), need: 'meta' },
  { id: 'm_cvr', g: 'Meta', label: 'Conversion rate', kind: 'pct', good: 'up', calc: (b) => (b.m_clicks ? (b.m_results / b.m_clicks) * 100 : null), need: 'meta', hint: 'results ÷ link clicks' },
  { id: 'm_reach', g: 'Meta', label: 'Reach', kind: 'count', good: 'up', calc: (b) => (b.m_reach > 0 ? b.m_reach : null), need: 'meta', hint: 'people reached · month grouping only', month: true },
  { id: 'm_freq', g: 'Meta', label: 'Frequency', kind: 'x', good: 'down', calc: (b) => (b.m_reach > 0 ? b.m_impr / b.m_reach : null), need: 'meta', hint: 'impressions ÷ reach · month grouping only', month: true },
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
  { id: 'c_leads', g: 'CRM', label: 'Leads', src: 'all', kind: 'count', good: 'up', calc: (b) => b.c_leads, need: 'crm' },
  { id: 'c_leads_paid', g: 'CRM', label: 'Leads', src: 'paid', kind: 'count', good: 'up', calc: (b) => b.c_leads_meta + b.c_leads_google, need: 'crm' },
  { id: 'c_leads_meta', g: 'CRM', label: 'Leads', src: 'meta', kind: 'count', good: 'up', calc: (b) => b.c_leads_meta, need: 'crm' },
  { id: 'c_leads_google', g: 'CRM', label: 'Leads', src: 'google', kind: 'count', good: 'up', calc: (b) => b.c_leads_google, need: 'crm' },
  { id: 'c_leads_other', g: 'CRM', label: 'Leads', src: 'other', kind: 'count', good: 'up', calc: (b) => b.c_leads_other, need: 'crm' },
  { id: 'c_cpl', g: 'CRM', label: 'Cost / lead', src: 'all', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_leads), need: 'crmads' },
  { id: 'c_cpl_paid', g: 'CRM', label: 'Cost / lead', src: 'paid', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_leads_meta + b.c_leads_google), need: 'crmads' },
  { id: 'c_booked', g: 'CRM', label: 'Booked', kind: 'count', good: 'up', calc: (b) => b.c_booked, need: 'crm' },
  { id: 'c_bookrate', g: 'CRM', label: 'Booking rate', kind: 'pct', good: 'up', calc: (b) => (b.c_leads ? (b.c_booked / b.c_leads) * 100 : null), need: 'crm' },
  { id: 'c_cost_booked', g: 'CRM', label: 'Cost / booked', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_booked), need: 'crmads' },
  { id: 'c_won', g: 'CRM', label: 'Won (by created date)', kind: 'count', good: 'up', calc: (b) => b.c_won, need: 'crm' },
  { id: 'c_winrate', g: 'CRM', label: 'Win rate', kind: 'pct', good: 'up', calc: (b) => (b.c_leads ? (b.c_won / b.c_leads) * 100 : null), need: 'crm' },
  { id: 'c_cost_won', g: 'CRM', label: 'Cost / won', kind: 'money', good: 'down', calc: (b) => div(b.m_spend + b.g_cost, b.c_won), need: 'crmads' },
  { id: 'c_revenue', g: 'CRM', label: 'Revenue (by created date)', kind: 'money', good: 'up', calc: (b) => b.c_revenue, need: 'crm' },
  { id: 'c_avgdeal', g: 'CRM', label: 'Avg deal', kind: 'money', good: 'up', calc: (b) => div(b.c_revenue, b.c_won), need: 'crm' },
  { id: 'c_roas', g: 'CRM', label: 'ROAS', kind: 'x', good: 'up', calc: (b) => div(b.c_revenue, b.m_spend + b.g_cost), need: 'crmads' },
  { id: 'c_cash', g: 'CRM', label: 'Cash collected (by created date)', kind: 'money', good: 'up', calc: (b) => b.c_cash, need: 'cash' },
  { id: 'c_won_closed', g: 'CRM', label: 'Won (by closed date)', kind: 'count', good: 'up', calc: (b) => b.c_won_closed, need: 'crm' },
  { id: 'c_rev_closed', g: 'CRM', label: 'Revenue (by closed date)', kind: 'money', good: 'up', calc: (b) => b.c_rev_closed, need: 'crm' },
  { id: 'c_cash_closed', g: 'CRM', label: 'Cash collected (by closed date)', kind: 'money', good: 'up', calc: (b) => b.c_cash_closed, need: 'cash' },
  { id: 'c_lost', g: 'CRM', label: 'Lost', kind: 'count', good: 'down', calc: (b) => b.c_lost, need: 'crm' },
]
// Lead-source segments, coloured as everywhere else in the app (Meta blue,
// Google green, Paid purple, CRM amber for non-paid, grey for all).
export const PV_SRC = [['all', 'All', ''], ['paid', 'Paid', 'sc-paid'], ['meta', 'Meta', 'sc-meta'], ['google', 'Google', 'sc-google'], ['other', 'Non-paid', 'sc-crm']]
const srcOf = (k) => PV_SRC.find(([id]) => id === k) || PV_SRC[0]
const SrcTag = ({ src }) => (src ? <span className={`agy-scope pv-src ${srcOf(src)[2]}`}>{srcOf(src)[1]}</span> : null)
// Older links and saved views named a key event without a source: that was "all".
const normId = (id) => (/^kec?:/.test(id) && id.split(':').length === 2 ? id + ':all' : id)
// Entity rows: campaigns, ad sets and creatives (Meta), campaigns and ad
// groups (Google), each laid out period by period under its platform. Read
// from the server a month at a time; creatives only on month grouping and
// longer, since a day-by-day creative read is too heavy.
export const ENT_KINDS = [
  { id: 'mcamp', g: 'Meta', label: 'Campaigns', plat: 'meta', key: (e) => e.name },
  { id: 'madset', g: 'Meta', label: 'Ad sets', plat: 'meta', key: (e) => `${e.campaign}|${e.name}` },
  { id: 'mad', g: 'Meta', label: 'Creatives', plat: 'meta', key: (e) => e.name, monthOnly: true },
  { id: 'gcamp', g: 'Google', label: 'Campaigns', plat: 'google', key: (e) => e.name },
  { id: 'gadgroup', g: 'Google', label: 'Ad groups', plat: 'google', key: (e) => `${e.campaign}|${e.name}` },
]
export const ENT_METRICS = {
  meta: [
    { id: 'spend', label: 'Spend', kind: 'money', good: 'neu', calc: (a) => a.spend },
    { id: 'results', label: (a) => a.resultType || 'Results', kind: 'count', good: 'up', calc: (a) => a.results },
    { id: 'cpr', label: 'Cost / result', kind: 'money', good: 'down', calc: (a) => div(a.spend, a.results) },
    { id: 'impr', label: 'Impressions', kind: 'count', good: 'neu', calc: (a) => a.impressions },
    { id: 'clicks', label: 'Link clicks', kind: 'count', good: 'up', calc: (a) => a.linkClicks },
    { id: 'ctr', label: 'Link CTR', kind: 'pct', good: 'up', calc: (a) => (a.impressions ? (a.linkClicks / a.impressions) * 100 : null) },
  ],
  google: [
    { id: 'cost', label: 'Spend', kind: 'money', good: 'neu', calc: (a) => a.cost },
    { id: 'conv', label: 'Conversions', kind: 'count', good: 'up', calc: (a) => a.conversions },
    { id: 'cpc', label: 'Cost / conversion', kind: 'money', good: 'down', calc: (a) => div(a.cost, a.conversions) },
    { id: 'clicks', label: 'Clicks', kind: 'count', good: 'up', calc: (a) => a.clicks },
    { id: 'impr', label: 'Impressions', kind: 'count', good: 'neu', calc: (a) => a.impressions },
    { id: 'cvr', label: 'Conversion rate', kind: 'pct', good: 'up', calc: (a) => (a.clicks ? (a.conversions / a.clicks) * 100 : null) },
  ],
}
const ENT_DEFAULT = { meta: ['spend', 'results', 'cpr'], google: ['cost', 'conv', 'cpc'] }
const ENT_TOP = 10
// Sum one entity's chunk figures into its bucket entry.
const addEnt = (into, e) => {
  const o = into || { name: e.name, campaign: e.campaign || null, adset: e.adset || null, spend: 0, cost: 0, impressions: 0, clicks: 0, linkClicks: 0, results: 0, conversions: 0, resultType: e.resultType || null, type: e.type || null, thumb: e.thumb || null, video: e.video || null, preview: e.preview || null, igUrl: e.igUrl || null }
  for (const k of ['spend', 'cost', 'impressions', 'clicks', 'linkClicks', 'results', 'conversions']) o[k] += e[k] || 0
  if (!o.thumb && e.thumb) o.thumb = e.thumb
  if (!o.video && e.video) o.video = e.video
  if (!o.resultType && e.resultType) o.resultType = e.resultType
  return o
}
const DEFAULT_IDS = ['m_spend', 'm_results', 'm_cpr', 'g_cost', 'g_conv', 'g_cpc', 't_spend', 'c_leads', 'c_cpl', 'c_booked', 'c_won', 'c_revenue']
const DEFAULT_CHART = ['t_spend', 'c_leads', 'c_cpl']
const GROUP_ORDER = ['Meta', 'Google', 'Blended', 'CRM', 'Key events']
const PALETTE = ['#4f7cff', '#12b886', '#ec4899', '#f59e0b', '#8b5cf6', '#38bdf8']

// The base sums for one bucket (or for the whole range, when summed).
function baseOf(b, keBySrc) {
  const c = b.crm || {}
  const n = (o, k) => (o && o[k] ? o[k] : 0)
  const base = {
    m_spend: b.meta.spend || 0, m_results: b.meta.results || 0, m_impr: b.meta.impressions || 0, m_clicks: b.meta.linkClicks || 0, m_allclicks: b.meta.clicks || 0, m_reach: b.meta.reach || 0,
    g_cost: b.google.cost || 0, g_conv: b.google.conversions || 0, g_clicks: b.google.clicks || 0, g_impr: b.google.impressions || 0,
    c_leads: n(c.leads, 'all'), c_leads_meta: n(c.leads, 'meta'), c_leads_google: n(c.leads, 'google'), c_leads_other: n(c.leads, 'other'),
    c_booked: n(c.booked, 'all'), c_won: n(c.won, 'all'), c_revenue: n(c.revenue, 'all'), c_lost: n(c.lost, 'all'),
    c_won_closed: n(c.wonClosed, 'all'), c_rev_closed: n(c.revenueClosed, 'all'), c_cash: n(c.cash, 'all'), c_cash_closed: n(c.cashClosed, 'all'),
  }
  for (const src in keBySrc) for (const r of keBySrc[src]) base[`ke:${r.label}:${src}`] = r.count || 0
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

// Value labels: our own <text> so they can be found afterwards, then nudged
// apart. Recharts places each series' labels on its own, so a spend label and
// a cost label at the same x often land on each other; after every render the
// labels are read back from the SVG and any two that overlap are pushed apart
// vertically (the later one up, or down when it would leave the top).
const pvLabel = (m, currency, color) => (props) => {
  const { x, y, width, value } = props
  if (value == null || !isFinite(value) || x == null || y == null) return null
  const cx = width != null ? x + width / 2 : x
  return <text className="pv-lbl" x={cx} y={y - 7} textAnchor="middle" fontSize={10} fill={color}>{fmtVal(m, value, currency)}</text>
}
function deoverlapLabels(root) {
  if (!root) return
  const els = [...root.querySelectorAll('text.pv-lbl')]
  for (const el of els) el.removeAttribute('transform')
  const box = (el) => { const b = el.getBBox(); const ty = Number(el.dataset.dy || 0); return { x: b.x, y: b.y + ty, w: b.width, h: b.height } }
  const svgH = root.querySelector('svg') ? root.querySelector('svg').getBoundingClientRect().height : 260
  for (const el of els) el.dataset.dy = '0'
  for (let pass = 0; pass < 12; pass++) {
    let moved = false
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = box(els[i]), b = box(els[j])
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox <= 0 || oy <= 0) continue
      // Push the lower one further down and the upper one up, sharing the move;
      // anything that would leave the top of the plot moves down instead.
      const [up, down] = a.y <= b.y ? [els[i], els[j]] : [els[j], els[i]]
      const need = oy + 2
      const upDy = Number(up.dataset.dy) - need / 2, downDy = Number(down.dataset.dy) + need / 2
      const upBox = box(up)
      if (upBox.y - need / 2 < 2) { down.dataset.dy = String(Number(down.dataset.dy) + need) } else { up.dataset.dy = String(upDy); down.dataset.dy = String(Math.min(downDy, svgH)) }
      moved = true
    }
    if (!moved) break
  }
  for (const el of els) { const dy = Number(el.dataset.dy || 0); if (dy) el.setAttribute('transform', `translate(0 ${dy.toFixed(1)})`) }
}
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
  const [ids, setIds] = useState(() => (q0.get('pm') ? q0.get('pm').split(',').filter(Boolean).map(normId) : DEFAULT_IDS))
  const [chart, setChart] = useState(() => (q0.get('pch') ? q0.get('pch').split(',').filter(Boolean).map(normId) : DEFAULT_CHART))
  const [showDelta, setShowDelta] = useState(() => q0.get('pd') !== '0')
  // Total and Average columns, as on a P&L: Total on by default, Average off.
  const [showTotal, setShowTotal] = useState(() => q0.get('ptot') !== '0')
  const [showAvg, setShowAvg] = useState(() => q0.get('pavg') === '1')
  const [ents, setEnts] = useState(() => (q0.get('pe') ? q0.get('pe').split(',').filter((k) => ENT_KINDS.some((x) => x.id === k)) : []))
  const [entM, setEntM] = useState(() => ({ meta: q0.get('pem') ? q0.get('pem').split(',').filter(Boolean) : ENT_DEFAULT.meta, google: q0.get('peg') ? q0.get('peg').split(',').filter(Boolean) : ENT_DEFAULT.google }))
  const [entAll, setEntAll] = useState({})   // kind -> true when every entity is shown, not just the top ten
  const [entSt, setEntSt] = useState({ status: 'idle', by: {}, key: '' }) // by: bucketKey -> kind -> Map(entityKey -> agg)
  const [play, setPlay] = useState(null)     // creative being played / previewed
  const [hover, setHover] = useState(null)   // { src, x, y } thumbnail preview
  const toggleEnt = (k) => setEnts((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  const toggleEntM = (plat, id) => setEntM((m) => ({ ...m, [plat]: m[plat].includes(id) ? m[plat].filter((x) => x !== id) : [...m[plat], id] }))
  const [labels, setLabels] = useState(() => (q0.get('pl') ? q0.get('pl').split(',').filter(Boolean).map(normId) : []))
  const chartRef = useRef(null)
  // Nudge overlapping value labels apart once the chart has drawn (and again on resize).
  useEffect(() => {
    if (!labels.length) return
    const run = () => deoverlapLabels(chartRef.current)
    const t1 = setTimeout(run, 60), t2 = setTimeout(run, 400)
    window.addEventListener('resize', run)
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', run) }
  })
  const toggleLabel = (id) => setLabels((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const [pickOpen, setPickOpen] = useState(false)
  // A client's saved default layout: metrics, chart, period and grouping. It
  // loads whenever that client is picked; the URL wins only on first open.
  const defaults = (SETTINGS.pivot && SETTINGS.pivot.defaults) || {}
  const applyLayout = (v) => { if (!v) return; setPreset(v.preset || 'last_12m'); if (v.custom) setCustom(v.custom); setBy(v.by || 'month'); setIds((v.ids || DEFAULT_IDS).map(normId)); setChart((v.chart || DEFAULT_CHART).map(normId)); setLabels((v.labels || []).map(normId)); setShowDelta(v.showDelta !== false); setShowTotal(v.showTotal !== false); setShowAvg(!!v.showAvg); setEnts(v.ents || []); setEntM({ meta: (v.entM && v.entM.meta) || ENT_DEFAULT.meta, google: (v.entM && v.entM.google) || ENT_DEFAULT.google }) }
  const layout = () => ({ preset, custom, by, ids, chart, labels, showDelta, showTotal, showAvg, ents, entM, savedAt: new Date().toISOString() })
  const firstRun = useRef(true)
  useEffect(() => { if (firstRun.current) { firstRun.current = false; if (!q0.get('pm') && defaults[clientId]) applyLayout(defaults[clientId]); return } applyLayout(defaults[clientId] || null) /* eslint-disable-next-line */ }, [clientId])
  const writeDefaults = (next) => { SETTINGS.pivot = { ...(SETTINGS.pivot || {}), defaults: next }; saveSettingsRemote({ pivot: { defaults: next } }); bumpSettings() }
  const [defSaved, setDefSaved] = useState(false)
  const saveDefault = () => { writeDefaults({ ...defaults, [clientId]: layout() }); setDefSaved(true); setTimeout(() => setDefSaved(false), 1600) }
  const clearDefault = () => { if (!window.confirm(`Remove ${client ? client.name : 'this client'}'s default layout? The report will open on the standard set instead.`)) return; const next = { ...defaults }; delete next[clientId]; writeDefaults(next) }
  const isDefault = !!defaults[clientId] && JSON.stringify({ ...defaults[clientId], savedAt: 0 }) === JSON.stringify({ ...layout(), savedAt: 0 })
  const bounds = preset === 'custom' ? custom : (presetBounds(preset) || custom)
  const pickPreset = (id) => { setPreset(id); const p = PV_PRESETS.find(([k]) => k === id); if (p && p[2]) setBy(p[2]) }
  // The shareable link: everything about this view lives in the URL.
  useEffect(() => { writeNavUrl({ v: 'monthly', s: 'trend', c: clientId, pp: preset, pf: preset === 'custom' ? custom.from : null, pt: preset === 'custom' ? custom.to : null, pb: by, pm: ids.join(','), pch: chart.join(','), pl: labels.length ? labels.join(',') : null, pd: showDelta ? null : '0', ptot: showTotal ? null : '0', pavg: showAvg ? '1' : null, pe: ents.length ? ents.join(',') : null, pem: entM.meta.join(',') === ENT_DEFAULT.meta.join(',') ? null : entM.meta.join(','), peg: entM.google.join(',') === ENT_DEFAULT.google.join(',') ? null : entM.google.join(',') }, false) }, [clientId, preset, custom.from, custom.to, by, ids, chart, labels, showDelta, showTotal, showAvg, ents, entM])

  const [st, setSt] = useState({ status: 'idle' })
  const [prog, setProg] = useState(null) // { done, total, note }
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!client || !bounds.from || !bounds.to) return
    let alive = true; setSt({ status: 'loading' }); setProg({ done: 0, total: 1, note: 'Reading the CRM…' })
    const base = `/.netlify/functions/windsor?scope=pivot&client=${encodeURIComponent(client.id)}&by=${by}`
    // One part, retried until its sources answered (or we give up after five
    // goes): a refresh nonce on the retry so a half-built answer is not replayed.
    // One part, retried (twelve goes, pauses growing to eight seconds) until its
    // sources answered. A refresh nonce on each retry so a half-built answer is
    // never replayed; a part that landed is cached server-side, so the next
    // open reads it back at once.
    const part = async (qs, okOf, label) => {
      let last = null
      for (let i = 0; i < 12; i++) {
        if (!alive) return null
        if (i) { setProg((p) => ({ ...(p || {}), note: `${label} · retry ${i}` })); await new Promise((r) => setTimeout(r, Math.min(8000, 1200 * i))) }
        try { const j = await apiJson(`${base}&${qs}${(i || nonce) ? `&_r=${nonce}${i}` : ''}`, { timeoutMs: 28000, tries: 1 }); last = j; if (j && j.buckets && okOf(j)) return { ...j, _ok: true } } catch (e) { last = { error: String(e.message || e) } }
      }
      return last
    }
    ;(async () => {
      // The skeleton: every bucket for the range, the stage positions, which
      // sources the client has, and wins by close date (one read of the won
      // snapshot). Then the CRM and the ad platforms a month at a time, three
      // parts in flight. Nothing is shown until every part is in - a table with
      // zeros where a month has not answered would read as real figures.
      const skel = await part(`src=closed&from=${bounds.from}&to=${bounds.to}`, (j) => j.crmOk !== false || !j.hasCrm, 'CRM wins')
      if (!alive) return
      if (!skel || !skel._ok) { setSt({ status: 'err', error: (skel && (skel.error || skel.crmErr)) || 'The CRM did not answer after twelve tries.' }); return }
      const data = { ...skel }
      const months = monthChunks(bounds.from, bounds.to)
      const tasks = []
      if (skel.hasCrm) for (const c of months) tasks.push({ kind: 'crm', c })
      if (skel.hasMeta || skel.hasGoogle) for (const c of months) tasks.push({ kind: 'ads', c })
      let done = 0
      setProg({ done: 1, total: tasks.length + 1, note: tasks.length ? 'Reading the CRM, Meta and Google month by month…' : '' })
      const failed = []
      const queue = tasks.slice()
      const worker = async () => {
        while (queue.length && alive) {
          const t = queue.shift()
          const lbl = new Date(t.c.from + 'T12:00:00').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
          const j = t.kind === 'crm'
            ? await part(`src=crm&from=${t.c.from}&to=${t.c.to}`, (jj) => jj.crmOk !== false, `CRM · ${lbl}`)
            : await part(`src=ads&from=${t.c.from}&to=${t.c.to}`, (jj) => jj.metaOk !== false && jj.googleOk !== false, `Meta and Google · ${lbl}`)
          if (!alive) return
          if (j && j._ok) { mergeBuckets(data.buckets, j.buckets); if (j.resultType) data.resultType = j.resultType }
          else failed.push(`${t.kind === 'crm' ? 'CRM' : 'Meta and Google'} ${lbl}${j && (j.error || j.crmErr) ? ` (${j.error || j.crmErr})` : ''}`)
          done++; setProg({ done: done + 1, total: tasks.length + 1, note: `${t.kind === 'crm' ? 'CRM' : 'Meta and Google'} · ${lbl} · ${done} of ${tasks.length} parts` })
        }
      }
      await Promise.all([worker(), worker(), worker()])
      if (!alive) return
      if (failed.length) { setSt({ status: 'err', error: `Not every part came through, so the report is held back rather than shown with gaps: ${failed.join('; ')}. The parts that did land are kept - press Refresh to fetch the rest.` }); setProg(null); return }
      setSt({ status: 'ok', data }); setProg(null)
    })()
    return () => { alive = false }
  }, [clientId, bounds.from, bounds.to, by, nonce])
  // Entity rows load after the report, only when a breakdown is on, a month at
  // a time with the same retries; the result is keyed by the range so a change
  // of period or grouping reads again.
  const entKey = `${clientId}|${bounds.from}|${bounds.to}|${by}|${nonce}`
  const wantEnts = ents.length > 0 && st.status === 'ok'
  useEffect(() => {
    if (!wantEnts || entSt.key === entKey) return
    let alive = true
    setEntSt({ status: 'loading', by: {}, key: entKey, done: 0, total: 0 })
    const base = `/.netlify/functions/windsor?scope=pivot&client=${encodeURIComponent(clientId)}&by=${by}&src=ents`
    const months = monthChunks(bounds.from, bounds.to)
    const byB = {}
    let done = 0, failed = 0
    setEntSt((e) => ({ ...e, total: months.length }))
    const queue = months.slice()
    const worker = async () => {
      while (queue.length && alive) {
        const c = queue.shift()
        let j = null
        for (let i = 0; i < 12 && alive; i++) {
          if (i) await new Promise((r) => setTimeout(r, Math.min(8000, 1200 * i)))
          try { j = await apiJson(`${base}&from=${c.from}&to=${c.to}${(i || nonce) ? `&_r=${nonce}${i}` : ''}`, { timeoutMs: 28000, tries: 1 }); if (j && j.buckets && j.metaOk !== false && j.googleOk !== false) break; j = null } catch { j = null }
        }
        if (!alive) return
        if (!j) failed++
        else for (const b of j.buckets) { if (!b.ents) continue; const slot = byB[b.key] = byB[b.key] || {}; for (const kind in b.ents) { const m = slot[kind] = slot[kind] || new Map(); const K = (ENT_KINDS.find((x) => x.id === kind) || {}).key || ((e) => e.name); for (const e of b.ents[kind]) m.set(K(e), addEnt(m.get(K(e)), e)) } }
        done++; setEntSt((e) => ({ ...e, done }))
      }
    }
    Promise.all([worker(), worker(), worker()]).then(() => { if (alive) setEntSt({ status: failed ? 'err' : 'ok', by: byB, key: entKey, failed }) })
    return () => { alive = false }
  }, [wantEnts, entKey])
  // Entities ranked by spend over the range; the top ten by default.
  const entList = (kind) => {
    const K = ENT_KINDS.find((x) => x.id === kind); if (!K) return []
    const tot = new Map()
    for (const r of rows) { const m = entSt.by[r.key] && entSt.by[r.key][kind]; if (!m) continue; for (const [k, e] of m) tot.set(k, addEnt(tot.get(k), e)) }
    const all = [...tot.entries()].map(([k, e]) => ({ k, e })).sort((a, b) => ((b.e.spend + b.e.cost) - (a.e.spend + a.e.cost)))
    return { all, shown: entAll[kind] ? all : all.slice(0, ENT_TOP) }
  }
  const entCell = (kind, k, r) => { const m = entSt.by[r.key] && entSt.by[r.key][kind]; return m ? m.get(k) || null : null }
  const data = st.status === 'ok' ? st.data : null
  const ctx = { resultType: data ? data.resultType : 'Results' }

  // Key events for this client, resolved per bucket from the stages reached.
  const keDefs = useMemo(() => keyEventsForPipe(loadKeyEvents(clientId), 'all'), [clientId, SETTINGS.loaded])
  const stagePosMap = useMemo(() => new Map(Object.entries((data && data.stagePos) || {})), [data])
  // Key events are resolved once per lead-source segment (all, paid = Meta +
  // Google merged, Meta, Google, non-paid) from the stages reached by that
  // segment's leads, the same way the Daily Performance tile does it.
  const merge = (...maps) => { const o = {}; for (const m of maps) for (const k in (m || {})) o[k] = (o[k] || 0) + m[k]; return o }
  const rows = useMemo(() => {
    if (!data) return []
    return data.buckets.map((b) => {
      const c = b.crm
      const keBySrc = {}
      if (c) {
        const R = c.reach || {}
        const seg = { all: [R.all, c.leads.all, c.won.all], paid: [merge(R.meta, R.google), c.leads.meta + c.leads.google, c.won.meta + c.won.google], meta: [R.meta, c.leads.meta, c.won.meta], google: [R.google, c.leads.google, c.won.google], other: [R.other, c.leads.other, c.won.other] }
        for (const src in seg) { const [reach, leads, won] = seg[src]; keBySrc[src] = keyEventRows(keDefs, { m: new Map(Object.entries(reach || {})), total: leads }, new Map(), stagePosMap, won).filter((r) => r.kind !== 'lead') }
      }
      return { key: b.key, label: b.label, from: b.from, to: b.to, base: baseOf(b, keBySrc) }
    })
  }, [data, keDefs, stagePosMap])
  const keLabels = useMemo(() => { const s = new Set(); for (const r of rows) for (const k in r.base) if (k.startsWith('ke:')) s.add(k.slice(3).replace(/:[a-z]+$/, '')); return [...s] }, [rows])
  // Key-event metrics are added to the registry per client: for each event and
  // each source, a count and a cost (spend of that source ÷ count; non-paid has
  // no spend, so no cost).
  const metrics = useMemo(() => {
    const spendOf = (b, src) => (src === 'meta' ? b.m_spend : src === 'google' ? b.g_cost : src === 'other' ? null : b.m_spend + b.g_cost)
    const ke = keLabels.flatMap((l) => PV_SRC.flatMap(([src]) => [
      { id: `ke:${l}:${src}`, g: 'Key events', label: l, src, kind: 'count', good: 'up', calc: (b) => b[`ke:${l}:${src}`] || 0, need: 'crm' },
      ...(src === 'other' ? [] : [{ id: `kec:${l}:${src}`, g: 'Key events', label: `Cost / ${l}`, src, kind: 'money', good: 'down', calc: (b) => { const sp = spendOf(b, src); return sp == null ? null : div(sp, b[`ke:${l}:${src}`] || 0) }, need: 'crmads' }]),
    ]))
    return [...PV_METRICS, ...ke]
  }, [keLabels])
  const byId = useMemo(() => Object.fromEntries(metrics.map((m) => [m.id, m])), [metrics])
  const has = { meta: !!(data && data.hasMeta), google: !!(data && data.hasGoogle), crm: !!(data && data.hasCrm) }
  const cashOn = has.crm && (loadCashOn(clientId) || rows.some((r) => r.base.c_cash > 0 || r.base.c_cash_closed > 0))
  const applies = (m) => (m.month && by !== 'month') ? false : (m.need === 'meta' ? has.meta : m.need === 'google' ? has.google : m.need === 'ads' ? (has.meta || has.google) : m.need === 'crm' ? has.crm : m.need === 'cash' ? cashOn : m.need === 'crmads' ? has.crm && (has.meta || has.google) : true)
  const selected = ids.map((id) => byId[id]).filter((m) => m && applies(m))
  const total = useMemo(() => rows.reduce((a, r) => addBase(a, r.base), {}), [rows])
  const avgOf = (m) => {
    if (!rows.length) return null
    if (m.kind === 'count' || m.kind === 'money' && !/cost|cpm|cpc|avgdeal/i.test(m.id)) { const t = m.calc(total); return t == null ? null : t / rows.length }
    const vs = rows.map((r) => m.calc(r.base)).filter((v) => v != null && isFinite(v))
    return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : null
  }
  // A newly ticked metric joins the end of its own group (Meta, Google, Blended,
  // CRM, Key events) rather than the bottom of the table, so the sections stay
  // together; the handles still let you move it anywhere afterwards.
  const toggle = (id) => setIds((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id)
    const g = (byId[id] || {}).g, gi = GROUP_ORDER.indexOf(g)
    let at = -1
    for (let i = 0; i < s.length; i++) { const mg = (byId[s[i]] || {}).g; if (GROUP_ORDER.indexOf(mg) <= gi) at = i }
    const n = s.slice(); n.splice(at + 1, 0, id); return n
  })
  const toggleChart = (id) => setChart((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]))
  // Drag a row's chip to reorder the table.
  const dragFrom = useRef(null)
  const reorder = (from, to) => { if (from == null || to == null || from === to) return; setIds((s) => { const n = s.slice(); const [x] = n.splice(from, 1); n.splice(to, 0, x); return n }) }
  const move = (i, dir) => reorder(i, Math.max(0, Math.min(ids.length - 1, i + dir)))

  // Saved views live in the shared settings blob (Settings section "pivot").
  const views = (SETTINGS.pivot && SETTINGS.pivot.views) || {}
  // Saved views are layouts, not client bookmarks: loading one keeps the client
  // you have open and applies its metrics, chart, period and grouping.
  const saveView = () => {
    const name = window.prompt('Name this view', `${(PV_PRESETS.find(([k]) => k === preset) || [])[1] || 'Custom'} by ${by} · ${ids.length} metrics`); if (!name) return
    const next = { ...views, [name.trim()]: layout() }
    SETTINGS.pivot = { ...(SETTINGS.pivot || {}), views: next }; saveSettingsRemote({ pivot: { views: next } }); bumpSettings()
  }
  const loadView = (name) => applyLayout(views[name])
  const deleteView = (name) => { if (!window.confirm(`Delete the saved view "${name}"?`)) return; const next = { ...views }; delete next[name]; SETTINGS.pivot = { ...(SETTINGS.pivot || {}), views: next }; saveSettingsRemote({ pivot: { views: next } }); bumpSettings() }
  const [copied, setCopied] = useState(false)
  const copyLink = () => { try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ } }
  const exportCsv = () => {
    const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
    const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100)
    const head = ['Metric', ...rows.map((r) => r.label), ...(showTotal ? ['Total'] : []), ...(showAvg ? [`Average per ${by}`] : [])]
    const lines = [head.join(','), ...selected.map((m) => [labelOf(m, ctx) + (m.src ? ` · ${srcOf(m.src)[1]}` : ''), ...rows.map((r) => r2(m.calc(r.base))), ...(showTotal ? [r2(m.calc(total))] : []), ...(showAvg ? [r2(avgOf(m))] : [])].map(esc).join(','))]
    for (const kind of ents) {
      const K = ENT_KINDS.find((x) => x.id === kind); if (!K || entSt.status !== 'ok') continue
      const L = entList(kind)
      for (const { k, e } of L.shown) for (const em of ENT_METRICS[K.plat].filter((x) => entM[K.plat].includes(x.id))) {
        const vals = rows.map((r) => { const c = entCell(kind, k, r); return c ? em.calc(c) : null })
        const have = vals.filter((v) => v != null && isFinite(v)); const totV = em.calc(e)
        lines.push([`${K.g} ${K.label.toLowerCase()} · ${e.name} · ${typeof em.label === 'function' ? em.label(e) : em.label}`, ...vals.map(r2), ...(showTotal ? [r2(totV)] : []), ...(showAvg ? [r2(em.kind === 'count' || (em.kind === 'money' && em.good === 'neu') ? (totV == null ? null : totV / rows.length) : (have.length ? have.reduce((a, v) => a + v, 0) / have.length : null))] : [])].map(esc).join(','))
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `trend-report-${client ? client.id : 'report'}-${bounds.from}_${bounds.to}-by-${by}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  // Chart: counts as bars on the left axis, money and rates as lines on the right.
  const chartMs = chart.map((id) => byId[id]).filter((m) => m && applies(m))
  const chartData = rows.map((r) => { const o = { label: r.label }; for (const m of chartMs) o[m.id] = m.calc(r.base); return o })
  const isBar = (m) => m.kind === 'count'
  const gTip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    return <div className="tr-gtip"><div className="tr-gtip-d">{label}</div>{payload.map((p) => { const m = byId[p.dataKey]; return m ? <div key={p.dataKey}><span className="tr-gtip-dot" style={{ background: p.color }} />{labelOf(m, ctx)}{m.src ? ` · ${srcOf(m.src)[1]}` : ''}: <b>{fmtVal(m, p.value, currency)}</b></div> : null })}</div>
  }
  const groups = GROUP_ORDER.filter((g) => metrics.some((m) => m.g === g && applies(m)))
  const periodLabel = `${dmy(bounds.from)} → ${dmy(bounds.to)}`
  const notes = data ? [data.closedTruncated ? 'The CRM\'s won-deal history is deeper than the snapshot holds, so the oldest "by closed date" wins may be missing.' : null].filter(Boolean) : []
  let lastGroup = null
  return (
    <div className="pv-page">
      <div className="pv-bar">
        <label className="act-sel">Client<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="act-sel">Period<select value={preset} onChange={(e) => pickPreset(e.target.value)}>{PV_PRESETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        {preset === 'custom' ? <span className="pv-custom"><input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /><span className="cap">to</span><input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></span> : null}
        <div className="chan-toggle sm">{BY.map(([id, l]) => <button key={id} className={by === id ? 'on' : ''} onClick={() => setBy(id)}>{l}</button>)}</div>
        <label className="pv-check"><input type="checkbox" checked={showDelta} onChange={(e) => setShowDelta(e.target.checked)} /> vs previous period</label>
        <label className="pv-check" title="A Total column: sums for counts and money, ratios re-derived from the summed inputs"><input type="checkbox" checked={showTotal} onChange={(e) => setShowTotal(e.target.checked)} /> Total</label>
        <label className="pv-check" title="An Average column: counts and money per period; a rate or cost is the mean of the periods that have one"><input type="checkbox" checked={showAvg} onChange={(e) => setShowAvg(e.target.checked)} /> Average</label>
        <span className="spacer" />
        <button className="mr-btn" onClick={() => setPickOpen((v) => !v)}>{pickOpen ? 'Done' : `Metrics · ${selected.length}`}</button>
        <button className={`mr-btn${isDefault ? ' on' : ''}`} onClick={saveDefault} title={`Open ${client ? client.name : 'this client'} on this set of metrics, chart, period and grouping from now on`}>{defSaved ? '✓ Saved' : isDefault ? '✓ Client default' : 'Save as client default'}</button>
        {defaults[clientId] && !isDefault ? <button className="btn-ghost sm" onClick={() => applyLayout(defaults[clientId])} title="Back to this client's saved default">Use default</button> : null}
        {defaults[clientId] ? <button className="btn-ghost sm" onClick={clearDefault} title="Remove this client's saved default">✕</button> : null}
        <button className="mr-btn" onClick={exportCsv} disabled={!rows.length}>↓ CSV</button>
        <button className="mr-btn" onClick={copyLink} title="Copies a link to this exact set-up. It opens for agency users only - a client who follows it lands on their own dashboard.">{copied ? '✓ Copied' : '🔗 Copy link'}</button>
        <button className="refresh-btn" title="Refresh live data" onClick={() => setNonce(Date.now())}><span className={st.status === 'loading' ? 'spin sm' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh</button>
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
          <div className="set-head"><div className="set-head-t"><h3>Metrics<InfoTip>Tick what to show. Drag a row's handle in the table (or use the arrows) to change the order. The chart icon on a row puts it on the graph - up to four at once; counts draw as bars, money and rates as lines. <b>Save as client default</b> makes this set-up what the client opens on; a <b>saved view</b> is a layout you can apply to any client.</InfoTip></h3></div>
            <div className="set-head-a"><button className="btn-ghost sm" onClick={() => setIds(DEFAULT_IDS)}>Reset to default</button><button className="btn-ghost sm" onClick={() => setIds(metrics.filter(applies).map((m) => m.id))}>Select all</button><button className="btn-ghost sm" onClick={() => setIds([])}>Clear</button></div></div>
          <div className="pv-pick-grid">
            {groups.filter((g) => g !== 'Key events').map((g) => (
              <div key={g} className="pv-pick-col">
                <div className="set-sec-t">{g}</div>
                {metrics.filter((m) => m.g === g && applies(m)).map((m) => (
                  <label key={m.id} className={`pv-pick-row${ids.includes(m.id) ? ' on' : ''}`} title={m.hint || undefined}><input type="checkbox" checked={ids.includes(m.id)} onChange={() => toggle(m.id)} /><span>{labelOf(m, ctx)}<SrcTag src={m.src} />{m.hint ? <small className="pv-hint"> · {m.hint}</small> : null}</span></label>
                ))}
                {(g === 'Meta' || g === 'Google') && (
                  <div className="pv-ent-pick">
                    <div className="set-sec-t">Break down by<InfoTip>Adds one block per {g} entity under the {g} section: the top ten by spend over the range, with a switch for all of them. Each entity shows the figures ticked here, period by period.{g === 'Meta' ? ' Creatives are offered on month grouping and longer.' : ''}</InfoTip></div>
                    {ENT_KINDS.filter((K) => K.g === g && !(K.monthOnly && (by === 'day' || by === 'week'))).map((K) => (
                      <label key={K.id} className={`pv-pick-row${ents.includes(K.id) ? ' on' : ''}`}><input type="checkbox" checked={ents.includes(K.id)} onChange={() => toggleEnt(K.id)} /><span>{K.label}</span></label>
                    ))}
                    {ents.some((k) => (ENT_KINDS.find((x) => x.id === k) || {}).g === g) ? (
                      <div className="pv-ent-metrics">{ENT_METRICS[g === 'Meta' ? 'meta' : 'google'].map((em) => <label key={em.id} className={`pv-ke-box${entM[g === 'Meta' ? 'meta' : 'google'].includes(em.id) ? ' on' : ''}`} title={typeof em.label === 'function' ? em.label(ctx) : em.label}><input type="checkbox" checked={entM[g === 'Meta' ? 'meta' : 'google'].includes(em.id)} onChange={() => toggleEntM(g === 'Meta' ? 'meta' : 'google', em.id)} />{typeof em.label === 'function' ? em.label({ resultType: 'Results' }) : em.label}</label>)}</div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          {keLabels.length && has.crm ? (
            <div className="pv-ke pv-pick-col">
              <div className="set-sec-t">Key events <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· by lead source · # = count, $ = cost per event</span></div>
              <div className="pv-wrap"><table className="mini-tbl pv-ke-tbl">
                <thead><tr><th className="lft">Key event</th>{PV_SRC.map(([src]) => <th key={src}><SrcTag src={src} /></th>)}</tr></thead>
                <tbody>{keLabels.map((l) => (
                  <tr key={l}><td className="lft">{l}</td>{PV_SRC.map(([src]) => {
                    const cid = `ke:${l}:${src}`, kid = `kec:${l}:${src}`
                    return <td key={src}><label className={`pv-ke-box${ids.includes(cid) ? ' on' : ''}`} title={`${l} · ${srcOf(src)[1]} · count`}><input type="checkbox" checked={ids.includes(cid)} onChange={() => toggle(cid)} />#</label>{src === 'other' ? null : <label className={`pv-ke-box${ids.includes(kid) ? ' on' : ''}`} title={`Cost / ${l} · ${srcOf(src)[1]}`}><input type="checkbox" checked={ids.includes(kid)} onChange={() => toggle(kid)} />$</label>}</td>
                  })}</tr>
                ))}</tbody>
              </table></div>
            </div>
          ) : null}
          </div>
        </div>
      )}
      {st.status === 'loading' ? (
        <div className="card pv-loading">
          <Spinner big label={`Building ${client ? client.name : ''} · ${periodLabel} · by ${by}`} />
          {prog ? <><div className="pv-prog"><span style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div><p className="cap">{prog.note}{prog.total > 1 ? ` · ${prog.done} of ${prog.total} parts` : ''}. A long range is read a month at a time and each part is kept, so the next open is quick.</p></> : null}
        </div>
      )
        : st.status === 'err' ? <div className="card"><p className="cap act-bad" style={{ margin: 0 }}>Couldn't build the report: {st.error}</p><p style={{ margin: '10px 0 0' }}><button className="refresh-btn" onClick={() => setNonce(Date.now())}>⟳ Try again</button></p></div>
          : !data ? null : (
            <>
              {notes.length ? <div className="card pv-note">{notes.map((n, i) => <p key={i} className="cap act-bad" style={{ margin: 0 }}>{n}</p>)}</div> : null}
              {chartMs.length ? (
                <div className="card pv-chart-card">
                  <div className="set-head"><div className="set-head-t"><h3>{client ? client.name : ''} <span className="pv-sub">· {periodLabel} · by {by}</span><InfoTip>Click a series to show its value on every point; the ✕ takes it off the graph. Add a series from the chart icon on any row of the table below, up to four.</InfoTip></h3></div>
                    <div className="set-head-a pv-legend-pick">{chartMs.map((m, i) => <button key={m.id} className={`pv-chip on${labels.includes(m.id) ? ' lbl' : ''}`} style={{ '--c': PALETTE[i % PALETTE.length] }} onClick={() => toggleLabel(m.id)} title={labels.includes(m.id) ? 'Hide the value labels on this series' : 'Show the value on every point of this series'}><i />{labelOf(m, ctx)}{m.src ? ` · ${srcOf(m.src)[1]}` : ''}{labels.includes(m.id) ? <em>labels on</em> : null}<span className="pv-chip-x" title="Remove from the graph" onClick={(e) => { e.stopPropagation(); toggleChart(m.id) }}>✕</span></button>)}</div></div>
                  <div className="pv-chart" ref={chartRef}>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={chartData} margin={{ left: -4, right: 8, top: labels.length ? 18 : 8 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" minTickGap={16} />
                        <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} tickFormatter={(v) => fmtCompact(v)} hide={!chartMs.some(isBar)} />
                        {/* Bars share the left axis; each line has its own scale (only the
                            first is drawn) so a $50 cost per lead is not flattened under a
                            $6,000 spend line. */}
                        {chartMs.filter((m) => !isBar(m)).map((m, i) => <YAxis key={m.id} yAxisId={m.id} orientation="right" fontSize={10} stroke={PALETTE[chartMs.indexOf(m) % PALETTE.length]} tickFormatter={(v) => (m.kind === 'money' ? '$' + fmtCompact(v) : m.kind === 'pct' ? `${Math.round(v)}%` : fmtCompact(v))} hide={i > 0} />)}
                        <Tooltip content={gTip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => { const m = byId[v]; return m ? labelOf(m, ctx) + (m.src ? ` · ${srcOf(m.src)[1]}` : '') : v }} />
                        {chartMs.map((m, i) => (isBar(m)
                          ? <Bar key={m.id} yAxisId="l" dataKey={m.id} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={!labels.length}>{labels.includes(m.id) ? <LabelList dataKey={m.id} content={pvLabel(m, currency, 'var(--muted)')} /> : null}</Bar>
                          : <Line key={m.id} yAxisId={m.id} dataKey={m.id} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={rows.length <= 40} connectNulls isAnimationActive={!labels.length}>{labels.includes(m.id) ? <LabelList dataKey={m.id} content={pvLabel(m, currency, PALETTE[i % PALETTE.length])} /> : null}</Line>))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
              <div className="card pv-tbl-card">
                <div className="set-head"><div className="set-head-t"><h3>Period by period<InfoTip>Each column is one {by}. Total is the whole range (ratios re-derived from the summed inputs, not averaged); Average is per {by} for counts and money, and the mean of the periods that have one for a rate or a cost. Both are toggles in the bar above. Ad figures are ad-reported by day; CRM figures count on the lead's created date, with "by close date" wins and revenue on the day the deal closed. Green is a move in the right direction against the column before, red the wrong way, grey is spend.</InfoTip></h3><p className="set-sub">{rows.length} {by === 'day' ? 'days' : by === 'week' ? 'weeks' : by === 'month' ? 'months' : by === 'quarter' ? 'quarters' : 'years'} · {periodLabel}</p></div></div>
                {!selected.length ? <p className="cap">Pick some metrics to show.</p> : (
                  <div className="pv-wrap">
                    <table className="mini-tbl pv-tbl">
                      <thead><tr><th className="lft pv-first">Metric</th>{rows.map((r) => <th key={r.key} title={`${dmy(r.from)} → ${dmy(r.to)}`}>{r.label}</th>)}{showTotal ? <th className="pv-total">Total</th> : null}{showAvg ? <th className="pv-total pv-avg">Avg / {by}</th> : null}</tr></thead>
                      <tbody>
                        {selected.map((m, i) => {
                          const head = m.g !== lastGroup ? <tr key={'g:' + m.g} className="pv-grp"><td colSpan={rows.length + 1 + (showTotal ? 1 : 0) + (showAvg ? 1 : 0)}><span>{m.g}</span></td></tr> : null
                          lastGroup = m.g
                          const onChart = chart.includes(m.id)
                          return (
                            <React.Fragment key={m.id}>
                              {head}
                              <tr draggable onDragStart={() => { dragFrom.current = ids.indexOf(m.id) }} onDragOver={(e) => e.preventDefault()} onDrop={() => { reorder(dragFrom.current, ids.indexOf(m.id)); dragFrom.current = null }}>
                                <td className="lft pv-first">
                                  <span className="pv-handle" title="Drag to reorder">⋮⋮</span>
                                  <span className="pv-lab">{labelOf(m, ctx)}<SrcTag src={m.src} /></span>
                                  <span className="pv-row-tools">
                                    <button className={`pv-ico${onChart ? ' on' : ''}`} title={onChart ? 'Remove from the graph' : 'Add to the graph'} onClick={() => toggleChart(m.id)}>📈</button>
                                    <button className="pv-ico" title="Move up" onClick={() => move(ids.indexOf(m.id), -1)}>↑</button>
                                    <button className="pv-ico" title="Move down" onClick={() => move(ids.indexOf(m.id), 1)}>↓</button>
                                    <button className="pv-ico" title="Remove" onClick={() => toggle(m.id)}>✕</button>
                                  </span>
                                </td>
                                {rows.map((r, j) => { const v = m.calc(r.base); const p = j > 0 ? m.calc(rows[j - 1].base) : null; return <td key={r.key}><span className="tr-cell">{fmtVal(m, v, currency)}{showDelta && j > 0 ? <Dlt cur={v} prev={p} good={m.good} pts={m.kind === 'pct'} dp={m.kind === 'pct' ? 1 : 0} /> : null}</span></td> })}
                                {showTotal ? <td className="pv-total">{fmtVal(m, m.calc(total), currency)}</td> : null}
                                {showAvg ? <td className="pv-total pv-avg">{fmtVal(m, avgOf(m), currency)}</td> : null}
                              </tr>
                            </React.Fragment>
                          )
                        })}
                        {ents.map((kind) => {
                          const K = ENT_KINDS.find((x) => x.id === kind); if (!K || !((K.plat === 'meta' && has.meta) || (K.plat === 'google' && has.google))) return null
                          const span = rows.length + 1 + (showTotal ? 1 : 0) + (showAvg ? 1 : 0)
                          const ems = ENT_METRICS[K.plat].filter((em) => entM[K.plat].includes(em.id))
                          const L = entSt.status === 'ok' || entSt.status === 'err' ? entList(kind) : null
                          return (
                            <React.Fragment key={'ent:' + kind}>
                              <tr className="pv-grp pv-ent-grp"><td colSpan={span}><span>{K.g} · {K.label}{L ? <> · {entAll[kind] ? `all ${L.all.length}` : `top ${Math.min(ENT_TOP, L.all.length)} of ${L.all.length} by spend`}{L.all.length > ENT_TOP ? <button className="pv-ico" onClick={() => setEntAll((a) => ({ ...a, [kind]: !a[kind] }))}>{entAll[kind] ? 'Top 10 only' : 'Show all'}</button> : null}</> : null}</span></td></tr>
                              {entSt.status === 'loading' ? <tr><td colSpan={span} className="lft pv-first"><span className="cap">Reading {K.label.toLowerCase()} · {entSt.done || 0} of {entSt.total || '…'} months…</span></td></tr> : null}
                              {entSt.status === 'err' && L && !L.all.length ? <tr><td colSpan={span} className="lft pv-first"><span className="cap act-bad">Some months did not answer. Refresh to try again.</span></td></tr> : null}
                              {L && L.shown.map(({ k, e }) => (
                                <React.Fragment key={kind + ':' + k}>
                                  <tr className="pv-ent-head"><td className="lft pv-first" colSpan={span}>
                                    {kind === 'mad' ? <span className="pv-cre">{e.thumb ? <img className="cre-th" src={e.thumb} alt="" loading="lazy" onMouseEnter={(ev) => setHover({ src: e.thumb, x: ev.clientX, y: ev.clientY })} onMouseMove={(ev) => setHover((h) => (h ? { ...h, x: ev.clientX, y: ev.clientY } : h))} onMouseLeave={() => setHover(null)} onError={(ev) => { ev.target.style.display = 'none' }} /> : <span className="cre-th cre-th-none" />}{(e.video || e.preview || e.igUrl) ? <button className="pv-play" title={e.video ? 'Play the video' : 'Open the ad preview'} onClick={() => setPlay(e)}>▶</button> : null}</span> : null}
                                    <span className="pv-ent-name" title={e.name}>{e.name}</span>
                                    {e.campaign || e.adset || e.type ? <small className="pv-ent-sub">{[e.type, e.campaign, e.adset].filter(Boolean).join(' · ')}</small> : null}
                                  </td></tr>
                                  {ems.map((em) => {
                                    const vals = rows.map((r) => { const c = entCell(kind, k, r); return c ? em.calc(c) : null })
                                    const totV = em.calc(e)
                                    const have = vals.filter((v) => v != null && isFinite(v))
                                    const avgV = em.kind === 'count' || (em.kind === 'money' && em.good === 'neu') ? (totV == null ? null : totV / rows.length) : (have.length ? have.reduce((a, v) => a + v, 0) / have.length : null)
                                    return (
                                      <tr key={em.id} className="pv-ent-row">
                                        <td className="lft pv-first"><span className="pv-lab pv-ent-lab">{typeof em.label === 'function' ? em.label(e) : em.label}</span></td>
                                        {rows.map((r, j) => <td key={r.key}><span className="tr-cell">{fmtVal(em, vals[j], currency)}{showDelta && j > 0 ? <Dlt cur={vals[j]} prev={vals[j - 1]} good={em.good} pts={em.kind === 'pct'} dp={em.kind === 'pct' ? 1 : 0} /> : null}</span></td>)}
                                        {showTotal ? <td className="pv-total">{fmtVal(em, totV, currency)}</td> : null}
                                        {showAvg ? <td className="pv-total pv-avg">{fmtVal(em, avgV, currency)}</td> : null}
                                      </tr>
                                    )
                                  })}
                                </React.Fragment>
                              ))}
                              {L && !L.all.length && entSt.status === 'ok' ? <tr><td colSpan={span} className="lft pv-first"><span className="cap">No {K.label.toLowerCase()} with spend in this range.</span></td></tr> : null}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {hover ? <img className="cre-preview" src={hover.src} alt="" style={{ left: Math.min(hover.x + 18, window.innerWidth - 268), top: Math.min(Math.max(12, hover.y - 120), window.innerHeight - 300) }} /> : null}
              {play ? (
                <div className="modal-bg" onClick={() => setPlay(null)}>
                  <div className="modal pv-play-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="m-head"><div><h3>{play.name}</h3><span className="cap">{[play.type, play.campaign, play.adset].filter(Boolean).join(' · ')}</span></div><button className="icon-btn" onClick={() => setPlay(null)}>✕</button></div>
                    <div className="m-body pv-play-body">
                      {play.video ? <video className="pv-video" src={play.video} poster={play.thumb || undefined} controls autoPlay playsInline /> : play.thumb ? <img className="pv-video" src={play.thumb} alt="" /> : null}
                      <div className="pv-play-links">{play.preview ? <a className="btn-ghost sm" href={play.preview} target="_blank" rel="noreferrer">Open the ad preview ↗</a> : null}{play.igUrl ? <a className="btn-ghost sm" href={play.igUrl} target="_blank" rel="noreferrer">Open on Instagram ↗</a> : null}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
    </div>
  )
}
