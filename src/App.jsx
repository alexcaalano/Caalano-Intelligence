import React, { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ComposedChart, ReferenceLine, LabelList,
} from 'recharts'
import {
  fmtCurrency, fmtNumber, fmtCompact, fmtPct, pctChange,
  clientTotals, agencyTotals,
} from './lib/format.js'

// Current release number - bump this with each release and add a matching entry
// (with the commit hash) to CHANGELOG.md so any version can be reverted to.
const APP_VERSION = '3.73.0'
// Format the injected build timestamp in Australian local time (dashboard is
// AEST/AEDT), e.g. "20 Jul 2026, 1:32 pm". Falls back gracefully if unset.
function fmtBuildTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return iso || 'unknown' }
}
const AVATAR = ['#6d5efc', '#12b886', '#4f7cff', '#f5a524', '#ec4899', '#0ea5e9', '#f0435b', '#8b5cf6']
const acolor = (i) => AVATAR[i % AVATAR.length]
const initials = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const TRACK = {
  full: { label: 'Full tracking', cls: 'tk-full' },
  wins_no_value: { label: 'Wins, no value', cls: 'tk-wins' },
  intelligence_only: { label: 'Intel only', cls: 'tk-intel' },
  no_outcome_tracking: { label: 'No tracking', cls: 'tk-none' },
}
const rate = (a, b) => (b ? (a / b) * 100 : 0)

/* Caalano360 outcome join - match an ad-platform entity to CRM outcomes by UTM. */
const unorm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const mkOutcomeMap = (arr) => { const m = new Map(); for (const e of arr || []) { const k = unorm(e.name); if (k && !m.has(k)) m.set(k, e) } return m }
// Caalano360 outcome columns (UTM-matched CRM results next to each ad row).
// Green Caalano360 columns. Trailing 'r' marks a narrow rate (%) column.
// The green Caalano360 block is a set of column GROUPS. With no key events it
// falls back to one "Caalano360" group with the legacy Booked/Shown/Won columns.
// With key events, each event becomes a banner-headed group: a calendar event
// gets Booked / Book % / Cost / Shown / Show %, a stage (or won) event gets
// Reached / Conv % / Cost. A descriptor is { grouped, groups:[{label,kind,span}],
// cols:[{key,sub,ty,metric,...ctx}] }. `metric` drives the numbers, `ty` the cell
// format + width. Calendar cols carry `refs` (calendar ids), `stage` (linked
// stage fallback) and `names` (id->name for the hover breakdown).
// A key event whose name reads like the closed-won step counts on the won
// STATUS (and its revenue), not the pipeline stage reached.
const WON_RE = /won|sold|closed.?win/i
const LEGACY_DESC = {
  grouped: false,
  groups: [{ label: 'Caalano360', kind: 'brand', span: 11 }],
  cols: [
    { key: 'booked', sub: 'Booked', ty: 'count', metric: 'cnt', src: 'booked', mk: 'canc', gfirst: true },
    { key: 'cBook', sub: 'C/Book', ty: 'cost', metric: 'cost', src: 'booked', noun: 'booked' },
    { key: 'shown', sub: 'Shown', ty: 'count', metric: 'cnt', src: 'shown', mk: 'infer' },
    { key: 'cShow', sub: 'C/Show', ty: 'cost', metric: 'cost', src: 'shown', noun: 'shown' },
    { key: 'won', sub: 'Won', ty: 'count', metric: 'cnt', src: 'won' },
    { key: 'cWon', sub: 'C/Won', ty: 'cost', metric: 'cost', src: 'won', noun: 'won' },
    { key: 'wonVal', sub: 'Won val', ty: 'money', metric: 'money', src: 'revenue' },
    { key: 'roas', sub: 'ROAS', ty: 'roas', metric: 'roas' },
    { key: 'bookRate', sub: 'Book %', ty: 'rate', metric: 'rate', num: 'booked', den: 'leads', title: 'Booked ÷ leads' },
    { key: 'showRate', sub: 'Show %', ty: 'rate', metric: 'rate', num: 'shown', den: 'booked', title: 'Shown ÷ booked' },
    { key: 'winRate', sub: 'Win %', ty: 'rate', metric: 'rate', num: 'won', den: 'leads', title: 'Won ÷ leads' },
  ],
}
function buildO360Cols(keyEvents, stagePos, calNames) {
  const ke = resolveKeyEvents(keyEvents, stagePos)
  if (!ke.length) return LEGACY_DESC
  const groups = [], cols = []
  ke.forEach((k, i) => {
    if (k.kind === 'calendar') {
      groups.push({ label: '📅 ' + k.label, kind: 'calendar', span: 5 })
      const ctx = { g: i, refs: k.refs || [k.ref], stage: k.stage, pipeline: k.pipeline, names: calNames, event: k.label }
      cols.push({ key: `e${i}b`, sub: 'Booked', ty: 'count', metric: 'calBooked', gfirst: true, title: `Bookings for ${k.label}`, ...ctx })
      cols.push({ key: `e${i}br`, sub: 'Book Rate', ty: 'rate', metric: 'calBookRate', title: 'Booked ÷ leads', ...ctx })
      cols.push({ key: `e${i}cb`, sub: 'Cost / Booked', ty: 'cost', metric: 'calCost', title: `Spend ÷ ${k.label} bookings`, ...ctx })
      cols.push({ key: `e${i}s`, sub: 'Shown', ty: 'count', metric: 'calShown', title: `Showed for ${k.label}`, ...ctx })
      cols.push({ key: `e${i}sr`, sub: 'Show Rate', ty: 'rate', metric: 'calShowRate', title: 'Shown ÷ booked', ...ctx })
    } else if (WON_RE.test(k.label)) {
      // Won event: revenue-truth group from the won opportunity STATUS/value
      // (not the pipeline stage) - Won, Win Rate, Cost/Won, Won Val, Avg Deal, ROAS.
      groups.push({ label: k.label, kind: 'won', span: 6 })
      const ctx = { g: i, ref: k.ref, event: k.label }
      cols.push({ key: `e${i}w`, sub: 'Won', ty: 'count', metric: 'wonCount', gfirst: true, title: `Deals won${''}`, ...ctx })
      cols.push({ key: `e${i}wr`, sub: 'Win Rate', ty: 'rate', metric: 'wonRate', title: 'Won ÷ leads', ...ctx })
      cols.push({ key: `e${i}wc`, sub: 'Cost / Won', ty: 'cost', metric: 'wonCost', title: 'Spend ÷ won', ...ctx })
      cols.push({ key: `e${i}wv`, sub: 'Won Val', ty: 'money', metric: 'wonVal', title: 'Revenue from won deals', ...ctx })
      cols.push({ key: `e${i}wa`, sub: 'Avg Deal', ty: 'money', metric: 'wonAvg', title: 'Revenue ÷ won deals', ...ctx })
      cols.push({ key: `e${i}wro`, sub: 'ROAS', ty: 'roas', metric: 'roas', title: 'Revenue ÷ spend', ...ctx })
    } else {
      groups.push({ label: k.label, kind: 'stage', span: 3 })
      const ctx = { g: i, ref: k.ref, pipeline: k.pipeline, event: k.label }
      cols.push({ key: `e${i}r`, sub: 'Reached', ty: 'count', metric: 'stageReached', gfirst: true, title: `Reached ${k.label}`, ...ctx })
      cols.push({ key: `e${i}rr`, sub: 'Conv %', ty: 'rate', metric: 'stageRate', title: `Reached ÷ leads`, ...ctx })
      cols.push({ key: `e${i}c`, sub: 'Cost / Reach', ty: 'cost', metric: 'stageCost', title: `Spend ÷ ${k.label}`, ...ctx })
    }
  })
  return { grouped: true, groups, cols }
}
// Flatten an outcome `o` into numeric fields (for sorting) keyed by column key,
// plus breakdown objects at `<key>B` (per-calendar counts + stage fallback) for
// the hover tooltip. Calendar metrics share one aggregate per group.
function o360Fields(o, spend, leads, desc) {
  const D = desc || LEGACY_DESC; const C = D.cols
  if (!o) { const f = { _has360: false }; for (const c of C) f[c.key] = null; return f }
  const L = leads || 0
  const f = { _has360: true, booked: o.booked || 0, cancelled: o.cancelled || 0, shown: o.shown || 0, shownStage: o.shownStage || 0, won: o.won || 0, revenue: o.revenue || 0 }
  const agg = {}
  const calSum = (refs, mapName) => { let t = 0; const per = {}; const m = o[mapName]; if (m) for (const r of refs) { const n = m[r] || 0; if (n) { t += n; per[r] = n } } return { t, per } }
  // Stage reach honouring the linked pipeline (pipelineId::name first).
  const stg = (name, pipeline) => { if (!name || !o.stages) return 0; if (pipeline && o.stages[pipeline + '::' + name] != null) return o.stages[pipeline + '::' + name]; return o.stages[name] || 0 }
  for (const c of C) {
    const m = c.metric
    if (m && m.slice(0, 3) === 'cal') {
      let g = agg[c.g]
      if (!g) {
        const b = calSum(c.refs, 'cals'), sh = calSum(c.refs, 'calsShown')
        const stageN = stg(c.stage, c.pipeline)
        const fromStage = Math.max(0, stageN - b.t)
        g = agg[c.g] = { booked: b.t + fromStage, fromCal: b.t, fromStage, bookedPer: b.per, shown: sh.t, shownPer: sh.per }
      }
      if (m === 'calBooked') { f[c.key] = g.booked; f[c.key + 'B'] = { per: g.bookedPer, fromStage: g.fromStage } }
      else if (m === 'calBookRate') { f[c.key] = L ? (g.booked / L) * 100 : null }
      else if (m === 'calCost') { f[c.key] = g.booked && spend ? spend / g.booked : null; f[c.key + 'N'] = g.booked }
      else if (m === 'calShown') { f[c.key] = g.shown; f[c.key + 'B'] = { per: g.shownPer } }
      else if (m === 'calShowRate') { f[c.key] = g.booked ? (g.shown / g.booked) * 100 : null }
    } else if (m === 'stageReached') { f[c.key] = stg(c.ref, c.pipeline) }
    else if (m === 'stageRate') { const n = stg(c.ref, c.pipeline); f[c.key] = L ? (n / L) * 100 : null }
    else if (m === 'stageCost') { const n = stg(c.ref, c.pipeline); f[c.key] = n && spend ? spend / n : null; f[c.key + 'N'] = n }
    else if (m === 'wonCount') { f[c.key] = o.won || 0; f[c.key + 'B'] = { noVal: o.wonNoVal || null } }
    else if (m === 'wonRate') { f[c.key] = L ? ((o.won || 0) / L) * 100 : null }
    else if (m === 'wonCost') { const n = o.won || 0; f[c.key] = n && spend ? spend / n : null; f[c.key + 'N'] = n }
    else if (m === 'wonVal') { f[c.key] = o.revenue || 0 }
    else if (m === 'wonAvg') { f[c.key] = o.won ? (o.revenue || 0) / o.won : null }
    else if (m === 'cnt') { f[c.key] = o[c.src] || 0 }
    else if (m === 'cost') { const n = o[c.src] || 0; f[c.key] = n && spend ? spend / n : null; f[c.key + 'N'] = n }
    else if (m === 'money') { f[c.key] = o[c.src] || 0 }
    else if (m === 'roas') { f[c.key] = spend ? (o.revenue || 0) / spend : null }
    else if (m === 'rate') { const den = c.den === 'leads' ? L : (o[c.den] || 0); f[c.key] = den ? ((o[c.num] || 0) / den) * 100 : null }
  }
  return f
}
// Banner row: one green banner per column group (event name), spanning its cols.
function C360GrpRow({ left, cols }) {
  const D = cols || LEGACY_DESC
  return <tr className="c360-grp-row"><th className="c360-grp-blank" colSpan={left} aria-hidden="true" />{D.groups.map((g, i) => <th key={i} className={`c360-grp${i > 0 ? ' c360-grp-sep' : ''}`} colSpan={g.span} title={g.label}>{g.label}</th>)}</tr>
}
function O360Head({ sort, on, cols }) {
  const D = cols || LEGACY_DESC
  return <>{D.cols.map((c, i) => {
    const cn = `c360-col${i === 0 ? ' c360-first' : ''}${c.gfirst && i > 0 ? ' c360-gfirst' : ''}`
    return sort
      ? <SortTh key={c.key} k={c.key} sort={sort} on={on} className={cn} title={c.title}>{c.sub}</SortTh>
      : <th key={c.key} className={cn} title={c.title}>{c.sub}</th>
  })}</>
}
// Fixed column widths so the Caalano360 green block lands in the same place in
// every table. The name (first) col gets an EXPLICIT width so it can't collapse
// under table-layout:fixed. nameW keeps the green block at a constant x.
const CGM = 96
function o360ColClass(c) { return c.ty === 'rate' ? 'cg-gr' : c.ty === 'count' ? 'cg-gc' : 'cg-g' }
function O360ColGroup({ left, green = true, cols }) {
  const D = cols || LEGACY_DESC
  const nameW = Math.max(150, 190 + (9 - left) * CGM)
  return (
    <colgroup>
      <col style={{ width: nameW }} />
      {Array.from({ length: Math.max(0, left - 1) }, (_, i) => <col key={i} className="cg-m" />)}
      {green && D.cols.map((c) => <col key={c.key} className={o360ColClass(c)} />)}
    </colgroup>
  )
}
// Synchronise horizontal scroll across every .table-wrap inside a view, so
// scrolling one table (e.g. to reach the Caalano360 green columns) scrolls them
// all to the same offset - and they stay column-aligned. A MutationObserver
// re-attaches as tables are added/removed (drill-ins, pagination).
function useSyncedTableScroll(ref) {
  useEffect(() => {
    const root = ref.current; if (!root) return
    let wraps = []; let syncing = false
    const onScroll = (e) => {
      if (syncing) return
      syncing = true
      const sl = e.currentTarget.scrollLeft
      for (const o of wraps) if (o !== e.currentTarget && o.scrollLeft !== sl) o.scrollLeft = sl
      requestAnimationFrame(() => { syncing = false })
    }
    const attach = () => {
      const next = [...root.querySelectorAll('.table-wrap')]
      for (const w of wraps) if (!next.includes(w)) w.removeEventListener('scroll', onScroll)
      for (const w of next) if (!wraps.includes(w)) w.addEventListener('scroll', onScroll, { passive: true })
      wraps = next
    }
    attach()
    const mo = new MutationObserver(attach)
    mo.observe(root, { childList: true, subtree: true })
    return () => { mo.disconnect(); for (const w of wraps) w.removeEventListener('scroll', onScroll) }
  }, [])
}
/* Sortable tables - click a header to sort; click again to flip direction. */
function useSort(key0, dir0 = -1) {
  const [s, setS] = useState({ key: key0, dir: dir0 })
  const on = (k) => setS((p) => (p.key === k ? { key: k, dir: -p.dir } : { key: k, dir: -1 }))
  return [s, on]
}
function sortRows(rows, s) {
  if (!s.key) return rows
  return [...rows].sort((a, b) => {
    const av = a[s.key], bv = b[s.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * s.dir
    return (av - bv) * s.dir
  })
}
function SortTh({ k, sort, on, children, className }) {
  return <th className={`sort-th${className ? ' ' + className : ''}`} onClick={() => on(k)}>{children}<span className="sort-ar">{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</span></th>
}
// Breakdown tooltip for a calendar Booked / Shown number: which calendars it
// came from (by name) plus the pipeline-stage fallback portion.
function keBreakTip(label, total, B, names) {
  const parts = []
  if (B && B.per) for (const id in B.per) parts.push(`${(names && names.get && names.get(id)) || 'Calendar'}: ${fmtNumber(B.per[id])}`)
  if (B && B.fromStage) parts.push(`Pipeline stage (fallback): ${fmtNumber(B.fromStage)}`)
  return `${label} ${fmtNumber(total || 0)}${parts.length ? ' — ' + parts.join(' · ') : ''}`
}
// Renders the green Caalano360 cells for a row, driven by the column descriptor.
function o360Cells(r, currency, cols) {
  const D = cols || LEGACY_DESC; const C = D.cols
  if (!r || !r._has360) return <>{C.map((c, i) => <td key={c.key} className={`c360-col dim${i === 0 ? ' c360-first' : ''}${c.gfirst && i > 0 ? ' c360-gfirst' : ''}`}>-</td>)}</>
  const money = (v) => fmtCurrency(v, currency)
  return <>{C.map((c, i) => {
    const cn = `c360-col${i === 0 ? ' c360-first' : ''}${c.gfirst && i > 0 ? ' c360-gfirst' : ''}`
    const v = r[c.key]; const m = c.metric
    // Calendar Booked: number + (Np) fallback marker + full hover breakdown.
    if (m === 'calBooked') {
      const B = r[c.key + 'B'] || {}
      const tip = keBreakTip('Booked', v, B, c.names)
      return <td key={c.key} className={cn} title={tip}>{fmtNumber(v || 0)}{B.fromStage ? <span className="c360-infer" title={tip}> ({fmtNumber(B.fromStage)}p)</span> : null}</td>
    }
    if (m === 'calShown') {
      const B = r[c.key + 'B'] || {}
      return <td key={c.key} className={cn} title={keBreakTip('Shown', v, B, c.names)}>{fmtNumber(v || 0)}</td>
    }
    // Won count: flag deals marked won with no value so the team can fix them.
    if (m === 'wonCount') {
      const B = r[c.key + 'B'] || {}; const nv = (B.noVal && B.noVal.length) || 0
      const tip = nv ? `${fmtNumber(v || 0)} won · ${nv} with NO deal value: ${B.noVal.slice(0, 12).join(', ')}${B.noVal.length > 12 ? '…' : ''}` : `${fmtNumber(v || 0)} won`
      return <td key={c.key} className={cn} title={tip}>{fmtNumber(v || 0)}{nv ? <span className="c360-warn" title={tip}> ({nv}⚠)</span> : null}</td>
    }
    if (m === 'stageReached') return <td key={c.key} className={cn} title={`${fmtNumber(v || 0)} reached ${c.event}`}>{fmtNumber(v || 0)}</td>
    if (c.ty === 'cost') {
      const n = r[c.key + 'N'] || 0
      const tip = n ? `${fmtNumber(n)} ${c.noun || 'events'}${c.key === 'cBook' && r.cancelled ? ` · ${r.cancelled} later cancelled` : ''}${c.key === 'cShow' && r.shownStage ? ` · ${r.shownStage} via pipeline stage` : ''}` : undefined
      return <td key={c.key} className={cn} title={tip}>{v != null ? money(v) : '-'}</td>
    }
    if (c.ty === 'money') return <td key={c.key} className={cn}>{v != null ? money(v) : '-'}</td>
    if (c.ty === 'roas') return <td key={c.key} className={cn}>{v != null ? `${v.toFixed(2)}×` : '-'}</td>
    if (c.ty === 'count') {
      if (c.key === 'booked') return <td key={c.key} className={cn}>{fmtNumber(v || 0)}{r.cancelled ? <span className="c360-canc" title={`${r.cancelled} later cancelled`}> ({r.cancelled}c)</span> : null}</td>
      if (c.key === 'shown') return <td key={c.key} className={cn}>{fmtNumber(v || 0)}{r.shownStage ? <span className="c360-infer" title={`${r.shownStage} from pipeline stage`}> ({r.shownStage}p)</span> : null}</td>
      return <td key={c.key} className={cn}>{fmtNumber(v || 0)}</td>
    }
    if (c.ty === 'rate') return <td key={c.key} className={cn} title={c.title}>{v != null ? fmtPct(v, 1) : '-'}</td>
    return <td key={c.key} className={cn}>-</td>
  })}</>
}
// Explains WHY the green Caalano360 columns are hidden when attribution didn't
// resolve, so a missing green block is never silent.
function AttrDiag({ attr }) {
  if (!attr || attr.status === 'loading') return null
  const d = attr.data
  if (d && d.attribution) return null // green is present
  let msg
  if (attr.status === 'err') msg = 'the attribution request failed (network / HTTP error). Try Refresh.'
  else if (d && d.connected === false) msg = 'Caalano Systems isn’t connected — re-authorise at /.netlify/functions/caalano-connect to restore them.'
  else if (d && d.error) msg = `attribution error — ${String(d.error).slice(0, 200)}`
  else msg = 'no attribution data was returned for this client / period.'
  return <div className="attr-diag">Caalano360 columns hidden: {msg}</div>
}
const PHASE_COLOR = { contact: '#4f7cff', 'appt-set': '#6d5efc', 'at-risk': '#f0435b', held: '#12b886', proposal: '#f5a524', onboarding: '#0ea5e9' }

function Delta({ cur, prev, goodWhenDown = false }) {
  const pct = pctChange(cur, prev); const up = pct >= 0; const good = goodWhenDown ? !up : up
  return <span className={`delta ${good ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {fmtPct(Math.abs(pct))}<span className="vs">vs prev</span></span>
}
function Kpi({ label, value, tag, cur, prev, goodWhenDown, flat }) {
  return (
    <div className="card kpi">
      <div className="top"><span className="label">{label}</span>{tag && <span className={`tag ${tag.toLowerCase()}`}>{tag}</span>}</div>
      <div className="value">{value}</div>
      {flat ? <span className="flat">{flat}</span> : (cur != null && prev != null) ? <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} /> : null}
    </div>
  )
}

/* ============ Agency live rollup ============ */
function useAgencyLive(range, nonce = 0) {
  const [state, setState] = useState({ status: 'idle', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true
    setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=agency&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: j && !j.error && j.clients ? 'ok' : 'err', data: j && j.clients ? j : null }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [q, nonce])
  return state
}

// Lazy UTM source-tag coverage per client (populates the leaderboard after render).
function useCoverage(range, nonce = 0) {
  const [cov, setCov] = useState(null)
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setCov(null)
    fetch(`/.netlify/functions/windsor?scope=coverage&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setCov(j && j.coverage ? j.coverage : {}) })
      .catch(() => { if (alive) setCov({}) })
    return () => { alive = false }
  }, [q, nonce])
  return cov
}

// Blended weekly trend for one client (Caalano360). Reuses the weekly scope so
// the completed-week bucketing / CRM outcome logic lives in one place.
function useWeeklyBlend(clientId, weeks = 13, nonce = 0) {
  const [state, setState] = useState({ status: 'loading', weeks: null })
  useEffect(() => {
    let alive = true; setState({ status: 'loading', weeks: null })
    fetch(`/.netlify/functions/windsor?scope=weekly&client=${clientId}&weeks=${weeks}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: 'ok', weeks: (j && j.weeks) || [] }) })
      .catch(() => { if (alive) setState({ status: 'error', weeks: null }) })
    return () => { alive = false }
  }, [clientId, weeks, nonce])
  return state
}

// Display rows from the roster (names) + live metrics, falling back to the baked snapshot.
function computeRows(snapClients, live) {
  return snapClients.map((c, i) => {
    const lm = live && live.clients ? live.clients[c.id] : null
    const meta = (lm && lm.meta) || (c.meta ? { spend: c.meta.spend, impressions: c.meta.impressions, clicks: c.meta.clicks, leads: c.meta.leads } : null)
    const google = (lm && lm.google) || (c.google ? { cost: c.google.cost, impressions: c.google.impressions, clicks: c.google.clicks, conversions: c.google.conversions } : null)
    const spend = (meta?.spend || 0) + (google?.cost || 0)
    const impressions = (meta?.impressions || 0) + (google?.impressions || 0)
    const clicks = (meta?.clicks || 0) + (google?.clicks || 0)
    const conversions = (meta?.leads || 0) + (google?.conversions || 0)
    const revenue = (lm && lm.crm && lm.crm.revenue) || 0
    // Current per-channel ad metrics + previous-period totals for the agency
    // comparison table's deltas and the Results channel-breakdown hover.
    const metaLeads = meta?.leads || 0, googleConv = google?.conversions || 0
    const mp = (lm && lm.metaPrev) || null, gp = (lm && lm.googlePrev) || null
    const prevMetaSpend = mp?.spend || 0, prevGoogleSpend = gp?.cost || 0
    const prevMetaLeads = mp?.leads || 0, prevGoogleConv = gp?.conversions || 0
    const prevSpend = prevMetaSpend + prevGoogleSpend, prevResults = prevMetaLeads + prevGoogleConv
    return { c, i, id: c.id, name: c.name, industry: c.industry, track: c.trackingStatus, spend, impressions, clicks, conversions, revenue, cpl: conversions ? spend / conversions : 0, ctr: impressions ? (clicks / impressions) * 100 : 0, roas: spend ? revenue / spend : 0, metaSpend: meta?.spend || 0, googleSpend: google?.cost || 0, metaLeads, googleConv, prevSpend, prevResults, prevMetaSpend, prevGoogleSpend, prevMetaLeads, prevGoogleConv, hasMeta: !!c.meta, hasGoogle: !!c.google }
  })
}

/* ============ Overview ============ */
function Overview({ rows, currency, periodLabel, live, alerts, range, nonce, onPick }) {
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]))
  const nameOf = (id) => rowById[id]?.name || id
  const AlertCol = ({ title, color, list }) => (
    <div className="card alert-col">
      <div className="alert-head"><span className="chan" style={{ background: color }}>{title}</span>{list.length ? <span className="al-count bad">{list.length} paused</span> : <span className="al-count ok">all active</span>}</div>
      {list.length ? list.map((a) => (
        <div className="alert-row" key={a.id} onClick={() => rowById[a.id] && onPick(rowById[a.id].c)}>
          <span className="al-dot" /><span className="al-name">{nameOf(a.id)}</span>
          <span className="al-meta">$0 yesterday · was ~{fmtCurrency(a.avgDaily, currency)}/day</span>
        </div>
      )) : (
        <div className="alert-row ok">
          <span className="al-dot ok" /><span className="al-name">All accounts active</span>
          <span className="al-meta">every {title} account spent yesterday</span>
        </div>
      )}
    </div>
  )
  const t = rows.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, metaSpend: a.metaSpend + r.metaSpend, googleSpend: a.googleSpend + r.googleSpend }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, metaSpend: 0, googleSpend: 0 })
  const cpl = t.conversions ? t.spend / t.conversions : 0
  const ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0
  const totalRev = rows.reduce((a, r) => a + (r.revenue || 0), 0)
  const roas = t.spend ? totalRev / t.spend : 0
  return (
    <>
      <div className="section-title">Paid performance <span className="sub">· Meta + Google · {periodLabel} · {live ? 'live' : 'snapshot fallback'}</span></div>
      <div className="grid kpis kpis-6">
        <Kpi label="Ad Spend" tag="ADS" value={fmtCurrency(t.spend, currency)} />
        <Kpi label="Leads & Conversions" tag="ADS" value={fmtNumber(t.conversions)} />
        <Kpi label="Blended Cost / Result" tag="ADS" value={fmtCurrency(cpl, currency)} />
        <Kpi label="Blended CTR" tag="ADS" value={fmtPct(ctr, 2)} />
        <Kpi label="Revenue Generated" tag="CRM" value={fmtCurrency(totalRev, currency)} />
        <Kpi label="ROAS" tag="CRM" value={totalRev && t.spend ? `${roas.toFixed(2)}×` : '-'} />
      </div>
      {alerts && (alerts.meta || alerts.google) && <>
        <div className="section-title">Account health <span className="sub">· $0 spend yesterday with an active prior week - likely paused / failed payment</span></div>
        <div className="grid alerts-2">
          {/* Only surface alerts for active clients - inactive ones are hidden everywhere. */}
          <AlertCol title="Meta" color="#4f7cff" list={(alerts.meta || []).filter((a) => rowById[a.id])} />
          <AlertCol title="Google" color="#12b886" list={(alerts.google || []).filter((a) => rowById[a.id])} />
        </div>
      </>}
      <div className="section-title">Client leaderboard <span className="sub">· results, funnel &amp; revenue per client vs the previous period · click a row to open the client</span></div>
      <AgencyComparison rows={rows} currency={currency} range={range} nonce={nonce} onPick={onPick} />
    </>
  )
}

function ClientTable({ rows, currency, coverage, onPick }) {
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const covPct = (id) => { const cv = coverage && coverage[id]; return cv && cv.opps ? (cv.attributed / cv.opps) * 100 : null }
  const sorted = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir)
  const setKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
  const Th = ({ k, children }) => <th onClick={() => setKey(k)}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <div className="table-wrap"><table>
      <thead><tr><Th k="name">Client</Th><Th k="spend">Spend</Th><Th k="conversions">Results</Th><Th k="cpl">Cost / result</Th><Th k="revenue">Revenue</Th><Th k="roas">ROAS</Th><Th k="ctr">CTR</Th><th title="% of CRM opportunities carrying a UTM source tag">Tracking</th><th>Channels</th></tr></thead>
      <tbody>{sorted.map((r) => {
        const has = r.conversions > 0
        const cp = covPct(r.id); const cvCls = cp == null ? '' : cp >= 80 ? 'good' : cp >= 50 ? 'warn' : 'bad'
        return (
          <tr key={r.id} onClick={() => onPick(r.c)}>
            <td><div className="client-cell"><span className="avatar" style={{ background: acolor(r.i) }}>{initials(r.name)}</span><div>{r.name}<small>{r.industry}</small></div></div></td>
            <td>{fmtCurrency(r.spend, currency)}</td>
            <td>{has ? fmtNumber(r.conversions) : '-'}</td>
            <td>{has ? fmtCurrency(r.cpl, currency) : '-'}</td>
            <td>{r.revenue ? fmtCurrency(r.revenue, currency) : '-'}</td>
            <td>{r.revenue && r.spend ? `${r.roas.toFixed(2)}×` : '-'}</td>
            <td>{fmtPct(r.ctr, 2)}</td>
            <td>{!r.c.ghl ? <span className="tk" style={{ opacity: .5 }}>no CRM</span> : coverage == null ? <span className="tk" style={{ opacity: .5 }}>…</span> : cp == null ? <span className="tk" style={{ opacity: .5 }}>-</span> : <span className={`tk cov ${cvCls}`} title={`${coverage[r.id].attributed} of ${coverage[r.id].opps} opportunities tagged`}>{cp.toFixed(0)}%</span>}</td>
            <td><div className="chan-tags">{r.hasMeta && <span className="chan" style={{ background: '#4f7cff' }}>Meta</span>}{r.hasGoogle && <span className="chan" style={{ background: '#12b886' }}>Google</span>}</div></td>
          </tr>
        )
      })}</tbody>
    </table></div>
  )
}

/* ============ Agency comparison table ============ */
// The client's primary booked calendar (first calendar key event, funnel order)
// + its linked pipeline stage, for the overview's Booked Calls column.
function primaryCalOf(clientId) {
  try {
    const ke = mergeCalKeyEvents(normKeyEvents(loadKeyEvents(clientId)))
    const cal = ke.find((k) => k.kind === 'calendar')
    if (!cal) return { cals: '', stage: '' }
    return { cals: (cal.refs || [cal.ref]).filter(Boolean).join(','), stage: cal.stage || '' }
  } catch { return { cals: '', stage: '' } }
}
// Lazy-fetch the GHL metrics (opps/booked/shown/won/revenue per channel, cur +
// prev) for each CRM client, one request each, so the fast Windsor columns
// render immediately and these fill in with spinners.
function useOvRows(rows, range, nonce = 0) {
  const [map, setMap] = useState({})
  const ghlIds = rows.filter((r) => r.c.ghl).map((r) => r.id)
  const depKey = ghlIds.join(',') + '|' + rangeQuery(range) + '|' + nonce
  useEffect(() => {
    let alive = true
    setMap(Object.fromEntries(ghlIds.map((id) => [id, { status: 'loading' }])))
    const one = (id, period) => {
      const pc = primaryCalOf(id)
      const q = `${rangeQuery(range)}&cal=${encodeURIComponent(pc.cals)}&stage=${encodeURIComponent(pc.stage)}&period=${period}`
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 28000)
      return fetch(`/.netlify/functions/windsor?scope=ovrow&client=${id}&${q}${nonce ? `&_r=${nonce}` : ''}`, { signal: ctl.signal })
        .then((x) => (x.ok ? x.json() : Promise.reject(new Error(`server ${x.status}`))))
        .then((j) => ({ data: j && j.data ? j.data : null, error: j && j.error ? String(j.error) : (j && j.connected === false ? 'Caalano Systems not connected' : (j && !j.data ? 'no data returned' : null)) }))
        .catch((e) => ({ data: null, error: e && e.name === 'AbortError' ? 'timed out (>28s)' : String((e && e.message) || e) }))
        .finally(() => clearTimeout(timer))
    }
    // Current-period first (fills the columns), previous after (fills deltas).
    const queue = [...ghlIds.map((id) => [id, 'cur']), ...ghlIds.map((id) => [id, 'prev'])]
    const runNext = () => {
      if (!alive) return
      const item = queue.shift(); if (!item) return
      const [id, period] = item
      one(id, period).then((res) => {
        if (!alive) return
        setMap((m) => {
          const e = { ...(m[id] || { status: 'loading' }) }
          if (period === 'cur') { e.cur = res.data; e.status = res.data ? 'ok' : 'err'; e.err = res.data ? null : res.error } else e.prev = res.data
          return { ...m, [id]: e }
        })
      }).finally(() => { if (alive) runNext() })
    }
    for (let i = 0; i < Math.min(6, queue.length); i++) runNext()
    return () => { alive = false }
  }, [depKey]) // eslint-disable-line
  return map
}
// Compact green/red % change vs the prior period.
function MiniDelta({ cur, prev, goodWhenDown = false, neutral = false }) {
  if (cur == null || prev == null) return null
  if (!prev) return cur ? <span className="mini-delta up" title="no prior-period value">▲ new</span> : null
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (!isFinite(pct)) return null
  const up = pct >= 0
  const cls = neutral ? 'flat' : (goodWhenDown ? (up ? 'down' : 'up') : (up ? 'up' : 'down'))
  return <span className={`mini-delta ${cls}`}>{up ? '▲' : '▼'} {fmtPct(Math.abs(pct), 0)}</span>
}
// --- Data maturity ---------------------------------------------------------
// A date range shorter than a typical sales cycle can't contain fully-closed
// deals yet, so Won / Revenue / ROAS read artificially low. avgCloseDays is the
// CRM's average create->won time (never shown as a KPI); with a 20% buffer we
// flag any range shorter than that as "still maturing". A manual override (set
// in Settings) wins over the CRM figure when present.
function rangeDaysOf(range) { const a = Date.parse(range.from), b = Date.parse(range.to); return (isFinite(a) && isFinite(b)) ? Math.round((b - a) / 86400000) + 1 : null }
function loadCloseOverride(clientId) { const o = SETTINGS.clients && SETTINGS.clients[clientId]; const v = o && o.closeDays; return (v == null || v === '') ? null : Number(v) }
function saveCloseOverride(clientId, days) {
  const cur = (SETTINGS.clients && SETTINGS.clients[clientId]) || {}
  const next = { ...cur, closeDays: (days == null || days === '') ? null : Number(days) }
  SETTINGS.clients = { ...(SETTINGS.clients || {}), [clientId]: next }
  writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [clientId]: next } }); bumpSettings()
}
// Resolve the sales-cycle length for a client: manual override first, else CRM.
function closeDaysFor(clientId, crmAvg) { const ov = loadCloseOverride(clientId); return ov != null && ov > 0 ? { days: ov, manual: true } : (crmAvg != null && crmAvg > 0 ? { days: crmAvg, manual: false } : null) }
// Working hours per client (for Speed to Lead). { days:[0-6], startMin, endMin }.
function loadHours(clientId) { const o = SETTINGS.clients && SETTINGS.clients[clientId]; const h = o && o.hours; return (h && Array.isArray(h.days) && h.days.length && h.startMin != null && h.endMin != null) ? h : null }
function saveHours(clientId, hours) {
  const cur = (SETTINGS.clients && SETTINGS.clients[clientId]) || {}
  const next = { ...cur, hours: hours || null }
  SETTINGS.clients = { ...(SETTINGS.clients || {}), [clientId]: next }
  writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [clientId]: next } }); bumpSettings()
}
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
function fmtHours(h) { if (!h) return null; const cons = h.days.length > 1 && h.days.every((d, i) => i === 0 || d === h.days[i - 1] + 1); const ds = cons ? `${DOW_LABELS[h.days[0]]}–${DOW_LABELS[h.days[h.days.length - 1]]}` : h.days.map((d) => DOW_LABELS[d]).join(', '); return `${ds} · ${hhmm(h.startMin)}–${hhmm(h.endMin)}` }
const hoursQuery = (h) => (h ? `&bhDays=${h.days.join(',')}&bhStart=${h.startMin}&bhEnd=${h.endMin}` : '')
function rangeMaturity(closeDays, range) {
  if (closeDays == null || !(closeDays > 0)) return null
  const matureDays = Math.round(closeDays * 1.2)
  const rDays = rangeDaysOf(range); if (rDays == null) return null
  return { maturing: rDays < matureDays, closeDays, matureDays, rangeDays: rDays, shortfall: Math.max(0, matureDays - rDays) }
}
// Amber "still maturing" chip. Renders nothing when the range is long enough.
function MaturityBadge({ clientId, crmAvg, range, sample, size }) {
  const cd = closeDaysFor(clientId, crmAvg)
  const m = cd && rangeMaturity(cd.days, range)
  if (!m || !m.maturing) return null
  const src = cd.manual ? 'set manually in Settings' : `the CRM average of ~${cd.days} days${sample ? ` across ${sample} won deals` : ''}`
  const tip = `Still maturing — this view covers ${m.rangeDays} days, but a typical deal takes about ${cd.days} days to close (${src}). With a 20% buffer that's ~${m.matureDays} days, so leads in this window haven't had time to convert yet. Won / Revenue / ROAS here understate the real result. Widen the range${m.shortfall ? `, or wait ~${m.shortfall} more day${m.shortfall === 1 ? '' : 's'},` : ''} for a mature picture.`
  return <span className={`maturity-badge${size === 'sm' ? ' sm' : ''}`} title={tip}>⏳ Still maturing</span>
}
// Fixed-position hover popup: escapes the .table-wrap overflow clip (the old
// absolutely-positioned popup got cut off on the bottom rows / edge columns).
// Positions itself against the trigger's viewport rect, flipping above when the
// trigger sits low in the viewport.
function HoverPop({ children, className = '', render }) {
  const ref = React.useRef(null)
  const [pos, setPos] = useState(null)
  const show = () => {
    const el = ref.current; if (!el) return
    const b = el.getBoundingClientRect()
    const below = b.bottom < window.innerHeight * 0.58
    setPos({
      x: Math.min(Math.max(b.left + b.width / 2, 130), window.innerWidth - 130),
      below, y: below ? b.bottom + 6 : window.innerHeight - b.top + 6,
    })
  }
  return (
    <span className={`hp-anchor ${className}`} ref={ref} onMouseEnter={show} onMouseMove={pos ? undefined : show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <span className="hp-fixed" style={{ left: pos.x, [pos.below ? 'top' : 'bottom']: pos.y }}>
          {render()}
        </span>
      )}
    </span>
  )
}
// A signed % chip for the channel-breakdown popups (cur vs prev).
function ChanDelta({ cur, prev, goodWhenDown = false }) {
  if (cur == null || prev == null || !prev) return null
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (!isFinite(pct)) return null
  const up = pct >= 0
  const cls = goodWhenDown ? (up ? 'down' : 'up') : (up ? 'up' : 'down')
  return <span className={`hp-d ${cls}`}>{up ? '▲' : '▼'} {fmtPct(Math.abs(pct), 0)}</span>
}
// Spend channel-breakdown popup: per-channel spend + which channel is up/down.
function SpendPop({ children, r, currency }) {
  const money = (v) => fmtCurrency(v, currency)
  return (
    <HoverPop render={() => (
      <span className="hp-body">
        <span className="hp-t">Spend by channel</span>
        {r.hasMeta && <span className="hp-r"><span className="ov-pd meta">Meta</span><span className="hp-val">{money(r.metaSpend)}<ChanDelta cur={r.metaSpend} prev={r.prevMetaSpend} goodWhenDown /></span></span>}
        {r.hasGoogle && <span className="hp-r"><span className="ov-pd google">Google</span><span className="hp-val">{money(r.googleSpend)}<ChanDelta cur={r.googleSpend} prev={r.prevGoogleSpend} goodWhenDown /></span></span>}
        <span className="hp-r hp-tot"><span>Total</span><span className="hp-val">{money(r.spend)}<ChanDelta cur={r.spend} prev={r.prevSpend} goodWhenDown /></span></span>
      </span>
    )}>{children}</HoverPop>
  )
}
// Results / Cost-per-result channel breakdown popup (cost + which channel up/down).
function ResultsPop({ children, r, currency }) {
  const money = (v) => fmtCurrency(v, currency)
  // Two deltas per channel: volume (more results = green) and cost per result
  // (cheaper = green), so a falling CPL / cost-per-result reads as a win.
  const mCpl = r.metaLeads ? r.metaSpend / r.metaLeads : null
  const pmCpl = r.prevMetaLeads ? r.prevMetaSpend / r.prevMetaLeads : null
  const gCpc = r.googleConv ? r.googleSpend / r.googleConv : null
  const pgCpc = r.prevGoogleConv ? r.prevGoogleSpend / r.prevGoogleConv : null
  const tCpr = r.conversions ? r.spend / r.conversions : null
  const ptCpr = r.prevResults ? r.prevSpend / r.prevResults : null
  return (
    <HoverPop render={() => (
      <span className="hp-body">
        <span className="hp-t">Results by channel · vs previous · cheaper cost = green</span>
        {r.hasMeta && <span className="hp-r"><span className="ov-pd meta">Meta</span><span className="hp-val">{fmtNumber(r.metaLeads)} leads<ChanDelta cur={r.metaLeads} prev={r.prevMetaLeads} />{mCpl != null ? <> · {money(mCpl)}/lead<ChanDelta cur={mCpl} prev={pmCpl} goodWhenDown /></> : null}</span></span>}
        {r.hasGoogle && <span className="hp-r"><span className="ov-pd google">Google</span><span className="hp-val">{fmtNumber(r.googleConv)} conv.<ChanDelta cur={r.googleConv} prev={r.prevGoogleConv} />{gCpc != null ? <> · {money(gCpc)}/conv<ChanDelta cur={gCpc} prev={pgCpc} goodWhenDown /></> : null}</span></span>}
        <span className="hp-r hp-tot"><span>Total</span><span className="hp-val">{fmtNumber(r.conversions)}<ChanDelta cur={r.conversions} prev={r.prevResults} />{tCpr != null ? <> · {money(tCpr)}/result<ChanDelta cur={tCpr} prev={ptCpr} goodWhenDown /></> : null}</span></span>
      </span>
    )}>{children}</HoverPop>
  )
}
const OV_FILTERS = [['all', 'All'], ['paid', 'Paid'], ['nonpaid', 'Non-Paid']]
function AgencyComparison({ rows, currency, range, nonce, onPick }) {
  const [f, setF] = useState('all')
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const ov = useOvRows(rows, range, nonce)
  const money = (v) => fmtCurrency(v, currency)
  const chanKey = f === 'all' ? 'all' : f === 'paid' ? 'paid' : 'other'
  const paidView = f !== 'nonpaid' // ad spend/results only exist for paid
  // Every column's sort value for a row, honouring the current filter (paid /
  // non-paid) and channel. CRM columns are null until that client's row loads,
  // so they sort last regardless of direction.
  const metricsOf = (r) => {
    const spendF = paidView ? r.spend : 0
    const resF = paidView ? r.conversions : 0
    const o = ov[r.id]; const cur = (o && o.status === 'ok' && o.cur) ? o.cur[chanKey] : null
    return {
      name: r.name, spend: spendF, results: resF, costResult: resF ? spendF / resF : null,
      opps: cur ? cur.opps : null, booked: cur ? cur.booked : null,
      costBooked: cur && cur.booked && spendF ? spendF / cur.booked : null,
      showRate: cur && cur.booked ? cur.shown / cur.booked : null,
      costShown: cur && cur.shown && spendF ? spendF / cur.shown : null,
      bookingRate: cur && cur.opps ? cur.booked / cur.opps : null,
      won: cur ? cur.won : null, revenue: cur ? cur.revenue : null,
      avgDeal: cur && cur.won ? cur.revenue / cur.won : null,
      costWon: cur && cur.won && spendF ? spendF / cur.won : null,
      roas: cur && spendF ? cur.revenue / spendF : null,
    }
  }
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const sorted = [...rows].sort((a, b) => {
    const av = metricsOf(a)[sort.key], bv = metricsOf(b)[sort.key]
    if (sort.key === 'name') return String(av).localeCompare(String(bv)) * sort.dir
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * sort.dir
  })
  const OvTh = ({ k, children, cls }) => <th className={cls} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  const crmIds = rows.filter((r) => r.c.ghl).map((r) => r.id)
  const crmLoading = crmIds.filter((id) => !ov[id] || ov[id].status === 'loading').length
  const crmDone = crmIds.length - crmLoading
  const crmErrors = crmIds.filter((id) => ov[id] && ov[id].status === 'err').length
  const rate = (n, d) => (d ? (n / d) * 100 : null)
  const Cell = ({ v, cur, prev, gd, neutral, loading, dash }) => (
    <td className="ov-td">{loading ? <span className="ov-spin" /> : dash ? <span className="ov-dash">-</span> : <div className="ov-cell"><span className="ov-v">{v}</span><MiniDelta cur={cur} prev={prev} goodWhenDown={gd} neutral={neutral} /></div>}</td>
  )
  return (
    <>
      <div className="ov-cmp-head">
        <div className="chan-toggle ov-filter">{OV_FILTERS.map(([k, lbl]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{lbl}</button>)}</div>
        <span className="ov-cmp-note">vs previous {rangeLabel(range).toLowerCase()} · green = better, red = worse{f === 'nonpaid' ? ' · ad-cost columns N/A for non-paid' : ''}</span>
      </div>
      {crmIds.length > 0 && (crmLoading > 0 || crmErrors > 0) && (
        <div className={`ov-crm-banner ${crmLoading > 0 ? 'loading' : 'done'}`}>
          {crmLoading > 0
            ? <><span className="ov-spin" /><b>Loading CRM metrics…</b> {crmDone} of {crmIds.length} clients ready<span className="ov-crm-sub">The Opps → ROAS columns pull live from Caalano Systems — first load can take up to ~60s.</span></>
            : <><span className="ov-warn-dot">!</span><b>{crmErrors} client{crmErrors === 1 ? '' : 's'} couldn't load CRM data.</b><span className="ov-crm-sub">Hover the ⚠ on a row for the reason, or hit Refresh to retry.</span></>}
        </div>
      )}
      <div className="table-wrap"><table className="ov-cmp">
        <thead><tr>
          <OvTh k="name" cls="ov-name">Client</OvTh>
          <OvTh k="spend">Spend</OvTh><OvTh k="results">Results</OvTh><OvTh k="costResult">Cost / Result</OvTh>
          <OvTh k="opps">Opps</OvTh><OvTh k="booked">Booked</OvTh><OvTh k="costBooked">Cost / Booked</OvTh><OvTh k="showRate">Show Rate</OvTh><OvTh k="costShown">Cost / Shown</OvTh><OvTh k="bookingRate">Booking Rate</OvTh>
          <OvTh k="won">Won</OvTh><OvTh k="revenue">Revenue</OvTh><OvTh k="avgDeal">Avg Deal</OvTh><OvTh k="costWon">Cost / Won</OvTh><OvTh k="roas">ROAS</OvTh>
        </tr></thead>
        <tbody>{sorted.map((r) => {
          const spendF = paidView ? r.spend : 0
          const pSpendF = paidView ? r.prevSpend : 0
          const resF = paidView ? r.conversions : 0
          const pResF = paidView ? r.prevResults : 0
          const o = ov[r.id]
          const loading = !!r.c.ghl && (!o || o.status === 'loading')
          const ok = o && o.status === 'ok' && o.cur
          const cur = ok ? o.cur[chanKey] : null
          const prev = ok && o.prev ? o.prev[chanKey] : null
          const noCrm = !r.c.ghl
          const errored = !noCrm && !loading && !ok
          // GHL cell helper: dash when no CRM / errored, spinner while loading.
          const g = (v, curN, prevN, gd, neutral) => ({ v, cur: curN, prev: prevN, gd, neutral, loading, dash: noCrm || (!loading && !ok) })
          const cBooked = cur && cur.booked && spendF ? spendF / cur.booked : null
          const pcBooked = prev && prev.booked && pSpendF ? pSpendF / prev.booked : null
          const cShown = cur && cur.shown && spendF ? spendF / cur.shown : null
          const pcShown = prev && prev.shown && pSpendF ? pSpendF / prev.shown : null
          const cWon = cur && cur.won && spendF ? spendF / cur.won : null
          const pcWon = prev && prev.won && pSpendF ? pSpendF / prev.won : null
          const roas = cur && spendF ? cur.revenue / spendF : null
          const pRoas = prev && pSpendF ? prev.revenue / pSpendF : null
          return (
            <tr key={r.id} onClick={() => onPick(r.c)}>
              <td className="ov-name"><div className="client-cell"><span className="avatar" style={{ background: acolor(r.i) }}>{initials(r.name)}</span><div><span className="ov-name-row">{r.name}<MaturityBadge clientId={r.id} crmAvg={ok ? o.cur.avgCloseDays : null} sample={ok ? o.cur.avgCloseSample : 0} range={range} size="sm" /></span><small>{r.industry}</small></div></div></td>
              <Cell v={paidView ? <SpendPop r={r} currency={currency}>{money(spendF)}</SpendPop> : '-'} cur={paidView ? spendF : null} prev={paidView ? pSpendF : null} neutral dash={!paidView} />
              <Cell v={paidView ? <ResultsPop r={r} currency={currency}>{fmtNumber(resF)}</ResultsPop> : '-'} cur={paidView ? resF : null} prev={paidView ? pResF : null} dash={!paidView} />
              <Cell v={paidView && resF ? <ResultsPop r={r} currency={currency}>{money(spendF / resF)}</ResultsPop> : '-'} cur={paidView && resF ? spendF / resF : null} prev={paidView && pResF ? pSpendF / pResF : null} gd dash={!paidView || !resF} />
              {errored
                ? <td className="ov-td"><span className="ov-rowerr" title={`Couldn't load CRM data: ${o?.err || 'failed'}`}>⚠</span></td>
                : <Cell {...g(cur ? fmtNumber(cur.opps) : '-', cur?.opps, prev?.opps)} />}
              <Cell {...g(cur ? fmtNumber(cur.booked) : '-', cur?.booked, prev?.booked)} />
              <Cell {...g(cBooked != null ? money(cBooked) : '-', cBooked, pcBooked, true)} />
              <Cell {...g(cur && cur.booked ? fmtPct(rate(cur.shown, cur.booked), 0) : '-', rate(cur?.shown, cur?.booked), rate(prev?.shown, prev?.booked))} />
              <Cell {...g(cShown != null ? money(cShown) : '-', cShown, pcShown, true)} />
              <Cell {...g(cur && cur.opps ? fmtPct(rate(cur.booked, cur.opps), 0) : '-', rate(cur?.booked, cur?.opps), rate(prev?.booked, prev?.opps))} />
              <Cell {...g(cur ? fmtNumber(cur.won) : '-', cur?.won, prev?.won)} />
              <Cell {...g(cur ? money(cur.revenue) : '-', cur?.revenue, prev?.revenue)} />
              <Cell {...g(cur && cur.won ? money(cur.revenue / cur.won) : '-', cur && cur.won ? cur.revenue / cur.won : null, prev && prev.won ? prev.revenue / prev.won : null)} />
              <Cell {...g(cWon != null ? money(cWon) : '-', cWon, pcWon, true)} />
              <Cell {...g(roas != null ? `${roas.toFixed(2)}×` : '-', roas, pRoas)} />
            </tr>
          )
        })}</tbody>
      </table></div>
    </>
  )
}

/* ============ Client performance trends ============ */
function useTrends(nonce = 0) {
  const [state, setState] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=trends${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: j && j.clients ? 'ok' : 'err', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [nonce])
  return state
}
const WLABEL = { 3: 'Last 3 days', 7: 'Last 7 days', 14: 'Last 14 days', 21: 'Last 21 days', 28: 'Last 28 days' }
// One scorecard: value + % change vs the prior equal window (lower cost = good).
function TrendCell({ label, value, cur, prev, goodWhenDown = true, sub }) {
  const has = prev != null && prev > 0 && cur != null
  const pct = has ? ((cur - prev) / prev) * 100 : null
  const dir = pct == null ? 'flat' : (goodWhenDown ? (pct <= 0 ? 'up' : 'down') : (pct >= 0 ? 'up' : 'down'))
  return (
    <div className="tr-sc">
      <div className="tr-lab">{label}</div>
      <div className="tr-val">{value}</div>
      {pct != null ? <div className={`tr-d ${dir}`}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct).toFixed(0)}%</div> : <div className="tr-d flat">no prior</div>}
      {sub ? <div className="tr-sub">{sub}</div> : null}
    </div>
  )
}
function ClientTrend({ row, tr, currency, onPick }) {
  // Channels this client runs, plus a blended view when they run both. Shown as
  // a toggle so Google-only (and Meta-only) clients can still filter to theirs.
  const chanOpts = [['blended', 'Blended']]
  if (row.hasMeta) chanOpts.push(['meta', 'Meta'])
  if (row.hasGoogle) chanOpts.push(['google', 'Google'])
  const [chan, setChan] = useState(row.hasMeta && row.hasGoogle ? 'blended' : row.hasGoogle ? 'google' : 'meta')
  const eff = chan
  const money = (v) => fmtCurrency(v, currency)
  const wins = tr.windows || []
  const resultLabel = eff === 'google' ? 'Cost / Conversion' : eff === 'meta' ? 'Cost / Lead' : 'Cost / Result (blended)'
  return (
    <div className="card tr-card">
      <div className="tr-head">
        <button className="tr-name" onClick={() => onPick(row.c)} title="Open client workspace">{row.name} <span className="tr-open">↗</span></button>
        {chanOpts.length > 1 && <div className="chan-toggle sm">{chanOpts.map(([k, l]) => (<button key={k} className={chan === k ? 'on' : ''} onClick={() => setChan(k)}>{l}</button>))}</div>}
      </div>
      <div className="tr-row-lab">{resultLabel} <span className="sub">· vs previous equal period{tr.hasCrm ? ' · % = booking rate (booked ÷ leads)' : ''}</span></div>
      <div className="tr-grid">{wins.map((w) => { const d = w[eff]; const cpl = d.results ? d.spend / d.results : null; const cplP = d.resultsPrev ? d.spendPrev / d.resultsPrev : null; const br = d.results ? (d.booked / d.results) * 100 : null; return <TrendCell key={w.n} label={WLABEL[w.n]} value={cpl != null ? money(cpl) : '-'} cur={cpl} prev={cplP} sub={tr.hasCrm && br != null ? `${br.toFixed(1)}% booked` : null} /> })}</div>
    </div>
  )
}
function TrendsTab({ rows, currency, nonce, onPick }) {
  const tr = useTrends(nonce)
  if (tr.status === 'loading') return <div className="card"><Spinner label="Loading performance trends…" /></div>
  if (tr.status === 'err' || !tr.data || !tr.data.clients) return <div className="card"><p className="cap" style={{ margin: 0 }}>Couldn't load trends - try Refresh.</p></div>
  const clients = tr.data.clients
  const list = rows.filter((r) => clients[r.id] && (r.hasMeta || r.hasGoogle))
  return (
    <div className="tr-list">
      {list.map((r) => <ClientTrend key={r.id} row={r} tr={clients[r.id]} currency={currency} onPick={onPick} />)}
      {!list.length && <div className="card"><p className="cap" style={{ margin: 0 }}>No client trend data available for the last 8 weeks.</p></div>}
      <p className="caveat">Each window compares the last N days to the previous N days. Green = cost fell (better), red = cost rose. Booked calls come from Caalano Systems pipeline stages; where UTM attribution is connected they're split by first-touch channel, so Meta / Google cost-per-booked uses that channel's own bookings. Otherwise the toggle divides that channel's spend by total booked calls.</p>
    </div>
  )
}

/* ============ Weekly Traffic Light ============ */
// AI insights (Weekly Traffic Light briefings) persist per client on the SERVER
// like every other setting - see the SETTINGS store below - so a briefing one
// person generates is shared across the team and devices. (Read/written via the
// shared SETTINGS cache; the functions live here for locality with the tab.)
const AI_KEY = 'caalano_ai_insights'
function loadInsights(clientId) { return (SETTINGS.insights && SETTINGS.insights[clientId]) || null }
function saveInsights(clientId, v) { SETTINGS.insights = { ...(SETTINGS.insights || {}), [clientId]: v }; writeLS(AI_KEY, SETTINGS.insights); saveSettingsRemote({ insights: { [clientId]: v } }); bumpSettings() }
// Minimal markdown renderer (bold, headings, bullets) for the AI briefing.
function MdText({ text }) {
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p))
  return <div className="ai-md">{String(text || '').split('\n').map((ln, i) => {
    const t = ln.trim()
    if (!t) return null
    if (t.startsWith('### ')) return <h5 key={i}>{bold(t.slice(4))}</h5>
    if (t.startsWith('## ')) return <h4 key={i}>{bold(t.slice(3))}</h4>
    if (t.startsWith('# ')) return <h4 key={i}>{bold(t.slice(2))}</h4>
    if (/^[-*•]\s/.test(t)) return <div className="ai-li" key={i}>• {bold(t.replace(/^[-*•]\s/, ''))}</div>
    if (/^\d+\.\s/.test(t)) return <div className="ai-li ai-num" key={i}>{bold(t)}</div>
    return <p key={i}>{bold(t)}</p>
  })}</div>
}
function useWeekly(clientId, weeks, nonce = 0) {
  const [state, setState] = useState({ status: 'loading', data: null })
  useEffect(() => {
    if (!clientId) return
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=weekly&client=${clientId}&weeks=${weeks}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: j && j.weeks ? 'ok' : 'err', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, weeks, nonce])
  return state
}
function WkTile({ label, value, num, target, goodWhenDown = true }) {
  const has = target != null && target !== '' && Number(target) > 0 && num != null && isFinite(num)
  const pct = has ? ((num - Number(target)) / Number(target)) * 100 : null
  const dir = pct == null ? 'flat' : (goodWhenDown ? (pct <= 0 ? 'up' : 'down') : (pct >= 0 ? 'up' : 'down'))
  return <div className="wk-tile"><div className="wk-lab">{label}</div><div className="wk-val">{value}</div>{pct != null ? <div className={`wk-d ${dir}`}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct).toFixed(1)}% vs KPI</div> : <div className="wk-d flat">no KPI set</div>}</div>
}
// volume bars (right axis) + cost-$ line (left axis) + optional KPI line ($ left)
function WkDual({ data, costKey, costName, countKey, countName, kpi, currency, costColor, countColor }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ left: -4, right: 6, top: 10 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" fontSize={11} stroke="var(--muted)" />
        <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => '$' + fmtCompact(v)} />
        <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
        <Tooltip formatter={(v, n) => (n === countName ? fmtNumber(v) : fmtCurrency(v, currency))} />
        <Legend />
        <Bar yAxisId="r" dataKey={countKey} name={countName} fill={countColor || '#bcd0ff'} radius={[3, 3, 0, 0]} maxBarSize={42}>
          <LabelList dataKey={countKey} position="insideTop" fill="var(--text)" fontSize={10} fontWeight={700} formatter={(v) => (v ? fmtNumber(v) : '')} />
        </Bar>
        <Line yAxisId="l" type="monotone" dataKey={costKey} name={costName} stroke={costColor || '#4f7cff'} strokeWidth={2.5} dot={{ r: 3 }} />
        {kpi != null && kpi > 0 && <ReferenceLine yAxisId="l" y={kpi} stroke="var(--text)" strokeDasharray="5 4" label={{ value: `KPI ${fmtCurrency(kpi, currency)}`, fontSize: 10, fill: 'var(--muted)', position: 'insideTopRight' }} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
function WeeklyTab({ rows, currency, nonce }) {
  const clients = [...rows].sort((a, b) => a.name.localeCompare(b.name))
  const [cid, setCid] = useState(clients[0]?.id || null)
  const [weeks, setWeeks] = useState(6)
  const wk = useWeekly(cid, weeks, nonce)
  const kpis = cid ? loadKpis(cid) : {}
  const money = (v) => fmtCurrency(v, currency)
  const clientName = clients.find((c) => c.id === cid)?.name || '-'
  const [ai, setAi] = useState(() => (cid ? loadInsights(cid) : null))
  const [aiLoading, setAiLoading] = useState(false)
  const [aiErr, setAiErr] = useState(null)
  // Re-read once server settings hydrate (SETTINGS.loaded) so a briefing saved
  // on another device/browser shows up here too.
  useEffect(() => { setAi(cid ? loadInsights(cid) : null); setAiErr(null) }, [cid, SETTINGS.loaded])
  const genInsights = async () => {
    if (!wk.data || !wk.data.weeks || aiLoading) return
    setAiLoading(true); setAiErr(null)
    try {
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientName, weekly: wk.data, kpis }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const rec = { insights: j.insights, weekRange: j.weekRange, generatedAt: j.generatedAt || new Date().toISOString(), model: j.model }
      saveInsights(cid, rec); setAi(rec)
    } catch (e) { setAiErr(String(e.message || e)) } finally { setAiLoading(false) }
  }
  return (
    <>
      <div className="c360-head" style={{ marginTop: 0 }}>
        <div className="pipe-sel"><label>Client</label>
          <select value={cid || ''} onChange={(e) => setCid(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <div className="pipe-sel"><label>Weeks</label>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[4, 6, 8, 12].map((n) => <option key={n} value={n}>Last {n} weeks</option>)}</select>
        </div>
      </div>
      {wk.status === 'loading' ? <div className="card"><Spinner label="Loading weekly data…" /></div>
        : wk.status === 'err' || !wk.data || !wk.data.weeks ? <div className="card"><p className="cap" style={{ margin: 0 }}>Couldn't load weekly data - try Refresh.</p></div>
          : (() => {
            const W = wk.data.weeks.map((w) => ({
              ...w,
              cpl: w.leads ? w.spend / w.leads : 0,
              metaCplV: w.metaLeads ? w.metaSpend / w.metaLeads : 0,
              gCostConv: w.googleConv ? w.googleSpend / w.googleConv : 0,
              cpba: w.booked ? w.spend / w.booked : 0,
              bookingRate: w.leads ? (w.booked / w.leads) * 100 : 0,
              showRate: w.booked ? (w.shown / w.booked) * 100 : 0,
              cpa: w.won ? w.spend / w.won : 0,
            }))
            const T = W.reduce((a, w) => ({ spend: a.spend + w.spend, metaSpend: a.metaSpend + w.metaSpend, metaLeads: a.metaLeads + w.metaLeads, leads: a.leads + w.leads, booked: a.booked + w.booked, shown: a.shown + w.shown, won: a.won + w.won, wonValue: a.wonValue + w.wonValue }), { spend: 0, metaSpend: 0, metaLeads: 0, leads: 0, booked: 0, shown: 0, won: 0, wonValue: 0 })
            const n = W.length || 1
            const avgSpend = T.spend / n
            const mCpl = T.metaLeads ? T.metaSpend / T.metaLeads : 0
            const aCpl = T.leads ? T.spend / T.leads : 0
            const cpba = T.booked ? T.spend / T.booked : 0
            const bookRate = T.leads ? (T.booked / T.leads) * 100 : 0
            const cpa = T.won ? T.spend / T.won : 0
            const avgDeal = T.won ? T.wonValue / T.won : 0
            const roas = T.spend ? T.wonValue / T.spend : 0
            const fmtD = (ds) => { try { return new Date(ds + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return ds } }
            const endSun = W.length ? (() => { const d = new Date(W[W.length - 1].week + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10) })() : null
            const rangeLbl = W.length ? `${W[0].label} to ${W[W.length - 1].label} · ${fmtD(W[0].week)} to ${fmtD(endSun)}` : ''
            return (
              <>
                <div className="section-title" style={{ marginTop: 4 }}>{clientName} <span className="sub">· weekly (Mon to Sun) · {rangeLbl}</span></div>
                <div className="wk-tiles wk-tiles-9">
                  <WkTile label="Pacing (avg/wk)" value={money(avgSpend)} num={avgSpend} target={kpis.wkSpend} goodWhenDown />
                  <WkTile label="Meta CPL" value={mCpl ? money(mCpl) : '-'} num={mCpl} target={kpis.metaCpl} goodWhenDown />
                  <WkTile label="All Leads CPL" value={aCpl ? money(aCpl) : '-'} num={aCpl} target={kpis.cpl} goodWhenDown />
                  <WkTile label="Booking Rate" value={fmtPct(bookRate, 1)} num={bookRate} target={kpis.bookingRate} goodWhenDown={false} />
                  <WkTile label="CPA (cost/won)" value={cpa ? money(cpa) : '-'} num={cpa} target={kpis.cpa} goodWhenDown />
                  <WkTile label="Won Value" value={money(T.wonValue)} num={null} />
                  <WkTile label="Avg Deal Value" value={T.won ? money(avgDeal) : '-'} num={null} />
                  <WkTile label="ROAS" value={`${roas.toFixed(2)}×`} num={null} />
                </div>
                <div className="card ai-card" style={{ marginTop: 14 }}>
                  <div className="ai-head">
                    <div className="ai-title">✨ AI insights {ai ? <span className="sub">· {ai.weekRange} · generated {new Date(ai.generatedAt).toLocaleString()}</span> : <span className="sub">· Claude reads Meta + Google vs CRM outcomes</span>}</div>
                    <button className="ai-btn" onClick={genInsights} disabled={aiLoading}>{aiLoading ? 'Generating…' : ai ? '↻ Regenerate' : '✨ Generate AI insights'}</button>
                  </div>
                  {aiErr && <p className="cap" style={{ color: 'var(--neg)', margin: '2px 0 0' }}>{aiErr}</p>}
                  {aiLoading ? <Spinner label="Claude is analysing this client…" />
                    : ai ? <MdText text={ai.insights} />
                      : <p className="cap" style={{ margin: 0 }}>Generate a written briefing that interprets this client's weekly Meta / Google performance against their Caalano Systems bookings, wins and lost reasons. It only runs when you click, and stays saved to this client until you regenerate.</p>}
                </div>
                <div className="wk-grid">
                  <div className="card chart-card"><h3>Overall Spend Pacing</h3><p className="cap">Spend per week vs weekly target</p>
                    <ResponsiveContainer width="100%" height={240}><ComposedChart data={W} margin={{ left: -4, right: 6, top: 10 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" fontSize={11} stroke="var(--muted)" /><YAxis fontSize={10} stroke="var(--muted)" tickFormatter={(v) => '$' + fmtCompact(v)} /><Tooltip formatter={(v) => money(v)} />
                      <Bar dataKey="spend" name="Spend" fill="#e2504f" radius={[3, 3, 0, 0]} maxBarSize={46} />
                      {Number(kpis.wkSpend) > 0 && <ReferenceLine y={Number(kpis.wkSpend)} stroke="var(--text)" strokeDasharray="5 4" label={{ value: `KPI ${money(kpis.wkSpend)}`, fontSize: 10, fill: 'var(--muted)', position: 'insideTopRight' }} />}
                    </ComposedChart></ResponsiveContainer>
                  </div>
                  <div className="card chart-card"><h3>All Leads</h3><p className="cap">Lead volume (bars) &amp; all-leads CPL (line) by week</p>
                    <WkDual data={W} costKey="cpl" costName="CPL" countKey="leads" countName="Leads" kpi={Number(kpis.cpl) || null} currency={currency} costColor="#f5a524" countColor="#ffe2b0" />
                  </div>
                  {wk.data.hasMeta && <div className="card chart-card"><h3>Meta Leads</h3><p className="cap">Leads (bars) &amp; Meta CPL (line) by week</p>
                    <WkDual data={W} costKey="metaCplV" costName="CPL" countKey="metaLeads" countName="Leads" kpi={Number(kpis.metaCpl) || null} currency={currency} costColor="#4f7cff" countColor="#bcd0ff" />
                  </div>}
                  {wk.data.hasGoogle && <div className="card chart-card"><h3>Google Leads</h3><p className="cap">Conversions (bars) &amp; cost per conversion (line) by week</p>
                    <WkDual data={W} costKey="gCostConv" costName="Cost/conv" countKey="googleConv" countName="Conv." kpi={Number(kpis.googleCostConv) || null} currency={currency} costColor="#0e8f6a" countColor="#a7e8d3" />
                  </div>}
                  {wk.data.hasCrm && <>
                    <div className="card chart-card"><h3>Appointments Booked</h3><p className="cap">Booked appointments by week</p>
                      <ResponsiveContainer width="100%" height={240}><BarChart data={W} margin={{ left: -4, right: 6, top: 14 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" fontSize={11} stroke="var(--muted)" /><YAxis fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip formatter={(v) => fmtNumber(v)} />
                        <Bar dataKey="booked" name="Appt's" fill="#b0325f" radius={[3, 3, 0, 0]} maxBarSize={46}><LabelList dataKey="booked" position="insideTop" fill="#fff" fontSize={10} fontWeight={700} formatter={(v) => (v ? fmtNumber(v) : '')} /></Bar>
                      </BarChart></ResponsiveContainer>
                    </div>
                    <div className="card chart-card"><h3>Shown Appointments</h3><p className="cap">Shown (bars) &amp; show rate (line) by week</p>
                      <ResponsiveContainer width="100%" height={240}><ComposedChart data={W} margin={{ left: -4, right: 6, top: 10 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" fontSize={11} stroke="var(--muted)" /><YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} /><YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip formatter={(v, nm) => (nm === 'Show rate' ? fmtPct(v, 1) : fmtNumber(v))} /><Legend />
                        <Bar yAxisId="r" dataKey="shown" name="Shown" fill="#2f8f83" radius={[3, 3, 0, 0]} maxBarSize={42} />
                        <Line yAxisId="l" type="monotone" dataKey="showRate" name="Show rate" stroke="#8fcabe" strokeWidth={2.5} dot={{ r: 3 }} />
                      </ComposedChart></ResponsiveContainer>
                    </div>
                    <div className="card chart-card"><h3>Clients Won</h3><p className="cap">Wins (bars) with won value labelled &amp; cost per acquisition (line) by week</p>
                      <ResponsiveContainer width="100%" height={240}><ComposedChart data={W} margin={{ left: -4, right: 6, top: 16 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" fontSize={11} stroke="var(--muted)" /><YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => '$' + fmtCompact(v)} /><YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip formatter={(v, nm) => (nm === 'Wins' ? fmtNumber(v) : fmtCurrency(v, currency))} /><Legend />
                        <Bar yAxisId="r" dataKey="won" name="Wins" fill="#c9c1ff" radius={[3, 3, 0, 0]} maxBarSize={42}>
                          <LabelList dataKey="won" position="insideTop" fill="var(--text)" fontSize={10} fontWeight={700} formatter={(v) => (v ? fmtNumber(v) : '')} />
                          <LabelList dataKey="wonValue" position="top" fill="var(--muted)" fontSize={9.5} formatter={(v) => (v ? '$' + fmtCompact(v) : '')} />
                        </Bar>
                        <Line yAxisId="l" type="monotone" dataKey="cpa" name="CPA" stroke="#6d5efc" strokeWidth={2.5} dot={{ r: 3 }} />
                        {Number(kpis.cpa) > 0 && <ReferenceLine yAxisId="l" y={Number(kpis.cpa)} stroke="var(--text)" strokeDasharray="5 4" label={{ value: `KPI ${money(kpis.cpa)}`, fontSize: 10, fill: 'var(--muted)', position: 'insideTopRight' }} />}
                      </ComposedChart></ResponsiveContainer>
                    </div>
                    <div className="card chart-card"><h3>Funnel</h3><p className="cap">Leads → Appt's → Shown → Won by week</p>
                      <ResponsiveContainer width="100%" height={240}><BarChart data={W} margin={{ left: -6, right: 6, top: 14 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" fontSize={11} stroke="var(--muted)" /><YAxis fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip /><Legend />
                        <Bar dataKey="leads" name="Leads" fill="#f5a524" radius={[3, 3, 0, 0]} maxBarSize={20}><LabelList dataKey="leads" position="top" fill="var(--muted)" fontSize={9.5} formatter={(v) => (v ? fmtNumber(v) : '')} /></Bar>
                        <Bar dataKey="booked" name="Appt's" fill="#b0325f" radius={[3, 3, 0, 0]} maxBarSize={20}><LabelList dataKey="booked" position="top" fill="var(--muted)" fontSize={9.5} formatter={(v) => (v ? fmtNumber(v) : '')} /></Bar>
                        <Bar dataKey="shown" name="Shown" fill="#2f8f83" radius={[3, 3, 0, 0]} maxBarSize={20}><LabelList dataKey="shown" position="top" fill="var(--muted)" fontSize={9.5} formatter={(v) => (v ? fmtNumber(v) : '')} /></Bar>
                        <Bar dataKey="won" name="Won" fill="#6d5efc" radius={[3, 3, 0, 0]} maxBarSize={20}><LabelList dataKey="won" position="top" fill="var(--muted)" fontSize={9.5} formatter={(v) => (v ? fmtNumber(v) : '')} /></Bar>
                      </BarChart></ResponsiveContainer>
                    </div>
                    {(wk.data.lostReasons || []).length > 0 && <div className="card chart-card"><h3>Lost reasons</h3><p className="cap">Why deals were lost · {rangeLbl}</p>
                      <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={wk.data.lostReasons.slice(0, 8)} dataKey="count" nameKey="name" innerRadius={54} outerRadius={86} paddingAngle={2} stroke="none">{wk.data.lostReasons.slice(0, 8).map((x, i) => <Cell key={i} fill={acolor(i)} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
                      <div className="legend" style={{ flexWrap: 'wrap', fontSize: 11 }}>{wk.data.lostReasons.slice(0, 8).map((x, i) => <span key={i}><i className="swatch" style={{ background: acolor(i) }} /> {x.name} {x.count}</span>)}</div>
                    </div>}
                  </>}
                </div>
                <p className="caveat">Weeks run Monday-Sunday (ISO week number shown). Leads = Meta leads + Google conversions. Appointments / shown / won come from Caalano Systems pipeline stages (opportunities created that week). KPI lines &amp; vs-KPI deltas use the weekly targets you set per client in Settings.</p>
              </>
            )
          })()}
    </>
  )
}

/* ============ CRM (pipeline) ============ */
function CrmTab({ ghl, currency }) {
  const lmax = Math.max(...ghl.lostReasons.map((s) => s.count))
  const won = ghl.wonByMonth.map((w) => ({ ...w, label: w.month.slice(2) }))
  const srcMax = Math.max(...ghl.sources.map((s) => s.won + s.open + s.lostSampled))
  const fmax = Math.max(...ghl.funnel.map((s) => s.count))
  return (
    <>
      <div className="card"><div className="stat-hero">
        <div className="s"><div className="v">{ghl.summary.open}</div><div className="l">Open opportunities</div></div>
        <div className="s"><div className="v">{fmtCurrency(ghl.summary.wonValue, currency)}</div><div className="l">Won value (tracked)</div></div>
        <div className="s"><div className="v">{fmtCurrency(ghl.summary.avgWonValue, currency)}</div><div className="l">Avg won deal</div></div>
        <div className="s"><div className="v">{fmtPct(ghl.summary.closedWinRatePct, 1)}</div><div className="l">Close rate</div></div>
        <div className="s"><div className="v">{ghl.summary.lostTotal}</div><div className="l">Lost deals</div></div>
      </div></div>
      <div className="card insight" style={{ marginTop: 14 }}><span className="em">🔎</span><div><h4>Biggest leak</h4><p>{ghl.biggestLeak}</p></div></div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Open pipeline by phase</h3><p className="cap">Where the {ghl.summary.open} live deals sit</p>
          <div className="funnel">{ghl.funnel.map((s) => (<div className="fn" key={s.stage}><span className="lab">{s.stage}</span><span className="bar" style={{ width: `${Math.max(12, (s.count / fmax) * 100)}%`, background: PHASE_COLOR[s.phase] }}>{s.count}</span></div>))}</div>
        </div>
        <div className="card chart-card"><h3>Why deals are lost</h3><p className="cap">Sample of {ghl.summary.lostSampled} of {ghl.summary.lostTotal}</p>
          {ghl.lostReasons.slice(0, 8).map((r) => (<div className="bar-row" key={r.name}><span className="nm">{r.name}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(r.count / lmax) * 100}%`, background: /Contact|No Show|Cancel/.test(r.name) ? 'var(--neg)' : 'var(--warn)' }} /></span><span className="ct">{r.count}</span></div>))}
        </div>
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Wins over time</h3><p className="cap">Deals marked won per month</p>
          <ResponsiveContainer width="100%" height={210}><LineChart data={won} margin={{ left: -18, right: 10, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" stroke="var(--muted)" fontSize={11} /><YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="count" stroke="#6d5efc" strokeWidth={2.5} dot={{ r: 3, fill: '#6d5efc' }} /></LineChart></ResponsiveContainer>
        </div>
        <div className="card chart-card"><h3>Lead source performance</h3><p className="cap">Won / open / lost by source</p>
          {ghl.sources.map((s) => (<div className="bar-row" key={s.name} style={{ gridTemplateColumns: '160px 1fr 58px' }}><span className="nm">{s.name}</span><span className="bar-track" style={{ display: 'flex' }}><span style={{ width: `${(s.won / srcMax) * 100}%`, background: 'var(--pos)' }} /><span style={{ width: `${(s.open / srcMax) * 100}%`, background: 'var(--brand)' }} /><span style={{ width: `${(s.lostSampled / srcMax) * 100}%`, background: 'var(--neg)' }} /></span><span className="ct" style={{ fontSize: 11 }}>{s.won}/{s.open}/{s.lostSampled}</span></div>))}
          <div className="legend" style={{ justifyContent: 'flex-start' }}><span><i className="swatch" style={{ background: 'var(--pos)' }} /> Won</span><span><i className="swatch" style={{ background: 'var(--brand)' }} /> Open</span><span><i className="swatch" style={{ background: 'var(--neg)' }} /> Lost</span></div>
        </div>
      </div>
      <div className="note"><b>Scope.</b> This pipeline is the agency's own Caalano Systems HQ, pulled live via MCP. Per-client CRM (this client's own funnel) unlocks with an agency-level Caalano Systems token - the workspace is already built to swap it in.</div>
    </>
  )
}

/* ============ Live per-client CRM (Windsor Caalano Systems) ============ */
function CrmLive({ ghl, currency }) {
  const s = ghl.summary
  const srcMax = Math.max(1, ...ghl.sources.map((x) => x.won + x.open + x.lostSampled))
  const won = ghl.wonByMonth.map((w) => ({ ...w, label: w.month.slice(2) }))
  return (
    <>
      <div className="card"><div className="stat-hero">
        <div className="s"><div className="v">{s.open}</div><div className="l">Open opportunities</div></div>
        <div className="s"><div className="v">{s.won}</div><div className="l">Won</div></div>
        <div className="s"><div className="v">{fmtCurrency(s.wonValue, currency)}</div><div className="l">Won value (tracked)</div></div>
        <div className="s"><div className="v">{fmtPct(s.closedWinRatePct, 1)}</div><div className="l">Close rate</div></div>
        <div className="s"><div className="v">{s.lostTotal}</div><div className="l">Lost</div></div>
      </div></div>
      <div className="card insight" style={{ marginTop: 14 }}><span className="em">🔎</span><div><h4>Pipeline snapshot</h4><p>{ghl.biggestLeak}</p></div></div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Lead source performance</h3><p className="cap">Won / open / lost by source</p>
          {ghl.sources.map((x) => (<div className="bar-row" key={x.name} style={{ gridTemplateColumns: '150px 1fr 58px' }}><span className="nm">{x.name}</span><span className="bar-track" style={{ display: 'flex' }}><span style={{ width: `${(x.won / srcMax) * 100}%`, background: 'var(--pos)' }} /><span style={{ width: `${(x.open / srcMax) * 100}%`, background: 'var(--brand)' }} /><span style={{ width: `${(x.lostSampled / srcMax) * 100}%`, background: 'var(--neg)' }} /></span><span className="ct" style={{ fontSize: 11 }}>{x.won}/{x.open}/{x.lostSampled}</span></div>))}
          <div className="legend" style={{ justifyContent: 'flex-start' }}><span><i className="swatch" style={{ background: 'var(--pos)' }} /> Won</span><span><i className="swatch" style={{ background: 'var(--brand)' }} /> Open</span><span><i className="swatch" style={{ background: 'var(--neg)' }} /> Lost</span></div>
        </div>
        <div className="card chart-card"><h3>Wins over time</h3><p className="cap">Deals won per month</p>
          {won.length ? <ResponsiveContainer width="100%" height={210}><LineChart data={won} margin={{ left: -18, right: 10, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" stroke="var(--muted)" fontSize={11} /><YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="count" stroke="#6d5efc" strokeWidth={2.5} dot={{ r: 3, fill: '#6d5efc' }} /></LineChart></ResponsiveContainer> : <p className="cap">No wins recorded in range.</p>}
        </div>
      </div>
      <div className="note"><b>Live per-client CRM</b> from this client's own Caalano Systems via the Meta and Google API. Stage-by-stage funnel and lost-reason names come next (they need the pipeline stage + reason ID to name mapping).</div>
    </>
  )
}

/* ============ Meta deep ============ */
function ScDelta({ cur, prev, goodWhenDown }) {
  if (cur == null || prev == null) return null
  if (!prev) return <div className="sc-d flat">no prior data</div>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  const up = pct >= 0; const good = goodWhenDown ? !up : up
  return <div className={`sc-d ${good ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {fmtPct(Math.abs(pct))} <span className="sc-vs">vs prev</span></div>
}
function Sc({ label, value, cur, prev, goodWhenDown, kpi }) {
  return <div className="sc"><div className="sc-l">{label}</div><div className="sc-v">{value}</div><ScDelta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />{kpi && <div className={`sc-kpi ${kpi.cls}`}>{kpi.cls === 'good' ? '✓' : kpi.cls === 'bad' ? '✗' : '◎'} {kpi.text}</div>}</div>
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d) => `${parseInt(d.slice(8, 10), 10)} ${MON[parseInt(d.slice(5, 7), 10) - 1]}`
const cplColor = (v, avg) => { if (!avg) return 'transparent'; const r = v / avg; return r <= 0.85 ? 'rgba(23,178,106,.28)' : r <= 1.15 ? 'rgba(245,165,36,.28)' : 'rgba(240,67,91,.28)' }

function MetaDeep({ deep, currency, attr, clientId, range, nonce }) {
  const [pipe, setPipe] = useState('all')
  const pipeAttr = usePipelineAttr(clientId, range, nonce, pipe, attr)
  const pipeLoading = pipe !== 'all' && (!pipeAttr || pipeAttr.status === 'loading')
  // Full pipeline list for the picker comes from the account-wide attribution
  // (always present, even while a scoped fetch is loading).
  const allPipes = (attr && attr.data && attr.data.attribution && attr.data.attribution.allPipelines) || []
  const kpis = loadKpis(clientId, pipe !== 'all' ? pipe : undefined)
  const [sel, setSel] = useState(null)
  const [selAdset, setSelAdset] = useState(null) // drill into one ad set
  const [selCreative, setSelCreative] = useState(null) // drill into one creative
  const [selForm, setSelForm] = useState(null) // filter the tables to one CRM form's ads
  const [formSort, onFormSort] = useSort('adSpend')
  const formsSt = useForms(clientId, range, nonce)
  const [day, setDay] = useState(null)
  const [campSort, onCampSort] = useSort('spend')
  const [adsetSort, onAdsetSort] = useSort('spend')
  const [creSort, onCreSort] = useSort('spend')
  const [crePage, setCrePage] = useState(0)
  const [preview, setPreview] = useState(null) // { src, x, y } - hover thumbnail preview
  const scrollRootRef = React.useRef(null)
  useSyncedTableScroll(scrollRootRef)
  const showPrev = (src) => (e) => src && setPreview({ src, x: e.clientX, y: e.clientY })
  const movePrev = (e) => setPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))
  const hidePrev = () => setPreview(null)
  useEffect(() => { setCrePage(0) }, [sel])
  if (!deep?.meta) return <EmptyDeep channel="Meta Ads" />
  const m = deep.meta
  const A = pipeAttr && pipeAttr.data && pipeAttr.data.attribution
  const has360 = !!A
  const keList = keyEventsForPipe(loadKeyEvents(clientId), pipe)
  // Green Caalano360 columns: the client's key events (cost per each) when
  // configured, else the legacy Booked/Shown/Won block. Ordered by where each
  // event sits in the pipeline (calendars via their linked stage).
  const stagePos = stagePosMap(A && A.channels && A.channels.all ? A.channels.all.pipelines : [])
  const calNames = new Map(((A && A.appointments && A.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = buildO360Cols(keList, stagePos, calNames)
  const oCamp = mkOutcomeMap(A && A.byCampaign)
  // Ad sets are tagged in the CRM as utm_medium (e.g. "CDas_06_Broad_National"),
  // not utm_term - so match ad-set rows against byMedium.
  const oAdset = mkOutcomeMap(A && A.byMedium)
  const oCre = mkOutcomeMap(A && A.byCreative)
  // Account totals - the fixed baseline for creative "vs account average" colour
  // coding, regardless of any drill-in.
  const acct = m.totals || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, reach: 0 }
  // When a campaign is filtered, the top scorecard + Caalano360 tiles recompute
  // for that campaign; otherwise they show the whole account.
  const selCamp = sel ? (m.campaigns.find((c) => c.name === sel) || null) : null
  // Form filter: match a CRM form's ad UTMs (campaign / ad set / creative names)
  // to the Meta rows so clicking a form drills the whole tab into its ads.
  const uSet = (arr) => new Set((arr || []).map(unorm))
  const forms = (formsSt.status === 'ok' && formsSt.data && formsSt.data.forms) || []
  const selFormRow = selForm ? forms.find((f) => f.form === selForm) : null
  const fCre = selFormRow ? uSet(selFormRow.creatives) : null
  const fAdset = selFormRow ? uSet(selFormRow.adsets) : null
  const fCamp = selFormRow ? uSet(selFormRow.campaigns) : null
  const formAds = fCre ? m.ads.filter((a) => fCre.has(unorm(a.name))) : null
  const formT = formAds ? formAds.reduce((s, a) => ({ spend: s.spend + a.spend, impressions: s.impressions + a.impressions, clicks: s.clicks + a.clicks, linkClicks: s.linkClicks + a.linkClicks, leads: s.leads + a.leads, reach: 0 }), { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, reach: 0 }) : null
  // Drill-down: every level is clickable and filters the levels below it (and the
  // forms table). Picking a deeper level sets its parents for context.
  const pickCampaign = (name) => { setSelForm(null); setSelAdset(null); setSelCreative(null); setSel(sel === name ? null : name) }
  const pickAdset = (a) => { setSelForm(null); setSelCreative(null); if (selAdset === a.name) setSelAdset(null); else { if (a.campaign) setSel(a.campaign); setSelAdset(a.name) } }
  const pickCreative = (a) => { setSelForm(null); if (selCreative === a.name) setSelCreative(null); else { if (a.campaign) setSel(a.campaign); if (a.adset) setSelAdset(a.adset); setSelCreative(a.name) } }
  const pickForm = (name) => { setSel(null); setSelAdset(null); setSelCreative(null); setSelForm(selForm === name ? null : name) }
  const clearDrill = () => { setSel(null); setSelAdset(null); setSelCreative(null); setSelForm(null) }
  // The creative currently drilled into, plus its campaign / ad set / form lineage.
  const selCreAd = selCreative ? m.ads.find((a) => a.name === selCreative) : null
  const selCreForm = selCreative ? forms.find((f) => uSet(f.creatives).has(unorm(selCreative))) : null
  // Per-form ad performance: match each form's creatives to Meta ad spend, then
  // pair it with the form's CRM funnel (leads → booked → won).
  const formPerf = forms
    .filter((f) => f.kind === 'facebook' || (f.creatives && f.creatives.length))
    .map((f) => {
      const cre = uSet(f.creatives)
      const ads = m.ads.filter((a) => cre.has(unorm(a.name)))
      const adSpend = ads.reduce((s, a) => s + a.spend, 0), impr = ads.reduce((s, a) => s + a.impressions, 0), lc = ads.reduce((s, a) => s + a.linkClicks, 0), metaLeads = ads.reduce((s, a) => s + a.leads, 0)
      const adsetSet = new Set(ads.map((a) => a.adset).filter(Boolean)); const campSet = new Set(ads.map((a) => a.campaign).filter(Boolean))
      return { ...f, adSpend, impr, metaLeads, cvr: lc ? (metaLeads / lc) * 100 : null, cpl: f.leads ? adSpend / f.leads : null, cBooked: f.booked ? adSpend / f.booked : null, cWon: f.won ? adSpend / f.won : null, roas: adSpend ? f.revenue / adSpend : null, _adsets: adsetSet, _camps: campSet }
    })
  // Forms drill: when a campaign / ad set / creative is selected, show only the
  // forms whose ads belong to it (so "click campaign" also filters the forms).
  const formInSel = (f) => {
    if (selCreative) return uSet(f.creatives).has(unorm(selCreative))
    if (selAdset) return f._adsets.has(selAdset)
    if (sel) return f._camps.has(sel)
    return true
  }
  const formPerfShown = sortRows(formPerf.filter(formInSel), formSort)
  const t = formT
    ? formT
    : selCamp
      ? { spend: selCamp.spend, impressions: selCamp.impressions, clicks: selCamp.clicks, linkClicks: selCamp.linkClicks, leads: selCamp.leads, reach: selCamp.reach || 0 }
      : acct
  // Caalano360 outcomes: the selected campaign's UTM-matched row, or every
  // campaign summed (each opp lands in exactly one utm_campaign bucket).
  const selOc = selCamp ? oCamp.get(unorm(sel)) : null
  const crmTot = A
    ? (selCamp
      ? { booked: selOc ? selOc.booked : 0, shown: selOc ? selOc.shown : 0, won: selOc ? selOc.won : 0, revenue: selOc ? selOc.revenue : 0, cancelled: selOc ? (selOc.cancelled || 0) : 0 }
      : (A.byCampaign || []).reduce((a, x) => ({ booked: a.booked + x.booked, shown: a.shown + x.shown, won: a.won + x.won, revenue: a.revenue + x.revenue, cancelled: a.cancelled + (x.cancelled || 0) }), { booked: 0, shown: 0, won: 0, revenue: 0, cancelled: 0 }))
    : null
  const cpm = t.impressions ? t.spend / t.impressions * 1000 : 0
  const cpl = t.leads ? t.spend / t.leads : 0
  const cpcLink = t.linkClicks ? t.spend / t.linkClicks : 0
  // Previous period: whole account, or the selected campaign's own prior-period
  // totals when filtered, so the vs-prev deltas keep working on a drill-in.
  const pv = sel ? (selCamp && selCamp.prev ? selCamp.prev : null) : (m.prev || null)
  const D = (fn) => (pv ? fn(pv) : null) // previous-period value or null
  // Daily series. When a campaign is selected, rebuild it from the ad-level
  // daily breakdown filtered to that campaign, so the daily trend reconciles
  // with the campaign / ad-set / creative tables (all from the same ad-level
  // pull) instead of showing the account-wide date breakdown, which Meta
  // returns with different totals.
  const dailySrc = (sel && Array.isArray(m.adDaily)) ? (() => {
    const dm = new Map()
    for (const r of m.adDaily) {
      if (r.campaign !== sel) continue
      const e = dm.get(r.date) || { date: r.date, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 }
      e.spend += r.spend; e.impressions += r.impressions; e.clicks += r.clicks; e.linkClicks += r.linkClicks; e.leads += r.leads
      dm.set(r.date, e)
    }
    return [...dm.values()].sort((a, b) => a.date.localeCompare(b.date))
  })() : (m.daily || [])
  const daily = dailySrc.map((d) => ({ ...d, label: dayLabel(d.date), cpl: d.leads ? d.spend / d.leads : 0, cpm: d.impressions ? d.spend / d.impressions * 1000 : 0, ctr: d.impressions ? d.clicks / d.impressions * 100 : 0, cpc: d.clicks ? d.spend / d.clicks : 0 }))
  const adsets = (sel ? m.adsets.filter((a) => a.campaign === sel) : m.adsets).filter((a) => !fAdset || fAdset.has(unorm(a.name)))
  const adsFull = (sel ? m.ads.filter((a) => a.campaign === sel) : m.ads).filter((a) => (!selAdset || a.adset === selAdset) && (!fCre || fCre.has(unorm(a.name))))
  const CRE_PAGE = 15
  const creTotalPages = Math.max(1, Math.ceil(adsFull.length / CRE_PAGE))
  const crePageC = Math.min(crePage, creTotalPages - 1)
  const ads = adsFull.slice(crePageC * CRE_PAGE, crePageC * CRE_PAGE + CRE_PAGE)
  // account averages for creative colour-coding (higher = better, except CPL)
  const avgLinkCtr = rate(acct.linkClicks, acct.impressions)
  const avgCvr = rate(acct.leads, acct.linkClicks)
  const vidA = adsFull.filter((a) => a.type === 'Video')
  const avgHook = vidA.length ? rate(vidA.reduce((s, a) => s + a.videoViews, 0), vidA.reduce((s, a) => s + a.impressions, 0)) : 0
  const gb = (v, avg) => (avg ? (v >= avg ? 'good' : 'bad') : '')
  const formats = ['Video', 'Image'].map((type) => {
    const rs = adsFull.filter((a) => a.type === type); if (!rs.length) return null
    const s = rs.reduce((a, x) => ({ spend: a.spend + x.spend, impressions: a.impressions + x.impressions, linkClicks: a.linkClicks + x.linkClicks, leads: a.leads + x.leads, videoViews: a.videoViews + x.videoViews }), { spend: 0, impressions: 0, linkClicks: 0, leads: 0, videoViews: 0 })
    // Roll up Caalano360 outcomes from this format's UTM-matched creatives (utm_content).
    let oc = null
    for (const x of rs) {
      const o = oCre.get(unorm(x.name)); if (!o) continue
      oc = oc || { booked: 0, shown: 0, shownStage: 0, cancelled: 0, won: 0, revenue: 0, cals: {}, stages: {} }
      oc.booked += o.booked; oc.shown += o.shown; oc.shownStage += o.shownStage || 0; oc.cancelled += o.cancelled || 0; oc.won += o.won; oc.revenue += o.revenue
      if (o.cals) for (const k in o.cals) oc.cals[k] = (oc.cals[k] || 0) + o.cals[k]
      if (o.stages) for (const k in o.stages) oc.stages[k] = (oc.stages[k] || 0) + o.stages[k]
    }
    return { type, count: rs.length, ...s, ...o360Fields(oc, s.spend, s.leads, o360cols) }
  }).filter(Boolean)
  // Key events for the Meta channel: the client's configured pipeline stages +
  // booked calendars, scored against Meta-attributed CRM data and Meta spend.
  // Always account-level (independent of the campaign drill) so cost per event
  // divides the whole Meta spend by the Meta-attributed count.
  const meCh = A && A.channels && A.channels.meta
  const meRows = (() => {
    const rmap = reachedByStage(meCh ? (meCh.pipelines || []) : [])
    const cfg = keyEventRows(keList, rmap, calCountMap(A, 'meta'), stagePos, meCh ? meCh.totals.won : 0)
    if (cfg.length) return cfg
    if (!meCh) return []
    const tt = meCh.totals
    return [{ label: 'Leads', count: tt.leads, kind: 'stage' }, { label: 'Bookings', count: tt.booked, kind: 'stage' }, { label: 'Shown', count: tt.shown, kind: 'stage' }, { label: 'Won', count: tt.won, kind: 'stage' }]
  })()
  const meTotal = Math.max(1, meCh ? meCh.totals.leads : 0)
  return (
    <div ref={scrollRootRef}>
      <AttrDiag attr={attr} />
      {allPipes.length > 1 && <div className="pipe-filter-bar"><PipelineFilter pipelines={allPipes} value={pipe} onChange={setPipe} loading={pipeLoading} />{pipe !== 'all' && <span className="pipe-filter-note">Caalano360 green columns, key events &amp; funnel are scoped to this pipeline · ad spend is unchanged</span>}</div>}
      {(sel || selAdset || selCreative || selForm) && (
        <div className="drill-bar">
          <span className="drill-lab">Drilled into</span>
          {sel && <span className="drill-chip">📣 Campaign: <b>{sel}</b><button onClick={() => pickCampaign(sel)} aria-label="clear">✕</button></span>}
          {selAdset && <span className="drill-chip">📦 Ad set: <b>{selAdset}</b><button onClick={() => setSelAdset(null)} aria-label="clear">✕</button></span>}
          {selCreative && <span className="drill-chip">🎨 Creative: <b>{selCreative}</b>{selCreAd?.adset ? <> · ad set <b>{selCreAd.adset}</b></> : null}{selCreForm ? <> · form <b>{selCreForm.form}</b></> : ' · no form matched'}<button onClick={() => setSelCreative(null)} aria-label="clear">✕</button></span>}
          {selForm && <span className="drill-chip">📝 Form: <b>{selForm}</b> · showing only the ads that drove it<button onClick={() => setSelForm(null)} aria-label="clear">✕</button></span>}
          <button className="drill-clear" onClick={clearDrill}>Clear all</button>
        </div>
      )}
      <div className="scorecard">
        <Sc label="Cost" value={fmtCurrency(t.spend, currency)} cur={t.spend} prev={D((x) => x.spend)} goodWhenDown />
        <Sc label="Impressions" value={fmtNumber(t.impressions)} cur={t.impressions} prev={D((x) => x.impressions)} />
        <Sc label="Reach" value={fmtNumber(t.reach)} cur={t.reach} prev={D((x) => x.reach)} />
        <Sc label="Frequency" value={t.reach ? (t.impressions / t.reach).toFixed(2) : '-'} cur={t.reach ? t.impressions / t.reach : null} prev={D((x) => x.reach ? x.impressions / x.reach : null)} goodWhenDown />
        <Sc label="CPM" value={fmtCurrency(cpm, currency)} cur={cpm} prev={D((x) => x.impressions ? x.spend / x.impressions * 1000 : 0)} goodWhenDown />
        <Sc label="Link Clicks" value={fmtNumber(t.linkClicks)} cur={t.linkClicks} prev={D((x) => x.linkClicks)} />
        <Sc label="CPC (Link)" value={fmtCurrency(cpcLink, currency)} cur={cpcLink} prev={D((x) => x.linkClicks ? x.spend / x.linkClicks : 0)} goodWhenDown />
        <Sc label="CTR (All)" value={fmtPct(rate(t.clicks, t.impressions), 2)} cur={rate(t.clicks, t.impressions)} prev={D((x) => rate(x.clicks, x.impressions))} />
        <Sc label="Link CTR" value={fmtPct(rate(t.linkClicks, t.impressions), 2)} cur={rate(t.linkClicks, t.impressions)} prev={D((x) => rate(x.linkClicks, x.impressions))} />
        {(() => {
          const bd = t.resultBreakdown || []
          const tRes = bd.length ? t.results : t.leads
          const tCpr = bd.length && t.costPerResult != null ? t.costPerResult : cpl
          const resLabel = bd.length === 1 ? bd[0].label : bd.length > 1 ? 'Results' : 'Leads'
          const bdTip = bd.length ? bd.map((x) => `${x.label}: ${fmtNumber(x.count)}`).join(' · ') : null
          return <>
            <Sc label={resLabel} value={<span title={bdTip || undefined}>{fmtNumber(tRes)}{bd.length > 1 ? <span className="res-ty" title={bdTip}>mixed</span> : null}</span>} cur={tRes} prev={bd.length ? null : D((x) => x.leads)} />
            <Sc label="Cost / result" value={fmtCurrency(tCpr, currency)} cur={tCpr} prev={bd.length ? null : D((x) => x.leads ? x.spend / x.leads : 0)} goodWhenDown kpi={kpis.metaCpl ? { text: `Target ${fmtCurrency(kpis.metaCpl, currency)}`, cls: kpiClass(tCpr, kpis.metaCpl, true) } : null} />
            <Sc label="CVR" value={fmtPct(rate(tRes, t.linkClicks), 2)} cur={rate(tRes, t.linkClicks)} prev={bd.length ? null : D((x) => rate(x.leads, x.linkClicks))} />
          </>
        })()}
        {crmTot && <Sc label="Scheduled Appts" value={<>{fmtNumber(crmTot.booked)}{crmTot.cancelled ? <span className="c360-canc" title={`${crmTot.cancelled} later cancelled`}> ({crmTot.cancelled}c)</span> : null}</>} />}
        {crmTot && <Sc label="Cost / Appt" value={crmTot.booked ? fmtCurrency(t.spend / crmTot.booked, currency) : '-'} />}
      </div>
      <div className="meta-split">
        {daily.length > 0 && <div className="card chart-card meta-split-col">
          <h3>Daily trend</h3><p className="cap">Spend, Leads and CPL by day{sel ? ` · ${sel}` : ' · whole account'}</p>
          <div className="meta-chart-fill">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ left: -8, right: 6, top: 6 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" />
              <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => '$' + fmtCompact(v)} />
              <Tooltip formatter={(v, n) => (n === 'Leads' ? fmtNumber(v) : fmtCurrency(v, currency))} />
              <Legend />
              <Bar yAxisId="l" dataKey="leads" name="Leads" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line yAxisId="r" dataKey="spend" name="Spend" stroke="#4f7cff" strokeWidth={2} dot={false} />
              <Line yAxisId="r" dataKey="cpl" name="CPL" stroke="#ec4899" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>}
        {has360 && meRows.some((r) => r.count > 0) && <KeyEventsFunnel
          rows={meRows} total={meTotal} spend={m.totals ? m.totals.spend : 0} currency={currency}
          title="Key events · Meta" style={{ marginTop: 0 }} className="meta-split-col"
          sub="Meta-attributed leads through your key pipeline stages and booked calendars · cost per event = whole Meta spend ÷ count · account level"
          caveat={<>📅 = a booked calendar appointment (cost per booked call). Counts are opportunities the CRM attributes to Meta; cost per event divides the full Meta spend, so it stays account-level even when you filter a campaign above. Configure which stages and calendars count in Settings → Key events.</>}
        />}
      </div>
      <div className="lvl-title">Campaigns <span className="sub">· {m.campaigns.length}{sel ? ` · filtered to "${sel}" (click to clear)` : ' · click a row to drill in'}{has360 ? ' · green = Caalano360 outcomes (UTM-matched) · Booked counts on the day the call was booked; (Nc) = later cancelled, (Np) = shown via pipeline stage · Book% = booked/leads, Show% = shown/booked, Win% = won/leads' : ''}</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={8} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={8} cols={o360cols} />}<tr><SortTh k="name" sort={campSort} on={onCampSort}>Campaign</SortTh><SortTh k="spend" sort={campSort} on={onCampSort}>Spend</SortTh><SortTh k="impressions" sort={campSort} on={onCampSort}>Impr.</SortTh><SortTh k="linkCtr" sort={campSort} on={onCampSort}>Link CTR</SortTh><SortTh k="hook" sort={campSort} on={onCampSort}>Hook</SortTh><SortTh k="results" sort={campSort} on={onCampSort}>Results</SortTh><SortTh k="cvr" sort={campSort} on={onCampSort}>CVR</SortTh><SortTh k="cpr" sort={campSort} on={onCampSort}>Cost/result</SortTh>{has360 && <O360Head sort={campSort} on={onCampSort} cols={o360cols} />}</tr></thead>
        <tbody>{sortRows(m.campaigns.filter((c) => !fCamp || fCamp.has(unorm(c.name))).map((c) => ({ ...c, linkCtr: rate(c.linkClicks, c.impressions), hook: c.videoViews ? rate(c.videoViews, c.impressions) : null, results: c.results != null ? c.results : c.leads, resType: c.resultType, cvr: rate(c.results != null ? c.results : c.leads, c.linkClicks), cpr: c.costPerResult != null ? c.costPerResult : (c.leads ? c.spend / c.leads : null), ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, o360cols) })), campSort).map((c) => (<tr key={c.name} className={sel === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCampaign(c.name)}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td className={gb(c.linkCtr, avgLinkCtr)}>{fmtPct(c.linkCtr, 2)}</td><td className={c.hook != null ? gb(c.hook, avgHook) : ''}>{c.hook != null ? fmtPct(c.hook, 1) : '-'}</td><td className="res-cell" title={c.breakdown && c.breakdown.length ? `All conversion actions (primary shown = ${c.resType}):\n` + c.breakdown.map((b) => `• ${b.label}: ${fmtNumber(b.count)}`).join('\n') : undefined}>{fmtNumber(c.results)}{c.resType ? <span className="res-ty">{c.resType}</span> : null}{c.breakdown && c.breakdown.length > 1 ? <span className="res-more">+{c.breakdown.length - 1}</span> : null}</td><td className={c.results ? gb(c.cvr, avgCvr) : ''}>{c.results ? fmtPct(c.cvr, 1) : '-'}</td><td className={c.cpr != null ? (c.cpr <= cpl ? 'good' : 'bad') : ''}>{c.cpr != null ? fmtCurrency(c.cpr, currency) : '-'}</td>{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Ad sets <span className="sub">· {adsets.length}{sel ? ` in "${sel}"` : ''} · click a row to drill into its creatives &amp; forms</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={8} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={8} cols={o360cols} />}<tr><SortTh k="name" sort={adsetSort} on={onAdsetSort}>Ad set</SortTh><SortTh k="spend" sort={adsetSort} on={onAdsetSort}>Spend</SortTh><SortTh k="impressions" sort={adsetSort} on={onAdsetSort}>Impr.</SortTh><SortTh k="linkCtr" sort={adsetSort} on={onAdsetSort}>Link CTR</SortTh><SortTh k="hook" sort={adsetSort} on={onAdsetSort}>Hook</SortTh><SortTh k="results" sort={adsetSort} on={onAdsetSort}>Results</SortTh><SortTh k="cvr" sort={adsetSort} on={onAdsetSort}>CVR</SortTh><SortTh k="cpr" sort={adsetSort} on={onAdsetSort}>Cost/result</SortTh>{has360 && <O360Head sort={adsetSort} on={onAdsetSort} cols={o360cols} />}</tr></thead>
        <tbody>{sortRows(adsets.map((c) => ({ ...c, linkCtr: rate(c.linkClicks, c.impressions), hook: c.videoViews ? rate(c.videoViews, c.impressions) : null, results: c.results != null ? c.results : c.leads, resType: c.resultType, cvr: rate(c.results != null ? c.results : c.leads, c.linkClicks), cpr: c.costPerResult != null ? c.costPerResult : (c.leads ? c.spend / c.leads : null), ...o360Fields(oAdset.get(unorm(c.name)), c.spend, c.leads, o360cols) })), adsetSort).map((c) => (<tr key={c.name} className={selAdset === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickAdset(c)}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td className={gb(c.linkCtr, avgLinkCtr)}>{fmtPct(c.linkCtr, 2)}</td><td className={c.hook != null ? gb(c.hook, avgHook) : ''}>{c.hook != null ? fmtPct(c.hook, 1) : '-'}</td><td className="res-cell" title={c.breakdown && c.breakdown.length ? `All conversion actions (primary shown = ${c.resType}):\n` + c.breakdown.map((b) => `• ${b.label}: ${fmtNumber(b.count)}`).join('\n') : undefined}>{fmtNumber(c.results)}{c.resType ? <span className="res-ty">{c.resType}</span> : null}{c.breakdown && c.breakdown.length > 1 ? <span className="res-more">+{c.breakdown.length - 1}</span> : null}</td><td className={c.results ? gb(c.cvr, avgCvr) : ''}>{c.results ? fmtPct(c.cvr, 1) : '-'}</td><td className={c.cpr != null ? (c.cpr <= cpl ? 'good' : 'bad') : ''}>{c.cpr != null ? fmtCurrency(c.cpr, currency) : '-'}</td>{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
      {formats.length > 0 && <>
        <div className="lvl-title">Performance by format <span className="sub">· image vs video</span></div>
        <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={9} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={9} cols={o360cols} />}<tr><th>Format</th><th>Ads</th><th>Spend</th><th>Impr.</th><th>Link CTR</th><th>Hook</th><th>Leads</th><th>CVR</th><th>CPL</th>{has360 && <O360Head cols={o360cols} />}</tr></thead>
          <tbody>{formats.map((f) => (<tr key={f.type}><td>{f.type}</td><td>{fmtNumber(f.count)}</td><td>{fmtCurrency(f.spend, currency)}</td><td>{fmtNumber(f.impressions)}</td><td>{fmtPct(rate(f.linkClicks, f.impressions), 2)}</td><td>{f.type === 'Video' ? fmtPct(rate(f.videoViews, f.impressions), 1) : '-'}</td><td>{fmtNumber(f.leads)}</td><td>{f.leads ? fmtPct(rate(f.leads, f.linkClicks), 1) : '-'}</td><td>{f.leads ? fmtCurrency(f.spend / f.leads, currency) : '-'}</td>{has360 && o360Cells(f, currency, o360cols)}</tr>))}</tbody></table></div>
      </>}
      {formPerf.length > 0 && <>
        <div className="lvl-title">Performance by form <span className="sub">· {formPerfShown.length}{formPerfShown.length !== formPerf.length ? ` of ${formPerf.length}` : ''} form{formPerfShown.length === 1 ? '' : 's'}{sel || selAdset || selCreative ? ' · filtered to the drill-in above' : ''} · click a form to drill the tab into its ads</span></div>
        {formPerfShown.length === 0 ? <div className="card" style={{ padding: 14 }}><p className="cap" style={{ margin: 0 }}>No forms received leads from this {selCreative ? 'creative' : selAdset ? 'ad set' : 'campaign'}.</p></div> : <div className="table-wrap"><table>
          <thead><tr><SortTh k="form" sort={formSort} on={onFormSort}>Form</SortTh><SortTh k="adSpend" sort={formSort} on={onFormSort}>Spend</SortTh><SortTh k="impr" sort={formSort} on={onFormSort}>Impr.</SortTh><SortTh k="leads" sort={formSort} on={onFormSort}>Leads</SortTh><SortTh k="cvr" sort={formSort} on={onFormSort}>CVR</SortTh><SortTh k="cpl" sort={formSort} on={onFormSort}>CPL</SortTh><SortTh k="booked" sort={formSort} on={onFormSort}>Booked</SortTh><SortTh k="cBooked" sort={formSort} on={onFormSort}>Cost / Book</SortTh><SortTh k="shown" sort={formSort} on={onFormSort}>Shown</SortTh><SortTh k="won" sort={formSort} on={onFormSort}>Won</SortTh><SortTh k="cWon" sort={formSort} on={onFormSort}>Cost / Won</SortTh><SortTh k="revenue" sort={formSort} on={onFormSort}>Revenue</SortTh><SortTh k="roas" sort={formSort} on={onFormSort}>ROAS</SortTh></tr></thead>
          <tbody>{formPerfShown.map((f) => (
            <tr key={f.form} className={selForm === f.form ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickForm(f.form)}>
              <td title={f.form}><span className="form-kind">{f.kind === 'facebook' ? '📱' : f.kind === 'website' ? '🌐' : '📄'}</span> {f.form}</td>
              <td className="num">{fmtCurrency(f.adSpend, currency)}</td>
              <td className="num">{fmtNumber(f.impr)}</td>
              <td className="num">{fmtNumber(f.leads)}</td>
              <td className="num">{f.cvr != null ? fmtPct(f.cvr, 1) : '-'}</td>
              <td className="num">{f.cpl != null ? fmtCurrency(f.cpl, currency) : '-'}</td>
              <td className="num">{fmtNumber(f.booked)}</td>
              <td className="num">{f.cBooked != null ? fmtCurrency(f.cBooked, currency) : '-'}</td>
              <td className="num">{fmtNumber(f.shown)}</td>
              <td className="num">{fmtNumber(f.won)}</td>
              <td className="num">{f.cWon != null ? fmtCurrency(f.cWon, currency) : '-'}</td>
              <td className="num">{fmtCurrency(f.revenue, currency)}</td>
              <td className="num">{f.roas != null ? `${f.roas.toFixed(2)}×` : '-'}</td>
            </tr>
          ))}</tbody>
        </table></div>}
        <p className="caveat">Spend / Impr. / CVR come from the Meta ads whose creative matches this form's submissions (utm_content); Leads / Booked / Shown / Won / Revenue are the CRM outcomes for leads that came through the form. CPL = spend ÷ CRM leads. Click a form to filter the campaigns, ad sets and creatives above to just the ads that drove it, or click a campaign / ad set / creative to filter this table to the forms it drove.</p>
      </>}
      <div className="lvl-title">Creatives <span className="sub">· {adsFull.length}{sel ? ` in "${sel}"` : ''} · table + visuals · green/red vs account average</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={9} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={9} cols={o360cols} />}<tr>
        <SortTh k="name" sort={creSort} on={onCreSort}>Creative</SortTh><SortTh k="type" sort={creSort} on={onCreSort}>Type</SortTh><SortTh k="spend" sort={creSort} on={onCreSort}>Spend</SortTh><SortTh k="impressions" sort={creSort} on={onCreSort}>Impr.</SortTh><SortTh k="linkCtr" sort={creSort} on={onCreSort}>Link CTR</SortTh><SortTh k="hook" sort={creSort} on={onCreSort}>Hook</SortTh><SortTh k="leads" sort={creSort} on={onCreSort}>Leads</SortTh><SortTh k="cvr" sort={creSort} on={onCreSort}>CVR</SortTh><SortTh k="cpl" sort={creSort} on={onCreSort}>CPL</SortTh>{has360 && <O360Head sort={creSort} on={onCreSort} cols={o360cols} />}</tr></thead>
        <tbody>{sortRows(adsFull.map((a) => ({ ...a, linkCtr: rate(a.linkClicks, a.impressions), hook: a.type === 'Video' ? rate(a.videoViews, a.impressions) : null, cvr: rate(a.leads, a.linkClicks), cpl: a.leads ? a.spend / a.leads : null, ...o360Fields(oCre.get(unorm(a.name)), a.spend, a.leads, o360cols) })), creSort).map((a) => (<tr key={a.name} className={selCreative === a.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCreative(a)}>
          <td title={a.name}><div className="cre-cell">{a.thumb ? <img className="cre-th" src={a.thumb} alt="" loading="lazy" onMouseEnter={showPrev(a.thumb)} onMouseMove={movePrev} onMouseLeave={hidePrev} onError={(e) => { e.target.style.display = 'none' }} /> : <span className="cre-th cre-th-none" />}<span className="cre-cell-nm">{a.name}</span></div></td><td>{a.type}</td><td>{fmtCurrency(a.spend, currency)}</td><td>{fmtNumber(a.impressions)}</td>
          <td className={gb(a.linkCtr, avgLinkCtr)}>{fmtPct(a.linkCtr, 2)}</td><td className={a.hook != null ? gb(a.hook, avgHook) : ''}>{a.hook != null ? fmtPct(a.hook, 1) : '-'}</td>
          <td>{fmtNumber(a.leads)}</td><td className={a.leads ? gb(a.cvr, avgCvr) : ''}>{a.leads ? fmtPct(a.cvr, 1) : '-'}</td>
          <td className={a.cpl != null ? (a.cpl <= cpl ? 'good' : 'bad') : ''}>{a.cpl != null ? fmtCurrency(a.cpl, currency) : '-'}</td>
          {has360 && o360Cells(a, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="cre-sub"><span>Visual previews</span><small>hover a thumbnail in the table above to enlarge, or browse the cards below</small></div>
      <div className="cre-grid">{ads.map((a) => {
        const acpl = a.leads ? a.spend / a.leads : 0
        const hook = a.type === 'Video' ? rate(a.videoViews, a.impressions) : null
        const lctr = rate(a.linkClicks, a.impressions), cvr = rate(a.leads, a.linkClicks)
        return (
          <div className="cre" key={a.name}>
            <div className="thumb"><span className="type">{a.type}</span>{a.igUrl && <a className="cre-play" href={a.igUrl} target="_blank" rel="noreferrer" title="View on Instagram">↗</a>}<img src={a.thumb} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} /></div>
            <div className="body">
              <div className="nm" title={a.name}>{a.name}</div>
              <div className="stats">
                <div className="st"><div className="l">Spend</div><div className="v">{fmtCurrency(a.spend, currency)}</div></div>
                <div className="st"><div className="l">Leads</div><div className="v">{fmtNumber(a.leads)}</div></div>
                <div className="st"><div className="l">CPL</div><div className={`v ${a.leads ? (acpl <= cpl ? 'good' : 'bad') : ''}`}>{a.leads ? fmtCurrency(acpl, currency) : '-'}</div></div>
                <div className="st"><div className="l">Link CTR</div><div className={`v ${gb(lctr, avgLinkCtr)}`}>{fmtPct(lctr, 2)}</div></div>
                <div className="st"><div className="l">CVR</div><div className={`v ${a.leads ? gb(cvr, avgCvr) : ''}`}>{fmtPct(cvr, 1)}</div></div>
                <div className="st"><div className="l">{hook != null ? 'Hook rate' : ''}</div><div className={`v ${hook != null ? gb(hook, avgHook) : ''}`}>{hook != null ? fmtPct(hook, 1) : ''}</div></div>
              </div>
              {has360 && (() => {
                const o = oCre.get(unorm(a.name)); if (!o) return null
                const roas = a.spend ? o.revenue / a.spend : 0
                return <div className="cre-360">
                  <div className="c360-tag">Caalano360</div>
                  <div className="stats">
                    <div className="st"><div className="l">Booked</div><div className="v">{fmtNumber(o.booked)}{o.cancelled ? <span className="c360-canc" title={`${o.cancelled} later cancelled`}> ({o.cancelled}c)</span> : null}</div></div>
                    <div className="st"><div className="l">C/Book</div><div className="v">{o.booked ? fmtCurrency(a.spend / o.booked, currency) : '-'}</div></div>
                    <div className="st"><div className="l">Shown</div><div className="v">{fmtNumber(o.shown)}{o.shownStage ? <span className="c360-infer" title={`${o.shownStage} from pipeline stage`}> ({o.shownStage}p)</span> : null}</div></div>
                    <div className="st"><div className="l">Won</div><div className="v">{fmtNumber(o.won)}</div></div>
                    <div className="st"><div className="l">C/Won</div><div className="v">{o.won ? fmtCurrency(a.spend / o.won, currency) : '-'}</div></div>
                    <div className="st"><div className="l">Won val</div><div className="v">{fmtCurrency(o.revenue, currency)}</div></div>
                    <div className="st"><div className="l">ROAS</div><div className="v">{a.spend ? `${roas.toFixed(2)}×` : '-'}</div></div>
                  </div>
                </div>
              })()}
            </div>
          </div>
        )
      })}</div>
      {creTotalPages > 1 && <div className="pager">
        <button className="pg-btn" disabled={crePageC === 0} onClick={() => setCrePage(crePageC - 1)}>‹ Prev</button>
        <span className="pg-info">Page {crePageC + 1} of {creTotalPages} · {adsFull.length} creatives</span>
        <button className="pg-btn" disabled={crePageC >= creTotalPages - 1} onClick={() => setCrePage(crePageC + 1)}>Next ›</button>
      </div>}
      <div className="lvl-title">Day by day <span className="sub">· {daily.length} days · newest first{m.adDaily ? ' · click a day to break it down' : ''}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Day</th><th>Spend</th><th>CPM</th><th>CTR</th><th>CPC</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>{[...daily].reverse().map((d) => (<tr key={d.date} className={day === d.date ? 'row-sel' : ''} style={{ cursor: m.adDaily ? 'pointer' : 'default' }} onClick={() => m.adDaily && setDay(day === d.date ? null : d.date)}><td>{d.label}</td><td>{fmtCurrency(d.spend, currency)}</td><td>{fmtCurrency(d.cpm, currency)}</td><td>{fmtPct(d.ctr, 2)}</td><td>{fmtCurrency(d.cpc, currency)}</td><td>{fmtNumber(d.leads)}</td><td>{d.leads ? <span className="cpl-cell" style={{ background: cplColor(d.cpl, cpl) }}>{fmtCurrency(d.cpl, currency)}</span> : '-'}</td></tr>))}</tbody></table></div>
      {day && (() => {
        const rows = (m.adDaily || []).filter((r) => r.date === day)
        const agg = (keyFn) => { const map = new Map(); for (const r of rows) { const k = keyFn(r); if (!k) continue; const e = map.get(k) || { name: k, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 }; e.spend += r.spend; e.impressions += r.impressions; e.clicks += r.clicks; e.linkClicks += r.linkClicks; e.leads += r.leads; map.set(k, e) } return [...map.values()].sort((a, b) => b.spend - a.spend) }
        const camps = agg((r) => r.campaign), creatives = agg((r) => r.ad)
        return (
          <div className="day-drill">
            <div className="lvl-title">Breakdown for {dayLabel(day)} <span className="sub">· {camps.length} campaigns · {creatives.length} creatives · click the day again to close</span></div>
            <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead>
              <tbody>{camps.map((c) => (<tr key={c.name}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td>{fmtPct(rate(c.clicks, c.impressions), 2)}</td><td>{fmtNumber(c.leads)}</td><td>{c.leads ? fmtCurrency(c.spend / c.leads, currency) : '-'}</td></tr>))}</tbody></table></div>
            <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Creative</th><th>Spend</th><th>Impr.</th><th>Link CTR</th><th>Leads</th><th>CPL</th></tr></thead>
              <tbody>{creatives.slice(0, 40).map((c) => (<tr key={c.name}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td>{fmtPct(rate(c.linkClicks, c.impressions), 2)}</td><td>{fmtNumber(c.leads)}</td><td>{c.leads ? fmtCurrency(c.spend / c.leads, currency) : '-'}</td></tr>))}</tbody></table></div>
          </div>
        )
      })()}
      <p className="caveat">Creative thumbnails from the Meta and Google API (Meta CDN), refreshed each pull. Hook rate = 3-second plays ÷ impressions. ThruPlay-based Hold Rate and inline video playback aren't exposed by the API; ↗ opens the Instagram post where available.</p>
      {preview && <img className="cre-preview" src={preview.src} alt="" style={{ left: Math.min(preview.x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 268), top: Math.min(Math.max(12, preview.y - 120), (typeof window !== 'undefined' ? window.innerHeight : 800) - 300) }} onError={() => setPreview(null)} />}
    </div>
  )
}

/* ============ Google deep ============ */
const qsClass = (n) => n === '' || n == null ? 'q-unk' : n >= 7 ? 'q-above' : n >= 4 ? 'q-avg' : 'q-low'
const MT_COLOR = { Broad: '#f5a524', Phrase: '#4f7cff', Exact: '#12b886' }
const mtColor = (t) => MT_COLOR[t] || '#8b5cf6'
function GoogleDeep({ deep, currency, attr, clientId, range, nonce }) {
  const [pipe, setPipe] = useState('all')
  const pipeAttr = usePipelineAttr(clientId, range, nonce, pipe, attr)
  const pipeLoading = pipe !== 'all' && (!pipeAttr || pipeAttr.status === 'loading')
  const allPipes = (attr && attr.data && attr.data.attribution && attr.data.attribution.allPipelines) || []
  const kpis = loadKpis(clientId, pipe !== 'all' ? pipe : undefined)
  const [sel, setSel] = useState({ campaign: null, adGroup: null })
  const [day, setDay] = useState(null)
  const [cSort, onCSort] = useSort('cost')
  const [aSort, onASort] = useSort('cost')
  const [kSort, onKSort] = useSort('cost')
  const [sSort, onSSort] = useSort('cost')
  const scrollRootRef = React.useRef(null)
  useSyncedTableScroll(scrollRootRef)
  if (!deep?.google) return <EmptyDeep channel="Google Ads" />
  const g = deep.google
  const A = pipeAttr && pipeAttr.data && pipeAttr.data.attribution
  const has360 = !!A
  const keList = keyEventsForPipe(loadKeyEvents(clientId), pipe)
  const stagePos = stagePosMap(A && A.channels && A.channels.all ? A.channels.all.pipelines : [])
  const calNames = new Map(((A && A.appointments && A.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = buildO360Cols(keList, stagePos, calNames)
  const oCampG = mkOutcomeMap(A && A.byCampaign)
  const oAgG = mkOutcomeMap(A && A.byTerm)
  const t = g.totals || g.campaigns.reduce((a, c) => ({ cost: a.cost + c.cost, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }), { cost: 0, impressions: 0, clicks: 0, conversions: 0 })
  const costPerConv = t.conversions ? t.cost / t.conversions : 0
  const avgCpc = t.clicks ? t.cost / t.clicks : 0
  const gv = g.prev || null
  const D = (fn) => (gv ? fn(gv) : null)
  const pickCamp = (n) => setSel((s) => (s.campaign === n && !s.adGroup && !s.keyword ? {} : { campaign: n }))
  const pickAg = (a) => setSel((s) => (s.adGroup === a.name && s.campaign === a.campaign && !s.keyword ? { campaign: a.campaign } : { campaign: a.campaign, adGroup: a.name }))
  const pickKw = (k) => setSel((s) => (s.keyword === k.text ? { campaign: k.campaign, adGroup: k.adGroup } : { campaign: k.campaign, adGroup: k.adGroup, keyword: k.text }))
  const pickTerm = (tm) => setSel((s) => (s.keyword === tm.keyword && s.adGroup === tm.adGroup ? { campaign: tm.campaign, adGroup: tm.adGroup } : { campaign: tm.campaign, adGroup: tm.adGroup, keyword: tm.keyword }))
  const matchCA = (r) => (!sel.campaign || r.campaign === sel.campaign) && (!sel.adGroup || r.adGroup === sel.adGroup)
  const adGroups = g.adGroups.filter((a) => !sel.campaign || a.campaign === sel.campaign)
  const keywords = g.keywords.filter(matchCA)
  const searchTerms = (g.searchTerms || []).filter((r) => matchCA(r))
  const selLabel = [sel.campaign, sel.adGroup, sel.keyword].filter(Boolean).join(' › ')
  // conversion actions + match types respond to the drill-down selection
  const caAgg = (() => { const m = new Map(); for (const r of (g.conversionActions || [])) { if (!matchCA(r)) continue; const e = m.get(r.name) || { name: r.name, category: r.category, conversions: 0, allConversions: 0, value: 0 }; e.conversions += r.conversions; e.allConversions += r.allConversions; e.value += r.value; m.set(r.name, e) } return [...m.values()].sort((a, b) => b.allConversions - a.allConversions) })()
  const matchAgg = (() => { const m = new Map(); for (const k of keywords) { const type = k.match || '-'; const e = m.get(type) || { type, cost: 0 }; e.cost += k.cost; m.set(type, e) } return [...m.values()].filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost) })()
  const locAgg = (g.geo && g.geo.locations) || []
  const geoDim = g.geo && g.geo.dim
  const locMax = Math.max(1, ...locAgg.map((l) => l.conversions))
  const daily = (g.daily || []).map((d) => ({ ...d, label: dayLabel(d.date), cpc: d.clicks ? d.cost / d.clicks : 0, ctr: d.impressions ? d.clicks / d.impressions * 100 : 0, cpconv: d.conversions ? d.cost / d.conversions : 0 }))
  const qKw = g.keywords.filter((k) => k.qs !== '' && k.qs != null)
  const avgQs = qKw.length ? qKw.reduce((a, k) => a + k.qs, 0) / qKw.length : 0
  const GHead = ({ first, o360, sort, on }) => (<thead>{o360 && has360 && <C360GrpRow left={7} cols={o360cols} />}<tr><SortTh k="name" sort={sort} on={on}>{first}</SortTh><SortTh k="cost" sort={sort} on={on}>Cost</SortTh><SortTh k="impressions" sort={sort} on={on}>Impr.</SortTh><SortTh k="ctr" sort={sort} on={on}>CTR</SortTh><SortTh k="cpc" sort={sort} on={on}>CPC</SortTh><SortTh k="conversions" sort={sort} on={on}>Conv.</SortTh><SortTh k="costConv" sort={sort} on={on}>Cost/conv</SortTh>{o360 && has360 && <O360Head sort={sort} on={on} cols={o360cols} />}</tr></thead>)
  const GCells = (r) => (<><td>{fmtCurrency(r.cost, currency)}</td><td>{fmtNumber(r.impressions)}</td><td>{fmtPct(rate(r.clicks, r.impressions), 2)}</td><td>{fmtCurrency(r.clicks ? r.cost / r.clicks : 0, currency)}</td><td>{fmtNumber(r.conversions)}</td><td>{r.conversions ? fmtCurrency(r.cost / r.conversions, currency) : '-'}</td></>)
  const gMetrics = (r) => ({ ...r, ctr: rate(r.clicks, r.impressions), cpc: r.clicks ? r.cost / r.clicks : null, costConv: r.conversions ? r.cost / r.conversions : null })
  // Key events for the Google channel: configured pipeline stages + booked
  // calendars, scored against Google-attributed CRM data and Google spend.
  const gCh = A && A.channels && A.channels.google
  const gRows = (() => {
    const rmap = reachedByStage(gCh ? (gCh.pipelines || []) : [])
    const cfg = keyEventRows(keList, rmap, calCountMap(A, 'google'), stagePos, gCh ? gCh.totals.won : 0)
    if (cfg.length) return cfg
    if (!gCh) return []
    const tt = gCh.totals
    return [{ label: 'Leads', count: tt.leads, kind: 'stage' }, { label: 'Bookings', count: tt.booked, kind: 'stage' }, { label: 'Shown', count: tt.shown, kind: 'stage' }, { label: 'Won', count: tt.won, kind: 'stage' }]
  })()
  const gTotal = Math.max(1, gCh ? gCh.totals.leads : 0)
  return (
    <div ref={scrollRootRef}>
      <AttrDiag attr={attr} />
      {allPipes.length > 1 && <div className="pipe-filter-bar"><PipelineFilter pipelines={allPipes} value={pipe} onChange={setPipe} loading={pipeLoading} />{pipe !== 'all' && <span className="pipe-filter-note">Caalano360 green columns, key events &amp; funnel are scoped to this pipeline · ad spend is unchanged</span>}</div>}
      <div className="scorecard">
        <Sc label="Cost" value={fmtCurrency(t.cost, currency)} cur={t.cost} prev={D((x) => x.cost)} goodWhenDown />
        <Sc label="Impressions" value={fmtNumber(t.impressions)} cur={t.impressions} prev={D((x) => x.impressions)} />
        <Sc label="Clicks" value={fmtNumber(t.clicks)} cur={t.clicks} prev={D((x) => x.clicks)} />
        <Sc label="CTR" value={fmtPct(rate(t.clicks, t.impressions), 2)} cur={rate(t.clicks, t.impressions)} prev={D((x) => rate(x.clicks, x.impressions))} />
        <Sc label="Avg CPC" value={fmtCurrency(avgCpc, currency)} cur={avgCpc} prev={D((x) => x.clicks ? x.cost / x.clicks : 0)} goodWhenDown />
        <Sc label="Conversions" value={fmtNumber(t.conversions)} cur={t.conversions} prev={D((x) => x.conversions)} />
        <Sc label="Cost / Conv" value={fmtCurrency(costPerConv, currency)} cur={costPerConv} prev={D((x) => x.conversions ? x.cost / x.conversions : 0)} goodWhenDown kpi={kpis.googleCostConv ? { text: `Target ${fmtCurrency(kpis.googleCostConv, currency)}`, cls: kpiClass(costPerConv, kpis.googleCostConv, true) } : null} />
        <Sc label="Conv. Rate" value={fmtPct(rate(t.conversions, t.clicks), 2)} cur={rate(t.conversions, t.clicks)} prev={D((x) => rate(x.conversions, x.clicks))} />
        <Sc label="Keywords" value={fmtNumber(g.keywordsTotal)} />
        <Sc label="Search Terms" value={fmtNumber(g.searchTermsTotal)} />
      </div>
      {has360 && gRows.some((r) => r.count > 0) && <KeyEventsFunnel
        rows={gRows} total={gTotal} spend={t.cost} currency={currency}
        title="Key events · Google" style={{ marginTop: 14 }}
        sub="Google-attributed leads through your key pipeline stages and booked calendars · cost per event = Google spend ÷ count"
        caveat={<>📅 = a booked calendar appointment (cost per booked call). Counts are opportunities the CRM attributes to Google; cost per event divides the Google spend in this range. Configure which stages and calendars count in Settings → Key events.</>}
      />}
      {daily.length > 0 && <div className="card chart-card" style={{ marginTop: 14 }}>
        <h3>Daily trend</h3><p className="cap">Spend, Conversions and Cost / Conversion by day</p>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={daily} margin={{ left: -8, right: 6, top: 6 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" />
            <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
            <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => '$' + fmtCompact(v)} />
            <Tooltip formatter={(v, n) => (n === 'Conversions' ? fmtNumber(v) : fmtCurrency(v, currency))} />
            <Legend />
            <Bar yAxisId="l" dataKey="conversions" name="Conversions" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={26} />
            <Line yAxisId="r" dataKey="cost" name="Spend" stroke="#4f7cff" strokeWidth={2} dot={false} />
            <Line yAxisId="r" dataKey="cpconv" name="Cost / Conv" stroke="#ec4899" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}
      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Spend by match type</h3><p className="cap">{selLabel ? `In ${selLabel}` : 'Where the budget is landing'}</p>
          {matchAgg.length ? <>
            <ResponsiveContainer width="100%" height={150}>
              <PieChart><Pie data={matchAgg} dataKey="cost" nameKey="type" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">{matchAgg.map((x) => <Cell key={x.type} fill={mtColor(x.type)} />)}</Pie><Tooltip formatter={(v) => fmtCurrency(v, currency)} /></PieChart>
            </ResponsiveContainer>
            <div className="legend" style={{ flexWrap: 'wrap', fontSize: 11 }}>{matchAgg.map((x) => <span key={x.type}><i className="swatch" style={{ background: mtColor(x.type) }} /> {x.type} {fmtCurrency(x.cost, currency)}</span>)}</div>
          </> : <p className="cap">No keyword spend{selLabel ? ` in ${selLabel}` : ''}.</p>}
        </div>
        <div className="card chart-card"><h3>Conversion actions</h3><p className="cap">What Google is counting{selLabel ? ` · in ${selLabel}` : ''}</p>
          {caAgg.length ? <div className="mini-scroll"><table className="mini-table"><thead><tr><th>Action</th><th>Conv.</th><th>Value</th></tr></thead>
            <tbody>{caAgg.map((a) => (<tr key={a.name}><td className="ca-name" title={a.name}>{a.name}<span className="ca-cat">{a.category || '-'}</span></td><td>{fmtNumber(a.allConversions)}</td><td>{a.value ? fmtCurrency(a.value, currency) : '-'}</td></tr>))}</tbody></table></div>
            : <p className="cap">No conversion actions{selLabel ? ` in ${selLabel}` : ''}.</p>}
        </div>
        <div className="card chart-card"><h3>Conversion locations</h3><p className="cap">Where conversions are happening{geoDim ? ` · by ${geoDim.replace(/_/g, ' ')}` : ''}</p>
          {locAgg.length ? <div className="mini-scroll">{locAgg.map((l) => (
            <div className="loc-row" key={l.name}>
              <span className="loc-nm" title={l.name}>{l.name}</span>
              <span className="loc-bar"><span className="loc-fill" style={{ width: `${(l.conversions / locMax) * 100}%` }} /></span>
              <span className="loc-ct">{fmtNumber(l.conversions)}</span>
            </div>
          ))}</div> : <p className="cap">No location data in this range{g.geo ? '.' : ' - geo not available for this account.'}</p>}
        </div>
      </div>
      <div className="lvl-title">Campaigns <span className="sub">· {g.campaigns.length}{sel.campaign ? ` · filtered to "${sel.campaign}" (click to clear)` : ' · click a row to drill in'}{has360 ? ' · green = Caalano360 outcomes (UTM-matched) · Booked counts on the day the call was booked; (Nc) = later cancelled, (Np) = shown via pipeline stage · Book% = booked/leads, Show% = shown/booked, Win% = won/leads' : ''}</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={7} green={has360} cols={o360cols} /><GHead first="Campaign" o360 sort={cSort} on={onCSort} />
        <tbody>{sortRows(g.campaigns.map((c) => ({ ...gMetrics(c), ...o360Fields(oCampG.get(unorm(c.name)), c.cost, c.conversions, o360cols) })), cSort).map((c) => (<tr key={c.name} className={sel.campaign === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCamp(c.name)}><td>{c.name}{c.status && c.status !== 'Enabled' ? <span className="q-badge q-unk" style={{ marginLeft: 6 }}>{c.status}</span> : null}</td>{GCells(c)}{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Ad groups <span className="sub">· {adGroups.length}{sel.campaign ? ` in "${sel.campaign}"` : ''}{sel.adGroup ? ` · filtered to "${sel.adGroup}"` : adGroups.length ? ' · click to drill in' : ''}</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={7} green={has360} cols={o360cols} /><GHead first="Ad group" o360 sort={aSort} on={onASort} />
        <tbody>{sortRows(adGroups.map((c) => ({ ...gMetrics(c), ...o360Fields(oAgG.get(unorm(c.name)), c.cost, c.conversions, o360cols) })), aSort).map((c) => (<tr key={c.campaign + '|' + c.name} className={sel.adGroup === c.name && sel.campaign === c.campaign ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickAg(c)}><td>{c.name}</td>{GCells(c)}{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Keywords <span className="sub">· {keywords.length} of {fmtNumber(g.keywordsTotal)} by spend{selLabel ? ` · in ${selLabel}` : ''} · click to filter search terms</span></div>
      <div className="table-wrap"><table><thead><tr><SortTh k="text" sort={kSort} on={onKSort}>Keyword</SortTh><SortTh k="match" sort={kSort} on={onKSort}>Match</SortTh><SortTh k="cost" sort={kSort} on={onKSort}>Cost</SortTh><SortTh k="impressions" sort={kSort} on={onKSort}>Impr.</SortTh><SortTh k="ctr" sort={kSort} on={onKSort}>CTR</SortTh><SortTh k="cpc" sort={kSort} on={onKSort}>CPC</SortTh><SortTh k="conversions" sort={kSort} on={onKSort}>Conv.</SortTh><SortTh k="costConv" sort={kSort} on={onKSort}>Cost/conv</SortTh><SortTh k="qs" sort={kSort} on={onKSort}>QS</SortTh></tr></thead>
        <tbody>{sortRows(keywords.map(gMetrics), kSort).map((k) => (<tr key={k.campaign + '|' + k.adGroup + '|' + k.text + '|' + k.match} className={sel.keyword === k.text && sel.adGroup === k.adGroup && sel.campaign === k.campaign ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickKw(k)}><td>{k.text}</td><td><span className="q-badge q-unk">{k.match}</span></td><td>{fmtCurrency(k.cost, currency)}</td><td>{fmtNumber(k.impressions)}</td><td>{fmtPct(rate(k.clicks, k.impressions), 2)}</td><td>{fmtCurrency(k.clicks ? k.cost / k.clicks : 0, currency)}</td><td>{fmtNumber(k.conversions)}</td><td>{k.conversions ? fmtCurrency(k.cost / k.conversions, currency) : '-'}</td><td><span className={`q-badge ${qsClass(k.qs)}`}>{k.qs === '' || k.qs == null ? '-' : k.qs}</span></td></tr>))}</tbody></table></div>
      <div className="lvl-title">Search terms <span className="sub">· {searchTerms.length} of {fmtNumber(g.searchTermsTotal)} actual queries by spend{selLabel ? ` · in ${selLabel}` : ''}</span></div>
      {searchTerms.length ? (
        <div className="table-wrap"><table><thead><tr><SortTh k="term" sort={sSort} on={onSSort}>Search term</SortTh><SortTh k="campaign" sort={sSort} on={onSSort}>Campaign</SortTh><SortTh k="cost" sort={sSort} on={onSSort}>Cost</SortTh><SortTh k="ctr" sort={sSort} on={onSSort}>CTR</SortTh><SortTh k="clicks" sort={sSort} on={onSSort}>Clicks</SortTh><SortTh k="conversions" sort={sSort} on={onSSort}>Conv.</SortTh><SortTh k="costConv" sort={sSort} on={onSSort}>Cost / conv</SortTh></tr></thead>
          <tbody>{sortRows(searchTerms.map((s) => ({ ...s, ctr: rate(s.clicks, s.impressions), costConv: s.conversions ? s.cost / s.conversions : null })), sSort).map((s, i) => (<tr key={s.campaign + '|' + s.adGroup + '|' + s.term + i}><td>{s.term}</td><td style={{ color: 'var(--muted)', fontSize: 12 }} title={s.campaign}>{s.adGroup || s.campaign || '-'}</td><td>{fmtCurrency(s.cost, currency)}</td><td>{fmtPct(rate(s.clicks, s.impressions), 2)}</td><td>{fmtNumber(s.clicks)}</td><td>{fmtNumber(s.conversions)}</td><td>{s.conversions ? fmtCurrency(s.cost / s.conversions, currency) : '-'}</td></tr>))}</tbody></table></div>
      ) : <p className="caveat">No search-term data in this range{selLabel ? ` for ${selLabel}` : ''}.</p>}
      {daily.length > 0 && <>
        <div className="lvl-title">Day by day <span className="sub">· {daily.length} days · newest first{g.adGroupDaily ? ' · click a day to break it down' : ''}</span></div>
        <div className="table-wrap"><table><thead><tr><th>Day</th><th>Cost</th><th>Impr.</th><th>CTR</th><th>CPC</th><th>Conv.</th><th>Cost/conv</th></tr></thead>
          <tbody>{[...daily].reverse().map((d) => (<tr key={d.date} className={day === d.date ? 'row-sel' : ''} style={{ cursor: g.adGroupDaily ? 'pointer' : 'default' }} onClick={() => g.adGroupDaily && setDay(day === d.date ? null : d.date)}><td>{d.label}</td><td>{fmtCurrency(d.cost, currency)}</td><td>{fmtNumber(d.impressions)}</td><td>{fmtPct(d.ctr, 2)}</td><td>{fmtCurrency(d.cpc, currency)}</td><td>{fmtNumber(d.conversions)}</td><td>{d.conversions ? <span className="cpl-cell" style={{ background: cplColor(d.cpconv, costPerConv) }}>{fmtCurrency(d.cpconv, currency)}</span> : '-'}</td></tr>))}</tbody></table></div>
        {day && (() => {
          const rows = (g.adGroupDaily || []).filter((r) => r.date === day)
          const agg = (keyFn) => { const map = new Map(); for (const r of rows) { const k = keyFn(r); if (!k) continue; const e = map.get(k) || { name: k, cost: 0, impressions: 0, clicks: 0, conversions: 0 }; e.cost += r.cost; e.impressions += r.impressions; e.clicks += r.clicks; e.conversions += r.conversions; map.set(k, e) } return [...map.values()].sort((a, b) => b.cost - a.cost) }
          const camps = agg((r) => r.campaign), ags = agg((r) => r.adGroup)
          const Row = (r) => (<tr key={r.name}><td>{r.name}</td><td>{fmtCurrency(r.cost, currency)}</td><td>{fmtNumber(r.impressions)}</td><td>{fmtPct(rate(r.clicks, r.impressions), 2)}</td><td>{fmtNumber(r.conversions)}</td><td>{r.conversions ? fmtCurrency(r.cost / r.conversions, currency) : '-'}</td></tr>)
          const stRows = (g.searchTermDaily || []).filter((r) => r.date === day)
          const stMap = new Map()
          for (const r of stRows) { const e = stMap.get(r.term) || { term: r.term, keyword: r.keyword, cost: 0, clicks: 0, conversions: 0 }; e.cost += r.cost; e.clicks += r.clicks; e.conversions += r.conversions; stMap.set(r.term, e) }
          const terms = [...stMap.values()].sort((a, b) => b.cost - a.cost)
          return (
            <div className="day-drill">
              <div className="lvl-title">Breakdown for {dayLabel(day)} <span className="sub">· {camps.length} campaigns · {ags.length} ad groups · {terms.length} search terms · click the day again to close</span></div>
              <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Cost</th><th>Impr.</th><th>CTR</th><th>Conv.</th><th>Cost/conv</th></tr></thead><tbody>{camps.map(Row)}</tbody></table></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Ad group</th><th>Cost</th><th>Impr.</th><th>CTR</th><th>Conv.</th><th>Cost/conv</th></tr></thead><tbody>{ags.map(Row)}</tbody></table></div>
              {terms.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Search term fired</th><th>Matched keyword</th><th>Cost</th><th>Clicks</th><th>Conv.</th><th>Cost/conv</th></tr></thead>
                <tbody>{terms.slice(0, 100).map((r) => (<tr key={r.term}><td>{r.term}</td><td style={{ color: 'var(--muted)', fontSize: 12 }}>{r.keyword || '-'}</td><td>{fmtCurrency(r.cost, currency)}</td><td>{fmtNumber(r.clicks)}</td><td>{fmtNumber(r.conversions)}</td><td>{r.conversions ? fmtCurrency(r.cost / r.conversions, currency) : '-'}</td></tr>))}</tbody></table></div>}
            </div>
          )
        })()}
      </>}
    </div>
  )
}

function EmptyDeep({ channel }) {
  return <div className="card empty-deep"><div className="big">📊</div><b>{channel} deep breakdown not pulled yet for this client.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Campaign, ad-set and creative level data pulls on demand via Reporting Ninja. Nexia Health Care is built out as the first full example. Ask me to build this client next, or connect the live API to populate every client automatically.</p></div>
}

/* ============ Client workspace ============ */
function OverallTab({ client, currency, side }) {
  const tt = clientTotals(client); const d = tt[side]; const other = tt[side === 'cur' ? 'prev' : 'cur']
  // Only baked-metrics objects render the channel cards; a UI-added client has
  // the account id as a string here and no baked snapshot (its live tabs work).
  const m = client.meta && typeof client.meta === 'object' ? client.meta : null
  const g = client.google && typeof client.google === 'object' ? client.google : null
  const has = d.conversions > 0
  return (
    <>
      <div className="grid kpis">
        <Kpi label="Total Spend" value={fmtCurrency(d.spend, currency)} cur={d.spend} prev={other.spend} />
        <Kpi label="Results" value={has ? fmtNumber(d.conversions) : '-'} cur={d.conversions} prev={other.conversions} flat={has ? null : 'outcomes not tracked'} />
        <Kpi label="Cost / Result" value={has ? fmtCurrency(d.cpl, currency) : '-'} cur={d.cpl} prev={other.cpl} goodWhenDown flat={has ? null : 'n/a'} />
        <Kpi label="CTR" value={fmtPct(d.ctr, 2)} cur={d.ctr} prev={other.ctr} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        {m ? <div className="card"><div className="chead"><span className="chan-badge" style={{ background: '#4f7cff' }}>M</span><h3 style={{ margin: 0, fontSize: 15 }}>Meta Ads</h3></div>
          {[['Amount spent', fmtCurrency(m.spend, currency)], ['Leads', fmtNumber(m.leads)], ['Cost per lead', m.leads ? fmtCurrency(m.spend / m.leads, currency) : '-'], ['Impressions', fmtNumber(m.impressions)], ['CTR', fmtPct(rate(m.clicks, m.impressions), 2)]].map(([l, v]) => <div className="metric-row" key={l}><span className="m">{l}</span><span className="v">{v}</span></div>)}
        </div> : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Meta Ads.</p></div>}
        {g ? <div className="card"><div className="chead"><span className="chan-badge" style={{ background: '#12b886' }}>G</span><h3 style={{ margin: 0, fontSize: 15 }}>Google Ads</h3></div>
          {[['Cost', fmtCurrency(g.cost, currency)], ['Conversions', fmtNumber(g.conversions)], ['Cost per conv.', g.conversions ? fmtCurrency(g.cost / g.conversions, currency) : '-'], ['Impressions', fmtNumber(g.impressions)], ['CTR', fmtPct(rate(g.clicks, g.impressions), 2)]].map(([l, v]) => <div className="metric-row" key={l}><span className="m">{l}</span><span className="v">{v}</span></div>)}
        </div> : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Google Ads.</p></div>}
      </div>
    </>
  )
}

/* ============ CRM - live from GoHighLevel (Caalano Systems) ============ */
function CrmGhl({ crm, currency, clientId }) {
  const kpis = loadKpis(clientId)
  const allUsers = crm.users || []
  const [uid, setUid] = useState('all')
  // Board source pivots by the selected user (or the whole account).
  const src = uid === 'all' ? crm : (allUsers.find((u) => u.id === uid) || crm)
  const pipes = src.pipelines || []
  const [pid, setPid] = useState('all')
  useEffect(() => { setPid('all') }, [uid])
  const [openUser, setOpenUser] = useState(null)
  const [uSort, onUSort] = useSort('won')
  const [wonBasis, setWonBasis] = useState('created')
  useEffect(() => { setWonBasis('created') }, [clientId])
  const money = (v) => fmtCurrency(v, currency)
  const pipe = pid === 'all' ? null : pipes.find((p) => p.id === pid)
  // Every scorecard / breakdown pivots to the selected pipeline (within the user).
  const t = pipe ? pipe.totals : src.totals
  // Won lens: 'created' (opps created in period) or 'closed' (marked Won in period).
  const wonClosed = crm.wonClosed || null
  const wcSlice = !wonClosed ? null : (pipe ? wonClosed.byPipeline[pid] : uid !== 'all' ? wonClosed.byUser[uid] : wonClosed.total)
  const useClosed = wonBasis === 'closed' && !!wcSlice
  const dWon = useClosed ? wcSlice.won : t.won
  const dRev = useClosed ? wcSlice.revenue : t.revenue
  const dAov = useClosed ? wcSlice.avgValue : t.avgWonValue
  const lostReasons = pipe ? (pipe.lostReasons || []) : (src.lostReasons || [])
  const lostByStage = pipe ? (pipe.lostByStage || []) : (src.lostByStage || [])
  const byUser = crm.byUser || []
  const stages = pipe ? pipe.stages : (pipes.length === 1 ? pipes[0].stages : null)
  const stageMax = stages ? Math.max(1, ...stages.map((s) => s.count)) : 1
  const lostMax = Math.max(1, ...lostByStage.map((s) => s.count))
  return (
    <>
      {allUsers.length > 1 && <div className="c360-head" style={{ marginTop: 0 }}>
        <div className="section-title" style={{ margin: 0 }}>Caalano Systems CRM <span className="sub">· {uid === 'all' ? 'all users' : (allUsers.find((u) => u.id === uid)?.name || 'user')}{uid !== 'all' ? ' · filtered' : ''}</span></div>
        <div className="pipe-sel"><label>User</label>
          <select value={uid} onChange={(e) => setUid(e.target.value)}>
            <option value="all">All users ({fmtNumber(crm.totals.leads)})</option>
            {allUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({fmtNumber(u.leads)})</option>)}
          </select>
        </div>
      </div>}
      {wonClosed && <div className="c360-head" style={{ marginTop: allUsers.length > 1 ? 12 : 0 }}>
        <div className="section-title" style={{ margin: 0 }}>Won reporting basis <span className="sub">· {useClosed ? 'deals closed in period' : 'opportunities created in period'}</span></div>
        <div className="pipe-sel"><label>Won by</label>
          <div className="chan-toggle">
            <button className={wonBasis === 'created' ? 'on' : ''} onClick={() => setWonBasis('created')} title="Opportunities created in this period">Lead created</button>
            <button className={wonBasis === 'closed' ? 'on' : ''} onClick={() => setWonBasis('closed')} title="Deals marked Won in this period, any created date">Deal won</button>
          </div>
        </div>
      </div>}
      <div className="scorecard">
        <Sc label="Leads" value={fmtNumber(t.leads)} />
        <Sc label="Open" value={fmtNumber(t.open)} />
        <Sc label={useClosed ? 'Won (closed)' : 'Won (created)'} value={fmtNumber(dWon)} />
        <Sc label="Lost" value={fmtNumber(t.lost)} />
        <Sc label="Abandoned" value={fmtNumber(t.abandoned)} />
        <Sc label="Close Rate" value={fmtPct(t.closeRate, 1)} />
        <Sc label="Pipeline Value" value={money(t.openValue)} />
        <Sc label={useClosed ? 'Won Value (closed)' : 'Won Value (created)'} value={money(dRev)} />
        <Sc label="Avg Deal" value={dWon ? money(dAov) : '-'} />
        <Sc label="Avg Days to Won" value={t.avgDaysToWon != null ? `${t.avgDaysToWon}d` : '-'} />
      </div>
      {wonClosed && <p className={`basis-note ${useClosed ? 'closed' : ''}`}>
        {useClosed
          ? <><b>Deal-won basis:</b> Won &amp; Won Value are deals <b>marked Won in this period</b>, no matter when the lead was created - realised revenue.{wonClosed.capped ? ' (High volume: some very old deals may be excluded.)' : ''} Leads, Open, Lost, Close Rate &amp; Pipeline Value stay by lead-created date.</>
          : <><b>Lead-created basis:</b> Won &amp; Won Value are opportunities <b>created in this period</b>. Switch to <b>Deal won</b> for revenue actually closed in the window, regardless of created date.</>}
      </p>}
      <div className="c360-head">
        <div className="section-title" style={{ margin: 0 }}>Pipeline stages <span className="sub">· {pipe ? pipe.name : 'all pipelines'} · pass-through vs. live position</span></div>
        {pipes.length > 1 && <div className="pipe-sel"><label>Pipeline</label>
          <select value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="all">All pipelines</option>
            {pipes.map((p) => <option key={p.id} value={p.id}>{p.name} ({fmtNumber(p.leads)})</option>)}
          </select></div>}
      </div>
      {stages && stages.length ? (() => {
        let acc = 0; const reached = []
        for (let i = stages.length - 1; i >= 0; i--) { acc += stages[i].count; reached[i] = acc }
        const top = reached[0] || 1
        return (
          <div className="grid two">
            <div className="card chart-card"><h3>Stage pass-through</h3><p className="cap">Reached that stage or beyond · % of leads · next-step conversion</p>
              <div className="pfunnel pf4">
                <div className="pf-row pf-head"><span className="pf-stage">Stage</span><span className="pf-bar">Reached</span><span className="pf-num">% leads</span><span className="pf-num">Next step</span></div>
                {stages.map((s, i) => {
                  const val = reached[i]; const pctLeads = (val / top) * 100
                  const nextConv = i === 0 ? null : (reached[i - 1] ? (val / reached[i - 1]) * 100 : 0)
                  const hue = 210 + Math.round((i / Math.max(1, stages.length - 1)) * -70)
                  return (
                    <div className="pf-row" key={s.pos}>
                      <span className="pf-stage" title={s.name}>{s.name}</span>
                      <span className="pf-bar"><span className="pf-fill" style={{ width: `${Math.max(4, pctLeads)}%`, background: `hsl(${hue} 70% 55%)` }}>{fmtNumber(val)}</span></span>
                      <span className="pf-num">{fmtPct(pctLeads, 1)}</span>
                      <span className={`pf-num ${nextConv == null ? '' : nextConv >= 60 ? 'good' : nextConv < 30 ? 'bad' : ''}`}>{nextConv == null ? '-' : fmtPct(nextConv, 0)}</span>
                    </div>
                  )
                })}
              </div>
              <p className="caveat">Reached = opportunities at that stage or further (they passed through it). % leads = reached ÷ everyone in the pipeline. Next step = % who moved from the stage above into this one.</p>
            </div>
            <div className="card chart-card"><h3>Where opportunities sit</h3><p className="cap">Live count at each stage, first to last</p>
              <div className="funnel">{stages.map((s, i) => {
                const hue = 210 + Math.round((i / Math.max(1, stages.length - 1)) * -70)
                const tgt = kpis.stages && kpis.stages[s.name]
                return <div className="fn" key={s.pos}><span className="lab" title={s.name}>{s.name}</span><span className="bar" style={{ width: `${Math.max(6, (s.count / stageMax) * 100)}%`, background: `hsl(${hue} 70% 55%)` }}>{s.count > 0 ? fmtNumber(s.count) : ''}{tgt ? <span className={`fn-tgt ${s.count >= tgt ? 'good' : 'bad'}`}>/ {fmtNumber(tgt)} {s.count >= tgt ? '✓' : ''}</span> : ''}</span></div>
              })}</div>
              {kpis.stages && Object.keys(kpis.stages).length > 0 && <p className="caveat">Green = at or above your target for that stage (set in Settings).</p>}
            </div>
          </div>
        )
      })() : <p className="caveat">This account runs {pipes.length} pipelines - pick one above to see its stage-by-stage breakdown.</p>}
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Why deals are lost</h3><p className="cap">Named lost reasons · {fmtNumber(t.lost + t.abandoned)} lost / abandoned</p>
          {lostReasons.length ? <>
            <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={lostReasons} dataKey="count" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">{lostReasons.map((x, i) => <Cell key={i} fill={acolor(i)} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            <div className="legend" style={{ flexWrap: 'wrap' }}>{lostReasons.slice(0, 8).map((x, i) => <span key={i}><i className="swatch" style={{ background: acolor(i) }} /> {x.name} {x.count}</span>)}</div>
          </> : <p className="cap">No lost deals in range.</p>}
        </div>
        <div className="card chart-card"><h3>% lost by stage</h3><p className="cap">Where deals drop out of the funnel</p>
          {lostByStage.length ? lostByStage.map((s) => (
            <div className="bar-row" key={s.stage} style={{ gridTemplateColumns: '150px 1fr 46px' }}><span className="nm" title={s.stage}>{s.stage}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(s.count / lostMax) * 100}%`, background: 'var(--neg)' }} /></span><span className="ct">{s.count}</span></div>
          )) : <p className="cap">No lost deals in range.</p>}
        </div>
      </div>
      <div className="lvl-title">User performance <span className="sub">· {byUser.length} users{pipe ? ` · ${pipe.name}` : ''} · click a row for their lost reasons</span></div>
      <div className="table-wrap"><table><thead><tr><SortTh k="name" sort={uSort} on={onUSort}>User</SortTh><SortTh k="leads" sort={uSort} on={onUSort}>Leads</SortTh><SortTh k="open" sort={uSort} on={onUSort}>Open</SortTh><SortTh k="won" sort={uSort} on={onUSort}>Won</SortTh><SortTh k="lost" sort={uSort} on={onUSort}>Lost</SortTh><SortTh k="wonValue" sort={uSort} on={onUSort}>Won value</SortTh><SortTh k="convRate" sort={uSort} on={onUSort}>Conv. rate</SortTh></tr></thead>
        <tbody>{sortRows(byUser, uSort).map((u) => (
          <React.Fragment key={u.id}>
            <tr className={openUser === u.id ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setOpenUser(openUser === u.id ? null : u.id)}>
              <td>{u.name}</td><td>{fmtNumber(u.leads)}</td><td>{fmtNumber(u.open)}</td><td>{fmtNumber(u.won)}</td><td>{fmtNumber(u.lost)}</td><td>{money(u.wonValue)}</td><td>{fmtPct(u.convRate, 1)}</td>
            </tr>
            {openUser === u.id && <tr className="sub-row"><td colSpan={7}>{u.lostReasons.length ? <div className="reason-chips">{u.lostReasons.map((r) => <span key={r.name} className="reason-chip">{r.name} <b>{r.count}</b></span>)}</div> : <span className="cap">No lost deals for this user.</span>}</td></tr>}
          </React.Fragment>
        ))}</tbody></table></div>
      <p className="caveat">Live from Caalano Systems via the agency connection. Assigned-user names resolve once <code>users.readonly</code> is added; speed-to-lead follows with <code>conversations.readonly</code>.</p>
    </>
  )
}

/* ============ UTM attribution (GoHighLevel first-touch) ============ */
function useAttribution(clientId, range, nonce = 0) {
  const [state, setState] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=attribution&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: 'ok', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return state
}
// Pipeline-scoped attribution: when a specific pipeline is picked, refetch the
// attribution filtered to it (so every green column / funnel is that pipeline's
// alone); when 'all', reuse the already-loaded account-wide attribution.
function usePipelineAttr(clientId, range, nonce, pipe, fallback) {
  const [state, setState] = useState(null)
  const q = rangeQuery(range)
  const active = !!pipe && pipe !== 'all'
  useEffect(() => {
    if (!active) { setState(null); return }
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=attribution&${q}&pipeline=${encodeURIComponent(pipe)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: 'ok', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce, pipe]) // eslint-disable-line
  return active ? state : fallback
}
// The pipeline a key event belongs to (null = unscoped / applies to every pipeline).
function pipeOfKeyEvent(e) { if (typeof e === 'string') return null; if (e && (e.cal || e.stage)) return e.pipeline || null; return null }
// Filter a client's key-event list to one pipeline (keeping unscoped events like Won).
function keyEventsForPipe(list, pipe) { if (!pipe || pipe === 'all') return list; return (list || []).filter((e) => { const p = pipeOfKeyEvent(e); return p == null || p === pipe }) }
// A reusable pipeline picker (All + each pipeline) for the Meta / Google views.
function PipelineFilter({ pipelines, value, onChange, loading }) {
  if (!pipelines || pipelines.length < 2) return null
  return (
    <div className="pipe-filter">
      <span className="pipe-filter-lab">Pipeline</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All pipelines</option>
        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {loading && <span className="ov-spin" style={{ marginLeft: 6 }} />}
    </div>
  )
}
// classify a UTM source string into a paid channel (mirror of the backend)
const chanOfSource = (name) => { const s = String(name || '').toLowerCase(); if (/(facebook|instagram|\bfb\b|\bmeta\b|\big\b|fbclid|fb_|ig_)/.test(s)) return 'meta'; if (/(google|adwords|youtube|\bgdn\b|gclid|goog)/.test(s)) return 'google'; return 'other' }
function MiniDimTable({ rows, currency }) {
  if (!rows || !rows.length) return <p className="cap" style={{ margin: '2px 0' }}>-</p>
  const money = (v) => fmtCurrency(v, currency)
  return <div className="mini-scroll" style={{ maxHeight: 180 }}><table className="mini-table mt4"><thead><tr><th>Name</th><th>Leads</th><th>Won</th><th>Rev</th></tr></thead>
    <tbody>{rows.map((r) => (<tr key={r.name}><td className="ca-name" title={r.name}><span>{r.name}</span></td><td>{fmtNumber(r.leads)}</td><td>{fmtNumber(r.won)}</td><td>{r.revenue ? money(r.revenue) : '-'}</td></tr>))}</tbody></table></div>
}
// Cohort drill-down for one UTM source: where they ended up + sub-breakdowns.
function UtmSourceDetail({ d, currency }) {
  if (!d) return <span className="cap">No breakdown captured for this source.</span>
  const st = d.status || {}
  const smax = Math.max(1, ...(d.stages || []).map((s) => s.count))
  return (
    <div className="utm-detail">
      <div className="utm-detail-col">
        <div className="mini-cap">Where this cohort is now</div>
        <div className="status-chips">
          <span className="sch won">Won {fmtNumber(st.won || 0)}</span>
          <span className="sch open">Open {fmtNumber(st.open || 0)}</span>
          <span className="sch lost">Lost {fmtNumber(st.lost || 0)}</span>
          <span className="sch ab">Abandoned {fmtNumber(st.abandoned || 0)}</span>
        </div>
        <div className="mini-cap" style={{ marginTop: 12 }}>By pipeline stage</div>
        {(d.stages || []).length ? (d.stages || []).map((s) => (
          <div className="loc-row" key={s.name}><span className="loc-nm" title={s.name}>{s.name}</span><span className="loc-bar"><span className="loc-fill" style={{ width: `${(s.count / smax) * 100}%` }} /></span><span className="loc-ct">{fmtNumber(s.count)}</span></div>
        )) : <p className="cap">-</p>}
      </div>
      <div className="utm-detail-col">
        <div className="mini-cap">By medium</div>
        <MiniDimTable rows={d.byMedium} currency={currency} />
        <div className="mini-cap" style={{ marginTop: 12 }}>By campaign</div>
        <MiniDimTable rows={d.byCampaign} currency={currency} />
      </div>
      <div className="utm-detail-col">
        <div className="mini-cap">By creative (utm_content)</div>
        <MiniDimTable rows={d.byCreative} currency={currency} />
      </div>
    </div>
  )
}
function UtmTable({ label, first, rows, currency, renderDetail }) {
  const [s, on] = useSort('leads')
  const [open, setOpen] = useState(null)
  const money = (v) => fmtCurrency(v, currency)
  const hasSpend = rows.some((r) => r.spend != null)
  const clickable = !!renderDetail
  const withCalc = rows.map((r) => ({ ...r, l2w: rate(r.won, r.leads) }))
  const colCount = 7 + (hasSpend ? 2 : 0)
  return (
    <div>
      <div className="lvl-title" style={{ fontSize: 12.5, marginTop: 14 }}>{label}{clickable ? <span className="sub"> · click a row to drill into that cohort</span> : null}</div>
      <div className="table-wrap"><table><thead><tr>
        <SortTh k="name" sort={s} on={on}>{first}</SortTh>
        <SortTh k="leads" sort={s} on={on}>Leads</SortTh>
        <SortTh k="booked" sort={s} on={on}>Booked</SortTh>
        <SortTh k="shown" sort={s} on={on}>Shown</SortTh>
        <SortTh k="won" sort={s} on={on}>Won</SortTh>
        {hasSpend && <SortTh k="cWon" sort={s} on={on}>C/Won</SortTh>}
        <SortTh k="revenue" sort={s} on={on}>Revenue</SortTh>
        {hasSpend && <SortTh k="roas" sort={s} on={on}>ROAS</SortTh>}
        <SortTh k="l2w" sort={s} on={on}>Lead→Won</SortTh>
      </tr></thead>
        <tbody>{sortRows(withCalc, s).map((r) => (
          <React.Fragment key={r.name}>
            <tr className={open === r.name ? 'row-sel' : ''} style={{ cursor: clickable ? 'pointer' : 'default' }} onClick={() => clickable && setOpen(open === r.name ? null : r.name)}>
              <td>{clickable ? <span className="drill-tw">{open === r.name ? '▾' : '▸'} {r.name}</span> : r.name}</td>
              <td>{fmtNumber(r.leads)}</td><td>{fmtNumber(r.booked)}</td><td>{fmtNumber(r.shown)}</td><td>{fmtNumber(r.won)}</td>
              {hasSpend && <td>{r.cWon != null ? money(r.cWon) : '-'}</td>}
              <td>{money(r.revenue)}</td>
              {hasSpend && <td>{r.roas != null ? `${r.roas.toFixed(2)}×` : '-'}</td>}
              <td>{fmtPct(r.l2w, 1)}</td>
            </tr>
            {clickable && open === r.name && <tr className="sub-row"><td colSpan={colCount}>{renderDetail(r)}</td></tr>}
          </React.Fragment>
        ))}</tbody></table></div>
    </div>
  )
}
function UtmSection({ attr, currency, paid }) {
  const { status, data } = attr || { status: 'loading', data: null }
  if (status === 'loading') return <div className="card" style={{ marginTop: 14 }}><Spinner label="Loading UTM attribution…" /></div>
  if (data && data.connected === false) return <div className="card" style={{ marginTop: 14 }}><b>Connect Caalano Systems</b> to unlock UTM attribution (source → campaign → creative → booked/shown/won).</div>
  const a = data && data.attribution
  if (!a) return null
  // Attribute each paid channel's spend across its UTM sources by lead share, so
  // the By-source table can show a cost-per-won and ROAS per source.
  const bySource = a.bySource || []
  const chLeads = { meta: 0, google: 0, other: 0 }
  for (const r of bySource) chLeads[chanOfSource(r.name)] += r.leads
  const chSpend = { meta: (paid && paid.meta) || 0, google: (paid && paid.google) || 0, other: 0 }
  const srcRows = bySource.map((r) => {
    const ch = chanOfSource(r.name)
    const spend = chLeads[ch] ? chSpend[ch] * (r.leads / chLeads[ch]) : 0
    return { ...r, spend, cWon: r.won ? spend / r.won : null, roas: spend ? r.revenue / spend : null }
  })
  return (
    <>
      <div className="lvl-title">UTM attribution <span className="sub">· first-touch · {fmtNumber(a.attributed)} of {fmtNumber(a.opps)} opportunities tagged</span></div>
      <UtmTable label="By source" first="Source" rows={srcRows} currency={currency} renderDetail={(r) => <UtmSourceDetail d={r.detail} currency={currency} />} />
      {a.byCampaign && a.byCampaign.length ? <UtmTable label="By campaign" first="Campaign" rows={a.byCampaign} currency={currency} /> : null}
      {a.byCreative && a.byCreative.length ? <UtmTable label="By creative (utm_content)" first="Creative" rows={a.byCreative} currency={currency} /> : null}
      <p className="caveat">First-touch UTMs from Caalano Systems attribution, mapped to down-funnel outcomes. "(not set)" = no UTM captured (direct / organic / untagged link). Cost/Won &amp; ROAS on By source attribute each channel's ad spend across its sources by lead share.</p>
    </>
  )
}

/* ============ Caalano360 - blended paid + CRM ============ */
// Settings (key events, KPI targets, campaign->pipeline links, enabled clients)
// persist SERVER-SIDE via /.netlify/functions/settings so they survive cache
// clears, work on every device and are shared across the team. A localStorage
// copy is kept as an instant/offline cache and for one-time migration of any
// config a browser still holds. Reads are synchronous from the in-memory
// SETTINGS cache (seeded from localStorage, then hydrated from the server).
const CMAP_KEY = 'caalano_campmap'
const KPI_KEY = 'caalano_kpis'
const KEV_KEY = 'caalano_keyevents'
const ENABLED_KEY = 'caalano_enabled'
const CLIENTS_KEY = 'caalano_clients' // UI-added clients { id: { name, meta, google, ghl } }
const FORMMETA_KEY = 'caalano_formmeta' // { clientId: { formLabel: { pipeline, notes } } }
const METACONV_KEY = 'caalano_metaconv' // { clientId: { primary: fieldId, secondary: [fieldId] } }
const CREATIVEMETA_KEY = 'caalano_creativemeta' // { clientId: { creativeId: { aware, persona, angle, format, dest, cta, copy, notes } } }
const CREATIVETAX_KEY = 'caalano_creativetax'   // { clientId: { persona: [...], angle: [...], dest: [...] } } — reusable dropdown values
const CLIENTCTX_KEY = 'caalano_clientctx'        // { clientId: "free-text context / notes about the client, fed into the client-update prompt" }
const FATIGUE_KEY = 'caalano_fatigue'            // { _global: { freqMed, freqHigh, ctrDropMed, ctrDropHigh, minImpr } } — creative-fatigue thresholds
// Durable default key events for clients whose config predates server storage,
// so their Meta/Google funnel + grouped Caalano360 columns render out of the
// box. Bare strings = pipeline stage names; calendars are linked in Settings.
const SEED_KEYEVENTS = {
  'pool-haus': ['New Lead', 'Pool Specialist Booked Call', 'Pool Specialist Call - Shown', 'Site Visit Booked', 'Site Visit Completed', 'Quote/Proposal Sent', 'Client Won'],
}
const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const SETTINGS = { campmap: readLS(CMAP_KEY), kpis: readLS(KPI_KEY), keyevents: readLS(KEV_KEY), enabled: readLS(ENABLED_KEY), insights: readLS(AI_KEY), clients: readLS(CLIENTS_KEY), formmeta: readLS(FORMMETA_KEY), metaconv: readLS(METACONV_KEY), creativemeta: readLS(CREATIVEMETA_KEY), creativetax: readLS(CREATIVETAX_KEY), clientctx: readLS(CLIENTCTX_KEY), fatigue: readLS(FATIGUE_KEY), loaded: false }
const settingsSubs = new Set()
const bumpSettings = () => { for (const fn of settingsSubs) fn() }
function onSettings(fn) { settingsSubs.add(fn); return () => settingsSubs.delete(fn) }
// Fire-and-forget partial save (localStorage is the instant cache; UI never
// waits on the network).
function saveSettingsRemote(patch) {
  try { fetch('/.netlify/functions/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {}) } catch {}
}
let _hydrated = false
async function hydrateSettings() {
  if (_hydrated) return; _hydrated = true
  try {
    const r = await fetch('/.netlify/functions/settings')
    const j = await r.json().catch(() => null)
    const d = j && j.ok && j.data ? j.data : null
    const serverEmpty = !d || !['campmap', 'kpis', 'keyevents', 'enabled', 'insights', 'clients', 'formmeta', 'metaconv'].some((s) => d[s] && Object.keys(d[s]).length)
    if (serverEmpty) {
      // First run: migrate whatever this browser holds up to the server.
      saveSettingsRemote({ campmap: SETTINGS.campmap, kpis: SETTINGS.kpis, keyevents: SETTINGS.keyevents, enabled: SETTINGS.enabled, insights: SETTINGS.insights, clients: SETTINGS.clients, formmeta: SETTINGS.formmeta, metaconv: SETTINGS.metaconv, creativemeta: SETTINGS.creativemeta, creativetax: SETTINGS.creativetax, clientctx: SETTINGS.clientctx, fatigue: SETTINGS.fatigue })
    } else {
      for (const s of ['campmap', 'kpis', 'keyevents', 'enabled', 'insights', 'clients', 'formmeta', 'metaconv', 'creativemeta', 'creativetax', 'clientctx', 'fatigue']) SETTINGS[s] = { ...SETTINGS[s], ...(d[s] || {}) }
      writeLS(CMAP_KEY, SETTINGS.campmap); writeLS(KPI_KEY, SETTINGS.kpis); writeLS(KEV_KEY, SETTINGS.keyevents); writeLS(ENABLED_KEY, SETTINGS.enabled); writeLS(AI_KEY, SETTINGS.insights); writeLS(CLIENTS_KEY, SETTINGS.clients); writeLS(FORMMETA_KEY, SETTINGS.formmeta); writeLS(METACONV_KEY, SETTINGS.metaconv); writeLS(CREATIVEMETA_KEY, SETTINGS.creativemeta); writeLS(CREATIVETAX_KEY, SETTINGS.creativetax); writeLS(CLIENTCTX_KEY, SETTINGS.clientctx); writeLS(FATIGUE_KEY, SETTINGS.fatigue)
    }
  } catch { /* offline: keep the localStorage cache */ }
  SETTINGS.loaded = true
  bumpSettings()
}
// Re-render the subscribing component when settings hydrate / change.
function useSettingsSync() {
  const [, force] = React.useReducer((x) => x + 1, 0)
  useEffect(() => onSettings(force), [])
}

// --- Creative Cockpit storage: per-creative tags + reusable dropdown values ---
function loadCreativeMeta(clientId) { return (SETTINGS.creativemeta && SETTINGS.creativemeta[clientId]) || {} }
// Merge a patch onto one creative's tags. Any free-typed persona / angle /
// destination value is also added to the client's reusable list so it appears
// in the dropdown next time.
function saveCreativeMeta(clientId, creativeId, patch) {
  const cur = loadCreativeMeta(clientId)
  const next = { ...cur, [creativeId]: { ...(cur[creativeId] || {}), ...patch } }
  SETTINGS.creativemeta = { ...(SETTINGS.creativemeta || {}), [clientId]: next }
  writeLS(CREATIVEMETA_KEY, SETTINGS.creativemeta)
  const remote = { creativemeta: { [clientId]: next } }
  // Grow the reusable taxonomy lists from any new persona/angle/dest value.
  const taxFields = { persona: patch.persona, angle: patch.angle, dest: patch.dest }
  let taxNext = null
  for (const [field, val] of Object.entries(taxFields)) {
    if (val == null || val === '') continue
    const curTax = (SETTINGS.creativetax && SETTINGS.creativetax[clientId]) || {}
    const list = new Set(curTax[field] || [])
    if (!list.has(val)) { list.add(val); taxNext = { ...(taxNext || curTax), [field]: [...list] } }
  }
  if (taxNext) { SETTINGS.creativetax = { ...(SETTINGS.creativetax || {}), [clientId]: taxNext }; writeLS(CREATIVETAX_KEY, SETTINGS.creativetax); remote.creativetax = { [clientId]: taxNext } }
  saveSettingsRemote(remote); bumpSettings()
}
function loadCreativeTax(clientId) { return (SETTINGS.creativetax && SETTINGS.creativetax[clientId]) || {} }
// Free-text client context/notes, fed into the client-update prompt as background.
function loadClientCtx(clientId) { return (SETTINGS.clientctx && SETTINGS.clientctx[clientId]) || '' }
function saveClientCtx(clientId, text) {
  SETTINGS.clientctx = { ...(SETTINGS.clientctx || {}), [clientId]: text }
  writeLS(CLIENTCTX_KEY, SETTINGS.clientctx); saveSettingsRemote({ clientctx: { [clientId]: text } }); bumpSettings()
}
// Shared creative-fatigue thresholds (one set across all clients). CTR drops are
// stored as whole percents everywhere; the backend divides by 100 when scoring.
const FATIGUE_DEFAULTS = { freqMed: 3, freqHigh: 5, ctrDropMed: 15, ctrDropHigh: 35, minImpr: 800 }
function loadFatigueCfg() { return { ...FATIGUE_DEFAULTS, ...((SETTINGS.fatigue && SETTINGS.fatigue._global) || {}) } }
function saveFatigueCfg(cfg) {
  SETTINGS.fatigue = { ...(SETTINGS.fatigue || {}), _global: { ...cfg } }
  writeLS(FATIGUE_KEY, SETTINGS.fatigue); saveSettingsRemote({ fatigue: { _global: { ...cfg } } }); bumpSettings()
}

// UI-added clients (Settings -> Add client), persisted server-side and merged
// into the dashboard's client list.
function customClientList() { return Object.entries(SETTINGS.clients || {}).filter(([, v]) => v && (v.meta || v.google || v.ghl)).map(([id, v]) => ({ id, name: v.name || id, industry: v.industry || null, meta: v.meta || null, google: v.google || null, ghl: v.ghl || null, metaName: v.metaName || null, googleName: v.googleName || null, ghlName: v.ghlName || null, custom: true })) }
function saveCustomClient(id, mapping) { SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: mapping }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: mapping } }); bumpSettings() }
function removeCustomClient(id) { SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: null }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: null } }); bumpSettings() }
// Shared account-discovery fetch (GHL locations + Windsor Meta/Google accounts),
// cached for the session so the Settings name lookups and the Add/Edit explorer
// reuse one call.
let _discoverPromise = null
// force=true re-queries the Meta/Google/GHL account list (used by the Settings
// "Refresh accounts" button after a new ad account is connected).
function fetchDiscover(force) {
  if (force) _discoverPromise = null
  if (!_discoverPromise) {
    const to = new Date().toISOString().slice(0, 10)
    // Wide (1-year) window so any account with activity in the last year is
    // surfaced, not just very recent spenders. A brand-new account with no spend
    // yet still won't appear until Windsor has data for it.
    const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    const bust = force ? `&_r=${Date.now()}` : ''
    _discoverPromise = fetch(`/.netlify/functions/windsor?scope=discover&from=${from}&to=${to}${bust}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
  }
  return _discoverPromise
}
// id -> account name maps (normalised ids) for showing names next to IDs.
const normId = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]/g, '')
function useDiscoverNames() {
  const [d, setD] = useState(null)
  useEffect(() => { let alive = true; fetchDiscover().then((j) => { if (alive) setD(j) }).catch(() => {}); return () => { alive = false } }, [])
  return useMemo(() => {
    const mk = (arr) => Object.fromEntries((arr || []).map((x) => [normId(x.id), x.name]))
    return d ? { meta: mk(d.meta), google: mk(d.google), ghl: mk(d.ghl) } : null
  }, [d])
}

function loadCampMap(clientId) { return SETTINGS.campmap[clientId] || {} }
function saveCampMap(clientId, map) { SETTINGS.campmap = { ...SETTINGS.campmap, [clientId]: map }; writeLS(CMAP_KEY, SETTINGS.campmap); saveSettingsRemote({ campmap: { [clientId]: map } }); bumpSettings() }

// Per-form metadata (pipeline link + free-text notes + reviewed flag), keyed by
// client then form label. Shown in Settings and the Forms view.
function loadFormMeta(clientId) { return (SETTINGS.formmeta && SETTINGS.formmeta[clientId]) || {} }
function saveFormMeta(clientId, formLabel, meta) {
  const cur = (SETTINGS.formmeta && SETTINGS.formmeta[clientId]) || {}
  const next = { ...cur, [formLabel]: { ...(cur[formLabel] || {}), ...meta } }
  SETTINGS.formmeta = { ...(SETTINGS.formmeta || {}), [clientId]: next }
  writeLS(FORMMETA_KEY, SETTINGS.formmeta); saveSettingsRemote({ formmeta: { [clientId]: next } }); bumpSettings()
}
// How many of a client's forms have been reviewed (saved, even if left blank),
// for the Settings card health icon. Only counts real per-form entries.
function formsDoneCount(clientId) { const fm = SETTINGS.formmeta && SETTINGS.formmeta[clientId]; return fm ? Object.values(fm).filter((v) => v && typeof v === 'object' && v.done).length : 0 }

// Per-client Meta conversion selection: which Meta conversion event is this
// client's PRIMARY reported result, plus optional SECONDARY events to show.
function loadMetaConv(clientId) { return (SETTINGS.metaconv && SETTINGS.metaconv[clientId]) || { primary: null, secondary: [] } }
function saveMetaConv(clientId, obj) {
  const next = { primary: obj.primary || null, secondary: Array.isArray(obj.secondary) ? obj.secondary : [] }
  SETTINGS.metaconv = { ...(SETTINGS.metaconv || {}), [clientId]: next }
  writeLS(METACONV_KEY, SETTINGS.metaconv); saveSettingsRemote({ metaconv: { [clientId]: next } }); bumpSettings()
}
// Suggest a pipeline for a form: the only pipeline for single-pipeline clients,
// else the best name-token overlap between the form label and a pipeline name
// (incl. a bracketed [TAG] abbreviation). '' when nothing matches.
function suggestPipeline(formName, pipes) {
  if (!pipes || !pipes.length) return ''
  if (pipes.length === 1) return pipes[0].id
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const fWords = norm(formName).split(' ').filter((w) => w.length > 2)
  const fSet = new Set(fWords); const fJoined = ' ' + fWords.join(' ') + ' '
  let best = '', bestScore = 0
  for (const p of pipes) {
    const tag = (String(p.name).match(/\[([a-z0-9]+)\]/i) || [])[1]
    const pWords = norm(p.name).split(' ').filter((w) => w.length > 2)
    let score = 0
    for (const w of pWords) if (fSet.has(w)) score++
    if (tag && fJoined.includes(' ' + tag.toLowerCase() + ' ')) score += 2
    if (score > bestScore) { bestScore = score; best = p.id }
  }
  return bestScore > 0 ? best : ''
}

/* Per-client KPI targets - { metaCpl, googleCostConv, stages: { [stageName]:
   leadsTarget }, ... }. Multi-pipeline clients keep a full target set per
   pipeline under byPipeline[pipelineId]; loadKpis(id, pid) reads that pipeline's
   set. Without a pid it returns the client-level set, falling back to the first
   pipeline's targets so account-level scorecards still show a target. */
function loadKpis(clientId, pipelineId) {
  const all = SETTINGS.kpis[clientId] || {}
  if (pipelineId) return (all.byPipeline && all.byPipeline[pipelineId]) || {}
  const { byPipeline, ...client } = all
  if (Object.keys(client).length) return client
  if (byPipeline) { const first = Object.values(byPipeline).find((v) => v && Object.keys(v).length); if (first) return first }
  return {}
}
function saveKpis(clientId, k, pipelineId) {
  const cur = SETTINGS.kpis[clientId] || {}
  const next = pipelineId ? { ...cur, byPipeline: { ...(cur.byPipeline || {}), [pipelineId]: k } } : { ...k, ...(cur.byPipeline ? { byPipeline: cur.byPipeline } : {}) }
  SETTINGS.kpis = { ...SETTINGS.kpis, [clientId]: next }; writeLS(KPI_KEY, SETTINGS.kpis); saveSettingsRemote({ kpis: { [clientId]: next } }); bumpSettings()
}
// colour helper: is `actual` hitting `target`? goodWhenUnder for cost metrics.
function kpiClass(actual, target, goodWhenUnder) { if (target == null || target === '' || !actual) return ''; const hit = goodWhenUnder ? actual <= target : actual >= target; return hit ? 'good' : 'bad' }

/* Per-client key events - ordered array mixing pipeline stage names (strings)
   and booked calendars ({ cal, label, stage? }) where `stage` links the calendar
   to the pipeline stage it represents so it sits in the right funnel order. They
   drive the Caalano360 / Meta / Google cost-per-event funnel and green columns.
   Unset = seeded defaults where known, else leads→booked→shown→won. */
function loadKeyEvents(clientId) { const v = SETTINGS.keyevents[clientId]; if (v !== undefined) return v; return SEED_KEYEVENTS[clientId] || [] }
function saveKeyEvents(clientId, arr) { SETTINGS.keyevents = { ...SETTINGS.keyevents, [clientId]: arr }; writeLS(KEV_KEY, SETTINGS.keyevents); saveSettingsRemote({ keyevents: { [clientId]: arr } }); bumpSettings() }
// reached-per-stage across a set of pipelines: cumulative from the last stage
// (an opp at a stage passed through every earlier stage), summed by stage name.
function reachedByStage(pipelines) {
  const m = new Map(); let total = 0
  for (const p of pipelines) {
    const sts = (p.stages || []).slice().sort((a, b) => a.pos - b.pos)
    let acc = 0; const reached = []
    for (let i = sts.length - 1; i >= 0; i--) { acc += sts[i].count; reached[i] = acc }
    if (sts.length) total += reached[0]
    // Name total (cross-pipeline) AND a pipeline-scoped key so a stage linked to
    // a specific pipeline resolves without colliding with a same-named stage
    // elsewhere.
    sts.forEach((s, i) => {
      m.set(s.name, (m.get(s.name) || 0) + reached[i])
      if (p.id) m.set(p.id + '::' + s.name, reached[i])
    })
  }
  return { m, total }
}

// A key event is either a pipeline stage (legacy: a bare stage-name string) or a
// booked calendar (new: { cal: '<calId>', label }). Normalise both to a common
// shape so the same funnel can mix "reached this stage" with "booked this call".
function normKeyEvents(arr) {
  return (arr || []).map((e) => {
    if (typeof e === 'string') return { kind: 'stage', ref: e, label: e, pipeline: null }
    // A calendar entry may be linked to a pipeline stage so we know where it
    // sits in the funnel order (e.stage = the linked stage name, e.pipeline =
    // which pipeline that stage belongs to, for multi-pipeline clients).
    if (e && e.cal) return { kind: 'calendar', ref: e.cal, label: e.label || 'Calendar', stage: e.stage || null, pipeline: e.pipeline || null }
    if (e && e.stage && e.cal == null) return { kind: 'stage', ref: e.stage, label: e.label || e.stage, pipeline: e.pipeline || null }
    return null
  }).filter(Boolean)
}
// Look up a stage's reached count honouring the linked pipeline: pipeline-scoped
// key (pipelineId::name) first, else the cross-pipeline name total.
function stageReachOf(rmap, pipeline, name) {
  if (!rmap || !rmap.m) return 0
  if (pipeline && rmap.m.has(pipeline + '::' + name)) return rmap.m.get(pipeline + '::' + name) || 0
  return rmap.m.get(name) || 0
}
// Stage name -> earliest pipeline position, across a set of pipelines. Lets us
// order key events by where they actually sit in the funnel.
function stagePosMap(pipelines) {
  const m = new Map()
  for (const p of pipelines || []) for (const s of (p.stages || [])) {
    const pos = s.pos == null ? 999 : s.pos
    if (!m.has(s.name) || pos < m.get(s.name)) m.set(s.name, pos)
    if (p.id) m.set(p.id + '::' + s.name, pos) // pipeline-scoped position
  }
  return m
}
// Order key events by funnel position: stage events at their stage's position,
// calendar events just before the stage they're linked to (the booking is what
// moves the lead into that stage). Unlinked events keep their insertion order,
// after the positioned ones. Stable within equal positions.
function orderKeyEvents(list, stagePos) {
  if (!stagePos || !stagePos.size) return list
  const posAt = (pipeline, name) => (pipeline && stagePos.has(pipeline + '::' + name) ? stagePos.get(pipeline + '::' + name) : stagePos.get(name))
  const posOf = (e, i) => {
    if (e.kind === 'stage') { const p = posAt(e.pipeline, e.ref); return p == null ? 900 + i : p }
    const p = e.stage ? posAt(e.pipeline, e.stage) : null
    return p == null ? 900 + i : p - 0.1 // calendar sits just ahead of its linked stage
  }
  return list.map((e, i) => ({ e, i, p: posOf(e, i) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.e)
}
// Calendars linked to the SAME pipeline stage collapse into one key event for
// that stage (bookings/shown summed) - so several calendars that mean the same
// funnel step (e.g. three reps' Discovery Calls) read as a single "Cost per
// [stage]". Every calendar event ends up with a `refs` array of its calendar
// ids; a merged group is relabelled to its stage name. Unlinked calendars stay
// on their own.
const nzStage = (s) => String(s || '').trim().toLowerCase()
function mergeCalKeyEvents(list) {
  // Stage names present as their own key-event, so a calendar named exactly like
  // a stage (but not formally linked) still merges into it.
  const stageNames = new Set(list.filter((e) => e.kind === 'stage').map((e) => nzStage(e.ref)))
  const norm = list.map((e) => (e.kind === 'calendar' && !e.stage && stageNames.has(nzStage(e.label)) ? { ...e, stage: e.label } : e))
  const out = []; const byStage = new Map()
  for (const e of norm) {
    if (e.kind !== 'calendar') { out.push(e); continue }
    if (e.stage) {
      // Merge calendars linked to the SAME pipeline stage (pipeline-scoped, so a
      // same-named stage in a different pipeline stays separate).
      const gk = (e.pipeline || '') + '::' + nzStage(e.stage)
      const g = byStage.get(gk)
      if (g) { g.refs.push(e.ref); continue }
      const merged = { kind: 'calendar', refs: [e.ref], label: e.label, stage: e.stage, pipeline: e.pipeline || null }
      byStage.set(gk, merged); out.push(merged)
    } else out.push({ kind: 'calendar', refs: [e.ref], label: e.label, stage: null, pipeline: null })
  }
  // A calendar linked to a pipeline stage IS that funnel step, so label it as the
  // stage and drop any standalone stage key-event for the same stage - otherwise
  // the stage shows twice (once as the calendar, once as the stage). The kept
  // calendar event already combines calendar bookings + pipeline-stage reach,
  // split as "via calendar" / "via pipeline" in the number + tooltip.
  for (const e of out) if (e.kind === 'calendar' && e.stage) e.label = e.stage
  const coveredName = new Set(), coveredPipe = new Set()
  for (const e of out) if (e.kind === 'calendar' && e.stage) { coveredName.add(nzStage(e.stage)); if (e.pipeline) coveredPipe.add(e.pipeline + '::' + nzStage(e.stage)) }
  return out.filter((e) => {
    if (e.kind !== 'stage') return true
    // Pipeline-scoped events dedupe on their pipeline; bare stage strings by name
    // (normalised for case / whitespace). A pipelined stage also dedupes by name
    // so a bare-named linked calendar still removes it.
    if (e.pipeline && coveredPipe.has(e.pipeline + '::' + nzStage(e.ref))) return false
    return !coveredName.has(nzStage(e.ref))
  })
}
// Normalise -> merge same-stage calendars -> order by funnel position.
function resolveKeyEvents(keyEvents, stagePos) {
  return orderKeyEvents(mergeCalKeyEvents(normKeyEvents(keyEvents)), stagePos)
}
// Per-calendar booked / shown for a channel ('all' | 'meta' | 'google'), keyed
// by calendar id, from the attribution feed's appointments.byCalendar.
function calCountMap(attribData, chan) {
  const m = new Map()
  const list = attribData && attribData.appointments && attribData.appointments.byCalendar
  if (Array.isArray(list)) {
    for (const cal of list) {
      const src = (chan && chan !== 'all' && cal.ch && cal.ch[chan]) ? cal.ch[chan] : cal
      m.set(cal.id, { name: cal.name, count: src.booked || 0, shown: src.shown || 0, cancelled: src.cancelled || 0 })
    }
  }
  return m
}
// Build the ordered funnel rows for a client's configured key events. Stage
// events read their reached count from rmap; calendar events read booked/shown
// from calMap. Returns [] when nothing configured resolves (caller shows a
// default funnel).
function keyEventRows(keyEvents, rmap, calMap, stagePos, wonTotal) {
  const rows = []
  for (const k of resolveKeyEvents(keyEvents, stagePos)) {
    if (k.kind === 'calendar') {
      let cal = 0, shown = 0, cancelled = 0, any = false
      for (const r of (k.refs || [k.ref])) { const c = calMap && calMap.get(r); if (c) { any = true; cal += c.count; shown += c.shown; cancelled += c.cancelled } }
      // Linked stage acts as a fallback: leads that reached the stage but we have
      // no calendar booking for. Approximated as stageReached - calendar bookings.
      const stageReached = k.stage ? stageReachOf(rmap, k.pipeline, k.stage) : 0
      const fromStage = Math.max(0, stageReached - cal)
      if (!any && !fromStage) continue
      rows.push({ label: k.label, count: cal + fromStage, fromCal: cal, fromStage, shown, cancelled, kind: 'calendar' })
    } else if (WON_RE.test(k.label)) {
      // Won event counts on the won STATUS (not the pipeline stage).
      const n = wonTotal != null ? wonTotal : stageReachOf(rmap, k.pipeline, k.ref)
      rows.push({ label: k.label, count: n, kind: 'won' })
    } else {
      const has = rmap && (rmap.m.has(k.ref) || (k.pipeline && rmap.m.has(k.pipeline + '::' + k.ref)))
      if (!has) continue
      rows.push({ label: k.label, count: stageReachOf(rmap, k.pipeline, k.ref), kind: 'stage' })
    }
  }
  return rows
}
// Reusable Key Events funnel card - the readable full picture of a client's key
// events: full step name, count reached (bar), % of leads, next-step conversion
// (this step ÷ the previous step), show % (calendar events) and cost per event.
// Used in Caalano360 and the Meta / Google screens so key events read the same
// everywhere. A leading "Leads" row anchors the funnel so the first key event
// gets a meaningful next-step conversion.
function KeyEventsFunnel({ rows, total, spend, currency, title, sub, caveat, style, className = '' }) {
  if (!rows || !rows.length) return null
  const money = (v) => fmtCurrency(v, currency)
  const anyCal = rows.some((r) => r.kind === 'calendar')
  // Prepend a Leads anchor so % of leads and the first next-step conversion read
  // naturally, unless the caller already leads with a "Leads" row.
  const hasLeads = /lead/i.test(rows[0].label || '') || (rows[0].kind === 'lead')
  const full = hasLeads ? rows : [{ label: 'Leads', count: total || 0, kind: 'lead' }, ...rows]
  const max = Math.max(1, ...full.map((r) => r.count))
  return (
    <div className={`card chart-card ${className}`} style={style}><h3>{title}</h3>{sub ? <p className="cap">{sub}</p> : null}
      <div className={`kef ${anyCal ? 'kef-show' : ''}`}>
        <div className="kef-row kef-head">
          <span className="kef-step">Step</span>
          <span className="kef-bar">Reached</span>
          <span className="kef-num">% leads</span>
          <span className="kef-num" title="Conversion from the previous step into this one">Next step</span>
          {anyCal ? <span className="kef-num">Show %</span> : null}
          <span className="kef-num">Cost / event</span>
        </div>
        {full.map((s, i) => {
          const pct = total ? (s.count / total) * 100 : 0
          const prev = i > 0 ? full[i - 1].count : null
          const step = prev == null ? null : (prev ? (s.count / prev) * 100 : 0)
          const showR = s.kind === 'calendar' && s.count ? (s.shown / s.count) * 100 : null
          const hue = 210 + Math.round((i / Math.max(1, full.length - 1)) * -70)
          const isLead = s.kind === 'lead'
          const barTip = s.fromStage ? `${fmtNumber(s.count)} total · ${fmtNumber(s.fromCal)} via calendar booking · ${fmtNumber(s.fromStage)} via pipeline-stage fallback` : undefined
          return (
            <div className={`kef-row${isLead ? ' kef-lead' : ''}`} key={s.label + i}>
              <span className="kef-step">{s.kind === 'calendar' ? <span className="ke-cal" title="Booked calendar appointment">📅 </span> : null}{s.label}{s.kind === 'calendar' && s.cancelled ? <span className="c360-canc" title={`${s.cancelled} later cancelled`}> ({s.cancelled}c)</span> : null}</span>
              <span className="kef-bar" title={barTip}><span className="kef-fill" style={{ width: `${Math.max(6, (s.count / max) * 100)}%`, background: `hsl(${hue} 68% 52%)` }}>{fmtNumber(s.count)}{s.fromStage ? <span className="kef-p" title={barTip}> +{fmtNumber(s.fromStage)}p</span> : null}</span></span>
              <span className="kef-num">{isLead ? '100%' : fmtPct(pct, 0)}</span>
              <span className={`kef-num ${step == null ? '' : step >= 60 ? 'good' : step < 30 ? 'bad' : ''}`}>{step == null ? '—' : fmtPct(step, 0)}</span>
              {anyCal ? <span className="kef-num">{showR == null ? '—' : fmtPct(showR, 0)}</span> : null}
              <span className="kef-num kef-cost">{isLead ? (spend && s.count ? money(spend / s.count) : '—') : (spend && s.count ? money(spend / s.count) : '—')}</span>
            </div>
          )
        })}
      </div>
      {caveat ? <p className="caveat">{caveat}</p> : null}
    </div>
  )
}

// Compact, aggregate, whole-account snapshot for the client chatbot. No
// individual contact PII - only rolled-up numbers the Caalano360 view already
// shows. Kept small so the whole thing fits comfortably in the model context.
function buildChatContext(b, attribData, camps, trendWeeks, kpis, range) {
  const n = (v) => Math.round(v || 0)
  const p = b.paid || {}, c = b.crm || {}
  const channels = attribData && attribData.channels
  const oCamp = attribData ? mkOutcomeMap(attribData.byCampaign) : null
  const topCampaigns = (camps || []).slice(0, 15).map((cc) => {
    const o = oCamp ? oCamp.get(unorm(cc.name)) : null
    return { name: cc.name, source: cc.source, spend: n(cc.spend), leads: n(cc.conv), won: o ? o.won : null, revenue: o ? n(o.revenue) : null, roas: o && cc.spend ? +(o.revenue / cc.spend).toFixed(2) : null }
  })
  const chTot = (x) => x ? { leads: x.totals.leads, booked: x.totals.booked, shown: x.totals.shown, won: x.totals.won, revenue: n(x.totals.revenue) } : null
  const all = channels && channels.all ? channels.all.totals : null
  const selfPct = all && all.tagReadable && all.booked ? +(all.selfBooked / all.booked * 100).toFixed(1) : null
  const bySource = attribData ? (attribData.bySource || []).slice(0, 10).map((s) => ({ name: s.name, leads: s.leads, booked: s.booked, won: s.won, revenue: n(s.revenue) })) : []
  const lost = (channels && channels.all ? channels.all.lostReasons : null) || []
  const weekly = (trendWeeks || []).map((w) => ({ week: w.label, spend: w.spend, leads: w.leads, booked: w.booked, shown: w.shown, won: w.won, revenue: w.wonValue }))
  return {
    period: rangeLabel(range),
    paid: { spend: n(p.adSpend), metaSpend: n(p.metaSpend), googleSpend: n(p.googleSpend), impressions: n(p.impressions), clicks: n(p.clicks), metaLeads: n(p.metaLeads), googleLeads: n(p.googleConv) },
    crm: { leads: c.leads, booked: c.booked, shown: c.shown, won: c.won, revenue: n(c.revenue), avgDeal: n(c.avgValue), selfBookingRatePct: selfPct },
    channelsMetaVsGoogle: channels ? { meta: chTot(channels.meta), google: chTot(channels.google) } : null,
    realisedWonInPeriod: b.wonClosed ? { won: b.wonClosed.total.won, revenue: n(b.wonClosed.total.revenue) } : null,
    topCampaignsBySpend: topCampaigns,
    topLeadSources: bySource,
    lostReasons: lost.slice(0, 10),
    weeklyTrend: weekly,
    targets: { weeklySpend: kpis.wkSpend, cpl: kpis.cpl, costPerBooked: kpis.cpba, costPerWon: kpis.cpa, bookingRatePct: kpis.bookingRate },
  }
}

// Client-scoped Q&A widget. Sends only the current client's snapshot to the
// chat function, so it can never surface another client's data. History is
// in-memory (never persisted) and resets when you switch clients.
function ClientChat({ clientId, clientName, period, context }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setMsgs([]); setErr(null); setInput('') }, [clientId])
  const send = async () => {
    const q = input.trim(); if (!q || loading) return
    const next = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setInput(''); setLoading(true); setErr(null)
    try {
      const r = await fetch('/.netlify/functions/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientName, period, context, messages: next }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsgs((m) => [...m, { role: 'assistant', content: j.reply }])
    } catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }
  const suggestions = ['How did Meta compare to Google this period?', 'Which campaign had the best ROAS?', 'Top reasons deals were lost?', 'How is the booking rate trending?']
  return (
    <div className={`cc-dock ${open ? 'open' : ''}`}>
      {open ? (
        <div className="cc-panel">
          <div className="cc-head">
            <div><b>Ask Caalano360</b><span className="cc-scope">{clientName} - this client only</span></div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
          </div>
          <div className="cc-body">
            {msgs.length === 0 && <div className="cc-intro">
              <p>Ask about {clientName}&apos;s blended results for {period}. Aggregate data only, scoped to this client.</p>
              <div className="cc-sugg">{suggestions.map((s) => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div>
            </div>}
            {msgs.map((m, i) => <div key={i} className={`cc-msg ${m.role}`}>{m.role === 'assistant' ? <MdText text={m.content} /> : m.content}</div>)}
            {loading && <div className="cc-msg assistant cc-thinking"><Spinner label="Thinking…" /></div>}
            {err && <div className="cc-err">{err}</div>}
          </div>
          <div className="cc-input">
            <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={`Ask about ${clientName}…`} />
            <button className="cc-send" onClick={send} disabled={loading || !input.trim()}>Send</button>
          </div>
          <div className="cc-foot">Answers come from this client&apos;s loaded data only.</div>
        </div>
      ) : (
        <button className="cc-launch" onClick={() => setOpen(true)} title="Ask about this client">💬 Ask Caalano360</button>
      )}
    </div>
  )
}

/* ============ Caalano 360 Executive Dashboard ============ */
// The executive layer that leads the Caalano 360 tab: a 0-100 business health
// score (Marketing / Sales / Operations / Revenue), headline KPI scorecard,
// run-rate forecast, revenue-at-risk and a rules-based priority list. Every
// number is computed server-side (scope=health) from the same live feeds the
// rest of the app uses; the AI summary only narrates these figures.
const hColor = (s) => (s == null ? '#9aa0a6' : s >= 70 ? '#1e9e5a' : s >= 40 ? '#d9a400' : '#d64545')
const hLabel = (s) => (s == null ? 'No data' : s >= 70 ? 'Healthy' : s >= 40 ? 'Needs attention' : 'At risk')
const PILLAR_KEYS = [['marketing', 'Marketing'], ['sales', 'Sales'], ['ops', 'Operations'], ['revenue', 'Revenue']]

function useHealth(clientId, range, nonce = 0, reload = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true
    setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?client=${clientId}&scope=health&${q}${nonce ? `&_r=${nonce}` : ''}${reload ? `&_b=${reload}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce, reload])
  return st
}

// Minimal inline SVG sparkline for the composite trend (no extra deps).
function Sparkline({ data, width = 120, height = 30 }) {
  const pts = (data || []).filter((v) => v != null)
  if (pts.length < 2) return null
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1
  const step = width / (pts.length - 1)
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1], first = pts[0]
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={hColor(last >= first ? 70 : 40)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function HealthGauge({ score }) {
  const col = hColor(score)
  return (
    <div className="hs-gauge" style={{ '--v': `${score == null ? 0 : score}%`, '--col': col }}>
      <div className="hs-gauge-inner">
        <div className="hs-num" style={{ color: col }}>{score == null ? '—' : score}</div>
        <div className="hs-den">/ 100</div>
      </div>
    </div>
  )
}

// One pillar: score bar + expandable working (each metric's actual vs the
// previous-period reference, and the 0-100 it contributed).
function PillarRow({ pk, pillar, open, onToggle, money }) {
  const s = pillar ? pillar.score : null
  const fmtVal = (v, f) => (v == null ? '—' : f === 'money' ? money(Math.round(v)) : f === 'pct' ? `${Math.round(v * 100)}%` : fmtNumber(Math.round(v)))
  return (
    <div className={`hs-pillar ${open ? 'open' : ''}`}>
      <button className="hs-pillar-head" onClick={onToggle}>
        <span className="hs-chev">{open ? '▾' : '▸'}</span>
        <span className="hs-pk">{pk}</span>
        <span className="hs-bar"><span className="hs-bar-fill" style={{ width: `${s == null ? 0 : s}%`, background: hColor(s) }} /></span>
        <span className="hs-pscore" style={{ color: hColor(s) }}>{s == null ? 'N/A' : s}</span>
      </button>
      {open && <div className="hs-pillar-body">
        {(pillar && pillar.components && pillar.components.length) ? pillar.components.map((c, i) => (
          <div className="hs-comp" key={i}>
            <span className="hs-comp-l">{c.label}</span>
            <span className="hs-comp-v">{fmtVal(c.actual, c.fmt)}<span className="hs-comp-ref"> vs {fmtVal(c.ref, c.fmt)}</span></span>
            <span className="hs-comp-s" style={{ color: hColor(c.score) }}>{c.score == null ? '—' : c.score}</span>
          </div>
        )) : <div className="cap">No data for this pillar in the selected period.</div>}
      </div>}
    </div>
  )
}

// Revenue at risk — aged, still-open deals ranked by value (reuses the Users
// open-deal drill, so each row expands to the client's notes for "why stuck").
function AtRiskPanel({ clientId, range, nonce, money }) {
  const [st, setSt] = useState({ status: 'loading', deals: [] })
  useEffect(() => {
    let alive = true
    setSt({ status: 'loading', deals: [] })
    fetch(`/.netlify/functions/windsor?scope=users&client=${clientId}&${rangeQuery(range)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => {
        const deals = []
        for (const u of (j.users || [])) for (const d of (u.openDeals || [])) deals.push({ ...d, rep: u.name })
        deals.sort((a, b) => (b.value - a.value) || ((b.ageDays || 0) - (a.ageDays || 0)))
        if (alive) setSt({ status: 'ok', deals })
      })
      .catch(() => { if (alive) setSt({ status: 'err', deals: [] }) })
    return () => { alive = false }
  }, [clientId, range.from, range.to, nonce])
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading open pipeline…" /></div>
  const deals = st.deals.slice(0, 8)
  const totOpen = st.deals.reduce((s, d) => s + (d.value || 0), 0)
  const stale = st.deals.filter((d) => (d.ageDays || 0) > 30)
  const staleVal = stale.reduce((s, d) => s + (d.value || 0), 0)
  return (
    <div className="card exec-atrisk">
      <div className="exec-panel-h">Revenue at risk <span className="sub">· {fmtNumber(st.deals.length)} open deals · {money(totOpen)} in pipeline · {fmtNumber(stale.length)} stalled &gt;30d ({money(staleVal)})</span></div>
      {deals.length ? <div className="tbl-scroll"><table className="mini-tbl users-tbl u-drill-tbl"><colgroup><col className="c-opp" /><col className="c-con" /><col className="c-val" /><col className="c-days" /></colgroup><thead><tr><th className="lft">Deal</th><th className="lft">Contact</th><th>Value</th><th>Age</th></tr></thead>
        <tbody>{deals.map((d, i) => <OpenDealRow key={d.id || i} d={d} clientId={clientId} money={money} showPipe />)}</tbody></table></div>
        : <div className="cap">No open deals in this period.</div>}
    </div>
  )
}

// Deterministic priority actions derived from the health payload + at-risk —
// no AI. Flags the biggest movers against the previous period.
function priorityActions(h, money) {
  if (!h || !h.kpis) return []
  const k = h.kpis, pv = k.prev || {}, out = []
  const dropPct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null)
  // Weakest pillar.
  const pillars = PILLAR_KEYS.map(([id, label]) => ({ id, label, s: h.score ? h.score[id] : null })).filter((p) => p.s != null).sort((a, b) => a.s - b.s)
  if (pillars.length && pillars[0].s < 50) out.push({ sev: pillars[0].s < 35 ? 'high' : 'med', text: `${pillars[0].label} is the weakest pillar at ${pillars[0].s}/100 — focus here first.` })
  // CPL rising.
  if (k.cpl != null && pv.leads && pv.adSpend) { const pc = Math.round(pv.adSpend / pv.leads); const dp = dropPct(k.cpl, pc); if (dp != null && dp >= 15) out.push({ sev: dp >= 40 ? 'high' : 'med', text: `Cost per lead up ${dp}% (${money(pc)} → ${money(k.cpl)}).` }) }
  // Lead volume down.
  if (k.leads != null && pv.leads) { const dp = dropPct(k.leads, pv.leads); if (dp != null && dp <= -15) out.push({ sev: dp <= -40 ? 'high' : 'med', text: `Lead volume down ${Math.abs(dp)}% vs last period (${fmtNumber(pv.leads)} → ${fmtNumber(k.leads)}).` }) }
  // Win/revenue down.
  if (k.revenue != null && pv.revenue) { const dp = dropPct(k.revenue, pv.revenue); if (dp != null && dp <= -15) out.push({ sev: dp <= -40 ? 'high' : 'med', text: `Revenue down ${Math.abs(dp)}% vs last period (${money(pv.revenue)} → ${money(k.revenue)}).` }) }
  // Forecast pacing behind.
  if (h.forecast && h.forecast.pacePct != null && h.forecast.pacePct < 85) out.push({ sev: h.forecast.pacePct < 70 ? 'high' : 'med', text: `Pacing at ${h.forecast.pacePct}% of last period's revenue on run-rate.` })
  return out.slice(0, 5)
}

// Revenue bottleneck — the whole-account funnel (Leads → Qualified → Booked →
// Shown → Won) with the step conversion rates, flagging the single biggest
// drop-off as the bottleneck. Built from the health KPIs (no extra fetch).
function BottleneckPanel({ kpis, money }) {
  const raw = [
    { label: 'Leads', v: kpis.leads },
    { label: 'Qualified', v: kpis.qualified },
    { label: 'Booked', v: kpis.booked },
    { label: 'Shown', v: kpis.shown },
    { label: 'Won', v: kpis.won },
  ].filter((s) => s.v != null)
  if (raw.length < 2 || !raw[0].v) return null
  const top = raw[0].v || 1
  const rows = raw.map((s, i) => { const prev = i > 0 ? raw[i - 1].v : null; return { ...s, prev, conv: prev ? s.v / prev : null, drop: prev != null ? prev - s.v : 0 } })
  const cands = rows.filter((r) => r.conv != null && r.prev > 0)
  const worst = cands.length ? cands.reduce((a, b) => (b.conv < a.conv ? b : a)) : null
  return (
    <div className="card exec-bottleneck">
      <div className="exec-panel-h">Revenue bottleneck {worst ? <span className="sub">· biggest drop-off: <b>{worst.prev != null ? rows[rows.indexOf(worst) - 1].label : ''} → {worst.label}</b> ({Math.round(worst.conv * 100)}% through, {fmtNumber(worst.drop)} lost)</span> : null}</div>
      <div className="bn-funnel">
        {rows.map((r, i) => {
          const isWorst = worst && r === worst
          return (
            <div className={`bn-row ${isWorst ? 'bn-worst' : ''}`} key={i}>
              <span className="bn-lab">{r.label}</span>
              <span className="bn-track"><span className="bn-fill" style={{ width: `${Math.max(2, (r.v / top) * 100)}%` }} /></span>
              <span className="bn-count">{fmtNumber(r.v)}</span>
              <span className="bn-conv">{r.conv == null ? '' : `${Math.round(r.conv * 100)}%`}</span>
            </div>
          )
        })}
      </div>
      <p className="caveat">Step % is each stage as a share of the one above it. The flagged step is where the most opportunities are lost — the place a small improvement moves the most revenue.</p>
    </div>
  )
}

function ExecutiveDashboard({ clientId, clientName, currency, range, nonce, onNav, authUser }) {
  const [reload, setReload] = useState(0)
  const health = useHealth(clientId, range, nonce, reload)
  const [openPillar, setOpenPillar] = useState(null)
  const [ai, setAi] = useState(() => loadInsights(clientId + ':exec'))
  const [aiLoading, setAiLoading] = useState(false)
  const [aiErr, setAiErr] = useState(null)
  const [bf, setBf] = useState({ running: false, done: 0, err: null })
  const canBackfill = !authUser || authUser.role !== 'viewer'
  useEffect(() => { setAi(loadInsights(clientId + ':exec')); setAiErr(null); setBf({ running: false, done: 0, err: null }) }, [clientId])
  const money = (v) => fmtCurrency(v, currency)
  // Seed the score trend on demand: walk the backfill cursor (weekly points,
  // ~12 months back) a few points per call, then reload health for the sparkline.
  const runBackfill = async () => {
    if (bf.running) return
    setBf({ running: true, done: 0, err: null })
    let before = null
    try {
      for (let guard = 0; guard < 60; guard++) {
        const r = await fetch(`/.netlify/functions/windsor?scope=healthbackfill&client=${clientId}${before ? `&before=${before}` : ''}`)
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
        setBf((s) => ({ ...s, done: s.done + ((j.done && j.done.length) || 0) }))
        if (!j.nextBefore) break
        before = j.nextBefore
      }
      setBf((s) => ({ ...s, running: false }))
      setReload((n) => n + 1)
    } catch (e) { setBf({ running: false, done: 0, err: String(e.message || e) }) }
  }
  const genExec = async () => {
    if (aiLoading || health.status !== 'ok') return
    setAiLoading(true); setAiErr(null)
    try {
      const payload = { mode: 'exec', clientName, period: rangeLabel(range), health: { score: health.data.score, kpis: health.data.kpis, forecast: health.data.forecast } }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const rec = { insights: j.insights, period: j.period || rangeLabel(range), generatedAt: j.generatedAt || new Date().toISOString(), model: j.model }
      saveInsights(clientId + ':exec', rec); setAi(rec)
    } catch (e) { setAiErr(String(e.message || e)) } finally { setAiLoading(false) }
  }
  if (health.status === 'loading') return <div className="card"><Spinner label="Scoring business health…" /></div>
  if (health.status === 'err' || !health.data) return <div className="note">Couldn’t load the executive health score for this period. The detailed breakdown below is still available.</div>
  const h = health.data
  const sc = h.score || {}
  const k = h.kpis || {}
  const pv = k.prev || {}
  const hist = (h.history || []).filter((p) => p.composite != null)
  const actions = priorityActions(h, money)
  const fc = h.forecast
  return (
    <div className="exec-wrap">
      {/* Header + composite gauge */}
      <div className="card exec-hero">
        <div className="exec-hero-l">
          <HealthGauge score={sc.composite} />
          <div className="exec-hero-meta">
            <div className="exec-hero-lab" style={{ color: hColor(sc.composite) }}>{hLabel(sc.composite)}</div>
            <div className="exec-hero-sub">Business health · {rangeLabel(range)}</div>
            {hist.length > 1 && <div className="exec-spark"><Sparkline data={hist.map((p) => p.composite)} /><span className="cap">{hist.length}-point trend</span></div>}
            {canBackfill && <div className="exec-bf">
              <button className="link-btn sm" onClick={runBackfill} disabled={bf.running}>{bf.running ? `Building… ${bf.done} pts` : hist.length > 1 ? '↻ Rebuild trend history' : '＋ Build trend history'}</button>
              {bf.err ? <span className="cap" style={{ color: 'var(--neg)' }}>{bf.err}</span> : hist.length <= 1 && !bf.running ? <span className="cap">seed ~12 months of weekly points</span> : null}
            </div>}
          </div>
        </div>
        <div className="exec-pillars">
          {PILLAR_KEYS.map(([id, label]) => <PillarRow key={id} pk={label} pillar={sc.pillars && sc.pillars[id]} open={openPillar === id} onToggle={() => setOpenPillar(openPillar === id ? null : id)} money={money} />)}
        </div>
      </div>

      {/* KPI scorecard */}
      <div className="scorecard exec-kpis">
        <Kpi label="Ad spend" value={k.adSpend != null ? money(k.adSpend) : '—'} cur={k.adSpend} prev={pv.adSpend} goodWhenDown />
        <Kpi label="Leads" value={k.leads != null ? fmtNumber(k.leads) : '—'} cur={k.leads} prev={pv.leads} />
        <Kpi label="Qualified" value={k.qualified != null ? fmtNumber(k.qualified) : '—'} cur={k.qualified} prev={pv.qualified} />
        <Kpi label="Cost / lead" value={k.cpl != null ? money(k.cpl) : '—'} cur={k.cpl} prev={pv.leads && pv.adSpend ? Math.round(pv.adSpend / pv.leads) : null} goodWhenDown />
        <Kpi label="Booked" value={k.booked != null ? fmtNumber(k.booked) : '—'} cur={k.booked} prev={pv.booked} />
        <Kpi label="Won" value={k.won != null ? fmtNumber(k.won) : '—'} cur={k.won} prev={pv.won} />
        <Kpi label="Revenue" value={k.revenue != null ? money(k.revenue) : '—'} cur={k.revenue} prev={pv.revenue} />
      </div>

      {/* Revenue bottleneck funnel */}
      <BottleneckPanel kpis={k} money={money} />

      <div className="exec-grid2">
        {/* Priority actions */}
        <div className="card exec-actions">
          <div className="exec-panel-h">Priority actions</div>
          {actions.length ? <ul className="exec-act-list">{actions.map((a, i) => <li key={i} className={`exec-act sev-${a.sev}`}><span className="exec-act-dot" />{a.text}</li>)}</ul>
            : <div className="cap">No red flags this period — the numbers are tracking with or ahead of last period.</div>}
          <div className="exec-nav"><button className="link-btn" onClick={() => onNav && onNav('users')}>Open the Users tab →</button></div>
        </div>
        {/* Forecast */}
        <div className="card exec-forecast">
          <div className="exec-panel-h">Forecast <span className="sub">· run-rate at {fc ? fc.elapsedPct : 0}% of period</span></div>
          {fc ? <div className="exec-fc-grid">
            <div className="exec-fc"><span className="exec-fc-l">Projected revenue</span><span className="exec-fc-v">{money(fc.projectedRevenue)}</span><span className="cap">{fc.prevRevenue != null ? `last period ${money(fc.prevRevenue)}` : 'no prior period'}</span></div>
            <div className="exec-fc"><span className="exec-fc-l">Projected leads</span><span className="exec-fc-v">{fmtNumber(fc.projectedLeads)}</span><span className="cap">{fc.prevLeads != null ? `last period ${fmtNumber(fc.prevLeads)}` : ''}</span></div>
            <div className="exec-fc"><span className="exec-fc-l">Projected deals won</span><span className="exec-fc-v">{fmtNumber(fc.projectedWon)}</span><span className="cap">{fc.prevWon != null ? `last period ${fmtNumber(fc.prevWon)}` : ''}</span></div>
            {fc.pacePct != null && <div className="exec-fc"><span className="exec-fc-l">Pace vs last period</span><span className="exec-fc-v" style={{ color: hColor(fc.pacePct >= 100 ? 80 : fc.pacePct >= 85 ? 55 : 30) }}>{fc.pacePct}%</span><span className="cap">of prior revenue</span></div>}
          </div> : <div className="cap">Forecast needs a prior period to compare against.</div>}
        </div>
      </div>

      {/* AI executive summary — narrates the figures above; never recomputes them */}
      <div className="card ai-card exec-ai">
        <div className="ai-head">
          <div className="ai-title">✨ AI executive summary {ai ? <span className="sub">· {ai.period} · generated {new Date(ai.generatedAt).toLocaleString()}</span> : <span className="sub">· Claude reads the health score above and briefs you</span>}</div>
          <button className="ai-btn" onClick={genExec} disabled={aiLoading}>{aiLoading ? 'Generating…' : ai ? '↻ Regenerate' : '✨ Generate summary'}</button>
        </div>
        {aiErr && <p className="cap" style={{ color: 'var(--neg)', margin: '2px 0 0' }}>{aiErr}</p>}
        {aiLoading ? <Spinner label="Claude is reviewing the numbers…" />
          : ai ? <MdText text={ai.insights} />
            : <p className="cap" style={{ margin: 0 }}>Generate a board-level read of {clientName}'s health score, forecast and priority flags for {rangeLabel(range)}. Runs only when you click; the figures are computed here and Claude only interprets them.</p>}
      </div>

      {/* Revenue at risk */}
      <AtRiskPanel clientId={clientId} range={range} nonce={nonce} money={money} />

      <div className="cap exec-foot">Health is scored against the previous equal-length period. A consistent daily trend builds from launch as snapshots accumulate. Messaging/response signals are indicative only — clients may reply on channels outside Caalano Systems.</div>
    </div>
  )
}

function Caalano360({ blend, client, currency, range, nonce, utmAttr }) {
  const b = blend
  const users = b.users || []
  const camps = b.campaigns || []
  const [uid, setUid] = useState('all')
  const [pid, setPid] = useState('all')
  const [chan, setChan] = useState('all')
  const [wonBasis, setWonBasis] = useState('created') // 'created' (marketing) | 'closed' (revenue)
  const [trendMetric, setTrendMetric] = useState('money') // 'money' | 'funnel'
  const trend = useWeeklyBlend(client.id, 13, nonce)
  const kpis = loadKpis(client.id)
  const [ai, setAi] = useState(() => loadInsights(client.id + ':360'))
  const [aiLoading, setAiLoading] = useState(false)
  const [aiErr, setAiErr] = useState(null)
  useEffect(() => { setAi(loadInsights(client.id + ':360')); setAiErr(null) }, [client.id])
  useEffect(() => { setPid('all'); setChan('all'); setUid('all'); setWonBasis('created') }, [client.id])
  useEffect(() => { setPid('all') }, [chan, uid])
  // User + channel are separate filters over the same CRM feed; only one at a
  // time (the channel split has no per-user breakdown).
  useEffect(() => { if (uid !== 'all') setChan('all') }, [uid])
  useEffect(() => { if (chan !== 'all') setUid('all') }, [chan])
  // Base CRM view: whole account or one assigned user.
  const base = uid !== 'all' ? (users.find((u) => u.id === uid) || b) : b
  const pipes = base.pipelines || []
  const manual = loadCampMap(client.id) // editing lives in Settings; read latest each render
  const effTarget = (name) => manual[name] ?? (camps.find((x) => x.name === name)?.auto) ?? 'all'
  // attribute campaign spend to the selected pipeline (or 'all' = account totals)
  const attrFor = (id) => {
    let metaSpend = 0, googleSpend = 0, adConversions = 0; const list = []
    for (const cc of camps) { const t = effTarget(cc.name); if (t === id || t === 'all') { if (cc.source === 'Meta') metaSpend += cc.spend; else googleSpend += cc.spend; adConversions += cc.conv; list.push({ ...cc, target: t }) } }
    return { metaSpend, googleSpend, adSpend: metaSpend + googleSpend, adConversions, campaigns: list }
  }
  const p = b.paid
  // UTM-split CRM (Meta / Google / All) from the direct Caalano Systems attribution feed.
  const attribData = (utmAttr && utmAttr.status === 'ok' && utmAttr.data && utmAttr.data.attribution) || null
  const channels = (attribData && attribData.channels) || null
  const canChan = !!channels && ((channels.meta?.totals?.leads || 0) > 0 || (channels.google?.totals?.leads || 0) > 0)
  const norm360 = (t) => ({ leads: t.leads, booked: t.booked, shown: t.shown, shownStage: t.shownStage || 0, cancelled: t.cancelled || 0, won: t.won, revenue: t.revenue, avgValue: t.avgWonValue, openValue: t.openValue, lost: t.lost, open: t.open })
  const chSel = chan !== 'all' && channels ? channels[chan] : null
  const pipesSrc = chSel ? (chSel.pipelines || []) : pipes
  // Booked / Shown come from the date-of-action attribution feed so the blended
  // funnel matches the Meta/Google tabs exactly. For the "All" channel we graft
  // those onto the account CRM view (which carries leads/won/pipelines); this
  // only applies at account level (uid all), since the attribution feed has no
  // per-assigned-user split.
  const crmAll = chSel
    ? norm360(chSel.totals)
    : (channels && channels.all && uid === 'all')
      ? { ...base.crm, booked: channels.all.totals.booked, shown: channels.all.totals.shown, shownStage: channels.all.totals.shownStage || 0, cancelled: channels.all.totals.cancelled || 0 }
      : base.crm
  const multiSrc = pipesSrc.length > 1
  const c = pid === 'all' ? crmAll : (pipesSrc.find((x) => x.id === pid)?.crm || crmAll)
  const attr = pid === 'all'
    ? { adSpend: p.adSpend, metaSpend: p.metaSpend, googleSpend: p.googleSpend, adConversions: p.adConversions, campaigns: camps.map((x) => ({ ...x, target: effTarget(x.name) })) }
    : attrFor(pid)
  const spend = chan === 'meta' ? attr.metaSpend : chan === 'google' ? attr.googleSpend : attr.adSpend
  const lostReasons = chSel ? chSel.lostReasons : (channels && channels.all ? channels.all.lostReasons : null)
  // Won/revenue lens: 'created' (leads created in period, marketing cohort) or
  // 'closed' (deals marked Won in period, any created date, from wonInPeriod).
  const wonClosed = b.wonClosed || null
  const wcSlice = !wonClosed ? null
    : uid !== 'all' ? wonClosed.byUser[uid]
      : chan !== 'all' ? (wonClosed.channels && wonClosed.channels[chan])
        : pid !== 'all' ? wonClosed.byPipeline[pid]
          : wonClosed.total
  const useClosed = wonBasis === 'closed' && !!wcSlice
  const dWon = useClosed ? wcSlice.won : c.won
  const dRev = useClosed ? wcSlice.revenue : c.revenue
  const dAov = useClosed ? wcSlice.avgValue : c.avgValue
  // Contact self-booking rate from the attribution feed (booked deals whose
  // contact self-booked via the "customer booked appointment" tag). Only the
  // attribution channels carry it, so it is account / channel level (no per
  // pipeline or user split) and shown only when tags are actually readable.
  const sbSlice = channels ? channels[chan === 'all' ? 'all' : chan] : null
  const sbBooked = sbSlice ? (sbSlice.totals.booked || 0) : 0
  const sbSelf = sbSlice ? (sbSlice.totals.selfBooked || 0) : 0
  const sbRate = sbBooked ? (sbSelf / sbBooked) * 100 : null
  const showSelfBook = !!(sbSlice && sbSlice.totals.tagReadable) && sbBooked > 0 && uid === 'all' && pid === 'all'
  // Whole-account aggregate snapshot for the client chatbot (filter-independent).
  const chatContext = useMemo(() => buildChatContext(b, attribData, camps, trend.weeks, kpis, range), [b, attribData, camps, trend.weeks, kpis, range])
  const roas = spend ? dRev / spend : 0
  // LTV / LTV:CAC. LTV is a per-client setting (Settings), falling back to the
  // average deal value; CAC = spend per won client.
  const ltvSet = Number(kpis.clientLtv) > 0 ? Number(kpis.clientLtv) : null
  const ltvVal = ltvSet || (dWon ? dAov : null)
  const cacVal = dWon && spend ? spend / dWon : null
  const ltvCac = ltvVal != null && cacVal ? ltvVal / cacVal : null
  const ltvCacCls = ltvCac == null ? 'info' : ltvCac >= 3 ? 'good' : ltvCac >= 1 ? 'info' : 'bad'
  // Previous equal-length period - deltas only at account level (no per-pipeline
  // / channel / user split in the prior period).
  const pv = (uid === 'all' && chan === 'all' && pid === 'all' && b.prev) ? b.prev : null
  const pc = pv ? pv.crm : null
  const money = (v) => fmtCurrency(v, currency)
  const chanPie = chan === 'meta' ? [{ name: 'Meta', value: attr.metaSpend, color: '#4f7cff' }].filter((x) => x.value > 0)
    : chan === 'google' ? [{ name: 'Google', value: attr.googleSpend, color: '#12b886' }].filter((x) => x.value > 0)
    : [{ name: 'Meta', value: attr.metaSpend, color: '#4f7cff' }, { name: 'Google', value: attr.googleSpend, color: '#12b886' }].filter((x) => x.value > 0)
  // Key Events funnel - user-chosen pipeline stages AND booked calendars
  // (Settings), else the default leads → booked → shown → won. Calendar events
  // read booked/shown from the attribution feed (channel-aware); stage events
  // read reached counts from the pipeline funnel. Cost per event = spend ÷ count.
  const keyEvents = loadKeyEvents(client.id)
  const scopePipes = pid !== 'all' ? pipesSrc.filter((x) => x.id === pid) : pipesSrc
  const rmap = reachedByStage(scopePipes)
  const keCalMap = calCountMap(attribData, chan)
  const keConfigured = keyEventRows(keyEvents, rmap, keCalMap, stagePosMap(scopePipes), c.won)
  const keTotal = Math.max(1, c.leads || rmap.total)
  const keRows = keConfigured.length
    ? keConfigured
    : [{ label: 'Leads', count: c.leads, kind: 'stage' }, { label: 'Bookings', count: c.booked, kind: 'stage' }, { label: 'Shown', count: c.shown, kind: 'stage' }, { label: 'Won', count: c.won, kind: 'stage' }]
  const activeStages = pid !== 'all'
    ? (pipesSrc.find((x) => x.id === pid)?.stages || [])
    : (pipesSrc.length === 1 ? pipesSrc[0].stages : null)
  const stageMax = activeStages ? Math.max(1, ...activeStages.map((s) => s.count)) : 1
  const stageName = pid !== 'all' ? pipesSrc.find((x) => x.id === pid)?.name : (pipesSrc.length === 1 ? pipesSrc[0].name : null)
  const genInsights = async () => {
    if (aiLoading) return
    setAiLoading(true); setAiErr(null)
    try {
      const oCamp = attribData ? mkOutcomeMap(attribData.byCampaign) : null
      const topCampaigns = camps.slice(0, 8).map((cc) => {
        const o = oCamp ? oCamp.get(unorm(cc.name)) : null
        return { name: cc.name, source: cc.source, spend: cc.spend, leads: cc.conv, won: o ? o.won : null, revenue: o ? o.revenue : null, roas: o && cc.spend ? o.revenue / cc.spend : null }
      })
      const chTot = (x) => x ? { leads: x.totals.leads, booked: x.totals.booked, shown: x.totals.shown, won: x.totals.won, revenue: x.totals.revenue } : null
      const payload = {
        mode: 'blend', clientName: client.name, period: rangeLabel(range),
        scope: (chan === 'all' && pid === 'all' && uid === 'all') ? 'whole account' : 'filtered view',
        blend: {
          spend, metaSpend: p.metaSpend, googleSpend: p.googleSpend, impressions: p.impressions, clicks: p.clicks,
          leads: c.leads, metaLeads: p.metaLeads, googleLeads: p.googleConv,
          booked: c.booked, shown: c.shown, won: c.won, revenue: c.revenue, avgDeal: c.avgValue,
          prev: pc ? { spend: pv.adSpend, leads: pc.leads, booked: pc.booked, won: pc.won, revenue: pc.revenue } : null,
          wonClosed: wonClosed ? { won: wonClosed.total.won, revenue: wonClosed.total.revenue } : null,
          channels: channels ? { meta: chTot(channels.meta), google: chTot(channels.google) } : null,
          topCampaigns, lostReasons: lostReasons || [],
          targets: { wkSpend: kpis.wkSpend, cpl: kpis.cpl, cpba: kpis.cpba, cpa: kpis.cpa, bookingRate: kpis.bookingRate },
        },
      }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const rec = { insights: j.insights, period: j.period || rangeLabel(range), generatedAt: j.generatedAt || new Date().toISOString(), model: j.model }
      saveInsights(client.id + ':360', rec); setAi(rec)
    } catch (e) { setAiErr(String(e.message || e)) } finally { setAiLoading(false) }
  }
  return (
    <>
      <div className="print-head">
        <div className="print-brand"><span className="print-logo">360</span><div><div className="print-t">Caalano360 report</div><div className="print-s">Prepared by Caalano Digital</div></div></div>
        <div className="print-meta"><div className="print-cn">{client.name}</div><div className="print-s">{rangeLabel(range)}{chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''} · generated {new Date().toLocaleDateString()}</div></div>
      </div>
      <div className="c360-head">
        <div className="section-title" style={{ margin: 0 }}>Caalano360 <span className="sub">· blended paid + Caalano Systems · {rangeLabel(range)}{chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''}{uid !== 'all' ? ` · ${users.find((u) => u.id === uid)?.name || 'user'}` : ''}{pid !== 'all' ? ' · attributed spend' : ''}</span></div>
        <div className="c360-controls">
          <button className="print-btn no-print" onClick={() => window.print()} title="Export this view as a PDF (print to PDF)">⤓ Export PDF</button>
          {canChan && <div className="chan-toggle">
            {[['all', 'All'], ['meta', 'Meta'], ['google', 'Google']].map(([k, lbl]) => (
              <button key={k} className={chan === k ? 'on' : ''} onClick={() => setChan(k)}>{lbl}</button>
            ))}
          </div>}
          {users.length > 1 && <div className="pipe-sel"><label>User</label>
            <select value={uid} onChange={(e) => setUid(e.target.value)}>
              <option value="all">All users ({fmtNumber(b.crm.leads)})</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({fmtNumber(u.leads)})</option>)}
            </select>
          </div>}
          {multiSrc && <div className="pipe-sel"><label>Pipeline</label>
            <select value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="all">All pipelines ({fmtNumber(crmAll.leads)})</option>
              {pipesSrc.map((x) => <option key={x.id} value={x.id}>{x.name} ({fmtNumber(x.crm.leads)})</option>)}
            </select>
          </div>}
          {wonClosed && <div className="pipe-sel"><label>Won by</label>
            <div className="chan-toggle">
              <button className={wonBasis === 'created' ? 'on' : ''} onClick={() => setWonBasis('created')} title="Deals from leads created in this period (marketing cohort)">Lead created</button>
              <button className={wonBasis === 'closed' ? 'on' : ''} onClick={() => setWonBasis('closed')} title="Deals marked Won in this period, any created date (realised revenue)">Deal won</button>
            </div>
          </div>}
        </div>
      </div>
      {wonClosed && <p className={`basis-note ${useClosed ? 'closed' : ''}`}>
        {useClosed
          ? <><b>Deal-won basis:</b> Won, Revenue, Avg Deal, Cost/Won & ROAS below are deals <b>marked Won in {rangeLabel(range)}</b>, no matter when the lead was created - your realised revenue this window.{wonClosed.capped ? ' (High volume: some very old deals may be excluded.)' : ''} <b>*</b> Cost/Won & ROAS divide this period&apos;s spend by those wins, so they mix periods - read them as directional, not a clean efficiency figure. Leads, Bookings & Shown remain by lead-created date.</>
          : <><b>Lead-created basis:</b> Won & Revenue below are for opportunities <b>created in {rangeLabel(range)}</b> (the cohort your spend generated). This matches ad ROAS but a recent window keeps maturing as leads close. Switch to <b>Deal won</b> for realised revenue.</>}
      </p>}
      <div className="scorecard">
        <Sc label={pid === 'all' ? 'Ad Spend' : 'Attributed Spend'} value={money(spend)} cur={spend} prev={pv ? pv.adSpend : null} />
        <Sc label="Total Leads" value={fmtNumber(c.leads)} cur={c.leads} prev={pc ? pc.leads : null} />
        <Sc label="Bookings Made" value={<>{fmtNumber(c.booked)}{c.cancelled ? <span className="c360-canc" title={`${c.cancelled} later cancelled`}> ({c.cancelled}c)</span> : null}</>} cur={c.booked} prev={pc ? pc.booked : null} />
        <Sc label="Shown Bookings" value={<>{fmtNumber(c.shown)}{c.shownStage ? <span className="c360-infer" title={`${c.shownStage} counted from pipeline stage`}> ({c.shownStage}p)</span> : null}</>} cur={c.shown} prev={pc ? pc.shown : null} />
        {showSelfBook && <Sc label="Self-Booked Rate" value={fmtPct(sbRate, 1)} kpi={{ text: `${fmtNumber(sbSelf)}/${fmtNumber(sbBooked)} self-served`, cls: 'info' }} />}
        <Sc label={useClosed ? 'Won (closed)' : 'Won (created)'} value={fmtNumber(dWon)} cur={useClosed ? null : c.won} prev={!useClosed && pc ? pc.won : null} />
        <Sc label={useClosed ? 'Revenue (won in period)' : 'Revenue (created)'} value={money(dRev)} cur={useClosed ? null : c.revenue} prev={!useClosed && pc ? pc.revenue : null} />
        <Sc label="Avg Deal Value" value={dWon ? money(dAov) : '-'} cur={useClosed ? null : c.avgValue} prev={!useClosed && pc ? pc.avgValue : null} />
        <Sc label="Cost / Lead" value={spend && c.leads ? money(spend / c.leads) : '-'} cur={spend && c.leads ? spend / c.leads : null} prev={pv && pc && pc.leads ? pv.adSpend / pc.leads : null} goodWhenDown />
        <Sc label="Cost / Booked" value={spend && c.booked ? money(spend / c.booked) : '-'} cur={spend && c.booked ? spend / c.booked : null} prev={pv && pc && pc.booked ? pv.adSpend / pc.booked : null} goodWhenDown />
        <Sc label={useClosed ? 'Cost / Won *' : 'Cost / Won'} value={spend && dWon ? money(spend / dWon) : '-'} cur={useClosed ? null : (spend && c.won ? spend / c.won : null)} prev={!useClosed && pv && pc && pc.won ? pv.adSpend / pc.won : null} goodWhenDown />
        <Sc label={useClosed ? 'ROAS *' : 'ROAS'} value={spend ? `${roas.toFixed(2)}×` : '-'} cur={useClosed ? null : (spend ? roas : null)} prev={!useClosed && pv && pc && pv.adSpend ? pc.revenue / pv.adSpend : null} />
        <Sc label="Conversion Rate" value={fmtPct(rate(c.won, c.leads), 1)} cur={rate(c.won, c.leads)} prev={pc ? rate(pc.won, pc.leads) : null} />
        <Sc label={ltvSet ? 'LTV' : 'LTV (avg deal)'} value={ltvVal != null ? money(ltvVal) : '-'} flat={ltvSet ? null : 'set LTV in Settings'} />
        <Sc label="LTV : CAC" value={ltvCac != null ? `${ltvCac.toFixed(1)}:1` : '-'} kpi={ltvCac != null ? { text: ltvCac >= 3 ? 'healthy' : ltvCac >= 1 ? 'okay' : 'underwater', cls: ltvCacCls } : null} />
      </div>
      <div className="card ai-card" style={{ marginTop: 14 }}>
        <div className="ai-head">
          <div className="ai-title">✨ AI insights {ai ? <span className="sub">· {ai.period} · generated {new Date(ai.generatedAt).toLocaleString()}</span> : <span className="sub">· Claude reads this blended view and tells you what it means</span>}</div>
          <button className="ai-btn" onClick={genInsights} disabled={aiLoading}>{aiLoading ? 'Generating…' : ai ? '↻ Regenerate' : '✨ Generate AI insights'}</button>
        </div>
        {aiErr && <p className="cap" style={{ color: 'var(--neg)', margin: '2px 0 0' }}>{aiErr}</p>}
        {aiLoading ? <Spinner label="Claude is analysing the whole picture…" />
          : ai ? <MdText text={ai.insights} />
            : <p className="cap" style={{ margin: 0 }}>Generate a written read of this client's blended Meta + Google spend against their Caalano Systems funnel, revenue and targets for {rangeLabel(range)}. It only runs when you click, and stays saved to this client until you regenerate.</p>}
      </div>
      {(() => {
        const hasTarget = [kpis.wkSpend, kpis.cpl, kpis.cpba, kpis.cpa, kpis.bookingRate].some((v) => Number(v) > 0)
        if (!hasTarget || (spend <= 0 && c.leads <= 0)) return null
        const wholeAccount = chan === 'all' && pid === 'all' && uid === 'all'
        // Period elapsed (local calendar day, matching the range presets).
        const dOf = (s) => new Date(s + 'T00:00:00')
        const DAY = 86400000
        const fromD = dOf(range.from), toD = dOf(range.to), todayD = dOf(iso(new Date()))
        const totalDays = Math.max(1, Math.round((toD - fromD) / DAY) + 1)
        const endD = todayD < toD ? todayD : toD
        const elapsedDays = todayD < fromD ? 0 : Math.max(1, Math.round((endD - fromD) / DAY) + 1)
        const inProgress = todayD <= toD
        const fracEl = Math.min(1, elapsedDays / totalDays)
        // Budget pacing (account-level target only, so whole-account scope only).
        const wk = Number(kpis.wkSpend) || 0
        const budget = wholeAccount && wk > 0 ? (() => {
          const daily = wk / 7
          const periodBudget = daily * totalDays
          const expected = daily * elapsedDays
          const projected = elapsedDays ? (spend / elapsedDays) * totalDays : spend
          const paceRatio = expected ? spend / expected : 0
          const off = Math.abs(paceRatio - 1)
          const cls = off <= 0.1 ? 'good' : 'warn'
          const word = paceRatio > 1.1 ? 'ahead of pace' : paceRatio < 0.9 ? 'behind pace' : 'on pace'
          return { periodBudget, expected, projected, paceRatio, cls, word }
        })() : null
        // Efficiency KPIs vs target (reflect the active filter).
        const eff = [
          kpis.cpl > 0 && { l: 'Cost / Lead', v: c.leads ? spend / c.leads : null, t: Number(kpis.cpl), under: true },
          kpis.cpba > 0 && { l: 'Cost / Booked', v: c.booked ? spend / c.booked : null, t: Number(kpis.cpba), under: true },
          kpis.cpa > 0 && { l: 'Cost / Won', v: c.won ? spend / c.won : null, t: Number(kpis.cpa), under: true },
          kpis.bookingRate > 0 && { l: 'Booking Rate', v: c.leads ? (c.booked / c.leads) * 100 : null, t: Number(kpis.bookingRate), under: false, pct: true },
        ].filter(Boolean)
        const pctBar = (n) => `${Math.min(100, Math.max(0, n * 100))}%`
        return (
          <div className="card th-card pace-card" style={{ marginTop: 14 }}>
            <div className="th-head">
              <h3>Goal pacing</h3>
              <span className="th-cov" style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>{Math.round(fracEl * 100)}% of {rangeLabel(range).toLowerCase()} elapsed{inProgress ? '' : ' (complete)'}</span>
            </div>
            {budget && (
              <div className="pace-budget">
                <div className="pace-bud-top">
                  <span><b>{money(spend)}</b> of {money(Math.round(budget.periodBudget))} budget</span>
                  <span className={`pace-word ${budget.cls}`}>{budget.word}</span>
                </div>
                <div className="pace-track">
                  <span className="pace-fill" style={{ width: pctBar(spend / budget.periodBudget) }} />
                  <span className="pace-mark" style={{ left: pctBar(budget.expected / budget.periodBudget) }} title={`Today's pace: ${money(Math.round(budget.expected))}`} />
                </div>
                <div className="pace-bud-sub">
                  <span>Pace to date: {money(Math.round(budget.expected))}</span>
                  {inProgress && <span>Projected {rangeLabel(range).toLowerCase()}: <b>{money(Math.round(budget.projected))}</b></span>}
                </div>
              </div>
            )}
            {eff.length > 0 && (
              <div className="th-grid" style={{ marginTop: budget ? 14 : 0 }}>
                {eff.map((e) => {
                  const hit = e.v == null ? null : e.under ? e.v <= e.t : e.v >= e.t
                  const cls = hit == null ? '' : hit ? 'good' : 'bad'
                  const val = e.v == null ? '-' : e.pct ? fmtPct(e.v, 1) : money(e.v)
                  const tgt = e.pct ? `${e.t}%` : money(e.t)
                  return (
                    <div className="th-stat" key={e.l}>
                      <div className="th-l">{e.l}</div>
                      <div className={`th-v ${cls}`}>{val}</div>
                      <div className="th-sub">Target {e.under ? '≤' : '≥'} {tgt} {hit == null ? '' : hit ? '· on target' : '· off target'}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="caveat">{budget ? 'Budget pace assumes even daily spend from your weekly target. ' : ''}Efficiency targets reflect the current filter{wholeAccount ? '' : ' (channel / pipeline / user)'}. Cost per won uses lead-created wins. Set targets in Settings.</p>
          </div>
        )
      })()}
      {b.hasCrm && (p.impressions > 0 || p.adSpend > 0) && (() => {
        const fs = chan === 'meta' ? { lbl: 'Meta', spend: p.metaSpend, impr: p.metaImpr || 0, clicks: p.metaClicks || 0, crm: channels?.meta?.totals }
          : chan === 'google' ? { lbl: 'Google', spend: p.googleSpend, impr: p.googleImpr || 0, clicks: p.googleClicks || 0, crm: channels?.google?.totals }
            : { lbl: 'whole account', spend: p.adSpend, impr: p.impressions || 0, clicks: p.clicks || 0, crm: b.crm }
        const fc = fs.crm || {}
        const fWonSlice = wonClosed ? (chan !== 'all' ? (wonClosed.channels && wonClosed.channels[chan]) : wonClosed.total) : null
        const fWon = (useClosed && fWonSlice) ? fWonSlice.won : (fc.won || 0)
        const fRev = (useClosed && fWonSlice) ? fWonSlice.revenue : (fc.revenue || 0)
        const sp = fs.spend
        const stages = [
          { key: 'spend', label: 'Ad Spend', val: sp, money: true },
          { key: 'impr', label: 'Impressions', val: fs.impr },
          { key: 'clicks', label: 'Clicks', val: fs.clicks },
          { key: 'leads', label: 'Leads', val: fc.leads || 0 },
          { key: 'booked', label: 'Booked', val: fc.booked || 0 },
          { key: 'shown', label: 'Shown', val: fc.shown || 0 },
          { key: 'won', label: useClosed ? 'Won (closed)' : 'Won', val: fWon },
          { key: 'revenue', label: 'Revenue', val: fRev, money: true },
        ]
        const costOf = (key) => key === 'impr' ? (sp && fs.impr ? sp / fs.impr * 1000 : null)
          : key === 'clicks' ? (sp && fs.clicks ? sp / fs.clicks : null)
            : key === 'leads' ? (sp && fc.leads ? sp / fc.leads : null)
              : key === 'booked' ? (sp && fc.booked ? sp / fc.booked : null)
                : key === 'shown' ? (sp && fc.shown ? sp / fc.shown : null)
                  : key === 'won' ? (sp && fWon ? sp / fWon : null) : null
        const costLbl = { impr: 'CPM', clicks: 'CPC', leads: 'CPL', booked: 'Cost/booked', shown: 'Cost/shown', won: 'Cost/won' }
        const convLbl = { clicks: 'CTR', leads: 'Click→lead', booked: 'Lead→booked', shown: 'Booked→shown', won: 'Shown→won', revenue: 'Avg deal' }
        return (
          <div className="card chart-card" style={{ marginTop: 14 }}>
            <h3>Full funnel: ad spend → revenue</h3><p className="cap">{fs.lbl} · cost per step &amp; step conversion{chan === 'all' && (pid !== 'all' || uid !== 'all') ? ' · whole account (ignores pipeline/user filter)' : ''}</p>
            <div className="funl2">
              {(() => {
                const body = stages.filter((s) => s.key !== 'spend' && s.key !== 'revenue')
                const topVal = Math.max(1, ...body.map((s) => s.val || 0))
                const widthOf = (v) => 16 + 84 * Math.pow(Math.max(0, v) / topVal, 0.35)
                return stages.map((s, i) => {
                  const cost = costOf(s.key)
                  const hue = 210 + Math.round((i / (stages.length - 1)) * -70)
                  const nxt = stages[i + 1]
                  let connText = null
                  if (nxt) {
                    if (nxt.key === 'impr') connText = null
                    else if (nxt.key === 'revenue') connText = fWon ? `${convLbl.revenue} ${money(fRev / fWon)}` : null
                    else connText = s.val ? `${convLbl[nxt.key]} ${fmtPct((nxt.val / s.val) * 100, 1)}` : `${convLbl[nxt.key]} -`
                  }
                  const isEnd = s.key === 'spend' || s.key === 'revenue'
                  const w = isEnd ? 100 : widthOf(s.val)
                  const costTxt = cost != null ? `${costLbl[s.key]} ${money(cost)}` : s.key === 'revenue' && sp ? `ROAS ${(fRev / sp).toFixed(2)}×` : s.key === 'spend' ? 'input' : ''
                  return (
                    <React.Fragment key={s.key}>
                      <div className="funl2-row">
                        <span className="funl2-lbl">{s.label}</span>
                        <div className="funl2-track">
                          <div className={`funl2-bar${isEnd ? ' end' : ''}`} style={{ width: `${w}%`, background: isEnd ? undefined : `linear-gradient(90deg, hsl(${hue} 72% 46%), hsl(${hue} 72% 58%))` }}>
                            <span className="funl2-val">{s.money ? money(s.val) : fmtNumber(s.val)}</span>
                          </div>
                        </div>
                        <span className="funl2-cost">{costTxt}</span>
                      </div>
                      {connText && <div className="funl2-conn">↓ {connText}</div>}
                    </React.Fragment>
                  )
                })
              })()}
            </div>
            <p className="caveat">Spend / impressions / clicks are {fs.lbl === 'whole account' ? 'account' : fs.lbl} paid; leads → won come from Caalano Systems (leads = opportunities created). Cost per step = spend ÷ that step.{useClosed ? ' Won uses the Deal-won basis.' : ''}</p>
          </div>
        )
      })()}
      {b.hasCrm && attribData && camps.length > 0 && (() => {
        const oCamp = mkOutcomeMap(attribData.byCampaign)
        const src = chan === 'meta' ? 'Meta' : chan === 'google' ? 'Google' : null
        const rows = camps
          .filter((cc) => cc.spend > 0 && (!src || cc.source === src))
          .map((cc) => {
            const o = oCamp.get(unorm(cc.name))
            const won = o ? o.won : null
            const revenue = o ? o.revenue : null
            const booked = o ? o.booked : null
            return {
              name: cc.name, source: cc.source, spend: cc.spend, leads: cc.conv,
              booked, won, revenue,
              cpl: cc.conv ? cc.spend / cc.conv : null,
              roas: revenue != null ? revenue / cc.spend : null,
              cpa: won ? cc.spend / won : null,
              matched: !!o,
            }
          })
          .sort((a, z) => z.spend - a.spend)
        if (!rows.length) return null
        const tot = rows.reduce((a, r) => ({ spend: a.spend + r.spend, leads: a.leads + r.leads, won: a.won + (r.won || 0), revenue: a.revenue + (r.revenue || 0) }), { spend: 0, leads: 0, won: 0, revenue: 0 })
        const totRoas = tot.spend ? tot.revenue / tot.spend : 0
        const matchedRev = rows.filter((r) => r.matched).length
        const roasCls = (v) => v == null ? '' : v >= 3 ? 'good' : v >= 1 ? 'warn' : 'bad'
        return (
          <div className="card chart-card" style={{ marginTop: 14 }}>
            <h3>Revenue &amp; ROAS by campaign</h3>
            <p className="cap">Ad spend joined to Caalano Systems won revenue by campaign (UTM matched){src ? ` · ${src} only` : ''}</p>
            <div className="table-wrap">
              <table className="camp-roas">
                <thead><tr>
                  <th>Campaign</th><th>Src</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Won</th><th>Cost/Won</th><th>Revenue</th><th>ROAS</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.source + r.name}>
                      <td className="camp-nm" title={r.name}>{r.name}</td>
                      <td><span className={`src-b ${r.source === 'Meta' ? 'meta' : 'google'}`}>{r.source === 'Meta' ? 'M' : 'G'}</span></td>
                      <td>{money(r.spend)}</td>
                      <td>{fmtNumber(r.leads)}</td>
                      <td>{r.cpl != null ? money(r.cpl) : '-'}</td>
                      <td>{r.matched ? fmtNumber(r.won) : <span className="faint" title="No UTM-matched opportunities for this campaign">n/a</span>}</td>
                      <td>{r.cpa != null ? money(r.cpa) : '-'}</td>
                      <td>{r.matched ? money(r.revenue) : '-'}</td>
                      <td className={`roas-c ${roasCls(r.roas)}`}>{r.roas != null ? `${r.roas.toFixed(2)}×` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td>Total ({rows.length})</td><td></td>
                  <td>{money(tot.spend)}</td>
                  <td>{fmtNumber(tot.leads)}</td>
                  <td>{tot.leads ? money(tot.spend / tot.leads) : '-'}</td>
                  <td>{fmtNumber(tot.won)}</td>
                  <td>{tot.won ? money(tot.spend / tot.won) : '-'}</td>
                  <td>{money(tot.revenue)}</td>
                  <td className={`roas-c ${roasCls(totRoas)}`}>{totRoas ? `${totRoas.toFixed(2)}×` : '-'}</td>
                </tr></tfoot>
              </table>
            </div>
            <p className="caveat">Revenue is UTM-attributed won value for opportunities <b>created</b> in this window ({matchedRev} of {rows.length} campaigns matched a utm_campaign). Campaigns showing n/a had spend but no UTM-matched opportunities - check UTM tagging on their landing pages.</p>
          </div>
        )
      })()}
      {b.hasCrm && trend.status !== 'error' && (() => {
        const W = (trend.weeks || []).map((w) => ({ ...w, roas: w.spend ? +(w.wonValue / w.spend).toFixed(2) : 0 }))
        const hasData = W.some((w) => w.spend > 0 || w.leads > 0)
        return (
          <div className="card chart-card" style={{ marginTop: 14 }}>
            <div className="c360-controls" style={{ marginBottom: 6 }}>
              <div>
                <h3>Blended trend over time</h3>
                <p className="cap">Whole account, last {W.length || 13} completed weeks (Mon-Sun) · {trendMetric === 'money' ? 'spend vs revenue & ROAS' : 'leads → booked → shown → won'}</p>
              </div>
              <div className="chan-toggle">
                <button className={trendMetric === 'money' ? 'on' : ''} onClick={() => setTrendMetric('money')}>Spend &amp; revenue</button>
                <button className={trendMetric === 'funnel' ? 'on' : ''} onClick={() => setTrendMetric('funnel')}>Funnel volume</button>
              </div>
            </div>
            {trend.status === 'loading' ? <Spinner label="Loading trend…" />
              : !hasData ? <p className="caveat">No completed-week data yet for this account.</p>
                : trendMetric === 'money' ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={W} margin={{ left: -6, right: 6, top: 8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" />
                      <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => money(v)} width={64} />
                      <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => `${v}×`} width={40} />
                      <Tooltip formatter={(v, n) => n === 'ROAS' ? `${(+v).toFixed(2)}×` : money(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="l" dataKey="spend" name="Spend" fill="#4f7cff" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="l" dataKey="wonValue" name="Revenue" fill="#12b886" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="roas" name="ROAS" stroke="#f5a524" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={W} margin={{ left: -6, right: 6, top: 8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" interval="preserveStartEnd" />
                      <YAxis fontSize={10} stroke="var(--muted)" width={36} allowDecimals={false} />
                      <Tooltip formatter={(v) => fmtNumber(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="leads" name="Leads" stroke="#4f7cff" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="booked" name="Booked" stroke="#12b886" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="shown" name="Shown" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="won" name="Won" stroke="#f5a524" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
            <p className="caveat">Revenue and won counts are lead-created basis (opportunities created that week). The current in-progress week is excluded, so the last bucket ends last Sunday. Whole-account view - channel / pipeline / user filters above do not apply here.</p>
          </div>
        )
      })()}
      <div className="grid two" style={{ marginTop: 14 }}>
        <KeyEventsFunnel
          rows={keRows} total={keTotal} spend={spend} currency={currency}
          title="Key events"
          sub={`${keConfigured.length ? 'Your key events' : 'Default: leads → booked → shown → won'} · reached · % of leads${keRows.some((r) => r.kind === 'calendar') ? ' · show %' : ''} · cost per event${chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''}`}
          caveat={<>{keConfigured.length ? 'Key events are the pipeline stages and booked calendars you selected in Settings.' : 'Set a client’s key events in Settings (pipeline stages and/or booked calendars) to replace the default stages.'} 📅 = a booked calendar appointment (cost per booked call); other rows = opportunities that reached that pipeline stage or beyond. Cost / event = attributed spend ({money(spend)}) ÷ count.</>}
        />
        <div className="card chart-card"><h3>Ad spend by channel</h3><p className="cap">{pid === 'all' ? 'Meta + Google split across the account' : 'Attributed to this pipeline'}</p>
          {chanPie.length ? <>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart><Pie data={chanPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">{chanPie.map((x) => <Cell key={x.name} fill={x.color} />)}</Pie><Tooltip formatter={(v) => money(v)} /></PieChart>
            </ResponsiveContainer>
            <div className="legend">{chanPie.map((x) => <span key={x.name}><i className="swatch" style={{ background: x.color }} /> {x.name} {money(x.value)}</span>)}</div>
          </> : <p className="cap">{multiSrc ? 'No campaigns attributed to this pipeline yet - link them in Settings.' : 'No ad spend in this range.'}</p>}
          <div className="c360-mini">
            <div><span className="l">Ad-reported conversions</span><span className="v">{fmtNumber(attr.adConversions)}</span></div>
            <div><span className="l">Open pipeline value</span><span className="v">{money(c.openValue)}</span></div>
            <div><span className="l">Lost / abandoned</span><span className="v">{fmtNumber(c.lost)}</span></div>
          </div>
        </div>
      </div>
      {activeStages && activeStages.length > 0 ? (() => {
        let acc = 0; const reached = []
        for (let i = activeStages.length - 1; i >= 0; i--) { acc += activeStages[i].count; reached[i] = acc }
        const total = reached[0] || 1
        return (
          <div className="card chart-card" style={{ marginTop: 14 }}>
            <h3>Full funnel pass-through</h3><p className="cap">{stageName} · reached · % of leads · step conversion · cost per stage (attributed spend {money(spend)})</p>
            <div className="pfunnel">
              <div className="pf-row pf-head"><span className="pf-stage">Stage</span><span className="pf-bar">Reached</span><span className="pf-num">% leads</span><span className="pf-num">Step conv</span><span className="pf-num">Cost / stage</span></div>
              {activeStages.map((s, i) => {
                const val = reached[i]; const pctLeads = (val / total) * 100
                const stepConv = i === 0 ? null : (reached[i - 1] ? (val / reached[i - 1]) * 100 : 0)
                const hue = 210 + Math.round((i / Math.max(1, activeStages.length - 1)) * -70)
                return (
                  <div className="pf-row" key={s.pos}>
                    <span className="pf-stage" title={s.name}>{s.name}</span>
                    <span className="pf-bar"><span className="pf-fill" style={{ width: `${Math.max(4, pctLeads)}%`, background: `hsl(${hue} 70% 55%)` }}>{fmtNumber(val)}</span></span>
                    <span className="pf-num">{fmtPct(pctLeads, 1)}</span>
                    <span className={`pf-num ${stepConv == null ? '' : stepConv >= 60 ? 'good' : stepConv < 30 ? 'bad' : ''}`}>{stepConv == null ? '-' : fmtPct(stepConv, 0)}</span>
                    <span className="pf-num">{val ? money(spend / val) : '-'}</span>
                  </div>
                )
              })}
            </div>
            <p className="caveat">Reached = opportunities currently at that stage or beyond (so they passed through it). Step conv = % who moved from the previous stage into this one. Cost / stage = attributed ad spend ÷ reached.</p>
          </div>
        )
      })() : (b.hasCrm && pipesSrc.length > 1 && <p className="caveat" style={{ marginTop: 12 }}>Pick a pipeline above to see the full funnel pass-through.</p>)}
      {lostReasons && lostReasons.length > 0 && (() => {
        const totLost = lostReasons.reduce((a, r) => a + r.count, 0) || 1
        return (
          <div className="card chart-card" style={{ marginTop: 14 }}>
            <h3>Why leads are lost{chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'}` : ''}</h3>
            <p className="cap">Lost / abandoned opportunities by reason{chan !== 'all' ? ' (this channel)' : ''}</p>
            <div className="pfunnel">
              {lostReasons.slice(0, 12).map((r, i) => {
                const pct = (r.count / totLost) * 100
                return (
                  <div className="pf-row" key={r.name}>
                    <span className="pf-stage" title={r.name}>{r.name}</span>
                    <span className="pf-bar"><span className="pf-fill" style={{ width: `${Math.max(4, pct)}%`, background: `hsl(${350 - i * 6} 65% 55%)` }}>{fmtNumber(r.count)}</span></span>
                    <span className="pf-num">{fmtPct(pct, 1)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
      {b.hasCrm && <UtmSection attr={utmAttr} currency={currency} paid={{ meta: p.metaSpend, google: p.googleSpend }} />}
      {!b.hasCrm && <div className="note"><b>No Caalano Systems account mapped</b> for {client.name}, so lead / booking / revenue tiles are blank. Map a Caalano Systems sub-account in Settings to blend CRM outcomes with paid spend.</div>}
      <ClientChat clientId={client.id} clientName={client.name} period={rangeLabel(range)} context={chatContext} />
    </>
  )
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7d', label: 'Last 7 days' },
  { id: 'last_14d', label: 'Last 14 days' },
  { id: 'last_30d', label: 'Last 30 days' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
]
function presetRange(id) {
  const now = new Date(); now.setHours(12, 0, 0, 0)
  const shift = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
  const monday = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x }
  const label = PRESETS.find((p) => p.id === id)?.label || 'Last 30 days'
  const mk = (f, t) => ({ from: iso(f), to: iso(t), label, preset: id })
  switch (id) {
    case 'today': return mk(now, now)
    case 'yesterday': return mk(shift(1), shift(1))
    case 'last_7d': return mk(shift(7), shift(1))
    case 'last_14d': return mk(shift(14), shift(1))
    case 'last_30d': return mk(shift(30), shift(1))
    case 'this_week': return mk(monday(now), now)
    case 'last_week': { const s = monday(shift(7)); const e = new Date(s); e.setDate(e.getDate() + 6); return mk(s, e) }
    case 'this_month': return mk(new Date(now.getFullYear(), now.getMonth(), 1), now)
    case 'last_month': return mk(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0))
    case 'this_year': return mk(new Date(now.getFullYear(), 0, 1), now)
    default: return mk(shift(30), shift(1))
  }
}
const rangeQuery = (r) => `from=${r.from}&to=${r.to}`
const rangeLabel = (r) => r.label || `${r.from} → ${r.to}`

// Fetch live deep data for the active channel from the Windsor.ai Netlify function.
function useLiveDeep(clientId, channel, range, nonce = 0) {
  const [state, setState] = useState({ status: 'idle', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    if (!channel) { setState({ status: 'idle', data: null }); return }
    let alive = true
    setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=${channel}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => r.json().catch(() => ({ error: `Server returned HTTP ${r.status} (the pull may have timed out).` })))
      .then((j) => { if (alive) setState({ status: j && !j.error ? 'ok' : 'err', data: j || null }) })
      .catch(() => { if (alive) setState({ status: 'err', data: { error: 'Network error reaching the data function.' } }) })
    return () => { alive = false }
  }, [clientId, channel, q, nonce])
  return state
}

function Spinner({ label }) {
  return <div className="spin-wrap"><span className="spin" />{label && <span className="spin-lbl">{label}</span>}</div>
}

function Calendar({ from, to, onPick }) {
  const base = to ? new Date(to + 'T12:00') : new Date()
  const [view, setView] = useState(new Date(base.getFullYear(), base.getMonth(), 1))
  const [a, setA] = useState(from || null)
  const [b, setB] = useState(to || null)
  const y = view.getFullYear(), m = view.getMonth()
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7
  const dim = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(iso(new Date(y, m, d)))
  const click = (ds) => { if (!a || (a && b)) { setA(ds); setB(null) } else if (ds < a) { setB(a); setA(ds) } else setB(ds) }
  const inRange = (ds) => a && b && ds > a && ds < b
  return (
    <div className="cal">
      <div className="cal-head">
        <button onClick={() => setView(new Date(y, m - 1, 1))}>‹</button>
        <span>{view.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => setView(new Date(y, m + 1, 1))}>›</button>
      </div>
      <div className="cal-grid cal-dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="cal-grid">
        {cells.map((ds, i) => ds
          ? <button key={i} className={`cal-day ${ds === a || ds === b ? 'sel' : ''} ${inRange(ds) ? 'inr' : ''}`} onClick={() => click(ds)}>{parseInt(ds.slice(-2), 10)}</button>
          : <span key={i} />)}
      </div>
      <button className="dr-apply" disabled={!a || !b} onClick={() => onPick({ from: a, to: b, label: `${a} → ${b}` })}>Apply {a && b ? 'range' : ''}</button>
    </div>
  )
}

function DateRange({ range, onChange, busy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="date-sel">
      <label>Period</label>
      <div className="dr">
        <button className="dr-btn" onClick={() => setOpen((o) => !o)}>{busy && <span className="spin sm" />}📅 {rangeLabel(range)} <span style={{ opacity: .55 }}>▾</span></button>
        {open && <>
          <div className="dr-backdrop" onClick={() => setOpen(false)} />
          <div className="dr-pop">
            <div className="dr-presets">{PRESETS.map((p) => <button key={p.id} className={range.preset === p.id ? 'active' : ''} onClick={() => { onChange(presetRange(p.id)); setOpen(false) }}>{p.label}</button>)}</div>
            <div className="dr-custom"><div className="dr-cap">Custom range</div><Calendar from={range.from} to={range.to} onPick={(r) => { onChange(r); setOpen(false) }} /></div>
          </div>
        </>}
      </div>
    </div>
  )
}

function LiveBadge({ mode, label }) {
  const map = { live: { t: `● Live · ${label}`, c: 'tk-full' }, snapshot: { t: 'Snapshot · June 2026', c: 'tk-wins' } }
  const m = map[mode]; if (!m) return null
  return <div style={{ marginBottom: 10 }}><span className={`tk ${m.c}`}>{m.t}</span></div>
}

function useCohorts(clientId, weeks = 12, nonce = 0) {
  const [state, setState] = useState({ status: 'loading', data: null })
  useEffect(() => {
    if (!clientId) return
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=cohorts&client=${clientId}&weeks=${weeks}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: j && j.weeks ? 'ok' : 'err', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, weeks, nonce])
  return state
}

// Cohort maturation - leads grouped by the week they came in, tracked through
// the funnel (appointment-accurate). Older cohorts have had time to book/show/
// win so their rates run higher; recent weeks are still "maturing". The
// ecommerce cohort grid for a services funnel: spend -> leads -> booked ->
// shown -> won -> revenue, plus maturation timing (days to book / win).
function CohortView({ clientId, currency, nonce }) {
  const co = useCohorts(clientId, 12, nonce)
  const kpis = loadKpis(clientId)
  const [chan, setChan] = useState('all')
  const money = (v) => fmtCurrency(v, currency)
  if (co.status === 'loading') return <div className="card"><Spinner label="Loading cohorts…" /></div>
  if (co.status !== 'ok' || !co.data || !co.data.weeks || !co.data.weeks.length) return <div className="card empty-deep"><div className="big">📈</div><b>No cohort data yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Cohorts need Caalano Systems CRM data over several weeks. Once leads flow through the funnel this fills in.</p></div>
  const raw = co.data.weeks // oldest -> newest
  // Channel filter: All = every source (spend ÷ all leads = blended MER). Paid =
  // Meta + Google only. Meta / Google = that channel's leads vs its own spend.
  const hasMeta = raw.some((w) => (w.ch?.meta?.leads || 0) > 0 || w.metaSpend > 0)
  const hasGoogle = raw.some((w) => (w.ch?.google?.leads || 0) > 0 || w.googleSpend > 0)
  const hasOther = raw.some((w) => (w.ch?.other?.leads || 0) > 0)
  const opts = [['all', 'All']]
  if (hasOther) opts.push(['other', 'Non-Paid'])
  if (hasMeta && hasGoogle) opts.push(['paid', 'Paid'])
  if (hasMeta) opts.push(['meta', 'Meta'])
  if (hasGoogle) opts.push(['google', 'Google'])
  const cur = opts.some(([k]) => k === chan) ? chan : 'all'
  const pick = (w) => {
    const f = (w.ch && w.ch[cur]) || {}
    // Non-Paid has no ad spend, so its cost columns read blank.
    const spend = cur === 'meta' ? w.metaSpend : cur === 'google' ? w.googleSpend : cur === 'other' ? 0 : w.adSpend
    return { week: w.week, weekNum: w.weekNum, label: w.label, spend, leads: f.leads || 0, booked: f.booked || 0, cancelled: f.cancelled || 0, shown: f.shown || 0, shownStage: f.shownStage || 0, won: f.won || 0, revenue: f.revenue || 0, avgDaysToBook: f.avgDaysToBook ?? null, avgDaysToWon: f.avgDaysToWon ?? null }
  }
  const W = raw.map(pick) // resolved to the selected channel
  const rows = [...W].reverse() // newest first for the table
  const N = W.length
  const MATURING = 3 // the most recent weeks are still closing
  const T = W.reduce((a, w) => ({ spend: a.spend + w.spend, leads: a.leads + w.leads, booked: a.booked + w.booked, shown: a.shown + w.shown, won: a.won + w.won, rev: a.rev + w.revenue }), { spend: 0, leads: 0, booked: 0, shown: 0, won: 0, rev: 0 })
  const mer = T.spend ? T.rev / T.spend : 0
  const cac = T.won && T.spend ? T.spend / T.won : null
  const ltvSet = Number(kpis.clientLtv) > 0 ? Number(kpis.clientLtv) : null
  const ltv = ltvSet || (T.won ? T.rev / T.won : null)
  const ltvCac = ltv != null && cac ? ltv / cac : null
  const matured = W.slice(0, Math.max(0, N - MATURING)) // stable cohorts for a timing read
  const avg = (arr, f) => { const v = arr.map(f).filter((x) => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null }
  const avgBook = avg(matured, (w) => w.avgDaysToBook)
  const avgWon = avg(matured, (w) => w.avgDaysToWon)
  const dater = (w) => { const d = new Date(w + 'T00:00:00Z'); const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} - ${e.getUTCDate()} ${MON[e.getUTCMonth()]}` }
  const maxWin = Math.max(0.01, ...W.map((w) => rate(w.won, w.leads)))
  const maxBook = Math.max(0.01, ...W.map((w) => rate(w.booked, w.leads)))
  const heat = (v, hi) => { if (!hi || v == null) return 'transparent'; const r = Math.min(1, v / hi); return `rgba(18,184,134,${(0.06 + r * 0.34).toFixed(2)})` }
  const chart = W.map((w) => ({ label: w.label, book: +rate(w.booked, w.leads).toFixed(1), win: +rate(w.won, w.leads).toFixed(1) }))
  return (
    <>
      <div className="c360-head">
        <div className="section-title" style={{ margin: 0 }}>Cohort maturation <span className="sub">· leads by acquisition week, tracked to booked → shown → won · last {N} weeks{cur !== 'all' ? ` · ${opts.find(([k]) => k === cur)[1]}` : ''}</span></div>
        {opts.length > 1 && <div className="c360-controls"><div className="chan-toggle">{opts.map(([k, l]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => setChan(k)}>{l}</button>)}</div></div>}
      </div>
      {co.data.hasCrm && !co.data.crmConnected && <p className="cap" style={{ color: 'var(--warn)', marginTop: 0 }}>Caalano Systems isn't returning CRM data - funnel columns will be blank.</p>}
      <div className="scorecard">
        <Sc label="Spend" value={T.spend ? money(T.spend) : '-'} />
        <Sc label="Leads" value={fmtNumber(T.leads)} />
        <Sc label="Booked" value={fmtNumber(T.booked)} flat={`${fmtPct(rate(T.booked, T.leads), 0)} of leads`} />
        <Sc label="Shown" value={fmtNumber(T.shown)} flat={`${fmtPct(rate(T.shown, T.booked), 0)} of booked`} />
        <Sc label="Won" value={fmtNumber(T.won)} flat={`${fmtPct(rate(T.won, T.leads), 1)} of leads`} />
        <Sc label="Revenue" value={money(T.rev)} />
        <Sc label="MER" value={mer ? `${mer.toFixed(2)}×` : '-'} />
        <Sc label="CAC" value={cac != null ? money(cac) : '-'} />
        {ltvCac != null && <Sc label="LTV : CAC" value={`${ltvCac.toFixed(1)}:1`} kpi={{ text: ltvCac >= 3 ? 'healthy' : ltvCac >= 1 ? 'okay' : 'underwater', cls: ltvCac >= 3 ? 'good' : ltvCac >= 1 ? 'info' : 'bad' }} />}
        <Sc label="Avg days → book" value={avgBook != null ? `${avgBook}d` : '-'} />
        <Sc label="Avg days → win" value={avgWon != null ? `${avgWon}d` : '-'} />
      </div>
      <div className="card chart-card" style={{ marginTop: 14 }}>
        <h3>Conversion by cohort</h3><p className="cap">Book% and Win% for each acquisition week. Recent weeks sit lower because their deals are still closing.</p>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
            <Tooltip formatter={(v, n) => [`${v}%`, n]} />
            <Legend />
            <Line dataKey="book" name="Book %" stroke="#6d5efc" strokeWidth={2} dot={false} />
            <Line dataKey="win" name="Win %" stroke="#12b886" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap" style={{ marginTop: 14 }}><table style={{ minWidth: 1180 }}><thead><tr>
        <th style={{ textAlign: 'left' }}>Cohort week</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Booked</th><th>Book %</th><th>C/Book</th><th>Shown</th><th>Show %</th><th>Won</th><th>Win %</th><th>CAC</th><th>Revenue</th><th>ROAS</th><th>→ Book</th><th>→ Win</th>
      </tr></thead><tbody>
        {rows.map((w, i) => {
          const maturing = i < MATURING
          const br = rate(w.booked, w.leads), sr = rate(w.shown, w.booked), wr = rate(w.won, w.leads)
          return (<tr key={w.week} className={maturing ? 'coh-maturing' : ''}>
            <td style={{ textAlign: 'left' }}>{w.label} <span className="cap">{dater(w.week)}</span>{maturing ? <span className="mat-badge" title="Recent cohort - deals still closing">maturing</span> : null}</td>
            <td>{w.spend ? money(w.spend) : '-'}</td><td>{fmtNumber(w.leads)}</td><td>{w.leads && w.spend ? money(w.spend / w.leads) : '-'}</td>
            <td>{fmtNumber(w.booked)}{w.cancelled ? <span className="c360-canc" title={`${w.cancelled} later cancelled`}> ({w.cancelled}c)</span> : null}</td>
            <td style={{ background: heat(br, maxBook) }}>{w.leads ? fmtPct(br, 0) : '-'}</td>
            <td>{w.booked && w.spend ? money(w.spend / w.booked) : '-'}</td>
            <td>{fmtNumber(w.shown)}{w.shownStage ? <span className="c360-infer" title={`${w.shownStage} via pipeline stage`}> ({w.shownStage}p)</span> : null}</td>
            <td>{w.booked ? fmtPct(sr, 0) : '-'}</td>
            <td>{fmtNumber(w.won)}</td><td style={{ background: heat(wr, maxWin) }}>{w.leads ? fmtPct(wr, 1) : '-'}</td>
            <td>{w.won && w.spend ? money(w.spend / w.won) : '-'}</td>
            <td>{money(w.revenue)}</td><td>{w.spend ? `${(w.revenue / w.spend).toFixed(2)}×` : '-'}</td>
            <td>{w.avgDaysToBook != null ? `${w.avgDaysToBook}d` : '-'}</td><td>{w.avgDaysToWon != null ? `${w.avgDaysToWon}d` : '-'}</td>
          </tr>)
        })}
      </tbody></table></div>
      <p className="caveat" style={{ marginTop: 8 }}>Cohorts group opportunities by the week the lead was created (client timezone), then follow them to booked / shown / won as of now, using the same appointment-accurate logic as the ad tabs: (Nc) = booked then cancelled, (Np) = shown counted from the pipeline stage. The most recent {MATURING} weeks are flagged "maturing" - their Win% keeps rising as deals close, so compare like-aged cohorts. "→ Book" / "→ Win" are the average days from lead to booking / to won. Channel: <b>All</b> = every lead source against total ad spend (blended MER - flatters paid efficiency if you get organic/referral leads); <b>Non-Paid</b> = organic / referral / direct leads (no ad spend, so cost columns are blank); <b>Paid</b> = Meta + Google combined; <b>Meta</b> / <b>Google</b> = only leads whose first-touch UTM is that channel, vs that channel's own spend (true paid efficiency).</p>
    </>
  )
}

/* ============ Forms performance ============ */
function useForms(clientId, range, nonce = 0) {
  const [state, setState] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setState({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=forms&client=${clientId}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setState({ status: 'ok', data: j }) })
      .catch(() => { if (alive) setState({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return state
}
// Merge answers that mean the same thing - case / spacing / punctuation and
// common AU state abbreviations (NSW = nsw = New South Wales). Values containing
// a digit (postcodes, budgets) are never merged. Each group keeps its members
// for a hover tooltip so groupings can be reviewed.
const AU_STATES = { nsw: 'New South Wales', vic: 'Victoria', qld: 'Queensland', wa: 'Western Australia', sa: 'South Australia', tas: 'Tasmania', act: 'Australian Capital Territory', nt: 'Northern Territory', 'new south wales': 'New South Wales', victoria: 'Victoria', queensland: 'Queensland', 'western australia': 'Western Australia', 'south australia': 'South Australia', tasmania: 'Tasmania', 'northern territory': 'Northern Territory' }
function answerKeyOf(v) {
  const s = String(v).trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  return AU_STATES[s] ? 'state:' + AU_STATES[s] : s
}
// Recognise a date written any common way (21st August 2026 · 21/8/26 ·
// 21/08/2026 · 2026-08-21 · Aug 21 2026) and canonicalise it, so all spellings
// of the same day merge. AU day-first order is assumed. Returns null if it isn't
// a full date (so postcodes / budgets / free numbers are left alone).
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function parseFormDate(raw) {
  let s = String(raw).trim().toLowerCase()
  if (s.length < 5 || s.length > 30) return null
  s = s.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  let day, month, year
  let m = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/)
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3]
    if (a > 31) { year = a; month = b; day = c }            // 2026-08-21
    else { day = a; month = b; year = c; if (month > 12 && day <= 12) { const t = day; day = month; month = t } } // DD/MM (AU), swap if it was MM/DD
  } else {
    m = s.match(/^(\d{1,2}) ([a-z]{3,9}) (\d{2,4})$/)         // 21 august 2026
    if (m && MONTHS[m[2].slice(0, 3)]) { day = +m[1]; month = MONTHS[m[2].slice(0, 3)]; year = +m[3] }
    else {
      m = s.match(/^([a-z]{3,9}) (\d{1,2}) (\d{2,4})$/)       // august 21 2026
      if (m && MONTHS[m[1].slice(0, 3)]) { month = MONTHS[m[1].slice(0, 3)]; day = +m[2]; year = +m[3] }
      else return null
    }
  }
  if (!day || !month || !year) return null
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null
  return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, display: `${day} ${MONTH_ABBR[month - 1]} ${year}` }
}
function groupAnswers(answers) {
  const groups = new Map()
  for (const a of answers) {
    const v = String(a.value)
    const dt = parseFormDate(v)
    const key = dt ? 'date:' + dt.iso : (/\d/.test(v) ? 'num:' + v : answerKeyOf(v)) // dates merge; other numeric (postcode/budget) never
    let g = groups.get(key)
    if (!g) { g = { value: v, leads: 0, booked: 0, shown: 0, won: 0, lost: 0, revenue: 0, members: [], _max: -1 }; groups.set(key, g) }
    g.leads += a.leads || 0; g.booked += a.booked || 0; g.shown += a.shown || 0; g.won += a.won || 0; g.lost += a.lost || 0; g.revenue += a.revenue || 0
    g.members.push({ value: v, leads: a.leads || 0 })
    const canon = dt ? dt.display : (key.startsWith('state:') ? key.slice(6) : v)
    if (a.leads > g._max) { g._max = a.leads; g.value = canon }
  }
  return [...groups.values()].map(({ _max, ...g }) => ({ ...g, merged: g.members.length > 1 })).sort((a, b) => b.leads - a.leads)
}
// One question at a time: pick a question from the selector, then see that
// question's answer breakdown as a bar chart + table (answers grouped).
function FormSegments({ segments, captured, currency }) {
  const money = (v) => fmtCurrency(v, currency)
  const [sel, setSel] = useState(0)
  if (!segments || !segments.length) return <div className="form-seg-none">{captured > 0 ? `This form carried ${captured} field${captured === 1 ? '' : 's'}, but they were all name / email / phone / system fields we don't segment on.` : 'No question fields were captured on this form — its submissions only carried contact details (name / email / phone).'}</div>
  const s = segments[Math.min(sel, segments.length - 1)]
  const grouped = groupAnswers(s.answers)
  const chart = grouped.slice(0, 12).map((a) => ({ name: a.value.length > 22 ? a.value.slice(0, 21) + '…' : a.value, leads: a.leads, booked: a.booked, won: a.won }))
  const totalLeads = grouped.reduce((t, a) => t + a.leads, 0)
  return (
    <div className="fseg">
      <div className="fseg-sel">
        <div className="fm-lab">Question / field <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· pick one to see its answers</span></div>
        <div className="fseg-qlist">
          {segments.map((q, i) => (
            <button key={q.question} className={`fseg-qbtn ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)} title={q.question}>
              <span className="fseg-qtxt">{q.question}</span>
              <span className={`form-seg-kind ${q.kind || 'choice'}`}>{q.kind === 'written' ? 'written' : 'choice'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fseg-body">
        <div className="fseg-head">{s.question}<span className="fseg-total">{fmtNumber(totalLeads)} leads · {grouped.length} distinct answer{grouped.length === 1 ? '' : 's'}</span></div>
        {chart.length > 1 && <div className="fseg-chart">
          <ResponsiveContainer width="100%" height={Math.max(120, chart.length * 30 + 20)}>
            <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis type="number" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} fontSize={11} stroke="var(--muted)" interval={0} />
              <Tooltip formatter={(v, n) => [fmtNumber(v), n]} />
              <Bar dataKey="leads" name="Leads" fill="#4f7cff" radius={[0, 3, 3, 0]} maxBarSize={18} />
              <Bar dataKey="booked" name="Booked" fill="#12b886" radius={[0, 3, 3, 0]} maxBarSize={18} />
              <Bar dataKey="won" name="Won" fill="#f5a524" radius={[0, 3, 3, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
        <table className="form-seg-t fseg-tbl">
          <thead><tr><th>Answer</th><th className="num">Leads</th><th className="num">% of leads</th><th className="num">Booked</th><th className="num">Book %</th><th className="num">Shown</th><th className="num">Won</th><th className="num">Win %</th><th className="num">Revenue</th></tr></thead>
          <tbody>{grouped.map((a) => (
            <tr key={a.value}>
              <td title={a.merged ? `Combines: ${a.members.sort((x, y) => y.leads - x.leads).map((m) => `${m.value} (${m.leads})`).join(', ')}` : a.value}>{a.value}{a.merged ? <span className="ans-merged" title={`Combines ${a.members.length} spellings`}> ⓘ{a.members.length}</span> : null}</td>
              <td className="num">{fmtNumber(a.leads)}</td>
              <td className="num">{totalLeads ? fmtPct((a.leads / totalLeads) * 100, 0) : '-'}</td>
              <td className="num">{fmtNumber(a.booked)}</td>
              <td className="num">{a.leads ? fmtPct((a.booked / a.leads) * 100, 0) : '-'}</td>
              <td className="num">{fmtNumber(a.shown)}</td>
              <td className="num">{fmtNumber(a.won)}</td>
              <td className="num">{a.leads ? fmtPct((a.won / a.leads) * 100, 0) : '-'}</td>
              <td className="num">{money(a.revenue)}</td>
            </tr>
          ))}</tbody>
        </table>
        {s.more > 0 && <div className="form-seg-more">+{s.more} more written answer{s.more === 1 ? '' : 's'}</div>}
      </div>
    </div>
  )
}
// Read-only form metadata + auto-description shown in the Forms view; a pencil
// opens the shared FormSettingsModal so editing happens in exactly one place.
function FormMetaPanel({ clientId, form, pipes, onEdit }) {
  const meta = loadFormMeta(clientId)[form.form] || {}
  const pipeName = meta.pipeline ? (pipes.find((p) => p.id === meta.pipeline) || {}).name : null
  const questions = form.questions || []
  return (
    <div className="fm-panel">
      <div className="fm-desc">
        <span className="fm-lab">What this form asks</span>
        {questions.length
          ? <span className="fm-qs">{questions.map((q, i) => <span className="fm-q" key={q + i}>{q}</span>)}</span>
          : <span className="cap">Contact details only — no qualification questions captured.</span>}
      </div>
      <div className="fm-meta-read">
        <div><span className="fm-lab">Pipeline</span><span className="fm-val">{pipeName || <span className="cap">not set</span>}</span></div>
        <div><span className="fm-lab">Notes</span><span className="fm-val">{meta.notes || <span className="cap">none</span>}</span></div>
        <button className="fm-edit-btn" onClick={() => onEdit(form)} title="Edit this form's pipeline & notes">✎ Edit</button>
      </div>
    </div>
  )
}
// The single place a form's pipeline + notes are edited (opened from the Forms
// view pencil and from Settings).
function FormSettingsModal({ clientId, form, pipes, onClose }) {
  const cur = loadFormMeta(clientId)[form.form] || {}
  const [notes, setNotes] = useState(cur.notes || '')
  const [pipe, setPipe] = useState(cur.pipeline || '')
  const questions = form.questions || []
  const save = () => { saveFormMeta(clientId, form.form, { pipeline: pipe || null, notes: notes.trim() || null, done: true }); onClose() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><div><h3>{form.kind === 'facebook' ? '📱 ' : form.kind === 'website' ? '🌐 ' : ''}{form.form}</h3><span className="cap">Form settings</span></div><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          <div className="fm-desc" style={{ marginBottom: 16 }}>
            <span className="fm-lab">What this form asks</span>
            {questions.length ? <span className="fm-qs">{questions.map((q, i) => <span className="fm-q" key={q + i}>{q}</span>)}</span> : <span className="cap">Contact details only — no qualification questions captured.</span>}
          </div>
          {pipes.length > 0 && <div className="set-field" style={{ marginBottom: 14 }}><span className="fm-lab">Pipeline</span><select value={pipe} onChange={(e) => setPipe(e.target.value)}><option value="">— not set —</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
          <div className="set-field"><span className="fm-lab">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Testing higher qualification to lift show rate…" style={{ minHeight: 72, resize: 'vertical', width: '100%' }} /></div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button className="set-details-save" onClick={save}>Save</button></div>
        </div>
      </div>
    </div>
  )
}
// Settings Forms tab: each form's pipeline link + reviewed state. Single-pipeline
// clients auto-suggest that pipeline; multi-pipeline clients auto-suggest by name
// match. Suggestions never overwrite a saved link - they're just the default in
// the dropdown until confirmed. Saving (even with no pipeline) marks a form
// reviewed, which drives the card's Forms health icon.
function FormsSettingsTab({ clientId }) {
  const st = useForms(clientId, presetRange('last_30d'), 0)
  const [editForm, setEditForm] = useState(null)
  const [, force] = useState(0)
  const bump = () => force((n) => n + 1)
  useSettingsSync()
  if (st.status === 'loading') return <Spinner label="Loading forms…" />
  const d = st.data
  if (!d || d.error || d.connected === false) return <p className="cap">Couldn’t load this client’s forms.</p>
  const forms = d.forms || []
  const pipes = d.pipelines || []
  const fmeta = loadFormMeta(clientId)
  if (!forms.length) return <p className="cap">No form submissions in the last 30 days.</p>
  const savedPipe = (f) => { const m = fmeta[f.form]; return m && m.pipeline != null ? m.pipeline : null }
  const effPipe = (f) => { const s = savedPipe(f); return s != null ? s : suggestPipeline(f.form, pipes) }
  const setPipe = (f, v) => { saveFormMeta(clientId, f.form, { pipeline: v || null, done: true }); bump() }
  const unsuggested = forms.filter((f) => savedPipe(f) == null && suggestPipeline(f.form, pipes))
  const autoAssign = () => { for (const f of unsuggested) saveFormMeta(clientId, f.form, { pipeline: suggestPipeline(f.form, pipes), done: true }); bump() }
  const done = forms.filter((f) => fmeta[f.form] && fmeta[f.form].done).length
  return (
    <>
      <div className="fmset-head">
        <span className="cap">{done} of {forms.length} form{forms.length === 1 ? '' : 's'} reviewed{pipes.length <= 1 ? ' · single pipeline' : ''}</span>
        {unsuggested.length > 0 && <button className="set-relink" onClick={autoAssign}>Auto-assign {unsuggested.length} suggested</button>}
      </div>
      <div className="fmset-list">
        {forms.map((f) => {
          const m = fmeta[f.form] || {}
          const isDone = !!m.done
          const eff = effPipe(f)
          const suggested = savedPipe(f) == null && !!eff
          return (
            <div className={`fmset-row2 ${isDone ? 'is-done' : ''}`} key={f.form}>
              <span className={`fmset-chk ${isDone ? 'on' : ''}`} title={isDone ? 'Reviewed' : 'Not reviewed yet'}>{isDone ? '✓' : '○'}</span>
              <span className="form-kind">{f.kind === 'facebook' ? '📱' : f.kind === 'website' ? '🌐' : '📄'}</span>
              <span className="fmset-nm" title={f.form}>{f.form}</span>
              {suggested && <span className="fmset-sug" title="Auto-suggested from the naming — pick to confirm">suggested</span>}
              {pipes.length > 0 && (
                <select className="fmset-sel" value={eff || ''} onChange={(e) => setPipe(f, e.target.value)}>
                  <option value="">— no pipeline —</option>
                  {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <button className="fm-edit-btn" onClick={() => setEditForm(f)} title="Notes & details">{m.notes ? '📝' : '✎'}</button>
            </div>
          )
        })}
      </div>
      {editForm && <FormSettingsModal clientId={clientId} form={editForm} pipes={pipes} onClose={() => { setEditForm(null); bump() }} />}
    </>
  )
}
// --- Australia map projection (equirectangular, cos-corrected on longitude) ---
const AU_BOUNDS = { lngMin: 112.9, lngMax: 153.7, latMin: -43.7, latMax: -10.5 }
const AU_K = 0.891
const AU_SCALE = 1000 / ((AU_BOUNDS.lngMax - AU_BOUNDS.lngMin) * AU_K)
const AU_VH = (AU_BOUNDS.latMax - AU_BOUNDS.latMin) * AU_SCALE
const projAU = (lng, lat) => [(lng - AU_BOUNDS.lngMin) * AU_K * AU_SCALE, (AU_BOUNDS.latMax - lat) * AU_SCALE]
const normSub = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
// Plots the form's location answers on a detailed map of Australia (state
// outlines). Data (postcode/suburb -> coords + outline paths) is lazy-loaded so
// it stays out of the main bundle. Defaults to auto-zooming to fit the plotted
// leads, so a Sydney-only client sees Sydney, not the whole country.
// AU postcode -> state, by numeric range (no data needed) - used to infer a
// client's state so ambiguous same-named suburbs resolve to the right one.
function stateOfPostcode(p) {
  const n = parseInt(p, 10); if (!isFinite(n)) return null
  if ((n >= 1000 && n <= 2599) || (n >= 2619 && n <= 2899) || (n >= 2921 && n <= 2999)) return 'NSW'
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT'
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC'
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD'
  if (n >= 5000 && n <= 5999) return 'SA'
  if (n >= 6000 && n <= 6999) return 'WA'
  if (n >= 7000 && n <= 7999) return 'TAS'
  if (n >= 800 && n <= 999) return 'NT'
  return null
}
const LEAD_MAP_COLOR = [['volume', 'Volume'], ['book', 'Booked %'], ['win', 'Won %']]
// Shared, cached loader for the AU postcode/suburb dataset (used by the location
// list merge + the map), so it's fetched at most once.
let _auDbPromise = null
function loadAuDb() { if (!_auDbPromise) _auDbPromise = import('./data/aupostcodes.json').then((m) => m.default || m); return _auDbPromise }
function useAuDb() {
  const [db, setDb] = useState(undefined)
  useEffect(() => { let a = true; loadAuDb().then((d) => { if (a) setDb(d) }).catch(() => { if (a) setDb(null) }); return () => { a = false } }, [])
  return db
}
const isPostcodeVal = (v) => /^\d{3,4}$/.test(String(v).trim())
// Collapse location answers that resolve to the SAME place — e.g. a postcode
// (2110) and its suburb name (Hunters Hill) — into one entry, summing outcomes
// and labelling it "Suburb (postcode)". Carries lat/lng so the map plots it
// directly. Unresolvable junk answers are kept as-is.
function mergeLocations(locs, db) {
  if (!db) return locs
  const tally = {}
  for (const l of locs) {
    const v = String(l.value).trim(); let stt = null
    if (/^\d{4}$/.test(v)) stt = stateOfPostcode(v)
    else if (/^\d{3}$/.test(v)) stt = stateOfPostcode('0' + v)
    else { const sv = db.sub[normSub(v)]; if (sv && typeof sv[0] === 'number') stt = sv[2] }
    if (stt) tally[stt] = (tally[stt] || 0) + (l.leads || 1)
  }
  const clientState = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const coordOf = (value) => {
    const v = String(value).trim()
    if (/^\d{4}$/.test(v)) return db.pc[v] || null
    if (/^\d{3}$/.test(v)) return db.pc['0' + v] || null
    const sv = db.sub[normSub(v)]; if (!sv) return null
    if (typeof sv[0] === 'number') return [sv[0], sv[1]]
    const pick = sv.find((x) => x[2] === clientState) || sv[0]
    return [pick[0], pick[1]]
  }
  const groups = new Map(); const kept = []
  for (const l of locs) {
    const c = coordOf(l.value)
    if (!c) { kept.push(l); continue }
    const key = c[0].toFixed(3) + ',' + c[1].toFixed(3)
    let g = groups.get(key)
    if (!g) { g = { lat: c[0], lng: c[1], leads: 0, booked: 0, shown: 0, won: 0, lost: 0, members: [] }; groups.set(key, g) }
    g.leads += l.leads || 0; g.booked += l.booked || 0; g.shown += l.shown || 0; g.won += l.won || 0; g.lost += l.lost || 0
    if (l.members) g.members.push(...l.members); else g.members.push({ value: l.value, leads: l.leads || 0 })
  }
  const merged = [...groups.values()].map((g) => {
    const vals = [...new Set(g.members.map((m) => String(m.value).trim()))]
    const pcs = [...new Set(vals.filter(isPostcodeVal))]
    const names = [...new Set(vals.filter((v) => !isPostcodeVal(v)))]
    const label = names.length && pcs.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''} (${pcs.join('/')})`
      : names.length ? names.join(' / ') : pcs.join(' / ')
    return { value: label, leads: g.leads, booked: g.booked, shown: g.shown, won: g.won, lost: g.lost, lat: g.lat, lng: g.lng, merged: g.members.length > 1, members: g.members }
  })
  return [...merged, ...kept].sort((a, b) => b.leads - a.leads)
}
// Outcome colours: yellow = open lead, blue = booked (not yet won), green = won,
// red = lost. A location's marker takes its furthest milestone reached (won >
// booked > lost > open lead).
const LM_BLUE = '#3b82f6', LM_RED = '#f0435b', LM_AMBER = '#f5a524', LM_GREEN = '#17b26a'
const outcomeOf = (p) => (p.won ? 'won' : p.booked ? 'booked' : p.lost ? 'lost' : 'lead')
const outcomeColor = (o) => (o === 'won' ? LM_GREEN : o === 'booked' ? LM_BLUE : o === 'lost' ? LM_RED : LM_AMBER)
// Interactive Leaflet map (OpenStreetMap tiles) — real base map with suburb
// names + zoom/pan. Markers are coloured by outcome and sized by lead volume.
function LeadMap({ locs, tall }) {
  const [db, setDb] = useState(undefined)
  const [filter, setFilter] = useState('all') // all | lead | booked | won
  const [ready, setReady] = useState(false)
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const LRef = useRef(null)
  useEffect(() => { let a = true; import('./data/aupostcodes.json').then((m) => { if (a) setDb(m.default || m) }).catch(() => { if (a) setDb(null) }); return () => { a = false } }, [])

  // Resolve every location answer to a [lat, lng], inferring the client's
  // dominant state so same-named suburbs elsewhere aren't mis-plotted.
  const { pts, unmatched, clientState } = useMemo(() => {
    if (!db) return { pts: [], unmatched: [], clientState: null }
    const tally = {}
    for (const l of locs) {
      const v = String(l.value).trim(); let stt = null
      if (/^\d{4}$/.test(v)) stt = stateOfPostcode(v)
      else if (/^\d{3}$/.test(v)) stt = stateOfPostcode('0' + v)
      else { const sv = db.sub[normSub(v)]; if (sv && typeof sv[0] === 'number') stt = sv[2] }
      if (stt) tally[stt] = (tally[stt] || 0) + (l.leads || 1)
    }
    const cs = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const coordOf = (value) => {
      const v = String(value).trim()
      if (/^\d{4}$/.test(v)) return db.pc[v] || null
      if (/^\d{3}$/.test(v)) return db.pc['0' + v] || null
      const sv = db.sub[normSub(v)]; if (!sv) return null
      if (typeof sv[0] === 'number') return [sv[0], sv[1]]
      const pick = sv.find((x) => x[2] === cs) || sv[0]
      return [pick[0], pick[1]]
    }
    const p = [], um = []
    for (const l of locs) { const c = (l.lat != null && l.lng != null) ? [l.lat, l.lng] : coordOf(l.value); if (c) p.push({ ...l, lat: c[0], lng: c[1] }); else um.push(l) }
    return { pts: p, unmatched: um, clientState: cs }
  }, [db, locs])

  // Create the Leaflet map once (dynamic import keeps it out of the main bundle).
  useEffect(() => {
    if (!db || !elRef.current || mapRef.current) return
    let dead = false
    import('leaflet').then((mod) => {
      if (dead || !elRef.current || mapRef.current) return
      const L = mod.default || mod; LRef.current = L
      const map = L.map(elRef.current, { scrollWheelZoom: true, worldCopyJump: true }).setView([-25.6, 134.4], 4)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setTimeout(() => map.invalidateSize(), 60) // container may size after mount
      setReady(true) // signal the marker effect that the map exists
    }).catch(() => {})
    return () => { dead = true; setReady(false); if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [db])

  // (Re)draw markers whenever the points or filter change; fit to bounds.
  const maxLeads = Math.max(1, ...pts.map((p) => p.leads))
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    const shown = pts.filter((p) => filter === 'all' ? true : filter === 'lead' ? true : filter === 'booked' ? p.booked > 0 : filter === 'won' ? p.won > 0 : p.lost > 0)
    const latlngs = []
    for (const p of shown) {
      const o = filter === 'all' ? outcomeOf(p) : filter
      const col = outcomeColor(o)
      const r = 5 + Math.sqrt(p.leads / maxLeads) * 20
      const m = L.circleMarker([p.lat, p.lng], { radius: r, color: col, weight: 1.5, fillColor: col, fillOpacity: 0.55 })
      m.bindPopup(`<b>${p.value}</b><br/>${p.leads} lead${p.leads === 1 ? '' : 's'} · ${p.booked || 0} booked · ${p.won || 0} won · ${p.lost || 0} lost`)
      m.bindTooltip(`${p.value}: ${p.leads}L / ${p.booked || 0}B / ${p.won || 0}W / ${p.lost || 0}Lost`)
      m.addTo(layer); latlngs.push([p.lat, p.lng])
    }
    if (latlngs.length) { try { map.fitBounds(latlngs, { padding: [34, 34], maxZoom: 13 }) } catch { /* single point */ } }
  }, [pts, filter, maxLeads, ready])

  if (db === undefined) return <div className="cap" style={{ padding: 12 }}>Loading map…</div>
  if (!db) return <div className="cap" style={{ padding: 12 }}>Map data unavailable.</div>
  const matchedLeads = pts.reduce((s, p) => s + p.leads, 0)
  const FILTERS = [['all', 'All'], ['lead', 'Leads'], ['booked', 'Booked'], ['won', 'Won'], ['lost', 'Lost']]
  return (
    <div className="lead-map-wrap">
      <div className="lead-map">
        <div className="lead-map-bar">
          <div className="lead-map-tabs"><span className="lead-map-lab">Show</span>{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
          <div className="lm-legend2"><span><i style={{ background: LM_AMBER }} />Leads</span><span><i style={{ background: LM_BLUE }} />Booked</span><span><i style={{ background: LM_GREEN }} />Won</span><span><i style={{ background: LM_RED }} />Lost</span></div>
        </div>
        <div ref={elRef} className={`lead-map-leaflet${tall ? ' lead-map-tall' : ''}`} />
      </div>
      <div className="cap lead-map-cap">{pts.length} of {locs.length} locations plotted · {matchedLeads} leads mapped{clientState ? ` · resolved to ${clientState}` : ''} · marker colour = furthest outcome, size = leads · scroll to zoom, click a dot for the breakdown{unmatched.length ? <> · <b>{unmatched.length} unmatched</b>: {unmatched.slice(0, 12).map((u) => u.value).join(', ')}{unmatched.length > 12 ? ` +${unmatched.length - 12}` : ''}</> : null}</div>
    </div>
  )
}
// Where the leads on a form are located (postcode / suburb answers), ranked +
// mapped. Collapsed by default — it's a "where is demand coming from" drill-down,
// not a headline, so it only opens when asked for.
function FormLocations({ form }) {
  const [open, setOpen] = useState(false)
  const db = useAuDb()
  // Merge suburb spellings first, then collapse postcode/suburb duplicates that
  // resolve to the same place (e.g. 2110 + Hunters Hill) once the dataset loads.
  const locs = useMemo(() => mergeLocations(groupAnswers(form.locations || []), db), [form, db])
  if (!locs.length) return null
  const max = Math.max(1, ...locs.map((l) => l.leads))
  return (
    <div className="fm-locs">
      <button className="linker-toggle" onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▸'} 📍 Where leads are located <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {locs.length} distinct postcode / suburb answers</span></button>
      {open && <>
        <LeadMap locs={locs} />
        <div className="fm-loc-list" style={{ marginTop: 8 }}>
          {locs.slice(0, 40).map((l) => (
            <div className="fm-loc" key={l.value} title={l.merged ? `Combines: ${l.members.map((m) => `${m.value} (${m.leads})`).join(', ')}` : `${l.leads} leads · ${l.won} won`}>
              <span className="fm-loc-nm">{l.value}{l.merged ? ` ⓘ${l.members.length}` : ''}</span>
              <span className="fm-loc-bar"><span style={{ width: `${(l.leads / max) * 100}%` }} /></span>
              <span className="fm-loc-n">{l.leads}{l.won ? ` · ${l.won}w` : ''}</span>
            </div>
          ))}
        </div>
        {locs.length > 40 && <div className="cap">+{locs.length - 40} more</div>}
      </>}
    </div>
  )
}
// Location tab — a full-width map of where every lead is located, aggregated
// across all of the client's forms, coloured by outcome (red lead / amber
// booked / green won). Reuses the forms feed (which already carries per-answer
// location + outcomes) so it needs no new backend call.
function LocationView({ clientId, range, nonce, currency }) {
  const st = useForms(clientId, range, nonce)
  const db = useAuDb()
  const money = (v) => fmtCurrency(v, currency)
  const locs = useMemo(() => {
    const forms = (st.data && st.data.forms) || []
    const all = forms.flatMap((f) => f.locations || [])
    if (!all.length) return []
    return mergeLocations(groupAnswers(all), db)
  }, [st.data, db])
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading lead locations…" /></div>
  const d = st.data
  if (st.status === 'err' || !d) return <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn’t load location data.</b></div>
  if (d.connected === false) return <div className="card empty-deep"><div className="big">🔌</div><b>Caalano Systems isn’t connected.</b></div>
  if (!locs.length) return (
    <><div className="lvl-title">Lead locations</div>
      <div className="card empty-deep"><div className="big">📍</div><b>No location data on leads in this range.</b>
        <p style={{ maxWidth: 480, margin: '8px auto 0' }}>This map fills in whenever leads submit a suburb, postcode or address on a form (Meta Lead Forms and website forms both count). None of the forms in this period captured a location field.</p></div>
    </>
  )
  const tot = locs.reduce((a, l) => ({ leads: a.leads + (l.leads || 0), booked: a.booked + (l.booked || 0), won: a.won + (l.won || 0), lost: a.lost + (l.lost || 0) }), { leads: 0, booked: 0, won: 0, lost: 0 })
  const max = Math.max(1, ...locs.map((l) => l.leads))
  return (
    <>
      <div className="lvl-title">Lead locations <span className="sub">· where leads come from, who booked, who won · {rangeLabel(range)}</span></div>
      <div className="scorecard">
        <Sc label="Locations" value={fmtNumber(locs.length)} />
        <Sc label="Leads mapped" value={fmtNumber(tot.leads)} />
        <Sc label="Booked" value={fmtNumber(tot.booked)} />
        <Sc label="Won" value={fmtNumber(tot.won)} />
        <Sc label="Lost" value={fmtNumber(tot.lost)} />
      </div>
      <LeadMap locs={locs} tall />
      <div className="lvl-title" style={{ fontSize: 12.5, marginTop: 14 }}>Every location <span className="sub">· ranked by leads</span></div>
      <div className="fm-loc-list" style={{ marginTop: 8 }}>
        {locs.slice(0, 120).map((l) => (
          <div className="fm-loc" key={l.value} title={l.merged ? `Combines: ${l.members.map((m) => `${m.value} (${m.leads})`).join(', ')}` : `${l.leads} leads · ${l.booked || 0} booked · ${l.won || 0} won · ${l.lost || 0} lost`}>
            <span className="fm-loc-nm">{l.value}{l.merged ? ` ⓘ${l.members.length}` : ''}</span>
            <span className="fm-loc-bar"><span style={{ width: `${(l.leads / max) * 100}%` }} /></span>
            <span className="fm-loc-n">{l.leads}{l.booked ? ` · ${l.booked}b` : ''}{l.won ? ` · ${l.won}w` : ''}{l.lost ? ` · ${l.lost}L` : ''}</span>
          </div>
        ))}
      </div>
      {locs.length > 120 && <div className="cap">+{locs.length - 120} more</div>}
    </>
  )
}
// Pipeline filter for the Forms view (categorise by where each form's leads
// landed, for multi-pipeline clients).
function FormPipeFilter({ pipes, value, onChange }) {
  if (!pipes || pipes.length < 2) return null
  return (
    <div className="chan-toggle form-pipe-filter">
      <button className={value === 'all' ? 'on' : ''} onClick={() => onChange('all')}>All pipelines</button>
      {pipes.map((p) => <button key={p.id} className={value === p.id ? 'on' : ''} onClick={() => onChange(p.id)}>{p.name}</button>)}
    </div>
  )
}
const FORM_COLORS = ['#6d5efc', '#12b886', '#4f7cff', '#f5a524', '#ec4899', '#0ea5e9', '#f0435b', '#8b5cf6', '#0e8f6a', '#f97316']
// Visual summary of form performance: lead share (donut), funnel counts and
// conversion rates by form (bars). Top forms by leads.
function FormsCharts({ forms }) {
  const top = [...forms].sort((a, b) => b.leads - a.leads).slice(0, 8).filter((f) => f.leads > 0)
  if (!top.length) return null
  const shortName = (s) => (s.length > 16 ? s.slice(0, 15) + '…' : s)
  const pie = top.map((f, i) => ({ name: f.form, value: f.leads, color: FORM_COLORS[i % FORM_COLORS.length] }))
  const funnel = top.map((f) => ({ name: shortName(f.form), Leads: f.leads, Booked: f.booked, Shown: f.shown, Won: f.won }))
  const rates = top.map((f) => ({ name: shortName(f.form), 'Book %': f.leads ? Math.round((f.booked / f.leads) * 100) : 0, 'Show %': f.booked ? Math.round((f.shown / f.booked) * 100) : 0, 'Win %': f.leads ? Math.round((f.won / f.leads) * 100) : 0 }))
  const xa = <XAxis dataKey="name" fontSize={9} stroke="var(--muted)" interval={0} angle={-18} textAnchor="end" height={54} />
  return (
    <div className="forms-charts">
      <div className="card chart-card"><h3>Lead share by form</h3>
        <ResponsiveContainer width="100%" height={230}>
          <PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={46} outerRadius={82} paddingAngle={2}>{pie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip formatter={(v) => fmtNumber(v) + ' leads'} /></PieChart>
        </ResponsiveContainer>
      </div>
      <div className="card chart-card"><h3>Funnel by form</h3>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={funnel} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="Leads" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Booked" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Shown" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Won" fill="#f5a524" radius={[3, 3, 0, 0]} maxBarSize={20} /></BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card chart-card"><h3>Conversion rates by form</h3>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={rates} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} /><Tooltip formatter={(v) => v + '%'} /><Legend /><Bar dataKey="Book %" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Show %" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Win %" fill="#f5a524" radius={[3, 3, 0, 0]} maxBarSize={20} /></BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
function FormsView({ clientId, currency, range, nonce }) {
  const st = useForms(clientId, range, nonce)
  const [pipeFilter, setPipeFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'leads', dir: -1 })
  const [open, setOpen] = useState(() => new Set())
  const [editForm, setEditForm] = useState(null)
  useSettingsSync()
  const toggle = (f) => setOpen((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n })
  const money = (v) => fmtCurrency(v, currency)
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading form performance…" /></div>
  const d = st.data
  if (st.status === 'err' || !d) return <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn't load forms.</b></div>
  if (d.connected === false) return <div className="card empty-deep"><div className="big">🔌</div><b>Caalano Systems isn't connected.</b></div>
  if (d.error) return <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn't load forms.</b><p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, maxWidth: 520, margin: '8px auto 0' }}>{d.error}</p><p style={{ maxWidth: 460, margin: '8px auto 0' }}>If this is a scope error, re-authorise Caalano Systems so the token carries <code>forms.readonly</code>.</p></div>
  const allForms = d.forms || []
  if (!allForms.length) return <div className="card empty-deep"><div className="big">📝</div><b>No form submissions in this range.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Once leads fill out a form this fills in. Meta Lead Forms and website forms both appear here.</p></div>
  const pipes = d.pipelines || []
  const fmeta = loadFormMeta(clientId)
  // Pipeline filter: 'all', a pipeline id (categorise by where leads went), or
  // 'link:<id>' to show only forms manually linked to that pipeline in Settings.
  const projected = allForms.map((f) => {
    if (pipeFilter === 'all') return f
    if (pipeFilter.startsWith('link:')) { const pid = pipeFilter.slice(5); return (fmeta[f.form] && fmeta[f.form].pipeline === pid) ? f : null }
    const bp = (f.byPipeline || []).find((p) => p.id === pipeFilter)
    return bp ? { ...f, leads: bp.leads, booked: bp.booked, shown: bp.shown, won: bp.won, revenue: bp.revenue } : null
  }).filter(Boolean)
  const forms = projected
  if (!forms.length) return (<><div className="lvl-title">Form performance</div><FormPipeFilter pipes={pipes} value={pipeFilter} onChange={setPipeFilter} /><div className="card empty-deep"><div className="big">🗂️</div><b>No forms in this pipeline for the range.</b></div></>)
  const rows = forms.map((f) => ({ ...f, bookRate: f.leads ? (f.booked / f.leads) * 100 : null, showRate: f.booked ? (f.shown / f.booked) * 100 : null, winRate: f.leads ? (f.won / f.leads) * 100 : null, avgDeal: f.won ? f.revenue / f.won : null }))
  const sorted = [...rows].sort((a, b) => { const av = a[sort.key], bv = b[sort.key]; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * sort.dir; return (av - bv) * sort.dir })
  const tot = rows.reduce((a, f) => ({ leads: a.leads + f.leads, booked: a.booked + f.booked, shown: a.shown + f.shown, won: a.won + f.won, revenue: a.revenue + f.revenue }), { leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 })
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const Th = ({ k, children, l }) => <th className={l ? 'lft' : 'num'} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <>
      <div className="scorecard">
        <Sc label="Forms" value={fmtNumber(forms.length)} />
        <Sc label="Leads" value={fmtNumber(tot.leads)} />
        <Sc label="Booked" value={fmtNumber(tot.booked)} />
        <Sc label="Shown" value={fmtNumber(tot.shown)} />
        <Sc label="Won" value={fmtNumber(tot.won)} />
        <Sc label="Revenue" value={money(tot.revenue)} />
      </div>
      <FormPipeFilter pipes={pipes} value={pipeFilter} onChange={setPipeFilter} />
      <FormsCharts forms={forms} />
      <div className="lvl-title" style={{ marginTop: 14 }}>Form performance <span className="sub">· leads → booked → shown → won by form · {rangeLabel(range)} · 📱 Meta lead form · 🌐 website form · click a form to expand</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th style={{ width: 22 }} /><Th k="form" l>Form</Th><Th k="leads">Leads</Th><Th k="booked">Booked</Th><Th k="bookRate">Book %</Th><Th k="shown">Shown</Th><Th k="showRate">Show %</Th><Th k="won">Won</Th><Th k="winRate">Win %</Th><Th k="revenue">Revenue</Th><Th k="avgDeal">Avg Deal</Th></tr></thead>
        {sorted.map((f) => {
          const isOpen = open.has(f.form)
          const fm = fmeta[f.form] || {}
          const pipeName = fm.pipeline ? (pipes.find((p) => p.id === fm.pipeline) || {}).name : null
          return (
            <tbody key={f.form}>
              <tr onClick={() => toggle(f.form)} style={{ cursor: 'pointer' }} className={isOpen ? 'row-sel' : ''}>
                <td className="num" style={{ color: 'var(--faint)' }}>{isOpen ? '▾' : '▸'}</td>
                <td className="lft" title={f.form}><span className="form-kind">{f.kind === 'facebook' ? '📱' : f.kind === 'website' ? '🌐' : '📄'}</span> {f.form}{pipeName ? <span className="form-pipe-chip">{pipeName}</span> : null}{fm.notes ? <span className="form-note-chip" title={fm.notes}>📝</span> : null}</td>
                <td className="num">{fmtNumber(f.leads)}</td>
                <td className="num">{fmtNumber(f.booked)}</td>
                <td className="num">{f.bookRate != null ? fmtPct(f.bookRate, 0) : '-'}</td>
                <td className="num">{fmtNumber(f.shown)}</td>
                <td className="num">{f.showRate != null ? fmtPct(f.showRate, 0) : '-'}</td>
                <td className="num">{fmtNumber(f.won)}</td>
                <td className="num">{f.winRate != null ? fmtPct(f.winRate, 0) : '-'}</td>
                <td className="num">{money(f.revenue)}</td>
                <td className="num">{f.avgDeal != null ? money(f.avgDeal) : '-'}</td>
              </tr>
              {isOpen && <tr className="form-seg-row"><td /><td colSpan={10}>
                <FormMetaPanel clientId={clientId} form={f} pipes={pipes} onEdit={setEditForm} />
                <FormLocations form={f} />
                <FormSegments segments={f.segments} captured={f.capturedQuestions} currency={currency} />
              </td></tr>}
            </tbody>
          )
        })}
      </table></div>
      <p className="caveat">Leads = distinct contacts whose first form in this period was this one. Booked / Shown come from the date-of-action appointment feed; Won / Revenue from won opportunities. <b>Meta Lead Forms</b> are grouped by their Facebook form name so different friction / qualification versions stay separate; <b>website forms</b> by their GHL form name. A higher-friction form usually shows fewer Leads but higher Book / Show / Win %. <b>Click a form</b> to break its leads down by the answers they gave (budget, type, timeframe…) and see which answers actually book, show and win. Similar text answers (e.g. NSW / nsw / New South Wales) are merged — hover an answer to see what it combines.</p>
      {editForm && <FormSettingsModal clientId={clientId} form={editForm} pipes={pipes} onClose={() => setEditForm(null)} />}
    </>
  )
}

/* ============ Appointments (timing + who booked) ============ */
function fmtDays(n) { if (n == null) return '-'; if (n === 0) return 'Same day'; return `${n} day${n === 1 ? '' : 's'}` }
const APPT_CHANS = [['all', 'All'], ['paid', 'Paid'], ['other', 'Non-Paid'], ['meta', 'Meta'], ['google', 'Google']]
// Default calendars for the Appointments tab = the pipeline's first booking-stage
// calendar(s), taken from the configured key events (first calendar event + any
// linked to the same stage). Empty = no key events, so fall back to all.
function defaultApptCals(clientId, pipe) {
  const merged = mergeCalKeyEvents(normKeyEvents(keyEventsForPipe(loadKeyEvents(clientId), pipe)))
  const firstCal = merged.find((e) => e.kind === 'calendar')
  if (firstCal) return { calIds: (firstCal.refs || [firstCal.ref]).filter(Boolean), stage: firstCal.stage || firstCal.label }
  return { calIds: [], stage: null }
}
function AppointmentsView({ clientId, range, nonce }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [chan, setChan] = useState('all')
  const [pipe, setPipe] = useState('all')
  const [cals, setCals] = useState(null) // null = use default for pipe; array = explicit
  const [userSel, setUserSel] = useState('all')
  const [showDbg, setShowDbg] = useState(false)
  useSettingsSync()
  const dflt = useMemo(() => defaultApptCals(clientId, pipe), [clientId, pipe])
  const effCals = cals !== null ? cals : dflt.calIds
  const calParam = effCals.length ? `&cals=${effCals.map(encodeURIComponent).join(',')}` : ''
  const pipeParam = pipe !== 'all' ? `&pipeline=${encodeURIComponent(pipe)}` : ''
  const userParam = userSel !== 'all' ? `&user=${encodeURIComponent(userSel)}` : ''
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000)
    fetch(`/.netlify/functions/windsor?scope=appts&client=${clientId}&${rangeQuery(range)}${pipeParam}${calParam}${userParam}${nonce ? `&_r=${nonce}` : ''}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`server ${r.status}`))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch((e) => { if (alive) setSt({ status: 'err', data: { error: e && e.name === 'AbortError' ? 'timed out' : String((e && e.message) || e) } }) })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; ctl.abort() }
  }, [clientId, rangeQuery(range), pipeParam, calParam, userParam, nonce])
  if (st.status === 'loading') return <div className="card"><Spinner label="Analysing appointments (booking timing & outcomes)…" /></div>
  const dd = st.data || {}
  if (st.status === 'err' || dd.connected === false) return <div className="card empty-deep"><div className="big">📅</div><b>Couldn't load appointments.</b><p style={{ maxWidth: 520, margin: '8px auto 0', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{dd.error || 'Caalano Systems not connected.'}</p></div>
  const pipes = dd.allPipelines || []
  const calList = dd.calendars || []
  const users = dd.users || []
  const calNameById = Object.fromEntries(calList.map((c) => [c.id, c.name]))
  const usedNames = (effCals.length ? effCals : calList.map((c) => c.id)).map((id) => calNameById[id]).filter(Boolean)
  const chanToggle = <div className="chan-toggle">{APPT_CHANS.map(([k, l]) => <button key={k} className={chan === k ? 'on' : ''} onClick={() => setChan(k)}>{l}</button>)}</div>
  const selectors = (
    <div className="appt-filters">
      {pipes.length > 1 && <label className="appt-f"><span>Pipeline</span><select value={pipe} onChange={(e) => { setPipe(e.target.value); setCals(null) }}><option value="all">All pipelines</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {users.length > 1 && <label className="appt-f"><span>User</span><select value={userSel} onChange={(e) => setUserSel(e.target.value)}><option value="all">All users</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.count})</option>)}</select></label>}
      {chanToggle}
    </div>
  )
  const C = (dd.channels && dd.channels[chan]) || null
  const calChips = calList.length > 0 && (
    <div className="appt-cals">
      <span className="cap">Calendars {dflt.stage && cals === null ? <>· defaulted to first booking stage <b>{dflt.stage}</b></> : null}:</span>
      {calList.map((c) => { const on = effCals.length ? effCals.includes(c.id) : true; return (
        <button key={c.id} className={`appt-cal ${on ? 'on' : ''}`} onClick={() => { const base = effCals.length ? effCals : calList.map((x) => x.id); const nx = on ? base.filter((x) => x !== c.id) : [...base, c.id]; setCals(nx) }}>{c.name} <span className="appt-cal-n">{c.count}</span></button>
      ) })}
      {cals !== null && <button className="appt-cal reset" onClick={() => setCals(null)}>↺ default</button>}
    </div>
  )
  if (!C || !C.booked) return (<div className="timing-view"><div className="appt-head"><div><h3 style={{ margin: 0 }}>Appointments</h3></div>{selectors}</div>{calChips}<div className="card empty-deep"><div className="big">📅</div><b>No appointments booked in this range{chan !== 'all' ? ' for this filter' : ''}.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Appointments are counted on the day they were booked. Widen the range or change the filters.</p></div></div>)
  const bd = C.byBookedBy
  return (
    <div className="timing-view">
      <div className="appt-head"><div><h3 style={{ margin: '0 0 2px' }}>Appointments — booking timing &amp; outcomes</h3><p className="cap" style={{ margin: 0 }}>How far in advance calls are booked, who books them, and how that affects show / win rates and time-to-close. Bookings are counted on the day they were booked{usedNames.length ? ` · based on: ${usedNames.slice(0, 4).join(', ')}${usedNames.length > 4 ? ` +${usedNames.length - 4}` : ''}` : ''}.</p></div>{selectors}</div>
      {calChips}
      <div className="timing-scards">
        <div className="tm-sc hero"><span className="tm-lab">Booked</span><b>{fmtNumber(C.booked)}</b><span className="tm-sub">appointments</span></div>
        <div className="tm-sc"><span className="tm-lab">Time to book</span><b>{fmtDays(C.medianTimeToBookDays)}</b><span className="tm-sub">median · avg {fmtDays(C.avgTimeToBookDays)} · lead → booked</span></div>
        <div className="tm-sc"><span className="tm-lab">Avg booked ahead</span><b>{fmtDays(C.avgLeadDays)}</b><span className="tm-sub">median {fmtDays(C.medianLeadDays)}</span></div>
        <div className="tm-sc"><span className="tm-lab">Show rate</span><b>{C.showRate == null ? '-' : `${C.showRate}%`}</b><span className="tm-sub">of {C.occurred} occurred</span></div>
        <div className="tm-sc"><span className="tm-lab">Win rate</span><b>{C.winRate == null ? '-' : `${C.winRate}%`}</b><span className="tm-sub">won ÷ booked</span></div>
        <div className="tm-sc"><span className="tm-lab">Avg time to close</span><b>{fmtDays(C.avgCloseDays)}</b><span className="tm-sub">booked → won</span></div>
        <div className="tm-sc warn"><span className="tm-lab">Cancelled</span><b>{C.cancelRate == null ? '-' : `${C.cancelRate}%`}</b><span className="tm-sub">{C.cancelled} · resched {C.rescheduleRate == null ? '-' : `${C.rescheduleRate}%`}</span></div>
        <div className="tm-sc"><span className="tm-lab">Self-booked</span><b>{C.selfPct == null ? '-' : `${C.selfPct}%`}</b><span className="tm-sub">{C.self} self · {C.staff} staff</span></div>
      </div>

      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Booking lead time — volume, downstream rates &amp; momentum</div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={C.buckets} margin={{ left: -8, right: 8, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--muted)" />
            <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
            <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} domain={[0, 100]} />
            <Tooltip formatter={(v, n) => [/(Show|Win)/.test(n) ? `${v}%` : fmtNumber(v), n]} />
            <Legend />
            <Bar yAxisId="l" dataKey="booked" name="Booked" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={40} />
            <Line yAxisId="r" dataKey="showRate" name="Show %" stroke="#12b886" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line yAxisId="r" dataKey="winRate" name="Win %" stroke="#f5a524" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="table-wrap" style={{ marginTop: 10 }}><table className="mini-tbl appt-tbl">
          <thead><tr><th className="lft">Booked ahead</th><th>Booked</th><th>Occurred</th><th>Show %</th><th>Cancel %</th><th>Won</th><th>Win %</th><th>Time to close</th></tr></thead>
          <tbody>{C.buckets.map((b) => (
            <tr key={b.label}>
              <td className="lft">{b.label}</td>
              <td>{fmtNumber(b.booked)}</td>
              <td>{fmtNumber(b.occurred)}</td>
              <td>{b.showRate == null ? '-' : `${b.showRate}%`}</td>
              <td>{b.cancelRate == null ? '-' : `${b.cancelRate}%`}</td>
              <td>{fmtNumber(b.won)}</td>
              <td>{b.winRate == null ? '-' : `${b.winRate}%`}</td>
              <td>{fmtDays(b.avgCloseDays)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>Show rate is over appointments that have already happened, so far-out bookings don't drag it down. <b>Cancel %</b> = cancelled ÷ booked (do far-out bookings cancel more?). <b>Time to close</b> = average days from booking to won (momentum: do sooner bookings close faster / more?). Small samples make single rows noisy — read the trend.</p>
      </div>

      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>When the call is scheduled — show rate by day &amp; time</div>
        <div className="appt-when">
          <div className="appt-when-col">
            <div className="cap" style={{ marginBottom: 4 }}>By day of week</div>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={C.byDow} margin={{ left: -10, right: 6, top: 6 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" fontSize={10} stroke="var(--muted)" />
                <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} domain={[0, 100]} />
                <Tooltip formatter={(v, n) => [/Show/.test(n) ? `${v}%` : fmtNumber(v), n]} />
                <Bar yAxisId="l" dataKey="occurred" name="Occurred" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Line yAxisId="r" dataKey="showRate" name="Show %" stroke="#12b886" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="appt-when-col">
            <div className="cap" style={{ marginBottom: 4 }}>By time of day</div>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={C.byTimeOfDay} margin={{ left: -10, right: 6, top: 6 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" fontSize={9} stroke="var(--muted)" interval={0} angle={-12} textAnchor="end" height={40} />
                <YAxis yAxisId="l" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} domain={[0, 100]} />
                <Tooltip formatter={(v, n) => [/Show/.test(n) ? `${v}%` : fmtNumber(v), n]} />
                <Bar yAxisId="l" dataKey="occurred" name="Occurred" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Line yAxisId="r" dataKey="showRate" name="Show %" stroke="#12b886" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="caveat" style={{ marginTop: 8 }}>Bars = appointments that have occurred; line = show rate. Times are in the client's timezone ({dd.tz || '—'}). Use this to spot the days / times leads actually turn up.</p>
      </div>

      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Self-booked vs staff-booked</div>
        <div className="table-wrap"><table className="mini-tbl appt-tbl">
          <thead><tr><th className="lft">Booked by</th><th>Booked</th><th>Avg ahead</th><th>Occurred</th><th>Show %</th><th>Win %</th></tr></thead>
          <tbody>
            {[['self', 'Self-booked (contact)'], ['staff', 'Staff-booked (user)']].map(([k, lbl]) => { const x = bd[k]; return (
              <tr key={k}>
                <td className="lft">{lbl}</td>
                <td>{fmtNumber(x.booked)}</td>
                <td>{fmtDays(x.avgLeadDays)}</td>
                <td>{fmtNumber(x.occurred)}</td>
                <td>{x.showRate == null ? '-' : `${x.showRate}%`}</td>
                <td>{x.winRate == null ? '-' : `${x.winRate}%`}</td>
              </tr>
            ) })}
          </tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>Self-booked = the lead booked the call themselves (no staff user on the calendar event); staff-booked = a team member set it. Comparing show/win rates tells you whether pushing self-booking links helps or hurts.</p>
      </div>

      {(C.byUser || []).length > 1 && <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Performance by user{dd.userMismatch ? <span className="cap" style={{ fontWeight: 400 }}> · {dd.userMismatch} bookings where the appointment user differs from the opportunity owner</span> : null}</div>
        <div className="table-wrap"><table className="mini-tbl appt-tbl">
          <thead><tr><th className="lft">User</th><th>Booked</th><th>Occurred</th><th>Shown</th><th>Show %</th><th>Won</th><th>Win %</th></tr></thead>
          <tbody>{C.byUser.map((u) => (
            <tr key={u.name}>
              <td className="lft">{u.name}</td>
              <td>{fmtNumber(u.booked)}</td>
              <td>{fmtNumber(u.occurred)}</td>
              <td>{fmtNumber(u.shown)}</td>
              <td>{u.showRate == null ? '-' : `${u.showRate}%`}</td>
              <td>{fmtNumber(u.won)}</td>
              <td>{u.winRate == null ? '-' : `${u.winRate}%`}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>"User" is the person the appointment is assigned to on the calendar. Use the User filter above to scope the whole tab to one person.</p>
      </div>}

      <div className="card">
        <button className="linker-toggle" onClick={() => setShowDbg((v) => !v)}>{showDbg ? '▾' : '▸'} How self vs staff is decided ({(dd.bookedBySources || []).length} booking sources)</button>
        {showDbg && <>
          <p className="cap" style={{ marginTop: 8 }}>A booking is <b>staff-booked</b> when the calendar event carries a user id, else <b>self-booked</b>. Below are the event sources seen — use this to confirm the split looks right for this client.</p>
          <div className="table-wrap"><table className="mini-tbl"><thead><tr><th>Event source · classification</th><th>Count</th></tr></thead><tbody>{(dd.bookedBySources || []).map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.count}</td></tr>)}{!(dd.bookedBySources || []).length && <tr><td colSpan={2} className="cap">No booking sources in the sample.</td></tr>}</tbody></table></div>
        </>}
      </div>
    </div>
  )
}
/* ============ Timing (Speed to Lead) ============ */
function fmtDuration(min) {
  if (min == null) return '-'
  if (min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h` }
  const d = Math.floor(min / 1440); const h = Math.round((min % 1440) / 60); return h ? `${d}d ${h}h` : `${d}d`
}
function TimingView({ clientId, range, nonce }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [scan, setScan] = useState(null) // { status, processed, total, data }
  const [showDbg, setShowDbg] = useState(false)
  const scanRef = React.useRef({ alive: false })
  useSettingsSync()
  const hrs = loadHours(clientId)
  const hq = hoursQuery(hrs)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000)
    fetch(`/.netlify/functions/windsor?scope=speed&client=${clientId}&${rangeQuery(range)}${hq}${nonce ? `&_r=${nonce}` : ''}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`server ${r.status}`))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch((e) => { if (alive) setSt({ status: 'err', data: { error: e && e.name === 'AbortError' ? 'timed out' : String((e && e.message) || e) } }) })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; ctl.abort() }
  }, [clientId, rangeQuery(range), hq, nonce])
  // Reset any running scan when the client / range / hours change.
  useEffect(() => { scanRef.current.alive = false; setScan(null); return () => { scanRef.current.alive = false } }, [clientId, rangeQuery(range), hq])
  const runScan = () => {
    scanRef.current.alive = true; setScan({ status: 'running', processed: 0, total: 0, data: null })
    const poll = (reset) => {
      if (!scanRef.current.alive) return
      fetch(`/.netlify/functions/windsor?scope=speedscan&client=${clientId}&${rangeQuery(range)}${hq}${reset ? '&reset=1' : ''}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
        .then((j) => { if (!scanRef.current.alive) return; setScan({ status: j.status, processed: j.processed, total: j.total, data: j }); if (j.status === 'running') setTimeout(() => poll(false), 1200) })
        .catch(() => { if (scanRef.current.alive) setScan((s) => ({ ...(s || {}), status: 'err' })) })
    }
    poll(true)
  }
  const stopScan = () => { scanRef.current.alive = false; setScan(null) }
  const scanning = scan && scan.status === 'running'
  const d = (scan && scan.data) || st.data || {}
  if (st.status === 'loading' && !scan) return <div className="card"><Spinner label="Measuring speed to lead… (sampling recent leads' conversations)" /></div>
  if (!scan && (st.status === 'err' || d.connected === false)) return <div className="card empty-deep"><div className="big">⏱️</div><b>Couldn't measure speed to lead.</b><p style={{ maxWidth: 520, margin: '8px auto 0', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{d.error || 'Caalano Systems not connected.'}</p></div>
  if (!d.sampled && !scanning) return <div className="card empty-deep"><div className="big">⏱️</div><b>No leads with conversations in this range.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Speed to Lead samples recent leads and reads their conversation history. Widen the date range to include leads that were messaged.</p></div>
  const maxB = Math.max(1, ...d.buckets.map((b) => b.count))
  const fastCount = d.buckets.filter((b) => /5 min|5-15|15-60/.test(b.label)).reduce((a, b) => a + b.count, 0)
  return (
    <div className="timing-view">
      <div className="card timing-intro">
        <h3 style={{ margin: '0 0 4px' }}>Speed to Lead</h3>
        <p className="cap" style={{ margin: 0 }}>Time from a lead coming in to the <b>first manual (human) message</b> sent to them. Automated workflow / campaign / bulk messages are excluded, so this reflects how fast a person actually reaches out. {d.full ? <>Covers the <b>whole date range</b> — {fmtNumber(d.totalLeads)} leads.</> : <>Based on a sample of the {d.sampled} most recent lead{d.sampled === 1 ? '' : 's'} in this range{d.totalLeads > d.sampled ? ` (of ${d.totalLeads})` : ''}.</>}</p>
        <div className="tm-scan">
          {!scan && <button className="set-relink" onClick={runScan}>⟳ Scan the whole date range (not just a sample)</button>}
          {scan && <>
            <span className={scan.status === 'done' ? 'tm-scan-done' : ''}>{scan.status === 'done' ? `✓ Full scan complete · ${fmtNumber(scan.total)} leads` : scan.status === 'err' ? '⚠ Scan failed — try again' : `Scanning conversations… ${fmtNumber(scan.processed)} / ${fmtNumber(scan.total)} leads`}</span>
            {scanning && <span className="ov-spin" />}
            <button className="set-relink" onClick={stopScan}>{scan.status === 'running' ? 'Stop' : 'Back to sample'}</button>
          </>}
        </div>
        {d.viaAppt > 0 && <div className="tm-hours">📌 <b>{fmtNumber(d.viaAppt)} of {fmtNumber(d.measured)}</b> measured leads had <b>no manual message</b>, so their <b>first staff-booked appointment</b> was used as the speed signal instead (automated / self-bookings don't count). Useful for clients who work leads by phone/booking rather than messaging.</div>}
        {d.hours
          ? <div className="tm-hours on">🕘 Measured within working hours · <b>{fmtHours(d.hours)}</b> — after-hours gaps don't count against response time. Change in Settings → client → Summary.</div>
          : <div className="tm-hours">🕘 Measuring raw round-the-clock time. Set the team's <b>working hours</b> in Settings → client → Summary so overnight leads aren't counted as slow responses.</div>}
      </div>
      <div className="timing-scards">
        <div className="tm-sc hero"><span className="tm-lab">Median speed to lead</span><b>{fmtDuration(d.medianMin)}</b><span className="tm-sub">typical human response</span></div>
        <div className="tm-sc"><span className="tm-lab">Average</span><b>{fmtDuration(d.avgMin)}</b><span className="tm-sub">mean of manual replies</span></div>
        <div className="tm-sc"><span className="tm-lab">Contacted &lt; 5 min</span><b>{d.within5Pct == null ? '-' : `${d.within5Pct}%`}</b><span className="tm-sub">of measured leads</span></div>
        <div className="tm-sc"><span className="tm-lab">Manually contacted</span><b>{d.measured}</b><span className="tm-sub">of {d.sampled} sampled</span></div>
        <div className="tm-sc warn"><span className="tm-lab">Only automation</span><b>{d.onlyAuto}</b><span className="tm-sub">no human message yet</span></div>
        <div className="tm-sc warn"><span className="tm-lab">No outreach</span><b>{d.noOutbound}</b><span className="tm-sub">no outbound at all</span></div>
      </div>
      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>How fast leads get a human reply</div>
        <div className="timing-bars">
          {d.buckets.map((b) => (
            <div className="tm-bar-row" key={b.label}>
              <span className="tm-bar-lab">{b.label}</span>
              <span className="tm-bar-track"><span className="tm-bar-fill" style={{ width: `${(b.count / maxB) * 100}%` }} /></span>
              <span className="tm-bar-val">{b.count}</span>
            </div>
          ))}
        </div>
        <p className="caveat" style={{ marginTop: 12 }}>{d.measured ? `${fastCount} of ${d.measured} measured leads got a human reply within the hour.` : 'No manual replies measured in the sample.'} Speed to Lead is one of the strongest predictors of conversion — the first few minutes matter most.</p>
      </div>
      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Does responding faster convert better? — outcomes by response speed</div>
        <div className="table-wrap"><table className="mini-tbl appt-tbl">
          <thead><tr><th className="lft">Response time</th><th>Leads</th><th>Booked</th><th>Book %</th><th>Shown</th><th>Show %</th><th>Won</th><th>Win %</th></tr></thead>
          <tbody>{d.buckets.map((b) => (
            <tr key={b.label}>
              <td className="lft">{b.label}</td>
              <td>{fmtNumber(b.count)}</td>
              <td>{fmtNumber(b.booked)}</td>
              <td>{b.bookRate == null ? '-' : `${b.bookRate}%`}</td>
              <td>{fmtNumber(b.shown)}</td>
              <td>{b.showRate == null ? '-' : `${b.showRate}%`}</td>
              <td>{fmtNumber(b.won)}</td>
              <td>{b.winRate == null ? '-' : `${b.winRate}%`}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>Each row is the measured leads whose first human reply fell in that window. Book % = booked ÷ leads, Show % = shown ÷ booked, Win % = won ÷ leads. If the top rows convert best, faster response is paying off. Small samples make single rows noisy — read the trend, not one cell.</p>
      </div>
      <div className="card">
        <button className="linker-toggle" onClick={() => setShowDbg((v) => !v)}>{showDbg ? '▾' : '▸'} How manual vs automated is decided ({(d.sourceBreakdown || []).length} message sources)</button>
        {showDbg && <>
          <p className="cap" style={{ marginTop: 8 }}>A message counts as <b>manual</b> only when it's <b>attributed to a user</b> and its source isn't an automation (workflow, campaign, bulk, trigger, API, auto-reply). A send with no user — even one tagged source “app” — is treated as automated. Below is every outbound message source seen in the sample and how it was classified — use this to confirm it looks right for this client.</p>
          <div className="table-wrap"><table className="mini-tbl"><thead><tr><th>Message source · user attribution</th><th>Classified as</th><th>Count</th></tr></thead><tbody>{(d.sourceBreakdown || []).map((s) => <tr key={s.source}><td>{s.source}</td><td><span className={`tm-kind ${s.kind}`}>{s.kind || '-'}</span></td><td>{s.count}</td></tr>)}{!(d.sourceBreakdown || []).length && <tr><td colSpan={3} className="cap">No outbound messages in the sample.</td></tr>}</tbody></table></div>
          <TimingDebug clientId={clientId} range={range} />
        </>}
      </div>
    </div>
  )
}
// On-demand message-level detail: for a handful of leads, the actual first
// outbound messages (source / user / timing) so the classification and the
// lead-in anchor can be validated against reality.
function TimingDebug({ clientId, range }) {
  const [st, setSt] = useState({ status: 'idle', rows: null })
  const load = () => {
    setSt({ status: 'loading', rows: null })
    fetch(`/.netlify/functions/windsor?scope=speed&client=${clientId}&${rangeQuery(range)}&sample=20&debug=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', rows: j.debug || [] }))
      .catch(() => setSt({ status: 'err', rows: null }))
  }
  return (
    <div style={{ marginTop: 12 }}>
      {st.status === 'idle' && <button className="set-relink" onClick={load}>Load message-level detail (sample of leads)</button>}
      {st.status === 'loading' && <Spinner label="Reading a sample of leads' first messages…" />}
      {st.status === 'err' && <p className="cap">Couldn't load the detail — try again.</p>}
      {st.status === 'ok' && (!st.rows.length
        ? <p className="cap">No message detail available for the sample.</p>
        : <div className="table-wrap"><table className="mini-tbl tm-dbg"><thead><tr><th>Lead in</th><th>Opp created</th><th>First manual</th><th>First outbound messages (source · user · classify · min after lead-in)</th></tr></thead><tbody>{st.rows.map((r, i) => (
          <tr key={i}>
            <td>{new Date(r.leadIn).toLocaleString()}</td>
            <td>{Math.round((Date.parse(r.createdAt) - Date.parse(r.leadIn)) / 60000)}m later</td>
            <td>{r.firstManualMin == null ? '—' : fmtDuration(r.firstManualMin)}</td>
            <td>{r.msgs.length ? r.msgs.map((m, j) => <span key={j} className="tm-dbg-msg"><b>{m.source}</b> · {m.hasUser ? 'user' : 'no-user'} · <span className={`tm-kind ${m.kind}`}>{m.kind}</span> · {m.minAfterLeadIn}m</span>) : <span className="cap">no outbound</span>}</td>
          </tr>
        ))}</tbody></table></div>)}
    </div>
  )
}
/* ============ Users (per-rep performance) ============ */
// One live-deal row in the open-deals drill-down; expands to fetch the contact's
// CRM notes on demand (the "why is this stuck?" context).
function OpenDealRow({ d, clientId, money, showPipe }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = () => {
    setLoading(true)
    const q = new URLSearchParams({ scope: 'oppnotes', client: clientId })
    if (d.contactId) q.set('contact', d.contactId)
    fetch(`/.netlify/functions/windsor?${q.toString()}`).then((r) => r.json()).then((j) => setNotes((j && j.notes) || [])).catch(() => setNotes([])).finally(() => setLoading(false))
  }
  const toggle = () => { const nx = !open; setOpen(nx); if (nx && notes === null && !loading && d.contactId) load() }
  return (
    <React.Fragment>
      <tr className={open ? 'row-sel' : ''} style={{ cursor: d.contactId ? 'pointer' : 'default' }} onClick={d.contactId ? toggle : undefined}>
        <td className="lft">{d.contactId ? <span className="u-chev">{open ? '▾' : '▸'}</span> : null} {d.name}{showPipe ? <span className="cap"> · {d.pipeline}</span> : null}</td>
        <td className="lft">{d.contact}{d.email || d.phone ? <div className="cap">{[d.email, d.phone].filter(Boolean).join(' · ')}</div> : null}</td>
        <td>{d.value ? money(d.value) : '-'}</td>
        <td className={d.ageDays != null && d.ageDays > 30 ? 'u-stale' : ''}>{d.ageDays != null ? `${fmtNumber(d.ageDays)}d` : '-'}</td>
      </tr>
      {open && <tr className="u-notes-row"><td colSpan={4}>
        {loading ? <Spinner label="Loading notes…" /> : notes && notes.length ? <div className="u-notes">{notes.map((n, i) => <div className="u-note-item" key={i}><div className="u-note-meta">{n.author || 'Team'}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleDateString()}` : ''}</div><div className="u-note-body">{n.body}</div></div>)}</div> : <div className="cap" style={{ padding: '2px 2px 6px' }}>No notes on this contact in Caalano Systems.</div>}
      </td></tr>}
    </React.Fragment>
  )
}
function UsersView({ clientId, range, nonce, currency }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [pipe, setPipe] = useState('all')
  const [chan, setChan] = useState('all')
  const [sort, setSort] = useState({ key: 'won', dir: -1 })
  const [open, setOpen] = useState(null) // expanded user id
  const [drill, setDrill] = useState(null) // { name, stage, deals } for the open-deals modal
  const money = (v) => fmtCurrency(v, currency)
  const pipeParam = pipe !== 'all' ? `&pipeline=${encodeURIComponent(pipe)}` : ''
  const chanParam = chan !== 'all' ? `&channel=${chan}` : ''
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000)
    fetch(`/.netlify/functions/windsor?scope=users&client=${clientId}&${rangeQuery(range)}${pipeParam}${chanParam}${nonce ? `&_r=${nonce}` : ''}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`server ${r.status}`))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch((e) => { if (alive) setSt({ status: 'err', data: { error: e && e.name === 'AbortError' ? 'timed out' : String((e && e.message) || e) } }) })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; ctl.abort() }
  }, [clientId, rangeQuery(range), pipeParam, chanParam, nonce])
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading user performance…" /></div>
  const d = st.data || {}
  if (st.status === 'err' || d.connected === false) return <div className="card empty-deep"><div className="big">👤</div><b>Couldn't load user performance.</b><p style={{ maxWidth: 520, margin: '8px auto 0', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{d.error || 'Caalano Systems not connected.'}</p></div>
  const users = d.users || []
  const pipes = d.pipelines || []
  const totalSpend = d.totalSpend || 0
  const pipeSel = pipes.length > 1 && (
    <label className="appt-f"><span>Pipeline</span><select value={pipe} onChange={(e) => { setPipe(e.target.value); setOpen(null) }}><option value="all">All pipelines</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  )
  const chanSel = (
    <div className="chan-toggle">{[['all', 'All'], ['paid', 'Paid'], ['nonpaid', 'Non-Paid'], ['meta', 'Meta'], ['google', 'Google']].map(([k, lbl]) => <button key={k} className={chan === k ? 'on' : ''} onClick={() => { setChan(k); setOpen(null) }}>{lbl}</button>)}</div>
  )
  if (!users.length) return <div className="timing-view"><div className="appt-head"><div><h3 style={{ margin: 0 }}>Users</h3></div>{pipeSel}</div><div className="card empty-deep"><div className="big">👤</div><b>No user-assigned opportunities in this range{pipe !== 'all' ? ' for this pipeline' : ''}.</b></div></div>
  // Configured stage key events -> matrix columns (stage reach per user), sorted
  // by their real pipeline position so the funnel reads top-to-bottom (and the
  // cumulative step % make sense) instead of following config order.
  const stageRank = {}
  { let base = 0; for (const p of pipes) { (p.stages || []).forEach((s, i) => { if (stageRank[s] == null) stageRank[s] = base + i }); base += (p.stages || []).length } }
  const resolvedKe = mergeCalKeyEvents(normKeyEvents(keyEventsForPipe(loadKeyEvents(clientId), pipe === 'all' ? 'all' : pipe)))
  const stageCols = [...new Set(resolvedKe.filter((e) => !WON_RE.test(e.label)).map((e) => (e.kind === 'calendar' ? e.stage : e.ref)).filter(Boolean))]
    .sort((a, b) => (stageRank[a] != null ? stageRank[a] : 9999) - (stageRank[b] != null ? stageRank[b] : 9999))
  const withCost = users.map((u) => ({ ...u, costWon: u.won && totalSpend ? totalSpend / u.won : null, costBooked: u.booked && totalSpend ? totalSpend / u.booked : null }))
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const sorted = [...withCost].sort((a, b) => { const av = a[sort.key], bv = b[sort.key]; if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * sort.dir; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return (av - bv) * sort.dir })
  const tot = users.reduce((a, u) => ({ leads: a.leads + u.leads, booked: a.booked + u.booked, shown: a.shown + u.shown, won: a.won + u.won, revenue: a.revenue + u.revenue }), { leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 })
  const chartData = withCost.slice().sort((a, b) => b.won - a.won).slice(0, 12).map((u) => ({ name: u.name.length > 14 ? u.name.slice(0, 13) + '…' : u.name, Won: u.won, Revenue: u.revenue }))
  const Th = ({ k, children, l }) => <th className={l ? 'lft' : 'num'} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <div className="timing-view">
      <div className="appt-head">
        <div><h3 style={{ margin: '0 0 2px' }}>Users — sales-rep performance</h3><p className="cap" style={{ margin: 0 }}>Opportunities grouped by their <b>assigned user</b>: full funnel, per-stage reach, win rate, revenue and time-to-close. The channel filter scopes each rep's leads by their first-touch UTM; cost figures use the <b>{chan === 'nonpaid' ? 'n/a — no ad spend for non-paid' : chan === 'meta' ? 'Meta' : chan === 'google' ? 'Google' : chan === 'paid' ? 'Meta + Google' : 'total'}</b> ad spend ÷ that rep's outcomes (blended — spend isn't caused by the rep).</p></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{chanSel}{pipeSel}</div>
      </div>
      <div className="timing-scards">
        <div className="tm-sc hero"><span className="tm-lab">Reps</span><b>{fmtNumber(users.length)}</b><span className="tm-sub">with assigned leads</span></div>
        <div className="tm-sc"><span className="tm-lab">Leads</span><b>{fmtNumber(tot.leads)}</b><span className="tm-sub">assigned in range</span></div>
        <div className="tm-sc"><span className="tm-lab">Booked</span><b>{fmtNumber(tot.booked)}</b><span className="tm-sub">{fmtNumber(tot.shown)} shown</span></div>
        <div className="tm-sc"><span className="tm-lab">Won</span><b>{fmtNumber(tot.won)}</b><span className="tm-sub">{tot.leads ? Math.round((tot.won / tot.leads) * 100) : 0}% win rate</span></div>
        <div className="tm-sc"><span className="tm-lab">Revenue</span><b>{money(tot.revenue)}</b><span className="tm-sub">{totalSpend ? `${money(totalSpend)} ad spend` : ''}</span></div>
      </div>

      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Won &amp; revenue by rep</div>
        <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34 + 30)}>
          <ComposedChart data={chartData} layout="vertical" margin={{ left: 10, right: 12, top: 6 }}>
            <CartesianGrid stroke="var(--border)" horizontal={false} />
            <XAxis type="number" fontSize={10} stroke="var(--muted)" allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={130} fontSize={11} stroke="var(--muted)" interval={0} />
            <Tooltip formatter={(v, n) => [n === 'Revenue' ? money(v) : fmtNumber(v), n]} />
            <Bar dataKey="Won" fill="#12b886" radius={[0, 3, 3, 0]} maxBarSize={16} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Leaderboard <span style={{ fontWeight: 400 }}>· click a rep to expand their funnel &amp; pipelines</span></div>
        <div className="table-wrap"><table className="mini-tbl appt-tbl users-tbl">
          <thead><tr><Th k="name" l>Rep</Th><Th k="leads">Leads</Th><Th k="booked">Booked</Th><Th k="bookRate">Book %</Th><Th k="shown">Shown</Th><Th k="showRate">Show %</Th><Th k="won">Won</Th><Th k="winRate">Win %</Th><Th k="revenue">Revenue</Th><Th k="avgDeal">Avg deal</Th><Th k="avgCloseDays">Avg close</Th><Th k="costWon">Cost / Won</Th></tr></thead>
          <tbody>{sorted.map((u) => {
            const isOpen = open === u.id
            return (
              <React.Fragment key={u.id}>
                <tr className={isOpen ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : u.id)}>
                  <td className="lft"><span className="u-chev">{isOpen ? '▾' : '▸'}</span> {u.name}</td>
                  <td>{fmtNumber(u.leads)}</td><td>{fmtNumber(u.booked)}</td><td>{u.bookRate == null ? '-' : `${u.bookRate}%`}</td>
                  <td>{fmtNumber(u.shown)}</td><td>{u.showRate == null ? '-' : `${u.showRate}%`}</td>
                  <td>{fmtNumber(u.won)}</td><td>{u.winRate == null ? '-' : `${u.winRate}%`}</td>
                  <td>{money(u.revenue)}</td><td>{u.avgDeal != null ? money(u.avgDeal) : '-'}</td><td>{u.avgCloseDays != null ? `${u.avgCloseDays}d` : '-'}</td>
                  <td>{u.costWon != null ? money(u.costWon) : '-'}</td>
                </tr>
                {isOpen && <tr className="u-detail-row"><td colSpan={12}>
                  <div className="u-detail">
                    <div className="u-detail-main">
                      <div className="u-val-cards">
                        <div className="u-vc"><span>Total pipeline</span><b>{money(u.pipelineValue || 0)}</b><i>{fmtNumber(u.leads)} deals</i></div>
                        <div className="u-vc open"><span>Open (live)</span><b>{money(u.openValue || 0)}</b><i>{fmtNumber(u.open)} deals still in play</i></div>
                        <div className="u-vc won"><span>Won</span><b>{money(u.wonValue != null ? u.wonValue : u.revenue)}</b><i>{fmtNumber(u.won)} deals</i></div>
                        <div className="u-vc lost"><span>Lost</span><b>{money(u.lostValue || 0)}</b><i>{fmtNumber(u.lost)} deals</i></div>
                      </div>
                      <div className="u-funnel">
                        <div className="u-fn-head"><span /><span>reached</span><span title="Conversion from the previous stage">step</span><span title="Conversion from all leads">total</span></div>
                        {(stageCols.length ? [['Leads', u.leads], ...stageCols.map((s) => [s, (u.stages && u.stages[s]) || 0]), ['Won', u.won]] : [['Leads', u.leads], ['Booked', u.booked], ['Shown', u.shown], ['Won', u.won]]).map(([lbl, n], i, arr) => {
                          const max = Math.max(1, u.leads); const prev = i > 0 ? arr[i - 1][1] : null
                          return <div className="u-fn-row" key={lbl}><span className="u-fn-lab" title={lbl}>{lbl}</span><span className="u-fn-track"><span className="u-fn-fill" style={{ width: `${Math.max(5, (n / max) * 100)}%` }}>{fmtNumber(n)}</span></span><span className="u-fn-rate" title="vs previous stage">{prev == null ? '' : prev ? `${Math.round((n / prev) * 100)}%` : ''}</span><span className="u-fn-tot" title="vs all leads">{u.leads ? `${Math.round((n / u.leads) * 100)}%` : ''}</span></div>
                        })}
                      </div>
                      {u.openDeals && u.openDeals.length > 0 && (() => {
                        const byStage = {}
                        for (const dl of u.openDeals) { const g = byStage[dl.stage] || { open: 0, value: 0, deals: [] }; g.open++; g.value += dl.value; g.deals.push(dl); byStage[dl.stage] = g }
                        const rows = Object.entries(byStage).sort((a, b) => ((stageRank[a[0]] != null ? stageRank[a[0]] : 9999) - (stageRank[b[0]] != null ? stageRank[b[0]] : 9999)))
                        return <div className="u-open-panel">
                          <div className="cap" style={{ fontWeight: 700, margin: '2px 0 5px' }}>Open pipeline by stage <span style={{ fontWeight: 400 }}>· {fmtNumber(u.open)} live · {money(u.openValue || 0)} · click a stage to see the deals</span></div>
                          <div className="u-open-rows">{rows.map(([stage, g]) => <button key={stage} className="u-open-row" onClick={() => setDrill({ name: u.name, stage, deals: g.deals })}><span className="u-open-st" title={stage}>{stage}</span><span className="u-open-n"><b>{fmtNumber(g.open)}</b> open</span><span className="u-open-v">{money(g.value)}</span><span className="u-open-go">→</span></button>)}</div>
                        </div>
                      })()}
                      <p className="caveat" style={{ marginTop: 8 }}>Reached is cumulative (a later stage counts the earlier ones). Open pipeline = deals sitting at each stage right now, still in play (not won/lost) — click a stage to drill into the individual live deals.</p>
                    </div>
                    <div className="u-detail-side">
                      {u.lostReasons && u.lostReasons.length > 0 && <div className="u-lost">
                        <div className="cap" style={{ fontWeight: 700, marginBottom: 4 }}>Lost reasons</div>
                        <table className="mini-tbl"><thead><tr><th className="lft">Reason</th><th>Deals</th><th>Value</th></tr></thead><tbody>{u.lostReasons.map((r) => <tr key={r.reason}><td className="lft">{r.reason}</td><td>{fmtNumber(r.count)}</td><td>{r.value ? money(r.value) : '-'}</td></tr>)}</tbody></table>
                      </div>}
                      {u.byPipeline && u.byPipeline.length > 1 && <div className="u-pipes">
                        <div className="cap" style={{ fontWeight: 700, marginBottom: 4 }}>By pipeline</div>
                        <table className="mini-tbl"><thead><tr><th className="lft">Pipeline</th><th>Leads</th><th>Won</th><th>Revenue</th></tr></thead><tbody>{u.byPipeline.map((p) => <tr key={p.id}><td className="lft">{p.name}</td><td>{fmtNumber(p.leads)}</td><td>{fmtNumber(p.won)}</td><td>{money(p.revenue)}</td></tr>)}</tbody></table>
                      </div>}
                    </div>
                  </div>
                </td></tr>}
              </React.Fragment>
            )
          })}</tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>Booked / Shown come from the appointment feed for each rep's assigned leads; Won / Revenue from won opportunities. <b>Cost / Won</b> = the account's total ad spend ÷ this rep's won deals (blended — it shows which rep turns the shared ad spend into revenue most efficiently, not that the rep caused the spend).</p>
      </div>

      {stageCols.length > 0 && <div className="card">
        <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Key events reached, per rep</div>
        <div className="table-wrap"><table className="mini-tbl appt-tbl users-tbl">
          <thead><tr><th className="lft">Rep</th><th>Leads</th>{stageCols.map((s) => <th key={s} title={s}>{s.length > 14 ? s.slice(0, 13) + '…' : s}</th>)}<th>Won</th></tr></thead>
          <tbody>{sorted.map((u) => (
            <tr key={u.id}><td className="lft">{u.name}</td><td>{fmtNumber(u.leads)}</td>{stageCols.map((s) => <td key={s}>{fmtNumber(u.stages[s] || 0)}</td>)}<td>{fmtNumber(u.won)}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="caveat" style={{ marginTop: 10 }}>How many of each rep's leads reached each configured key stage (cumulative — reaching a later stage counts the earlier ones). Configure the stages in Settings → the client → Key events.</p>
      </div>}
      {drill && <div className="modal-bg" onClick={() => setDrill(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
          <div className="m-head"><div><h3 style={{ margin: 0 }}>Open deals — {drill.stage}</h3><span className="cap">{drill.name} · {fmtNumber(drill.deals.length)} live · {money(drill.deals.reduce((s, d) => s + d.value, 0))}</span></div><button className="icon-btn" onClick={() => setDrill(null)}>✕</button></div>
          <div className="m-body">
            <div className="table-wrap"><table className="mini-tbl u-drill-tbl">
              <colgroup><col className="c-opp" /><col className="c-con" /><col className="c-val" /><col className="c-days" /></colgroup>
              <thead><tr><th className="lft">Opportunity</th><th className="lft">Contact</th><th>Value</th><th>Days in stage</th></tr></thead>
              <tbody>{(() => { const showPipe = drill.deals.some((x) => x.pipeline !== drill.deals[0].pipeline); return drill.deals.slice().sort((a, b) => b.value - a.value).map((d, i) => <OpenDealRow key={d.id || i} d={d} clientId={clientId} money={money} showPipe={showPipe} />) })()}</tbody>
            </table></div>
            <p className="caveat">Live opportunities currently sitting at this stage (not won/lost), highest value first. <b>Days in stage</b> = time since the deal last moved (amber = 30+ days, likely stalled). <b>Click a deal to read its Caalano Systems notes</b> — the context on why it may be stuck.</p>
          </div>
        </div>
      </div>}
    </div>
  )
}
function ClientWorkspace({ client, index, data, config, range, nonce, onBack, authUser }) {
  const [tab, setTab] = useState('overall')
  const [baked, setBaked] = useState(undefined)
  const [crmAvgClose, setCrmAvgClose] = useState(null)
  useEffect(() => { setBaked(undefined); setCrmAvgClose(null); fetch(`data/clients/${client.id}.json`).then((r) => (r.ok ? r.json() : null)).then(setBaked).catch(() => setBaked(null)) }, [client.id])
  // Build this client's tab set, then narrow it to what the viewer is allowed to
  // see (admins/users: everything). curTab keeps a hidden tab from being active.
  const cfg = ((config && config.clients) || []).find((c) => c.id === client.id) || {}
  const allTabs = [{ id: 'overall', label: 'Caalano360' }]
  if (cfg.ghl) allTabs.push({ id: 'users', label: 'Users' })
  allTabs.push({ id: 'meta', label: 'Meta Ads' })
  if (cfg.google || client.google) allTabs.push({ id: 'google', label: 'Google Ads' })
  if (cfg.ghl) allTabs.push({ id: 'cohorts', label: 'Cohorts' }, { id: 'forms', label: 'Forms' }, { id: 'location', label: 'Location' }, { id: 'appts', label: 'Appointments' }, { id: 'timing', label: 'Timing' })
  const tabs = allowedTabsFE(authUser, allTabs)
  const curTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0] ? tabs[0].id : 'overall')
  const channel = curTab === 'meta' ? 'meta' : curTab === 'google' ? 'google' : curTab === 'overall' ? 'blend' : null
  const live = useLiveDeep(client.id, channel, range, nonce)
  // Capture the CRM's average sales-cycle length whenever the blend loads, so the
  // maturity badge stays put as the user moves between tabs.
  useEffect(() => {
    const wc = live && live.status === 'ok' && live.data && live.data.blend && live.data.blend.wonClosed
    if (wc && wc.avgCloseDays != null) setCrmAvgClose(wc.avgCloseDays)
  }, [live])
  const attr = useAttribution(client.id, range, nonce)
  const tk = TRACK[client.trackingStatus] || TRACK.full
  const presetLabel = rangeLabel(range)
  const liveOK = (ch) => {
    if (live.status !== 'ok' || !live.data || !live.data[ch]) return false
    const d = live.data[ch]
    if (ch === 'ghl') return !!d.summary
    return (d.campaigns && d.campaigns.length) || (d.ads && d.ads.length)
  }
  const srcFor = (ch) => (liveOK(ch) ? live.data : baked)
  return (
    <>
      <div className="cw-head">
        {onBack && <button className="back" onClick={onBack}>← All clients</button>}
        <div className="cw-top">
          <span className="avatar" style={{ background: acolor(index) }}>{initials(client.name)}</span>
          <div><h2>{client.name} <span className={`tk ${tk.cls}`}>{tk.label}</span> <MaturityBadge clientId={client.id} crmAvg={crmAvgClose} range={range} /></h2><div className="meta">{client.industry}</div></div>
        </div>
        <div className="subtabs">{tabs.map((t) => <button key={t.id} className={curTab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        {curTab === 'overall' && <ExecutiveDashboard clientId={client.id} clientName={client.name} currency={data.currency} range={range} nonce={nonce} onNav={setTab} authUser={authUser} />}
        {curTab === 'users' && <UsersView clientId={client.id} range={range} nonce={nonce} currency={data.currency} />}
        {curTab === 'meta' && (live.status === 'loading' ? <div className="card"><Spinner label="Loading live Meta data…" /></div> : <><LiveBadge mode={liveOK('meta') ? 'live' : (baked ? 'snapshot' : null)} label={presetLabel} /><MetaDeep deep={srcFor('meta')} currency={data.currency} attr={attr} clientId={client.id} range={range} nonce={nonce} /></>)}
        {curTab === 'google' && (live.status === 'loading' ? <div className="card"><Spinner label="Loading live Google data…" /></div> : <><LiveBadge mode={liveOK('google') ? 'live' : (baked ? 'snapshot' : null)} label={presetLabel} /><GoogleDeep deep={srcFor('google')} currency={data.currency} attr={attr} clientId={client.id} range={range} nonce={nonce} /></>)}
        {curTab === 'cohorts' && <CohortView clientId={client.id} currency={data.currency} nonce={nonce} />}
        {curTab === 'forms' && <FormsView clientId={client.id} currency={data.currency} range={range} nonce={nonce} />}
        {curTab === 'location' && <LocationView clientId={client.id} currency={data.currency} range={range} nonce={nonce} />}
        {curTab === 'appts' && <AppointmentsView clientId={client.id} range={range} nonce={nonce} />}
        {curTab === 'timing' && <TimingView clientId={client.id} range={range} nonce={nonce} />}
      </div>
    </>
  )
}

/* ============ Settings ============ */
// Campaign → pipeline linker, per client. Fetches the client's campaigns +
// pipelines on expand and writes overrides to the shared localStorage map that
// Caalano360 reads for spend attribution.
function KpiEditor({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [pid, setPid] = useState('') // '' = client-level; a pipeline id = per-pipeline
  const [k, setK] = useState(() => loadKpis(clientId))
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  const pipes = (st.blend && st.blend.pipelines) || []
  const multi = pipes.length > 1
  // Multi-pipeline clients set every target per pipeline; default to the first.
  useEffect(() => { if (multi && !pid) setPid(pipes[0].id) }, [multi]) // eslint-disable-line
  useEffect(() => { setK(loadKpis(clientId, pid || undefined)) }, [pid, clientId])
  const set = (patch) => setK((p) => { const nx = { ...p, ...patch }; saveKpis(clientId, nx, pid || undefined); return nx })
  const setStage = (name, val) => setK((p) => { const stages = { ...(p.stages || {}) }; if (val === '') delete stages[name]; else stages[name] = Number(val); const nx = { ...p, stages }; saveKpis(clientId, nx, pid || undefined); return nx })
  const selPipe = pipes.find((p) => p.id === pid)
  const stageNames = multi ? ((selPipe && selPipe.stages) || []).map((s) => s.name) : [...new Set(pipes.flatMap((p) => (p.stages || []).map((s) => s.name)))]
  const numOr = (v) => (v == null || v === '' ? '' : v)
  const body = (
    <div className={embedded ? '' : 'linker-body'}>
      {multi && <div className="kpi-pipe-sel">
        <label>Pipeline</label>
        <select value={pid} onChange={(e) => setPid(e.target.value)}>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="cap">Targets are set per pipeline for this client.</span>
      </div>}
      <div className="kpi-inputs">
        <label>Meta cost / lead<input type="number" min="0" value={numOr(k.metaCpl)} onChange={(e) => set({ metaCpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        <label>Google cost / conv<input type="number" min="0" value={numOr(k.googleCostConv)} onChange={(e) => set({ googleCostConv: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        <label>Avg client LTV<input type="number" min="0" value={numOr(k.clientLtv)} onChange={(e) => set({ clientLtv: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ lifetime value" /></label>
      </div>
      <div className="cap" style={{ marginTop: 2 }}>LTV powers the Caalano360 unit-economics header (LTV:CAC, profit per client). Leave blank to use average deal value.</div>
      <div className="cap" style={{ marginTop: 8, fontWeight: 700 }}>Weekly Traffic Light targets</div>
      <div className="kpi-inputs">
        <label>Weekly spend<input type="number" min="0" value={numOr(k.wkSpend)} onChange={(e) => set({ wkSpend: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ / week" /></label>
        <label>All-leads CPL<input type="number" min="0" value={numOr(k.cpl)} onChange={(e) => set({ cpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        <label>Cost / booked appt<input type="number" min="0" value={numOr(k.cpba)} onChange={(e) => set({ cpba: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        <label>Cost / won (CPA)<input type="number" min="0" value={numOr(k.cpa)} onChange={(e) => set({ cpa: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        <label>Booking rate %<input type="number" min="0" value={numOr(k.bookingRate)} onChange={(e) => set({ bookingRate: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="% target" /></label>
      </div>
      {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
        : stageNames.length ? <>
          <div className="cap" style={{ marginTop: 8, fontWeight: 700 }}>Target leads at each pipeline stage{multi && selPipe ? ` · ${selPipe.name}` : ''}</div>
          <div className="kpi-stages">{stageNames.map((n) => <label className="kpi-stage" key={n}><span title={n}>{n}</span><input type="number" min="0" value={numOr(k.stages && k.stages[n])} onChange={(e) => setStage(n, e.target.value)} placeholder="-" /></label>)}</div>
        </> : st.status === 'ok' ? <p className="cap">No Caalano Systems pipeline stages found.</p> : null}
    </div>
  )
  if (embedded) return body
  return (
    <div className="linker">
      <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} KPI targets</button>
      {open && body}
    </div>
  )
}
// Tracking health & lead reconciliation (moved to Settings). Ad-reported vs CRM
// leads, variance, and source-tag coverage for one client.
function TrackingHealth({ paid, crmLeads, attribData, channels, periodLabel }) {
  const p = paid || {}
  const adLeads = (p.metaLeads || 0) + (p.googleConv || 0)
  const variance = adLeads ? ((crmLeads - adLeads) / adLeads) * 100 : null
  const opps = attribData ? attribData.opps : null
  const attributed = attribData ? attribData.attributed : null
  const cov = opps ? (attributed / opps) * 100 : null
  const covCls = cov == null ? '' : cov >= 80 ? 'good' : cov >= 50 ? 'warn' : 'bad'
  const chMeta = channels ? (channels.meta?.totals?.leads || 0) : 0
  const chGoogle = channels ? (channels.google?.totals?.leads || 0) : 0
  const chOther = channels ? (channels.other?.totals?.leads || 0) : 0
  const totCh = chMeta + chGoogle + chOther || 1
  // Manually-added (CRM UI) opportunities inflate the CRM count vs what the ads
  // actually drove. Exclude them to get the true ad-vs-CRM gap.
  const manual = attribData ? (attribData.manualLeads || 0) : 0
  const crmExcl = Math.max(0, crmLeads - manual)
  const trueVar = adLeads ? ((crmExcl - adLeads) / adLeads) * 100 : null
  const varCls = (v) => v == null ? '' : Math.abs(v) <= 15 ? 'good' : Math.abs(v) <= 35 ? 'warn' : 'bad'
  const sources = (attribData && attribData.oppSources) || []
  return (
    <div className="card th-card" style={{ marginTop: 12 }}>
      <div className="th-head">
        <h3>Tracking health &amp; lead reconciliation</h3>
        {cov != null && <span className={`th-cov ${covCls}`}>{cov.toFixed(0)}% of opportunities have a source tag</span>}
      </div>
      <div className="th-grid">
        <div className="th-stat"><div className="th-l">Ad-reported leads</div><div className="th-v">{fmtNumber(adLeads)}</div><div className="th-sub">Meta {fmtNumber(p.metaLeads || 0)} · Google {fmtNumber(p.googleConv || 0)}</div></div>
        <div className="th-stat"><div className="th-l">CRM opportunities</div><div className="th-v">{fmtNumber(crmLeads)}</div><div className="th-sub">created in {periodLabel}</div></div>
        <div className="th-stat"><div className="th-l">Manual (CRM UI)</div><div className="th-v th-manual">{attribData ? fmtNumber(manual) : '-'}</div><div className="th-sub">added by hand · excluded below</div></div>
        <div className="th-stat"><div className="th-l">CRM excl. manual</div><div className="th-v">{attribData ? fmtNumber(crmExcl) : '-'}</div><div className="th-sub">the true ad-driven CRM count</div></div>
        <div className="th-stat"><div className="th-l">True variance</div><div className={`th-v ${attribData ? varCls(trueVar) : ''}`}>{!attribData || trueVar == null ? '-' : `${trueVar > 0 ? '+' : ''}${trueVar.toFixed(0)}%`}</div><div className="th-sub">ad vs CRM excl. manual{variance != null ? ` · raw ${variance > 0 ? '+' : ''}${variance.toFixed(0)}%` : ''}</div></div>
        <div className="th-stat"><div className="th-l">Tagged source split</div>
          {attribData ? <>
            <div className="th-bar"><span style={{ width: `${(chMeta / totCh) * 100}%`, background: '#4f7cff' }} /><span style={{ width: `${(chGoogle / totCh) * 100}%`, background: '#12b886' }} /><span style={{ width: `${(chOther / totCh) * 100}%`, background: 'var(--faint)' }} /></div>
            <div className="th-sub">Meta {fmtNumber(chMeta)} · Google {fmtNumber(chGoogle)} · Other/untagged {fmtNumber(chOther)}</div>
          </> : <div className="th-sub">Connect Caalano Systems for source tagging.</div>}
        </div>
      </div>
      {sources.length > 0 && <div className="th-sources">
        <span className="th-sources-l">Opportunity sources</span>
        {sources.slice(0, 10).map((s) => <span key={s.name} className={`th-src ${s.manual ? 'manual' : ''}`}>{s.name} <b>{fmtNumber(s.count)}</b>{s.manual ? ' ✋' : ''}</span>)}
      </div>}
      <p className="caveat">Ad-reported leads are what Meta/Google count; CRM opportunities are what landed in Caalano Systems. <b>Manual (CRM UI)</b> opportunities were added by hand in the CRM (not driven by ads), so <b>True variance</b> compares ad-reported leads to CRM <b>excluding</b> those — the real gap. A remaining gap usually means duplicate/again-counted ad conversions, leads not reaching the CRM, or missing UTMs (see source-tag coverage). ✋ = a manually-added source.</p>
    </div>
  )
}

// Attribution diagnostics (moved to Settings). Exposes where paid spend and CRM
// revenue fail to tie together, with token-overlap "looks like" hints.
function AttributionDiagnostics({ attribData, camps, currency }) {
  if (!attribData || !camps || !camps.length) return null
  const money = (v) => fmtCurrency(v, currency)
  const badge = (s) => <span className="src-badge" style={{ background: s === 'Meta' ? '#4f7cff' : '#12b886' }}>{s === 'Meta' ? 'M' : 'G'}</span>
  const oCamp = mkOutcomeMap(attribData.byCampaign)
  const adNames = new Set(camps.map((cc) => unorm(cc.name)).filter(Boolean))
  const unmatchedAd = camps.filter((cc) => cc.spend > 0 && !oCamp.has(unorm(cc.name))).sort((a, z) => z.spend - a.spend)
  const notSet = (attribData.byCampaign || []).find((x) => x.name === '(not set)') || null
  const unmatchedUtm = (attribData.byCampaign || []).filter((x) => x.name !== '(not set)' && x.leads > 0 && !adNames.has(unorm(x.name))).sort((a, z) => (z.won - a.won) || (z.revenue - a.revenue) || (z.leads - a.leads))
  const lostRev = unmatchedUtm.reduce((s, x) => s + x.revenue, 0) + (notSet ? notSet.revenue : 0)
  const gapSpend = unmatchedAd.reduce((s, x) => s + x.spend, 0)
  if (!unmatchedAd.length && !unmatchedUtm.length && !(notSet && notSet.leads)) return null
  const opps = attribData.opps || 0, attributed = attribData.attributed || 0
  const cov = opps ? (attributed / opps) * 100 : null
  const covCls = cov == null ? '' : cov >= 80 ? 'good' : cov >= 50 ? 'warn' : 'bad'
  const toks = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)))
  const suggest = (name) => {
    const a = toks(name); if (!a.size) return null
    let best = null, bs = 0
    for (const cnd of unmatchedUtm) { const bb = toks(cnd.name); let s = 0; for (const w of a) if (bb.has(w)) s++; const score = s / Math.max(1, Math.min(a.size, bb.size)); if (score > bs) { bs = score; best = cnd } }
    return bs >= 0.34 && best ? best.name : null
  }
  return (
    <details className="card th-card attr-diag" style={{ marginTop: 12 }}>
      <summary>
        <span className="attr-sum-t">Attribution diagnostics</span>
        <span className={`th-cov ${covCls}`}>{cov == null ? 'no CRM data' : `${cov.toFixed(0)}% of leads UTM-tagged`}</span>
      </summary>
      <div className="attr-body">
        <p className="cap" style={{ marginTop: 4 }}>Where paid spend and CRM revenue do not tie together. Fixing UTM tags at the source is what makes the ROAS-by-campaign numbers trustworthy.</p>
        {notSet && notSet.leads > 0 && (
          <div className="attr-note">
            <b>{fmtNumber(notSet.leads)} leads</b> ({fmtNumber(notSet.won)} won, {money(notSet.revenue)}) arrived with <b>no utm_campaign at all</b>. These can never be tied to a campaign until UTM tagging is added on the landing pages / lead forms.
          </div>
        )}
        <div className="attr-cols">
          <div>
            <div className="attr-h">Ad spend with no CRM match{gapSpend > 0 ? ` · ${money(gapSpend)}` : ''}</div>
            {unmatchedAd.length ? <ul className="attr-list">
              {unmatchedAd.slice(0, 8).map((cc) => {
                const sg = suggest(cc.name)
                return <li key={cc.source + cc.name} className="attr-li-col"><div className="attr-row"><span className="attr-nm" title={cc.name}>{badge(cc.source)} {cc.name}</span><span className="attr-x">{money(cc.spend)}</span></div>{sg ? <div className="attr-sug" title={`Unmatched CRM campaign "${sg}" looks related`}>looks like &ldquo;{sg}&rdquo;</div> : null}</li>
              })}
              {unmatchedAd.length > 8 && <li className="attr-more">+{unmatchedAd.length - 8} more</li>}
            </ul> : <p className="attr-empty">Every spending campaign matched a utm_campaign.</p>}
          </div>
          <div>
            <div className="attr-h">CRM revenue with no spend match{lostRev > 0 ? ` · ${money(lostRev)}` : ''}</div>
            {unmatchedUtm.length ? <ul className="attr-list">
              {unmatchedUtm.slice(0, 8).map((x) => (
                <li key={x.name}><span className="attr-nm" title={x.name}>{x.name}</span><span className="attr-x">{fmtNumber(x.leads)} leads · {fmtNumber(x.won)} won · {money(x.revenue)}</span></li>
              ))}
              {unmatchedUtm.length > 8 && <li className="attr-more">+{unmatchedUtm.length - 8} more</li>}
            </ul> : <p className="attr-empty">Every tagged campaign matched a spend row.</p>}
          </div>
        </div>
        <p className="caveat">A utm_campaign that carries the ad campaign ID (or a shortened slug) instead of the exact campaign name will land here even though it is really the same campaign - the "looks like" hint flags the likely pair. Set the campaign to pipeline links above to force a match for reporting.</p>
      </div>
    </details>
  )
}

// Per-client tracking diagnostics for Settings. Lazily fetches the blend +
// attribution feeds on expand (one client at a time), then renders tracking
// health and attribution diagnostics.
function ClientTrackingDiagnostics({ clientId, currency, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null, attr: null })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null, attr: null })
    const r = presetRange('last_30d')
    Promise.all([
      fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/.netlify/functions/windsor?client=${clientId}&channel=attribution&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]).then(([b, a]) => setSt({ status: 'ok', blend: (b && b.blend) || null, attr: (a && a.attribution) || null }))
      .catch(() => setSt({ status: 'err', blend: null, attr: null }))
  }, [open, st.status, clientId])
  const periodLabel = rangeLabel(presetRange('last_30d'))
  return (
    <div className="cd-wrap">
      {!embedded && <button className="cd-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Tracking health &amp; attribution diagnostics <span className="cd-sub">last 30 days</span></button>}
      {open && (st.status === 'loading' ? <Spinner label="Loading tracking diagnostics…" />
        : st.status === 'err' ? <p className="cap" style={{ color: 'var(--neg)' }}>Could not load diagnostics for this client.</p>
          : st.status === 'ok' && st.blend ? <>
            <TrackingHealth paid={st.blend.paid} crmLeads={st.blend.crm ? st.blend.crm.leads : 0} attribData={st.attr} channels={st.attr && st.attr.channels} periodLabel={periodLabel} />
            <AttributionDiagnostics attribData={st.attr} camps={st.blend.campaigns || []} currency={currency} />
          </> : null)}
    </div>
  )
}

function KeyEventsEditor({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [sel, setSel] = useState(() => loadKeyEvents(clientId))
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [cals, setCals] = useState({ status: 'idle', list: [] })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  useEffect(() => {
    if (!open || cals.status !== 'idle') return
    setCals({ status: 'loading', list: [] })
    fetch(`/.netlify/functions/windsor?scope=calendars&client=${clientId}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setCals({ status: 'ok', list: j.calendars || [] }))
      .catch(() => setCals({ status: 'err', list: [] }))
  }, [open, cals.status, clientId])
  const pipes = (st.blend && st.blend.pipelines) || []
  const withStages = pipes.filter((p) => (p.stages || []).length)
  const multi = withStages.length > 1
  // A stage entry is a bare name (or {stage} with no cal); a calendar entry is
  // {cal, label, stage?} where `stage` is the pipeline stage it's linked to - so
  // matching stage checkboxes must exclude calendar entries.
  const hasStage = (n) => sel.some((e) => (typeof e === 'string' ? e === n : e && e.cal == null && e.stage === n))
  const hasCal = (id) => sel.some((e) => e && typeof e === 'object' && e.cal === id)
  const calStageOf = (id) => { const e = sel.find((x) => x && x.cal === id); return (e && e.stage) || '' }
  const calPipeOf = (id) => { const e = sel.find((x) => x && x.cal === id); return (e && e.pipeline) || '' }
  const persist = (nx) => { saveKeyEvents(clientId, nx); return nx }
  const toggleStage = (n) => setSel((prev) => persist(hasStage(n) ? prev.filter((e) => !(e === n || (e && e.cal == null && e.stage === n))) : [...prev, n]))
  const toggleCal = (cal) => setSel((prev) => persist(hasCal(cal.id) ? prev.filter((e) => !(e && e.cal === cal.id)) : [...prev, { cal: cal.id, label: cal.name }]))
  // Link a calendar to a pipeline (resets the stage) then to a stage within it.
  // Single-pipeline clients auto-fill the pipeline so the link is still scoped.
  const linkCalPipe = (id, pipeline) => setSel((prev) => persist(prev.map((e) => (e && e.cal === id ? { ...e, pipeline: pipeline || undefined, stage: undefined } : e))))
  const linkCalStage = (id, stage) => setSel((prev) => persist(prev.map((e) => (e && e.cal === id ? { ...e, stage: stage || undefined, pipeline: (multi ? e.pipeline : (withStages[0] && withStages[0].id)) || e.pipeline || undefined } : e))))
  const stagesOfPipe = (pid) => { const p = withStages.find((x) => x.id === pid); return p ? (p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => s.name) : [] }
  const allStages = (() => { const m = new Map(); for (const p of withStages) for (const s of (p.stages || [])) if (!m.has(s.name)) m.set(s.name, s.pos == null ? 999 : s.pos); return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n) })()
  return (
    <div className="linker">
      {!embedded && <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Key events{sel.length ? ` · ${sel.length}` : ''}</button>}
      {open && <div className={embedded ? '' : 'linker-body'}>
        <p className="cap" style={{ marginTop: 0 }}>Pick the pipeline stages <b>and booked calendars</b> that count as key events for this client - they drive the Key Events funnel &amp; cost-per-event in Caalano360 and the Meta / Google screens. Calendars give you cost per booked appointment (e.g. an initial consult vs a site visit) plus its show rate. <b>Link each calendar to the pipeline stage it represents</b> - the calendar and stage then count as one event (the stage is a fallback for leads that reached it without a tracked booking), and it sits in the right funnel order. You don't need to also add that stage on its own. If several calendars mean the same step, link them to the same stage and they combine. Leave empty for the default leads → booked → shown → won.</p>
        <div className="kev-group">
          <div className="kev-pipe">📅 Booked calendars <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· tick the ones that matter, then link each to its pipeline stage</span></div>
          {cals.status === 'loading' ? <Spinner label="Loading calendars…" />
            : cals.list.length ? <div className="kev-callist">{cals.list.map((cal) => {
              const on = hasCal(cal.id)
              return (
                <div className={`kev-cal ${on ? 'on' : ''}`} key={cal.id}>
                  <label className={`kev-item ${on ? 'on' : ''}`}><input type="checkbox" checked={on} onChange={() => toggleCal(cal)} /><span title={cal.name}>{cal.name}</span></label>
                  {on && (allStages.length
                    ? <span className="kev-link">
                        {multi && <select className="kev-stage" value={calPipeOf(cal.id)} onChange={(e) => linkCalPipe(cal.id, e.target.value)} title="Which pipeline this calendar's stage belongs to">
                          <option value="">↕ pipeline…</option>
                          {withStages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>}
                        <select className="kev-stage" value={calStageOf(cal.id)} disabled={multi && !calPipeOf(cal.id)} onChange={(e) => linkCalStage(cal.id, e.target.value)} title="Link this calendar to the pipeline stage it represents, so it sits in the right funnel order">
                          <option value="">↕ link to stage…</option>
                          {(multi ? stagesOfPipe(calPipeOf(cal.id)) : (withStages[0] ? stagesOfPipe(withStages[0].id) : allStages)).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </span>
                    : <span className="cap" style={{ opacity: .7 }}>loading stages…</span>)}
                </div>
              )
            })}</div>
              : cals.status === 'ok' ? <p className="cap">No calendars found for this client.</p>
                : <p className="cap">Couldn’t load calendars.</p>}
        </div>
        <div className="kev-pipe" style={{ marginTop: 10 }}>Pipeline stages{multi ? ' · grouped by pipeline' : ''}</div>
        {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
          : withStages.length ? withStages.map((p) => (
            <div className="kev-group" key={p.id}>
              {multi && <div className="kev-pipe">{p.name}</div>}
              <div className="kev-list">{(p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => (
                <label className={`kev-item ${hasStage(s.name) ? 'on' : ''}`} key={s.name}><input type="checkbox" checked={hasStage(s.name)} onChange={() => toggleStage(s.name)} /><span title={s.name}>{s.name}</span></label>
              ))}</div>
            </div>
          ))
          : st.status === 'ok' ? <p className="cap">No Caalano Systems pipeline stages found.</p>
            : <p className="cap">Couldn’t load pipeline stages.</p>}
      </div>}
    </div>
  )
}
function CampaignLinker({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [manual, setManual] = useState(() => loadCampMap(clientId))
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  const setLink = (name, target) => setManual((m) => { const nx = { ...m }; if (target === 'auto') delete nx[name]; else nx[name] = target; saveCampMap(clientId, nx); return nx })
  const b = st.blend
  const pipes = (b && b.pipelines) || []
  const camps = (b && b.campaigns) || []
  return (
    <div className="linker">
      {!embedded && <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Link campaigns to pipelines</button>}
      {open && <div className={embedded ? '' : 'linker-body'}>
        {st.status === 'loading' ? <Spinner label="Loading campaigns…" />
          : st.status === 'err' ? <p className="cap">Couldn't load - this client may have no ad accounts or Caalano Systems mapped.</p>
            : !camps.length ? <p className="cap">No campaigns found in the last 30 days.</p>
              : !pipes.length ? <p className="cap">No Caalano Systems pipelines to link to.</p>
                : <>
                  <p className="cap" style={{ marginTop: 0 }}>Assign each campaign to a pipeline, or “All pipelines” to share its spend. Auto = matched by name.</p>
                  {camps.map((cc) => (
                    <div className="camp-row" key={cc.source + cc.name}>
                      <span className="src-badge" style={{ background: cc.source === 'Meta' ? '#4f7cff' : '#12b886' }}>{cc.source === 'Meta' ? 'M' : 'G'}</span>
                      <span className="camp-nm" title={cc.name}>{cc.name}</span>
                      <select className="camp-lnk" value={manual[cc.name] ?? 'auto'} onChange={(e) => setLink(cc.name, e.target.value)}>
                        <option value="auto">Auto{cc.auto && cc.auto !== 'all' ? ` · ${pipes.find((p) => p.id === cc.auto)?.name?.slice(0, 20) || 'matched'}` : ' · all'}</option>
                        <option value="all">All pipelines</option>
                        {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  ))}
                </>}
      </div>}
    </div>
  )
}
// Agency-wide contact self-booking tag audit. Walks each Caalano Systems
// client one at a time (per-request) so we never hit the function timeout, and
// reports which accounts carry a "customer booked appointment"-style tag, how
// often it is applied, and the resulting contact self-booking rate.
function TagAudit({ clients }) {
  const [st, setSt] = useState({ status: 'idle', rows: [], msg: null })
  const run = async () => {
    setSt({ status: 'running', rows: [], msg: null })
    const rows = []
    for (const c of clients) {
      try {
        const r = await fetch(`/.netlify/functions/windsor?scope=tagaudit&client=${c.id}`)
        const j = await r.json().catch(() => ({}))
        if (j && j.connected === false) { setSt({ status: 'idle', rows: [], msg: 'Caalano Systems is not connected yet - connect it first, then re-run.' }); return }
        rows.push({ id: c.id, name: c.name, a: (j && j.audit) || { error: j.error || 'no data' } })
      } catch { rows.push({ id: c.id, name: c.name, a: { error: 'request failed' } }) }
      setSt({ status: 'running', rows: [...rows], msg: null })
    }
    setSt({ status: 'done', rows, msg: null })
  }
  const withTag = st.rows.filter((r) => r.a && r.a.hasTag).length
  const missing = st.rows.filter((r) => r.a && r.a.hasCrm && !r.a.hasTag).map((r) => r.name)
  return (
    <div className="tag-audit">
      <div className="ta-head">
        <div>
          <div className="ta-t">Contact self-booking tag audit</div>
          <div className="ta-s">Scans each account for a "customer booked appointment" style tag and how often it is applied, so you can see the contact self-booking rate and which accounts are missing the tag.</div>
        </div>
        <button className="print-btn" onClick={run} disabled={st.status === 'running'}>{st.status === 'running' ? `Scanning… ${st.rows.length}/${clients.length}` : st.status === 'done' ? '↻ Re-run' : '▶ Run tag audit'}</button>
      </div>
      {st.msg && <p className="cap" style={{ color: 'var(--warn)' }}>{st.msg}</p>}
      {st.rows.length > 0 && (
        <>
          {st.status === 'done' && <p className="cap" style={{ margin: '2px 0 8px' }}><b>{withTag}</b> of {st.rows.length} accounts carry a booking tag.{missing.length ? <> Missing: <b>{missing.join(', ')}</b>.</> : ' All accounts have it.'}</p>}
          <div className="table-wrap">
            <table className="tag-audit-tbl">
              <thead><tr><th>Account</th><th>Tag found</th><th>Tag name(s)</th><th>Applied</th><th>Self-book rate</th><th>Notes</th></tr></thead>
              <tbody>
                {st.rows.map((r) => {
                  const a = r.a || {}
                  if (a.error) return <tr key={r.id}><td className="ta-nm">{r.name}</td><td colSpan={5} className="ta-err">{a.error}</td></tr>
                  if (!a.hasCrm) return <tr key={r.id}><td className="ta-nm">{r.name}</td><td colSpan={5} className="ta-muted">no Caalano Systems account</td></tr>
                  const names = [...new Set([...(a.definedMatches || []), ...(a.appliedNames || [])])]
                  const tagsReadable = (a.contactTagsAvailable || 0) > 0
                  return (
                    <tr key={r.id}>
                      <td className="ta-nm">{r.name}</td>
                      <td><span className={`tk ${a.hasTag ? 'tk-full' : 'tk-none'}`}>{a.hasTag ? 'Yes' : 'No'}</span></td>
                      <td className="ta-tags">{names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '') : '-'}</td>
                      <td>{tagsReadable ? `${fmtNumber(a.contactsWithTag)} / ${fmtNumber(a.sampled)}` : <span className="ta-muted">not on opps</span>}</td>
                      <td>{a.selfBookRate != null ? <b>{a.selfBookRate}%</b> : <span className="ta-muted">-</span>}{a.selfBookRate != null && a.booked ? <span className="ta-sub"> ({a.self}/{a.booked} booked)</span> : ''}</td>
                      <td className="ta-note">{!tagsReadable && a.hasTag ? 'Defined but not returned on opportunities - rate needs a contacts pull.' : a.definedErr ? 'Tag list blocked (scope), applied-scan only.' : a.hasTag ? 'From last ' + fmtNumber(a.sampled) + ' opps.' : 'No booking tag on this account.'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="caveat">The tag is a lifetime flag on the contact, so the self-booking rate is "share of booked deals whose contact self-booked at least once," sampled from the most recent opportunities. For a per-appointment figure we would add the appointments API. Rate is split by channel in the data if you want it surfaced next.</p>
        </>
      )}
    </div>
  )
}

// Per-client timezone alignment badge. All CRM reporting is bucketed by the
// Caalano Systems location timezone; this shows it and confirms the Meta ad
// account is on the same zone (so Meta and CRM days match).
function TimezoneBadge({ clientId, hasMeta }) {
  const [tz, setTz] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`/.netlify/functions/windsor?scope=tz&client=${clientId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setTz(j) }).catch(() => {})
    return () => { alive = false }
  }, [clientId])
  if (!tz || !tz.crmTz) return null
  return (
    <div className="tz-badge">
      <span className="tz-main">Reporting timezone <b>{tz.crmTz}</b></span>
      {hasMeta && tz.metaTz && (
        tz.aligned
          ? <span className="tz-ok">Meta ad account matches ✓</span>
          : <span className="tz-warn">Meta ad account is {tz.metaTz} - reporting uses the CRM zone</span>
      )}
      {hasMeta && !tz.metaTz && <span className="tz-sub">Meta zone not detected</span>}
    </div>
  )
}

// Explore the accounts available to connect (Caalano Systems locations via the
// GHL API + Meta / Google ad accounts Windsor can see) and assemble a new
// client by linking one of each. Saved to the shared settings store and merged
// into the registry, so the new client goes live without a code change.
function AddClientModal({ existing, editClient, onClose }) {
  const isEdit = !!editClient
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [name, setName] = useState(editClient ? editClient.name : '')
  const [ghl, setGhl] = useState(editClient ? (editClient.ghl || '') : '')
  const [meta, setMeta] = useState(editClient ? (editClient.meta || '') : '')
  const [google, setGoogle] = useState(editClient ? (editClient.google || '') : '')
  const [nameEdited, setNameEdited] = useState(isEdit)
  const [saved, setSaved] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let alive = true
    fetchDiscover().then((j) => { if (alive) setSt({ status: 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [])
  const refreshAccounts = () => {
    setRefreshing(true)
    fetchDiscover(true).then((j) => setSt({ status: 'ok', data: j })).catch(() => setSt({ status: 'err', data: null })).finally(() => setRefreshing(false))
  }
  const d = st.data || {}
  const nameOf = (arr, id) => { const it = (arr || []).find((x) => normId(x.id) === normId(id)); return it ? it.name : null }
  const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client'
  const uniqueId = (base) => { let id = base, n = 2; const taken = new Set((existing || []).filter((c) => !isEdit || c.id !== editClient.id).map((c) => c.id)); while (taken.has(id)) id = `${base}-${n++}`; return id }
  const canSave = name.trim() && (meta || google || ghl)
  const save = () => {
    if (!canSave) return
    const mapping = {
      name: name.trim(),
      meta: meta || null, google: google || null, ghl: ghl || null,
      metaName: nameOf(d.meta, meta), googleName: nameOf(d.google, google), ghlName: nameOf(d.ghl, ghl),
    }
    saveCustomClient(isEdit ? editClient.id : uniqueId(slug(name)), mapping)
    setSaved(true); setTimeout(onClose, 900)
  }
  const remove = () => { if (isEdit && confirm(`Remove ${editClient.name} from the dashboard? This only removes the mapping; no CRM/ad data is touched.`)) { removeCustomClient(editClient.id); onClose() } }
  // Picking any account fills the client name from that account (unless the user
  // typed their own) — so a Meta-only or Google-only client still gets a name.
  const fillName = (nm) => { if (nm && !nameEdited) setName(nm) }
  const pickGhl = (id) => { setGhl(id); fillName(nameOf(d.ghl, id)) }
  const pickMeta = (id) => { setMeta(id); fillName(nameOf(d.meta, id)) }
  const pickGoogle = (id) => { setGoogle(id); fillName(nameOf(d.google, id)) }
  const Col = ({ title, items, sel, onSel, empty }) => (
    <div className="addcl-col">
      <div className="addcl-col-h">{title} <span className="addcl-count">{items ? items.length : 0}</span></div>
      <div className="addcl-list">
        {!items || !items.length ? <div className="cap" style={{ padding: 8 }}>{empty}</div> : items.map((it) => (
          <button key={it.id} className={`addcl-item ${normId(sel) === normId(it.id) ? 'on' : ''}`} onClick={() => onSel(normId(sel) === normId(it.id) ? '' : it.id)} title={it.id}>
            <span className="addcl-nm">{it.name}</span>
            <span className="addcl-meta">{it.mapped ? <span className="addcl-mapped">in use</span> : <span className="addcl-free">available</span>} · <code>{String(it.id).slice(0, 14)}</code></span>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal addcl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><div><h3>{isEdit ? `Edit ${editClient.name}` : 'Add a client'}</h3><span className="cap">Link any mix of Caalano Systems, Meta &amp; Google — you only need one</span></div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn-ghost sm" onClick={refreshAccounts} disabled={refreshing} title="Re-check the Meta / Google / Caalano Systems connections for newly added accounts">{refreshing ? 'Refreshing…' : '⟳ Refresh accounts'}</button><button className="icon-btn" onClick={onClose}>✕</button></div></div>
        <div className="m-body">
          {st.status === 'loading' ? <Spinner label="Exploring available accounts…" />
            : st.status === 'err' ? <div className="cap">Couldn’t load available accounts — <button className="btn-ghost sm" onClick={refreshAccounts}>try again</button>.</div>
              : <>
                <div className="addcl-name">
                  <label>Client name <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· auto-fills from the first account you pick — edit freely</span></label>
                  <input value={name} onChange={(e) => { setName(e.target.value); setNameEdited(true) }} placeholder="Type a name, or pick an account below" />
                </div>
                <div className="addcl-cols">
                  <Col title="🟢 Caalano Systems" items={d.ghl} sel={ghl} onSel={pickGhl} empty={d.ghlErr || (d.connected === false ? 'Caalano Systems not connected.' : 'No locations found.')} />
                  <Col title="🔵 Meta Ads" items={d.meta} sel={meta} onSel={pickMeta} empty="No Meta accounts found — try Refresh accounts." />
                  <Col title="🟩 Google Ads" items={d.google} sel={google} onSel={pickGoogle} empty="No Google accounts found — try Refresh accounts." />
                </div>
                <div className="addcl-foot">
                  {isEdit ? <button className="addcl-remove" onClick={remove}>Remove client</button> : <span className="cap">{!name.trim() ? 'Add a name to continue.' : (ghl || meta || google) ? `Linking${ghl ? ' CRM' : ''}${meta ? ' · Meta' : ''}${google ? ' · Google' : ''}` : 'Pick at least one account (any one is fine).'}</span>}
                  <button className="addcl-save" disabled={!canSave || saved} onClick={save}>{saved ? '✓ Saved' : (isEdit ? 'Save changes' : 'Add client')}</button>
                </div>
                <p className="caveat" style={{ marginTop: 10 }}>You only need <b>one</b> account linked — a Meta-only (or Google-only, or CRM-only) client is fine. Saved to the shared settings store and merged in immediately. Meta / Google accounts come from Windsor (accounts with activity in the last 90 days); Caalano Systems locations from the GoHighLevel agency connection. New account not showing? Hit <b>Refresh accounts</b>.</p>
              </>}
        </div>
      </div>
    </div>
  )
}
// An account chip that shows the account NAME (resolved from discovery) with the
// raw id underneath, so mis-links are obvious at a glance.
function AccountTag({ label, id, name }) {
  if (!id) return <span className="idtag">{label} <b>-</b></span>
  return <span className="idtag has" title={String(id)}>{label} <b>{name || id}</b>{name ? <code className="idtag-id">{id}</code> : null}</span>
}
// Per-client setup health for the compact status strip on each Settings card.
// ok (green ✓) / warn (amber !) / bad (red ✗).
function clientHealth(c) {
  const keRaw = SETTINGS.keyevents[c.id]
  const keConfigured = !!(keRaw && keRaw.length)
  const ke = loadKeyEvents(c.id)
  const hasCal = ke.some((e) => e && typeof e === 'object' && e.cal)
  const kpiRaw = SETTINGS.kpis[c.id] || {}
  const kpiSet = Object.keys(kpiRaw).some((k) => k !== 'byPipeline' && kpiRaw[k] != null && kpiRaw[k] !== '') || (kpiRaw.byPipeline && Object.keys(kpiRaw.byPipeline).length > 0)
  return [
    { img: FAVICON('meta.com'), short: 'Meta', label: 'Meta Ads account', state: c.meta ? 'ok' : 'bad' },
    { img: FAVICON('ads.google.com'), short: 'Google', label: 'Google Ads account', state: c.google ? 'ok' : 'bad' },
    { img: CRM_LOGO, short: 'CRM', label: 'Caalano Systems (CRM)', state: c.ghl ? 'ok' : 'bad' },
    { ic: '🎯', short: 'Events', label: 'Key events configured', state: keConfigured ? 'ok' : (SEED_KEYEVENTS[c.id] ? 'warn' : (c.ghl ? 'warn' : 'bad')) },
    { ic: '📅', short: 'Cals', label: 'Booked calendars linked', state: hasCal ? 'ok' : (c.ghl ? 'warn' : 'bad') },
    { ic: '📝', short: 'Forms', label: `Forms reviewed (${formsDoneCount(c.id)} linked)`, state: c.ghl ? (formsDoneCount(c.id) > 0 ? 'ok' : 'warn') : 'bad' },
    { ic: '📊', short: 'KPIs', label: 'KPI targets set', state: kpiSet ? 'ok' : 'warn' },
    { ic: '📡', short: 'Diag', label: 'Tracking diagnostics ready', state: (c.ghl && (c.meta || c.google)) ? 'ok' : (c.ghl ? 'warn' : 'bad') },
  ]
}
// Real brand logos via each site's favicon (Google's favicon service is a
// reliable source that works for any domain).
const FAVICON = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
const CRM_LOGO = 'https://assets.cdn.filesafe.space/4iJNxErzfROlH5M5akcm/media/694b2a2bd573507fc6f55bd6.png'
const STATE_TXT = { ok: 'connected / done', warn: 'needs attention', bad: 'not connected' }
function HealthIcon({ h }) {
  if (!h.img) return <span className="sth-ic">{h.ic}</span>
  return <span className="sth-ic"><img src={h.img} alt="" width="16" height="16" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /></span>
}
function HealthStrip({ c }) {
  return (
    <div className="set-health">
      {clientHealth(c).map((h) => (
        <span key={h.label} className="sth" title={`${h.label} — ${STATE_TXT[h.state]}`}>
          <HealthIcon h={h} />
          <span className="sth-lb">{h.short}</span>
          <span className={`sth-mk ${h.state}`}>{h.state === 'ok' ? '✓' : h.state === 'bad' ? '✗' : '●'}</span>
        </span>
      ))}
    </div>
  )
}
const SET_FILTERS = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']]
// Global creative-fatigue thresholds — one shared set, applied to every active
// Meta client's fatigue read (Cockpit badges + the Meta Creative Fatigue tab).
function FatigueSettings() {
  useSettingsSync()
  const [cfg, setCfg] = useState(() => loadFatigueCfg())
  useEffect(() => { setCfg(loadFatigueCfg()) }, [SETTINGS.loaded])
  const upd = (k, v) => { const n = { ...cfg, [k]: v }; setCfg(n) }
  const commit = () => saveFatigueCfg(cfg)
  const reset = () => { setCfg({ ...FATIGUE_DEFAULTS }); saveFatigueCfg({ ...FATIGUE_DEFAULTS }) }
  const Row = ({ label, k, suffix, step, hint }) => (
    <label className="fat-set-row">
      <span className="fat-set-lab">{label}{hint ? <span className="cap"> · {hint}</span> : null}</span>
      <span className="fat-set-in"><input type="number" step={step || 1} value={cfg[k]} onChange={(e) => upd(k, e.target.value === '' ? '' : Number(e.target.value))} onBlur={commit} />{suffix ? <em>{suffix}</em> : null}</span>
    </label>
  )
  return (
    <div className="card fat-set">
      <h3 style={{ marginTop: 0 }}>Creative fatigue thresholds</h3>
      <p className="cap" style={{ marginTop: -4 }}>One shared set of rules, applied live to every active Meta client. A creative scores points for high frequency, a falling click-through rate, and a below-average quality ranking: <b>2+ points = High 🔥</b>, <b>1 point = Medium 👀</b>. Changes save to the server and apply on the next load.</p>
      <div className="fat-set-grid">
        <div className="fat-set-col">
          <div className="fat-set-t">Frequency (impressions ÷ reach)</div>
          <Row label="Watch when frequency reaches" k="freqMed" suffix="×" step={0.5} />
          <Row label="Fatigued when frequency reaches" k="freqHigh" suffix="×" step={0.5} />
        </div>
        <div className="fat-set-col">
          <div className="fat-set-t">CTR decline (first vs second half of the window)</div>
          <Row label="Watch when CTR falls by" k="ctrDropMed" suffix="%" step={5} />
          <Row label="Fatigued when CTR falls by" k="ctrDropHigh" suffix="%" step={5} />
        </div>
        <div className="fat-set-col">
          <div className="fat-set-t">Noise filter</div>
          <Row label="Ignore creatives under" k="minImpr" suffix="impressions" step={100} hint="too little data to judge" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}><button className="link-btn sm" onClick={reset}>Reset to defaults</button> <span className="set-saved" style={{ marginLeft: 8 }}>✓ Saved to server · shared across your team</span></div>
    </div>
  )
}

function SettingsPage({ config, enabled, setEnabled, currency, authUser, authEnabled, onPick }) {
  const [filter, setFilter] = useState('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // client being configured (modal)
  const [adding, setAdding] = useState(false)   // add/edit-client explorer modal (true = new, client = edit)
  const role = authEnabled && authUser ? authUser.role : 'admin' // legacy/basic = full admin
  const isAdmin = isAdminishFE(role)
  const isSuper = !authEnabled || role === 'superadmin' // legacy/basic = super
  const [section, setSection] = useState(isAdmin ? 'clients' : 'account')
  const names = useDiscoverNames()
  const nm = (kind, id) => (names && id ? names[kind][normId(id)] : null)
  if (!config) return <div className="card"><Spinner label="Loading settings…" /></div>
  const w = config.availableAccounts?.windsor || {}
  const isOn = (c) => enabled[c.id] !== false
  const activeCount = config.clients.filter(isOn).length
  const term = q.trim().toLowerCase()
  const list = config.clients.filter((c) => {
    if (filter === 'active' && !isOn(c)) return false
    if (filter === 'inactive' && isOn(c)) return false
    if (term && !(`${c.name} ${c.industry || ''}`.toLowerCase().includes(term))) return false
    return true
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  return (
    <div className="settings-page">
      <div className="set-sections">
        {isAdmin && <button className={section === 'clients' ? 'on' : ''} onClick={() => setSection('clients')}>Clients</button>}
        {isAdmin && <button className={section === 'fatigue' ? 'on' : ''} onClick={() => setSection('fatigue')}>Creative fatigue</button>}
        {(!authEnabled || isAdmin) && <button className={section === 'team' ? 'on' : ''} onClick={() => setSection('team')}>Team &amp; access</button>}
        {authEnabled && <button className={section === 'account' ? 'on' : ''} onClick={() => setSection('account')}>Your account</button>}
      </div>
      {isAdmin && section === 'fatigue' && <FatigueSettings />}
      {section === 'team' && (!authEnabled || isAdmin) && <UsersAdmin authUser={authUser} authEnabled={authEnabled} clients={(config.clients || []).map((c) => ({ id: c.id, name: c.name }))} />}
      {authEnabled && section === 'account' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your account</h3>
          <p className="cap" style={{ marginTop: -4 }}>Signed in as <b>{authUser ? (authUser.name || authUser.email) : ''}</b>{authUser ? ` · ${ROLE_LABEL[authUser.role] || authUser.role}` : ''}. Change your password below.</p>
          <ChangePasswordCard />
        </div>
      )}
      {isAdmin && section === 'clients' && (<>
      <div className="set-stats">
        <div className="set-stat"><div className="v">{config.clients.length}</div><div className="l">Clients</div></div>
        <div className="set-stat"><div className="v">{activeCount}</div><div className="l">Active</div></div>
        <div className="set-stat"><div className="v">{config.clients.length - activeCount}</div><div className="l">Inactive</div></div>
        <div className="set-stat"><div className="v">{w.facebook ?? '-'}</div><div className="l">Meta accounts</div></div>
        <div className="set-stat"><div className="v">{w.google_ads ?? '-'}</div><div className="l">Google accounts</div></div>
        <div className="set-stat"><div className="v">{w.gohighlevel ?? '-'}</div><div className="l">Caalano Systems</div></div>
      </div>
      <div className="set-toolbar">
        <div className="chan-toggle">{SET_FILTERS.map(([k, lbl]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{lbl}{k === 'active' ? ` · ${activeCount}` : k === 'inactive' ? ` · ${config.clients.length - activeCount}` : ''}</button>)}</div>
        <input className="set-search" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isSuper && <button className="set-add" onClick={() => setAdding(true)}>+ Add client</button>}
        <span className="set-saved">✓ Saved to server · shared across your team</span>
      </div>
      <div className="set-legend">
        <span>Setup:</span>
        <span className="lg"><img src={FAVICON('meta.com')} alt="" width="14" height="14" /> Meta</span><span className="lg"><img src={FAVICON('ads.google.com')} alt="" width="14" height="14" /> Google</span><span className="lg"><img src={CRM_LOGO} alt="" width="14" height="14" /> CRM</span><span className="lg"><b>🎯</b> Key events</span><span className="lg"><b>📅</b> Calendars</span><span className="lg"><b>📝</b> Forms</span><span className="lg"><b>📊</b> KPIs</span><span className="lg"><b>📡</b> Diagnostics</span>
        <span className="lg-sep">·</span><span className="lg"><span className="sth-mk ok">✓</span> done</span><span className="lg"><span className="sth-mk warn">●</span> attention</span><span className="lg"><span className="sth-mk bad">✗</span> missing</span>
      </div>
      <div className="set-grid">
        {list.map((c) => {
          const on = isOn(c)
          return (
            <div className={`set-card ${on ? '' : 'is-off'}`} key={c.id}>
              <div className="set-card-head">
                <span className="avatar" style={{ background: acolor(config.clients.indexOf(c)) }}>{initials(c.name)}</span>
                <div className="sc-id"><div className="nm">{c.name}</div><div className="ver">{c.industry || (c.deep ? 'Deep dashboards' : 'Summary only')}</div></div>
                <div className={`toggle ${on ? 'on' : ''}`} title={on ? 'Active - click to hide from the dashboard' : 'Inactive - click to show'} onClick={() => setEnabled((s) => ({ ...s, [c.id]: s[c.id] === false ? true : false }))}><span className="knob" /></div>
              </div>
              <HealthStrip c={c} />
              <div className="set-card-actions">
                <button className="set-expand" onClick={() => setEditing(c)}>✎ Edit</button>
              </div>
            </div>
          )
        })}
        {!list.length && <div className="card empty-deep"><div className="big">🔍</div><b>No clients match.</b></div>}
      </div>
      </>)}
      {editing && <SettingsEditModal client={editing} names={names} currency={currency} canManageAccounts={isSuper} onClose={() => setEditing(null)} onOpen={() => { const cc = editing; setEditing(null); onPick(cc) }} onRelink={() => { const cc = editing; setEditing(null); setAdding(cc) }} />}
      {adding && <AddClientModal existing={config.clients} editClient={typeof adding === 'object' ? adding : null} onClose={() => setAdding(false)} />}
    </div>
  )
}
// Per-client configuration in a modal with horizontal tabs (like the client
// view). Summary edits name / industry / linked accounts; the other tabs open
// each editor full-width underneath. "Open Client View" jumps to the workspace.
// Sales-cycle / data-maturity control. Shows the CRM's calculated average time
// to close a deal and lets you override it. Everything downstream (the "Still
// maturing" badges) adds a 20% buffer on top of whichever value applies.
function SalesCycleField({ clientId }) {
  const [crm, setCrm] = useState(undefined) // undefined = loading, null = none
  const [ov, setOv] = useState(() => { const v = loadCloseOverride(clientId); return v == null ? '' : String(v) })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true; setCrm(undefined)
    const r = presetRange('last_90d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setCrm(j && j.blend && j.blend.wonClosed && j.blend.wonClosed.avgCloseDays != null ? j.blend.wonClosed.avgCloseDays : null) })
      .catch(() => { if (alive) setCrm(null) })
    return () => { alive = false }
  }, [clientId])
  const eff = ov !== '' && Number(ov) > 0 ? Number(ov) : (crm || null)
  const buffered = eff ? Math.round(eff * 1.2) : null
  const save = (val) => { setOv(val); saveCloseOverride(clientId, val === '' ? null : Number(val)); setSaved(true); setTimeout(() => setSaved(false), 1200) }
  return (
    <div className="set-cycle">
      <div className="set-sec-t">Data maturity — average time to close</div>
      <p className="cap" style={{ marginTop: 0 }}>Calculated automatically by the CRM from your won deals (average days from lead created to won). A <b>20% buffer</b> is added, and any date range shorter than that shows a <b>“Still maturing”</b> flag — a reminder that recent leads haven’t had time to convert yet, so Won / Revenue / ROAS understate the true result. This is never shown on the dashboards as a metric.</p>
      <div className="set-cycle-grid">
        <div className="set-cycle-stat"><span className="cap">CRM average</span><b>{crm === undefined ? '…' : crm == null ? 'No won deals yet' : `${crm} days`}</b></div>
        <div className="set-cycle-stat"><span className="cap">With 20% buffer</span><b>{buffered ? `${buffered} days` : '—'}</b></div>
        <div className="set-field set-cycle-in"><label>Manual override (days)</label><input type="number" min="0" value={ov} onChange={(e) => save(e.target.value)} placeholder={crm != null ? `${crm} (CRM)` : 'e.g. 40'} />{saved && <span className="set-saved-tick">✓</span>}</div>
      </div>
      <p className="cap set-cycle-warn">⚠ Leave blank to use the CRM figure. Only override if you know the true sales cycle (e.g. the CRM history is too short) — the 20% buffer is still applied on top of whatever you enter.</p>
    </div>
  )
}
// Working-hours editor. Auto-detects from the client's calendars, and lets you
// override the days + open/close time. Drives the Speed to Lead measurement so
// after-hours gaps aren't counted as slow responses.
function ActiveHoursField({ clientId }) {
  const saved = loadHours(clientId)
  const [enabled, setEnabled] = useState(() => !!saved)
  const [days, setDays] = useState(() => (saved ? saved.days : [1, 2, 3, 4, 5]))
  const [start, setStart] = useState(() => (saved ? hhmm(saved.startMin) : '09:00'))
  const [end, setEnd] = useState(() => (saved ? hhmm(saved.endMin) : '17:00'))
  const [detected, setDetected] = useState(undefined)
  const [tick, setTick] = useState(false)
  useEffect(() => {
    let a = true; setDetected(undefined)
    fetch(`/.netlify/functions/windsor?scope=hours&client=${clientId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (a) setDetected(j && j.days ? j : null) }).catch(() => { if (a) setDetected(null) })
    return () => { a = false }
  }, [clientId])
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const flash = () => { setTick(true); setTimeout(() => setTick(false), 1200) }
  const persist = (en, d, s, e) => { saveHours(clientId, en ? { days: d, startMin: toMin(s), endMin: toMin(e) } : null); flash() }
  const toggleDay = (i) => { const nd = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort((a, b) => a - b); setDays(nd); if (enabled) persist(true, nd, start, end) }
  const onStart = (v) => { setStart(v); if (enabled) persist(true, days, v, end) }
  const onEnd = (v) => { setEnd(v); if (enabled) persist(true, days, start, v) }
  const onEnable = (v) => { setEnabled(v); persist(v, days, start, end) }
  const useDetected = () => { if (!detected) return; const s = hhmm(detected.startMin), e = hhmm(detected.endMin); setDays(detected.days); setStart(s); setEnd(e); setEnabled(true); persist(true, detected.days, s, e) }
  return (
    <div className="set-cycle">
      <div className="set-sec-t">Working hours <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· for Speed to Lead</span>{tick && <span className="set-saved-tick" style={{ position: 'static', marginLeft: 8 }}>✓ saved</span>}</div>
      <p className="cap" style={{ marginTop: 0 }}>When on, Speed to Lead counts only <b>business minutes</b> — a lead that arrives at 11pm and gets a reply at 9am is a fast response, not a 10-hour one.</p>
      <label className="set-hours-en"><input type="checkbox" checked={enabled} onChange={(e) => onEnable(e.target.checked)} /> Measure Speed to Lead within working hours</label>
      <div className={`set-hours ${enabled ? '' : 'off'}`}>
        <div className="set-hours-days">{DOW_LABELS.map((lbl, i) => <button key={i} className={days.includes(i) ? 'on' : ''} onClick={() => toggleDay(i)} disabled={!enabled}>{lbl}</button>)}</div>
        <div className="set-hours-times">
          <label>Open <input type="time" value={start} onChange={(e) => onStart(e.target.value)} disabled={!enabled} /></label>
          <label>Close <input type="time" value={end} onChange={(e) => onEnd(e.target.value)} disabled={!enabled} /></label>
        </div>
      </div>
      <div className="set-hours-detect">
        {detected === undefined ? <span className="cap">Detecting hours from calendars…</span>
          : detected && detected.detected ? <>Detected from {detected.calendars} calendar{detected.calendars === 1 ? '' : 's'}: <b>{fmtHours({ days: detected.days, startMin: detected.startMin, endMin: detected.endMin })}</b> <button className="set-relink" style={{ padding: '4px 10px', marginLeft: 6 }} onClick={useDetected}>Use detected</button></>
          : <span className="cap">Couldn't auto-detect hours from calendars — set them manually above.</span>}
      </div>
    </div>
  )
}
// Per-client Meta conversion picker: loads the conversion events that actually
// fired for the account and lets an admin choose a primary result + secondaries.
function MetaConversionsEditor({ clientId, currency }) {
  const [st, setSt] = useState({ status: 'loading', actions: [] })
  const [cfg, setCfg] = useState(() => loadMetaConv(clientId))
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', actions: [] })
    fetch(`/.netlify/functions/windsor?scope=metaactions&client=${clientId}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', actions: (j && j.actions) || [], error: j && j.error, spend: j && j.spend }) })
      .catch((e) => { if (alive) setSt({ status: 'err', actions: [], error: String((e && e.message) || e) }) })
    return () => { alive = false }
  }, [clientId])
  const setPrimary = (id) => setCfg((c) => ({ primary: id, secondary: (c.secondary || []).filter((s) => s !== id) }))
  const toggleSecondary = (id) => setCfg((c) => { const has = (c.secondary || []).includes(id); return { ...c, secondary: has ? c.secondary.filter((s) => s !== id) : [...(c.secondary || []), id] } })
  const save = () => { saveMetaConv(clientId, cfg); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  const money = (v) => fmtCurrency(v, currency)
  const known = st.actions || []
  // Keep a previously-saved choice visible even if it didn't fire in the window.
  const extra = [cfg.primary, ...(cfg.secondary || [])].filter(Boolean).filter((id) => !known.some((a) => a.id === id)).map((id) => ({ id, label: id, count: 0, costPer: null }))
  const list = [...known, ...extra]
  const labelOf = (id) => (list.find((a) => a.id === id) || {}).label || id
  return (
    <div className="mconv">
      <p className="cap" style={{ marginTop: 0 }}>Choose the Meta conversion this client optimises to as its <b>primary result</b> — it becomes the headline result &amp; cost-per on the Meta tab. Tick any <b>secondary</b> events to show alongside. Only events that fired in the last 90 days are listed (custom-pixel events are this client’s own funnel steps).</p>
      {st.status === 'loading' ? <Spinner label="Loading Meta conversions…" />
        : st.status === 'err' ? <div className="cap">Couldn’t load conversions{st.error ? ` — ${st.error}` : ''}.</div>
          : !list.length ? <div className="cap">No Meta conversions have fired for this account in the last 90 days. If the account is new, they’ll appear once data flows.</div>
            : <>
              <div className="table-wrap"><table className="mini-tbl mconv-tbl">
                <thead><tr><th className="lft">Conversion event</th><th>Count · 90d</th><th>Cost / action</th><th>Primary</th><th>Secondary</th></tr></thead>
                <tbody>{list.map((a) => (
                  <tr key={a.id} className={cfg.primary === a.id ? 'row-sel' : ''}>
                    <td className="lft">{a.label}</td>
                    <td>{fmtNumber(a.count)}</td>
                    <td>{a.costPer != null ? money(a.costPer) : '-'}</td>
                    <td><input type="radio" name={`prim-${clientId}`} checked={cfg.primary === a.id} onChange={() => setPrimary(a.id)} /></td>
                    <td><input type="checkbox" checked={(cfg.secondary || []).includes(a.id)} disabled={cfg.primary === a.id} onChange={() => toggleSecondary(a.id)} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="mconv-foot">
                <button className="btn-primary" onClick={save}>{saved ? '✓ Saved' : 'Save conversions'}</button>
                {cfg.primary && <button className="btn-ghost sm" onClick={() => setCfg({ primary: null, secondary: [] })}>Clear</button>}
                <span className="cap">{cfg.primary ? `Primary: ${labelOf(cfg.primary)}${(cfg.secondary || []).length ? ` · ${cfg.secondary.length} secondary` : ''}` : 'No primary set — the Meta tab shows Leads by default.'}</span>
              </div>
            </>}
    </div>
  )
}
function SettingsEditModal({ client: c, names, currency, canManageAccounts, onClose, onOpen, onRelink }) {
  const canLink = (c.meta || c.google) && c.ghl
  const nm = (kind, id) => (names && id ? names[kind][normId(id)] : null)
  const [name, setName] = useState(c.name || '')
  const [industry, setIndustry] = useState(c.industry || '')
  const [savedDetails, setSavedDetails] = useState(false)
  const dirty = name.trim() !== (c.name || '') || industry !== (c.industry || '')
  const saveDetails = () => {
    if (!name.trim()) return
    saveCustomClient(c.id, {
      name: name.trim(), industry: industry.trim() || null,
      meta: c.meta || null, google: c.google || null, ghl: c.ghl || null,
      metaName: nm('meta', c.meta) || c.metaName || null, googleName: nm('google', c.google) || c.googleName || null, ghlName: nm('ghl', c.ghl) || c.ghlName || null,
    })
    setSavedDetails(true); setTimeout(() => setSavedDetails(false), 1500)
  }
  // Cache-buster tied to the linked accounts, so relinking a client bypasses
  // the 10-min CDN cache on the blend/attribution/calendar responses.
  const sig = normId(c.ghl) + '-' + normId(c.meta) + '-' + normId(c.google)
  const tabs = [['summary', 'Summary']]
  if (c.ghl) tabs.push(['keyevents', 'Key events'])
  if (c.meta) tabs.push(['metaconv', 'Meta conversions'])
  if (canLink) tabs.push(['links', 'Campaign links'])
  if (c.meta || c.google || c.ghl) tabs.push(['kpis', 'KPI targets'])
  if (c.ghl) tabs.push(['forms', 'Forms'])
  if (c.ghl && (c.meta || c.google)) tabs.push(['diagnostics', 'Diagnostics'])
  const [tab, setTab] = useState('summary')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div className="set-modal-title"><span className="avatar sm" style={{ background: acolor(0) }}>{initials(name || c.name)}</span><div><h3>{name || c.name}</h3><span className="cap">{industry || (c.custom ? 'Added client' : 'Configuration')}</span></div></div>
          <div className="set-modal-actions">
            <button className="set-open" onClick={onOpen} title="Open this client's performance workspace">Open Client View ↗</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="set-tabs">{tabs.map(([k, lbl]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{lbl}</button>)}</div>
        <div className="m-body set-tabbody">
          {tab === 'summary' && <div className="set-summary">
            <div className="set-details">
              <div className="set-field"><label>Client name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="set-field"><label>Description / Industry</label><input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Pool builder (trades, high-ticket)" /></div>
              <button className="set-details-save" disabled={!dirty || !name.trim()} onClick={saveDetails}>{savedDetails ? '✓ Saved' : 'Save details'}</button>
            </div>
            <div className="set-sec-t">Linked accounts</div>
            <div className="set-linked">
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd meta">Meta</span></span><span className="set-linked-v">{c.meta ? <><b>{nm('meta', c.meta) || c.metaName || 'Linked'}</b> <code>{c.meta}</code></> : <span className="cap">Not linked</span>}</span></div>
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd google">Google</span></span><span className="set-linked-v">{c.google ? <><b>{nm('google', c.google) || c.googleName || 'Linked'}</b> <code>{c.google}</code></> : <span className="cap">Not linked</span>}</span></div>
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd" style={{ background: '#12b886' }}>CRM</span></span><span className="set-linked-v">{c.ghl ? <><b>{nm('ghl', c.ghl) || c.ghlName || 'Linked'}</b> <code>{c.ghl}</code></> : <span className="cap">Not linked</span>}</span></div>
            </div>
            {canManageAccounts ? <button className="set-relink" onClick={onRelink} title="Change which Caalano Systems / Meta / Google accounts this client links to">✎ Edit linked accounts</button> : <p className="cap" style={{ margin: '4px 0 0' }}>🔒 Only a Super Admin can change or remove the linked accounts.</p>}
            {c.ghl && <TimezoneBadge clientId={c.id} hasMeta={!!c.meta} />}
            {c.ghl && <SalesCycleField clientId={c.id} />}
            {c.ghl && <ActiveHoursField clientId={c.id} />}
          </div>}
          {tab === 'keyevents' && <div className="set-tabpane"><div className="set-sec-t">Key events</div><KeyEventsEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'metaconv' && <div className="set-tabpane"><div className="set-sec-t">Meta conversions — primary &amp; secondary results</div><MetaConversionsEditor clientId={c.id} currency={currency} /></div>}
          {tab === 'links' && <div className="set-tabpane"><div className="set-sec-t">Link campaigns to pipelines</div><CampaignLinker clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'kpis' && <div className="set-tabpane"><div className="set-sec-t">KPI targets</div><KpiEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'forms' && <div className="set-tabpane"><div className="set-sec-t">Forms — link to a pipeline &amp; add notes</div><p className="cap" style={{ marginTop: 0 }}>Set each form's pipeline and notes here. The client's Forms tab shows these (and its full performance).</p><FormsSettingsTab clientId={c.id} /></div>}
          {tab === 'diagnostics' && <div className="set-tabpane"><ClientTrackingDiagnostics clientId={c.id} currency={currency} embedded nonce={sig} /></div>}
        </div>
      </div>
    </div>
  )
}

// Catches render errors in a view so one bad client/component shows a message
// with a way back instead of blanking the whole app to a white screen.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (this.state.err) {
      return (
        <div className="card empty-deep" style={{ margin: 16 }}>
          <div className="big">⚠️</div>
          <b>Something went wrong loading this view.</b>
          <p style={{ maxWidth: 520, margin: '8px auto 0', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{String((this.state.err && this.state.err.message) || this.state.err)}</p>
          <button className="refresh-btn" style={{ marginTop: 12 }} onClick={() => { this.setState({ err: null }); this.props.onHome && this.props.onHome() }}>← Back to overview</button>
        </div>
      )
    }
    return this.props.children
  }
}

/* ============ Auth ============ */
function authApi(action, opts = {}) {
  return fetch(`/.netlify/functions/auth?action=${action}`, { headers: { 'content-type': 'application/json' }, ...opts })
    .then((r) => r.json().catch(() => ({ ok: false, error: 'server ' + r.status })))
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
}
function AuthShell({ children }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand"><div className="logo logo-360"><span>360</span></div><div><h1 className="brand-name">Caalano<span className="b360">360</span></h1><p>360° Reporting</p></div></div>
        {children}
      </div>
    </div>
  )
}
// Frontend mirror of the server permission helpers (UI gating only — the API
// enforces the same rules server-side). A null user = legacy/basic-auth = full.
const isAdminishFE = (r) => r === 'admin' || r === 'superadmin'
const RANK_FE = { superadmin: 3, admin: 2, user: 1, viewer: 0 }
const rankOfFE = (r) => (RANK_FE[r] != null ? RANK_FE[r] : 0)
// Can an actor with this role manage a target of that role? (mirrors the server)
const canManageRoleFE = (actorRole, targetRole) => actorRole === 'superadmin' ? true : (actorRole === 'admin' ? rankOfFE(targetRole) < RANK_FE.admin : false)
function canSeeClientFE(user, id) {
  if (!user) return true
  if (isAdminishFE(user.role)) return true
  if (user.role === 'user') return user.allClients !== false || (user.clients || []).includes(id)
  return (user.clients || []).includes(id)
}
function allowedTabsFE(user, offered) {
  if (!user || user.role !== 'viewer' || !Array.isArray(user.tabs)) return offered
  const keep = offered.filter((t) => user.tabs.includes(t.id))
  return keep.length ? keep : offered.slice(0, 1)
}
const ROLE_LABEL = { superadmin: 'Super Admin', admin: 'Admin', user: 'User', viewer: 'Viewer' }
function LoginForm({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [signup, setSignup] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await authApi('login', { method: 'POST', body: JSON.stringify({ email, password: pw }) })
    setBusy(false)
    if (r.ok) onSignedIn(r.user); else setErr(r.error || 'Sign-in failed.')
  }
  if (signup) return <SignupForm onBack={() => setSignup(false)} />
  return (
    <AuthShell>
      <form onSubmit={submit} className="auth-form">
        <h2>Sign in</h2>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" required /></label>
        <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy || !email || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="auth-link" onClick={() => setSignup(true)}>Are you a client? Request access →</button>
      </form>
    </AuthShell>
  )
}
function SignupForm({ onBack }) {
  const [f, setF] = useState({ name: '', email: '', pw: '', pw2: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (f.pw !== f.pw2) return setErr('Passwords don’t match.')
    if (f.pw.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    const r = await authApi('signup', { method: 'POST', body: JSON.stringify({ name: f.name, email: f.email, password: f.pw, note: f.note }) })
    setBusy(false)
    if (r.ok) setDone(true); else setErr(r.error || 'Could not send your request.')
  }
  if (done) return (
    <AuthShell><div className="auth-form">
      <h2>Request sent ✓</h2>
      <p className="auth-sub">Thanks — your access request is with the Caalano team. Once it’s approved you’ll be able to sign in with the email and password you just chose. We’ll be in touch.</p>
      <button className="auth-btn" onClick={onBack}>Back to sign in</button>
    </div></AuthShell>
  )
  return (
    <AuthShell>
      <form onSubmit={submit} className="auth-form">
        <h2>Request client access</h2>
        <p className="auth-sub">Create your login. A Caalano admin approves each request before it’s activated, so your account stays private until then.</p>
        <label>Your name<input value={f.name} onChange={set('name')} autoFocus required /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="username" required /></label>
        <label>Which business are you with? <span className="auth-opt">(optional)</span><input value={f.note} onChange={set('note')} placeholder="Helps us match you to your account" /></label>
        <label>Password<input type="password" value={f.pw} onChange={set('pw')} autoComplete="new-password" required /></label>
        <label>Confirm password<input type="password" value={f.pw2} onChange={set('pw2')} autoComplete="new-password" required /></label>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy}>{busy ? 'Sending…' : 'Request access'}</button>
        <button type="button" className="auth-link" onClick={onBack}>← Back to sign in</button>
      </form>
    </AuthShell>
  )
}
function SetupAdmin({ onSignedIn }) {
  const [f, setF] = useState({ name: '', email: '', pw: '', pw2: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (f.pw !== f.pw2) return setErr('Passwords don’t match.')
    if (f.pw.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    const r = await authApi('bootstrap', { method: 'POST', body: JSON.stringify({ name: f.name, email: f.email, password: f.pw }) })
    setBusy(false)
    if (r.ok) onSignedIn(r.user); else setErr(r.error || 'Setup failed.')
  }
  return (
    <AuthShell>
      <form onSubmit={submit} className="auth-form">
        <h2>Create your admin account</h2>
        <p className="auth-sub">This is the first account for Caalano360. You’ll invite the rest of your team once you’re in.</p>
        <label>Your name<input value={f.name} onChange={set('name')} autoFocus required /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="username" required /></label>
        <label>Password<input type="password" value={f.pw} onChange={set('pw')} autoComplete="new-password" required /></label>
        <label>Confirm password<input type="password" value={f.pw2} onChange={set('pw2')} autoComplete="new-password" required /></label>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy}>{busy ? 'Creating…' : 'Create admin account'}</button>
      </form>
    </AuthShell>
  )
}
function AcceptInvite({ token, onSignedIn }) {
  const [info, setInfo] = useState({ status: 'loading' })
  const [f, setF] = useState({ name: '', pw: '', pw2: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    authApi('invite-info&token=' + encodeURIComponent(token)).then((r) => {
      if (r && r.valid) { setInfo({ status: 'ok', ...r }); setF((s) => ({ ...s, name: r.name || '' })) }
      else setInfo({ status: 'bad', expired: r && r.expired })
    })
  }, [token])
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (f.pw !== f.pw2) return setErr('Passwords don’t match.')
    if (f.pw.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    const r = await authApi('accept', { method: 'POST', body: JSON.stringify({ token, password: f.pw, name: f.name }) })
    setBusy(false)
    if (r.ok) onSignedIn(r.user); else setErr(r.error || 'Could not accept the invite.')
  }
  if (info.status === 'loading') return <AuthShell><div className="auth-form"><Spinner label="Checking your invite…" /></div></AuthShell>
  if (info.status === 'bad') return (
    <AuthShell><div className="auth-form">
      <h2>Invite unavailable</h2>
      <p className="auth-sub">{info.expired ? 'This invite has expired. Ask an admin to send you a fresh one.' : 'This invite link is invalid or has already been used.'}</p>
      <a className="auth-btn" href="/" style={{ textAlign: 'center', textDecoration: 'none' }}>Go to sign in</a>
    </div></AuthShell>
  )
  return (
    <AuthShell>
      <form onSubmit={submit} className="auth-form">
        <h2>Set your password</h2>
        <p className="auth-sub">You’ve been invited to Caalano360 as <b>{info.email}</b> ({info.role === 'admin' ? 'Admin' : 'Viewer'}). Pick a password to finish.</p>
        <label>Your name<input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} autoFocus required /></label>
        <label>Password<input type="password" value={f.pw} onChange={(e) => setF((s) => ({ ...s, pw: e.target.value }))} autoComplete="new-password" required /></label>
        <label>Confirm password<input type="password" value={f.pw2} onChange={(e) => setF((s) => ({ ...s, pw2: e.target.value }))} autoComplete="new-password" required /></label>
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy}>{busy ? 'Saving…' : 'Set password & sign in'}</button>
      </form>
    </AuthShell>
  )
}
// Team & access manager, shown inside Settings for admins.
const TAB_OPTIONS = [
  { id: 'overall', label: 'Caalano360' }, { id: 'users', label: 'Users' }, { id: 'meta', label: 'Meta Ads' },
  { id: 'google', label: 'Google Ads' }, { id: 'cohorts', label: 'Cohorts' }, { id: 'forms', label: 'Forms' },
  { id: 'location', label: 'Location' }, { id: 'appts', label: 'Appointments' }, { id: 'timing', label: 'Timing' },
]
function ClientPicker({ clients, selected, onToggle }) {
  if (!clients || !clients.length) return <div className="cap">No clients available.</div>
  return <div className="alloc-chips">{clients.map((c) => <button type="button" key={c.id} className={`chip ${selected.includes(c.id) ? 'on' : ''}`} onClick={() => onToggle(c.id)}>{c.name}</button>)}</div>
}
// Role + client/tab allocation control, reused by invite, approve and edit.
function AllocationEditor({ value, clients, onChange, actorRole }) {
  const v = value
  const toggleClient = (id) => { const s = new Set(v.clients || []); s.has(id) ? s.delete(id) : s.add(id); onChange({ ...v, clients: [...s] }) }
  const toggleTab = (id) => { const cur = v.tabs == null ? TAB_OPTIONS.map((t) => t.id) : v.tabs; const s = new Set(cur); s.has(id) ? s.delete(id) : s.add(id); onChange({ ...v, tabs: [...s] }) }
  const isSuper = actorRole === 'superadmin'
  // Only a Super Admin can grant Admin / Super Admin. Keep the current value as a
  // (disabled) option so an existing role still shows even if you can't set it.
  const opts = [['user', 'User — agency staff'], ['viewer', 'Viewer — client']]
  if (isSuper) opts.unshift(['superadmin', 'Super Admin — owner control'], ['admin', 'Admin — full control'])
  else if (isAdminishFE(v.role)) opts.unshift([v.role, ROLE_LABEL[v.role] + ' — (only a Super Admin can change this)'])
  return (
    <div className="alloc">
      <label className="alloc-role">Role
        <select value={v.role} onChange={(e) => onChange({ ...v, role: e.target.value })} disabled={!isSuper && isAdminishFE(v.role)}>
          {opts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
        </select>
      </label>
      {v.role === 'superadmin' && <p className="alloc-note">Owner-level: everything an Admin can do, plus manage Admins, add/remove client accounts and the system panel.</p>}
      {v.role === 'admin' && <p className="alloc-note">Full access to every client, every tab and all settings (not the Super-Admin-only areas).</p>}
      {v.role === 'user' && (<>
        <label className="alloc-check"><input type="checkbox" checked={v.allClients !== false} onChange={(e) => onChange({ ...v, allClients: e.target.checked })} /> Can see all client accounts</label>
        {v.allClients === false && (<><div className="alloc-lab">Allowed accounts</div><ClientPicker clients={clients} selected={v.clients || []} onToggle={toggleClient} /></>)}
        <p className="alloc-note">Agency staff — sees dashboards for the accounts above, but can’t manage users or settings.</p>
      </>)}
      {v.role === 'viewer' && (<>
        <div className="alloc-lab">Which clients can they see?</div>
        <ClientPicker clients={clients} selected={v.clients || []} onToggle={toggleClient} />
        <div className="alloc-lab">Which tabs can they see?</div>
        <div className="alloc-chips">{TAB_OPTIONS.map((t) => { const on = v.tabs == null || v.tabs.includes(t.id); return <button type="button" key={t.id} className={`chip ${on ? 'on' : ''}`} onClick={() => toggleTab(t.id)}>{t.label}</button> })}</div>
        <p className="alloc-note">Client access — only the ticked clients and tabs, and no agency-wide views.</p>
      </>)}
    </div>
  )
}
function PendingRow({ u, clients, onApprove, onReject, actorRole }) {
  const [draft, setDraft] = useState({ role: 'viewer', clients: [], allClients: true, tabs: null })
  const [busy, setBusy] = useState(false)
  return (
    <div className="u-pending">
      <div className="u-pending-head">
        <div className="u-pending-who">
          <b>{u.name || u.email}</b> <span className="cap">{u.email}</span>
          {u.note ? <div className="u-note">“{u.note}”</div> : null}
          <div className="cap">Requested {u.requestedAt ? new Date(u.requestedAt).toLocaleDateString() : 'recently'}</div>
        </div>
        <div className="u-actions">
          <button className="btn-primary" disabled={busy || (draft.role !== 'admin' && draft.role !== 'user' && !(draft.clients || []).length)} onClick={async () => { setBusy(true); await onApprove(u, draft); setBusy(false) }}>{busy ? 'Approving…' : 'Approve'}</button>
          <button className="btn-ghost danger" onClick={() => onReject(u)}>Reject</button>
        </div>
      </div>
      <AllocationEditor value={draft} clients={clients} onChange={setDraft} actorRole={actorRole} />
    </div>
  )
}
// Invite / edit-access modal. When `user` is null it's an invite; otherwise it
// edits that user. The role dropdown reveals the matching allocation controls
// (Viewer → clients + tabs, User → accounts) via AllocationEditor.
function UserAccessModal({ user, clients, authUser, onClose, onChanged }) {
  const isInvite = !user
  const self = !isInvite && authUser && user.email === authUser.email
  const [name, setName] = useState(isInvite ? '' : (user.name || ''))
  const [email, setEmail] = useState(isInvite ? '' : user.email)
  const [draft, setDraft] = useState(isInvite
    ? { role: 'viewer', clients: [], allClients: true, tabs: null }
    : { role: user.role, clients: user.clients || [], allClients: user.allClients !== false, tabs: user.tabs })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)
  const copy = (t) => { navigator.clipboard.writeText(t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {}) }
  const submit = async () => {
    setErr('')
    if (isInvite && !email) return setErr('Enter an email address.')
    if (draft.role === 'viewer' && !(draft.clients || []).length) return setErr('Pick at least one client for a Viewer.')
    setBusy(true)
    const payload = { role: draft.role, clients: draft.clients, allClients: draft.allClients, tabs: draft.tabs }
    if (isInvite) {
      const r = await authApi('invite', { method: 'POST', body: JSON.stringify({ name, email, ...payload }) })
      setBusy(false)
      if (r.ok) { setLink(r.inviteUrl); onChanged() } else setErr(r.error || 'Could not create the invite.')
    } else {
      const r = await authApi('update-user', { method: 'POST', body: JSON.stringify({ email: user.email, name, ...payload }) })
      setBusy(false)
      if (r.ok) { onChanged(); onClose() } else setErr(r.error || 'Could not save changes.')
    }
  }
  const resend = async () => { const r = await authApi('resend-invite', { method: 'POST', body: JSON.stringify({ email: user.email, name: user.name, role: user.role, clients: user.clients, allClients: user.allClients, tabs: user.tabs }) }); if (r.ok) setLink(r.inviteUrl) }
  const toggleStatus = async () => { await authApi('update-user', { method: 'POST', body: JSON.stringify({ email: user.email, status: user.status === 'disabled' ? 'active' : 'disabled' }) }); onChanged(); onClose() }
  const remove = async () => { if (!window.confirm(`Remove ${user.name || user.email}? They’ll lose access immediately.`)) return; await authApi('delete-user', { method: 'POST', body: JSON.stringify({ email: user.email }) }); onChanged(); onClose() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal u-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><div><h3>{isInvite ? 'Invite a person' : `Edit access — ${user.name || user.email}`}</h3><span className="cap">{isInvite ? 'Set their role and exactly what they can see' : user.email}</span></div><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          {self && <div className="auth-err" style={{ marginBottom: 12 }}>This is your own account — you can’t change your own role or access.</div>}
          <fieldset className="u-modal-fs" disabled={self}>
            {isInvite ? (
              <div className="u-invite" style={{ marginBottom: 12 }}>
                <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
                <input type="email" placeholder="their@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            ) : (
              <label className="alloc-role" style={{ marginBottom: 10, maxWidth: 320 }}>Name<input className="u-modal-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
            )}
            <AllocationEditor value={draft} clients={clients} onChange={setDraft} actorRole={authUser && authUser.role} />
          </fieldset>
          {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
          {link && (
            <div className="u-link" style={{ marginTop: 12 }}>
              <div><b>Invite link{isInvite ? ` for ${email}` : ''}</b> — send it to them; it works once and expires in 7 days.</div>
              <div className="u-link-row"><code>{link}</code><button className="btn-ghost" onClick={() => copy(link)}>{copied ? 'Copied ✓' : 'Copy link'}</button></div>
            </div>
          )}
          <div className="u-modal-foot">
            <div className="u-modal-foot-l">
              {!isInvite && user.status === 'invited' && <button className="btn-ghost sm" onClick={resend}>Copy invite link</button>}
              {!isInvite && !self && user.status !== 'invited' && <button className="btn-ghost sm" onClick={toggleStatus}>{user.status === 'disabled' ? 'Enable account' : 'Disable account'}</button>}
              {!isInvite && !self && <button className="btn-ghost sm danger" onClick={remove}>Remove</button>}
            </div>
            <div className="u-modal-foot-r">
              <button className="btn-ghost" onClick={onClose}>{link ? 'Done' : 'Cancel'}</button>
              {!(link && isInvite) && <button className="btn-primary" onClick={submit} disabled={busy || self}>{busy ? 'Saving…' : isInvite ? 'Create invite' : 'Save access'}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
function UsersAdmin({ authUser, authEnabled, clients }) {
  const [state, setState] = useState({ status: 'loading', users: [] })
  const [modal, setModal] = useState(null) // { user } to edit, { invite: true } to invite
  const load = () => authApi('users').then((r) => setState(r && r.ok ? { status: 'ok', users: r.users || [] } : { status: r && r.enabled === false ? 'off' : 'err', error: r && r.error, users: [] }))
  useEffect(() => { if (authEnabled) load(); else setState({ status: 'off', users: [] }) }, [authEnabled])
  const rejectPending = async (u) => { if (!window.confirm(`Reject ${u.name || u.email}’s request?`)) return; await authApi('delete-user', { method: 'POST', body: JSON.stringify({ email: u.email }) }); load() }
  const approve = async (u, draft) => { const r = await authApi('approve', { method: 'POST', body: JSON.stringify({ email: u.email, role: draft.role, clients: draft.clients, allClients: draft.allClients, tabs: draft.tabs }) }); if (r.ok) load() }

  if (state.status === 'off') return (
    <div className="card set-users-off">
      <h3 style={{ marginTop: 0 }}>Team &amp; access</h3>
      <p>The multi-user login system is <b>not enabled yet</b>. The site is currently protected by the single shared password.</p>
      <p>To switch on individual accounts, add an <code>AUTH_SECRET</code> environment variable in Netlify (any long random string — this signs everyone’s login sessions). Once it’s set and redeployed, reload this page and you’ll be asked to create the first admin account, then you can invite your team here.</p>
      <p className="cap">Tip: keep the old <code>SITE_PASSWORD</code> set during the switch — it keeps working as a fallback so you can’t get locked out. Remove it once everyone has their own login.</p>
    </div>
  )
  const actorRole = (authUser && authUser.role) || 'admin'
  const badge = (u) => u.status === 'invited' ? <span className="u-badge inv">Invited</span> : u.status === 'disabled' ? <span className="u-badge dis">Disabled</span> : u.status === 'pending' ? <span className="u-badge pend">Pending</span> : <span className="u-badge act">Active</span>
  const accessSummary = (u) => isAdminishFE(u.role) ? 'All clients · all tabs'
    : u.role === 'user' ? (u.allClients !== false ? 'All accounts' : `${(u.clients || []).length} account${(u.clients || []).length === 1 ? '' : 's'}`)
    : `${(u.clients || []).length} client${(u.clients || []).length === 1 ? '' : 's'}${Array.isArray(u.tabs) ? ` · ${u.tabs.length} tab${u.tabs.length === 1 ? '' : 's'}` : ' · all tabs'}`
  const pending = state.users.filter((u) => u.status === 'pending')
  const team = state.users.filter((u) => u.status !== 'pending')
  return (
    <div className="u-wrap">
      {pending.length > 0 && (
        <div className="card u-approvals">
          <h3 style={{ marginTop: 0 }}>Pending approvals <span className="u-badge pend">{pending.length}</span></h3>
          <p className="cap" style={{ marginTop: -4 }}>People who requested access. Set their role and what they can see, then approve — nothing is granted until you do.</p>
          {pending.map((u) => <PendingRow key={u.email} u={u} clients={clients} onApprove={approve} onReject={rejectPending} actorRole={actorRole} />)}
        </div>
      )}

      <div className="card">
        <div className="u-head-row">
          <div><h3 style={{ margin: 0 }}>Team &amp; access</h3><p className="cap" style={{ margin: '4px 0 0' }}><b>Super Admin</b> = owner (manages admins &amp; accounts) · <b>Admin</b> = full control · <b>User</b> = agency staff · <b>Viewer</b> = client. {actorRole !== 'superadmin' && <span>You can manage Users &amp; Viewers; only a Super Admin can manage Admins.</span>}</p></div>
          <button className="btn-primary" onClick={() => setModal({ invite: true })}>+ Invite person</button>
        </div>

        <div className="table-wrap"><table className="mini-tbl appt-tbl users-tbl" style={{ marginTop: 12 }}>
          <thead><tr><th className="lft">Name</th><th className="lft">Email</th><th className="lft">Role</th><th className="lft">Access</th><th className="lft">Status</th><th className="lft"></th></tr></thead>
          <tbody>{state.status === 'loading' ? <tr><td colSpan={6}><Spinner label="Loading team…" /></td></tr> : team.map((u) => {
            const self = u.email === (authUser && authUser.email)
            return (
              <tr key={u.email}>
                <td className="lft">{u.name || <span className="cap">—</span>}{self && <span className="u-you">you</span>}</td>
                <td className="lft">{u.email}</td>
                <td className="lft"><span className={`u-role-tag r-${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                <td className="lft"><span className="cap">{accessSummary(u)}</span></td>
                <td className="lft">{badge(u)}</td>
                <td className="lft">{canManageRoleFE(actorRole, u.role) ? <button className="btn-ghost sm" onClick={() => setModal({ user: u })}>Edit access</button> : <span className="cap" title="Only a Super Admin can manage an Admin">🔒 locked</span>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </div>
      {modal && <UserAccessModal user={modal.user || null} clients={clients} authUser={authUser} onClose={() => setModal(null)} onChanged={load} />}
    </div>
  )
}
function ChangePasswordCard() {
  const [f, setF] = useState({ current: '', next: '', next2: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setMsg(null)
    if (f.next !== f.next2) return setMsg({ ok: false, t: 'New passwords don’t match.' })
    setBusy(true)
    const r = await authApi('change-password', { method: 'POST', body: JSON.stringify({ current: f.current, next: f.next }) })
    setBusy(false)
    if (r.ok) { setMsg({ ok: true, t: 'Password updated.' }); setF({ current: '', next: '', next2: '' }) }
    else setMsg({ ok: false, t: r.error || 'Could not update password.' })
  }
  return (
    <form className="u-invite" onSubmit={submit} style={{ marginTop: 4 }}>
      <input type="password" placeholder="Current password" value={f.current} onChange={(e) => setF((s) => ({ ...s, current: e.target.value }))} autoComplete="current-password" required />
      <input type="password" placeholder="New password" value={f.next} onChange={(e) => setF((s) => ({ ...s, next: e.target.value }))} autoComplete="new-password" required />
      <input type="password" placeholder="Confirm new" value={f.next2} onChange={(e) => setF((s) => ({ ...s, next2: e.target.value }))} autoComplete="new-password" required />
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      {msg && <span className={msg.ok ? 'u-ok' : 'auth-err'} style={{ alignSelf: 'center' }}>{msg.t}</span>}
    </form>
  )
}

/* ============ Shell ============ */
/* ============ Creative Cockpit ============ */
// A hub for creative insight, performance and strategy: every Meta creative in
// one grid, with fillable categorisation columns (awareness stage, persona,
// angle, format, destination, CTA, copy) that save to the client and feed
// reusable dropdowns, joined to the real lead funnel behind each ad so we can
// see what's working and build more like it.
const AWARENESS_OPTS = ['Unaware', 'Problem-aware', 'Solution-aware', 'Product-aware', 'Most-aware']
const DEST_DEFAULTS = ['Landing page', 'Meta Lead Form', 'Schedule page', 'Caalano Systems landing', 'Website']

function useCreatives(clientId, range, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=creatives&client=${clientId}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Creative-fatigue signal fetch (agency Meta Fatigue tab), one client per call.
function useFatigue(clientId, range, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=fatigue&client=${clientId}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Meta anomaly / delivery-health signal fetch, one client per call.
function useAnomalies(clientId, range, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=anomalies&client=${clientId}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Meta's own creative-fatigue verdicts (pushed to the webhook, stored in Blobs).
function useFatigueWebhook(clientId, range, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=fatiguewebhook&client=${clientId}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Small fatigue chip. Low = no chip (only surface what needs attention).
function FatigueBadge({ fat }) {
  if (!fat || fat.level === 'Low') return null
  const cls = fat.level === 'High' ? 'fat-high' : 'fat-med'
  return <span className={`fat-badge ${cls}`} title={(fat.reasons || []).join(' · ') || 'Creative fatigue'}>{fat.level === 'High' ? '🔥 Fatiguing' : '👀 Watch'}</span>
}

// Left-nav wrapper: pick a client, then show its cockpit. Placement is global
// (a top-level menu item) but the data stays per-client.
/* ============ Meta Creative Fatigue (agency-wide) ============ */
// One card per active Meta client, each lazily pulling its own fatigue read
// (frequency + CTR decline + quality ranking). Clients with a live signal float
// to the top. Thresholds are shared and edited in Settings.
function FatigueClientCard({ client, currency, range, nonce, onSummary }) {
  const st = useFatigue(client.id, range, nonce)
  const money = (v) => fmtCurrency(v, currency)
  const d = st.data
  const sum = (d && d.summary) || null
  useEffect(() => { onSummary(client.id, sum) }, [sum && sum.high, sum && sum.medium, sum && sum.total])
  const flagged = ((d && d.creatives) || []).filter((c) => c.level !== 'Low')
  return (
    <div className="card fat-card">
      <div className="fat-card-h">
        <div className="fat-card-nm">{client.name}</div>
        {st.status === 'loading' ? <span className="cap">Checking…</span>
          : sum ? <div className="fat-counts"><span className="fat-c fat-high">{fmtNumber(sum.high)} 🔥</span><span className="fat-c fat-med">{fmtNumber(sum.medium)} 👀</span><span className="fat-c fat-low">{fmtNumber(sum.low)} ok</span></div>
            : <span className="cap">No data</span>}
      </div>
      {st.status === 'loading' ? <Spinner label="" />
        : st.status === 'err' ? <div className="cap" style={{ color: 'var(--neg)' }}>Couldn’t load.</div>
          : !flagged.length ? <div className="cap">No creatives showing fatigue in this window. 🎉</div>
            : <div className="tbl-scroll"><table className="mini-tbl users-tbl cc-tbl">
              <thead><tr><th className="lft">Creative</th><th className="lft">Signal</th><th>Spend</th><th>Freq</th><th>CTR trend</th><th>Quality</th></tr></thead>
              <tbody>{flagged.map((c, i) => <tr key={c.name + i}>
                <td className="lft"><ThumbZoom src={c.thumb} /> <span className="cc-nm" title={c.name}>{c.name}<span className="cap"> · {c.adset || c.campaign}</span></span></td>
                <td className="lft"><FatigueBadge fat={c} /></td>
                <td>{money(c.spend)}</td>
                <td>{c.frequency != null ? `${c.frequency}x` : '—'}</td>
                <td>{c.ctrDrop != null ? <span className={c.ctrDrop > 0 ? 'fat-down' : 'fat-up'}>{c.ctrDrop > 0 ? '▼' : '▲'} {Math.abs(c.ctrDrop)}%</span> : '—'}</td>
                <td>{c.quality && c.quality !== 'UNKNOWN' ? titleCaseWord(c.quality) : '—'}</td>
              </tr>)}</tbody>
            </table></div>}
    </div>
  )
}
const titleCaseWord = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function MetaFatiguePage({ clients, currency, range, nonce }) {
  const metaClients = [...clients].filter((c) => c.meta).sort((a, b) => a.name.localeCompare(b.name))
  const [sums, setSums] = useState({})
  const onSummary = React.useCallback((id, s) => setSums((p) => (p[id] === s ? p : { ...p, [id]: s })), [])
  if (!metaClients.length) return <div className="card empty-deep"><div className="big">🔥</div><b>No clients with a Meta account yet.</b></div>
  const agg = Object.values(sums).reduce((a, s) => s ? { high: a.high + s.high, medium: a.medium + s.medium, total: a.total + s.total } : a, { high: 0, medium: 0, total: 0 })
  // Show clients with a live signal first, then the rest alphabetically.
  const ordered = [...metaClients].sort((a, b) => { const sa = sums[a.id], sb = sums[b.id]; const wa = sa ? sa.high * 2 + sa.medium : -1, wb = sb ? sb.high * 2 + sb.medium : -1; return wb - wa || a.name.localeCompare(b.name) })
  return (
    <>
      <div className="lvl-title">Meta Creative Fatigue <span className="sub">· {rangeLabel(range)} · {metaClients.length} active Meta clients</span></div>
      <div className="scorecard">
        <Sc label="Fatiguing (High)" value={fmtNumber(agg.high)} />
        <Sc label="Watch (Medium)" value={fmtNumber(agg.medium)} />
        <Sc label="Creatives scanned" value={fmtNumber(agg.total)} />
      </div>
      <p className="caveat">A creative-fatigue proxy computed live from Meta delivery: frequency (impressions ÷ reach), CTR decline across the first vs second half of the window, and Meta’s quality ranking. Scored to <b>High 🔥</b> (refresh now), <b>Medium 👀</b> (watch) or ok. Thresholds are shared across clients and set in <b>Settings → Creative fatigue</b>. Not Meta’s official webhook signal (that needs a Meta App with App Review) — this is our best on-platform read of the same signals.</p>
      <div className="fat-grid">{ordered.map((c) => <FatigueClientCard key={c.id} client={c} currency={currency} range={range} nonce={nonce} onSummary={onSummary} />)}</div>
    </>
  )
}

/* ============ Meta anomaly / delivery-health (agency-wide) ============ */
const SEV_ICON = { high: '🔴', med: '🟠', good: '🟢' }
function AnomalyClientCard({ client, currency, range, nonce, onSummary }) {
  const st = useAnomalies(client.id, range, nonce)
  const money = (v) => fmtCurrency(v, currency)
  const d = st.data
  const sum = (d && d.summary) || null
  useEffect(() => { onSummary(client.id, sum) }, [sum && sum.high, sum && sum.med, sum && sum.good])
  const alerts = (d && d.alerts) || []
  const m = d && d.metrics
  const pctChip = (metric) => { // cur vs prev change for the metric strip
    if (!m || !m.prev) return null
    const cur = m.cur[metric], prev = m.prev[metric]
    if (cur == null || prev == null || !prev) return null
    const ch = Math.round(((cur - prev) / prev) * 100)
    if (ch === 0) return <span className="cap"> · flat</span>
    const goodDown = metric === 'cpl' || metric === 'freq'
    const good = goodDown ? ch < 0 : ch > 0
    return <span className={good ? 'fat-up' : 'fat-down'}> · {ch > 0 ? '▲' : '▼'}{Math.abs(ch)}%</span>
  }
  const fmtCtr = (v) => v == null ? '—' : `${(v * 100).toFixed(2)}%`
  return (
    <div className="card fat-card">
      <div className="fat-card-h">
        <div className="fat-card-nm">{client.name}</div>
        {st.status === 'loading' ? <span className="cap">Checking…</span>
          : sum ? <div className="fat-counts">{sum.high ? <span className="fat-c fat-high">{sum.high} 🔴</span> : null}{sum.med ? <span className="fat-c fat-med">{sum.med} 🟠</span> : null}{sum.good ? <span className="fat-c fat-low">{sum.good} 🟢</span> : null}{!sum.high && !sum.med && !sum.good ? <span className="fat-c fat-low">all steady</span> : null}</div>
            : <span className="cap">No data</span>}
      </div>
      {st.status === 'loading' ? <Spinner label="" />
        : st.status === 'err' || d.meta === false ? <div className="cap">{d && d.meta === false ? 'No Meta account mapped.' : 'Couldn’t load.'}</div>
          : <>
            {m && <div className="anom-strip">
              <span>Spend <b>{money(m.cur.spend)}</b>{pctChip('spend')}</span>
              <span>Leads <b>{fmtNumber(m.cur.leads)}</b>{pctChip('leads')}</span>
              <span>CPL <b>{m.cur.cpl != null ? money(m.cur.cpl) : '—'}</b>{pctChip('cpl')}</span>
              <span>CTR <b>{fmtCtr(m.cur.ctr)}</b>{pctChip('ctr')}</span>
              <span>Freq <b>{m.cur.freq != null ? `${m.cur.freq.toFixed(1)}x` : '—'}</b>{pctChip('freq')}</span>
            </div>}
            {!alerts.length ? <div className="cap" style={{ marginTop: 8 }}>No anomalies in this window — delivery looks steady. ✅</div>
              : <div className="anom-list">{alerts.map((a, i) => <div key={i} className={`anom-row anom-${a.severity}`}>
                <span className="anom-ic">{SEV_ICON[a.severity]}</span>
                <span className="anom-txt"><b>{a.title}</b> — {a.detail}</span>
              </div>)}</div>}
            {d.zeroLeadAds && d.zeroLeadAds.length ? <div className="anom-ads">
              <div className="cap" style={{ marginBottom: 4 }}>Spending with no leads:</div>
              {d.zeroLeadAds.map((a, i) => <div key={i} className="anom-ad"><ThumbZoom src={a.thumb} /> <span className="cc-nm" title={a.name}>{a.name}</span> <span className="cap">· {money(a.spend)} · 0 leads</span></div>)}
            </div> : null}
          </>}
    </div>
  )
}
function MetaAnomaliesPage({ clients, currency, range, nonce }) {
  const metaClients = [...clients].filter((c) => c.meta).sort((a, b) => a.name.localeCompare(b.name))
  const [sums, setSums] = useState({})
  const onSummary = React.useCallback((id, s) => setSums((p) => (p[id] === s ? p : { ...p, [id]: s })), [])
  if (!metaClients.length) return <div className="card empty-deep"><div className="big">📡</div><b>No clients with a Meta account yet.</b></div>
  const agg = Object.values(sums).reduce((a, s) => s ? { high: a.high + s.high, med: a.med + s.med } : a, { high: 0, med: 0 })
  const ordered = [...metaClients].sort((a, b) => { const sa = sums[a.id], sb = sums[b.id]; const wa = sa ? sa.high * 2 + sa.med : -1, wb = sb ? sb.high * 2 + sb.med : -1; return wb - wa || a.name.localeCompare(b.name) })
  return (
    <>
      <div className="lvl-title">Delivery health &amp; anomalies <span className="sub">· {rangeLabel(range)} · vs the prior equal window</span></div>
      <div className="scorecard">
        <Sc label="Urgent (🔴)" value={fmtNumber(agg.high)} />
        <Sc label="Watch (🟠)" value={fmtNumber(agg.med)} />
        <Sc label="Meta clients" value={fmtNumber(metaClients.length)} />
      </div>
      <p className="caveat">Each active Meta client compared to the equal prior window: cost per lead, click-through rate, frequency, and spend-vs-leads movement, plus delivery stalls and any ad spending with zero leads. Computed live from Meta delivery data — no Meta App required. Clients needing attention float to the top.</p>
      <div className="fat-grid">{ordered.map((c) => <AnomalyClientCard key={c.id} client={c} currency={currency} range={range} nonce={nonce} onSummary={onSummary} />)}</div>
    </>
  )
}

/* ====== Meta's own creative-fatigue verdicts (webhook-fed, agency-wide) ====== */
function FatigueWebhookCard({ client, range, nonce, onStatus }) {
  const st = useFatigueWebhook(client.id, range, nonce)
  const d = st.data
  const connected = !!(d && d.connected)
  const creatives = (d && d.creatives) || []
  useEffect(() => { onStatus(client.id, { connected, count: creatives.length }) }, [connected, creatives.length])
  if (st.status === 'loading') return <div className="card fat-card"><div className="fat-card-h"><div className="fat-card-nm">{client.name}</div><span className="cap">Checking…</span></div></div>
  if (!connected) return null // hidden until this account is subscribed and sends events
  return (
    <div className="card fat-card">
      <div className="fat-card-h">
        <div className="fat-card-nm">{client.name}</div>
        {d.summary ? <div className="fat-counts"><span className="fat-c fat-high">{d.summary.high} High</span><span className="fat-c fat-med">{d.summary.medium} Med</span><span className="fat-c fat-low">{d.summary.low} Low</span></div> : null}
      </div>
      {!creatives.length ? <div className="cap">Connected — waiting for Meta’s first fatigue event on this account.</div>
        : <div className="tbl-scroll"><table className="mini-tbl users-tbl cc-tbl">
          <thead><tr><th className="lft">Creative</th><th className="lft">Meta verdict</th><th className="lft">Updated</th></tr></thead>
          <tbody>{creatives.map((c) => <tr key={c.adId}>
            <td className="lft"><ThumbZoom src={c.thumb} /> <span className="cc-nm" title={c.name || c.adId}>{c.name || `Ad ${c.adId}`}</span></td>
            <td className="lft"><span className={`fat-badge ${c.level === 'High' ? 'fat-high' : c.level === 'Medium' ? 'fat-med' : ''}`}>{c.level === 'High' ? '🔥 High' : c.level === 'Medium' ? '👀 Medium' : `✅ ${c.level}`}</span></td>
            <td className="lft cap">{c.ts ? new Date(c.ts).toLocaleDateString() : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
  )
}
// Live connection status: proves the receiver is wired up the moment any event
// (test or real) lands, even before accounts are mapped to clients.
function WebhookStatusPanel({ nonce }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(`/.netlify/functions/windsor?scope=webhookstatus${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).then((j) => { if (alive) setSt({ status: 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [nonce])
  const d = st.data
  const ever = d && d.everReceived
  const n = (d && d.events && d.events.length) || 0
  return (
    <div className="card wh-status">
      <div className="wh-status-h" onClick={() => setOpen((o) => !o)} style={{ cursor: n ? 'pointer' : 'default' }}>
        {n ? <span className="u-chev">{open ? '▾' : '▸'}</span> : null}
        <span className={`wh-dot ${ever ? 'on' : ''}`} />
        <b>Webhook receiver</b>
        <span className="cap">· endpoint live at <code>/.netlify/functions/meta-webhook</code></span>
        {st.status === 'loading' ? <span className="cap">· checking…</span> : ever ? <span className="wh-ok">· ✓ events received</span> : <span className="cap">· no events received yet</span>}
        {n ? <span className="cap">· {n} recent{open ? '' : ' · click to view'}</span> : null}
      </div>
      {open && n ? <div className="wh-events">
        <div className="cap" style={{ marginBottom: 4 }}>Last {n} event{n === 1 ? '' : 's'} Meta sent us:</div>
        <table className="mini-tbl users-tbl"><thead><tr><th className="lft">When</th><th className="lft">Account</th><th className="lft">Field</th><th className="lft">Ad</th><th className="lft">Verdict</th></tr></thead>
          <tbody>{d.events.map((e, i) => <tr key={i}><td className="lft cap">{e.ts ? new Date(e.ts).toLocaleString() : '—'}</td><td className="lft">{e.client || e.acct || '—'}</td><td className="lft">{e.field || '—'}</td><td className="lft">{e.adId || '—'}</td><td className="lft">{e.level || '—'}</td></tr>)}</tbody>
        </table>
      </div> : null}
    </div>
  )
}
function MetaFatigueWebhookPage({ clients, range, nonce }) {
  const metaClients = [...clients].filter((c) => c.meta).sort((a, b) => a.name.localeCompare(b.name))
  const [status, setStatus] = useState({})
  const onStatus = React.useCallback((id, s) => setStatus((p) => ({ ...p, [id]: s })), [])
  const anyConnected = Object.values(status).some((s) => s && s.connected)
  const connectedCount = Object.values(status).filter((s) => s && s.connected).length
  return (
    <>
      <div className="lvl-title">Creative fatigue · Meta’s signal <span className="sub">· official webhook verdicts</span></div>
      <WebhookStatusPanel nonce={nonce} />
      {!anyConnected && <div className="card mi-setup">
        <div className="mi-setup-h">🔌 No per-account verdicts yet</div>
        <p>This tab shows Meta’s <b>own</b> Low/Med/High creative-fatigue verdict — pushed by webhook, not computed. Once an ad account is <b>subscribed</b> (see the setup doc) and Meta detects fatigue on a live creative, its verdict appears here as a per-account card.</p>
        <p className="cap">Test events from Meta’s dashboard show in the receiver panel above (proving the pipe works) but won’t map to a client card — they carry a placeholder account id. Setup + subscription commands: <code>META-WEBHOOK-SETUP.md</code>. Meanwhile the <b>Creative fatigue · proxy</b> tab covers every client live.</p>
      </div>}
      {anyConnected && <p className="caveat">Meta’s official verdicts for the {connectedCount} account{connectedCount === 1 ? '' : 's'} that have sent events so far. A card appears once Meta pushes its first event for an account; verdicts fill in as creatives tire. Compare against the proxy tab, which explains the “why”.</p>}
      <div className="fat-grid">{metaClients.map((c) => <FatigueWebhookCard key={c.id} client={c} range={range} nonce={nonce} onStatus={onStatus} />)}</div>
      {(() => {
        // Meta clients that have resolved but sent no events yet — surfaced so
        // subscribed-but-quiet accounts are visible rather than silently hidden.
        const awaiting = metaClients.filter((c) => status[c.id] && !status[c.id].connected)
        if (!awaiting.length) return null
        return <div className="card mi-await">
          <b>Awaiting Meta’s first event · {awaiting.length}</b>
          <p className="cap" style={{ margin: '4px 0 8px' }}>Set up, but Meta hasn’t pushed anything for these yet — they’ll move up as cards the moment it does (fatigue events are sparse and event-driven). If one never appears, re-check that its ad account is subscribed (<code>subscribed_apps</code>).</p>
          <div className="mi-await-list">{awaiting.map((c) => <span key={c.id} className="mi-await-chip">{c.name}</span>)}</div>
        </div>
      })()}
    </>
  )
}

/* ============ Meta ad recommendations (webhook-fed, agency-wide) ============ */
function useRecommendations(nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=recommendations${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [nonce])
  return st
}
function RecommendationsPage({ clients, nonce }) {
  const st = useRecommendations(nonce)
  const nameById = {}; for (const c of clients) nameById[c.id] = c.name
  const d = st.data
  const groups = (d && d.groups) || []
  return (
    <>
      <div className="lvl-title">Ad recommendations · Meta’s signal <span className="sub">· pushed by webhook</span></div>
      <p className="caveat">Meta’s own optimisation recommendations, delivered by webhook as they’re issued (the <code>ad_recommendations</code> field, per subscribed account). Each entry flags that Meta has a suggestion for an ad or account — open Ads Manager for the full write-up. Newest first.</p>
      {st.status === 'loading' ? <div className="card"><Spinner label="Loading recommendations…" /></div>
        : !groups.length ? <div className="card empty-deep"><div className="big">💡</div><b>No recommendations received yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>They’ll appear here as Meta pushes them for your subscribed accounts. Make sure the <code>ad_recommendations</code> field is subscribed for each account.</p></div>
          : <div className="fat-grid">{groups.map((g, i) => (
            <div className="card fat-card" key={i}>
              <div className="fat-card-h"><div className="fat-card-nm">{nameById[g.client] || g.client || `Account ${g.acct}`}</div><span className="fat-c fat-low">{g.count} recommendation{g.count === 1 ? '' : 's'}</span></div>
              <div className="rec-list">{g.items.map((it, j) => (
                <div className="rec-row" key={j}>
                  <div className="rec-when cap">{it.ts ? new Date(it.ts).toLocaleString() : '—'}</div>
                  <div className="rec-body">
                    {it.detail && it.detail.type ? <span className="rec-type">{it.detail.type}</span> : null}
                    {it.detail && it.detail.message ? <span className="rec-msg">{it.detail.message}</span> : <span className="cap">Meta flagged a recommendation{it.adId ? ` for ad ${it.adId}` : ''} — open Ads Manager for the detail.</span>}
                    {it.detail && it.detail.extra && it.detail.extra.length ? <div className="cap rec-extra">{it.detail.extra.join(' · ')}</div> : null}
                  </div>
                </div>
              ))}</div>
            </div>
          ))}</div>}
    </>
  )
}

/* ============ Meta opportunity score (Graph API, agency-wide) ============ */
function useOpportunity(clientId, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=opportunity&client=${clientId}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).then((j) => { if (alive) setSt({ status: 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, nonce])
  return st
}
function OpportunityCard({ client, nonce, onConfig }) {
  const st = useOpportunity(client.id, nonce)
  const d = st.data
  useEffect(() => { onConfig(client.id, d ? { configured: d.configured !== false, meta: d.meta !== false } : null) }, [d && d.configured, d && d.meta])
  if (st.status === 'loading') return <div className="card fat-card"><div className="fat-card-h"><div className="fat-card-nm">{client.name}</div><span className="cap">Loading…</span></div></div>
  if (!d || d.meta === false || d.configured === false) return null
  const score = d.score
  const cls = score == null ? '' : score >= 80 ? 'opp-good' : score >= 60 ? 'opp-mid' : 'opp-low'
  return (
    <div className="card fat-card">
      <div className="fat-card-h"><div className="fat-card-nm">{client.name}</div>{score != null ? <div className={`opp-score ${cls}`}>{score}<span>/100</span></div> : <span className="cap">no score returned</span>}</div>
      {d.error ? <div className="cap" style={{ color: 'var(--neg)' }}>Meta: {d.error}</div>
        : !d.recommendations || !d.recommendations.length ? <div className="cap">No open recommendations — Meta considers this account well optimised. ✅</div>
          : <div className="opp-list">{d.recommendations.map((r, i) => (
            <div className="opp-row" key={i}>
              <span className={`opp-pts ${r.points ? '' : 'opp-pts-0'}`}>{r.points ? `+${r.points}` : '·'}</span>
              <div className="opp-body">
                <div>{r.body || prettyOppType(r.type)}</div>
                {r.lift ? <div className="cap">{r.lift}{r.stage === 'mid_flight_recommendation' ? ' · on a live campaign' : ''}</div> : null}
                {r.url ? <a className="cap opp-link" href={r.url} target="_blank" rel="noreferrer">Open in Ads Manager ↗</a> : null}
              </div>
            </div>
          ))}</div>}
    </div>
  )
}
const prettyOppType = (t) => String(t || 'Recommendation').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
function OpportunityPage({ clients, nonce }) {
  const metaClients = [...clients].filter((c) => c.meta).sort((a, b) => a.name.localeCompare(b.name))
  const [cfg, setCfg] = useState({})
  const onConfig = React.useCallback((id, s) => setCfg((p) => ({ ...p, [id]: s })), [])
  const resolved = Object.values(cfg).filter(Boolean)
  const tokenMissing = resolved.length > 0 && resolved.every((s) => s.configured === false)
  return (
    <>
      <div className="lvl-title">Opportunity score · Meta’s signal <span className="sub">· 0–100 account health + recommendations</span></div>
      {tokenMissing
        ? <div className="card mi-setup"><div className="mi-setup-h">🔌 Meta token not configured</div>
          <p>The opportunity score is pulled live from Meta’s Graph API, which needs your <b>System User token</b> stored on the server. Add an env var <code>META_SYSTEM_TOKEN</code> in Netlify (Site configuration → Environment variables) with the token you generated, then redeploy.</p>
          <p className="cap">It’s used for read-only calls only. Full steps are in <code>META-WEBHOOK-SETUP.md</code>.</p></div>
        : <p className="caveat">Meta’s own 0–100 opportunity score per account, with its top recommendations ranked by expected <b>point lift</b>. Pulled live from the Graph API — higher means better aligned with Meta’s best practices. This is account-level, never per-campaign.</p>}
      <div className="fat-grid">{metaClients.map((c) => <OpportunityCard key={c.id} client={c} nonce={nonce} onConfig={onConfig} />)}</div>
    </>
  )
}

/* ============ Meta Insights — hub for everything Meta-derived ============ */
// Sub-tabbed like the client workspace. Fatigue + Anomalies ship today (computed
// from Windsor data); the Meta-App-gated reads (opportunity score, benchmarks,
// recommendations, Ad Library) are listed as coming so the roadmap is visible.
const META_INSIGHTS_TABS = [
  { id: 'anomalies', label: 'Delivery health', ready: true },
  { id: 'fatigue', label: 'Creative fatigue · proxy', ready: true },
  { id: 'fatigue-webhook', label: 'Creative fatigue · Meta', ready: true },
  { id: 'recommendations', label: 'Ad recommendations', ready: true },
  { id: 'opportunity', label: 'Opportunity score', ready: true },
  { id: 'benchmarks', label: 'Benchmarks', ready: false },
  { id: 'library', label: 'Ad Library', ready: false },
]
function MetaInsightsPage({ clients, currency, range, nonce }) {
  const [tab, setTab] = useState('anomalies')
  const cur = META_INSIGHTS_TABS.find((t) => t.id === tab) || META_INSIGHTS_TABS[0]
  return (
    <>
      <div className="subtabs">{META_INSIGHTS_TABS.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}{!t.ready ? <span className="mi-soon">soon</span> : null}</button>)}</div>
      {tab === 'anomalies' && <MetaAnomaliesPage clients={clients} currency={currency} range={range} nonce={nonce} />}
      {tab === 'fatigue' && <MetaFatiguePage clients={clients} currency={currency} range={range} nonce={nonce} />}
      {tab === 'fatigue-webhook' && <MetaFatigueWebhookPage clients={clients} range={range} nonce={nonce} />}
      {tab === 'recommendations' && <RecommendationsPage clients={clients} nonce={nonce} />}
      {tab === 'opportunity' && <OpportunityPage clients={clients} nonce={nonce} />}
      {!cur.ready && <div className="card mi-soon-card">
        <div className="big">🔒</div>
        <b>{cur.label} needs a Meta App connection.</b>
        <p style={{ maxWidth: 520, margin: '8px auto 0' }}>{tab === 'fatigue-webhook' ? 'Meta’s official creative-fatigue signal is push-only — it arrives via webhook, not a query. It needs a Meta App (System User token + App Review) that subscribes each client ad account. Once connected, Meta’s Low/Med/High verdict shows here beside our proxy read on the other tab.' : tab === 'benchmarks' ? 'Meta computes industry and auction benchmarks from cross-advertiser data we can’t replicate locally — this needs a Meta App with a System User token.' : tab === 'opportunity' ? 'The 0–100 opportunity score and Meta’s own recommendations are generated by Meta and require a direct Graph API connection (Meta App).' : 'Searching any advertiser’s live ads for inspiration needs the public Ad Library API, which requires a verified Meta App.'} Once the Meta App is set up, this tab lights up automatically.</p>
      </div>}
    </>
  )
}

function CreativeCockpitPage({ clients, currency, range, nonce, authUser }) {
  const list = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const [selId, setSelId] = useState(list[0] ? list[0].id : null)
  const sel = list.find((c) => c.id === selId) || list[0]
  if (!list.length) return <div className="card empty-deep"><div className="big">🎬</div><b>No clients with a Meta account yet.</b></div>
  return (
    <>
      <div className="c360-head" style={{ marginTop: 0 }}>
        <div className="pipe-sel"><label>Client</label>
          <select value={(sel && sel.id) || ''} onChange={(e) => setSelId(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
      </div>
      {sel ? <CreativeCockpit key={sel.id} client={sel} currency={currency} range={range} nonce={nonce} authUser={authUser} /> : null}
    </>
  )
}

// A single reusable combobox: native input + datalist so you can pick a saved
// value or type a new one (which is then remembered for next time).
function TagCombo({ value, onChange, options, listId, placeholder }) {
  return (
    <>
      <input className="cc-in" list={listId} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  )
}

function CreativeCockpit({ client, currency, range, nonce }) {
  useSettingsSync()
  const st = useCreatives(client.id, range, nonce)
  const money = (v) => fmtCurrency(v, currency)
  const tags = loadCreativeMeta(client.id)
  const tax = loadCreativeTax(client.id)
  const personaOpts = tax.persona || []
  const angleOpts = tax.angle || []
  const destOpts = [...new Set([...DEST_DEFAULTS, ...(tax.dest || [])])]
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const [f, setF] = useState({ aware: '', persona: '', angle: '', format: '', dest: '', fat: '', q: '' })
  const [dim, setDim] = useState('angle') // "what's working" rollup dimension
  const [open, setOpen] = useState(() => new Set())
  const set = (patch) => setF((p) => ({ ...p, ...patch }))
  const [strat, setStrat] = useState(() => loadInsights(client.id + ':cockpit'))
  const [stratBusy, setStratBusy] = useState(false)
  const [stratErr, setStratErr] = useState(null)
  useEffect(() => { setStrat(loadInsights(client.id + ':cockpit')); setStratErr(null) }, [client.id])

  if (st.status === 'loading') return <div className="card"><Spinner label="Loading creatives…" /></div>
  const d = st.data
  if (st.status === 'err' || !d) return <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn’t load creatives.</b></div>
  if (d.meta === false) return <div className="card empty-deep"><div className="big">🎬</div><b>No Meta account mapped for {client.name}.</b></div>
  const all = d.creatives || []
  if (!all.length) return <div className="card empty-deep"><div className="big">🎬</div><b>No creatives ran in this period.</b></div>
  // Fatigue signal keyed by creative (ad) name, so each row can badge itself.
  const fatBy = {}; for (const fc of ((d.fatigue && d.fatigue.creatives) || [])) fatBy[fc.name] = fc
  const fatSum = (d.fatigue && d.fatigue.summary) || null

  // Attach saved tags; derive the fields we filter / rank on.
  const rows = all.map((c) => {
    const t = tags[c.id] || {}
    const crm = c.crm || {}
    // Auto-detected CTA / copy / destination flow in as defaults; a saved tag
    // overrides. So the grid, filters and rollups work before any manual tagging.
    const fat = fatBy[c.name] || null
    return { ...c, t, fat, fatLevel: fat ? fat.level : null, fatScore: fat ? fat.score : -1, aware: t.aware || '', persona: t.persona || '', angle: t.angle || '', dest: t.dest || c.autoDest || '', cta: t.cta || c.autoCta || '', copy: t.copy || c.autoCopy || '', notes: t.notes || '', ql: crm.qualified || 0, bk: crm.booked || 0, wn: crm.won || 0, rev: crm.revenue || 0, cpq: crm.costPerQualified, cpb: crm.costPerBooked, cpw: crm.costPerWon }
  })
  const filtered = rows.filter((c) => (!f.aware || c.aware === f.aware) && (!f.persona || c.persona === f.persona) && (!f.angle || c.angle === f.angle) && (!f.format || c.format === f.format) && (!f.dest || c.dest === f.dest) && (!f.fat || (f.fat === 'None' ? !c.fat : c.fatLevel === f.fat)) && (!f.q || (c.name || '').toLowerCase().includes(f.q.toLowerCase())))
  const sorted = [...filtered].sort((a, b) => { const av = a[sort.key], bv = b[sort.key]; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return typeof av === 'string' ? String(av).localeCompare(String(bv)) * sort.dir : (av - bv) * sort.dir })
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const Th = ({ k, children, l }) => <th className={l ? 'lft' : 'num'} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  const tot = rows.reduce((a, c) => ({ spend: a.spend + c.spend, leads: a.leads + (c.crm ? c.crm.leads : c.leads), bk: a.bk + c.bk, tagged: a.tagged + (c.aware || c.persona || c.angle ? 1 : 0) }), { spend: 0, leads: 0, bk: 0, tagged: 0 })

  // "What's working" — rank the chosen dimension's values by cost per booked call
  // (the concrete, per-pipeline metric), not the fuzzier qualified-lead heuristic.
  const dimFn = { aware: (c) => c.aware, persona: (c) => c.persona, angle: (c) => c.angle, format: (c) => c.format, dest: (c) => c.dest }[dim]
  const buildRollup = (fn) => { const m = new Map(); for (const c of rows) { const k = fn(c); if (!k) continue; const e = m.get(k) || { key: k, n: 0, spend: 0, leads: 0, bk: 0, wn: 0 }; e.n++; e.spend += c.spend; e.leads += (c.crm ? c.crm.leads : c.leads); e.bk += c.bk; e.wn += c.wn; m.set(k, e) } return [...m.values()].map((e) => ({ ...e, cpb: e.bk ? Math.round(e.spend / e.bk) : null })).sort((a, b) => (a.cpb == null ? 1 : b.cpb == null ? -1 : a.cpb - b.cpb)) }
  const rollup = buildRollup(dimFn)
  const hasCrm = d.hasCrm

  // AI creative strategy over the tagged + performance set.
  const rollupBy = buildRollup
  const genStrategy = async () => {
    if (stratBusy) return
    setStratBusy(true); setStratErr(null)
    try {
      const slim = (c) => ({ name: c.name, format: c.format, angle: c.angle, persona: c.persona, spend: c.spend, leads: c.crm ? c.crm.leads : c.leads, booked: c.bk, cpb: c.cpb })
      const ranked = [...rows].filter((c) => c.spend > 0).sort((a, b) => (a.cpb == null ? 1 : b.cpb == null ? -1 : a.cpb - b.cpb))
      const payload = { mode: 'creative-strategy', clientName: client.name, period: rangeLabel(range),
        rollups: { angle: rollupBy((c) => c.angle), persona: rollupBy((c) => c.persona), aware: rollupBy((c) => c.aware), format: rollupBy((c) => c.format), dest: rollupBy((c) => c.dest) },
        top: ranked.slice(0, 6).map(slim), bottom: ranked.slice(-4).map(slim) }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const rec = { insights: j.insights, period: j.period || rangeLabel(range), generatedAt: j.generatedAt || new Date().toISOString(), model: j.model }
      saveInsights(client.id + ':cockpit', rec); setStrat(rec)
    } catch (e) { setStratErr(String(e.message || e)) } finally { setStratBusy(false) }
  }

  return (
    <>
      <div className="lvl-title">Creative Cockpit <span className="sub">· {client.name} · {rangeLabel(range)} · {fmtNumber(all.length)} creatives{hasCrm ? '' : ' · no CRM mapped (paid metrics only)'}</span></div>
      <div className="scorecard">
        <Sc label="Creatives" value={fmtNumber(all.length)} />
        <Sc label="Ad spend" value={money(tot.spend)} />
        <Sc label="Leads" value={fmtNumber(tot.leads)} />
        {hasCrm && <Sc label="Booked calls" value={fmtNumber(tot.bk)} />}
        {fatSum && (fatSum.high + fatSum.medium) > 0 && <Sc label="Fatiguing" value={`${fmtNumber(fatSum.high)} 🔥 · ${fmtNumber(fatSum.medium)} 👀`} />}
        <Sc label="Tagged" value={`${fmtNumber(tot.tagged)} / ${fmtNumber(all.length)}`} />
      </div>

      {/* What's working — dimension rollup ranked by cost per booked call */}
      <div className="card cc-work">
        <div className="cc-work-h">What’s working <span className="sub">· ranked by cost / booked call · by</span>
          <div className="chan-toggle cc-dim">{[['aware', 'Awareness'], ['persona', 'Persona'], ['angle', 'Angle'], ['format', 'Format'], ['dest', 'Destination']].map(([k, l]) => <button key={k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>{l}</button>)}</div>
        </div>
        {rollup.length ? <div className="tbl-scroll"><table className="mini-tbl users-tbl">
          <thead><tr><th className="lft">{dim === 'aware' ? 'Awareness' : dim === 'dest' ? 'Destination' : dim.charAt(0).toUpperCase() + dim.slice(1)}</th><th>Creatives</th><th>Spend</th><th>Leads</th>{hasCrm && <th>Booked</th>}{hasCrm && <th>Cost / book</th>}{hasCrm && <th>Won</th>}</tr></thead>
          <tbody>{rollup.map((e) => <tr key={e.key}><td className="lft">{e.key}</td><td>{fmtNumber(e.n)}</td><td>{money(e.spend)}</td><td>{fmtNumber(e.leads)}</td>{hasCrm && <td>{fmtNumber(e.bk)}</td>}{hasCrm && <td>{e.cpb != null ? money(e.cpb) : '—'}</td>}{hasCrm && <td>{fmtNumber(e.wn)}</td>}</tr>)}</tbody>
        </table></div> : <div className="cap">Tag your creatives’ {dim === 'aware' ? 'awareness stage' : dim} to see which performs best.</div>}
      </div>

      {/* AI creative strategy */}
      <div className="card ai-card cc-strategy">
        <div className="ai-head">
          <div className="ai-title">✨ AI creative strategy {strat ? <span className="sub">· {strat.period} · generated {new Date(strat.generatedAt).toLocaleString()}</span> : <span className="sub">· Claude reads the tagged performance and tells you what to make next</span>}</div>
          <button className="ai-btn" onClick={genStrategy} disabled={stratBusy}>{stratBusy ? 'Generating…' : strat ? '↻ Regenerate' : '✨ Generate strategy'}</button>
        </div>
        {stratErr && <p className="cap" style={{ color: 'var(--neg)', margin: '2px 0 0' }}>{stratErr}</p>}
        {stratBusy ? <Spinner label="Claude is reviewing the creative…" />
          : strat ? <MdText text={strat.insights} />
            : <p className="cap" style={{ margin: 0 }}>Tag your creatives, then generate a strategy read: what's working by angle / persona / format, what to cut, and concrete new concepts to test. Runs only when you click.</p>}
      </div>

      {/* Filters */}
      <div className="cc-filters">
        <input className="cc-search" placeholder="Search creative name…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <select value={f.format} onChange={(e) => set({ format: e.target.value })}><option value="">All formats</option><option>Image</option><option>Video</option></select>
        <select value={f.aware} onChange={(e) => set({ aware: e.target.value })}><option value="">All awareness</option>{AWARENESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.persona} onChange={(e) => set({ persona: e.target.value })}><option value="">All personas</option>{personaOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.angle} onChange={(e) => set({ angle: e.target.value })}><option value="">All angles</option>{angleOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.dest} onChange={(e) => set({ dest: e.target.value })}><option value="">All destinations</option>{destOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.fat} onChange={(e) => set({ fat: e.target.value })}><option value="">All fatigue</option><option value="High">🔥 Fatiguing</option><option value="Medium">👀 Watch</option><option value="Low">✅ OK</option><option value="None">— No signal</option></select>
        {(f.aware || f.persona || f.angle || f.format || f.dest || f.fat || f.q) ? <button className="link-btn sm" onClick={() => setF({ aware: '', persona: '', angle: '', format: '', dest: '', fat: '', q: '' })}>Clear</button> : null}
      </div>

      {/* Creative grid */}
      <div className="tbl-scroll"><table className="mini-tbl users-tbl cc-tbl">
        <thead><tr>
          <Th k="name" l>Creative</Th><Th k="format" l>Format</Th>
          <th className="lft">Awareness</th><th className="lft">Persona</th><th className="lft">Angle</th><Th k="fatScore" l>Fatigue</Th>
          <Th k="spend">Spend</Th><Th k="leads">Leads</Th>{hasCrm && <Th k="bk">Booked</Th>}{hasCrm && <Th k="cpb">Cost/book</Th>}
        </tr></thead>
        <tbody>{sorted.map((c) => <CreativeRow key={c.id} c={c} clientId={client.id} money={money} hasCrm={hasCrm} personaOpts={personaOpts} angleOpts={angleOpts} destOpts={destOpts} open={open.has(c.id)} onToggle={() => setOpen((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />)}</tbody>
      </table></div>
      <p className="caveat">Every Meta creative in this period, with the real funnel behind it (leads → qualified) joined by <code>utm_content</code>. Format is auto-detected; tag awareness / persona / angle / destination / CTA / copy per creative — values save to {client.name} and feed the dropdowns next time. Click a row to edit its tags and open the ad.</p>
      {d.unmatched && d.unmatched.length ? <p className="cap">{d.unmatched.length} CRM lead source{d.unmatched.length === 1 ? '' : 's'} (utm_content) didn’t match a live ad — likely paused or renamed creatives.</p> : null}
    </>
  )
}

// One creative: a scannable row (thumb, name, format, current tags, performance)
// that expands to the full tag editor + ad preview link.
function CreativeRow({ c, clientId, money, hasCrm, personaOpts, angleOpts, destOpts, open, onToggle }) {
  const save = (patch) => saveCreativeMeta(clientId, c.id, patch)
  const chip = (v) => v ? <span className="cc-chip">{v}</span> : <span className="cc-none">—</span>
  const [ai, setAi] = useState({ busy: false, err: null, reason: null })
  const suggest = async () => {
    if (ai.busy) return
    setAi({ busy: true, err: null, reason: null })
    try {
      const payload = { mode: 'creative-tag', creative: { name: c.name, format: c.format, cta: c.cta, copy: c.copy }, personas: personaOpts, angles: angleOpts }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const s = j.suggestion || {}
      const patch = {}; if (s.aware) patch.aware = s.aware; if (s.persona) patch.persona = s.persona; if (s.angle) patch.angle = s.angle
      if (Object.keys(patch).length) save(patch)
      setAi({ busy: false, err: null, reason: s.reason || null })
    } catch (e) { setAi({ busy: false, err: String(e.message || e), reason: null }) }
  }
  return (
    <React.Fragment>
      <tr className={open ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="lft"><span className="u-chev">{open ? '▾' : '▸'}</span> {c.thumb ? <img className="cc-thumb" src={c.thumb} alt="" loading="lazy" /> : <span className="cc-thumb cc-thumb-none" />}<span className="cc-nm" title={c.name}>{c.name}<span className="cap"> · {c.adset || c.campaign}</span></span></td>
        <td className="lft"><span className={`cc-fmt ${c.format === 'Video' ? 'vid' : 'img'}`}>{c.format}</span></td>
        <td className="lft">{chip(c.aware)}</td>
        <td className="lft">{chip(c.persona)}</td>
        <td className="lft">{chip(c.angle)}</td>
        <td className="lft">{c.fat ? (c.fat.level === 'Low' ? <span className="fat-ok">✅ OK</span> : <FatigueBadge fat={c.fat} />) : <span className="cc-none">—</span>}</td>
        <td>{money(c.spend)}</td>
        <td>{fmtNumber(c.crm ? c.crm.leads : c.leads)}</td>
        {hasCrm && <td>{fmtNumber(c.bk)}</td>}
        {hasCrm && <td>{c.cpb != null ? money(c.cpb) : '—'}</td>}
      </tr>
      {open && <tr className="cc-edit-row"><td colSpan={hasCrm ? 10 : 8}>
        <div className="cc-edit" onClick={(e) => e.stopPropagation()}>
          <div className="cc-edit-perf">
            {hasCrm && <><span><b>{fmtNumber(c.bk)}</b> booked</span><span><b>{fmtNumber(c.wn)}</b> won</span><span><b>{money(c.rev)}</b> revenue</span></>}
            <span><b>{fmtNumber(c.impressions)}</b> impr</span><span><b>{fmtNumber(c.clicks)}</b> clicks</span>
            <button className="ai-btn sm" onClick={suggest} disabled={ai.busy} title="Let Claude suggest awareness / persona / angle from the copy">{ai.busy ? 'Thinking…' : '✨ Suggest tags'}</button>
            {c.igUrl && <a className="cc-view" href={c.igUrl} target="_blank" rel="noreferrer">↗ View ad on Instagram</a>}
          </div>
          {c.fat && c.fat.level !== 'Low' && <div className="cap cc-fat-reason"><FatigueBadge fat={c.fat} /> {c.fat.frequency != null ? `frequency ${c.fat.frequency}x` : ''}{c.fat.ctrDrop != null ? ` · CTR ${c.fat.ctrDrop >= 0 ? 'down' : 'up'} ${Math.abs(c.fat.ctrDrop)}% over the period` : ''}{(c.fat.reasons && c.fat.reasons.length) ? ` · ${c.fat.reasons.join(' · ')}` : ''} — consider a fresh variation.</div>}
          {ai.err && <div className="cap" style={{ color: 'var(--neg)' }}>{ai.err}</div>}
          {ai.reason && <div className="cap cc-ai-reason">✨ {ai.reason} <span className="cc-ai-note">· suggested — edit anything below</span></div>}
          <div className="cc-fields">
            <label>Awareness<select value={c.aware} onChange={(e) => save({ aware: e.target.value })}><option value="">—</option>{AWARENESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select></label>
            <label>Persona<TagCombo value={c.persona} onChange={(v) => save({ persona: v })} options={personaOpts} listId={`cc-persona-${clientId}`} placeholder="e.g. First-home buyer" /></label>
            <label>Angle<TagCombo value={c.angle} onChange={(v) => save({ angle: v })} options={angleOpts} listId={`cc-angle-${clientId}`} placeholder="e.g. Save on tax" /></label>
            <label>Destination {c.autoDest && !c.t.dest ? <span className="cc-auto">auto</span> : null}<TagCombo value={c.dest} onChange={(v) => save({ dest: v })} options={destOpts} listId={`cc-dest-${clientId}`} placeholder="Where traffic lands" /></label>
            <label>CTA button {c.autoCta && !c.t.cta ? <span className="cc-auto">auto</span> : null}<input className="cc-in" value={c.cta} onChange={(e) => save({ cta: e.target.value })} placeholder="e.g. Book Now" /></label>
          </div>
          {c.headline && <div className="cap cc-headline"><b>Headline:</b> {c.headline}</div>}
          <div className="cc-fields2">
            <label>Ad copy {c.autoCopy && !c.t.copy ? <span className="cc-auto">auto</span> : null}<textarea rows={2} value={c.copy} onChange={(e) => save({ copy: e.target.value })} placeholder="Paste the primary text of the ad…" /></label>
            <label>Notes<textarea rows={2} value={c.notes} onChange={(e) => save({ notes: e.target.value })} placeholder="What’s the concept / why it works…" /></label>
          </div>
        </div>
      </td></tr>}
    </React.Fragment>
  )
}

/* ============ Client Update generator ============ */
// Pick a client + date range, pull the computed intelligence for the period, and
// generate a client-facing account update in two formats: casual (WhatsApp) and
// formal/structured (email). Australian spelling, no em dashes, from Caalano
// Digital, addressed by first name. Every figure comes from computed data; the
// AI only writes it up. The last update is saved per client.
// Loads every data source behind a client update in one shot (ad platforms +
// CRM), so the page can both render the supporting dashboard and generate the
// message from the same numbers.
function useUpdateData(clientId, range, nonce) {
  const [st, setSt] = useState({ status: 'idle', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    if (!clientId) { setSt({ status: 'idle', data: null }); return }
    let alive = true; setSt({ status: 'loading', data: null })
    const base = `/.netlify/functions/windsor?client=${clientId}`
    const g = (s) => fetch(`${base}&scope=${s}&${q}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({}))
    Promise.all([
      g('health'), g('creatives'), g('updateextra'), g('users'),
      fetch(`${base}&channel=google&${q}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([health, creatives, extra, users, google]) => { if (alive) setSt({ status: (health && health.error) ? 'err' : 'ok', data: { health, creatives, extra, users, google } }) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Small thumbnail that pops a larger preview on hover. The preview is
// position:fixed (positioned from the thumbnail's on-screen rect) so it renders
// over the table instead of being clipped by the scroll container's overflow.
function ThumbZoom({ src }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  if (!src) return <span className="ud-thumb ud-thumb-none" />
  const show = () => {
    const r = ref.current && ref.current.getBoundingClientRect(); if (!r) return
    const W = 240, above = r.top > 260
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - W - 12)), top: above ? r.top - 8 : r.bottom + 8, above })
  }
  return (
    <span className="ud-thumb" ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <img src={src} alt="" loading="lazy" />
      {pos && <span className="ud-thumb-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, transform: pos.above ? 'translateY(-100%)' : 'none', zIndex: 9999 }}><img src={src} alt="" /></span>}
    </span>
  )
}
// Campaign / ad-set rows that expand to the ads inside them (with thumbnails).
function MetaGroupRows({ groups, adsFor, money, level }) {
  const [open, setOpen] = useState(() => new Set())
  const toggle = (n) => setOpen((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s })
  const cpr = (spend, n) => (n ? money(Math.round(spend / n)) : '—')
  return groups.map((g) => {
    const isOpen = open.has(g.name); const kids = isOpen ? adsFor(g.name) : []
    return (
      <React.Fragment key={g.name}>
        <tr className={isOpen ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => toggle(g.name)}>
          <td className="lft"><span className="u-chev">{isOpen ? '▾' : '▸'}</span> {g.name}</td>
          <td>{money(g.spend)}</td><td>{fmtNumber(g.leads)}</td><td>{g.booked != null ? fmtNumber(g.booked) : '—'}</td><td>{g.booked ? cpr(g.spend, g.booked) : '—'}</td>
        </tr>
        {isOpen && kids.map((a, i) => (
          <tr className="ud-child" key={a.name + i}>
            <td className="lft"><ThumbZoom src={a.thumb} /> <span className="cc-nm" title={a.name}>{a.name}</span>{a.previewUrl ? <a className="ud-prev" href={a.previewUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗</a> : null}</td>
            <td>{money(a.spend)}</td><td>{fmtNumber(a.leads)}</td><td>{fmtNumber(a.booked)}</td><td>{a.booked ? cpr(a.spend, a.booked) : '—'}</td>
          </tr>
        ))}
        {isOpen && !kids.length && <tr className="ud-child"><td colSpan={5} className="cap">No ads found in this {level}.</td></tr>}
      </React.Fragment>
    )
  })
}

// The read-only dashboard of every figure behind the update: ad-platform results
// (front of funnel) blended with Caalano Systems bookings, pipeline and wins via
// UTM. Consolidated summary tables that mirror what the AI writes up.
function UpdateDataDashboard({ st, currency }) {
  const money = (v) => fmtCurrency(v, currency)
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading the numbers behind the update…" /></div>
  if (st.status !== 'ok' || !st.data) return null
  const { health, creatives, extra, users, google } = st.data
  const k = (health && health.kpis) || {}, ch = (health && health.channels) || {}, pls = (health && health.pipelines) || []
  const adLeads = (ch.metaLeads || 0) + (ch.googleConv || 0)
  const adCpl = adLeads ? Math.round(k.adSpend / adLeads) : null
  const twoChannels = (ch.metaSpend || 0) > 0 && (ch.googleSpend || 0) > 0
  const metaCpl = ch.metaLeads ? Math.round(ch.metaSpend / ch.metaLeads) : null
  const googCpc = ch.googleConv ? Math.round(ch.googleSpend / ch.googleConv) : null
  const cre = (creatives && creatives.creatives) || [], segs = (creatives && creatives.segments) || []
  const ap = extra && extra.appts, lr = (extra && extra.lostReasons) || [], nbn = (extra && extra.nonBookerNotes) || []
  const us = (users && users.users) || []
  const gg = google && google.google
  // Meta campaign rollup from the creatives (UTM-blended bookings).
  const campMap = new Map()
  for (const c of cre) { const key = c.campaign || '—'; const e = campMap.get(key) || { name: key, spend: 0, leads: 0, booked: 0 }; e.spend += c.spend || 0; e.leads += (c.crm ? c.crm.leads : c.leads) || 0; e.booked += (c.crm ? c.crm.booked : 0) || 0; campMap.set(key, e) }
  const metaCamps = [...campMap.values()].sort((a, b) => b.spend - a.spend)
  const topCre = [...cre].sort((a, b) => ((b.crm ? b.crm.booked : 0) - (a.crm ? a.crm.booked : 0)) || (b.spend - a.spend)).slice(0, 12)
  const cpr = (spend, n) => (n ? money(Math.round(spend / n)) : '—')
  // Flat ad rows (per campaign/ad set/creative) for the drill-down.
  const ads = (creatives && creatives.ads) || []
  const adsInCampaign = (name) => ads.filter((a) => a.campaign === name).sort((a, b) => b.spend - a.spend)
  const adsInAdset = (name) => ads.filter((a) => a.adset === name).sort((a, b) => b.spend - a.spend)
  const bk = (creatives && creatives.bookingsByUtm) || { content: [], medium: [] }
  const bkContent = bk.content || [], bkMedium = bk.medium || []
  return (
    <div className="ud-wrap">
      <div className="lvl-title" style={{ marginTop: 18 }}>The numbers behind this update <span className="sub">· ad-platform results blended with Caalano Systems bookings &amp; pipeline via UTM</span></div>
      {/* Scorecards */}
      <div className="scorecard">
        <Sc label="Ad spend" value={money(k.adSpend || 0)} />
        {twoChannels ? <>
          <Sc label="Meta leads" value={fmtNumber(ch.metaLeads || 0)} />
          <Sc label="Meta cost/lead" value={metaCpl != null ? money(metaCpl) : '—'} />
          <Sc label="Google conv." value={fmtNumber(ch.googleConv || 0)} />
          <Sc label="Google cost/conv" value={googCpc != null ? money(googCpc) : '—'} />
        </> : <>
          <Sc label="Leads (ads)" value={fmtNumber(adLeads)} />
          <Sc label="Cost / lead" value={adCpl != null ? money(adCpl) : '—'} />
        </>}
        <Sc label="Booked calls" value={fmtNumber(k.booked || 0)} />
        <Sc label="Cost / booked" value={k.cpBooked != null ? money(k.cpBooked) : '—'} />
        <Sc label="Won" value={fmtNumber(k.won || 0)} />
        <Sc label="Revenue" value={money(k.revenue || 0)} />
      </div>
      {twoChannels
        ? <p className="cap"><b>Two channels are running this period.</b> Meta and Google are shown separately above so each matches its own platform (Meta form/website leads vs Google conversions, which aren’t always the same thing). Combined that’s {fmtNumber(adLeads)} leads at {adCpl != null ? money(adCpl) : '—'} blended. Booked calls and wins are Caalano Systems, attributed to the ads by UTM. The CRM logged {fmtNumber(k.leads || 0)} opportunities across all sources.</p>
        : <p className="cap">Leads and cost per lead are ad-reported (Meta {fmtNumber(ch.metaLeads || 0)}, Google {fmtNumber(ch.googleConv || 0)}) so they match Ads Manager. Booked calls and wins are Caalano Systems, attributed to the ads by UTM. The CRM logged {fmtNumber(k.leads || 0)} opportunities across all sources.</p>}
      {ap && <p className="cap">Appointments: {fmtNumber(ap.attended)} attended, {fmtNumber(ap.noShow)} no-shows, {fmtNumber(ap.upcoming)} still upcoming, {fmtNumber(ap.occurred)} calls have happened.{ap.stageOnlyShown > 0 ? ` ${fmtNumber(ap.stageOnlyShown)} advanced past the show stage but weren’t marked attended (reporting gap).` : ''}</p>}

      {/* Pipelines */}
      {pls.length > 0 && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Pipeline — where leads are at</div>
        <div className="ud-pipes">{pls.map((p) => {
          const maxOpen = Math.max(1, ...(p.stages || []).map((s) => s.open))
          return (
            <div className="card ud-pipe" key={p.name}>
              <div className="ud-pipe-h">{p.name} <span className="sub">· {fmtNumber(p.leads)} leads · {fmtNumber(p.booked)} booked · {fmtNumber(p.won)} won{p.revenue ? ` · ${money(p.revenue)}` : ''}{p.openValue ? ` · ${money(p.openValue)} open` : ''}</span></div>
              {(p.stages || []).length ? <div className="ud-funnel">{p.stages.map((s) => (
                <div className="ud-stage" key={s.name}><span className="ud-stage-n">{s.name}</span><span className="ud-stage-bar"><span style={{ width: `${Math.max(4, (s.open / maxOpen) * 100)}%` }} /></span><span className="ud-stage-c">{fmtNumber(s.open)}</span></div>
              ))}</div> : <div className="cap">No open deals sitting in a stage.</div>}
            </div>
          )
        })}</div>
      </>}

      {/* Meta Ads — campaign / ad set rows drill into their ads */}
      {(metaCamps.length > 0 || segs.length > 0) && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Meta Ads <span className="sub">· click a campaign or ad set to see its ads · hover a thumbnail to enlarge</span></div>
        <div className="ud-tbls">
          {metaCamps.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Campaigns</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Campaign</th><th>Spend</th><th>Leads</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody><MetaGroupRows groups={metaCamps} adsFor={adsInCampaign} money={money} level="campaign" /></tbody></table></div>}
          {segs.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Ad sets (segments)</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Ad set</th><th>Spend</th><th>Leads</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody><MetaGroupRows groups={segs} adsFor={adsInAdset} money={money} level="ad set" /></tbody></table></div>}
        </div>
        {topCre.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Top creatives</div><table className="mini-tbl users-tbl cc-tbl"><thead><tr><th className="lft">Creative</th><th className="lft">Format</th><th>Spend</th><th>Leads</th><th>Cost/lead</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody>{topCre.map((c) => { const cl = c.crm ? c.crm.leads : c.leads, bkd = c.crm ? c.crm.booked : 0; return <tr key={c.id}><td className="lft"><ThumbZoom src={c.thumb} /> <span className="cc-nm" title={c.name}>{c.name}</span></td><td className="lft"><span className={`cc-fmt ${c.format === 'Video' ? 'vid' : 'img'}`}>{c.format}</span></td><td>{money(c.spend)}</td><td>{fmtNumber(cl)}</td><td>{cpr(c.spend, cl)}</td><td>{fmtNumber(bkd)}</td><td>{cpr(c.spend, bkd)}</td></tr> })}</tbody></table></div>}
      </>}

      {/* Which ads drove the bookings — traced through the lead UTMs */}
      {(k.booked || 0) > 0 && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Which ads drove the {fmtNumber(k.booked)} booked calls <span className="sub">· traced through the lead UTMs</span></div>
        {(bkContent.length > 0 || bkMedium.length > 0) ? <>
          <p className="cap">Bookings are attributed to each lead's UTMs. Where a <code>utm_content</code> matches a live ad (by name or creative ID) it's named; the rest show the raw UTM value, which reveals how tracking is set (e.g. ad IDs or a different naming scheme) and is why some ads read 0 booked above.</p>
          <div className="ud-tbls">
            {bkContent.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">By creative (utm_content)</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Ad / UTM value</th><th>Booked</th><th>Leads</th><th>Won</th></tr></thead><tbody>{bkContent.map((r, i) => <tr key={i}><td className="lft">{r.matchedAd || r.utm}<span className="cap"> · {r.matchedAd ? 'matched ad' : 'unmatched utm'}</span></td><td>{fmtNumber(r.booked)}</td><td>{fmtNumber(r.leads)}</td><td>{fmtNumber(r.won)}</td></tr>)}</tbody></table></div>}
            {bkMedium.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">By ad set (utm_medium)</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Ad set / UTM value</th><th>Booked</th><th>Leads</th><th>Won</th></tr></thead><tbody>{bkMedium.map((r, i) => <tr key={i}><td className="lft">{r.utm}</td><td>{fmtNumber(r.booked)}</td><td>{fmtNumber(r.leads)}</td><td>{fmtNumber(r.won)}</td></tr>)}</tbody></table></div>}
          </div>
        </> : <p className="cap">None of the {fmtNumber(k.booked)} booked calls could be traced to an ad: the booked leads carried no <code>utm_content</code> or <code>utm_medium</code>. That means the booking-stage opportunities lost their ad tracking (or came in without it), which is why the per-ad booked figures read 0. Worth checking how UTMs are captured onto the opportunity.</p>}
      </>}

      {/* Google Ads */}
      {gg && ((gg.campaigns || []).length > 0 || (gg.adGroups || []).length > 0) && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Google Ads <span className="sub">· campaign → ad group · ad-reported</span></div>
        <div className="ud-tbls">
          {(gg.campaigns || []).length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Campaigns</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Campaign</th><th>Cost</th><th>Clicks</th><th>Conv.</th></tr></thead><tbody>{gg.campaigns.slice(0, 15).map((c) => <tr key={c.name}><td className="lft">{c.name}</td><td>{money(c.cost)}</td><td>{fmtNumber(c.clicks)}</td><td>{fmtNumber(Math.round(c.conversions))}</td></tr>)}</tbody></table></div>}
          {(gg.adGroups || []).length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Ad groups</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Ad group</th><th>Cost</th><th>Clicks</th><th>Conv.</th></tr></thead><tbody>{gg.adGroups.slice(0, 20).map((c) => <tr key={c.campaign + c.name}><td className="lft">{c.name}<span className="cap"> · {c.campaign}</span></td><td>{money(c.cost)}</td><td>{fmtNumber(c.clicks)}</td><td>{fmtNumber(Math.round(c.conversions))}</td></tr>)}</tbody></table></div>}
        </div>
      </>}

      {/* Users + lost reasons */}
      <div className="ud-tbls">
        {us.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">User performance</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Rep</th><th>Leads</th><th>Booked</th><th>Won</th><th>Revenue</th></tr></thead><tbody>{[...us].sort((a, b) => b.won - a.won || b.booked - a.booked).slice(0, 12).map((u) => <tr key={u.id}><td className="lft">{u.name}</td><td>{fmtNumber(u.leads)}</td><td>{fmtNumber(u.booked)}</td><td>{fmtNumber(u.won)}</td><td>{money(u.revenue)}</td></tr>)}</tbody></table></div>}
        {lr.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Lost reasons</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Reason</th><th>Count</th></tr></thead><tbody>{lr.map((r) => <tr key={r.reason}><td className="lft">{r.reason}</td><td>{fmtNumber(r.count)}</td></tr>)}</tbody></table></div>}
      </div>

      {/* Non-booker note themes */}
      {nbn.length > 0 && <details className="ud-notes"><summary>Notes on {fmtNumber(nbn.length)} leads who didn’t book (the AI uses these for cause detection)</summary>
        <div className="u-notes" style={{ marginTop: 8 }}>{nbn.map((n, i) => <div className="u-note-item" key={i}><div className="u-note-meta">{n.pipeline}</div><div className="u-note-body">{n.note}</div></div>)}</div>
      </details>}
    </div>
  )
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1600) } catch { /* clipboard blocked */ } }
  return <button className="link-btn sm cu-copy" onClick={copy}>{done ? '✓ Copied' : label}</button>
}
function ClientUpdatePage({ clients, currency, range, nonce }) {
  useSettingsSync()
  const list = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  const [selId, setSelId] = useState(list[0] ? list[0].id : null)
  const sel = list.find((c) => c.id === selId) || list[0]
  const [firstName, setFirstName] = useState('')
  const [ctx, setCtx] = useState('')
  const [rec, setRec] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const dataSt = useUpdateData(sel && sel.id, range, nonce)
  // Load the last saved update, first name and client context on client change.
  useEffect(() => {
    if (!sel) return
    const saved = loadInsights(sel.id + ':update')
    setRec(saved || null); setFirstName((saved && saved.firstName) || ''); setCtx(loadClientCtx(sel.id)); setErr(null)
  }, [selId, SETTINGS.loaded])
  const generate = async () => {
    if (!sel || busy) return
    if (dataSt.status !== 'ok' || !dataSt.data) { setErr('The client numbers are still loading, give it a moment and try again.'); return }
    setBusy(true); setErr(null)
    try {
      const { health, creatives, extra } = dataSt.data
      if (!health || health.error) throw new Error((health && health.error) || 'could not load the client data')
      const topCr = (creatives.creatives || [])
        .map((c) => ({ name: c.name, format: c.format, spend: c.spend, leads: c.crm ? c.crm.leads : c.leads, booked: c.crm ? c.crm.booked : 0 }))
        .sort((a, b) => (b.booked - a.booked) || (b.leads - a.leads)).slice(0, 5)
      // Elapsed days in the selected range, for the "is no-wins expected?" note.
      const periodDays = Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1)
      const payload = { mode: 'client-update', clientName: sel.name, firstName: firstName.trim(), clientContext: (ctx || '').trim(), period: rangeLabel(range), periodDays, kpis: health.kpis, channels: health.channels, forecast: health.forecast, pipelines: health.pipelines || [], segments: creatives.segments || [], creatives: topCr, appts: extra.appts || null, lostReasons: extra.lostReasons || [], avgCloseDays: extra.avgCloseDays != null ? extra.avgCloseDays : null, nonBookerNotes: extra.nonBookerNotes || [] }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const full = { subject: j.subject || '', email: j.email || '', whatsapp: j.whatsapp || '', firstName: firstName.trim(), period: j.period || rangeLabel(range), generatedAt: j.generatedAt || new Date().toISOString() }
      saveInsights(sel.id + ':update', full); setRec(full)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  if (!list.length) return <div className="card empty-deep"><div className="big">✉️</div><b>No clients available.</b></div>
  return (
    <>
      <div className="c360-head" style={{ marginTop: 0 }}>
        <div className="pipe-sel"><label>Client</label>
          <select value={(sel && sel.id) || ''} onChange={(e) => setSelId(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <div className="pipe-sel"><label>Client first name</label>
          <input className="cu-name" value={firstName} placeholder="e.g. Jason" onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <button className="ai-btn cu-gen" onClick={generate} disabled={busy}>{busy ? 'Generating…' : rec ? '↻ Regenerate update' : '✨ Generate update'}</button>
      </div>
      <p className="cap" style={{ marginTop: 2 }}>Pulls this client's computed results for <b>{rangeLabel(range)}</b> (spend, leads, booked calls, revenue, cost per result, best-performing ads) and writes a client-ready update. Set the period with the date range up top. Nothing is invented — it only uses the numbers on the dashboard.</p>
      <details className="cu-ctx" open={!!ctx}>
        <summary>Client context &amp; notes {ctx ? <span className="cu-ctx-on">· saved</span> : <span className="cap">· optional background the AI uses for tone &amp; framing</span>}</summary>
        <textarea className="cu-ctx-ta" rows={4} value={ctx} placeholder="Anything the AI should know about this client: their business, tone to use, what they care about, current focus, sensitivities, offers running, seasonality, relationship notes… This is fed into the update as background (it never invents numbers). Saved to this client and shared with the team." onChange={(e) => setCtx(e.target.value)} onBlur={() => sel && saveClientCtx(sel.id, ctx)} />
        <div className="cap">Saved to Settings for {sel ? sel.name : 'this client'} and shared across the team. Edited here for convenience.</div>
      </details>
      {err && <div className="card empty-deep" style={{ padding: 18 }}><b>Couldn’t generate.</b><p className="cap" style={{ marginTop: 6 }}>{err}</p></div>}
      {busy && <div className="card"><Spinner label="Pulling the numbers and writing the update…" /></div>}
      {!busy && rec && (rec.email || rec.whatsapp) && <>
        <div className="cu-meta cap">{err ? 'Showing your last saved update — the new one didn’t generate (see the error above). ' : ''}Last generated {new Date(rec.generatedAt).toLocaleString()} · {rec.period}</div>
        <div className="cu-grid">
          <div className="card cu-panel">
            <div className="cu-panel-h">💬 WhatsApp <span className="sub">· casual</span><CopyBtn text={rec.whatsapp} /></div>
            <pre className="cu-body">{rec.whatsapp}</pre>
          </div>
          <div className="card cu-panel">
            <div className="cu-panel-h">✉️ Email <span className="sub">· formal</span><CopyBtn text={`Subject: ${rec.subject}\n\n${rec.email}`} label="Copy all" /></div>
            {rec.subject && <div className="cu-subject"><span className="cu-subj-l">Subject</span>{rec.subject}<CopyBtn text={rec.subject} label="Copy" /></div>}
            <pre className="cu-body">{rec.email}</pre>
          </div>
        </div>
      </>}
      {!busy && !rec && !err && <div className="card empty-deep"><div className="big">✉️</div><b>Generate an update for {sel ? sel.name : 'this client'}.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Add the client's first name, pick your date range up top, then Generate. You'll get a casual WhatsApp version and a formal email version, ready to copy and send.</p></div>}
      <UpdateDataDashboard st={dataSt} currency={currency} />
    </>
  )
}

function Dashboard({ authUser, authEnabled, onLogout }) {
  const [data, setData] = useState(null)
  const [config, setConfig] = useState(null)
  const [err, setErr] = useState(null)
  const [view, setView] = useState('overview')
  const [picked, setPicked] = useState(null)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('caalano_theme') || 'dark' } catch { return 'dark' } })
  const [range, setRange] = useState(() => presetRange('last_30d'))
  const [refreshKey, setRefreshKey] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const agency = useAgencyLive(range, refreshKey)
  // Server-backed settings: re-render on hydrate/change; enabled is a derived
  // write-through value so client on/off persists to the server like the rest.
  useSettingsSync()
  const enabled = SETTINGS.enabled
  const setEnabled = (updater) => {
    const next = typeof updater === 'function' ? updater(SETTINGS.enabled) : updater
    SETTINGS.enabled = next; writeLS(ENABLED_KEY, next); saveSettingsRemote({ enabled: next }); bumpSettings()
  }

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('caalano_theme', theme) } catch {} }, [theme])
  useEffect(() => {
    hydrateSettings()
    fetch('data/snapshot.json').then((r) => { if (!r.ok) throw new Error('snapshot not found'); return r.json() }).then(setData).catch((e) => setErr(e.message))
    fetch('data/config.json').then((r) => r.ok ? r.json() : null).then(setConfig).catch(() => {})
  }, [])

  if (err) return <div className="main"><div className="card">Failed to load data: {err}</div></div>
  if (!data) return <div className="main"><div className="card">Loading dashboard…</div></div>

  // snapshot.json clients don't carry the GHL location id, but config.json does.
  // Merge it in so the overview knows which clients have CRM (Caalano Systems)
  // and fires the ovrow requests - without this, r.c.ghl is undefined for every
  // client and the CRM columns never load.
  const ghlById = Object.fromEntries(((config && config.clients) || []).map((c) => [c.id, c.ghl]))
  // Apply any per-client override (UI-added clients, or name/industry/relink
  // edits) on top of a base client, matched by id. Account ids/names and
  // name/industry are taken from the override when present.
  const overrides = SETTINGS.clients || {}
  const applyOv = (c) => {
    const o = overrides[c.id]; if (!o) return c
    const g = (k, fb) => (o[k] !== undefined && o[k] !== null && o[k] !== '' ? o[k] : fb)
    return { ...c, name: g('name', c.name), industry: (o.industry !== undefined && o.industry !== '') ? o.industry : c.industry, meta: o.meta !== undefined ? o.meta : c.meta, google: o.google !== undefined ? o.google : c.google, ghl: o.ghl !== undefined ? o.ghl : c.ghl, metaName: o.metaName || c.metaName, googleName: o.googleName || c.googleName, ghlName: o.ghlName || c.ghlName, custom: true }
  }
  const custom = customClientList()
  const extras = custom.filter((cu) => !data.clients.some((c) => c.id === cu.id))
  const baseClients = [...data.clients.map(applyOv), ...extras]
  const visibleClients = baseClients.filter((c) => enabled[c.id] !== false && canSeeClientFE(authUser, c.id)).map((c) => (c.ghl || !ghlById[c.id] ? c : { ...c, ghl: ghlById[c.id] }))
  const rows = computeRows(visibleClients, agency.data)
  // Config for the Settings page, with overrides applied + UI-added clients.
  const cfgMerged = config ? { ...config, clients: [...(config.clients || []).map(applyOv), ...extras.filter((cu) => !(config.clients || []).some((c) => c.id === cu.id))] } : config
  const go = (v) => { setView(v); setPicked(null); setNavOpen(false) }
  const openClient = (c) => { setPicked(c); setView('clients'); setNavOpen(false) }
  // Access role gates the whole shell. Viewers (clients) never reach agency-wide
  // views — they land straight in their assigned client(s).
  const role = authEnabled && authUser ? authUser.role : 'admin'
  const isViewer = role === 'viewer'
  const myClients = visibleClients
  const curView = isViewer ? (view === 'settings' ? 'settings' : 'clients') : view
  const curPicked = curView === 'clients'
    ? ((picked && baseClients.some((c) => c.id === picked.id) && canSeeClientFE(authUser, picked.id)) ? picked : (isViewer ? myClients[0] : picked))
    : picked
  const idx = curPicked ? Math.max(0, baseClients.findIndex((c) => c.id === curPicked.id)) : 0

  return (
    <div className="shell">
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}
      <aside className={`side ${navOpen ? 'open' : ''}`}>
        <div className="brand"><div className="logo logo-360"><span>360</span></div><div><h1 className="brand-name">Caalano<span className="b360">360</span></h1><p>360° Reporting</p></div><button className="side-close" onClick={() => setNavOpen(false)} aria-label="Close menu">✕</button></div>
        <nav className="nav">
          {!isViewer && <>
            <button className={curView === 'overview' ? 'active' : ''} onClick={() => go('overview')}><span className="ic">◎</span>Agency Overview</button>
            <button className={curView === 'trends' ? 'active' : ''} onClick={() => go('trends')}><span className="ic">📈</span>Daily Performance</button>
            <button className={curView === 'weekly' ? 'active' : ''} onClick={() => go('weekly')}><span className="ic">🚦</span>Weekly Traffic Light</button>
            <button className={curView === 'cockpit' ? 'active' : ''} onClick={() => go('cockpit')}><span className="ic">🎬</span>Creative Cockpit</button>
            <button className={curView === 'insights' ? 'active' : ''} onClick={() => go('insights')}><span className="ic">📡</span>Meta Insights</button>
            <button className={curView === 'update' ? 'active' : ''} onClick={() => go('update')}><span className="ic">✉️</span>Client Update</button>
          </>}
          {isViewer && <>
            <div className="nav-lab">My reports</div>
            {myClients.length ? myClients.map((c) => <button key={c.id} className={curView === 'clients' && curPicked && curPicked.id === c.id ? 'active' : ''} onClick={() => openClient(c)}><span className="ic">▸</span>{c.name}</button>) : <div className="nav-empty">No reports assigned yet — your admin will set these up.</div>}
          </>}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button className={`settings-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><span className="ic">⚙</span>Settings</button>
          <button className="settings-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><span className="ic">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          {authUser && <div className="side-user"><div className="side-user-who"><span className="side-user-av">{(authUser.name || authUser.email || '?').trim().charAt(0).toUpperCase()}</span><div className="side-user-txt"><b>{authUser.name || authUser.email}</b><span>{ROLE_LABEL[authUser.role] || authUser.role}</span></div></div><button className="side-user-out" onClick={onLogout} title="Sign out">Sign out</button></div>}
          <div className="foot-build" title={`Caalano360 v${APP_VERSION} · Build ${__BUILD_TIME__}${__COMMIT_REF__ ? ` · commit ${__COMMIT_REF__}` : ''} · see CHANGELOG.md`}><b>v{APP_VERSION}</b> · deployed {fmtBuildTime(__BUILD_TIME__)}{__COMMIT_REF__ ? ` · ${__COMMIT_REF__}` : ''}</div>
        </div>
      </aside>

      <main className="main">
        <div className="mtop">
          <button className="burger" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <div className="logo logo-360 sm"><span>360</span></div>
          <b className="mtop-name">Caalano<span className="b360">360</span></b>
        </div>
        <div className="head">
          <div>
            <h2>{curView === 'overview' ? 'Agency Overview' : curView === 'trends' ? 'Daily Performance' : curView === 'weekly' ? 'Weekly Traffic Light' : curView === 'cockpit' ? 'Creative Cockpit' : curView === 'insights' ? 'Meta Insights' : curView === 'update' ? 'Client Update' : curView === 'settings' ? 'Settings' : isViewer ? 'Your report' : 'Clients'}</h2>
            <p>{curView === 'overview' ? 'Blended paid performance across all clients, live for the selected range.' : curView === 'trends' ? 'Rolling 3 / 7 / 14 / 21 / 28-day performance per client, each vs the prior equal window.' : curView === 'weekly' ? 'One client at a time, reported Monday-Sunday by ISO week - spend pacing, leads, appointments and wins vs KPI.' : curView === 'cockpit' ? 'Every creative for a client, with performance, categorisation and AI strategy.' : curView === 'insights' ? 'Everything Meta-derived in one place - delivery health, creative fatigue and more, across every active Meta client.' : curView === 'update' ? 'Generate a client-ready account update (WhatsApp + email) for the selected range.' : curView === 'settings' ? (isViewer ? 'Your account.' : 'Clients, key events, KPI targets and campaign links - saved to the server and shared across your team.') : isViewer ? 'Your live reporting for the selected range.' : 'Open any client for their Overall, CRM, Meta and Google workspace.'}</p>
          </div>
          <div className="spacer" />
          {curView !== 'settings' && <DateRange range={range} onChange={setRange} busy={agency.status === 'loading'} />}
          <button className="refresh-btn" title="Refresh live data" onClick={() => setRefreshKey((k) => k + 1)}><span className={agency.status === 'loading' ? 'spin sm' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh</button>
        </div>
        <ErrorBoundary key={curView + '|' + (curPicked && curPicked.id || '')} onHome={() => { setPicked(null); setView(isViewer ? 'clients' : 'overview') }}>
          {curView === 'overview' && !isViewer && <Overview rows={rows} currency={data.currency} periodLabel={rangeLabel(range)} live={agency.status === 'ok'} alerts={agency.data && agency.data.alerts} range={range} nonce={refreshKey} onPick={(c) => { setPicked(c); setView('clients') }} />}
          {curView === 'trends' && !isViewer && <TrendsTab rows={rows} currency={data.currency} nonce={refreshKey} onPick={(c) => { setPicked(c); setView('clients') }} />}
          {curView === 'weekly' && !isViewer && <WeeklyTab rows={rows} currency={data.currency} nonce={refreshKey} />}
          {curView === 'cockpit' && !isViewer && <CreativeCockpitPage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} authUser={authUser} />}
          {curView === 'insights' && !isViewer && <MetaInsightsPage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} />}
          {curView === 'update' && !isViewer && <ClientUpdatePage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} />}
          {curView === 'settings' && <SettingsPage config={cfgMerged} enabled={enabled} setEnabled={setEnabled} currency={data.currency} authUser={authUser} authEnabled={authEnabled} onPick={(c) => { const full = baseClients.find((x) => x.id === c.id) || c; setPicked(full); setView('clients') }} />}
          {curView === 'clients' && curPicked && <ClientWorkspace client={curPicked} index={idx} data={data} config={cfgMerged} range={range} nonce={refreshKey} authUser={authUser} onBack={isViewer ? null : () => { setPicked(null); setView('overview') }} />}
          {curView === 'clients' && !curPicked && <div className="card empty-deep"><div className="big">👋</div><b>No report is assigned to your account yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Your Caalano admin will assign your client dashboard shortly.</p></div>}
        </ErrorBoundary>
      </main>
    </div>
  )
}

// Auth gate. Decides between the login/setup/accept screens and the dashboard.
// When the login system is disabled (AUTH_SECRET unset) it renders the dashboard
// straight through, preserving the app's previous single-password behaviour.
export default function App() {
  const [auth, setAuth] = useState({ status: 'loading' })
  const inviteToken = (() => { try { return new URLSearchParams(window.location.search).get('invite') } catch { return null } })()
  const check = () => authApi('me').then((r) => {
    if (!r || r.ok === false && r.enabled === false) setAuth({ status: 'ready', enabled: false, user: null })
    else if (r.enabled === false) setAuth({ status: 'ready', enabled: false, user: null })
    else setAuth({ status: 'ready', enabled: true, user: r.user || null, needsSetup: !!r.needsSetup })
  }).catch(() => setAuth({ status: 'ready', enabled: false, user: null }))
  useEffect(() => { check() }, [])
  const clearInvite = () => { try { window.history.replaceState({}, '', window.location.pathname) } catch {} }
  const onSignedIn = (user) => { clearInvite(); setAuth({ status: 'ready', enabled: true, user, needsSetup: false }) }
  const onLogout = () => { authApi('logout', { method: 'POST' }).finally(() => setAuth({ status: 'ready', enabled: true, user: null, needsSetup: false })) }

  if (auth.status === 'loading') return <div className="auth-screen"><div className="auth-card"><Spinner label="Loading…" /></div></div>
  // Accept-invite deep link takes priority (a signed-out invitee, or a new
  // person on a shared machine, should always land on the invite flow).
  if (auth.enabled && inviteToken && !auth.user) return <AcceptInvite token={inviteToken} onSignedIn={onSignedIn} />
  if (auth.enabled && auth.needsSetup) return <SetupAdmin onSignedIn={onSignedIn} />
  if (auth.enabled && !auth.user) return <LoginForm onSignedIn={onSignedIn} />
  return <Dashboard authUser={auth.user} authEnabled={auth.enabled} onLogout={onLogout} />
}
