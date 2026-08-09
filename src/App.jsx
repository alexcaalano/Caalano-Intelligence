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
const APP_VERSION = '3.155.0'
// Format the injected build timestamp in Australian local time (dashboard is
// AEST/AEDT), e.g. "20 Jul 2026, 1:32 pm". Falls back gracefully if unset.
function fmtBuildTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return iso || 'unknown' }
}
const AVATAR = ['#6d5efc', '#12b886', '#4f7cff', '#f5a524', '#ec4899', '#0ea5e9', '#f0435b', '#8b5cf6']
const acolor = (i) => AVATAR[i % AVATAR.length]
const initials = (n) => String(n || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
// Google's favicon service — a reliable logo source for any domain.
const FAVICON = (domain, sz = 64) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}`
// Bare hostname (no scheme / www / path) from a possibly-messy website string.
const domainOf = (url) => { try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '') } catch { return null } }
// Resolve a client's brand-logo image URL, in priority order:
//   1. manual override (Settings) · 2. GHL uploaded logo · 3. website favicon.
// Returns null when there's nothing to show, so the avatar falls back to initials.
function clientLogoSrc(id, sz = 64) {
  const rec = (id && SETTINGS.logos && SETTINGS.logos[id]) || null
  if (!rec) return null
  if (rec.logo) return rec.logo
  if (rec.logoUrl) return rec.logoUrl
  const d = rec.website ? domainOf(rec.website) : null
  return d ? FAVICON(d, sz) : null
}
// Shared client avatar: real brand logo when we have one, else coloured initials.
// `id` drives the logo lookup; `i` the fallback colour; `name` the initials.
function Avatar({ id, name, i = 0, sm = false, className = '' }) {
  const [failed, setFailed] = React.useState(false)
  const src = failed ? null : clientLogoSrc(id, sm ? 48 : 64)
  const cls = `avatar${sm ? ' sm' : ''}${className ? ' ' + className : ''}`
  if (src) return <span className={`${cls} avatar-img`}><img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /></span>
  return <span className={cls} style={{ background: acolor(i) }}>{initials(name)}</span>
}
// Logo store helpers (Settings → business logos). Manual override + auto-synced
// website/logoUrl from Caalano Systems live under SETTINGS.logos[clientId].
function loadLogo(clientId) { return (SETTINGS.logos && SETTINGS.logos[clientId]) || {} }
function saveLogo(clientId, patch) {
  const next = { ...loadLogo(clientId), ...patch }
  SETTINGS.logos = { ...(SETTINGS.logos || {}), [clientId]: next }
  writeLS(LOGOS_KEY, SETTINGS.logos); saveSettingsRemote({ logos: { [clientId]: next } }); bumpSettings()
}
// Merge a batch of synced { clientId: { website, logoUrl } } profiles, preserving
// any manual override already stored, and persist in one write.
function mergeLogos(map) {
  if (!map || !Object.keys(map).length) return
  const next = { ...(SETTINGS.logos || {}) }
  for (const id in map) next[id] = { ...(next[id] || {}), website: map[id].website || (next[id] && next[id].website) || null, logoUrl: map[id].logoUrl || (next[id] && next[id].logoUrl) || null }
  SETTINGS.logos = next
  writeLS(LOGOS_KEY, next); saveSettingsRemote({ logos: next }); bumpSettings()
}
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
      groups.push({ label: '📅 ' + k.label, kind: 'calendar', span: 6 })
      const ctx = { g: i, refs: k.refs || [k.ref], stage: k.stage, pipeline: k.pipeline, names: calNames, event: k.label }
      cols.push({ key: `e${i}b`, sub: 'Booked', ty: 'count', metric: 'calBooked', gfirst: true, title: `Bookings for ${k.label}`, ...ctx })
      cols.push({ key: `e${i}br`, sub: 'Book Rate', ty: 'rate', metric: 'calBookRate', title: 'Booked ÷ leads', ...ctx })
      cols.push({ key: `e${i}cb`, sub: 'Cost / Booked', ty: 'cost', metric: 'calCost', title: `Spend ÷ ${k.label} bookings`, ...ctx })
      cols.push({ key: `e${i}o`, sub: 'Occurred', ty: 'count', metric: 'calOccurred', title: `Appointments whose date has passed (occurred) for ${k.label}`, ...ctx })
      cols.push({ key: `e${i}s`, sub: 'Shown', ty: 'count', metric: 'calShown', title: `Showed for ${k.label}`, ...ctx })
      cols.push({ key: `e${i}sr`, sub: 'Show Rate', ty: 'rate', metric: 'calShowRate', title: 'Shown ÷ occurred (past-date appointments only)', ...ctx })
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
        const b = calSum(c.refs, 'cals'), sh = calSum(c.refs, 'calsShown'), oc = calSum(c.refs, 'calsOccurred')
        const stageN = stg(c.stage, c.pipeline)
        const fromStage = Math.max(0, stageN - b.t)
        g = agg[c.g] = { booked: b.t + fromStage, fromCal: b.t, fromStage, bookedPer: b.per, occurred: oc.t, occurredPer: oc.per, shown: sh.t, shownPer: sh.per }
      }
      if (m === 'calBooked') { f[c.key] = g.booked; f[c.key + 'B'] = { per: g.bookedPer, fromStage: g.fromStage } }
      else if (m === 'calBookRate') { f[c.key] = L ? (g.booked / L) * 100 : null }
      else if (m === 'calCost') { f[c.key] = g.booked && spend ? spend / g.booked : null; f[c.key + 'N'] = g.booked }
      else if (m === 'calOccurred') { f[c.key] = g.occurred; f[c.key + 'B'] = { per: g.occurredPer } }
      else if (m === 'calShown') { f[c.key] = g.shown; f[c.key + 'B'] = { per: g.shownPer } }
      // Show rate on OCCURRED appointments only (past their date), not all bookings.
      else if (m === 'calShowRate') { f[c.key] = g.occurred ? (g.shown / g.occurred) * 100 : null }
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
// Structured breakdown rows for a calendar Booked / Shown cell (styled popup).
function keBreakRows(B, names) {
  const rows = []
  if (B && B.per) for (const id in B.per) rows.push({ label: (names && names.get && names.get(id)) || 'Calendar', value: B.per[id] })
  if (B && B.fromStage) rows.push({ label: 'Pipeline stage (fallback)', value: B.fromStage, muted: true })
  return rows
}
// Styled hover popup for a Caalano360 count cell — replaces the plain browser
// tooltip with the same card look used across the app (header · per-source rows).
function KeCellPop({ children, title, total, rows, note }) {
  if ((!rows || !rows.length) && !note) return children
  return (
    <HoverPop className="ke-hp" render={() => (
      <span className="hp-body">
        <span className="hp-t">{title} · {fmtNumber(total || 0)}</span>
        {(rows || []).map((r, i) => <span className="hp-r" key={i}><span className={`hp-lbl${r.muted ? '' : ' primary'}`}>{r.label}</span><span className="hp-val">{fmtNumber(r.value)}</span></span>)}
        {note ? <span className="hp-note">{note}</span> : null}
      </span>
    )}>{children}</HoverPop>
  )
}
// Renders the green Caalano360 cells for a row, driven by the column descriptor.
function o360Cells(r, currency, cols) {
  const D = cols || LEGACY_DESC; const C = D.cols
  if (!r || !r._has360) return <>{C.map((c, i) => <td key={c.key} className={`c360-col dim${i === 0 ? ' c360-first' : ''}${c.gfirst && i > 0 ? ' c360-gfirst' : ''}`}>-</td>)}</>
  const money = (v) => fmtCurrency(v, currency)
  return <>{C.map((c, i) => {
    const cn = `c360-col${i === 0 ? ' c360-first' : ''}${c.gfirst && i > 0 ? ' c360-gfirst' : ''}`
    const v = r[c.key]; const m = c.metric
    // Calendar Booked: number + (Np) fallback marker + styled hover breakdown.
    if (m === 'calBooked') {
      const B = r[c.key + 'B'] || {}
      const rows = keBreakRows(B, c.names)
      const inner = <>{fmtNumber(v || 0)}{B.fromStage ? <span className="c360-infer"> ({fmtNumber(B.fromStage)}p)</span> : null}</>
      return <td key={c.key} className={cn}>{rows.length ? <KeCellPop title="Booked" total={v} rows={rows}>{inner}</KeCellPop> : inner}</td>
    }
    if (m === 'calShown') {
      const B = r[c.key + 'B'] || {}
      const rows = keBreakRows(B, c.names)
      return <td key={c.key} className={cn}>{rows.length ? <KeCellPop title="Shown" total={v} rows={rows}>{fmtNumber(v || 0)}</KeCellPop> : fmtNumber(v || 0)}</td>
    }
    // Won count: flag deals marked won with no value so the team can fix them.
    if (m === 'wonCount') {
      const B = r[c.key + 'B'] || {}; const nv = (B.noVal && B.noVal.length) || 0
      const inner = <>{fmtNumber(v || 0)}{nv ? <span className="c360-warn"> ({nv}⚠)</span> : null}</>
      return <td key={c.key} className={cn}>{nv ? <KeCellPop title="Won" total={v} rows={[{ label: 'With deal value', value: (v || 0) - nv }, { label: '⚠ No deal value', value: nv, muted: true }]} note={`No value: ${B.noVal.slice(0, 12).join(', ')}${B.noVal.length > 12 ? '…' : ''}`}>{inner}</KeCellPop> : inner}</td>
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
  if (attr.status === 'err') msg = `the attribution request failed${attr.error ? ` — ${attr.error}` : ''}. Try Refresh.`
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
function Kpi({ label, value, tag, cur, prev, goodWhenDown, flat, onClick }) {
  const clickable = typeof onClick === 'function'
  return (
    <div className={`card kpi${clickable ? ' kpi-click' : ''}`} onClick={onClick} {...(clickable ? { role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}>
      {clickable ? <span className="kpi-go">›</span> : null}
      <div className="top"><span className="label">{label}</span>{tag && <span className={`tag ${tag.toLowerCase()}`}>{tag}</span>}</div>
      <div className="value">{value}</div>
      {flat ? <span className="flat">{flat}</span> : (cur != null && prev != null) ? <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} /> : null}
    </div>
  )
}

/* ============ Agency live rollup ============ */
// Fetch business logos (website + uploaded logo) from Caalano Systems and merge
// them into Settings. Skipped once cached unless force=true (the Settings sync
// button). Manual per-client overrides are preserved by mergeLogos.
function syncLogos({ force = false } = {}) {
  if (!force && SETTINGS.logos && Object.keys(SETTINGS.logos).length) return Promise.resolve(false)
  return fetch(`/.netlify/functions/windsor?scope=logos${force ? `&_r=${Date.now()}` : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && j.logos) { mergeLogos(j.logos); return true } return false })
    .catch(() => false)
}
// One-time logo sync once settings have hydrated, so avatars show real brand
// marks. No-op on later loads because the result is persisted in Settings.
function useClientLogos() {
  useSettingsSync()
  const done = React.useRef(false)
  useEffect(() => {
    if (done.current || !SETTINGS.loaded) return
    done.current = true
    syncLogos()
  })
}

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
  // Headline Revenue / ROAS now reconcile with the leaderboard below: both sum
  // the exact same per-client CRM revenue (the leaderboard's live "all"-channel
  // figure from the ovrow feed), so the top total always equals the sum of the
  // rows. The old headline pulled from a separate agency feed with a different
  // won-revenue basis, so a finance client's loan-sized deal value could make
  // the two disagree by millions. `ov` is shared down to AgencyComparison so
  // there's a single fetch.
  const ov = useOvRows(rows, range, nonce)
  const crmIds = rows.filter((r) => r.c.ghl).map((r) => r.id)
  let totalRev = 0, crmReady = 0
  for (const id of crmIds) {
    const o = ov[id]
    if (o && o.status === 'ok' && o.cur && o.cur.all) { totalRev += o.cur.all.revenue || 0; crmReady++ }
  }
  const crmPending = crmIds.length - crmReady
  const roas = t.spend ? totalRev / t.spend : 0
  return (
    <>
      <div className="section-title">Paid performance <span className="sub">· Meta + Google · {periodLabel} · {live ? 'live' : 'snapshot fallback'}</span></div>
      <div className="grid kpis kpis-6">
        <Kpi label="Ad Spend" tag="ADS" value={fmtCurrency(t.spend, currency)} />
        <Kpi label="Leads & Conversions" tag="ADS" value={fmtNumber(t.conversions)} />
        <Kpi label="Blended Cost / Result" tag="ADS" value={fmtCurrency(cpl, currency)} />
        <Kpi label="Blended CTR" tag="ADS" value={fmtPct(ctr, 2)} />
        <Kpi label="Revenue Generated" tag="CRM" value={crmIds.length ? (crmReady ? fmtCurrency(totalRev, currency) : '…') : '-'} flat={crmPending > 0 ? `${crmReady}/${crmIds.length} clients loaded` : undefined} />
        <Kpi label="ROAS" tag="CRM" value={crmReady && t.spend ? `${roas.toFixed(2)}×` : '-'} flat={crmPending > 0 ? 'loading CRM…' : undefined} />
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
      <AgencyComparison rows={rows} currency={currency} range={range} nonce={nonce} onPick={onPick} ov={ov} />
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
            <td><div className="client-cell"><Avatar id={r.id} name={r.name} i={r.i} /><div>{r.name}<small>{r.industry}</small></div></div></td>
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
// Styled popup for the campaigns / ad-sets Results cell — lists every conversion
// action (primary highlighted) with a total, replacing the plain browser tooltip.
function ResBreakdownPop({ children, breakdown, primary }) {
  const bd = breakdown || []
  const total = bd.reduce((s, x) => s + (x.count || 0), 0)
  return (
    <HoverPop className="res-hp" render={() => (
      <span className="hp-body">
        <span className="hp-t">All conversion actions{primary ? ` · primary = ${primary}` : ''}</span>
        {bd.map((x, i) => <span className="hp-r" key={i}><span className={`hp-lbl${x.label === primary ? ' primary' : ''}`}>{x.label === primary ? '★ ' : ''}{x.label}</span><span className="hp-val">{fmtNumber(x.count)}</span></span>)}
        <span className="hp-r hp-tot"><span>Total actions</span><span className="hp-val">{fmtNumber(total)}</span></span>
      </span>
    )}>{children}</HoverPop>
  )
}
const OV_FILTERS = [['all', 'All'], ['paid', 'Paid'], ['nonpaid', 'Non-Paid']]
function AgencyComparison({ rows, currency, range, onPick, ov }) {
  const [f, setF] = useState('all')
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
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
              <td className="ov-name"><div className="client-cell"><Avatar id={r.id} name={r.name} i={r.i} /><div><span className="ov-name-row">{r.name}<MaturityBadge clientId={r.id} crmAvg={ok ? o.cur.avgCloseDays : null} sample={ok ? o.cur.avgCloseSample : 0} range={range} size="sm" /></span><small>{r.industry}</small></div></div></td>
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
          <select value={cid || ''} onChange={(e) => setCid(e.target.value)}>{[...clients].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
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
function Sc({ label, value, cur, prev, goodWhenDown, kpi, flat }) {
  return <div className="sc"><div className="sc-l">{label}</div><div className="sc-v">{value}</div><ScDelta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />{flat ? <div className="sc-flat">{flat}</div> : null}{kpi && <div className={`sc-kpi ${kpi.cls}`}>{kpi.cls === 'good' ? '✓' : kpi.cls === 'bad' ? '✗' : '◎'} {kpi.text}</div>}</div>
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
  const [kePipe, setKePipe] = useState(null) // local pipeline pick for the Key events funnel (null = follow default)
  useEffect(() => { setKePipe(null) }, [pipe]) // reset to default when the top filter changes
  const prevAttr = usePrevAttr(clientId, range, nonce) // previous-period attribution for vs-prev deltas
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
  useEffect(() => { setCrePage(0) }, [sel, selAdset, selCreative, selForm, creSort, pipe])
  if (!deep?.meta) return <EmptyDeep channel="Meta Ads" />
  // When a pipeline is picked, scope the whole ad side (Cost / Impr / Reach /
  // campaigns / ad sets / creatives / daily) to that pipeline's linked campaigns
  // — a Settings campaign→pipeline link first, else a name match — so the ad
  // numbers match the green CRM columns instead of staying whole-account.
  const inPipe = (campName) => pipe === 'all' || pipeOfCampaign(clientId, campName, allPipes) === pipe
  const m = pipe === 'all' ? deep.meta : scopeMetaToPipe(deep.meta, inPipe)
  const scopedEmpty = pipe !== 'all' && !(m.campaigns || []).length
  const A = pipeAttr && pipeAttr.data && pipeAttr.data.attribution
  const has360 = !!A
  const keList = keyEventsForPipe(loadKeyEvents(clientId), pipe)
  // Per-pipeline ad spend (whole account) → the Key events funnel defaults to the
  // highest-spend pipeline; a local dropdown on the panel switches it. When the
  // top filter is on a pipeline, the funnel follows it.
  const pipeSpend = {}
  for (const c of (deep.meta.campaigns || [])) { const pid = pipeOfCampaign(clientId, c.name, allPipes); if (pid) pipeSpend[pid] = (pipeSpend[pid] || 0) + (c.spend || 0) }
  const topSpendPipe = Object.keys(pipeSpend).sort((a, b) => pipeSpend[b] - pipeSpend[a])[0] || null
  const kePipeEff = kePipe != null ? kePipe : (pipe !== 'all' ? pipe : (topSpendPipe || 'all'))
  const keListFunnel = keyEventsForPipe(loadKeyEvents(clientId), kePipeEff)
  // Green Caalano360 columns: the client's key events (cost per each) when
  // configured, else the legacy Booked/Shown/Won block. Ordered by where each
  // event sits in the pipeline (calendars via their linked stage).
  const stagePos = stagePosMap(A && A.channels && A.channels.all ? A.channels.all.pipelines : [])
  const calNames = new Map(((A && A.appointments && A.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = buildO360Cols(keList, stagePos, calNames)
  // Per-creative key-event columns: each creative card's funnel is scoped to the
  // pipeline of the campaign that creative ran in, so it only shows that campaign's
  // key events (not every pipeline's). Memoized per pipeline.
  const creColsCache = {}
  const creColsFor = (campName) => {
    const pid = pipeOfCampaign(clientId, campName, allPipes)
    const k = pid || '_all'
    if (!creColsCache[k]) creColsCache[k] = buildO360Cols(keyEventsForPipe(loadKeyEvents(clientId), pid || 'all'), stagePos, calNames)
    return { cols: creColsCache[k], pid }
  }
  const oCamp = aliasedOutcomeMap(clientId, 'campaign', A && A.byCampaign)
  // Ad sets are tagged in the CRM as utm_medium (e.g. "CDas_06_Broad_National"),
  // not utm_term - so match ad-set rows against byMedium. Aliases fold renamed
  // ad sets' old-UTM leads into the current name.
  const oAdset = aliasedOutcomeMap(clientId, 'medium', A && A.byMedium)
  const oCre = aliasedOutcomeMap(clientId, 'content', A && A.byCreative)
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
  // With a pipeline selected, m.ads is already scoped to its campaigns, so a form
  // only belongs to this pipeline if at least one of its creatives matched a
  // scoped ad (_camps is built from those). Hide the rest so forms track the filter.
  const formPerfShown = sortRows(formPerf.filter(formInSel).filter((f) => pipe === 'all' || (f._camps && f._camps.size > 0)), formSort)
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
  // Enrich + sort the full creative set once (default Spend, click a header to
  // re-sort), then page it so the table AND the visual cards show the same 10.
  const adsRows = sortRows(adsFull.map((a) => ({ ...a, linkCtr: rate(a.linkClicks, a.impressions), hook: a.type === 'Video' ? rate(a.videoViews, a.impressions) : null, cvr: rate(a.leads, a.linkClicks), cpl: a.leads ? a.spend / a.leads : null, ...o360Fields(oCre.get(unorm(a.name)), a.spend, a.leads, o360cols) })), creSort)
  const CRE_PAGE = 10
  const creTotalPages = Math.max(1, Math.ceil(adsRows.length / CRE_PAGE))
  const crePageC = Math.min(crePage, creTotalPages - 1)
  const adsPage = adsRows.slice(crePageC * CRE_PAGE, crePageC * CRE_PAGE + CRE_PAGE)
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
      oc = oc || { booked: 0, shown: 0, shownStage: 0, cancelled: 0, won: 0, revenue: 0, cals: {}, calsShown: {}, calsOccurred: {}, stages: {} }
      oc.booked += o.booked; oc.shown += o.shown; oc.shownStage += o.shownStage || 0; oc.cancelled += o.cancelled || 0; oc.won += o.won; oc.revenue += o.revenue
      if (o.cals) for (const k in o.cals) oc.cals[k] = (oc.cals[k] || 0) + o.cals[k]
      if (o.calsShown) for (const k in o.calsShown) oc.calsShown[k] = (oc.calsShown[k] || 0) + o.calsShown[k]
      if (o.calsOccurred) for (const k in o.calsOccurred) oc.calsOccurred[k] = (oc.calsOccurred[k] || 0) + o.calsOccurred[k]
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
    const cfg = keyEventRows(keListFunnel, rmap, calCountMap(A, 'meta'), stagePos, meCh ? meCh.totals.won : 0)
    if (cfg.length) return cfg
    if (!meCh) return []
    const tt = meCh.totals
    return [{ label: 'Leads', count: tt.leads, kind: 'stage' }, { label: 'Bookings', count: tt.booked, kind: 'stage' }, { label: 'Shown', count: tt.shown, kind: 'stage' }, { label: 'Won', count: tt.won, kind: 'stage' }]
  })()
  // Denominator = the funnel pipeline's own Meta leads (so % leads is per-pipeline),
  // or account Meta leads when showing all.
  const mePipeLeads = kePipeEff !== 'all' && meCh ? ((meCh.pipelines || []).find((p) => p.id === kePipeEff) || {}).leads : null
  const meTotal = Math.max(1, mePipeLeads != null ? mePipeLeads : (meCh ? meCh.totals.leads : 0))
  return (
    <div ref={scrollRootRef}>
      <AttrDiag attr={attr} />
      {allPipes.length > 1 && <div className="pipe-filter-bar"><PipelineFilter pipelines={allPipes} value={pipe} onChange={setPipe} loading={pipeLoading} />{pipe !== 'all' && <span className="pipe-filter-note">Scoped to this pipeline's linked campaigns · reach &amp; frequency are approximate (summed across campaigns) · link campaigns in Settings → Campaign links</span>}</div>}
      {scopedEmpty && <div className="alias-warn" style={{ marginTop: 8 }}><b>No campaigns are linked to this pipeline.</b> Link this pipeline's campaigns in <b>Settings → this client → Campaign links</b> (or rename them to match) so their spend and results show here. The green CRM columns above still reflect the pipeline.</div>}
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
      <div className="sc-sec-lab"><span className="sc-sec-t"><img src={FAVICON('meta.com')} alt="" width="13" height="13" /> Meta metrics</span><span className="sc-sec-sub">delivery &amp; cost from the ad platform</span></div>
      <div className="scorecard sc-fit">
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
      </div>
      {has360 && crmTot && (() => {
        // Caalano360 (blended) metrics. Each tile: count · vs-prev delta · % of the
        // pipeline's leads + cost beneath. Multi-pipeline clients are two
        // near-independent business units, so these break out one group PER
        // pipeline by default (highest ad-spend first); single-pipeline shows one.
        const rmap = reachedByStage(meCh ? (meCh.pipelines || []) : [])
        const calMap = calCountMap(A, 'meta')
        const pipeMeta = (meCh && meCh.pipelines) || []
        const crmOf = (pid) => (pipeMeta.find((p) => p.id === pid) || {}).crm || null
        // Previous period equivalents (from the prev-attribution fetch).
        const prevMeCh = prevAttr && prevAttr.channels && prevAttr.channels.meta
        const prevRmap = reachedByStage(prevMeCh ? (prevMeCh.pipelines || []) : [])
        const prevCalMap = prevAttr ? calCountMap(prevAttr, 'meta') : null
        const prevPipeMeta = (prevMeCh && prevMeCh.pipelines) || []
        const prevCrmOf = (pid) => pid ? (((prevPipeMeta.find((p) => p.id === pid) || {}).crm) || null) : (prevMeCh ? prevMeCh.totals : null)
        const evMap = (rows) => { const m = {}; for (const r of rows) if (r.kind !== 'lead') m[r.label] = r.count; return m }
        // Previous-period ad spend per pipeline, so cost-per-event can show a
        // vs-prev efficiency chip (cost down = green) alongside the volume delta.
        const pipeSpendPrev = {}
        for (const c of (deep.meta.campaigns || [])) { const pid = pipeOfCampaign(clientId, c.name, allPipes); if (pid && c.prev) pipeSpendPrev[pid] = (pipeSpendPrev[pid] || 0) + (c.prev.spend || 0) }
        const totalSpendPrev = (deep.meta.prev && deep.meta.prev.spend) || Object.values(pipeSpendPrev).reduce((s, v) => s + v, 0)
        const flatLine = (parts) => { const ps = parts.filter(Boolean); return ps.length ? <span className="sc-flat-line">{ps.map((p, i) => <React.Fragment key={i}>{i ? <span className="sc-flat-sep">·</span> : null}{p}</React.Fragment>)}</span> : null }
        const groupFor = (pid, label, spendP, spendPrevP, crmP, leadsP, sub) => {
          const keListP = keyEventsForPipe(loadKeyEvents(clientId), pid || 'all')
          const rowsP = keyEventRows(keListP, rmap, calMap, stagePos, crmP ? crmP.won : (meCh ? meCh.totals.won : 0)).filter((r) => r.kind !== 'lead' && r.count > 0)
          const pCrm = prevCrmOf(pid) || {}
          const pEv = prevMeCh ? evMap(keyEventRows(keListP, prevRmap, prevCalMap, stagePos, pCrm.won || 0)) : {}
          const booked = crmP ? crmP.booked : 0, won = crmP ? crmP.won : 0, rev = (crmP ? crmP.revenue : 0) || 0
          const hasPrev = !!prevMeCh
          const pct = (n) => leadsP ? `${Math.round((n / leadsP) * 100)}% leads` : null
          // "$X / unit" + a vs-prev efficiency chip (cheaper = green).
          const perUnit = (unit, count, prevCount) => {
            if (!spendP || !count) return null
            const cur = spendP / count, prev = (spendPrevP && prevCount) ? spendPrevP / prevCount : null
            return <span className="sc-cost">{fmtCurrency(cur, currency)}/{unit}{(hasPrev && prev) ? <MiniDelta cur={cur} prev={prev} goodWhenDown /> : null}</span>
          }
          const roas = spendP ? rev / spendP : null
          return (
            <React.Fragment key={label}>
              <div className="sc-sec-lab"><span className="sc-sec-t c360"><span className="c360-dot" /> {label}</span><span className="sc-sec-sub">{sub}</span></div>
              <div className="scorecard sc-fit">
                <Sc label="Leads" value={fmtNumber(leadsP)} cur={hasPrev ? leadsP : null} prev={hasPrev ? (pCrm.leads || 0) : null} flat={flatLine(['100%', perUnit('lead', leadsP, pCrm.leads)])} />
                <Sc label="Scheduled Appts" value={fmtNumber(booked)} cur={hasPrev ? booked : null} prev={hasPrev ? (pCrm.booked || 0) : null} flat={flatLine([pct(booked), perUnit('appt', booked, pCrm.booked)])} />
                {rowsP.map((r, i) => { const showR = r.kind === 'calendar' && r.occurred ? `${Math.round((r.shown / r.occurred) * 100)}% show` : null; return <Sc key={i} label={r.label.replace(/^📅 /, '')} value={fmtNumber(r.count)} cur={hasPrev ? r.count : null} prev={hasPrev ? (pEv[r.label] || 0) : null} flat={flatLine([pct(r.count), perUnit('event', r.count, pEv[r.label]), showR])} /> })}
                <Sc label="Won" value={fmtNumber(won)} cur={hasPrev ? won : null} prev={hasPrev ? (pCrm.won || 0) : null} flat={flatLine([pct(won), perUnit('won', won, pCrm.won)])} />
                <Sc label="Revenue" value={fmtCurrency(rev, currency)} cur={hasPrev ? rev : null} prev={hasPrev ? (pCrm.revenue || 0) : null} flat={roas == null ? null : `${roas.toFixed(2)}× ROAS`} />
              </div>
            </React.Fragment>
          )
        }
        if (allPipes.length > 1) {
          const pids = allPipes.map((p) => p.id).filter((pid) => (pipeSpend[pid] || 0) > 0 || crmOf(pid)).sort((a, b) => (pipeSpend[b] || 0) - (pipeSpend[a] || 0))
          if (pids.length) return pids.map((pid) => { const cp = crmOf(pid); return groupFor(pid, (allPipes.find((p) => p.id === pid) || {}).name || 'Pipeline', pipeSpend[pid] || 0, pipeSpendPrev[pid] || 0, cp, cp ? cp.leads : 0, `${fmtCurrency(pipeSpend[pid] || 0, currency)} Meta spend · count · vs prev · cost/event`) })
        }
        return groupFor(null, 'Caalano360 metrics', m.totals ? m.totals.spend : t.spend, totalSpendPrev, crmTot, meCh ? meCh.totals.leads : 0, 'blended CRM outcomes vs Meta spend · count · vs prev · cost/event')
      })()}
      <div className="meta-split">
        {daily.length > 0 && <div className="card chart-card meta-split-col">
          <h3>Daily trend</h3><p className="cap">Spend, Leads and CPL by day{sel ? ` · ${sel}` : pipe !== 'all' ? ' · this pipeline' : ' · whole account'}</p>
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
          headerRight={allPipes.length > 1 ? <select className="kef-pipe-sel" value={kePipeEff} onChange={(e) => setKePipe(e.target.value)} title="Show the key-events funnel for one pipeline">
            <option value="all">All pipelines</option>
            {allPipes.map((p) => <option key={p.id} value={p.id}>{p.name}{pipeSpend[p.id] ? ` · ${fmtCurrency(pipeSpend[p.id], currency)}` : ''}</option>)}
          </select> : null}
          sub={`Meta-attributed leads through your key pipeline stages and booked calendars · cost per event = whole Meta spend ÷ count · ${kePipeEff === 'all' ? 'all pipelines' : ((allPipes.find((p) => p.id === kePipeEff) || {}).name || 'pipeline')}`}
          caveat={<>📅 = a booked calendar appointment (cost per booked call). Counts are opportunities the CRM attributes to Meta; cost per event divides the full Meta spend. {allPipes.length > 1 ? 'Use the dropdown to switch pipeline — it defaults to the highest ad-spend one. ' : ''}Configure which stages and calendars count in Settings → Key events.</>}
        />}
      </div>
      <div className="lvl-title">Campaigns <span className="sub">· {m.campaigns.length}{sel ? ` · filtered to "${sel}" (click to clear)` : ' · click a row to drill in'}{has360 ? ' · green = Caalano360 outcomes (UTM-matched) · Booked counts on the day the call was booked; (Nc) = later cancelled, (Np) = shown via pipeline stage · Book% = booked/leads, Show% = shown/booked, Win% = won/leads' : ''}</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={8} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={8} cols={o360cols} />}<tr><SortTh k="name" sort={campSort} on={onCampSort}>Campaign</SortTh><SortTh k="spend" sort={campSort} on={onCampSort}>Spend</SortTh><SortTh k="impressions" sort={campSort} on={onCampSort}>Impr.</SortTh><SortTh k="linkCtr" sort={campSort} on={onCampSort}>Link CTR</SortTh><SortTh k="hook" sort={campSort} on={onCampSort}>Hook</SortTh><SortTh k="results" sort={campSort} on={onCampSort}>Results</SortTh><SortTh k="cvr" sort={campSort} on={onCampSort}>CVR</SortTh><SortTh k="cpr" sort={campSort} on={onCampSort}>Cost/result</SortTh>{has360 && <O360Head sort={campSort} on={onCampSort} cols={o360cols} />}</tr></thead>
        <tbody>{sortRows(m.campaigns.filter((c) => !fCamp || fCamp.has(unorm(c.name))).map((c) => ({ ...c, linkCtr: rate(c.linkClicks, c.impressions), hook: c.videoViews ? rate(c.videoViews, c.impressions) : null, results: c.results != null ? c.results : c.leads, resType: c.resultType, cvr: rate(c.results != null ? c.results : c.leads, c.linkClicks), cpr: c.costPerResult != null ? c.costPerResult : (c.leads ? c.spend / c.leads : null), ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, o360cols) })), campSort).map((c) => (<tr key={c.name} className={sel === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCampaign(c.name)}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td className={gb(c.linkCtr, avgLinkCtr)}>{fmtPct(c.linkCtr, 2)}</td><td className={c.hook != null ? gb(c.hook, avgHook) : ''}>{c.hook != null ? fmtPct(c.hook, 1) : '-'}</td><td className="res-cell">{c.breakdown && c.breakdown.length ? <ResBreakdownPop breakdown={c.breakdown} primary={c.resType}><span className="res-n">{fmtNumber(c.results)}{c.breakdown.length > 1 ? <span className="res-more">+{c.breakdown.length - 1}</span> : null}</span>{c.resType ? <span className="res-ty">{c.resType}</span> : null}</ResBreakdownPop> : <><span className="res-n">{fmtNumber(c.results)}</span>{c.resType ? <span className="res-ty">{c.resType}</span> : null}</>}</td><td className={c.results ? gb(c.cvr, avgCvr) : ''}>{c.results ? fmtPct(c.cvr, 1) : '-'}</td><td className={c.cpr != null ? (c.cpr <= cpl ? 'good' : 'bad') : ''}>{c.cpr != null ? fmtCurrency(c.cpr, currency) : '-'}</td>{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Ad sets <span className="sub">· {adsets.length}{sel ? ` in "${sel}"` : ''} · click a row to drill into its creatives &amp; forms</span></div>
      <div className="table-wrap"><table className="o360-tbl"><O360ColGroup left={8} green={has360} cols={o360cols} /><thead>{has360 && <C360GrpRow left={8} cols={o360cols} />}<tr><SortTh k="name" sort={adsetSort} on={onAdsetSort}>Ad set</SortTh><SortTh k="spend" sort={adsetSort} on={onAdsetSort}>Spend</SortTh><SortTh k="impressions" sort={adsetSort} on={onAdsetSort}>Impr.</SortTh><SortTh k="linkCtr" sort={adsetSort} on={onAdsetSort}>Link CTR</SortTh><SortTh k="hook" sort={adsetSort} on={onAdsetSort}>Hook</SortTh><SortTh k="results" sort={adsetSort} on={onAdsetSort}>Results</SortTh><SortTh k="cvr" sort={adsetSort} on={onAdsetSort}>CVR</SortTh><SortTh k="cpr" sort={adsetSort} on={onAdsetSort}>Cost/result</SortTh>{has360 && <O360Head sort={adsetSort} on={onAdsetSort} cols={o360cols} />}</tr></thead>
        <tbody>{sortRows(adsets.map((c) => ({ ...c, linkCtr: rate(c.linkClicks, c.impressions), hook: c.videoViews ? rate(c.videoViews, c.impressions) : null, results: c.results != null ? c.results : c.leads, resType: c.resultType, cvr: rate(c.results != null ? c.results : c.leads, c.linkClicks), cpr: c.costPerResult != null ? c.costPerResult : (c.leads ? c.spend / c.leads : null), ...o360Fields(oAdset.get(unorm(c.name)), c.spend, c.leads, o360cols) })), adsetSort).map((c) => (<tr key={c.name} className={selAdset === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickAdset(c)}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td className={gb(c.linkCtr, avgLinkCtr)}>{fmtPct(c.linkCtr, 2)}</td><td className={c.hook != null ? gb(c.hook, avgHook) : ''}>{c.hook != null ? fmtPct(c.hook, 1) : '-'}</td><td className="res-cell">{c.breakdown && c.breakdown.length ? <ResBreakdownPop breakdown={c.breakdown} primary={c.resType}><span className="res-n">{fmtNumber(c.results)}{c.breakdown.length > 1 ? <span className="res-more">+{c.breakdown.length - 1}</span> : null}</span>{c.resType ? <span className="res-ty">{c.resType}</span> : null}</ResBreakdownPop> : <><span className="res-n">{fmtNumber(c.results)}</span>{c.resType ? <span className="res-ty">{c.resType}</span> : null}</>}</td><td className={c.results ? gb(c.cvr, avgCvr) : ''}>{c.results ? fmtPct(c.cvr, 1) : '-'}</td><td className={c.cpr != null ? (c.cpr <= cpl ? 'good' : 'bad') : ''}>{c.cpr != null ? fmtCurrency(c.cpr, currency) : '-'}</td>{has360 && o360Cells(c, currency, o360cols)}</tr>))}</tbody></table></div>
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
        <tbody>{adsPage.map((a) => (<tr key={a.name} className={selCreative === a.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCreative(a)}>
          <td title={a.name}><div className="cre-cell">{a.thumb ? <img className="cre-th" src={a.thumb} alt="" loading="lazy" onMouseEnter={showPrev(a.thumb)} onMouseMove={movePrev} onMouseLeave={hidePrev} onError={(e) => { e.target.style.display = 'none' }} /> : <span className="cre-th cre-th-none" />}<span className="cre-cell-nm">{a.name}</span></div></td><td>{a.type}</td><td>{fmtCurrency(a.spend, currency)}</td><td>{fmtNumber(a.impressions)}</td>
          <td className={gb(a.linkCtr, avgLinkCtr)}>{fmtPct(a.linkCtr, 2)}</td><td className={a.hook != null ? gb(a.hook, avgHook) : ''}>{a.hook != null ? fmtPct(a.hook, 1) : '-'}</td>
          <td>{fmtNumber(a.leads)}</td><td className={a.leads ? gb(a.cvr, avgCvr) : ''}>{a.leads ? fmtPct(a.cvr, 1) : '-'}</td>
          <td className={a.cpl != null ? (a.cpl <= cpl ? 'good' : 'bad') : ''}>{a.cpl != null ? fmtCurrency(a.cpl, currency) : '-'}</td>
          {has360 && o360Cells(a, currency, o360cols)}</tr>))}</tbody></table></div>
      <div className="cre-sub"><span>Visual previews</span><small>hover a thumbnail in the table above to enlarge, or browse the cards below</small></div>
      <div className="cre-grid">{adsPage.map((a) => {
        const acpl = a.leads ? a.spend / a.leads : 0
        const hook = a.type === 'Video' ? rate(a.videoViews, a.impressions) : null
        const lctr = rate(a.linkClicks, a.impressions), cvr = rate(a.leads, a.linkClicks)
        return (
          <div className="cre" key={a.name}>
            <div className="thumb"><span className="type">{a.type}</span>{a.igUrl && <a className="cre-play" href={a.igUrl} target="_blank" rel="noreferrer" title="View on Instagram">↗</a>}{a.thumb ? <img src={a.thumb} alt="" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={(e) => { e.target.closest('.thumb').classList.add('thumb-broken'); e.target.remove() }} /> : null}<span className="thumb-ph">{a.type === 'Video' ? '▶' : '🖼'}</span></div>
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
                const o = oCre.get(unorm(a.name))
                if (!o) return <div className="cre-360 cre-360-empty">📈 Caalano360 · no CRM lead carried this creative's UTM (utm_content)</div>
                // Scope this card's key events to the creative's campaign's pipeline.
                const { cols: creCols, pid: crePid } = creColsFor(a.campaign)
                const crePipeName = crePid ? ((allPipes.find((p) => p.id === crePid) || {}).name || '') : ''
                const f = o360Fields(o, a.spend, a.leads, creCols)
                const evs = []; let ci = 0; let wonCount = 0; let prevCount = a.leads
                for (const g of creCols.groups) {
                  const seg = creCols.cols.slice(ci, ci + g.span); ci += g.span
                  const first = seg.find((c) => c.gfirst) || seg[0]
                  const count = f[first.key] || 0
                  const sr = g.kind === 'calendar' ? seg.find((c) => c.metric === 'calShowRate') : null
                  const sh = g.kind === 'calendar' ? seg.find((c) => c.metric === 'calShown') : null
                  if (g.kind === 'won') wonCount = count
                  // Next-step = this stage's count ÷ the previous stage's; cost/event
                  // = this creative's spend ÷ count.
                  const next = prevCount ? (count / prevCount) * 100 : null
                  const cost = count && a.spend ? a.spend / count : null
                  evs.push({ label: g.label.replace(/^📅 /, ''), count, kind: g.kind, showRate: sr ? f[sr.key] : null, shown: sh ? f[sh.key] : null, next, cost })
                  prevCount = count
                }
                const roas = a.spend ? (o.revenue || 0) / a.spend : null
                const cpw = wonCount && a.spend ? a.spend / wonCount : null
                return <div className="cre-360">
                  <div className="c360-tag">📈 Caalano360 · key events{crePipeName ? ` · ${crePipeName}` : ''}</div>
                  <table className="cre-360-tbl"><thead><tr><th>Key event</th><th className="r">Count</th><th className="r" title="Conversion from the previous step">Next</th><th className="r" title="Creative spend ÷ count">Cost/ev</th><th className="r" title="Calendar events: shown ÷ occurred">Show %</th></tr></thead>
                    <tbody>
                      <tr className="lead"><td>Leads</td><td className="r">{fmtNumber(a.leads)}</td><td className="r">—</td><td className="r">{a.leads ? fmtCurrency(acpl, currency) : '—'}</td><td className="r">—</td></tr>
                      {evs.map((e, i) => <tr key={i} className={e.kind === 'won' ? 'won' : ''}><td title={e.label}>{e.label}{e.kind === 'calendar' && e.shown != null ? <small> · {fmtNumber(e.shown)} shown</small> : null}</td><td className="r">{fmtNumber(e.count)}</td><td className="r">{e.next == null ? '—' : fmtPct(e.next, 0)}</td><td className="r">{e.cost == null ? '—' : fmtCurrency(e.cost, currency)}</td><td className="r">{e.kind === 'calendar' && e.showRate != null ? fmtPct(e.showRate, 0) : '—'}</td></tr>)}
                    </tbody></table>
                  <div className="stats c360-cash">
                    <div className="st"><div className="l">Revenue</div><div className="v">{fmtCurrency(o.revenue || 0, currency)}</div></div>
                    <div className="st"><div className="l">C/Won</div><div className="v">{cpw == null ? '-' : fmtCurrency(cpw, currency)}</div></div>
                    <div className="st"><div className="l">ROAS</div><div className="v">{roas == null ? '-' : `${roas.toFixed(2)}×`}</div></div>
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
  const [kePipe, setKePipe] = useState(null)
  useEffect(() => { setKePipe(null) }, [pipe])
  const prevAttr = usePrevAttr(clientId, range, nonce)
  const scrollRootRef = React.useRef(null)
  useSyncedTableScroll(scrollRootRef)
  if (!deep?.google) return <EmptyDeep channel="Google Ads" />
  // Scope the whole Google ad side to the selected pipeline's linked campaigns.
  const inPipe = (campName) => pipe === 'all' || pipeOfCampaign(clientId, campName, allPipes) === pipe
  const g = pipe === 'all' ? deep.google : scopeGoogleToPipe(deep.google, inPipe)
  const scopedEmpty = pipe !== 'all' && !(g.campaigns || []).length
  const A = pipeAttr && pipeAttr.data && pipeAttr.data.attribution
  const has360 = !!A
  const keList = keyEventsForPipe(loadKeyEvents(clientId), pipe)
  // Per-pipeline Google spend → the key-events funnel defaults to the highest-spend one.
  const pipeSpend = {}
  for (const c of (deep.google.campaigns || [])) { const pid = pipeOfCampaign(clientId, c.name, allPipes); if (pid) pipeSpend[pid] = (pipeSpend[pid] || 0) + (c.cost || 0) }
  const topSpendPipe = Object.keys(pipeSpend).sort((a, b) => pipeSpend[b] - pipeSpend[a])[0] || null
  const kePipeEff = kePipe != null ? kePipe : (pipe !== 'all' ? pipe : (topSpendPipe || 'all'))
  const keListFunnel = keyEventsForPipe(loadKeyEvents(clientId), kePipeEff)
  const stagePos = stagePosMap(A && A.channels && A.channels.all ? A.channels.all.pipelines : [])
  const calNames = new Map(((A && A.appointments && A.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = buildO360Cols(keList, stagePos, calNames)
  const oCampG = aliasedOutcomeMap(clientId, 'campaign', A && A.byCampaign)
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
    const cfg = keyEventRows(keListFunnel, rmap, calCountMap(A, 'google'), stagePos, gCh ? gCh.totals.won : 0)
    if (cfg.length) return cfg
    if (!gCh) return []
    const tt = gCh.totals
    return [{ label: 'Leads', count: tt.leads, kind: 'stage' }, { label: 'Bookings', count: tt.booked, kind: 'stage' }, { label: 'Shown', count: tt.shown, kind: 'stage' }, { label: 'Won', count: tt.won, kind: 'stage' }]
  })()
  const gPipeLeads = kePipeEff !== 'all' && gCh ? ((gCh.pipelines || []).find((p) => p.id === kePipeEff) || {}).leads : null
  const gTotal = Math.max(1, gPipeLeads != null ? gPipeLeads : (gCh ? gCh.totals.leads : 0))
  return (
    <div ref={scrollRootRef}>
      <AttrDiag attr={attr} />
      {allPipes.length > 1 && <div className="pipe-filter-bar"><PipelineFilter pipelines={allPipes} value={pipe} onChange={setPipe} loading={pipeLoading} />{pipe !== 'all' && <span className="pipe-filter-note">Scoped to this pipeline's linked campaigns · link campaigns in Settings → Campaign links</span>}</div>}
      {scopedEmpty && <div className="alias-warn" style={{ marginTop: 8 }}><b>No campaigns are linked to this pipeline.</b> Link this pipeline's campaigns in <b>Settings → this client → Campaign links</b> (or rename them to match). The green CRM columns still reflect the pipeline.</div>}
      <div className="sc-sec-lab"><span className="sc-sec-t"><img src={FAVICON('ads.google.com')} alt="" width="13" height="13" /> Google metrics</span><span className="sc-sec-sub">delivery &amp; cost from the ad platform</span></div>
      <div className="scorecard sc-fit">
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
      {has360 && (() => {
        // Per-pipeline Caalano360 metrics — same treatment as Meta (Leads first,
        // count · vs-prev · % of leads, combined cost tiles), for Google.
        const rmap = reachedByStage(gCh ? (gCh.pipelines || []) : [])
        const calMap = calCountMap(A, 'google')
        const pipeMeta = (gCh && gCh.pipelines) || []
        const crmOf = (pid) => (pipeMeta.find((p) => p.id === pid) || {}).crm || null
        const prevGCh = prevAttr && prevAttr.channels && prevAttr.channels.google
        const prevRmap = reachedByStage(prevGCh ? (prevGCh.pipelines || []) : [])
        const prevCalMap = prevAttr ? calCountMap(prevAttr, 'google') : null
        const prevPipeMeta = (prevGCh && prevGCh.pipelines) || []
        const prevCrmOf = (pid) => pid ? (((prevPipeMeta.find((p) => p.id === pid) || {}).crm) || null) : (prevGCh ? prevGCh.totals : null)
        const evMap = (rows) => { const mm = {}; for (const r of rows) if (r.kind !== 'lead') mm[r.label] = r.count; return mm }
        const totalsCrm = gCh ? { leads: gCh.totals.leads, booked: gCh.totals.booked, won: gCh.totals.won, revenue: gCh.totals.revenue } : null
        const pipeSpendPrev = {}
        for (const c of (deep.google.campaigns || [])) { const pid = pipeOfCampaign(clientId, c.name, allPipes); if (pid && c.prev) pipeSpendPrev[pid] = (pipeSpendPrev[pid] || 0) + (c.prev.cost || 0) }
        const totalSpendPrev = (deep.google.prev && deep.google.prev.cost) || Object.values(pipeSpendPrev).reduce((s, v) => s + v, 0)
        const flatLine = (parts) => { const ps = parts.filter(Boolean); return ps.length ? <span className="sc-flat-line">{ps.map((p, i) => <React.Fragment key={i}>{i ? <span className="sc-flat-sep">·</span> : null}{p}</React.Fragment>)}</span> : null }
        const groupFor = (pid, label, spendP, spendPrevP, crmP, leadsP, sub) => {
          if (!crmP) return null
          const keListP = keyEventsForPipe(loadKeyEvents(clientId), pid || 'all')
          const rowsP = keyEventRows(keListP, rmap, calMap, stagePos, crmP.won || 0).filter((r) => r.kind !== 'lead' && r.count > 0)
          const pCrm = prevCrmOf(pid) || {}
          const pEv = prevGCh ? evMap(keyEventRows(keListP, prevRmap, prevCalMap, stagePos, pCrm.won || 0)) : {}
          const booked = crmP.booked || 0, won = crmP.won || 0, rev = crmP.revenue || 0
          const hasPrev = !!prevGCh
          const pct = (n) => leadsP ? `${Math.round((n / leadsP) * 100)}% leads` : null
          const perUnit = (unit, count, prevCount) => {
            if (!spendP || !count) return null
            const cur = spendP / count, prev = (spendPrevP && prevCount) ? spendPrevP / prevCount : null
            return <span className="sc-cost">{fmtCurrency(cur, currency)}/{unit}{(hasPrev && prev) ? <MiniDelta cur={cur} prev={prev} goodWhenDown /> : null}</span>
          }
          const roas = spendP ? rev / spendP : null
          return (
            <React.Fragment key={label}>
              <div className="sc-sec-lab"><span className="sc-sec-t c360"><span className="c360-dot" /> {label}</span><span className="sc-sec-sub">{sub}</span></div>
              <div className="scorecard sc-fit">
                <Sc label="Leads" value={fmtNumber(leadsP)} cur={hasPrev ? leadsP : null} prev={hasPrev ? (pCrm.leads || 0) : null} flat={flatLine(['100%', perUnit('lead', leadsP, pCrm.leads)])} />
                <Sc label="Scheduled Appts" value={fmtNumber(booked)} cur={hasPrev ? booked : null} prev={hasPrev ? (pCrm.booked || 0) : null} flat={flatLine([pct(booked), perUnit('appt', booked, pCrm.booked)])} />
                {rowsP.map((r, i) => { const showR = r.kind === 'calendar' && r.occurred ? `${Math.round((r.shown / r.occurred) * 100)}% show` : null; return <Sc key={i} label={r.label.replace(/^📅 /, '')} value={fmtNumber(r.count)} cur={hasPrev ? r.count : null} prev={hasPrev ? (pEv[r.label] || 0) : null} flat={flatLine([pct(r.count), perUnit('event', r.count, pEv[r.label]), showR])} /> })}
                <Sc label="Won" value={fmtNumber(won)} cur={hasPrev ? won : null} prev={hasPrev ? (pCrm.won || 0) : null} flat={flatLine([pct(won), perUnit('won', won, pCrm.won)])} />
                <Sc label="Revenue" value={fmtCurrency(rev, currency)} cur={hasPrev ? rev : null} prev={hasPrev ? (pCrm.revenue || 0) : null} flat={roas == null ? null : `${roas.toFixed(2)}× ROAS`} />
              </div>
            </React.Fragment>
          )
        }
        if (allPipes.length > 1) {
          const pids = allPipes.map((p) => p.id).filter((pid) => (pipeSpend[pid] || 0) > 0 || crmOf(pid)).sort((a, b) => (pipeSpend[b] || 0) - (pipeSpend[a] || 0))
          const groups = pids.map((pid) => { const cp = crmOf(pid); return groupFor(pid, (allPipes.find((p) => p.id === pid) || {}).name || 'Pipeline', pipeSpend[pid] || 0, pipeSpendPrev[pid] || 0, cp, cp ? cp.leads : 0, `${fmtCurrency(pipeSpend[pid] || 0, currency)} Google spend · count · vs prev · cost/event`) }).filter(Boolean)
          if (groups.length) return groups
        }
        return groupFor(null, 'Caalano360 metrics', t.cost, totalSpendPrev, totalsCrm, gCh ? gCh.totals.leads : 0, 'blended CRM outcomes vs Google spend · count · vs prev · cost/event')
      })()}
      {has360 && gRows.some((r) => r.count > 0) && <KeyEventsFunnel
        rows={gRows} total={gTotal} spend={t.cost} currency={currency}
        title="Key events · Google" style={{ marginTop: 14 }}
        headerRight={allPipes.length > 1 ? <select className="kef-pipe-sel" value={kePipeEff} onChange={(e) => setKePipe(e.target.value)} title="Show the key-events funnel for one pipeline">
          <option value="all">All pipelines</option>
          {allPipes.map((p) => <option key={p.id} value={p.id}>{p.name}{pipeSpend[p.id] ? ` · ${fmtCurrency(pipeSpend[p.id], currency)}` : ''}</option>)}
        </select> : null}
        sub={`Google-attributed leads through your key pipeline stages and booked calendars · cost per event = Google spend ÷ count · ${kePipeEff === 'all' ? 'all pipelines' : ((allPipes.find((p) => p.id === kePipeEff) || {}).name || 'pipeline')}`}
        caveat={<>📅 = a booked calendar appointment (cost per booked call). Counts are opportunities the CRM attributes to Google; cost per event divides the Google spend in this range. {allPipes.length > 1 ? 'Use the dropdown to switch pipeline — it defaults to the highest ad-spend one. ' : ''}Configure which stages and calendars count in Settings → Key events.</>}
      />}
      {daily.length > 0 && <div className="card chart-card" style={{ marginTop: 14 }}>
        <h3>Daily trend</h3><p className="cap">Spend, Conversions and Cost / Conversion by day{pipe !== 'all' ? ' · whole account' : ''}</p>
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
        <div className="card chart-card"><h3>Conversion actions</h3><p className="cap">What Google is counting{selLabel ? ` · in ${selLabel}` : ''} · <span className="ca-star">★</span> = primary (counted in Conversions)</p>
          {caAgg.length ? <div className="mini-scroll"><table className="mini-table ca-mt"><thead><tr><th>Action</th><th>Conv.</th><th>Value</th></tr></thead>
            <tbody>{caAgg.map((a) => { const primary = a.conversions > 0; return (<tr key={a.name}><td className="ca-name" title={a.name}><span>{primary ? <span className="ca-star" title="Primary — counted in Conversions">★ </span> : null}{a.name}</span><span className="ca-cat">{a.category || '-'}</span><span>{primary ? <span className="mr-pill-pri">Primary</span> : <span className="mr-pill-sec">Secondary</span>}</span></td><td>{fmtNumber(a.allConversions)}</td><td>{a.value ? fmtCurrency(a.value, currency) : '-'}</td></tr>) })}</tbody></table></div>
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
    const url = `/.netlify/functions/windsor?client=${clientId}&channel=attribution&${q}${nonce ? `&_r=${nonce}` : ''}`
    // The GHL-backed attribution build is heavy and can transiently time out or
    // hit a cold start / rate limit. Retry a couple of times with backoff before
    // surfacing the error (and carry the real backend reason, not a generic one).
    const attempt = (n) => fetch(url)
      .then(async (r) => { if (r.ok) return r.json(); let m = `HTTP ${r.status}`; try { const j = await r.json(); if (j && j.error) m = j.error } catch {} throw new Error(m) })
      .then((j) => { if (alive) setState({ status: 'ok', data: j }) })
      .catch((e) => { if (!alive) return; if (n < 2) setTimeout(() => { if (alive) attempt(n + 1) }, 1200 * (n + 1)); else setState({ status: 'err', data: null, error: String((e && e.message) || e).slice(0, 200) }) })
    attempt(0)
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
// Previous equal-length period ending the day before `range.from`.
function prevRangeOf(range) {
  const a = Date.parse(range && range.from), b = Date.parse(range && range.to)
  if (!isFinite(a) || !isFinite(b)) return null
  const days = Math.round((b - a) / 86400000) + 1
  const pb = new Date(a - 86400000)
  const pa = new Date(pb.getTime() - (days - 1) * 86400000)
  const iso = (d) => d.toISOString().slice(0, 10)
  return { from: iso(pa), to: iso(pb) }
}
// Account-wide attribution for the PREVIOUS period, so the Caalano360 metrics can
// show vs-prev deltas. Returns the attribution payload or null.
function usePrevAttr(clientId, range, nonce) {
  const [state, setState] = useState(null)
  const pr = prevRangeOf(range)
  const q = pr ? rangeQuery(pr) : null
  useEffect(() => {
    if (!q) { setState(null); return }
    let alive = true
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=attribution&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setState(j && j.attribution ? j.attribution : null) }).catch(() => { if (alive) setState(null) })
    return () => { alive = false }
  }, [clientId, q, nonce]) // eslint-disable-line
  return state
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
const COMPETITORS_KEY = 'caalano_competitors'    // { clientId: [{ id, name, ig, fb, igAccount, fbAccount }] } — organic-social competitors per client
const SOCIALKPIS_KEY = 'caalano_socialkpis'      // { clientId: { netFollowers, reach, views, engagement, posts, er } } — monthly organic-social KPI targets
const OPTLOG_KEY = 'caalano_optlog'              // { clientId: 'https://docs.google.com/spreadsheets/d/…' } — per-client Optimisation Log Google Sheet
const QUALSTAGE_KEY = 'caalano_qualstage'        // { clientId: { [pipelineId]: stageName } } — the stage that marks a lead "qualified", per pipeline
const ALIASES_KEY = 'caalano_aliases'            // { clientId: { campaign|medium|content: { oldUtmName: currentName } } } — old-UTM → current-name links (renames)
const LOGOS_KEY = 'caalano_logos'                // { clientId: { website, logoUrl, logo? } } — business logo (GHL logoUrl / website favicon, + optional manual override) for avatars
// Durable default key events for clients whose config predates server storage,
// so their Meta/Google funnel + grouped Caalano360 columns render out of the
// box. Bare strings = pipeline stage names; calendars are linked in Settings.
const SEED_KEYEVENTS = {
  'pool-haus': ['New Lead', 'Pool Specialist Booked Call', 'Pool Specialist Call - Shown', 'Site Visit Booked', 'Site Visit Completed', 'Quote/Proposal Sent', 'Client Won'],
}
// Default Optimisation Log Google Sheets per client (from the master client→sheet
// list). loadOptLog falls back to these, so the tab appears without manual setup;
// a URL saved in Settings overrides its seed.
const SEED_OPTLOG = {
  'a2z': 'https://docs.google.com/spreadsheets/d/1kY4VpDQTdotnU7CX6Bm54r4SlYlVrz1lJHn7NdANGRM/edit?gid=0#gid=0',
  'finr-advisory': 'https://docs.google.com/spreadsheets/d/1rfPd307wLwy7by6mgihCssuFOBIun1mBLn6Oi1qh7Po/edit?gid=0#gid=0',
  'healan-centre': 'https://docs.google.com/spreadsheets/d/1heLwQD4eejpzCN08X4BFxl8VkvC3Dh_lNrLuhumH97E/edit?gid=0#gid=0',
  'ido-ido': 'https://docs.google.com/spreadsheets/d/1rFefzL6xvDTEgO6M_5VLxx4zh92jniL9cJtwnkATayk/edit?gid=0#gid=0',
  'nexia-health': 'https://docs.google.com/spreadsheets/d/1FcjHn_HEgOwZuLipFhzhSROLhJZTc1_EWu9Bux52qwI/edit?gid=0#gid=0',
  'owl-psa': 'https://docs.google.com/spreadsheets/d/1UhXljKJqthC1LHJLp6urxEpj9F7ff78973cRwPPXPJ8/edit?gid=0#gid=0',
  'pool-haus': 'https://docs.google.com/spreadsheets/d/131XLUm1-BGn-zOs8rPmcMTrOX5uX_3I9rL27w93ikV0/edit?gid=0#gid=0',
  'swift-emergency': 'https://docs.google.com/spreadsheets/d/1O77isUez0vPK-0D3uF8V8crYtuuW8vm9GnZ0Zv12VIw/edit?gid=0#gid=0',
  'simchat': 'https://docs.google.com/spreadsheets/d/1XUvtG8hkVLRkGLt6IS3T0H35vXWHVLHKWOIS-lvq0Ao/edit?gid=0#gid=0',
  'psychology-hub': 'https://docs.google.com/spreadsheets/d/1vg7Y0KSH7dcIkH1HkFxjarct5SjSzIVmF46MK6h_QDA/edit',
}
const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const SETTINGS = { campmap: readLS(CMAP_KEY), kpis: readLS(KPI_KEY), keyevents: readLS(KEV_KEY), enabled: readLS(ENABLED_KEY), insights: readLS(AI_KEY), clients: readLS(CLIENTS_KEY), formmeta: readLS(FORMMETA_KEY), metaconv: readLS(METACONV_KEY), creativemeta: readLS(CREATIVEMETA_KEY), creativetax: readLS(CREATIVETAX_KEY), clientctx: readLS(CLIENTCTX_KEY), fatigue: readLS(FATIGUE_KEY), competitors: readLS(COMPETITORS_KEY), socialkpis: readLS(SOCIALKPIS_KEY), optlog: readLS(OPTLOG_KEY), qualstage: readLS(QUALSTAGE_KEY), aliases: readLS(ALIASES_KEY), logos: readLS(LOGOS_KEY), loaded: false }
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
      for (const s of ['campmap', 'kpis', 'keyevents', 'enabled', 'insights', 'clients', 'formmeta', 'metaconv', 'creativemeta', 'creativetax', 'clientctx', 'fatigue', 'competitors', 'socialkpis', 'optlog', 'qualstage', 'aliases', 'logos']) SETTINGS[s] = { ...SETTINGS[s], ...(d[s] || {}) }
      writeLS(CMAP_KEY, SETTINGS.campmap); writeLS(KPI_KEY, SETTINGS.kpis); writeLS(KEV_KEY, SETTINGS.keyevents); writeLS(ENABLED_KEY, SETTINGS.enabled); writeLS(AI_KEY, SETTINGS.insights); writeLS(CLIENTS_KEY, SETTINGS.clients); writeLS(FORMMETA_KEY, SETTINGS.formmeta); writeLS(METACONV_KEY, SETTINGS.metaconv); writeLS(CREATIVEMETA_KEY, SETTINGS.creativemeta); writeLS(CREATIVETAX_KEY, SETTINGS.creativetax); writeLS(CLIENTCTX_KEY, SETTINGS.clientctx); writeLS(FATIGUE_KEY, SETTINGS.fatigue); writeLS(COMPETITORS_KEY, SETTINGS.competitors); writeLS(SOCIALKPIS_KEY, SETTINGS.socialkpis); writeLS(OPTLOG_KEY, SETTINGS.optlog); writeLS(QUALSTAGE_KEY, SETTINGS.qualstage); writeLS(ALIASES_KEY, SETTINGS.aliases); writeLS(LOGOS_KEY, SETTINGS.logos)
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
function customClientList() { return Object.entries(SETTINGS.clients || {}).filter(([, v]) => v && !v._deleted && (v.meta || v.google || v.ghl)).map(([id, v]) => ({ id, name: v.name || id, industry: v.industry || null, meta: v.meta || null, google: v.google || null, ghl: v.ghl || null, metaName: v.metaName || null, googleName: v.googleName || null, ghlName: v.ghlName || null, custom: true })) }
function saveCustomClient(id, mapping) { SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: mapping }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: mapping } }); bumpSettings() }
function removeCustomClient(id) { SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: null }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: null } }); bumpSettings() }
// True delete: hide a client from every list (base or UI-added). A soft _deleted
// flag persists to the server; the backend also drops it from agency aggregates.
function isClientDeleted(id) { const v = SETTINGS.clients && SETTINGS.clients[id]; return !!(v && v._deleted) }
function deleteClient(id) { const v = { ...((SETTINGS.clients && SETTINGS.clients[id]) || {}), _deleted: true }; SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: v }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: v } }); bumpSettings() }
function restoreClient(id) { const cur = (SETTINGS.clients && SETTINGS.clients[id]) || {}; const v = { ...cur }; delete v._deleted; const next = Object.keys(v).length ? v : null; SETTINGS.clients = { ...(SETTINGS.clients || {}), [id]: next }; writeLS(CLIENTS_KEY, SETTINGS.clients); saveSettingsRemote({ clients: { [id]: next } }); bumpSettings() }
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
// Per-client Optimisation Log Google Sheet URL.
function loadOptLog(clientId) { return SETTINGS.optlog[clientId] || SEED_OPTLOG[clientId] || '' }
function saveOptLog(clientId, url) { SETTINGS.optlog = { ...SETTINGS.optlog, [clientId]: url }; writeLS(OPTLOG_KEY, SETTINGS.optlog); saveSettingsRemote({ optlog: { [clientId]: url } }); bumpSettings() }
// Per-pipeline "qualified lead" stage: { [pipelineId]: stageName }. A lead is
// qualified once it reaches that stage or beyond (won deals reach every stage, so
// they always count). Empty = qualified is not defined for the client → hidden.
function loadQualStage(clientId) { return (SETTINGS.qualstage && SETTINGS.qualstage[clientId]) || {} }
function saveQualStage(clientId, map) { SETTINGS.qualstage = { ...SETTINGS.qualstage, [clientId]: map }; writeLS(QUALSTAGE_KEY, SETTINGS.qualstage); saveSettingsRemote({ qualstage: { [clientId]: map } }); bumpSettings() }
// UTM aliases: old-UTM value → current entity name, per level. Handles renamed
// campaigns / ad sets / creatives whose historical CRM leads were stamped with the
// old name — so old + new outcomes aggregate under the current name.
const ALIAS_LEVELS = ['campaign', 'medium', 'content']
function loadAliases(clientId) { const a = (SETTINGS.aliases && SETTINGS.aliases[clientId]) || {}; return { campaign: a.campaign || {}, medium: a.medium || {}, content: a.content || {} } }
function saveAliases(clientId, level, map) {
  // Preserve any sibling keys (other levels + the _keep dismissals) - build from
  // the raw stored object, not loadAliases which only returns the fold maps.
  const raw = (SETTINGS.aliases && SETTINGS.aliases[clientId]) || {}
  const nx = { ...raw, [level]: map }
  SETTINGS.aliases = { ...SETTINGS.aliases, [clientId]: nx }
  writeLS(ALIASES_KEY, SETTINGS.aliases); saveSettingsRemote({ aliases: { [clientId]: nx } }); bumpSettings()
}
function setAlias(clientId, level, oldName, currentName) {
  const cur = loadAliases(clientId); const m = { ...(cur[level] || {}) }
  if (currentName) m[oldName] = currentName; else delete m[oldName]
  saveAliases(clientId, level, m)
}
// "Keep separate" — mark an unmatched UTM as an intentional standalone (a legit
// paused/other campaign, NOT a rename). It's hidden from the unmatched list and
// its data stays under its own name — nothing is merged. Stored alongside the
// fold maps under a reserved _keep key so applyAliases never touches it.
function loadKeep(clientId) { const k = ((SETTINGS.aliases && SETTINGS.aliases[clientId]) || {})._keep || {}; return { campaign: k.campaign || {}, medium: k.medium || {}, content: k.content || {} } }
function setKeep(clientId, level, name, on) {
  const raw = (SETTINGS.aliases && SETTINGS.aliases[clientId]) || {}
  const keep = loadKeep(clientId); const lvlMap = { ...keep[level] }
  if (on) lvlMap[name] = 1; else delete lvlMap[name]
  const nx = { ...raw, _keep: { ...keep, [level]: lvlMap } }
  SETTINGS.aliases = { ...SETTINGS.aliases, [clientId]: nx }
  writeLS(ALIASES_KEY, SETTINGS.aliases); saveSettingsRemote({ aliases: { [clientId]: nx } }); bumpSettings()
}
// Fold old-UTM outcome rows into their current-name row using an alias map
// { oldName: currentName }. Sums numeric fields and merges the stage/calendar maps.
function applyAliases(arr, aliasMap) {
  if (!Array.isArray(arr) || !arr.length || !aliasMap || !Object.keys(aliasMap).length) return arr || []
  const norm = new Map(); for (const k in aliasMap) if (aliasMap[k]) norm.set(unorm(k), aliasMap[k])
  if (!norm.size) return arr
  const MAPS = ['stages', 'cals', 'calsShown', 'calsOccurred']
  const byCanon = new Map(); const order = []
  for (const e of arr) {
    const canon = norm.get(unorm(e.name)) || e.name
    const key = unorm(canon)
    let g = byCanon.get(key)
    if (!g) { g = { ...e, name: canon }; for (const mp of MAPS) if (e[mp]) g[mp] = { ...e[mp] }; byCanon.set(key, g); order.push(key); continue }
    for (const k in e) {
      if (k === 'name') continue
      if (MAPS.includes(k)) { g[k] = g[k] || {}; for (const kk in e[k]) g[k][kk] = (g[k][kk] || 0) + e[k][kk]; continue }
      if (typeof e[k] === 'number') g[k] = (g[k] || 0) + e[k]
    }
  }
  return order.map((k) => byCanon.get(k))
}
// mkOutcomeMap with a client's aliases for a level applied first.
function aliasedOutcomeMap(clientId, level, arr) { return mkOutcomeMap(applyAliases(arr, loadAliases(clientId)[level])) }
// Pull the spreadsheet id + tab gid out of a Google Sheets URL (gid defaults to 0).
function parseSheetRef(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/)
  if (!m) return null
  const g = String(url || '').match(/[#&?]gid=(\d+)/)
  return { id: m[1], gid: g ? g[1] : '0' }
}

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
// Resolve which pipeline a campaign belongs to: an explicit Settings link wins;
// "all" / unmatched fall back to a name-token match (same matcher forms use).
// null = belongs to no specific pipeline.
function pipeOfCampaign(clientId, campName, pipes) {
  if (campName == null) return null
  const t = loadCampMap(clientId)[campName]
  if (t === 'all') return null
  if (t) return t
  return suggestPipeline(campName, pipes) || null
}
// Scope a Meta rollup to the campaigns matching keep(name): filter campaigns /
// ad sets / creatives / ad-daily to that subset and recompute account totals,
// results breakdown, daily series and prev from it. Reach is summed across
// campaigns (a mild over-count vs true dedup'd account reach) — flagged in UI.
function scopeMetaToPipe(m, keep) {
  const campaigns = (m.campaigns || []).filter((c) => keep(c.name))
  const ok = new Set(campaigns.map((c) => c.name))
  const adsets = (m.adsets || []).filter((a) => ok.has(a.campaign))
  const ads = (m.ads || []).filter((a) => ok.has(a.campaign))
  const adDaily = (m.adDaily || []).filter((r) => ok.has(r.campaign))
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x && x[k]) || 0), 0)
  const totals = {
    spend: sum(campaigns, 'spend'), impressions: sum(campaigns, 'impressions'), clicks: sum(campaigns, 'clicks'),
    linkClicks: sum(campaigns, 'linkClicks'), leads: sum(campaigns, 'leads'), videoViews: sum(campaigns, 'videoViews'),
    reach: sum(campaigns, 'reach'), reachApprox: true,
  }
  const bd = {}
  for (const c of campaigns) { if (c.results && c.resultType) bd[c.resultType] = (bd[c.resultType] || 0) + c.results }
  totals.resultBreakdown = Object.entries(bd).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  totals.results = totals.resultBreakdown.reduce((s, x) => s + x.count, 0)
  totals.costPerResult = totals.results ? Math.round((totals.spend / totals.results) * 100) / 100 : null
  const dm = new Map()
  for (const r of adDaily) { const e = dm.get(r.date) || { date: r.date, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 }; e.spend += r.spend; e.impressions += r.impressions; e.clicks += r.clicks; e.linkClicks += r.linkClicks; e.leads += r.leads; dm.set(r.date, e) }
  const daily = [...dm.values()].sort((a, b) => a.date.localeCompare(b.date))
  const pc = campaigns.map((c) => c.prev).filter(Boolean)
  const prev = pc.length ? { spend: sum(pc, 'spend'), impressions: sum(pc, 'impressions'), clicks: sum(pc, 'clicks'), linkClicks: sum(pc, 'linkClicks'), leads: sum(pc, 'leads'), videoViews: sum(pc, 'videoViews'), reach: sum(pc, 'reach') } : null
  return { ...m, campaigns, adsets, ads, adDaily, totals, daily, prev }
}
// Google equivalent: scope a Google rollup to the campaigns matching keep(name)
// and recompute totals + prev from that subset.
function scopeGoogleToPipe(g, keep) {
  const campaigns = (g.campaigns || []).filter((c) => keep(c.name))
  const ok = new Set(campaigns.map((c) => c.name))
  const adGroups = (g.adGroups || []).filter((a) => ok.has(a.campaign))
  const keywords = (g.keywords || []).filter((k) => ok.has(k.campaign))
  const searchTerms = (g.searchTerms || []).filter((s) => ok.has(s.campaign))
  const conversionActions = (g.conversionActions || []).filter((r) => !r.campaign || ok.has(r.campaign))
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x && x[k]) || 0), 0)
  const totals = { cost: sum(campaigns, 'cost'), impressions: sum(campaigns, 'impressions'), clicks: sum(campaigns, 'clicks'), conversions: sum(campaigns, 'conversions') }
  const pc = campaigns.map((c) => c.prev).filter(Boolean)
  const prev = pc.length ? { cost: sum(pc, 'cost'), impressions: sum(pc, 'impressions'), clicks: sum(pc, 'clicks'), conversions: sum(pc, 'conversions') } : null
  return { ...g, campaigns, adGroups, keywords, searchTerms, conversionActions, totals, prev, keywordsTotal: keywords.length, searchTermsTotal: searchTerms.length }
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
function loadKeyEventsRaw(clientId) { const v = SETTINGS.keyevents[clientId]; if (v !== undefined) return v; return SEED_KEYEVENTS[clientId] || [] }
// Key events for RENDERING (funnels, green columns, reach) = the configured key
// events PLUS a synthetic "Qualified" stage event for every pipeline that has a
// qualified stage set (Settings → Qualified lead). It slots into the funnel at its
// stage position and behaves like any other key event. The editor + config checks
// use loadKeyEventsRaw so the synthetic event never round-trips into storage.
function loadKeyEvents(clientId) {
  const base = loadKeyEventsRaw(clientId)
  const qm = (SETTINGS.qualstage && SETTINGS.qualstage[clientId]) || null
  if (!qm || !Object.keys(qm).length) return base
  const nz = (s) => String(s || '').trim().toLowerCase()
  const out = base.slice()
  for (const pid in qm) {
    const stage = qm[pid]; if (!stage) continue
    const dup = base.some((e) => e && typeof e === 'object' && e.cal == null && nz(e.stage) === nz(stage) && (e.pipeline || null) === (pid || null))
    if (!dup) out.push({ stage, pipeline: pid, label: 'Qualified' })
  }
  return out
}
function saveKeyEvents(clientId, arr) { SETTINGS.keyevents = { ...SETTINGS.keyevents, [clientId]: arr }; writeLS(KEV_KEY, SETTINGS.keyevents); saveSettingsRemote({ keyevents: { [clientId]: arr } }); bumpSettings() }
// Organic-social competitors assigned to a client (name + IG/FB handle). Handles
// are stored bare (no @, no URL); the tab derives profile links + Windsor lookups.
function loadCompetitors(clientId) { return (SETTINGS.competitors && SETTINGS.competitors[clientId]) || [] }
function saveCompetitors(clientId, arr) { SETTINGS.competitors = { ...(SETTINGS.competitors || {}), [clientId]: arr }; writeLS(COMPETITORS_KEY, SETTINGS.competitors); saveSettingsRemote({ competitors: { [clientId]: arr } }); bumpSettings() }
// Monthly organic-social KPI targets, per client.
function loadSocialKpis(clientId) { return (SETTINGS.socialkpis && SETTINGS.socialkpis[clientId]) || {} }
function saveSocialKpis(clientId, obj) { SETTINGS.socialkpis = { ...(SETTINGS.socialkpis || {}), [clientId]: obj }; writeLS(SOCIALKPIS_KEY, SETTINGS.socialkpis); saveSettingsRemote({ socialkpis: { [clientId]: obj } }); bumpSettings() }
const cleanHandle = (s) => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|facebook)\.com\//i, '').replace(/\/.*$/, '').trim()
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
// moves the lead into that stage). An event we can't anchor to a stage position
// (e.g. a calendar with no linked stage, or a stage that isn't in this pipeline)
// inherits the PREVIOUS event's position + a tiny step, so it keeps the order it
// was configured in — next to its neighbours — instead of being dumped at the end.
function orderKeyEvents(list, stagePos) {
  if (!stagePos || !stagePos.size) return list
  const posAt = (pipeline, name) => (pipeline && stagePos.has(pipeline + '::' + name) ? stagePos.get(pipeline + '::' + name) : stagePos.get(name))
  const resolved = (e) => {
    if (e.kind === 'stage') { const p = posAt(e.pipeline, e.ref); return p == null ? null : p }
    const p = e.stage ? posAt(e.pipeline, e.stage) : null
    return p == null ? null : p - 0.1 // calendar sits just ahead of its linked stage
  }
  const rows = list.map((e, i) => ({ e, i, p: resolved(e) }))
  let last = -1
  for (const r of rows) { if (r.p == null) { r.p = last + 0.001; last = r.p } else last = r.p }
  return rows.sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.e)
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
      m.set(cal.id, { name: cal.name, count: src.booked || 0, occurred: src.occurred || 0, shown: src.shown || 0, cancelled: src.cancelled || 0 })
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
      let cal = 0, occurred = 0, shown = 0, cancelled = 0, any = false
      for (const r of (k.refs || [k.ref])) { const c = calMap && calMap.get(r); if (c) { any = true; cal += c.count; occurred += (c.occurred || 0); shown += c.shown; cancelled += c.cancelled } }
      // Linked stage acts as a fallback: leads that reached the stage but we have
      // no calendar booking for. Approximated as stageReached - calendar bookings.
      const stageReached = k.stage ? stageReachOf(rmap, k.pipeline, k.stage) : 0
      const fromStage = Math.max(0, stageReached - cal)
      if (!any && !fromStage) continue
      rows.push({ label: k.label, count: cal + fromStage, fromCal: cal, fromStage, occurred, shown, cancelled, kind: 'calendar', pipeline: k.pipeline || null })
    } else if (WON_RE.test(k.label)) {
      // Won event counts on the won STATUS (not the pipeline stage).
      const n = wonTotal != null ? wonTotal : stageReachOf(rmap, k.pipeline, k.ref)
      rows.push({ label: k.label, count: n, kind: 'won', pipeline: k.pipeline || null })
    } else {
      const has = rmap && (rmap.m.has(k.ref) || (k.pipeline && rmap.m.has(k.pipeline + '::' + k.ref)))
      if (!has) continue
      rows.push({ label: k.label, count: stageReachOf(rmap, k.pipeline, k.ref), kind: 'stage', pipeline: k.pipeline || null })
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
function KeyEventsFunnel({ rows, total, spend, currency, title, sub, caveat, style, className = '', headerRight }) {
  if (!rows || !rows.length) return null
  const money = (v) => fmtCurrency(v, currency)
  const anyCal = rows.some((r) => r.kind === 'calendar')
  // Prepend a Leads anchor so % of leads and the first next-step conversion read
  // naturally, unless the caller already leads with a "Leads" row.
  const hasLeads = /lead/i.test(rows[0].label || '') || (rows[0].kind === 'lead')
  const full = hasLeads ? rows : [{ label: 'Leads', count: total || 0, kind: 'lead' }, ...rows]
  const max = Math.max(1, ...full.map((r) => r.count))
  return (
    <div className={`card chart-card ${className}`} style={style}>{headerRight ? <div className="kef-title-row"><h3>{title}</h3>{headerRight}</div> : <h3>{title}</h3>}{sub ? <p className="cap">{sub}</p> : null}
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
          // Show rate on OCCURRED appointments (past their date), not all bookings.
          const showR = s.kind === 'calendar' && s.occurred ? (s.shown / s.occurred) * 100 : null
          const hue = 210 + Math.round((i / Math.max(1, full.length - 1)) * -70)
          const isLead = s.kind === 'lead'
          const barTip = s.fromStage ? `${fmtNumber(s.count)} total · ${fmtNumber(s.fromCal)} via calendar booking · ${fmtNumber(s.fromStage)} via pipeline-stage fallback` : undefined
          return (
            <div className={`kef-row${isLead ? ' kef-lead' : ''}`} key={s.label + i}>
              <span className="kef-step">{s.kind === 'calendar' ? <span className="ke-cal" title="Booked calendar appointment">📅 </span> : null}{s.label}{s.kind === 'calendar' && s.cancelled ? <span className="c360-canc" title={`${s.cancelled} later cancelled`}> ({s.cancelled}c)</span> : null}</span>
              <span className="kef-bar" title={barTip}><span className="kef-fill" style={{ width: `${Math.max(6, (s.count / max) * 100)}%`, background: `hsl(${hue} 68% 52%)` }}>{fmtNumber(s.count)}{s.fromStage ? <span className="kef-p" title={barTip}> +{fmtNumber(s.fromStage)}p</span> : null}</span></span>
              <span className="kef-num">{isLead ? '100%' : fmtPct(pct, 0)}</span>
              <span className={`kef-num ${step == null ? '' : step >= 60 ? 'good' : step < 30 ? 'bad' : ''}`}>{step == null ? '—' : fmtPct(step, 0)}</span>
              {anyCal ? <span className="kef-num" title={s.kind === 'calendar' ? `${fmtNumber(s.shown || 0)} shown of ${fmtNumber(s.occurred || 0)} occurred · ${fmtNumber(s.count)} booked` : undefined}>{showR == null ? '—' : fmtPct(showR, 0)}</span> : null}
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
// Prioritised summary of what needs attention, read straight from the command
// centre (spend + CRM) — no health-score pillars. `ca` is the aggregated CRM
// feed (open/lost/lostReasons) from useCrmAgg.
function priorityActions(h, money, ca) {
  if (!h || !h.kpis) return []
  const k = h.kpis, pv = k.prev || {}, out = []
  const dropPct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null)
  const spend = k.adSpend || 0
  // Cost per lead movement.
  if (spend >= 50 && k.cpl != null && pv.leads && pv.adSpend) { const pc = Math.round(pv.adSpend / pv.leads); const dp = dropPct(k.cpl, pc); if (dp != null && dp >= 40) out.push({ sev: 'high', text: `Cost per lead is up ${dp}% on the previous period (${money(pc)} to ${money(k.cpl)}) — review targeting and creative.` }); else if (dp != null && dp >= 20) out.push({ sev: 'med', text: `Cost per lead is climbing, up ${dp}% on the previous period (now ${money(k.cpl)}).` }) }
  // Lead volume down.
  if (k.leads != null && pv.leads) { const dp = dropPct(k.leads, pv.leads); if (dp != null && dp <= -20) out.push({ sev: dp <= -40 ? 'high' : 'med', text: `Opportunities down ${Math.abs(dp)}% on the previous period (${fmtNumber(pv.leads)} to ${fmtNumber(k.leads)}).` }) }
  // Show rate low (attendance).
  if (k.booked >= 3 && k.shown != null) { const sr = k.shown / k.booked; if (sr < 0.5) out.push({ sev: 'med', text: `Show rate is ${Math.round(sr * 100)}% — a lot of booked calls aren't being attended. Tighten reminders and confirmations.` }) }
  // Booking rate low (early-funnel drop).
  if (k.leads >= 10 && k.booked != null) { const br = k.booked / k.leads; if (br < 0.3) out.push({ sev: 'med', text: `Only ${Math.round(br * 100)}% of opportunities are booking a call — the drop is early in the funnel.` }) }
  // Lost deals + top reason.
  if (ca && ca.lost >= 1) { const top = ca.lostReasons && ca.lostReasons[0]; out.push({ sev: (ca.lostValue && ca.lostValue >= (k.revenue || 0)) ? 'med' : 'low', text: `${fmtNumber(ca.lost)} ${ca.lost === 1 ? 'deal' : 'deals'} lost${ca.lostValue ? ` worth ${money(ca.lostValue)}` : ''}${top ? `, most commonly "${top.reason}"` : ''}.` }) }
  // Open pipeline to chase.
  if (ca && ca.open >= 1 && (k.openValue || ca.openValue)) out.push({ sev: 'low', text: `${money(k.openValue || ca.openValue)} across ${fmtNumber(ca.open)} open ${ca.open === 1 ? 'opportunity' : 'opportunities'} still to chase.` })
  // No wins yet.
  if (k.won === 0 && k.leads > 0) out.push({ sev: 'low', text: `No deals won yet this period — check where the open deals have reached in the funnel.` })
  const rank = { high: 0, med: 1, low: 2 }
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]).slice(0, 6)
}

// Build a client's key-event funnel rows from the ccdrill payload. Shared by the
// Revenue-bottleneck panel and the command-centre Rates tiles so both read the
// exact same numbers. Returns { rows, leadTotal, usingKe }.
function ccKeyEventFunnel(cc, clientId, wonTotal, leadsFallback) {
  const pipes = (cc && cc.pipelinesFunnel) || []
  const keList = clientId ? loadKeyEvents(clientId) : []
  const rmap = reachedByStage(pipes)
  const stagePos = stagePosMap(pipes)
  const calMap = new Map(((cc && cc.bookingByCalendar) || []).map((c) => [c.id, { name: c.calendar, count: c.booked, shown: c.shown, cancelled: 0 }]))
  const rows = (keList && keList.length && pipes.length) ? keyEventRows(keList, rmap, calMap, stagePos, wonTotal) : []
  const leadTotal = leadsFallback || rmap.total || 0
  // Per-pipeline lead totals so a pipeline-scoped key event (multi-pipeline client)
  // divides by ITS OWN pipeline's leads, not the grand total across all pipelines.
  const multi = pipes.length > 1
  const pipeLeads = new Map()
  for (const p of pipes) if (p.id) pipeLeads.set(p.id, (p.stages || []).reduce((s, x) => s + (x.count || 0), 0))
  for (const r of rows) r.leadBase = (multi && r.pipeline && pipeLeads.get(r.pipeline)) ? pipeLeads.get(r.pipeline) : leadTotal
  return { rows, leadTotal, usingKe: rows.length > 0, multi }
}
const sourceDotChan = (ch) => ch === 'meta' ? '#4f7cff' : ch === 'google' ? '#12b886' : ch === 'other' ? '#e8a13a' : '#9aa1ac'

// One open deal in the bottleneck's open-by-stage list — shows the assigned rep
// + lead source, and expands on click to that contact's Caalano Systems notes.
function BnDealRow({ d, clientId, money }) {
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
        <td className="lft">{d.contactId ? <span className="u-chev">{open ? '▾' : '▸'}</span> : null} {d.name}</td>
        <td className="lft">{d.assignedUser || 'Unassigned'}</td>
        <td className="lft"><span className="bn-src"><i style={{ background: sourceDotChan(d.channel) }} />{d.source}</span></td>
        <td>{money(d.value)}</td>
        <td className={d.ageDays != null && d.ageDays > 30 ? 'u-stale' : ''}>{d.ageDays != null ? `${d.ageDays}d` : '—'}</td>
      </tr>
      {open && <tr className="u-notes-row"><td colSpan={5}>
        {loading ? <Spinner label="Loading notes…" /> : notes && notes.length ? <div className="u-notes">{notes.map((n, i) => <div className="u-note-item" key={i}><div className="u-note-meta">{n.author || 'Team'}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleDateString()}` : ''}</div><div className="u-note-body">{n.body}</div></div>)}</div> : <div className="cap" style={{ padding: '2px 2px 6px' }}>No notes on this contact in Caalano Systems.</div>}
      </td></tr>}
    </React.Fragment>
  )
}

// Revenue bottleneck — the whole-account key-event funnel with step conversions,
// flagging the biggest drop-off, plus a clickable "open pipeline by stage" list
// (who's still in play, and where they came from). In a paid channel view it also
// shows cost per stage and the next-step conversion. Calendar show-rate lives in
// its own card below. Built from the ccdrill payload (no extra fetch).
function BottleneckPanel({ kpis, money, clientId, cc, health, currency, chan = 'all', stageSpend = 0 }) {
  const [openStage, setOpenStage] = useState(null)
  // Channel-scoped totals from the drill when a channel is active, so the funnel's
  // Leads/Won denominators match its (channel-filtered) stage numerators.
  const chActiveBn = chan !== 'all'
  const ccTot = (cc && cc.totals) || null
  // Anchor the funnel on the drill's opportunity totals (same basis as its stage
  // numerators) in both all and channel views, so Leads == New Lead reach and the
  // rates never exceed 100%.
  const chanLeads = ccTot ? ccTot.leads : kpis.leads
  const chanWon = ccTot ? ccTot.won : kpis.won
  const kef = ccKeyEventFunnel(cc, clientId, chanWon, ccTot ? ccTot.leads : kpis.leads)
  const usingKe = kef.usingKe
  const leadTotal = kef.leadTotal
  // Build a funnel (rows + step conversions + worst drop-off) from a [{label,v}] list.
  const makeFunnel = (arr) => {
    const top = arr[0].v || 1
    const rows = arr.map((s, i) => { const prev = i > 0 ? arr[i - 1].v : null; return { ...s, prev, conv: prev ? s.v / prev : null, drop: prev != null ? prev - s.v : 0 } })
    rows.forEach((r, i) => { r.next = (i < rows.length - 1 && r.v) ? rows[i + 1].v / r.v : null })
    const cands = rows.filter((r) => r.conv != null && r.prev > 0)
    const worst = cands.length ? cands.reduce((a, b) => (b.conv < a.conv ? b : a)) : null
    return { rows, top, worst }
  }
  const raw = usingKe
    ? [{ label: 'Leads', v: leadTotal }, ...kef.rows.map((r) => ({ label: r.label, v: r.count }))]
    : chActiveBn
      // Channel view with no key events resolving (e.g. no opps on this channel) —
      // strictly channel-scoped so it reads 0, never account-wide numbers.
      ? [{ label: 'Opportunities', v: chanLeads || 0 }, { label: 'Won', v: chanWon || 0 }]
      : [
        { label: 'Opportunities', v: kpis.leads },
        { label: 'Booked', v: kpis.booked },
        { label: 'Shown', v: kpis.shown },
        { label: 'Won', v: kpis.won },
      ].filter((s) => s.v != null)
  if (raw.length < 2) return null
  // All-channel with no leads hides the card (as before); a channel view always
  // renders so the filter visibly reads 0 rather than vanishing silently.
  if (!raw[0].v && !chActiveBn) return null
  // Multi-pipeline "all" view: one funnel per pipeline, each with its own Leads
  // denominator, so step conversions never divide one pipeline's step by another's.
  const nameOf = new Map(((cc && cc.pipelinesFunnel) || []).map((p) => [p.id, p.name]))
  const bnGroups = (usingKe && kef.multi) ? (() => {
    const byPipe = new Map()
    for (const r of kef.rows) { const k = r.pipeline || '__x'; if (!byPipe.has(k)) byPipe.set(k, []); byPipe.get(k).push(r) }
    if (byPipe.size < 2) return null
    const out = []
    for (const [k, rs] of byPipe) {
      const lt = rs[0].leadBase || leadTotal
      out.push({ id: k, name: k === '__x' ? 'Unscoped' : (nameOf.get(k) || 'Pipeline'), ...makeFunnel([{ label: 'Leads', v: lt }, ...rs.map((r) => ({ label: r.label, v: r.count }))]) })
    }
    return out
  })() : null
  const single = makeFunnel(raw)
  const rows = single.rows, top = single.top, worst = single.worst
  // Paid channel view → show cost per stage + forward (next-step) conversion.
  const paidMode = (chan === 'paid' || chan === 'meta' || chan === 'google') && stageSpend > 0
  const chanLbl = chan === 'meta' ? 'Meta' : chan === 'google' ? 'Google' : 'paid'
  // Render one funnel's bars (shared by the single and per-pipeline layouts).
  const funnelBlock = (fnl) => (
    <div className={`bn-funnel${paidMode ? ' bn-paid' : ''}`}>
      {paidMode ? <div className="bn-row bn-head">
        <span className="bn-lab" /><span className="bn-track" /><span className="bn-count">Reached</span>
        <span className="bn-conv">Step</span><span className="bn-cost">Cost</span><span className="bn-next">→ Next</span>
      </div> : null}
      {fnl.rows.map((r, i) => {
        const isWorst = fnl.worst && r === fnl.worst
        const cost = (stageSpend && r.v) ? stageSpend / r.v : null
        return (
          <div className={`bn-row${paidMode ? ' bn-row-paid' : ''} ${isWorst ? 'bn-worst' : ''}`} key={i}>
            <span className="bn-lab">{r.label}</span>
            <span className="bn-track"><span className="bn-fill" style={{ width: `${Math.max(2, (r.v / fnl.top) * 100)}%` }} /></span>
            <span className="bn-count">{fmtNumber(r.v)}</span>
            <span className="bn-conv">{r.conv == null ? '' : `${Math.round(r.conv * 100)}%`}</span>
            {paidMode ? <span className="bn-cost" title={`${chanLbl} spend ÷ ${r.label} reached`}>{cost != null ? money(Math.round(cost)) : '—'}</span> : null}
            {paidMode ? <span className="bn-next" title="Conversion into the next step">{r.next == null ? '—' : `→ ${Math.round(r.next * 100)}%`}</span> : null}
          </div>
        )
      })}
    </div>
  )
  // Calendar show-rate bars — shown / occurred per calendar (own card).
  const showCals = ((cc && cc.bookingByCalendar) || []).filter((c) => c.occurred > 0)
  // Open pipeline by stage — who's still in play, and where they came from.
  const openStages = (cc && cc.openByStage) || []
  const totOpen = openStages.reduce((a, s) => a + s.count, 0)
  const totOpenVal = openStages.reduce((a, s) => a + s.value, 0)
  const multiPipe = new Set(openStages.map((s) => s.pipeline)).size > 1
  return (
    <>
    <div className="card exec-bottleneck">
      <div className="exec-panel-h">Revenue bottleneck {bnGroups ? <span className="sub">· one funnel per pipeline</span> : worst ? <span className="sub">· biggest drop-off: <b>{worst.prev != null ? rows[rows.indexOf(worst) - 1].label : ''} → {worst.label}</b> ({Math.round(worst.conv * 100)}% through, {fmtNumber(worst.drop)} lost)</span> : <span className="sub">· {usingKe ? 'your key events' : 'default funnel'}</span>}{paidMode ? <span className="sub"> · {chanLbl} cost view</span> : null}</div>
      {bnGroups
        ? bnGroups.map((g) => (
          <div className="bn-pipe-grp" key={g.id}>
            <div className="bn-pipe-lab">{g.name} <span className="sub">· {fmtNumber(g.rows[0].v)} leads{g.worst ? ` · biggest drop: ${g.rows[g.rows.indexOf(g.worst) - 1].label} → ${g.worst.label} (${Math.round(g.worst.conv * 100)}%)` : ''}</span></div>
            {funnelBlock(g)}
          </div>
        ))
        : funnelBlock(single)}
      {openStages.length ? <div className="bn-open">
        <div className="bn-open-h">Open pipeline by stage <span className="sub">· {fmtNumber(totOpen)} live · {money(totOpenVal)} · click a stage to see who’s in it · click a lead for their notes</span></div>
        {openStages.map((s) => {
          const on = openStage === s.key
          return (
            <div key={s.key} className="bn-open-item">
              <button className={`bn-open-row${on ? ' on' : ''}`} onClick={() => setOpenStage(on ? null : s.key)}>
                <span className="bn-open-stage">{s.stage}{multiPipe ? <span className="bn-open-pipe"> · {s.pipeline}</span> : null}</span>
                <span className="bn-open-meta"><b>{fmtNumber(s.count)}</b> open · <b>{money(s.value)}</b></span>
                <span className="bn-open-caret">{on ? '▾' : '→'}</span>
              </button>
              {on ? <div className="bn-open-deals"><table className="mini-tbl users-tbl">
                <thead><tr><th className="lft">Contact</th><th className="lft">Assigned</th><th className="lft">Source</th><th>Value</th><th>Days in stage</th></tr></thead>
                <tbody>{s.deals.map((d, i) => <BnDealRow key={i} d={d} clientId={clientId} money={money} />)}</tbody>
              </table></div> : null}
            </div>
          )
        })}
      </div> : null}
      <p className="caveat">Step % is each stage as a share of the one above it. The flagged step is where the most opportunities are lost — the place a small improvement moves the most revenue.{paidMode ? ` Cost = ${chanLbl} spend (${money(Math.round(stageSpend))}) ÷ everyone who reached that stage; → Next = the share who move on to the following step.` : ''}{usingKe ? ' Funnel steps are this client’s configured key events.' : ''}{openStages.length ? ' Open-by-stage counts are the deals sitting in each stage right now (not the cumulative funnel above).' : ''}</p>
    </div>
    {showCals.length ? <div className="card exec-bottleneck">
      <div className="exec-panel-h">Show rate by calendar <span className="sub">· shown ÷ occurred per booked calendar</span></div>
      <div className="bn-funnel">
        {showCals.map((c, i) => { const sr = c.occurred ? c.shown / c.occurred : 0; return (
          <div className="bn-row" key={i}>
            <span className="bn-lab" title={c.calendar}>{c.calendar}</span>
            <span className="bn-track"><span className="bn-fill" style={{ width: `${Math.max(2, sr * 100)}%`, background: sr >= 0.6 ? '#12b886' : sr >= 0.4 ? 'var(--brand)' : '#d64545' }} /></span>
            <span className="bn-count">{fmtNumber(c.shown)}/{fmtNumber(c.occurred)}</span>
            <span className="bn-conv">{Math.round(sr * 100)}%</span>
          </div>
        ) })}
      </div>
      <p className="caveat">Show rate is how many booked calls actually happened. Green ≥ 60%, red &lt; 40%.</p>
    </div> : null}
    </>
  )
}

// Aggregates the per-user CRM feed (scope=users) into whole-account totals for
// the command centre: open / lost counts + values and the merged lost-reason
// breakdown (with names), which the health payload doesn't carry.
function useCrmAgg(clientId, range, nonce, channel = 'all') {
  const [d, setD] = useState(null)
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true; setD(null)
    fetch(`/.netlify/functions/windsor?scope=users&client=${clientId}&channel=${channel}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => r.json()).then((j) => {
        if (!alive) return
        const us = (j && j.users) || []
        const a = { opps: 0, open: 0, openValue: 0, lost: 0, lostValue: 0, won: 0, revenue: 0, booked: 0, shown: 0 }
        const rs = {}
        for (const u of us) {
          a.opps += u.leads || 0; a.open += u.open || 0; a.openValue += u.openValue || 0
          a.lost += u.lost || 0; a.lostValue += u.lostValue || 0; a.won += u.won || 0; a.revenue += u.revenue || 0
          a.booked += u.booked || 0; a.shown += u.shown || 0
          for (const r of (u.lostReasons || [])) { const e = rs[r.reason] || { reason: r.reason, count: 0, value: 0 }; e.count += r.count; e.value += r.value || 0; rs[r.reason] = e }
        }
        a.lostReasons = Object.values(rs).sort((x, y) => y.count - x.count)
        setD(a)
      }).catch(() => { if (alive) setD(null) })
    return () => { alive = false }
  }, [clientId, q, nonce, channel])
  return d
}
// Command-centre drill dataset (scope=ccdrill) — backs every clickable tile.
// Channel-scoped: passing a channel re-pivots the whole drill (funnel, open-by-
// stage, sources, revenue, lost, close, bookings) to that channel's opportunities.
function useCcDrill(clientId, range, nonce = 0, channel = 'all') {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    let alive = true
    setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=ccdrill&client=${clientId}&channel=${channel}&${q}${nonce ? `&_r=${nonce}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, q, nonce, channel])
  return st
}
const pctOf = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const chLabel = (ch) => ch === 'meta' ? 'Meta' : ch === 'google' ? 'Google' : ch === 'other' ? 'Other' : ch

// One lost opportunity — shows the lead's source trail (opportunity source, UTM
// source, first-touch content) + any form answers, and expands on click to that
// contact's Caalano Systems notes.
function LostPersonRow({ p, clientId, money }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = () => {
    setLoading(true)
    const q = new URLSearchParams({ scope: 'oppnotes', client: clientId })
    if (p.contactId) q.set('contact', p.contactId)
    fetch(`/.netlify/functions/windsor?${q.toString()}`).then((r) => r.json()).then((j) => setNotes((j && j.notes) || [])).catch(() => setNotes([])).finally(() => setLoading(false))
  }
  const toggle = () => { const nx = !open; setOpen(nx); if (nx && notes === null && !loading && p.contactId) load() }
  const hasSrc = p.oppSource || p.utmSource || p.utmContent || p.channelSource
  return (
    <div className={`cc-drill-row${p.contactId ? ' cc-click' : ''}`} style={{ cursor: p.contactId ? 'pointer' : 'default' }} onClick={p.contactId ? toggle : undefined}>
      <b>{p.contactId ? <span className="u-chev">{open ? '▾' : '▸'}</span> : null} {p.name}</b> <span className="cc-drill-ans">{p.stage || 'no stage'}{p.pipeline ? ` · ${p.pipeline}` : ''}{p.value ? ` · ${money(p.value)}` : ''}
        {hasSrc ? <div className="cc-src-line">
          {p.oppSource ? <span><b>Opp source:</b> {p.oppSource}</span> : null}
          {p.channelSource ? <span><b>Channel:</b> {p.channelSource}</span> : null}
          {p.utmSource ? <span><b>UTM source:</b> {p.utmSource}</span> : null}
          {p.utmContent ? <span><b>UTM content:</b> {p.utmContent}</span> : null}
        </div> : null}
        {(p.formAnswers || []).length ? <div style={{ marginTop: 3 }}>{p.formAnswers.map((a, j) => <div key={j}><b>{a.q}:</b> {a.a}</div>)}</div> : <div style={{ marginTop: 3, opacity: .7 }}>No form answers captured.</div>}
        {open ? <div className="lost-notes">{loading ? <Spinner label="Loading notes…" /> : notes && notes.length ? <div className="u-notes">{notes.map((n, i) => <div className="u-note-item" key={i}><div className="u-note-meta">{n.author || 'Team'}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleDateString()}` : ''}</div><div className="u-note-body">{n.body}</div></div>)}</div> : <div className="cap" style={{ padding: '4px 0 2px' }}>No notes on this contact in Caalano Systems.</div>}</div> : null}
      </span>
    </div>
  )
}
// One reusable modal for every command-centre drill. `drill` = { kind, title }.
// Reads the ccdrill payload and renders the right table; supports one level of
// nested drill-in (calendar -> people, source -> opps, channel -> won deals).
function CcDrillModal({ drill, cc, money, clientId, onClose }) {
  const [sub, setSub] = useState(null)
  useEffect(() => { setSub(drill && drill.preselect ? drill.preselect : null) }, [drill])
  if (!drill) return null
  const d = cc || {}
  const spend = d.spend || {}, paid = d.paid || {}
  let title = drill.title, subhead = null, body = null
  if (drill.kind === 'booking') {
    if (sub) {
      const cal = sub
      title = cal.calendar
      subhead = `${fmtNumber(cal.booked)} booked · ${fmtNumber(cal.occurred)} occurred · ${fmtNumber(cal.shown)} shown`
      body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Contact</th><th>Occurred</th><th>Shown</th></tr></thead>
        <tbody>{(cal.people || []).map((p, i) => <tr key={i}><td className="lft">{p.name}</td><td>{p.occurred ? '✓' : '—'}</td><td>{p.shown ? '✓' : '—'}</td></tr>)}</tbody></table>
    } else {
      const cals = d.bookingByCalendar || []
      subhead = `${fmtNumber(cals.length)} ${cals.length === 1 ? 'calendar' : 'calendars'} · click a calendar for who booked in`
      body = cals.length ? cals.map((c, i) => <button key={i} className="cc-drill-row" onClick={() => setSub(c)}>
        <b>{c.calendar}</b> <span className="cc-drill-ans">{fmtNumber(c.booked)} booked · {fmtNumber(c.occurred)} occurred · {fmtNumber(c.shown)} shown{c.occurred ? ` · ${pctOf(c.shown, c.occurred)} show rate` : ''}</span></button>)
        : <div className="cap">No calendar bookings in this period.</div>
    }
  } else if (drill.kind === 'revenue') {
    const deals = (d.revenue && d.revenue.deals) || []
    subhead = `${fmtNumber(deals.length)} won ${deals.length === 1 ? 'deal' : 'deals'} · ${money((d.revenue && d.revenue.total) || 0)}`
    body = deals.length ? <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Deal</th><th>Value</th><th>Closed</th><th>Channel</th></tr></thead>
      <tbody>{deals.slice().sort((a, b) => b.value - a.value).map((dl, i) => <tr key={i}><td className="lft">{dl.name}</td><td>{money(dl.value)}</td><td>{dl.closeDate || '—'}</td><td>{chLabel(dl.channel)}</td></tr>)}</tbody></table>
      : <div className="cap">No won deals in this period.</div>
  } else if (drill.kind === 'spend') {
    subhead = `${money(spend.total || 0)} total ad spend`
    body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Platform</th><th>Spend</th><th>Share</th></tr></thead>
      <tbody>
        <tr><td className="lft">Meta</td><td>{money(spend.meta || 0)}</td><td>{pctOf(spend.meta, spend.total)}</td></tr>
        <tr><td className="lft">Google</td><td>{money(spend.google || 0)}</td><td>{pctOf(spend.google, spend.total)}</td></tr>
      </tbody></table>
  } else if (drill.kind === 'opps') {
    if (sub) {
      const s = sub
      title = s.source
      subhead = `${fmtNumber(s.count)} ${s.count === 1 ? 'opportunity' : 'opportunities'} · ${money(s.value)}`
      body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Contact</th><th className="lft">Status</th><th className="lft">Stage</th><th>Value</th></tr></thead>
        <tbody>{(s.opps || []).map((o, i) => <tr key={i}><td className="lft">{o.name}</td><td className="lft">{o.status}</td><td className="lft">{o.stage || '—'}</td><td>{money(o.value)}</td></tr>)}</tbody></table>
    } else {
      const src = d.oppsBySource || []
      subhead = `${fmtNumber(src.reduce((a, s) => a + s.count, 0))} opportunities by source · click a source`
      body = src.length ? src.map((s, i) => <button key={i} className="cc-drill-row" onClick={() => setSub(s)}>
        <b>{s.source}</b> <span className="cc-drill-ans">{fmtNumber(s.count)} {s.count === 1 ? 'opp' : 'opps'} · {money(s.value)} · {s.kind}</span></button>)
        : <div className="cap">No opportunities in this period.</div>
    }
  } else if (drill.kind === 'cpl') {
    subhead = `Paid-attributed · ${fmtNumber(paid.paidLeads || 0)} paid leads from ${money(spend.total || 0)} spend`
    body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Channel</th><th>Spend</th><th>Leads</th><th>Cost / lead</th></tr></thead>
      <tbody>
        <tr><td className="lft">Meta</td><td>{money(spend.meta || 0)}</td><td>{fmtNumber(paid.metaLeads || 0)}</td><td>{paid.metaCpl != null ? money(paid.metaCpl) : '—'}</td></tr>
        <tr><td className="lft">Google</td><td>{money(spend.google || 0)}</td><td>{fmtNumber(paid.googleLeads || 0)}</td><td>{paid.googleCpl != null ? money(paid.googleCpl) : '—'}</td></tr>
        <tr><td className="lft"><b>Paid total</b></td><td>{money(spend.total || 0)}</td><td>{fmtNumber(paid.paidLeads || 0)}</td><td>{paid.paidCpl != null ? money(paid.paidCpl) : '—'}</td></tr>
      </tbody></table>
  } else if (drill.kind === 'cpwon') {
    subhead = `Paid-attributed · ${fmtNumber(paid.paidWon || 0)} won from paid channels`
    body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Channel</th><th>Spend</th><th>Won</th><th>Cost / won</th></tr></thead>
      <tbody>
        <tr><td className="lft">Meta</td><td>{money(spend.meta || 0)}</td><td>{fmtNumber(paid.metaWon || 0)}</td><td>{paid.metaCpa != null ? money(paid.metaCpa) : '—'}</td></tr>
        <tr><td className="lft">Google</td><td>{money(spend.google || 0)}</td><td>{fmtNumber(paid.googleWon || 0)}</td><td>{paid.googleCpa != null ? money(paid.googleCpa) : '—'}</td></tr>
        <tr><td className="lft"><b>Paid total</b></td><td>{money(spend.total || 0)}</td><td>{fmtNumber(paid.paidWon || 0)}</td><td>{paid.paidCpa != null ? money(paid.paidCpa) : '—'}</td></tr>
      </tbody></table>
  } else if (drill.kind === 'openvalue') {
    const deals = (d.open && d.open.deals) || []
    subhead = `${fmtNumber((d.open && d.open.total) || 0)} open · ${money((d.open && d.open.value) || 0)} in pipeline`
    body = deals.length ? <div className="tbl-scroll"><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Deal</th><th>Value</th><th className="lft">Stage</th><th className="lft">Pipeline</th><th>Age</th></tr></thead>
      <tbody>{deals.map((dl, i) => <tr key={i}><td className="lft">{dl.name}</td><td>{money(dl.value)}</td><td className="lft">{dl.stage || '—'}</td><td className="lft">{dl.pipeline}</td><td>{dl.ageDays != null ? `${dl.ageDays}d` : '—'}</td></tr>)}</tbody></table></div>
      : <div className="cap">No open deals in this period.</div>
  } else if (drill.kind === 'close') {
    if (sub) {
      const c = sub
      title = `${chLabel(c.channel)} — won deals`
      subhead = `${fmtNumber(c.won)} won of ${fmtNumber(c.closed)} closed · ${c.closeRate != null ? c.closeRate + '%' : '—'} close rate`
      body = <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Deal</th><th>Value</th><th>Closed</th></tr></thead>
        <tbody>{(c.deals || []).map((dl, i) => <tr key={i}><td className="lft">{dl.name}</td><td>{money(dl.value)}</td><td>{dl.closeDate || '—'}</td></tr>)}</tbody></table>
    } else {
      const chans = d.closeByChannel || []
      subhead = 'Close rate by channel · click a channel for its won deals'
      body = chans.length ? chans.map((c, i) => <button key={i} className="cc-drill-row" onClick={() => setSub(c)}>
        <b>{chLabel(c.channel)}</b> <span className="cc-drill-ans">{fmtNumber(c.won)} won / {fmtNumber(c.closed)} closed · <b>{c.closeRate != null ? c.closeRate + '%' : '—'}</b> close rate</span></button>)
        : <div className="cap">No closed deals in this period.</div>
    }
  } else if (drill.kind === 'lost') {
    if (sub) {
      const r = sub
      title = `Lost — ${r.reason}`
      subhead = `${fmtNumber(r.count)} lost · ${money(r.value || 0)} · click a lead for their notes`
      body = (r.people || []).length ? (r.people || []).map((p, i) => <LostPersonRow key={i} p={p} clientId={clientId} money={money} />)
        : <div className="cap">No people recorded for this reason.</div>
    } else {
      const reasons = d.lostByReason || []
      subhead = `${fmtNumber(reasons.reduce((a, r) => a + r.count, 0))} lost · click a reason for who + what they typed`
      body = reasons.length ? reasons.map((r, i) => <button key={i} className="cc-drill-row" onClick={() => setSub(r)}>
        <b>{r.reason}</b> <span className="cc-drill-ans">{fmtNumber(r.count)} lost{r.value ? ` · ${money(r.value)}` : ''}</span></button>)
        : <div className="cap">No lost opportunities recorded this period.</div>
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780 }}>
        <div className="m-head"><div><h3 style={{ margin: 0 }}>{title}</h3>{subhead ? <span className="cap">{subhead}</span> : null}</div><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          {sub ? <button className="cc-back" onClick={() => setSub(null)}>← Back</button> : null}
          {body}
        </div>
      </div>
    </div>
  )
}

const CC_CHANS = [['all', 'All'], ['paid', 'Paid'], ['nonpaid', 'Non-paid'], ['google', 'Google'], ['meta', 'Meta']]
function ExecutiveDashboard({ clientId, clientName, currency, range, nonce, onNav, authUser }) {
  const [reload, setReload] = useState(0)
  const [chan, setChan] = useState('all')
  useEffect(() => { setChan('all') }, [clientId])
  const health = useHealth(clientId, range, nonce, reload)
  const crmAgg = useCrmAgg(clientId, range, nonce, chan)
  const ccDrill = useCcDrill(clientId, range, nonce, chan)
  const cc = (ccDrill.status === 'ok' && ccDrill.data && ccDrill.data.oppsBySource) ? ccDrill.data : null
  const [drill, setDrill] = useState(null)
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
  const actions = priorityActions(h, money, crmAgg)
  return (
    <div className="exec-wrap">
      {/* Command centre — all of Caalano Systems + spend, pivoting on the range */}
      {(() => {
        const ca = crmAgg || {}
        const chActive = chan !== 'all'
        // Every metric follows the channel toggle. CRM counts come from the
        // channel-scoped scope=users feed (crmAgg); spend + paid cost figures are
        // sliced per channel from health.channels + the ccdrill paid feed.
        const chn = h.channels || {}
        const p = (cc && cc.paid) || {}
        // Channel-scoped ad spend.
        const chanSpend = chan === 'all' ? k.adSpend
          : chan === 'meta' ? chn.metaSpend
            : chan === 'google' ? chn.googleSpend
              : chan === 'paid' ? ((chn.metaSpend || 0) + (chn.googleSpend || 0))
                : 0 // non-paid has no ad spend
        // Cost per lead / won for the selected channel (paid-attributed). Non-paid
        // has no attributable spend, so cost figures are n/a there.
        const cplV = chan === 'meta' ? p.metaCpl : chan === 'google' ? p.googleCpl : chan === 'nonpaid' ? null : p.paidCpl
        const cpaV = chan === 'meta' ? p.metaCpa : chan === 'google' ? p.googleCpa : chan === 'nonpaid' ? null : p.paidCpa
        const paidCpl = cplV != null ? Math.round(cplV) : null
        const paidCpa = cpaV != null ? Math.round(cpaV) : null
        // CRM counts come from the same per-opportunity feed as the drills (crmAgg
        // / scope=users) in BOTH the all and channel views, so the scorecard, the
        // funnel and every drill always agree on the opportunity count. Health (k)
        // is only a fallback while crmAgg is still loading.
        const oppsV = ca.opps != null ? ca.opps : k.leads
        const bookedV = ca.booked != null ? ca.booked : k.booked
        const shownV = ca.shown != null ? ca.shown : k.shown
        const wonV = ca.won != null ? ca.won : k.won
        const revV = ca.revenue != null ? ca.revenue : k.revenue
        const avgV = wonV ? Math.round((revV || 0) / wonV) : (ca.won != null ? null : k.avgDeal)
        const openV = ca.open != null ? ca.open : null
        const openValV = ca.openValue != null ? ca.openValue : (k.openValue != null ? k.openValue : null)
        const lost = ca.lost != null ? ca.lost : null
        const cpBookedV = (chanSpend && bookedV) ? Math.round(chanSpend / bookedV) : (chActive ? null : k.cpBooked)
        const roas = (chanSpend && revV) ? revV / chanSpend : null
        const cpl2 = (!chActive && pv.leads && pv.adSpend) ? Math.round(pv.adSpend / pv.leads) : null
        const tileClick = (drill2) => (cc ? () => setDrill(drill2) : undefined)
        // Key-event reach as rates — each selected key event as a share of leads.
        // Denominator/won come from the ccdrill totals (same opportunity basis as
        // the funnel numerators) in both all and channel views.
        const kefTot = (cc && cc.totals) || null
        const kef = ccKeyEventFunnel(cc, clientId, kefTot ? kefTot.won : k.won, kefTot ? kefTot.leads : k.leads)
        return <div className="exec-cc">
          <div className="exec-panel-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Command centre <span className="sub">· all of Caalano Systems for {rangeLabel(range)}{chan !== 'all' ? ` · ${CC_CHANS.find((c) => c[0] === chan)[1]}` : ''}</span></span>
            <div className="chan-toggle sm">{CC_CHANS.map(([kk, lbl]) => <button key={kk} className={chan === kk ? 'on' : ''} onClick={() => setChan(kk)}>{lbl}</button>)}</div>
          </div>
          <div className="cc-group-lab x-internal">Spend &amp; efficiency{chActive ? <span className="sub" style={{ fontWeight: 500 }}> · {CC_CHANS.find((c) => c[0] === chan)[1]}</span> : null}</div>
          <div className="scorecard exec-kpis exec-kpis-4 x-internal">
            <Kpi label="Ad spend" value={chanSpend != null ? money(chanSpend) : '—'} cur={chActive ? null : k.adSpend} prev={chActive ? null : pv.adSpend} goodWhenDown onClick={tileClick({ kind: 'spend', title: 'Ad spend by platform' })} />
            <Kpi label="Cost / lead (paid)" value={paidCpl != null ? money(paidCpl) : '—'} cur={paidCpl} goodWhenDown onClick={tileClick({ kind: 'cpl', title: 'Cost per lead — paid attributed' })} />
            <Kpi label="Cost / booked" value={cpBookedV != null ? money(cpBookedV) : '—'} cur={cpBookedV} goodWhenDown />
            <Kpi label="Cost / won (paid)" value={paidCpa != null ? money(paidCpa) : '—'} cur={paidCpa} goodWhenDown onClick={tileClick({ kind: 'cpwon', title: 'Cost per won — paid attributed' })} />
          </div>
          <div className="cc-group-lab">Pipeline &amp; revenue{chActive ? <span className="sub" style={{ fontWeight: 500 }}> · {CC_CHANS.find((c) => c[0] === chan)[1]} only</span> : null} <span className="sub" style={{ fontWeight: 500 }}>· top row is the funnel; the small line under each number is its rate</span></div>
          <div className="scorecard exec-kpis exec-kpis-4">
            <Kpi label="Opportunities" value={oppsV != null ? fmtNumber(oppsV) : '—'} flat="new this period" onClick={tileClick({ kind: 'opps', title: 'Opportunities by source' })} />
            <Kpi label="Booked" value={bookedV != null ? fmtNumber(bookedV) : '—'} flat={oppsV ? `${pctOf(bookedV, oppsV)} booking rate` : ' '} onClick={tileClick({ kind: 'booking', title: 'Booked — by calendar' })} />
            <Kpi label="Shown" value={shownV != null ? fmtNumber(shownV) : '—'} flat={bookedV ? `${pctOf(shownV, bookedV)} show rate` : ' '} onClick={tileClick({ kind: 'booking', title: 'Show rate — by calendar' })} />
            <Kpi label="Won" value={wonV != null ? fmtNumber(wonV) : '—'} flat={oppsV ? `${pctOf(wonV, oppsV)} conversion` : ' '} onClick={tileClick({ kind: 'revenue', title: 'Won deals' })} />
            <Kpi label="Revenue" value={revV != null ? money(revV) : '—'} flat={`${avgV != null ? `avg ${money(avgV)}` : ''}${avgV != null && roas != null ? ' · ' : ''}${roas != null ? `${roas.toFixed(1)}x ROAS` : ''}` || ' '} onClick={tileClick({ kind: 'revenue', title: 'Revenue — won deals' })} />
            <Kpi label="Open pipeline" value={openV != null ? fmtNumber(openV) : '—'} flat={openValV != null ? `${money(openValV)} in play` : ' '} onClick={tileClick({ kind: 'openvalue', title: 'Open pipeline' })} />
            <Kpi label="Lost" value={lost != null ? fmtNumber(lost) : '—'} flat={ca.lostValue != null ? `${money(ca.lostValue)} lost` : ' '} goodWhenDown onClick={tileClick({ kind: 'lost', title: 'Lost opportunities' })} />
            <Kpi label="Close rate" value={lost != null ? pctOf(wonV, (wonV || 0) + lost) : '—'} flat="won ÷ closed" onClick={tileClick({ kind: 'close', title: 'Close rate — by channel' })} />
          </div>
          {kef.usingKe && kef.rows.length ? <>
            <div className="cc-group-lab">Key event reach <span className="sub" style={{ fontWeight: 500 }}>· {kef.multi ? "share of each event's pipeline leads" : `share of ${fmtNumber(kef.leadTotal)} ${chActive ? `${CC_CHANS.find((c) => c[0] === chan)[1]} leads` : 'leads'}`}</span></div>
            <div className="scorecard exec-kpis">
              {kef.rows.map((r, i) => { const base = r.leadBase || kef.leadTotal; return <Kpi key={i} label={r.label} value={base ? `${Math.round((r.count / base) * 100)}%` : '—'} flat={`${fmtNumber(r.count)} of ${fmtNumber(base)}`} /> })}
            </div>
          </> : null}
        </div>
      })()}

      {/* Revenue bottleneck funnel — client key events + calendar show-rate.
          Passes the selected channel's spend so a paid view shows cost/stage. */}
      {(() => { const chn = h.channels || {}; const bnSpend = chan === 'meta' ? (chn.metaSpend || 0) : chan === 'google' ? (chn.googleSpend || 0) : chan === 'paid' ? ((chn.metaSpend || 0) + (chn.googleSpend || 0)) : chan === 'all' ? (k.adSpend || 0) : 0
        return <BottleneckPanel kpis={k} money={money} clientId={clientId} cc={cc} health={h} currency={currency} chan={chan} stageSpend={bnSpend} /> })()}

      {/* Lost reasons — full width so the table never needs to scroll sideways.
          Rows are clickable → the per-reason people + their form answers. */}
      <div className="card">
        <div className="exec-panel-h">Lost reasons {crmAgg && crmAgg.lost ? <span className="sub">· {fmtNumber(crmAgg.lost)} lost{crmAgg.lostValue ? `, ${money(crmAgg.lostValue)}` : ''}{cc ? ' · click a reason for who + what they typed' : ''}</span> : null}</div>
        {!crmAgg ? <Spinner label="" />
          : !(crmAgg.lostReasons && crmAgg.lostReasons.length) ? <div className="cap">No lost opportunities recorded this period. ✅</div>
            : <table className="mini-tbl users-tbl lr-tbl"><thead><tr><th className="lft">Reason</th><th>Deals</th><th>Value</th><th>Share</th></tr></thead>
              <tbody>{crmAgg.lostReasons.slice(0, 12).map((r, i) => {
                const ccReason = cc && (cc.lostByReason || []).find((x) => x.reason === r.reason)
                return <tr key={i} className={ccReason ? 'lr-click' : ''} style={ccReason ? { cursor: 'pointer' } : undefined} onClick={ccReason ? () => setDrill({ kind: 'lost', title: 'Lost opportunities', preselect: ccReason }) : undefined}><td className="lft">{r.reason}</td><td>{fmtNumber(r.count)}</td><td>{r.value ? money(r.value) : '—'}</td><td>{pctOf(r.count, crmAgg.lost)}</td></tr>
              })}</tbody></table>}
      </div>

      {/* Channel split (spend is internal — hidden in present mode) */}
      <div className="card x-internal">
        <div className="exec-panel-h">Channel split</div>
        {(() => { const ch = h.channels || {}; const hasCh = (ch.metaSpend || 0) > 0 || (ch.googleSpend || 0) > 0
          if (!hasCh) return <div className="cap">No paid channel spend in this period.</div>
          return <table className="mini-tbl users-tbl"><thead><tr><th className="lft">Channel</th><th>Spend</th><th>Leads / conv</th></tr></thead>
            <tbody>
              <tr><td className="lft">Meta</td><td>{money(ch.metaSpend || 0)}</td><td>{fmtNumber(ch.metaLeads || 0)}</td></tr>
              <tr><td className="lft">Google</td><td>{money(ch.googleSpend || 0)}</td><td>{fmtNumber(ch.googleConv || 0)}</td></tr>
            </tbody></table>
        })()}
      </div>

      {/* Per-pipeline breakdown — only when the client runs more than one */}
      {h.pipelines && h.pipelines.length > 1 && <div className="card">
        <div className="exec-panel-h">By pipeline <span className="sub">· dive deeper in the CRM tab</span></div>
        <div className="tbl-scroll"><table className="mini-tbl users-tbl">
          <thead><tr><th className="lft">Pipeline</th><th>Opps</th><th>Booked</th><th>Won</th><th>Lost</th><th>Open</th><th>Revenue</th><th>Open value</th></tr></thead>
          <tbody>{h.pipelines.map((p, i) => <tr key={i}><td className="lft">{p.name}</td><td>{fmtNumber(p.leads || 0)}</td><td>{fmtNumber(p.booked || 0)}</td><td>{fmtNumber(p.won || 0)}</td><td>{fmtNumber(p.lost || 0)}</td><td>{fmtNumber(p.open || 0)}</td><td>{money(p.revenue || 0)}</td><td>{money(p.openValue || 0)}</td></tr>)}</tbody>
        </table></div>
      </div>}

      {/* Priority actions — a prioritised read of the command centre */}
      <div className="card exec-actions">
        <div className="exec-panel-h">Priority actions</div>
        {actions.length ? <ul className="exec-act-list">{actions.map((a, i) => <li key={i} className={`exec-act sev-${a.sev}`}><span className="exec-act-dot" />{a.text}</li>)}</ul>
          : <div className="cap">Nothing flagged this period — the numbers are tracking with or ahead of last period.</div>}
        <div className="exec-nav"><button className="link-btn" onClick={() => onNav && onNav('users')}>Open the Users tab →</button></div>
      </div>

      {/* Revenue at risk */}
      <AtRiskPanel clientId={clientId} range={range} nonce={nonce} money={money} />

      <div className="cap exec-foot">All figures pivot on the selected date range, live from Caalano Systems and the ad platforms. Open any tab above to dive deeper. Messaging/response signals are indicative only — clients may reply on channels outside Caalano Systems.</div>

      {drill && cc && <CcDrillModal drill={drill} cc={cc} money={money} clientId={clientId} onClose={() => setDrill(null)} />}
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
  // Multi-pipeline "all" view: split the key-events funnel per pipeline so each has
  // its OWN Leads denominator and step-conversions. Otherwise a [BA] event divided
  // by the previous [FIN] step gives nonsense (e.g. 170% / 120%).
  const kePerPipe = (pid === 'all' && pipesSrc.length > 1 && keConfigured.length) ? (() => {
    const byPipe = new Map()
    for (const r of keRows) { const k = r.pipeline || '__x'; if (!byPipe.has(k)) byPipe.set(k, []); byPipe.get(k).push(r) }
    const pipeLeads = (id) => { const p = pipesSrc.find((x) => x.id === id); return p ? Math.max(1, (p.stages || []).reduce((s, x) => s + (x.count || 0), 0)) : keTotal }
    const out = []
    for (const p of pipesSrc) { const rows = byPipe.get(p.id); if (rows && rows.length) out.push({ id: p.id, name: p.name, rows, total: pipeLeads(p.id) }) }
    const un = byPipe.get('__x'); if (un && un.length) out.push({ id: '__x', name: 'Unscoped', rows: un, total: keTotal })
    return out.length > 1 ? out : null
  })() : null
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
        const oCamp = aliasedOutcomeMap(client.id, 'campaign', attribData.byCampaign)
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
        {kePerPipe
          ? <div className="ke-pipe-stack">{kePerPipe.map((g) => (
              <KeyEventsFunnel
                key={g.id} rows={g.rows} total={g.total} spend={spend} currency={currency}
                title={`Key events · ${g.name}`}
                sub={`${g.name} · reached · % of this pipeline's ${fmtNumber(g.total)} leads${g.rows.some((r) => r.kind === 'calendar') ? ' · show %' : ''} · cost per event${chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''}`}
                caveat={<>Each pipeline's key events are scored against <b>its own</b> leads. 📅 = a booked calendar appointment; other rows = opportunities that reached that stage or beyond.</>}
              />
            ))}</div>
          : <KeyEventsFunnel
              rows={keRows} total={keTotal} spend={spend} currency={currency}
              title="Key events"
              sub={`${keConfigured.length ? 'Your key events' : 'Default: leads → booked → shown → won'} · reached · % of leads${keRows.some((r) => r.kind === 'calendar') ? ' · show %' : ''} · cost per event${chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''}`}
              caveat={<>{keConfigured.length ? 'Key events are the pipeline stages and booked calendars you selected in Settings.' : 'Set a client’s key events in Settings (pipeline stages and/or booked calendars) to replace the default stages.'} 📅 = a booked calendar appointment (cost per booked call); other rows = opportunities that reached that pipeline stage or beyond. Cost / event = attributed spend ({money(spend)}) ÷ count.</>}
            />}
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
    if (!g) { g = { value: v, leads: 0, booked: 0, shown: 0, won: 0, lost: 0, revenue: 0, members: [], people: [], _max: -1 }; groups.set(key, g) }
    g.leads += a.leads || 0; g.booked += a.booked || 0; g.shown += a.shown || 0; g.won += a.won || 0; g.lost += a.lost || 0; g.revenue += a.revenue || 0
    if (Array.isArray(a.people)) g.people.push(...a.people)
    g.members.push({ value: v, leads: a.leads || 0 })
    const canon = dt ? dt.display : (key.startsWith('state:') ? key.slice(6) : v)
    if (a.leads > g._max) { g._max = a.leads; g.value = canon }
  }
  return [...groups.values()].map(({ _max, ...g }) => ({ ...g, merged: g.members.length > 1 })).sort((a, b) => b.leads - a.leads)
}
// One question at a time: pick a question from the selector, then see that
// question's answer breakdown as a bar chart + table (answers grouped).
// Resolve a client's configured key events for the Forms drill, reusing the
// SAME helpers the CRM / Caalano360 views use (loadKeyEvents → keyEventsForPipe
// → stagePosMap → resolveKeyEvents). Returns the ordered events plus a per-person
// `reached(person, keyEvent)` test built from the person's stagePos / pipelineId /
// booked / status - so counting who reached each event never reinvents the
// key-event resolution.
function formKeyEvents(clientId, pipe, pipes) {
  const stagePos = stagePosMap(pipes || [])
  const kePipe = pipe && !String(pipe).startsWith('link:') ? pipe : 'all'
  const events = resolveKeyEvents(keyEventsForPipe(loadKeyEvents(clientId), kePipe), stagePos)
  const posAt = (pipeline, name) => (pipeline && stagePos.has(pipeline + '::' + name) ? stagePos.get(pipeline + '::' + name) : stagePos.get(name))
  const keyPos = (k) => (k.kind === 'calendar' ? (k.stage ? posAt(k.pipeline, k.stage) : null) : posAt(k.pipeline, k.ref))
  const reachedStage = (p, k) => {
    const kp = keyPos(k)
    if (kp == null || p.stagePos == null) return false
    if (k.pipeline && p.pipelineId && k.pipeline !== p.pipelineId) return false
    return p.stagePos >= kp
  }
  const reached = (p, k) => {
    if (!p) return false
    if (k.kind === 'won' || WON_RE.test(k.label)) return p.status === 'won'
    if (p.status === 'won') return true // a won opp passed every earlier step
    if (k.kind === 'calendar') return !!p.booked || reachedStage(p, k)
    return reachedStage(p, k)
  }
  return { events, reached }
}
const CHAN_LABEL = { meta: 'Meta', google: 'Google', other: 'Other' }
function statusChip(status) { const s = status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'open'; return <span className={`sch ${s}`}>{s === 'won' ? 'Won' : s === 'lost' ? 'Lost' : 'Open'}</span> }
// One person in a form answer's drill-down. Expands to fetch that contact's CRM
// notes on demand - same pattern (and notes markup) as OpenDealRow.
function PersonRow({ p, clientId, money, cols }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = () => {
    setLoading(true)
    const q = new URLSearchParams({ scope: 'oppnotes', client: clientId })
    if (p.contactId) q.set('contact', p.contactId)
    fetch(`/.netlify/functions/windsor?${q.toString()}`).then((r) => r.json()).then((j) => setNotes((j && j.notes) || [])).catch(() => setNotes([])).finally(() => setLoading(false))
  }
  const toggle = () => { const nx = !open; setOpen(nx); if (nx && notes === null && !loading && p.contactId) load() }
  const cals = (p.calendars || []).filter((c) => c.name)
  return (
    <React.Fragment>
      <tr className={open ? 'row-sel' : ''} style={{ cursor: p.contactId ? 'pointer' : 'default' }} onClick={p.contactId ? toggle : undefined}>
        <td className="lft">{p.contactId ? <span className="u-chev">{open ? '▾' : '▸'}</span> : null} {p.name}</td>
        <td className="lft">{statusChip(p.status)}</td>
        <td className="lft">{p.stageName || '-'}{p.pipelineName && p.pipelineName !== 'Pipeline' ? <span className="cap"> · {p.pipelineName}</span> : null}</td>
        <td>{p.value ? money(p.value) : '-'}</td>
        <td className={p.ageDays != null && p.ageDays >= 30 ? 'u-stale' : ''}>{p.ageDays != null ? `${fmtNumber(p.ageDays)}d` : '-'}</td>
        <td className="lft">{cals.length ? cals.map((c, i) => <span key={i} className="fp-cal">{c.name}{(c.shown || c.occurred) ? <span className="fp-tick" title={c.shown ? 'Showed' : 'Occurred'}> ✓</span> : null}</span>) : (p.booked ? 'Booked' : '-')}</td>
        <td className="lft">{p.channel ? (CHAN_LABEL[p.channel] || p.channel) : '-'}</td>
      </tr>
      {open && <tr className="u-notes-row"><td colSpan={cols}>
        {loading ? <Spinner label="Loading notes…" /> : notes && notes.length ? <div className="u-notes">{notes.map((n, i) => <div className="u-note-item" key={i}><div className="u-note-meta">{n.author || 'Team'}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleDateString()}` : ''}</div><div className="u-note-body">{n.body}</div></div>)}</div> : <div className="cap" style={{ padding: '2px 2px 6px' }}>No notes on this contact in Caalano Systems.</div>}
      </td></tr>}
    </React.Fragment>
  )
}
function FormSegments({ segments, captured, currency, clientId, pipes, pipe }) {
  const money = (v) => fmtCurrency(v, currency)
  const [sel, setSel] = useState(0)
  const [openAns, setOpenAns] = useState(() => new Set())
  const ke = formKeyEvents(clientId, pipe, pipes)
  if (!segments || !segments.length) return <div className="form-seg-none">{captured > 0 ? `This form carried ${captured} field${captured === 1 ? '' : 's'}, but they were all name / email / phone / system fields we don't segment on.` : 'No question fields were captured on this form — its submissions only carried contact details (name / email / phone).'}</div>
  const s = segments[Math.min(sel, segments.length - 1)]
  const grouped = groupAnswers(s.answers)
  const chart = grouped.slice(0, 12).map((a) => ({ name: a.value.length > 22 ? a.value.slice(0, 21) + '…' : a.value, leads: a.leads, booked: a.booked, won: a.won }))
  const totalLeads = grouped.reduce((t, a) => t + a.leads, 0)
  const events = ke.events || []
  // Per-answer count of people who reached each key event (people are capped
  // server-side, so this reflects the sampled people list for the answer).
  const keCount = (a, k) => (a.people || []).reduce((n, p) => n + (ke.reached(p, k) ? 1 : 0), 0)
  const keTotals = events.map((k) => grouped.reduce((n, a) => n + keCount(a, k), 0))
  const toggleAns = (v) => setOpenAns((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })
  const totalCols = 10 + events.length // chevron, answer, leads, %, booked, book%, shown, won, win%, revenue + key events
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
        <div className="tbl-scroll">
        <table className="form-seg-t fseg-tbl">
          <thead>
            <tr><th style={{ width: 18 }} /><th>Answer</th><th className="num">Leads</th><th className="num">% of leads</th><th className="num">Booked</th><th className="num">Book %</th><th className="num">Shown</th><th className="num">Won</th><th className="num">Win %</th><th className="num">Revenue</th>{events.map((k, i) => <th key={i} className="num fke-col" title={`Reached: ${k.label}`}>{k.kind === 'calendar' ? '📅 ' : ''}{k.label}</th>)}</tr>
            {events.length ? <tr className="fseg-tot-row"><td /><td>All answers</td><td className="num">{fmtNumber(totalLeads)}</td><td className="num">-</td><td className="num">{fmtNumber(grouped.reduce((t, a) => t + a.booked, 0))}</td><td className="num">-</td><td className="num">{fmtNumber(grouped.reduce((t, a) => t + a.shown, 0))}</td><td className="num">{fmtNumber(grouped.reduce((t, a) => t + a.won, 0))}</td><td className="num">-</td><td className="num">{money(grouped.reduce((t, a) => t + a.revenue, 0))}</td>{keTotals.map((n, i) => <td key={i} className="num fke-col">{fmtNumber(n)}</td>)}</tr> : null}
          </thead>
          <tbody>{grouped.map((a) => {
            const isOpen = openAns.has(a.value)
            const people = a.people || []
            const clickable = people.length > 0
            return (
              <React.Fragment key={a.value}>
                <tr className={isOpen ? 'row-sel' : ''} style={{ cursor: clickable ? 'pointer' : 'default' }} onClick={clickable ? () => toggleAns(a.value) : undefined}>
                  <td className="num" style={{ color: 'var(--faint)' }}>{clickable ? (isOpen ? '▾' : '▸') : ''}</td>
                  <td title={a.merged ? `Combines: ${a.members.sort((x, y) => y.leads - x.leads).map((m) => `${m.value} (${m.leads})`).join(', ')}` : a.value}>{a.value}{a.merged ? <span className="ans-merged" title={`Combines ${a.members.length} spellings`}> ⓘ{a.members.length}</span> : null}</td>
                  <td className="num">{fmtNumber(a.leads)}</td>
                  <td className="num">{totalLeads ? fmtPct((a.leads / totalLeads) * 100, 0) : '-'}</td>
                  <td className="num">{fmtNumber(a.booked)}</td>
                  <td className="num">{a.leads ? fmtPct((a.booked / a.leads) * 100, 0) : '-'}</td>
                  <td className="num">{fmtNumber(a.shown)}</td>
                  <td className="num">{fmtNumber(a.won)}</td>
                  <td className="num">{a.leads ? fmtPct((a.won / a.leads) * 100, 0) : '-'}</td>
                  <td className="num">{money(a.revenue)}</td>
                  {events.map((k, i) => <td key={i} className="num fke-col">{fmtNumber(keCount(a, k))}</td>)}
                </tr>
                {isOpen && clickable && <tr className="form-people-row"><td /><td colSpan={totalCols - 1}>
                  <div className="tbl-scroll"><table className="mini-tbl users-tbl fp-tbl">
                    <thead><tr><th className="lft">Name</th><th className="lft">Status</th><th className="lft">Stage</th><th>Value</th><th>Days in stage</th><th className="lft">Booked</th><th className="lft">Channel</th></tr></thead>
                    <tbody>{people.slice().sort((x, y) => (y.value || 0) - (x.value || 0)).map((p, i) => <PersonRow key={p.contactId || i} p={p} clientId={clientId} money={money} cols={7} />)}</tbody>
                  </table></div>
                  {people.length >= 80 ? <div className="cap" style={{ padding: '4px 2px' }}>Showing the first 80 people for this answer.</div> : null}
                </td></tr>}
              </React.Fragment>
            )
          })}</tbody>
        </table>
        </div>
        {events.length ? <p className="caveat" style={{ marginTop: 8 }}>Key event columns count the people (of those listed) who reached each of this client&apos;s configured key events. Click an answer to see who gave it and where each person sits in the funnel; click a person for their CRM notes.</p> : <p className="caveat" style={{ marginTop: 8 }}>Set this client&apos;s <b>key events</b> in Settings to see a per-answer funnel here. Click an answer to see who gave it.</p>}
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
// Key-event series colours: Leads keeps the app's lead-blue; each key event
// takes a distinct colour from the shared palette (green / purple / orange …)
// so counts and rate charts read as one legend.
const KE_COLORS = ['#12b886', '#8b5cf6', '#f5a524', '#ec4899', '#0ea5e9', '#f0435b', '#0e8f6a', '#f97316']
// Visual summary of form performance: lead share (donut) + the client's Key
// Events per form (counts) and the conversion rate to each key event. Falls back
// to the legacy Booked/Shown/Won funnel when no key events are configured.
function FormsCharts({ forms, kEvents, reached, evLabel }) {
  const top = [...forms].sort((a, b) => b.leads - a.leads).slice(0, 8).filter((f) => f.leads > 0)
  if (!top.length) return null
  const shortName = (s) => (s.length > 16 ? s.slice(0, 15) + '…' : s)
  const pie = top.map((f, i) => ({ name: f.form, value: f.leads, color: FORM_COLORS[i % FORM_COLORS.length] }))
  const xa = <XAxis dataKey="name" fontSize={9} stroke="var(--muted)" interval={0} angle={-18} textAnchor="end" height={54} />
  const hasKe = kEvents && kEvents.length > 0
  const countFor = (f, k) => (f.people || []).reduce((n, p) => n + (reached(p, k) ? 1 : 0), 0)
  // Key-event mode: labels + per-form counts / rates.
  const labels = hasKe ? kEvents.map(evLabel) : []
  const counts = top.map((f) => { const o = { name: shortName(f.form), Leads: f.leads }; kEvents && kEvents.forEach((k, i) => { o[labels[i]] = countFor(f, k) }); return o })
  const rates = top.map((f) => { const o = { name: shortName(f.form) }; kEvents && kEvents.forEach((k, i) => { o[labels[i]] = f.leads ? Math.round((countFor(f, k) / f.leads) * 100) : 0 }); return o })
  // Legacy fallback (no key events configured).
  const funnel = top.map((f) => ({ name: shortName(f.form), Leads: f.leads, Booked: f.booked, Shown: f.shown, Won: f.won }))
  const legacyRates = top.map((f) => ({ name: shortName(f.form), 'Book %': f.leads ? Math.round((f.booked / f.leads) * 100) : 0, 'Show %': f.booked ? Math.round((f.shown / f.booked) * 100) : 0, 'Win %': f.leads ? Math.round((f.won / f.leads) * 100) : 0 }))
  return (
    <div className="forms-charts">
      <div className="card chart-card"><h3>Lead share by form</h3>
        <ResponsiveContainer width="100%" height={230}>
          <PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={46} outerRadius={82} paddingAngle={2}>{pie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip formatter={(v) => fmtNumber(v) + ' leads'} /></PieChart>
        </ResponsiveContainer>
      </div>
      {hasKe ? <>
        <div className="card chart-card"><h3>Key events by form</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={counts} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip formatter={(v, n) => [fmtNumber(v), n]} /><Legend /><Bar dataKey="Leads" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={18} />{labels.map((l, i) => <Bar key={l} dataKey={l} fill={KE_COLORS[i % KE_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={18} />)}</BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card"><h3>Conversion to each key event</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={rates} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} /><Tooltip formatter={(v, n) => [v + '%', n]} /><Legend />{labels.map((l, i) => <Bar key={l} dataKey={l} fill={KE_COLORS[i % KE_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={18} />)}</BarChart>
          </ResponsiveContainer>
        </div>
      </> : <>
        <div className="card chart-card"><h3>Funnel by form</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={funnel} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="Leads" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Booked" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Shown" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Won" fill="#f5a524" radius={[3, 3, 0, 0]} maxBarSize={20} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card"><h3>Conversion rates by form</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={legacyRates} margin={{ left: -16, right: 6, top: 6 }}><CartesianGrid stroke="var(--border)" vertical={false} />{xa}<YAxis fontSize={10} stroke="var(--muted)" tickFormatter={(v) => v + '%'} /><Tooltip formatter={(v) => v + '%'} /><Legend /><Bar dataKey="Book %" fill="#12b886" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Show %" fill="#4f7cff" radius={[3, 3, 0, 0]} maxBarSize={20} /><Bar dataKey="Win %" fill="#f5a524" radius={[3, 3, 0, 0]} maxBarSize={20} /></BarChart>
          </ResponsiveContainer>
        </div>
      </>}
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
  // The client's configured Key Events replace the generic Booked/Shown/Won
  // funnel throughout this tab. Resolved with the SAME helper the answer drill
  // uses, so counting who reached each event never reinvents the resolution.
  const ke = formKeyEvents(clientId, pipeFilter, pipes)
  const kEvents = ke.events || []
  const evLabel = (k) => (k.kind === 'calendar' ? '📅 ' : '') + k.label
  const hasKe = kEvents.length > 0
  const keCountsFor = (f) => kEvents.map((k) => (f.people || []).reduce((n, p) => n + (ke.reached(p, k) ? 1 : 0), 0))
  const rows = forms.map((f) => {
    const counts = keCountsFor(f)
    const row = { ...f, bookRate: f.leads ? (f.booked / f.leads) * 100 : null, showRate: f.booked ? (f.shown / f.booked) * 100 : null, winRate: f.leads ? (f.won / f.leads) * 100 : null, avgDeal: f.won ? f.revenue / f.won : null, _keCounts: counts }
    counts.forEach((c, i) => { row['ke' + i] = c })
    return row
  })
  const sorted = [...rows].sort((a, b) => { const av = a[sort.key], bv = b[sort.key]; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * sort.dir; return (av - bv) * sort.dir })
  const tot = rows.reduce((a, f) => ({ leads: a.leads + f.leads, booked: a.booked + f.booked, shown: a.shown + f.shown, won: a.won + f.won, revenue: a.revenue + f.revenue, ke: a.ke.map((v, i) => v + (f._keCounts[i] || 0)) }), { leads: 0, booked: 0, shown: 0, won: 0, revenue: 0, ke: kEvents.map(() => 0) })
  // Columns after Form/Leads and before Revenue/Avg deal: one per key event, or
  // the legacy Booked/Won when the client has no key events configured.
  const metricCount = hasKe ? kEvents.length : 2
  const bodySpan = 4 + metricCount // Form + Leads + metrics + Revenue + Avg deal
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const Th = ({ k, children, l }) => <th className={l ? 'lft' : 'num'} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <>
      <div className="scorecard forms-sc">
        <Sc label="Forms" value={fmtNumber(forms.length)} />
        <Sc label="Leads" value={fmtNumber(tot.leads)} />
        {hasKe
          ? kEvents.map((k, i) => <Sc key={i} label={evLabel(k)} value={fmtNumber(tot.ke[i])} />)
          : <><Sc label="Booked" value={fmtNumber(tot.booked)} /><Sc label="Won" value={fmtNumber(tot.won)} /></>}
        <Sc label="Revenue" value={money(tot.revenue)} />
      </div>
      <FormPipeFilter pipes={pipes} value={pipeFilter} onChange={setPipeFilter} />
      <FormsCharts forms={forms} kEvents={kEvents} reached={ke.reached} evLabel={evLabel} />
      <div className="lvl-title" style={{ marginTop: 14 }}>Form performance <span className="sub">· {hasKe ? 'leads → key events' : 'leads → booked → won'} by form · {rangeLabel(range)} · 📱 Meta lead form · 🌐 website form · click a form to expand</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th style={{ width: 22 }} /><Th k="form" l>Form</Th><Th k="leads">Leads</Th>{hasKe ? kEvents.map((k, i) => <Th key={i} k={'ke' + i}>{evLabel(k)}</Th>) : <><Th k="booked">Booked</Th><Th k="won">Won</Th></>}<Th k="revenue">Revenue</Th><Th k="avgDeal">Avg Deal</Th></tr></thead>
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
                {hasKe
                  ? kEvents.map((k, i) => <td key={i} className="num fke-col">{fmtNumber(f['ke' + i])}{f.leads ? <span className="fke-pct"> {fmtPct((f['ke' + i] / f.leads) * 100, 0)}</span> : null}</td>)
                  : <><td className="num">{fmtNumber(f.booked)}</td><td className="num">{fmtNumber(f.won)}</td></>}
                <td className="num">{money(f.revenue)}</td>
                <td className="num">{f.avgDeal != null ? money(f.avgDeal) : '-'}</td>
              </tr>
              {isOpen && <tr className="form-seg-row"><td /><td colSpan={bodySpan}>
                <FormMetaPanel clientId={clientId} form={f} pipes={pipes} onEdit={setEditForm} />
                <FormLocations form={f} />
                <FormSegments segments={f.segments} captured={f.capturedQuestions} currency={currency} clientId={clientId} pipes={pipes} pipe={pipeFilter} />
              </td></tr>}
            </tbody>
          )
        })}
      </table></div>
      <p className="caveat">Leads = distinct contacts whose first form in this period was this one. {hasKe ? <>Each key-event column counts the form&apos;s leads who reached that step of <b>this client&apos;s configured key events</b> (set in Settings), with % of the form&apos;s leads beside it; Revenue is from won opportunities.</> : <>Booked comes from the date-of-action appointment feed; Won / Revenue from won opportunities. Set this client&apos;s <b>key events</b> in Settings to funnel every form by them.</>} <b>Meta Lead Forms</b> are grouped by their Facebook form name so different friction / qualification versions stay separate; <b>website forms</b> by their GHL form name. A higher-friction form usually shows fewer Leads but higher conversion. <b>Click a form</b> to break its leads down by the answers they gave (budget, type, timeframe…) and see which answers convert. Similar text answers (e.g. NSW / nsw / New South Wales) are merged — hover an answer to see what it combines.</p>
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
// Resulted drill: per-status breakdown (counts + people) plus the two reporting-
// gap groups (occurred-but-still-confirmed = errors to fix; resulted-before-time).
// People are only captured on the All channel; other channels show counts only.
// Build a bucket-scoped view of the resulted appointments from the All-channel
// people list (each tagged with its lead-time bucket), for the per-bucket drill.
function bucketResultC(C, b) {
  const people = (C.people || []).filter((p) => p.leadBucket === b.key)
  const bs = { showed: 0, noshow: 0, cancelled: 0, confirmed: 0, other: 0 }
  let occ = 0, res = 0
  for (const p of people) { bs[p.status] = (bs[p.status] || 0) + 1; if (p.occurred && p.status === 'confirmed') occ++; if (!p.occurred && p.status !== 'confirmed') res++ }
  return { booked: b.booked, resulted: b.resulted, showRate: b.showRate, people, byStatus: bs, occurredNotResulted: occ, resultedNotOccurred: res }
}
function ApptResultedDrill({ C, onClose, label }) {
  const people = C.people || []
  const bs = C.byStatus || { showed: 0, noshow: 0, cancelled: 0, confirmed: 0, other: 0 }
  const fmtD = (ms) => { const d = new Date(ms); return isFinite(d.getTime()) ? d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
  const groups = [['showed', 'Showed', '#12b886'], ['noshow', 'No-show', '#f5a524'], ['cancelled', 'Cancelled', '#ff6b6b'], ['other', 'Other', '#8b5cf6']]
  const occNotRes = people.filter((p) => p.occurred && p.status === 'confirmed')
  const resNotOcc = people.filter((p) => !p.occurred && p.status !== 'confirmed')
  const tbl = (rows) => (
    <div className="table-wrap"><table className="mini-tbl users-tbl">
      <thead><tr><th className="lft">Name</th><th className="lft">Calendar</th><th>Appt date</th><th>Occurred</th></tr></thead>
      <tbody>{rows.length ? rows.map((p, i) => (
        <tr key={(p.contactId || 'x') + i}><td className="lft">{p.name}</td><td className="lft">{p.calendar}</td><td>{fmtD(p.start)}</td><td>{p.occurred ? '✓' : '—'}</td></tr>
      )) : <tr><td colSpan={4} className="cap">No people to show.</td></tr>}</tbody>
    </table></div>
  )
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal set-modal appt-drill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><div><h3>Resulted appointments{label ? ` · ${label}` : ''} — {fmtNumber(C.resulted)} of {fmtNumber(C.booked)} booked</h3><span className="cap">Outcome recorded (moved out of confirmed). Show rate {C.showRate == null ? '-' : `${C.showRate}%`} of occurred.</span></div><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          <div className="appt-drill-counts">
            {groups.map(([k, lbl, col]) => <span key={k} className="appt-drill-pill" style={{ borderColor: col }}><span className="dot" style={{ background: col }} />{lbl} <b>{fmtNumber(bs[k] || 0)}</b></span>)}
            <span className="appt-drill-pill"><span className="dot" style={{ background: 'var(--muted)' }} />Still confirmed <b>{fmtNumber(bs.confirmed || 0)}</b></span>
          </div>
          {!people.length && <p className="cap" style={{ marginTop: 4 }}>Per-person detail is available on the <b>All</b> channel filter.</p>}
          {(C.occurredNotResulted > 0 || occNotRes.length > 0) && <div className="appt-drill-sec warn">
            <div className="appt-drill-h">⚠ Occurred but still confirmed — {fmtNumber(C.occurredNotResulted)} · reporting errors to fix</div>
            {tbl(occNotRes)}
          </div>}
          {(C.resultedNotOccurred > 0 || resNotOcc.length > 0) && <div className="appt-drill-sec">
            <div className="appt-drill-h">Resulted but not yet occurred — {fmtNumber(C.resultedNotOccurred)} · outcome set before the appt time</div>
            {tbl(resNotOcc)}
          </div>}
          {groups.map(([k, lbl]) => { const rows = people.filter((p) => p.status === k); if (!(bs[k] || 0) && !rows.length) return null; return (
            <div className="appt-drill-sec" key={k}><div className="appt-drill-h">{lbl} — {fmtNumber(bs[k] || 0)}</div>{tbl(rows)}</div>
          ) })}
        </div>
      </div>
    </div>
  )
}
function AppointmentsView({ clientId, range, nonce }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [chan, setChan] = useState('all')
  const [pipe, setPipe] = useState('all')
  const [cals, setCals] = useState(null) // null = use default for pipe; array = explicit
  const [userSel, setUserSel] = useState('all')
  const [showDbg, setShowDbg] = useState(false)
  const [apptDrill, setApptDrill] = useState(false)
  const [bucketDrill, setBucketDrill] = useState(null)
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
      <div className="timing-scards appt-status-row">
        <div className="tm-sc"><span className="tm-lab">Booked</span><b>{fmtNumber(C.booked)}</b><span className="tm-sub">in period</span></div>
        <div className="tm-sc"><span className="tm-lab">Occurred</span><b>{fmtNumber(C.occurred)}</b><span className="tm-sub">appt time passed</span></div>
        <button type="button" className="tm-sc tm-sc-btn" onClick={() => setApptDrill(true)}><span className="tm-lab">Resulted ▸</span><b>{fmtNumber(C.resulted)}</b><span className="tm-sub">outcome recorded · click for detail</span></button>
        <div className="tm-sc"><span className="tm-lab">Shown</span><b>{fmtNumber(C.shown)}</b><span className="tm-sub">of {fmtNumber(C.occurred)} occurred</span></div>
        <div className="tm-sc"><span className="tm-lab">Show rate</span><b>{C.showRate == null ? '-' : `${C.showRate}%`}</b><span className="tm-sub">shown ÷ occurred{C.resultShowRate != null ? ` · ${C.resultShowRate}% of resulted` : ''}</span></div>
      </div>
      {(C.occurredNotResulted > 0 || C.resultedNotOccurred > 0) && (
        <div className={`appt-gap-warn${C.occurredNotResulted > 0 ? '' : ' info'}`}>
          {C.occurredNotResulted > 0 && <span>⚠ <b>{fmtNumber(C.occurredNotResulted)}</b> occurred but not resulted — needs status updating.</span>}
          {C.resultedNotOccurred > 0 && <span className="appt-gap-sub">{C.occurredNotResulted > 0 ? ' · ' : ''}{fmtNumber(C.resultedNotOccurred)} resulted before the appt time (odd).</span>}
          <button type="button" className="appt-gap-link" onClick={() => setApptDrill(true)}>view people</button>
        </div>
      )}
      {apptDrill && <ApptResultedDrill C={C} onClose={() => setApptDrill(false)} />}
      {bucketDrill && <ApptResultedDrill C={bucketResultC(C, bucketDrill)} label={`booked ${bucketDrill.label.toLowerCase()} ahead`} onClose={() => setBucketDrill(null)} />}
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
          <thead><tr><th className="lft">Booked ahead</th><th>Booked</th><th>Occurred</th><th>Resulted</th><th>Show %</th><th>Cancel %</th><th>Won</th><th>Win %</th><th>Time to close</th></tr></thead>
          <tbody>{C.buckets.map((b) => (
            <tr key={b.label}>
              <td className="lft">{b.label}</td>
              <td>{fmtNumber(b.booked)}</td>
              <td>{fmtNumber(b.occurred)}</td>
              <td>{b.resulted ? <button type="button" className="link-btn sm appt-res-cell" onClick={() => setBucketDrill(b)} title="See who resulted, by status">{fmtNumber(b.resulted)} ›</button> : fmtNumber(b.resulted || 0)}</td>
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
// Drill popup for the Lead-outcomes tiles: the actual leads behind Open / Won /
// Lost, with contact info, value (won/open) and the lost reason (lost).
function TimingDrill({ drill, money, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [])
  const deals = drill.deals || []
  const isLost = drill.kind === 'lost'
  const total = deals.reduce((s, d) => s + (d.value || 0), 0)
  return (
    <div className="mr-drill-overlay no-print" onClick={onClose}>
      <div className="mr-drill" onClick={(e) => e.stopPropagation()}>
        <div className="mr-drill-head">
          <div><h3>{drill.title}</h3><span>{deals.length} lead(s){total ? ` · ${money(total)} total` : ''}</span></div>
          <button className="mr-drill-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mr-drill-body">
          {deals.length ? (
            <table className="mr-table">
              <thead><tr>
                <th>Contact</th><th>Lead created</th>{isLost ? <th>Lost</th> : <th>{drill.kind === 'won' ? 'Won' : 'Updated'}</th>}
                <th>Source</th>{isLost ? <th>Lost reason</th> : null}<th>Contact info</th><th className="r">Value</th>
              </tr></thead>
              <tbody>{deals.map((d, i) => (
                <tr key={i}>
                  <td>{d.name || '—'}</td>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>{fmtDate(d.statusAt)}</td>
                  <td><span className={`mr-src mr-src-${d.channel || 'other'}`}>{d.channel === 'meta' ? 'Meta' : d.channel === 'google' ? 'Google' : 'Other'}</span></td>
                  {isLost ? <td>{d.reason || '—'}</td> : null}
                  <td className="tm-drill-contact">{[d.email, d.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="r">{d.value ? money(d.value) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="mr-empty">No leads to show.</div>}
        </div>
      </div>
    </div>
  )
}
function TimingView({ clientId, range, nonce, currency }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [scan, setScan] = useState(null) // { status, processed, total, data }
  const [showDbg, setShowDbg] = useState(false)
  const [drill, setDrill] = useState(null) // { kind:'open'|'won'|'lost', title, deals }
  const money = (v) => (v == null || isNaN(v) ? '—' : fmtCurrency(v, currency))
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
        <p className="cap" style={{ margin: 0 }}>Time from a lead coming in to the <b>first manual (human) message or call</b> made to them. Automated workflow / campaign / bulk sends are excluded, so this reflects how fast a person actually reaches out (an outbound call counts even if the dialer didn't attribute a user). {d.full ? <>Covers the <b>whole date range</b> — {fmtNumber(d.totalLeads)} leads.</> : <>Based on a sample of the {d.sampled} most recent lead{d.sampled === 1 ? '' : 's'} in this range{d.totalLeads > d.sampled ? ` (of ${d.totalLeads})` : ''}.</>}</p>
        <div className="tm-scan">
          {!scan && <button className="set-relink" onClick={runScan}>⟳ Scan the whole date range (not just a sample)</button>}
          {scan && <>
            <span className={scan.status === 'done' ? 'tm-scan-done' : ''}>{scan.status === 'done' ? `✓ Full scan complete · ${fmtNumber(scan.total)} leads` : scan.status === 'err' ? '⚠ Scan failed — try again' : `Scanning conversations… ${fmtNumber(scan.processed)} / ${fmtNumber(scan.total)} leads`}</span>
            {scanning && <span className="ov-spin" />}
            <button className="set-relink" onClick={stopScan}>{scan.status === 'running' ? 'Stop' : 'Back to sample'}</button>
          </>}
        </div>
        {d.viaAppt > 0 && <div className="tm-hours">📌 <b>{fmtNumber(d.viaAppt)} of {fmtNumber(d.measured)}</b> measured leads had <b>no manual message or call</b>, so their <b>first staff-booked appointment</b> was used as the speed signal instead (automated / self-bookings don't count). Useful for clients who work leads by phone/booking rather than messaging.</div>}
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
      {(() => {
        const cr = (d && d.contactRate) || (st.data && st.data.contactRate) || null
        if (!cr || !cr.base) return null
        const dr = (key, title) => { const list = (cr.deals && cr.deals[key]) || []; if (!list.length) return; setDrill({ kind: key, title, deals: list }) }
        return (
          <div className="card">
            <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Contact rate <span style={{ fontWeight: 400 }}>· manual messages + appointments booked · of {fmtNumber(cr.base)} {d.full ? 'leads (full scan)' : `sampled lead${cr.base === 1 ? '' : 's'}`} · click to see the leads</span></div>
            <div className="tm-contact">
              <button className="tm-oc rate" onClick={() => dr('contacted', 'Contacted leads (message or appointment)')} disabled={!cr.contacted}><span className="tm-oc-lab">Total contact rate</span><b>{cr.rate == null ? '—' : `${cr.rate}%`}</b><span className="tm-oc-sub">{fmtNumber(cr.contacted)} of {fmtNumber(cr.base)} reached</span></button>
              <button className="tm-oc" onClick={() => dr('messaged', 'Leads reached by a manual message')} disabled={!cr.messaged}><span className="tm-oc-lab">Manual messages</span><b>{fmtNumber(cr.messaged)}</b><span className="tm-oc-sub">human message sent</span></button>
              <button className="tm-oc" onClick={() => dr('booked', 'Leads with an appointment booked')} disabled={!cr.booked}><span className="tm-oc-lab">Appointments booked</span><b>{fmtNumber(cr.booked)}</b><span className="tm-oc-sub">user + customer booked</span></button>
              <button className="tm-oc sub" onClick={() => dr('userBooked', 'Leads with a user-booked appointment')} disabled={!cr.userBooked}><span className="tm-oc-lab">↳ User-booked</span><b>{fmtNumber(cr.userBooked)}</b><span className="tm-oc-sub">staff booked the call</span></button>
              <button className="tm-oc sub" onClick={() => dr('selfBooked', 'Leads with a customer self-booked appointment')} disabled={!cr.selfBooked}><span className="tm-oc-lab">↳ Customer-booked</span><b>{fmtNumber(cr.selfBooked)}</b><span className="tm-oc-sub">lead self-booked</span></button>
            </div>
            <p className="caveat" style={{ marginTop: 10 }}>Contacted = a lead we sent a <b>manual message or call</b> to <b>or</b> that had an <b>appointment booked</b>. User-booked = a team member created the appointment; Customer-booked = the lead self-booked via a calendar link. A lead can be both messaged and booked, so the rows overlap — the total rate counts each contacted lead once. Based on the same sample as Speed to Lead; “Scan the whole date range” above makes it exact.</p>
          </div>
        )
      })()}
      {(() => {
        const oc = (d && d.outcome) || (st.data && st.data.outcome) || null
        if (!oc) return null
        const open = (v) => { const g = oc[v]; if (!g || !g.count) return; setDrill({ kind: v, title: v === 'won' ? 'Won leads' : v === 'lost' ? 'Lost leads' : 'Open leads', deals: g.deals || [] }) }
        return (
          <div className="card">
            <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>Lead outcomes <span style={{ fontWeight: 400 }}>· all {fmtNumber(d.totalLeads)} leads created in this range · click to see the leads</span></div>
            <div className="tm-outcome">
              <button className="tm-oc open" onClick={() => open('open')} disabled={!oc.open.count}><span className="tm-oc-lab">Open</span><b>{fmtNumber(oc.open.count)}</b><span className="tm-oc-sub">{money(oc.open.value)} in pipeline</span></button>
              <button className="tm-oc won" onClick={() => open('won')} disabled={!oc.won.count}><span className="tm-oc-lab">Won</span><b>{fmtNumber(oc.won.count)}</b><span className="tm-oc-sub">{money(oc.won.value)} revenue</span></button>
              <button className="tm-oc lost" onClick={() => open('lost')} disabled={!oc.lost.count}><span className="tm-oc-lab">Lost</span><b>{fmtNumber(oc.lost.count)}</b><span className="tm-oc-sub">{money(oc.lost.value)} value lost</span></button>
            </div>
          </div>
        )
      })()}
      {drill && <TimingDrill drill={drill} money={money} onClose={() => setDrill(null)} />}
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
// Settings pane: paste a client's Optimisation Log Google Sheet link + test it.
function OptLogSettings({ clientId }) {
  useSettingsSync()
  const [url, setUrl] = useState(() => loadOptLog(clientId))
  const [preview, setPreview] = useState({ status: 'idle' })
  useEffect(() => { setUrl(loadOptLog(clientId)); setPreview({ status: 'idle' }) }, [clientId])
  const ref = parseSheetRef(url)
  const test = () => {
    if (!ref) { setPreview({ status: 'err', error: "That doesn't look like a Google Sheets URL." }); return }
    setPreview({ status: 'loading' })
    fetch(`/.netlify/functions/optlog?id=${encodeURIComponent(ref.id)}&gid=${encodeURIComponent(ref.gid)}`)
      .then((r) => r.json())
      .then((j) => setPreview(j.ok ? { status: 'ok', columns: j.columns, rows: j.rows } : { status: 'err', error: j.error }))
      .catch((e) => setPreview({ status: 'err', error: String(e.message || e) }))
  }
  return (
    <div className="optlog-set">
      <p className="cap" style={{ marginTop: 0 }}>Paste this client's Optimisation Log Google Sheet link. The sheet must be shared <b>Anyone with the link → Viewer</b>. The client's <b>Optimisation Log</b> tab then reads it live (the first row is treated as column headers).</p>
      <div className="optlog-set-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" />
        <button className="set-details-save" onClick={() => saveOptLog(clientId, url.trim())} disabled={url.trim() === loadOptLog(clientId)}>Save</button>
        <button className="btn-ghost sm" onClick={test} disabled={!ref}>Test</button>
      </div>
      {url && !ref && <p className="cap" style={{ color: '#ef4444' }}>Not a valid Google Sheets URL.</p>}
      {ref && <p className="cap">Sheet <code>{ref.id.slice(0, 14)}…</code> · tab gid <code>{ref.gid}</code></p>}
      {preview.status === 'loading' && <Spinner label="Reading sheet…" />}
      {preview.status === 'err' && <p className="cap" style={{ color: '#ef4444' }}>{preview.error}</p>}
      {preview.status === 'ok' && <p className="cap" style={{ color: '#12b886' }}>✓ Read {preview.rows.length} row(s) · columns: {preview.columns.join(', ')}</p>}
    </div>
  )
}
// Client tab: the Optimisation Log rendered live from the client's Google Sheet,
// as a timeline (newest first) or a plain table. First sheet row = headers.
function OptimisationLog({ clientId }) {
  useSettingsSync()
  const url = loadOptLog(clientId)
  const ref = parseSheetRef(url)
  const [st, setSt] = useState({ status: 'idle' })
  const [view, setView] = useState('timeline')
  const [q, setQ] = useState('')
  const load = () => {
    if (!ref) { setSt({ status: 'noconf' }); return }
    setSt({ status: 'loading' })
    fetch(`/.netlify/functions/optlog?id=${encodeURIComponent(ref.id)}&gid=${encodeURIComponent(ref.gid)}`)
      .then((r) => r.json())
      .then((j) => setSt(j.ok ? { status: 'ok', columns: j.columns, rows: j.rows, fetchedAt: j.fetchedAt } : { status: 'err', error: j.error }))
      .catch((e) => setSt({ status: 'err', error: String(e.message || e) }))
  }
  useEffect(() => { load() }, [clientId, url])
  if (!ref) return <div className="card empty-deep"><div className="big">🗒️</div><b>No Optimisation Log linked yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Add this client's Google Sheet in <b>Settings → this client → Optimisation Log</b>. It then shows here live as a timeline or table.</p></div>
  if (st.status === 'loading' || st.status === 'idle') return <div className="card"><Spinner label="Loading optimisation log…" /></div>
  if (st.status === 'err') return <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn't read the sheet.</b><p style={{ maxWidth: 520, margin: '8px auto 0' }}>{st.error}</p><button className="set-relink" onClick={load} style={{ marginTop: 10 }}>↻ Retry</button></div>
  const { columns, rows } = st
  if (!rows.length) return <div className="card empty-deep"><div className="big">🗒️</div><b>The sheet has no entries yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Add rows to the Google Sheet and they'll appear here.</p></div>
  const dateCol = columns.find((c) => /date|when|day|timestamp/i.test(c)) || columns[0]
  const otherCols = columns.filter((c) => c !== dateCol)
  // A cell is "blank" when it's empty or just a dash / n/a placeholder — these are
  // hidden in the timeline.
  const blank = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s) }
  // Dates in these sheets are DD/MM/YYYY (or DD-MM-YYYY); parse them explicitly so
  // e.g. 06/12/2026 reads as 6 Dec, not 12 Jun. Falls back to native parsing (ISO,
  // "7 Dec 2026", etc.).
  const parseD = (v) => {
    const s = String(v || '').trim(); if (!s) return null
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) { const d = m[1], mo = m[2]; const y = m[3].length === 2 ? '20' + m[3] : m[3]; const t = Date.parse(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`); if (!isNaN(t)) return t }
    const t = Date.parse(s); return isNaN(t) ? null : t
  }
  // Semantic columns (best-effort by header name) so the timeline can render a rich
  // card — platform badge, optimisation type, campaign, author and notes.
  const platCol = columns.find((c) => /platform|channel/i.test(c))
  const typeCol = columns.find((c) => c !== dateCol && /optimi|type|action|change|task/i.test(c))
  const campCol = columns.find((c) => /campaign|ad ?set|adset|audience/i.test(c))
  const noteCol = columns.find((c) => /note|comment|detail|summary|desc/i.test(c))
  const known = new Set([dateCol, platCol, typeCol, campCol, noteCol].filter(Boolean))
  const extraCols = otherCols.filter((c) => !known.has(c))
  const platKind = (v) => (/meta|face|insta/i.test(v) ? 'meta' : /google|goog|ppc|search|pmax|youtube/i.test(v) ? 'google' : 'other')
  // Author initials → name. A leading "U -", "JA –", "AS —" prefix on the notes marks
  // who made the change.
  const PEOPLE = { u: 'Uma', uma: 'Uma', j: 'Jye', ja: 'Jye', jye: 'Jye', a: 'Alex', as: 'Alex', alex: 'Alex' }
  const authorOf = (note) => { const m = String(note || '').match(/^\s*([A-Za-z]{1,4})\s*[-–—]\s+/); return m ? (PEOPLE[m[1].toLowerCase()] || null) : null }
  const stripAuthor = (note) => (authorOf(note) ? String(note).replace(/^\s*[A-Za-z]{1,4}\s*[-–—]\s+/, '') : String(note || ''))
  const filtered = q ? rows.filter((r) => columns.some((c) => String(r[c] || '').toLowerCase().includes(q.toLowerCase()))) : rows
  const sorted = [...filtered].sort((a, b) => { const da = parseD(a[dateCol]), db = parseD(b[dateCol]); if (da == null && db == null) return 0; if (da == null) return 1; if (db == null) return -1; return db - da })
  return (
    <div className="optlog">
      <div className="optlog-head">
        <div><h3 style={{ margin: 0 }}>Optimisation Log</h3><p className="cap" style={{ margin: '2px 0 0' }}>Live from Google Sheets · {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}{st.fetchedAt ? ` · updated ${new Date(st.fetchedAt).toLocaleTimeString()}` : ''}</p></div>
        <div className="optlog-actions">
          <input className="optlog-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="optlog-toggle"><button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button><button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button></div>
          <a className="btn-ghost sm" href={url} target="_blank" rel="noreferrer">Open sheet ↗</a>
          <button className="btn-ghost sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>
      {!sorted.length ? <div className="card"><p className="cap" style={{ margin: 0 }}>No entries match “{q}”.</p></div>
        : view === 'table'
          ? <div className="card table-wrap"><table className="mr-table"><thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{sorted.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>
          : <div className="optlog-timeline">{sorted.map((r, i) => {
            const platform = platCol ? String(r[platCol] || '').trim() : ''
            const type = typeCol && !blank(r[typeCol]) ? r[typeCol] : ''
            const camp = campCol && !blank(r[campCol]) ? r[campCol] : ''
            const rawNote = noteCol ? r[noteCol] : ''
            const author = authorOf(rawNote)
            const note = blank(rawNote) ? '' : stripAuthor(rawNote)
            const extras = extraCols.filter((c) => !blank(r[c]))
            // Needs a platform PLUS something else to plot — skip "just Meta/Google" rows.
            const hasContent = !!type || !!camp || !!note || extras.length > 0
            if (!hasContent) return null
            const kind = platKind(platform)
            const d = parseD(r[dateCol])
            return (
              <div className="optlog-item" key={i}>
                <div className="optlog-when">{d != null ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : (r[dateCol] || '—')}</div>
                <div className="optlog-line"><span className={`optlog-dot optlog-dot-${kind}`} /></div>
                <div className={`optlog-body optlog-b-${kind}`}>
                  <div className="optlog-top">
                    {platform ? <span className={`optlog-plat optlog-plat-${kind}`}>{kind === 'meta' ? 'Meta' : kind === 'google' ? 'Google' : platform}</span> : null}
                    {type ? <span className="optlog-type">{type}</span> : null}
                    {author ? <span className={`optlog-author optlog-author-${author.toLowerCase()}`} title={`Logged by ${author}`}>{author}</span> : null}
                  </div>
                  {camp ? <div className="optlog-camp"><span className="optlog-k">Campaign / ad set</span><span className="optlog-v">{camp}</span></div> : null}
                  {note ? <div className="optlog-note">{note}</div> : null}
                  {extras.map((c) => <div className="optlog-fld" key={c}><span className="optlog-k">{c}</span><span className="optlog-v">{r[c]}</span></div>)}
                </div>
              </div>
            )
          })}</div>}
    </div>
  )
}
function ClientWorkspace({ client, index, data, config, range, nonce, onBack, authUser }) {
  useSettingsSync()
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
  if (loadOptLog(client.id)) allTabs.push({ id: 'optlog', label: 'Optimisation Log' })
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
          <Avatar id={client.id} name={client.name} i={index} />
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
        {curTab === 'timing' && <TimingView clientId={client.id} range={range} nonce={nonce} currency={data.currency} />}
        {curTab === 'optlog' && <OptimisationLog clientId={client.id} />}
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
  const [sel, setSel] = useState(() => loadKeyEventsRaw(clientId))
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
  // A stage checkbox is per (pipeline, name) for multi-pipeline clients so a
  // same-named stage in two pipelines is two independent key events (each scoped to
  // its own pipeline), never one merged/summed event.
  const hasStage = (n, pid) => sel.some((e) => {
    if (typeof e === 'string') return e === n            // legacy bare = every pipeline
    if (!e || e.cal != null || e.stage !== n) return false
    if (!multi || pid == null) return true
    return e.pipeline == null || e.pipeline === pid       // scoped = only its pipeline
  })
  const hasCal = (id) => sel.some((e) => e && typeof e === 'object' && e.cal === id)
  const calStageOf = (id) => { const e = sel.find((x) => x && x.cal === id); return (e && e.stage) || '' }
  const calPipeOf = (id) => { const e = sel.find((x) => x && x.cal === id); return (e && e.pipeline) || '' }
  const persist = (nx) => { saveKeyEvents(clientId, nx); return nx }
  // Expand legacy bare stage names into pipeline-scoped entries (one per pipeline
  // that owns the stage) so counts stop merging across same-named stages.
  const expandLegacy = (list) => {
    if (!multi) return list
    const out = []
    for (const e of list) {
      if (typeof e === 'string') {
        const owners = withStages.filter((p) => (p.stages || []).some((s) => s.name === e))
        if (owners.length) for (const p of owners) out.push({ stage: e, pipeline: p.id })
        else out.push(e)
      } else out.push(e)
    }
    return out
  }
  const toggleStage = (n, pid) => setSel((prev) => {
    if (!multi) return persist(hasStage(n) ? prev.filter((e) => !(e === n || (e && e.cal == null && e.stage === n))) : [...prev, n])
    const base = expandLegacy(prev)
    const on = base.some((e) => e && e.cal == null && e.stage === n && e.pipeline === pid)
    const nx = on ? base.filter((e) => !(e && e.cal == null && e.stage === n && e.pipeline === pid)) : [...base, { stage: n, pipeline: pid }]
    return persist(nx)
  })
  const toggleCal = (cal) => setSel((prev) => persist(hasCal(cal.id) ? prev.filter((e) => !(e && e.cal === cal.id)) : [...prev, { cal: cal.id, label: cal.name }]))
  // Link a calendar to a pipeline (resets the stage) then to a stage within it.
  // Single-pipeline clients auto-fill the pipeline so the link is still scoped.
  const linkCalPipe = (id, pipeline) => setSel((prev) => persist(prev.map((e) => (e && e.cal === id ? { ...e, pipeline: pipeline || undefined, stage: undefined } : e))))
  const linkCalStage = (id, stage) => setSel((prev) => persist(prev.map((e) => (e && e.cal === id ? { ...e, stage: stage || undefined, pipeline: (multi ? e.pipeline : (withStages[0] && withStages[0].id)) || e.pipeline || undefined } : e))))
  const stagesOfPipe = (pid) => { const p = withStages.find((x) => x.id === pid); return p ? (p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => s.name) : [] }
  const allStages = (() => { const m = new Map(); for (const p of withStages) for (const s of (p.stages || [])) if (!m.has(s.name)) m.set(s.name, s.pos == null ? 999 : s.pos); return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n) })()
  // One-time migration: once the pipelines load for a multi-pipeline client, expand
  // any legacy bare stage-name key events into pipeline-scoped ones so same-named
  // stages across pipelines stop being counted together.
  useEffect(() => {
    if (!multi || st.status !== 'ok') return
    const hasBare = sel.some((e) => typeof e === 'string' && withStages.some((p) => (p.stages || []).some((s) => s.name === e)))
    if (hasBare) { const nx = expandLegacy(sel); saveKeyEvents(clientId, nx); setSel(nx) }
  }, [multi, st.status]) // eslint-disable-line
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
                <label className={`kev-item ${hasStage(s.name, p.id) ? 'on' : ''}`} key={s.name}><input type="checkbox" checked={hasStage(s.name, p.id)} onChange={() => toggleStage(s.name, p.id)} /><span title={s.name}>{s.name}</span></label>
              ))}</div>
            </div>
          ))
          : st.status === 'ok' ? <p className="cap">No Caalano Systems pipeline stages found.</p>
            : <p className="cap">Couldn’t load pipeline stages.</p>}
      </div>}
    </div>
  )
}
// Settings pane: pick the "qualified lead" stage per pipeline.
function QualStageEditor({ clientId, nonce }) {
  useSettingsSync()
  const [st, setSt] = useState({ status: 'idle', blend: null })
  useEffect(() => {
    if (st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [st.status, clientId])
  const pipes = ((st.blend && st.blend.pipelines) || []).filter((p) => (p.stages || []).length)
  const map = loadQualStage(clientId)
  const setStage = (pid, stage) => { const nx = { ...loadQualStage(clientId) }; if (stage) nx[pid] = stage; else delete nx[pid]; saveQualStage(clientId, nx) }
  return (
    <div className="linker">
      <p className="cap" style={{ marginTop: 0 }}>Pick the stage that marks a lead <b>qualified</b> for each pipeline — typically just after the discovery call. A lead counts as qualified once it <b>reaches that stage or beyond</b>, and any won deal always counts. Leave a pipeline on “Not set” to keep Qualified off for it. <b>Qualified only appears on the dashboards when at least one pipeline has a stage set here.</b></p>
      {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
        : pipes.length ? pipes.map((p) => (
          <div className="camp-row" key={p.id}>
            <span className="camp-nm" title={p.name}>{p.name}</span>
            <select className="camp-lnk" value={map[p.id] || ''} onChange={(e) => setStage(p.id, e.target.value)}>
              <option value="">Not set — no qualified metric</option>
              {(p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
        ))
          : st.status === 'ok' ? <p className="cap">No pipeline stages found for this client.</p>
            : <p className="cap">Couldn’t load pipeline stages.</p>}
    </div>
  )
}
// Settings pane: link old UTM values (from a rename) to the current campaign / ad
// set / creative so historical CRM leads aggregate under the current name.
function AliasEditor({ clientId, nonce }) {
  useSettingsSync()
  const [st, setSt] = useState({ status: 'idle' })
  useEffect(() => {
    if (st.status !== 'idle') return
    setSt({ status: 'loading' })
    // Wide 90-day window so pre-rename (old-UTM) leads still show up to be linked.
    const now = new Date(); now.setHours(12, 0, 0, 0)
    const from = new Date(now); from.setDate(from.getDate() - 90)
    const r = { from: iso(from), to: iso(now) }
    const q = `client=${clientId}&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`
    Promise.all([
      fetch(`/.netlify/functions/windsor?channel=attribution&${q}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      // Lightweight name-only endpoint (not the heavy buildMeta) so the current
      // campaign / ad-set / ad names load reliably even for large accounts.
      fetch(`/.netlify/functions/windsor?scope=adnames&${q}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]).then(([a, n]) => setSt({ status: 'ok', attr: a && a.attribution, names: (n && !n.error) ? { campaign: n.campaigns || [], medium: n.adsets || [], content: n.ads || [] } : null }))
      .catch(() => setSt({ status: 'err' }))
  }, [st.status, clientId])
  const A = st.attr
  const aliases = loadAliases(clientId)
  const tok = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 2)
  const bestMatch = (name, candidates) => {
    const w = new Set(tok(name)); if (!w.size) return ''
    let best = '', score = 0
    for (const c of candidates) { let s = 0; for (const x of tok(c)) if (w.has(x)) s++; if (s > score) { score = s; best = c } }
    return score >= 1 ? best : ''
  }
  // The reliable ad identity is its number code (CD_62 / CDa_72 / CDas_06), not
  // the descriptive wording. Extract it so we can match old→current by number.
  const adCode = (s) => { const m = String(s || '').match(/\bcd[a-z]*[_-]?(\d+)/i); return m ? m[0].toLowerCase().replace(/[^a-z0-9]/g, '') : null }
  // Suggest a current name for an old UTM: prefer an exact ad-number match (high
  // confidence); fall back to wording only when no code matches (verify).
  const suggestFor = (name, candidates) => {
    const code = adCode(name)
    if (code) {
      const same = candidates.filter((c) => adCode(c) === code)
      if (same.length === 1) return { value: same[0], by: 'code' }
      if (same.length > 1) return { value: bestMatch(name, same) || same[0], by: 'code' }
    }
    const w = bestMatch(name, candidates)
    return { value: w, by: w ? 'words' : null }
  }
  // utm values that are organic traffic sources, not ads — never offer them for
  // ad-set / creative aliasing.
  const NONAD = new Set(['social', 'organic', 'manual', 'calendar', 'email', 'referral', 'direct', 'none', 'sms', 'whatsapp', 'qr', 'link', 'bio', 'link_in_bio', 'linktree', 'linkinbio', 'profile'])
  const isNonAd = (name) => { const s = String(name || '').trim().toLowerCase(); return NONAD.has(s) || /link.?in.?bio|linktree/.test(s) }
  const curList = st.names || { campaign: [], medium: [], content: [] }
  const curSet = { campaign: new Set(curList.campaign.map(unorm)), medium: new Set(curList.medium.map(unorm)), content: new Set(curList.content.map(unorm)) }
  // Did the current-name lists actually load? If not, we can't tell which UTMs
  // are unmatched (everything would look unmatched), so we warn instead of dumping.
  const namesLoaded = !!st.names && (curList.campaign.length + curList.medium.length + curList.content.length) > 0
  const outcomes = { campaign: (A && A.byCampaign) || [], medium: (A && A.byMedium) || [], content: (A && A.byCreative) || [] }
  const keep = loadKeep(clientId)
  const unmatched = (lvl) => {
    if (!namesLoaded) return [] // no reference set - don't mislead by listing everything
    return (outcomes[lvl] || []).filter((o) => o.leads > 0 && o.name && o.name !== '(not set)'
      && !curSet[lvl].has(unorm(o.name))
      && !((lvl === 'medium' || lvl === 'content') && isNonAd(o.name))
      && !(keep[lvl] && keep[lvl][o.name])
      && !(aliases[lvl] && aliases[lvl][o.name])).sort((a, b) => b.leads - a.leads).slice(0, 40)
  }
  const LEVELS = [['campaign', 'Campaigns', 'utm_campaign'], ['medium', 'Ad sets', 'utm_medium'], ['content', 'Creatives', 'utm_content']]
  return (
    <div className="linker">
      <p className="cap" style={{ marginTop: 0 }}>When you rename a campaign, ad set or creative, historical CRM leads keep the <b>old</b> UTM they were stamped with — so their results don't roll into the new name. Link each old UTM below to the current name and they'll aggregate together everywhere (live views and reports). We match on the <b>ad number</b> (the <code>CD_62</code> / <code>CDa_72</code> code) shown as a badge: a green <b>✓ #CODE</b> means the numbers match (high confidence); an amber <b>✓ Approve</b> is a wording guess to verify first. Nothing is linked until you click approve or pick from the dropdown — <b>ignore a row and it keeps its own identity, untouched.</b> If a row is a legit standalone (e.g. a paused campaign) and not a rename, hit <b>Keep separate</b> to clear it from the list without merging anything.</p>
      {st.status === 'loading' ? <Spinner label="Scanning for unmatched UTMs (last 90 days)…" />
        : st.status === 'err' ? <p className="cap">Couldn't load campaign / CRM data for this client.</p>
        : !namesLoaded ? <div className="alias-warn"><b>⚠ Couldn't load the current campaign / ad-set / ad names</b> from the ad account, so we can't tell which UTMs are unmatched (everything would look unmatched). This is usually a temporary load issue on a large account.<button className="btn-ghost sm" style={{ marginLeft: 8 }} onClick={() => setSt({ status: 'idle' })}>↻ Retry</button></div>
          : LEVELS.map(([lvl, label, utm]) => {
            const un = unmatched(lvl)
            const existing = Object.entries(aliases[lvl] || {})
            const keptList = Object.keys(keep[lvl] || {})
            return (
              <div className="kev-group" key={lvl}>
                <div className="kev-pipe">{label} <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {utm}</span></div>
                {existing.length > 0 && <div className="alias-existing">{existing.map(([oldN, cur]) => (
                  <div className="alias-row alias-set" key={oldN}><span className="alias-old" title={oldN}>{oldN}</span><span className="alias-arrow">→</span><span className="alias-cur" title={cur}>{cur}</span><button className="alias-x" title="Remove link" onClick={() => setAlias(clientId, lvl, oldN, '')}>✕</button></div>
                ))}</div>}
                {keptList.length > 0 && <div className="alias-existing">{keptList.map((oldN) => (
                  <div className="alias-row alias-kept" key={oldN}><span className="alias-old" title={oldN}>{oldN}</span><span className="alias-kept-tag">kept separate</span><button className="alias-x" title="Undo — show this UTM in the unmatched list again" onClick={() => setKeep(clientId, lvl, oldN, false)}>✕</button></div>
                ))}</div>}
                {un.length === 0 ? <p className="cap" style={{ margin: '2px 0 0' }}>{existing.length ? 'No further unmatched UTMs.' : 'No unmatched UTMs — everything ties to a current name.'}</p>
                  : un.map((o) => {
                    const oc = adCode(o.name)
                    const sug = suggestFor(o.name, curList[lvl])
                    const sc = sug.value ? adCode(sug.value) : null
                    return (
                      <div className="alias-row" key={o.name}>
                        <span className="alias-old" title={o.name}>{oc ? <span className="alias-code">{oc.toUpperCase()}</span> : null}{o.name} <span className="alias-leads">· {fmtNumber(o.leads)} lead{o.leads === 1 ? '' : 's'}{o.won ? `, ${fmtNumber(o.won)} won` : ''}</span></span>
                        <span className="alias-arrow">→</span>
                        <div className="alias-pick">
                          <select className="camp-lnk alias-sel" value="" onChange={(e) => e.target.value && setAlias(clientId, lvl, o.name, e.target.value)}>
                            <option value="">Not linked — leave as is</option>
                            {curList[lvl].map((n) => { const cc = adCode(n); return <option key={n} value={n}>{cc ? cc.toUpperCase() + ' · ' : ''}{n}</option> })}
                          </select>
                          {sug.value ? <button className={`alias-ok ${sug.by === 'code' ? 'by-code' : 'by-words'}`} title={`Approve: ${o.name} → ${sug.value}${sug.by === 'code' ? ` (ad-number match ${(sc || '').toUpperCase()})` : ' (wording guess — verify the ad number first)'}`} onClick={() => setAlias(clientId, lvl, o.name, sug.value)}>✓ {sug.by === 'code' ? `#${(sc || '').toUpperCase()}` : 'Approve'} <span className="alias-ok-tgt">{sug.value}</span></button> : null}
                          <button className="alias-keep" title="Not a rename — this is a legit standalone (e.g. a paused campaign). Hide it and keep its data under its own name." onClick={() => setKeep(clientId, lvl, o.name, true)}>Keep separate</button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })}
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
// Settings toolbar button: re-pull each business's website + uploaded logo from
// Caalano Systems and cache them as avatars (manual overrides are preserved).
function LogoSyncButton() {
  const [state, setState] = useState('idle') // idle | syncing | done | err
  const go = () => { setState('syncing'); syncLogos({ force: true }).then((ok) => setState(ok ? 'done' : 'err')).catch(() => setState('err')) }
  const label = state === 'syncing' ? '⟳ Syncing logos…' : state === 'done' ? '✓ Logos synced' : state === 'err' ? '⚠ Retry logos' : '🖼 Sync logos'
  return <button className="set-add ghost" onClick={go} disabled={state === 'syncing'} title="Pull each business's website + logo from Caalano Systems and use it as their avatar everywhere">{label}</button>
}
const SET_FILTERS = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['deleted', 'Deleted']]
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

// Per-client monthly organic-social KPI targets (measured on the Blended view of
// the Organic Social → KPIs & Trends tab). Saved to the server, shared with the team.
function SocialKpiSettings({ clients }) {
  useSettingsSync()
  const list = (clients || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  const [cid, setCid] = useState(list[0] ? list[0].id : '')
  const cur = loadSocialKpis(cid)
  const set = (k, v) => { const nx = { ...loadSocialKpis(cid) }; if (v === '' || v == null) delete nx[k]; else nx[k] = Number(v); saveSocialKpis(cid, nx) }
  const FIELDS = [
    { k: 'followersEnd', label: 'Total followers (goal)', hint: 'target audience size' },
    { k: 'netFollowers', label: 'Net new followers / mo', hint: 'follows − unfollows' },
    { k: 'reach', label: 'Organic reach / mo' },
    { k: 'views', label: 'Views / mo' },
    { k: 'impressions', label: 'Impressions / mo', hint: 'Facebook' },
    { k: 'engagement', label: 'Engagement / mo' },
    { k: 'posts', label: 'Posts / mo' },
    { k: 'er', label: 'Engagement rate % / mo' },
  ]
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Organic social KPIs</h3>
      <p className="cap" style={{ marginTop: -4 }}>Set each client's <b>monthly</b> organic-social targets. They're scored against the latest month on the Blended view of Organic Social → <b>KPIs &amp; Trends</b>. Saved to the server and shared with the team.</p>
      <div className="pipe-sel" style={{ marginBottom: 12 }}><label>Client</label>
        <select value={cid} onChange={(e) => setCid(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="soc-kpiset-grid">
        {FIELDS.map((f) => (
          <label className="soc-kpiset" key={f.k}>
            <span>{f.label}{f.hint ? <em> · {f.hint}</em> : null}</span>
            <input type="number" min="0" value={cur[f.k] ?? ''} placeholder="—" onChange={(e) => set(f.k, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  )
}
function SettingsPage({ config, enabled, setEnabled, currency, authUser, authEnabled, theme, setTheme, onPick }) {
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
  const liveClients = config.clients.filter((c) => !isClientDeleted(c.id))
  const activeCount = liveClients.filter(isOn).length
  // Deleted clients (base or UI-added) for the Deleted filter / restore.
  const deletedList = Object.entries(SETTINGS.clients || {}).filter(([, v]) => v && v._deleted).map(([id, v]) => ({ id, name: (config.clients.find((c) => c.id === id) || {}).name || v.name || id, industry: v.industry || null })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const term = q.trim().toLowerCase()
  const list = (filter === 'deleted' ? [] : liveClients).filter((c) => {
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
        {isAdmin && <button className={section === 'socialkpis' ? 'on' : ''} onClick={() => setSection('socialkpis')}>Organic KPIs</button>}
        {(!authEnabled || isAdmin) && <button className={section === 'team' ? 'on' : ''} onClick={() => setSection('team')}>Team &amp; access</button>}
        {authEnabled && <button className={section === 'account' ? 'on' : ''} onClick={() => setSection('account')}>Your account</button>}
        <button className={section === 'appearance' ? 'on' : ''} onClick={() => setSection('appearance')}>Appearance</button>
      </div>
      {section === 'appearance' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Appearance</h3>
          <p className="cap" style={{ marginTop: -4 }}>Choose how Caalano360 looks. Saved to this browser.</p>
          <div className="theme-choose">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme && setTheme('light')}>☀ Light</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme && setTheme('dark')}>☾ Dark</button>
          </div>
        </div>
      )}
      {isAdmin && section === 'fatigue' && <FatigueSettings />}
      {isAdmin && section === 'socialkpis' && <SocialKpiSettings clients={config.clients} />}
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
        <div className="set-stat"><div className="v">{liveClients.length}</div><div className="l">Clients</div></div>
        <div className="set-stat"><div className="v">{activeCount}</div><div className="l">Active</div></div>
        <div className="set-stat"><div className="v">{liveClients.length - activeCount}</div><div className="l">Inactive</div></div>
        <div className="set-stat"><div className="v">{w.facebook ?? '-'}</div><div className="l">Meta accounts</div></div>
        <div className="set-stat"><div className="v">{w.google_ads ?? '-'}</div><div className="l">Google accounts</div></div>
        <div className="set-stat"><div className="v">{w.gohighlevel ?? '-'}</div><div className="l">Caalano Systems</div></div>
      </div>
      <div className="set-toolbar">
        <div className="chan-toggle">{SET_FILTERS.filter(([k]) => k !== 'deleted' || deletedList.length).map(([k, lbl]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{lbl}{k === 'active' ? ` · ${activeCount}` : k === 'inactive' ? ` · ${liveClients.length - activeCount}` : k === 'deleted' ? ` · ${deletedList.length}` : ''}</button>)}</div>
        <input className="set-search" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isSuper && <button className="set-add" onClick={() => setAdding(true)}>+ Add client</button>}
        <LogoSyncButton />
        <span className="set-saved">✓ Saved to server · shared across your team</span>
      </div>
      <div className="set-legend">
        <span>Setup:</span>
        <span className="lg"><img src={FAVICON('meta.com')} alt="" width="14" height="14" /> Meta</span><span className="lg"><img src={FAVICON('ads.google.com')} alt="" width="14" height="14" /> Google</span><span className="lg"><img src={CRM_LOGO} alt="" width="14" height="14" /> CRM</span><span className="lg"><b>🎯</b> Key events</span><span className="lg"><b>📅</b> Calendars</span><span className="lg"><b>📝</b> Forms</span><span className="lg"><b>📊</b> KPIs</span><span className="lg"><b>📡</b> Diagnostics</span>
        <span className="lg-sep">·</span><span className="lg"><span className="sth-mk ok">✓</span> done</span><span className="lg"><span className="sth-mk warn">●</span> attention</span><span className="lg"><span className="sth-mk bad">✗</span> missing</span>
      </div>
      {filter === 'deleted' && (
        <div className="set-grid">
          {deletedList.map((c) => (
            <div className="set-card is-off" key={c.id}>
              <div className="set-card-head">
                <Avatar id={c.id} name={c.name} i={config.clients.indexOf(c)} className="is-muted" />
                <div className="sc-id"><div className="nm">{c.name}</div><div className="ver">Deleted{c.industry ? ` · ${c.industry}` : ''}</div></div>
              </div>
              <div className="set-card-actions">
                <button className="set-expand" onClick={() => restoreClient(c.id)} title="Restore this client to the dashboard">↩ Restore</button>
              </div>
            </div>
          ))}
          {!deletedList.length && <div className="card empty-deep"><div className="big">🗑</div><b>No deleted clients.</b></div>}
        </div>
      )}
      {filter !== 'deleted' && <div className="set-grid">
        {list.map((c) => {
          const on = isOn(c)
          return (
            <div className={`set-card ${on ? '' : 'is-off'}`} key={c.id}>
              <div className="set-card-head">
                <Avatar id={c.id} name={c.name} i={config.clients.indexOf(c)} />
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
      </div>}
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
// Per-client brand-logo control: shows the resolved avatar, where it came from
// (manual / Caalano Systems logo / website favicon), and lets you paste a manual
// override URL or clear it back to the auto-detected source.
function LogoField({ clientId, name }) {
  useSettingsSync()
  const rec = loadLogo(clientId)
  const [val, setVal] = useState(rec.logo || '')
  useEffect(() => { setVal(loadLogo(clientId).logo || '') }, [clientId, SETTINGS.loaded])
  const src = clientLogoSrc(clientId, 64)
  const source = rec.logo ? 'Manual override' : rec.logoUrl ? 'Caalano Systems logo' : rec.website ? `Favicon · ${domainOf(rec.website)}` : 'None found — showing initials'
  const save = () => saveLogo(clientId, { logo: val.trim() || null })
  return (
    <div className="set-cycle">
      <div className="set-sec-t">Business logo</div>
      <div className="set-logo-row">
        {src ? <span className="avatar avatar-img"><img src={src} alt="" /></span> : <span className="avatar" style={{ background: acolor(0) }}>{initials(name)}</span>}
        <div className="set-logo-meta"><span className="cap">{source}</span>{rec.website ? <a className="cap" href={/^https?:/i.test(rec.website) ? rec.website : 'https://' + rec.website} target="_blank" rel="noreferrer">{rec.website}</a> : null}</div>
      </div>
      <div className="set-field"><label>Override logo URL <span className="cap">· optional — paste a direct image link to force a specific logo</span></label>
        <div className="set-logo-in"><input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://…/logo.png" /><button className="btn-ghost sm" onClick={save} disabled={val === (rec.logo || '')}>Save</button>{rec.logo ? <button className="btn-ghost sm" onClick={() => { setVal(''); saveLogo(clientId, { logo: null }) }}>Clear</button> : null}</div>
      </div>
    </div>
  )
}
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
  const [confirmDel, setConfirmDel] = useState(false)
  const doDelete = () => { deleteClient(c.id); onClose() }
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
  if (canLink) tabs.push(['aliases', 'UTM aliases'])
  if (c.meta || c.google || c.ghl) tabs.push(['kpis', 'KPI targets'])
  if (c.ghl) tabs.push(['forms', 'Forms'])
  if (c.ghl) tabs.push(['qualstage', 'Qualified lead'])
  tabs.push(['optlog', 'Optimisation Log'])
  if (c.ghl && (c.meta || c.google)) tabs.push(['diagnostics', 'Diagnostics'])
  const [tab, setTab] = useState('summary')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div className="set-modal-title"><Avatar id={c.id} name={name || c.name} i={0} sm /><div><h3>{name || c.name}</h3><span className="cap">{industry || (c.custom ? 'Added client' : 'Configuration')}</span></div></div>
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
            <LogoField clientId={c.id} name={name || c.name} />
            {canManageAccounts && (
              <div className="set-danger">
                <div className="set-sec-t">Delete client</div>
                <p className="cap" style={{ marginTop: 0 }}>Removes <b>{c.name}</b> from every list — the dashboard, sidebar, Settings and agency aggregates. Its per-client settings (key events, KPIs, notes) are kept in case you re-add it later.{c.custom ? '' : ' This account is defined in the app; deleting hides it everywhere (a Super Admin can restore it).'}</p>
                {confirmDel
                  ? <div className="set-danger-confirm"><span>Delete <b>{c.name}</b>?</span><button className="set-del-yes" onClick={doDelete}>Yes, delete</button><button className="btn-ghost sm" onClick={() => setConfirmDel(false)}>Cancel</button></div>
                  : <button className="set-del-btn" onClick={() => setConfirmDel(true)}>🗑 Delete client</button>}
              </div>
            )}
          </div>}
          {tab === 'keyevents' && <div className="set-tabpane"><div className="set-sec-t">Key events</div><KeyEventsEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'metaconv' && <div className="set-tabpane"><div className="set-sec-t">Meta conversions — primary &amp; secondary results</div><MetaConversionsEditor clientId={c.id} currency={currency} /></div>}
          {tab === 'links' && <div className="set-tabpane"><div className="set-sec-t">Link campaigns to pipelines</div><CampaignLinker clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'kpis' && <div className="set-tabpane"><div className="set-sec-t">KPI targets</div><KpiEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'forms' && <div className="set-tabpane"><div className="set-sec-t">Forms — link to a pipeline &amp; add notes</div><p className="cap" style={{ marginTop: 0 }}>Set each form's pipeline and notes here. The client's Forms tab shows these (and its full performance).</p><FormsSettingsTab clientId={c.id} /></div>}
          {tab === 'aliases' && <div className="set-tabpane"><div className="set-sec-t">UTM aliases — link renamed campaigns / ad sets / creatives</div><AliasEditor clientId={c.id} nonce={sig} /></div>}
          {tab === 'qualstage' && <div className="set-tabpane"><div className="set-sec-t">Qualified lead — stage per pipeline</div><QualStageEditor clientId={c.id} nonce={sig} /></div>}
          {tab === 'optlog' && <div className="set-tabpane"><div className="set-sec-t">Optimisation Log — Google Sheet</div><OptLogSettings clientId={c.id} /></div>}
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
  { id: 'optlog', label: 'Optimisation Log' },
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
      g('forms'), g('appts'), g('speed'),
      fetch(`${base}&scope=cohorts&weeks=12${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([health, creatives, extra, users, google, forms, appts, speed, cohorts]) => { if (alive) setSt({ status: (health && health.error) ? 'err' : 'ok', data: { health, creatives, extra, users, google, forms, appts, speed, cohorts } }) })
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
  const auDb = useAuDb() // for the geo digest (same postcode/suburb merge as the Location tab)
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
      const { health, creatives, extra, users } = dataSt.data
      if (!health || health.error) throw new Error((health && health.error) || 'could not load the client data')
      const topCr = (creatives.creatives || [])
        .map((c) => ({ name: c.name, format: c.format, spend: c.spend, leads: c.crm ? c.crm.leads : c.leads, booked: c.crm ? c.crm.booked : 0 }))
        .sort((a, b) => (b.booked - a.booked) || (b.leads - a.leads)).slice(0, 5)
      // Stalled deals from the Users data: open opportunities that haven't moved
      // in 30+ days, grouped by stage, so the update can ask informed questions
      // about where deals are getting stuck.
      const allOpen = ((users && users.users) || []).flatMap((u) => u.openDeals || [])
      const stalledBy = {}
      for (const d of allOpen) { if ((d.ageDays || 0) >= 30) { const s = stalledBy[d.stage] || { stage: d.stage, pipeline: d.pipeline, count: 0, value: 0, maxAge: 0 }; s.count++; s.value += (d.value || 0); s.maxAge = Math.max(s.maxAge, d.ageDays || 0); stalledBy[d.stage] = s } }
      const stalled = Object.values(stalledBy).sort((a, b) => b.value - a.value).slice(0, 6)
      // Elapsed days in the selected range, for the "is no-wins expected?" note.
      const periodDays = Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1)
      // --- Extra digests (compact) so the update draws on all of the client's data ---
      // Geo: top regions by leads, merged the same way the Location tab does.
      const formsArr = (dataSt.data.forms && dataSt.data.forms.forms) || []
      const allLocs = formsArr.flatMap((f) => f.locations || [])
      const geo = allLocs.length ? mergeLocations(groupAnswers(allLocs), auDb).slice(0, 5).map((l) => ({ region: l.value, leads: l.leads || 0, booked: l.booked || 0, won: l.won || 0 })) : []
      // Appointment insights (booking lead time, self vs staff, show rate, downstream win).
      const ai = (dataSt.data.appts && dataSt.data.appts.channels && dataSt.data.appts.channels.all) || null
      const apptInsights = ai ? { avgLeadDays: ai.avgLeadDays, avgTimeToBookDays: ai.avgTimeToBookDays, self: ai.self, staff: ai.staff, selfPct: ai.selfPct, showRate: ai.showRate, booked: ai.booked, won: ai.won, winRate: ai.winRate } : null
      // Speed to lead: typical response time + fast vs slow follow-up book rate.
      const sp = dataSt.data.speed || null
      const speed = (sp && sp.measured) ? (() => {
        const bk = sp.buckets || []
        const agg = (re) => bk.filter((b) => re.test(b.label)).reduce((a, b) => ({ count: a.count + b.count, booked: a.booked + b.booked }), { count: 0, booked: 0 })
        const fast = agg(/Under 5|5-15/), slow = agg(/4-24 hrs|Over 24/)
        return { medianMin: sp.medianMin, avgMin: sp.avgMin, within5Pct: sp.within5Pct, measured: sp.measured, fastCount: fast.count, fastBookRate: fast.count ? Math.round((fast.booked / fast.count) * 100) : null, slowCount: slow.count, slowBookRate: slow.count ? Math.round((slow.booked / slow.count) * 100) : null }
      })() : null
      // Cohort trend: recent acquisition weeks (leads -> booked -> won) for a maturation read.
      const cohortTrend = ((dataSt.data.cohorts && dataSt.data.cohorts.weeks) || []).slice(-6).map((w) => { const a = (w.ch && w.ch.all) || {}; return { week: w.label, leads: a.leads || 0, booked: a.booked || 0, won: a.won || 0 } })
      // Top forms/offers by submissions, with booked/won where available.
      const forms = formsArr.slice(0, 3).map((f) => ({ name: f.form, kind: f.kind, leads: f.leads || 0, booked: f.booked || 0, won: f.won || 0 }))
      const payload = { mode: 'client-update', clientName: sel.name, firstName: firstName.trim(), clientContext: (ctx || '').trim(), period: rangeLabel(range), periodDays, kpis: health.kpis, channels: health.channels, forecast: health.forecast, pipelines: health.pipelines || [], segments: creatives.segments || [], creatives: topCr, appts: extra.appts || null, lostReasons: extra.lostReasons || [], avgCloseDays: extra.avgCloseDays != null ? extra.avgCloseDays : null, nonBookerNotes: extra.nonBookerNotes || [], stalled, geo, apptInsights, speed, cohortTrend, forms }
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

// ---------------------------------------------------------------------------
// Monthly Report — a full-page, one-client, one-month slide deck built from a
// FROZEN snapshot. Wins/revenue are attributed by close month (won date), not
// lead-created date, so late-closing leads land in the month they closed.
// Exports via native print (Save-as-PDF) and a direct jsPDF download.
// ---------------------------------------------------------------------------

// Bounds + label for a 'YYYY-MM' month string (UTC-safe).
function monthBounds(m) {
  const [y, mo] = m.split('-').map(Number)
  const from = `${m}-01`
  const end = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const to = `${m}-${String(end).padStart(2, '0')}`
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { from, to, label }
}
const monthShort = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' }) }
// A report period spanning one or more months (from month `a` to month `b`).
function periodOf(a, b) {
  const lo = a <= b ? a : b, hi = a <= b ? b : a
  const from = `${lo}-01`, to = monthBounds(hi).to, single = lo === hi
  const label = single ? monthBounds(lo).label : `${monthBounds(lo).label} – ${monthBounds(hi).label}`
  return { from, to, label, key: single ? lo : `${lo}_${hi}`, single, lo, hi }
}
// Default month = last complete calendar month.
function lastCompleteMonth() {
  const d = new Date()
  const first = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))
  first.setUTCDate(0) // → last day of previous month
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`
}
const MR_MONTHS = (back = 18) => {
  const out = []; const now = new Date()
  let y = now.getFullYear(), m = now.getMonth() // 0-based; start at current month, walk back
  for (let i = 0; i < back; i++) { out.push(`${y}-${String(m + 1).padStart(2, '0')}`); m--; if (m < 0) { m = 11; y-- } }
  return out
}

// Display an ISO (YYYY-MM-DD) date as DD/MM/YYYY.
function fmtDate(s) {
  if (!s) return '—'
  const p = String(s).slice(0, 10).split('-')
  return (p.length === 3 && p[0]) ? `${p[2]}/${p[1]}/${p[0]}` : String(s)
}

async function mrFetch(qs) {
  const r = await fetch(`/.netlify/functions/windsor?${qs}`)
  if (!r.ok) { let e; try { e = (await r.json()).error } catch {} throw new Error(e || `HTTP ${r.status}`) }
  return r.json()
}

// Pull every scope the deck needs for one client + month, in parallel, and
// shape the frozen report payload.
async function assembleMonthlyReport(client, period) {
  const b = { from: period.from, to: period.to, label: period.label }
  const q = `client=${encodeURIComponent(client.id)}&${rangeQuery(b)}`
  const [meta, google, blend, attribution, trendR, dealsR] = await Promise.all([
    client.meta ? mrFetch(`channel=meta&${q}`).then((r) => r.meta).catch(() => null) : Promise.resolve(null),
    client.google ? mrFetch(`channel=google&${q}`).then((r) => r.google).catch(() => null) : Promise.resolve(null),
    mrFetch(`channel=blend&${q}`).then((r) => r.blend).catch(() => null),
    client.ghl ? mrFetch(`channel=attribution&${q}`).then((r) => r.attribution).catch(() => null) : Promise.resolve(null),
    client.meta ? mrFetch(`scope=monthlytrend&months=6&${q}`).then((r) => r.trend).catch(() => null) : Promise.resolve(null),
    client.ghl ? mrFetch(`scope=monthlydeals&${q}`).then((r) => r.deals).catch(() => null) : Promise.resolve(null),
  ])
  // Join CRM key-event outcomes (utm_content) onto each Meta creative so the
  // creative slide can show Leads → Booked → Shown → Won → Revenue per ad, the
  // same attribution the Meta Ads view uses. Done before the attribution trim.
  if (meta && Array.isArray(meta.ads) && attribution && Array.isArray(attribution.byCreative)) {
    const oCre = mkOutcomeMap(attribution.byCreative)
    for (const a of meta.ads) {
      const o = oCre.get(unorm(a.name))
      if (o) a.ke = { leads: o.leads || 0, booked: o.booked || 0, shown: o.shown || 0, won: o.won || 0, revenue: o.revenue || 0 }
    }
  }
  // Trim the heaviest arrays so the frozen blob stays lean, and keep only the
  // calendar counts the funnel reads from attribution (drops raw opportunity PII).
  if (google && Array.isArray(google.conversionActions)) google.conversionActions = google.conversionActions.slice(0, 200)
  const attrTrim = attribution && attribution.appointments ? { appointments: { byCalendar: attribution.appointments.byCalendar || [] } } : null
  if (meta) delete meta.adDaily
  return {
    v: 1, client: { id: client.id, name: client.name, industry: client.industry || null },
    month: period.key, period: b, currency: undefined,
    hasMeta: !!client.meta, hasGoogle: !!client.google, hasCrm: !!client.ghl,
    meta, google, blend, attribution: attrTrim, trend: trendR || [], deals: dealsR || null,
    // Per-campaign CRM outcome entities (utm_campaign) so the report can render
    // the Caalano360 green key-event columns + costings by campaign, same as the
    // Meta Ads view. Top 40 by leads keeps the frozen blob lean.
    campOutcomes: (attribution && Array.isArray(attribution.byCampaign)) ? attribution.byCampaign.slice(0, 40) : [],
    // Per-creative CRM outcome entities (utm_content) so the creative slide can show
    // the client's full configured key events per creative, not just leads/booked/won.
    creOutcomes: (attribution && Array.isArray(attribution.byCreative)) ? attribution.byCreative.slice(0, 120) : [],
    wonClosed: (blend && blend.wonClosed) || null,
    generatedAt: new Date().toISOString(),
  }
}

// --- small presentational pieces -------------------------------------------
function MRSlide({ n, total, kicker, title, sub, children, tone }) {
  return (
    <section className={`mr-slide ${tone ? 'mr-slide-' + tone : ''}`}>
      <header className="mr-slide-head">
        <div>
          {kicker && <div className="mr-kicker">{kicker}</div>}
          <h3 className="mr-title">{title}</h3>
          {sub && <p className="mr-sub">{sub}</p>}
        </div>
        {n != null && <div className="mr-pageno">{n}{total ? ` / ${total}` : ''}</div>}
      </header>
      <div className="mr-slide-body">{children}</div>
    </section>
  )
}
function MRKpi({ label, value, sub, strong }) {
  return <div className={`mr-kpi ${strong ? 'mr-kpi-strong' : ''}`}><span className="mr-kpi-lab">{label}</span><b className="mr-kpi-val">{value}</b>{sub != null && <span className="mr-kpi-sub">{sub}</span>}</div>
}
function MRTable({ cols, rows, empty = 'No data for this period.', max }) {
  const data = max ? rows.slice(0, max) : rows
  if (!rows || !rows.length) return <div className="mr-empty">{empty}</div>
  return (
    <div className="mr-tablewrap">
      <table className="mr-table">
        <thead><tr>{cols.map((c) => <th key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i}>{cols.map((c) => <td key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(row) : row[c.k]}</td>)}</tr>)}</tbody>
      </table>
      {max && rows.length > max && <div className="mr-more">+ {rows.length - max} more not shown</div>}
    </div>
  )
}
// Three compact month-over-month charts (Spend, Leads, CPL) for the Meta slide.
function MRTrend({ trend, currency }) {
  if (!trend || trend.length < 2) return <div className="mr-empty">Not enough history yet for a trend — this fills in as months accrue.</div>
  const money = (v) => fmtCurrency(v, currency)
  const charts = [
    { key: 'spend', label: 'Ad spend', kind: 'bar', color: '#6d5efc', fmt: money },
    { key: 'leads', label: 'Results', kind: 'bar', color: '#22b07d', fmt: (v) => fmtNumber(v) },
    { key: 'cpl', label: 'Cost per result', kind: 'line', color: '#e0803a', fmt: (v) => (v == null ? '—' : money(v)) },
  ]
  return (
    <div className="mr-trend">
      {charts.map((c) => (
        <div className="mr-trend-card" key={c.key}>
          <div className="mr-trend-lab">{c.label} · last {trend.length} months</div>
          <ResponsiveContainer width="100%" height={150}>
            {c.kind === 'bar' ? (
              <BarChart data={trend} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip formatter={(v) => c.fmt(v)} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey={c.key} fill={c.color} radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={trend} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip formatter={(v) => c.fmt(v)} contentStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  )
}

function MonthlyReport({ clients, currency, authUser }) {
  const list = (clients || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  const [clientId, setClientId] = useState(list[0] ? list[0].id : '')
  const client = list.find((c) => c.id === clientId) || list[0] || null
  const [fromMonth, setFromMonth] = useState(lastCompleteMonth())
  const [toMonth, setToMonth] = useState(lastCompleteMonth())
  const period = periodOf(fromMonth, toMonth)
  const [st, setSt] = useState({ status: 'idle' }) // idle|loading|ok|err|empty ; {report, frozen}
  const [saved, setSaved] = useState(null) // {savedAt, savedBy}
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [drill, setDrill] = useState(null) // {title, kind, deals}
  const [view, setView] = useState('slides') // slides (one page at a time) | scroll (continuous)
  const [idx, setIdx] = useState(0)
  const deckRef = useRef(null)
  const pageRef = useRef(null)
  const [fs, setFs] = useState(false)
  const present = () => { const el = pageRef.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}) }
  useEffect(() => { const on = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on) }, [])
  const money = (v) => (v == null || isNaN(v) ? '—' : fmtCurrency(v, currency))
  const n0 = (v) => (v == null || isNaN(v) ? '—' : fmtNumber(Math.round(v)))
  const pc = (a, b) => (b ? fmtPct((a / b) * 100, 1) : '—')

  // Load the frozen snapshot whenever client or the selected period changes.
  useEffect(() => {
    if (!client) return
    let alive = true
    setSt({ status: 'loading' }); setSaved(null)
    mrFetch(`scope=monthlysnap&client=${encodeURIComponent(client.id)}&month=${period.key}`)
      .then((r) => { if (!alive) return; if (r && r.saved) { setSaved({ savedAt: r.savedAt, savedBy: r.savedBy }); setSt({ status: 'ok', report: r.report, frozen: true }) } else setSt({ status: 'empty' }) })
      .catch(() => { if (alive) setSt({ status: 'empty' }) })
    return () => { alive = false }
  }, [clientId, period.key])

  async function generate() {
    if (!client) return
    setBusy(true); setSt({ status: 'loading' })
    try {
      const report = await assembleMonthlyReport(client, period)
      setSt({ status: 'ok', report, frozen: false })
      const save = await fetch(`/.netlify/functions/windsor?scope=monthlysnap&client=${encodeURIComponent(client.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: period.key, report }) }).then((x) => x.json()).catch(() => null)
      if (save && save.ok) { setSaved({ savedAt: save.savedAt, savedBy: save.savedBy }); setSt({ status: 'ok', report, frozen: true }) }
    } catch (e) { setSt({ status: 'err', error: String(e.message || e) }) }
    setBusy(false)
  }

  async function downloadPdf() {
    if (!deckRef.current) return
    setExporting(true)
    // Force the deck into a laid-out, non-transformed column so every slide
    // (including the ones translated off-screen in Slides view) captures cleanly.
    deckRef.current.classList.add('mr-exporting')
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const slides = [...deckRef.current.querySelectorAll('.mr-slide')]
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const bg = getComputedStyle(document.body).backgroundColor || '#fff'
      for (let i = 0; i < slides.length; i++) {
        const canvas = await html2canvas(slides[i], { scale: 2, backgroundColor: bg, useCORS: true, logging: false })
        const img = canvas.toDataURL('image/jpeg', 0.92)
        const r = Math.min(pw / canvas.width, ph / canvas.height)
        const w = canvas.width * r, h = canvas.height * r
        if (i) pdf.addPage()
        pdf.addImage(img, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h)
      }
      pdf.save(`${(client && client.name || 'report').replace(/[^\w]+/g, '-')}-${period.key}.pdf`)
    } catch (e) { alert('PDF export failed: ' + (e.message || e)) }
    if (deckRef.current) deckRef.current.classList.remove('mr-exporting')
    setExporting(false)
  }

  const rep = st.status === 'ok' ? st.report : null
  const deck = React.useMemo(() => (rep ? renderMonthlyDeck(rep, { currency, money, n0, pc, openDrill: (d) => setDrill(d) }) : []), [rep, currency])
  const total = deck.length
  const cur = Math.max(0, Math.min(idx, total - 1))
  const slideTitle = (el, i) => (el && el.props && (el.props.title || el.props.kicker)) || (el && el.key === 'cover' ? 'Cover' : `Slide ${i + 1}`)
  useEffect(() => { setIdx(0) }, [clientId, period.key, view])
  useEffect(() => {
    if (view !== 'slides' || !total || drill) return
    const onKey = (e) => {
      if (/^(input|select|textarea)$/i.test((e.target && e.target.tagName) || '')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { setIdx((i) => Math.min(i + 1, total - 1)); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { setIdx((i) => Math.max(i - 1, 0)); e.preventDefault() }
      else if (e.key === 'Home') { setIdx(0) } else if (e.key === 'End') { setIdx(total - 1) }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [view, total, drill])

  return (
    <div className={'mr-page' + (fs ? ' mr-fs' : '')} ref={pageRef}>
      <div className="mr-bar no-print">
        <select className="mr-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="mr-select" value={fromMonth} onChange={(e) => { const v = e.target.value; setFromMonth(v); if (toMonth < v) setToMonth(v) }} title="From month">
          {MR_MONTHS().map((m) => <option key={m} value={m}>{monthBounds(m).label}</option>)}
        </select>
        <span className="mr-to">to</span>
        <select className="mr-select" value={toMonth} onChange={(e) => { const v = e.target.value; setToMonth(v); if (fromMonth > v) setFromMonth(v) }} title="To month (same as From = single month)">
          {MR_MONTHS().map((m) => <option key={m} value={m}>{monthBounds(m).label}</option>)}
        </select>
        <button className="mr-btn primary" onClick={generate} disabled={busy}>{busy ? 'Generating…' : (saved ? 'Refresh snapshot' : 'Generate snapshot')}</button>
        <div className="mr-bar-spacer" />
        {saved && <span className="mr-saved" title={`Frozen ${new Date(saved.savedAt).toLocaleString()}${saved.savedBy ? ' by ' + saved.savedBy : ''}`}>🔒 Snapshot frozen {saved.savedAt ? new Date(saved.savedAt).toLocaleDateString() : ''}</span>}
        <div className="mr-viewtoggle" title="Slides = one section per page · Scroll = continuous">
          <button className={view === 'slides' ? 'on' : ''} onClick={() => setView('slides')}>▤ Slides</button>
          <button className={view === 'scroll' ? 'on' : ''} onClick={() => setView('scroll')}>▦ Scroll</button>
        </div>
        <button className="mr-btn" onClick={present} disabled={!rep} title="Present fullscreen (for screen-share)">{fs ? '⤢ Exit' : '⛶ Present'}</button>
        <button className="mr-btn" onClick={() => window.print()} disabled={!rep} title="Print / Save as PDF">🖨 Print</button>
        <button className="mr-btn" onClick={downloadPdf} disabled={!rep || exporting} title="Download as PDF">{exporting ? 'Exporting…' : '⤓ Download PDF'}</button>
      </div>

      {st.status === 'loading' && <div className="mr-note"><Spinner label="Loading report…" /></div>}
      {st.status === 'err' && <div className="mr-note mr-err">Couldn’t build the report: {st.error}</div>}
      {st.status === 'empty' && <div className="mr-note mr-empty-deep"><div className="big">🗓️</div><b>No snapshot for {period.label} yet.</b><p>Pick the client and period (one month, or a range via the two pickers), then <b>Generate snapshot</b> to freeze these numbers. Wins are captured by the month a deal was marked won — so late-closing leads show in the month they closed.</p></div>}

      {rep && view === 'slides' && total > 0 && (
        <div className="mr-nav no-print">
          <button className="mr-nav-arrow" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={cur === 0} aria-label="Previous slide">‹</button>
          <div className="mr-nav-chips">
            {deck.map((el, i) => <button key={i} className={'mr-nav-chip' + (i === cur ? ' on' : '')} onClick={() => setIdx(i)} title={slideTitle(el, i)}><span className="mr-nav-num">{i + 1}</span><span className="mr-nav-t">{slideTitle(el, i)}</span></button>)}
          </div>
          <button className="mr-nav-arrow" onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} disabled={cur === total - 1} aria-label="Next slide">›</button>
          <span className="mr-nav-count">{cur + 1} / {total}</span>
        </div>
      )}
      {rep && (
        <div className={'mr-deck' + (view === 'slides' ? ' mr-slides' : '')} ref={deckRef}>
          <div className="mr-track" style={view === 'slides' ? { transform: `translateX(-${cur * 100}%)` } : undefined}>{deck}</div>
        </div>
      )}
      {drill && <MRDrill drill={drill} currency={currency} onClose={() => setDrill(null)} />}
    </div>
  )
}

// Drill-down modal: a scrollable list of the actual deals behind a number, so
// figures can be sense-checked live with the client (who, when the lead came in,
// when it closed, value, source). Screen-only (never in the PDF).
function MRDrill({ drill, currency, onClose }) {
  const money = (v) => (v == null || isNaN(v) ? '—' : fmtCurrency(v, currency))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [])
  const deals = drill.deals || []
  const isLost = drill.kind === 'lost'
  const total = deals.reduce((s, d) => s + (d.value || 0), 0)
  // Show the Ad/creative column only when we actually have attribution detail for
  // at least one deal (older snapshots won't carry ad/campaign). The overlay width
  // scales to the column count so more data never forces horizontal scrolling.
  const hasAd = deals.some((d) => d.ad || d.campaign)
  const colCount = 7 + (isLost ? 1 : 1) + (hasAd ? 1 : 0)
  return (
    <div className="mr-drill-overlay no-print" onClick={onClose}>
      <div className="mr-drill" onClick={(e) => e.stopPropagation()} style={{ '--mr-drill-cols': colCount }}>
        <div className="mr-drill-head">
          <div><h3>{drill.title}</h3><span>{deals.length} deal(s) · {money(total)} total</span></div>
          <button className="mr-drill-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mr-drill-body">
          {deals.length ? (
            <table className="mr-table">
              <thead><tr>
                <th>Contact</th><th>Lead created</th><th>{isLost ? 'Lost' : 'Won'}</th>
                {!isLost && <th className="r">Days to close</th>}
                {isLost && <th>Reason</th>}<th>Source</th>
                {hasAd && <th>Ad / creative</th>}
                <th>Pipeline · stage</th><th>Owner</th><th className="r">Value</th>
              </tr></thead>
              <tbody>{deals.map((d, i) => {
                const days = (d.createdAt && d.statusAt) ? Math.max(0, Math.round((Date.parse(d.statusAt) - Date.parse(d.createdAt)) / 86400000)) : null
                return (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>{fmtDate(d.statusAt)}</td>
                  {!isLost && <td className="r">{days == null ? '—' : days}</td>}
                  {isLost && <td>{d.reason || '—'}</td>}
                  <td><span className={`mr-src mr-src-${d.channel || 'other'}`}>{d.channel === 'meta' ? 'Meta' : d.channel === 'google' ? 'Google' : 'Other'}</span></td>
                  {hasAd && <td className="mr-drill-ad">{d.ad || d.campaign ? <span title={[d.campaign, d.ad].filter(Boolean).join(' · ')}>{d.ad || d.campaign}</span> : '—'}</td>}
                  <td>{[d.pipeline, d.stage].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{d.userName || '—'}</td>
                  <td className="r">{money(d.value)}</td>
                </tr>
              )})}</tbody>
            </table>
          ) : <div className="mr-empty">No deals to show.</div>}
        </div>
      </div>
    </div>
  )
}

// One large creative card for the Monthly Report: Meta stats + the Caalano360
// CRM key-event funnel (Leads → Booked → Shown → Won → Revenue) attributed to
// this creative's UTM, plus inline Instagram playback via the ad's permalink.
function MRCreative({ a, money, n0 }) {
  const [play, setPlay] = useState(false)
  const ctrV = a.impressions ? (a.clicks / a.impressions) * 100 : null
  const results = a.results != null ? a.results : a.leads
  const cprV = results ? a.spend / results : null
  const freqV = a.reach ? a.impressions / a.reach : null
  const embed = a.igUrl ? a.igUrl.replace(/\/+$/, '') + '/embed' : null
  const events = a.events || null // per-client configured key events [{label,count,kind}]
  const revenue = a.revenue != null ? a.revenue : (a.ke ? a.ke.revenue : 0)
  const roas = a.roas != null ? a.roas : (a.ke && a.ke.revenue && a.spend ? a.ke.revenue / a.spend : null)
  const cpw = a.cpw != null ? a.cpw : (a.ke && a.ke.won && a.spend ? a.spend / a.ke.won : null)
  useEffect(() => {
    if (!play) return
    const onKey = (e) => { if (e.key === 'Escape') setPlay(false) }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [play])
  // Funnel rows = a Leads anchor + each configured key event, so we can compute
  // next-step conversion (this step ÷ the previous step) and cost per event.
  const feRows = [{ label: 'Leads', count: a.leads || 0, kind: 'lead' }, ...(events || [])]
  return (
    <div className="mr-cre">
      <div className="mr-cre-top">
        <div className="mr-cre-thumb">
          {a.thumb ? <img src={a.thumb} alt="" loading="lazy" crossOrigin="anonymous" /> : <span className="mr-noimg">{a.type === 'Video' ? '▶' : '🖼'}</span>}
          {embed
            ? <button className="mr-cre-play no-print" onClick={() => setPlay(true)} aria-label="Play">▶</button>
            : (a.igUrl && <a className="mr-cre-play no-print" href={a.igUrl} target="_blank" rel="noreferrer" aria-label="Open on Instagram">▶</a>)}
          {a.type === 'Video' && <span className="mr-cre-badge">▶ Video</span>}
        </div>
        <div className="mr-cre-head">
          <div className="mr-cre-name" title={a.name}>{a.name}{a.adset ? <small>{a.adset}</small> : null}</div>
          {a.pipeName ? <div className="mr-cre-pipe" title={`This creative's campaign is attached to the ${a.pipeName} pipeline`}>🔗 {a.pipeName}</div> : null}
          <div className="mr-cre-metrics">
            <div><b>{money(a.spend)}</b><span>Spend</span></div>
            <div><b>{n0(a.impressions)}</b><span>Impr</span></div>
            <div><b>{ctrV == null ? '—' : fmtPct(ctrV, 2)}</b><span>CTR</span></div>
            <div><b>{freqV != null ? freqV.toFixed(1) + 'x' : '—'}</b><span>Freq</span></div>
            <div><b>{n0(results)}</b><span>{a.resultType || 'Results'}</span></div>
            <div><b>{cprV == null ? '—' : money(cprV)}</b><span>Cost/result</span></div>
          </div>
        </div>
      </div>
      {events && events.length ? (
        <div className="mr-cre-ke">
          <div className="mr-cre-ke-lab">📈 Caalano360 · key events</div>
          <div className="mr-cre-ketbl-wrap">
            <table className="mr-cre-ketbl">
              <colgroup>
                <col className="ke-name" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" />
              </colgroup>
              <thead><tr>
                <th>Key event</th>
                <th className="r">Count</th>
                <th className="r" title="This event's count ÷ total leads">% leads</th>
                <th className="r" title="This step ÷ the previous step">Next</th>
                <th className="r" title="Calendar events only: shown ÷ booked">Show %</th>
                <th className="r" title="This creative's ad-level spend ÷ this event's count">Cost / stage</th>
              </tr></thead>
              <tbody>
                {feRows.map((e, i) => {
                  const isCal = e.kind === 'calendar'
                  const prev = i > 0 ? feRows[i - 1].count : null
                  const pctLeads = a.leads && e.count != null ? (e.count / a.leads) * 100 : null
                  const nextStep = prev && e.count != null ? (e.count / prev) * 100 : null
                  const costEv = e.count && a.spend ? a.spend / e.count : null
                  const cls = e.kind === 'won' ? 'mr-ketbl-won' : e.kind === 'lead' ? 'mr-ketbl-lead' : ''
                  return (
                    <tr key={i} className={cls}>
                      <td title={e.label}>{e.label}{isCal && e.shown != null ? <small> · {n0(e.shown)} shown</small> : null}</td>
                      <td className="r">{n0(e.count)}</td>
                      <td className="r">{e.kind === 'lead' ? '100%' : pctLeads == null ? '—' : fmtPct(pctLeads, 0)}</td>
                      <td className="r">{nextStep == null ? '—' : fmtPct(nextStep, 0)}</td>
                      <td className="r">{isCal && e.showRate != null ? fmtPct(e.showRate, 0) : '—'}</td>
                      <td className="r">{costEv == null ? '—' : money(costEv)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mr-cre-cash">
            <div><b>{money(revenue)}</b><span>Revenue</span></div>
            <div><b>{cpw == null ? '—' : money(cpw)}</b><span>Cost / won</span></div>
            <div><b>{roas == null ? '—' : roas.toFixed(1) + 'x'}</b><span>ROAS</span></div>
          </div>
        </div>
      ) : <div className="mr-cre-ke mr-cre-ke-empty">No CRM-attributed leads matched this creative’s UTM (utm_content).</div>}
      {play && embed && (
        <div className="mr-play-overlay no-print" onClick={() => setPlay(false)}>
          <div className="mr-play-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mr-play-head"><b title={a.name}>{a.name}</b><button className="mr-play-x" onClick={() => setPlay(false)} aria-label="Close">✕</button></div>
            <iframe className="mr-play-frame" src={embed} title={a.name} scrolling="no" frameBorder="0" allow="autoplay; encrypted-media; clipboard-write; picture-in-picture" allowFullScreen />
            <a className="mr-play-open" href={a.igUrl} target="_blank" rel="noreferrer">Open on Instagram ↗</a>
          </div>
        </div>
      )}
    </div>
  )
}

// Status Change vs Created On revenue matrix — the same figures side by side so
// the client can see cash banked this month vs how this month's leads are doing.
function MRRevMatrix({ sc, co, spend, money, n0, onDrill }) {
  const cell = (v, deals, title) => onDrill && deals && deals.length
    ? <button className="mr-cellbtn" onClick={() => onDrill({ title, deals })}>{v}</button> : v
  const days = (v) => (v == null ? '—' : `${v} day${v === 1 ? '' : 's'}`)
  const roas = (rev) => (spend ? (rev / spend).toFixed(1) + 'x' : '—')
  const cac = (paidWon) => (spend && paidWon ? money(spend / paidWon) : '—')
  return (
    <table className="mr-table mr-revmatrix">
      <thead><tr><th></th><th className="r">Status change<small>closed this month</small></th><th className="r">Created on<small>leads created this month</small></th></tr></thead>
      <tbody>
        <tr><td>Total revenue</td><td className="r">{money(sc.revenue)}</td><td className="r">{money(co.revenue)}</td></tr>
        <tr><td>Paid revenue</td><td className="r">{money(sc.paid.revenue)}</td><td className="r">{money(co.paid.revenue)}</td></tr>
        <tr><td>Paid ROAS</td><td className="r">{roas(sc.paid.revenue)}</td><td className="r">{roas(co.paid.revenue)}</td></tr>
        <tr><td>CAC (cost / paid won)</td><td className="r">{cac(sc.paid.count)}</td><td className="r">{cac(co.paid.count)}</td></tr>
        <tr><td>Deals won</td><td className="r">{cell(n0(sc.count), sc.deals, 'Deals won — closed this month')}</td><td className="r">{cell(n0(co.count), co.deals, 'Deals won — leads created this month')}</td></tr>
        <tr><td>Avg won value</td><td className="r">{sc.avgValue ? money(sc.avgValue) : '—'}</td><td className="r">{co.avgValue ? money(co.avgValue) : '—'}</td></tr>
        <tr><td>Avg time to close</td><td className="r">{days(sc.avgCloseDays)}</td><td className="r">{days(co.avgCloseDays)}</td></tr>
      </tbody>
    </table>
  )
}

// Expandable parent/child table for the report drills (campaign→ad set,
// campaign→conversion actions). Interactive on screen; every child row is forced
// open in the PDF/print export so nothing is lost on paper.
function MRDrillTable({ cols, rows, rowKey, childrenOf, renderChildren, max, empty = 'No data for this period.' }) {
  const [open, setOpen] = useState(() => new Set())
  if (!rows || !rows.length) return <div className="mr-empty">{empty}</div>
  const data = max ? rows.slice(0, max) : rows
  const toggle = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const span = cols.length + 1
  return (
    <div className="mr-tablewrap">
      <table className="mr-table mr-drilltbl">
        <thead><tr><th className="mr-exp-th" aria-hidden="true" />{cols.map((c) => <th key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => {
          const k = rowKey(row, i); const kids = childrenOf(row) || []; const isOpen = open.has(k)
          return (
            <React.Fragment key={k}>
              <tr className={'mr-drow' + (kids.length ? ' has-kids' : '')} onClick={() => kids.length && toggle(k)}>
                <td className="mr-exp-cell">{kids.length ? <span className="mr-exp-ic">{isOpen ? '▾' : '▸'}</span> : ''}</td>
                {cols.map((c) => <td key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(row) : row[c.k]}</td>)}
              </tr>
              {kids.length ? <tr className={'mr-kids' + (isOpen ? ' open' : '')}><td colSpan={span} className="mr-kids-cell">{renderChildren(kids, row)}</td></tr> : null}
            </React.Fragment>
          )
        })}</tbody>
      </table>
    </div>
  )
}
// Status donut (this period's leads by open / won / lost).
function MRDonut({ data, money }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  if (!total) return <div className="mr-empty">No leads in this period.</div>
  return (
    <div className="mr-donut">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, n) => [fmtNumber(v), n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
// Creative performance — visual cards (big thumbnail + all stats + the client's
// configured key events), with a sort control and pagination (10 per page).
function MRCreativeSection({ ads, oCre, o360cols, o360colsFor, pipeLabelFor, money, n0, currency }) {
  const groups = o360cols ? o360cols.groups : []
  // Enrich each creative: platform metrics + the per-client key-event counts + cash.
  // Each creative's key events come from the pipeline attached to its campaign
  // (o360colsFor), so multi-pipeline clients only show that ad's pipeline's events.
  const enriched = ads.map((a) => {
    const o = oCre.get(unorm(a.name))
    const leads = a.results != null ? a.results : a.leads
    const cols = (o360colsFor ? o360colsFor(a.campaign) : o360cols) || o360cols
    let events = [], won = 0, revenue = 0
    const evByLabel = new Map()
    if (cols && o) {
      const f = o360Fields(o, a.spend, leads, cols)
      let ci = 0
      for (const g of cols.groups) {
        const seg = cols.cols.slice(ci, ci + g.span); ci += g.span
        const first = seg.find((c) => c.gfirst) || seg[0]
        const count = f[first.key] || 0
        const ev = { label: g.label, count, kind: g.kind, rate: null, shown: null, showRate: null }
        if (g.kind === 'calendar') {
          const shCol = seg.find((c) => c.metric === 'calShown')
          const srCol = seg.find((c) => c.metric === 'calShowRate')
          const brCol = seg.find((c) => c.metric === 'calBookRate')
          ev.shown = shCol ? f[shCol.key] : null
          ev.showRate = srCol ? f[srCol.key] : null
          ev.rate = brCol ? f[brCol.key] : null   // book rate (booked ÷ leads)
        } else if (g.kind === 'won') {
          const wrCol = seg.find((c) => c.metric === 'wonRate')
          ev.rate = wrCol ? f[wrCol.key] : null
        } else {
          const rrCol = seg.find((c) => c.metric === 'stageRate')
          ev.rate = rrCol ? f[rrCol.key] : null
        }
        events.push(ev)
        evByLabel.set(g.label, count)
        if (g.kind === 'won') { won = count; revenue = o.revenue || 0 }
      }
    }
    const ctr = a.impressions ? (a.clicks / a.impressions) * 100 : null
    const pipeName = pipeLabelFor ? pipeLabelFor(a.campaign) : null
    return { ...a, leads, ctrV: ctr, cpl: leads ? a.spend / leads : null, events, evByLabel, won, revenue, pipeName, roas: revenue && a.spend ? revenue / a.spend : null, cpw: won && a.spend ? a.spend / won : null }
  })
  // Sort chips span the UNION of every pipeline's key events (shared o360cols); a
  // creative without that event just sorts as 0.
  // Dedupe event chips by label — the union spans every pipeline, so the same
  // stage name (e.g. "Booked Discovery Call") can appear in more than one pipeline.
  const uniqGroups = [...new Map(groups.map((g) => [g.label, g])).values()]
  const METRICS = [
    { k: 'spend', label: 'Spend' }, { k: 'ctrV', label: 'CTR' }, { k: 'leads', label: 'Leads' }, { k: 'cpl', label: 'CPL', asc: true },
    ...uniqGroups.map((g, i) => ({ k: 'ev' + i, label: g.label, evLabel: g.label })),
    { k: 'revenue', label: 'Revenue' }, { k: 'roas', label: 'ROAS' },
  ]
  const [sortK, setSortK] = useState('spend')
  const [page, setPage] = useState(0)
  const PER = 10
  const m = METRICS.find((x) => x.k === sortK) || METRICS[0]
  const valOf = (a) => (m.evLabel != null ? ((a.evByLabel && a.evByLabel.get(m.evLabel)) || 0) : (a[m.k] || 0))
  const sorted = [...enriched].sort((x, y) => (m.asc ? valOf(x) - valOf(y) : valOf(y) - valOf(x)))
  const pages = Math.max(1, Math.ceil(sorted.length / PER))
  const cur = Math.min(page, pages - 1)
  const pageAds = sorted.slice(cur * PER, cur * PER + PER)
  return (
    <>
      <div className="mr-cre-sort no-print">
        <span>Sort by</span>
        {METRICS.map((x) => <button key={x.k} className={sortK === x.k ? 'on' : ''} onClick={() => { setSortK(x.k); setPage(0) }}>{x.label}</button>)}
      </div>
      <div className="mr-cre-grid">{pageAds.map((a, i) => <MRCreative key={cur + '-' + i} a={a} money={money} n0={n0} />)}</div>
      {pages > 1 && (
        <div className="mr-cre-pager no-print">
          <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button>
          <span>Page {cur + 1} / {pages} · {sorted.length} creatives · sorted by {m.label}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
        </div>
      )}
    </>
  )
}

// Pure renderer for the deck so it can be reused by both the live view and the
// frozen snapshot (identical shape). Returns an array of <MRSlide> elements.
function renderMonthlyDeck(rep, h) {
  const { currency, money, n0, pc, openDrill } = h
  const b = rep.period
  const meta = rep.meta, google = rep.google, blend = rep.blend, attribution = rep.attribution
  const won = rep.wonClosed || (blend && blend.wonClosed) || null
  const paid = (blend && blend.paid) || {}
  const crm = (blend && blend.crm) || {}          // created-on cohort (opps created this month)
  const pipelines = (blend && blend.pipelines) || []
  const users = (blend && blend.users) || []
  const totalSpend = paid.adSpend || (((meta && meta.totals && meta.totals.spend) || 0) + ((google && google.totals && google.totals.cost) || 0))
  // Paid leads = Meta's optimised RESULTS (sum of each campaign's own objective
  // result, matching Ads Manager) + Google conversions — not native lead-form
  // leads only, which under-count website/conversion campaigns.
  const metaResults = (meta && meta.totals && meta.totals.results != null) ? meta.totals.results : ((paid.metaLeads) || 0)
  const gConv = (google && google.totals && google.totals.conversions) || paid.googleConv || 0
  const paidLeads = Math.round(metaResults + gConv)

  // Two won bases, deal-level (rep.deals) preferred; fall back to the wonInPeriod
  // aggregate (rep.wonClosed) for snapshots frozen before deal lists existed.
  //   scWon = STATUS CHANGE: deals marked won this month (cash view, any lead date)
  //   coWon = CREATED ON:    deals whose lead was created this month & are won
  const md = rep.deals || null
  const emptyWon = { count: 0, revenue: 0, avgValue: 0, avgCloseDays: null, paid: { count: 0, revenue: 0 }, byUser: {}, byChannel: { meta: { count: 0, revenue: 0 }, google: { count: 0, revenue: 0 }, other: { count: 0, revenue: 0 } }, deals: [] }
  const scWon = md ? md.statusChange.won : (won ? {
    count: won.total.won, revenue: won.total.revenue, avgValue: won.total.avgValue, avgCloseDays: won.avgCloseDays != null ? won.avgCloseDays : null,
    paid: { count: ((won.channels.meta && won.channels.meta.won) || 0) + ((won.channels.google && won.channels.google.won) || 0), revenue: ((won.channels.meta && won.channels.meta.revenue) || 0) + ((won.channels.google && won.channels.google.revenue) || 0) },
    byUser: won.byUser || {}, byChannel: { meta: won.channels.meta || { count: 0, revenue: 0 }, google: won.channels.google || { count: 0, revenue: 0 }, other: won.channels.other || { count: 0, revenue: 0 } }, deals: [],
  } : emptyWon)
  const coWon = md ? md.createdOn.won : { count: crm.won || 0, revenue: crm.revenue || 0, avgValue: crm.avgValue || 0, avgCloseDays: null, paid: { count: 0, revenue: 0 }, byUser: {}, byChannel: emptyWon.byChannel, deals: [] }
  const lost = md ? md.lost : { total: { count: 0, value: 0 }, byReason: [], deals: [] }

  // Cash view (status change) is the headline for revenue/ROAS.
  const dealsWon = scWon.count
  const realisedRev = scWon.revenue
  const paidRev = scWon.paid.revenue
  const paidWon = scWon.paid.count
  const roas = totalSpend ? paidRev / totalSpend : null   // paid, status-change (cash ROAS)

  // Slide list (Google slides only when connected).
  const slides = []
  const push = (el) => slides.push(el)

  // Meta metric helpers
  const cpm = (r) => (r.impressions ? (r.spend / r.impressions) * 1000 : null)
  const freq = (r) => (r.reach ? r.impressions / r.reach : null)
  const ctr = (r) => (r.impressions ? (r.clicks / r.impressions) * 100 : null)
  const cpl = (r) => (r.leads ? r.spend / r.leads : null)
  const metaCols = (nameKey, nameLabel, extra) => [
    { k: 'name', label: nameLabel, render: (r) => <span className="mr-name">{r[nameKey] || r.name}{extra && r[extra] ? <small>{r[extra]}</small> : null}</span> },
    { k: 'spend', label: 'Spend', align: 'r', render: (r) => money(r.spend) },
    { k: 'impr', label: 'Impr.', align: 'r', render: (r) => n0(r.impressions) },
    { k: 'reach', label: 'Reach', align: 'r', render: (r) => n0(r.reach) },
    { k: 'freq', label: 'Freq.', align: 'r', render: (r) => { const f = freq(r); return f == null ? '—' : f.toFixed(1) + 'x' } },
    { k: 'cpm', label: 'CPM', align: 'r', render: (r) => { const v = cpm(r); return v == null ? '—' : money(v) } },
    { k: 'ctr', label: 'CTR', align: 'r', render: (r) => { const v = ctr(r); return v == null ? '—' : fmtPct(v, 2) } },
    { k: 'results', label: 'Results', align: 'r', render: (r) => (r.results ? `${n0(r.results)}${r.resultType ? ' ' + r.resultType : ''}` : '—') },
    { k: 'leads', label: 'Leads', align: 'r', render: (r) => n0(r.leads) },
    { k: 'cpl', label: 'CPL', align: 'r', render: (r) => { const v = cpl(r); return v == null ? '—' : money(v) } },
  ]

  // Caalano360 green key-event setup — shared by the creative table, the
  // key-events-by-campaign slide and the CRM slides.
  const stagePos = stagePosMap(pipelines)
  const calNames = new Map(((attribution && attribution.appointments && attribution.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = rep.hasCrm ? buildO360Cols(loadKeyEvents(rep.client.id), stagePos, calNames) : null
  const oCamp = aliasedOutcomeMap(rep.client.id, 'campaign', rep.campOutcomes || [])
  const oCre = aliasedOutcomeMap(rep.client.id, 'content', rep.creOutcomes || [])
  // Per-pipeline key events: multi-pipeline clients show only the key events for
  // the pipeline attached (in Settings → campaign map) to a creative's / campaign's
  // campaign. Single-pipeline clients (or unmapped campaigns → "All") keep the full
  // union set. o360colsFor(campaignName) returns the right green-column descriptor.
  const multiPipe = rep.hasCrm && pipelines.length > 1
  const campPipeMap = rep.hasCrm ? loadCampMap(rep.client.id) : {}
  const rawKeyEvents = rep.hasCrm ? loadKeyEvents(rep.client.id) : []
  const pipeColsCache = new Map()
  // Resolve a campaign to a pipeline id: an explicit Settings link wins; "all" keeps
  // the union; otherwise fall back to a name-token match against the pipeline names
  // (same matcher the forms use) so campaigns left on "Auto" still resolve. null →
  // union (truly unmatched).
  const pipeOfCampaign = (campName) => {
    if (!multiPipe || campName == null) return null
    const t = campPipeMap[campName]
    if (t === 'all') return null
    if (t) return t
    return suggestPipeline(campName, pipelines) || null
  }
  const pipeNameOf = (pid) => ((pipelines.find((p) => p.id === pid) || {}).name || null)
  const pipeLabelFor = (campName) => pipeNameOf(pipeOfCampaign(campName))
  const o360colsFor = (campName) => {
    if (!o360cols) return null
    const pid = pipeOfCampaign(campName)
    if (!pid) return o360cols
    if (pipeColsCache.has(pid)) return pipeColsCache.get(pid)
    const c = buildO360Cols(keyEventsForPipe(rawKeyEvents, pid), stagePos, calNames)
    pipeColsCache.set(pid, c)
    return c
  }

  // ---- Cover ----
  push(
    <section className="mr-slide mr-cover" key="cover">
      <div className="mr-cover-top"><span className="mr-cover-brand">Caalano<b>360</b></span><span className="mr-cover-kicker">Monthly Performance Report</span></div>
      <div className="mr-cover-mid">
        <h1>{rep.client.name}</h1>
        {rep.client.industry && <p className="mr-cover-ind">{rep.client.industry}</p>}
        <div className="mr-cover-month">{b.label}</div>
      </div>
      <div className="mr-cover-foot">Generated {new Date(rep.generatedAt).toLocaleDateString()} · Wins &amp; revenue attributed to the month each deal was marked won.</div>
    </section>
  )

  // ---- Meta slides ----
  if (rep.hasMeta && meta) {
    const t = meta.totals || {}
    // Compact platform columns for the campaign→ad-set drill table.
    const metaDrillCols = (nameLabel) => [
      { k: 'name', label: nameLabel, render: (r) => <span className="mr-name">{r.name}</span> },
      { k: 'spend', label: 'Spend', align: 'r', render: (r) => money(r.spend) },
      { k: 'impr', label: 'Impr.', align: 'r', render: (r) => n0(r.impressions) },
      { k: 'reach', label: 'Reach', align: 'r', render: (r) => n0(r.reach) },
      { k: 'ctr', label: 'CTR', align: 'r', render: (r) => { const v = ctr(r); return v == null ? '—' : fmtPct(v, 2) } },
      { k: 'results', label: 'Results', align: 'r', render: (r) => n0(r.results != null ? r.results : r.leads) },
      { k: 'cpl', label: 'Cost/res', align: 'r', render: (r) => { const res = r.results != null ? r.results : r.leads; return res ? money(r.spend / res) : '—' } },
    ]
    const adsetsOf = (campName) => (meta.adsets || []).filter((a) => a.campaign === campName)
    push(
      <MRSlide key="m-camp" kicker="Meta Ads · Platform" title="Campaign & ad set performance" sub={`${(meta.campaigns || []).length} campaign(s) · ${b.label} · click a campaign to drill into its ad sets`}>
        <div className="mr-kpirow">
          <MRKpi label="Spend" value={money(t.spend)} />
          <MRKpi label="Impressions" value={n0(t.impressions)} />
          <MRKpi label="Reach" value={n0(t.reach)} />
          <MRKpi label="Frequency" value={t.reach ? (t.impressions / t.reach).toFixed(1) + 'x' : '—'} />
          <MRKpi label="CTR" value={t.impressions ? fmtPct((t.clicks / t.impressions) * 100, 2) : '—'} />
          <MRKpi label="Results" value={n0(t.results != null ? t.results : t.leads)} sub={t.resultBreakdown && t.resultBreakdown.length > 1 ? 'mixed objectives' : (t.resultBreakdown && t.resultBreakdown[0] ? t.resultBreakdown[0].label : null)} />
          <MRKpi label="Cost / result" value={(t.results != null ? t.results : t.leads) ? money(t.spend / (t.results != null ? t.results : t.leads)) : '—'} strong />
        </div>
        <MRDrillTable
          cols={metaDrillCols('Campaign')} rows={meta.campaigns || []} max={16}
          rowKey={(r) => r.name}
          childrenOf={(r) => adsetsOf(r.name)}
          renderChildren={(kids) => <div className="mr-kids-inner"><div className="mr-kids-lab">Ad sets</div><MRTable cols={metaDrillCols('Ad set')} rows={kids} /></div>}
        />
        <div className="mr-section-lab">6-month trend</div>
        <MRTrend trend={rep.trend} currency={currency} />
      </MRSlide>
    )
    const spendAds = (meta.ads || []).filter((a) => (a.spend || 0) > 0)
    push(
      <MRSlide key="m-cre" kicker="Meta Ads · Creative" title="Creative performance" sub={`${spendAds.length} creative(s) with spend · sort & page through, 10 at a time`}>
        {spendAds.length
          ? <MRCreativeSection ads={spendAds} oCre={oCre} o360cols={o360cols} o360colsFor={o360colsFor} pipeLabelFor={multiPipe ? pipeLabelFor : null} money={money} n0={n0} currency={currency} />
          : <div className="mr-empty">No creatives with spend for this period.</div>}
        <p className="mr-foot-note">All creatives that spent this period, sortable by any metric, 10 per page. <b>Leads</b> = Meta results; the key-event chips are the client's configured <b>key events</b> (Settings → Key events) for leads whose ad UTM (utm_content) matches the creative. ▶ plays the Instagram post inline where a permalink is available.</p>
      </MRSlide>
    )
  }

  // ---- Key events by campaign (Caalano360 green columns) — right after creative ----
  if (rep.hasCrm && o360cols) {
    const campSrc = []
    for (const c of (meta && meta.campaigns) || []) campSrc.push({ name: c.name, channel: 'meta', spend: c.spend || 0, leads: (c.results != null ? c.results : c.leads) || 0 })
    for (const c of (google && google.campaigns) || []) campSrc.push({ name: c.name, channel: 'google', spend: c.cost || 0, leads: c.conversions || 0 })
    const campRows = campSrc.map((c) => ({ ...c, ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, o360cols) })).sort((a, b2) => b2.spend - a.spend).slice(0, 16)
    // Visual layer: pick the "headline" key event (the Won group if configured,
    // else the last event) and chart which campaigns drive it, plus its share.
    const firstCols = o360cols.cols.filter((c) => c.gfirst)
    const gWonIdx = o360cols.groups.findIndex((g) => g.kind === 'won')
    const headIdx = gWonIdx >= 0 ? gWonIdx : o360cols.groups.length - 1
    const headKey = firstCols[headIdx] ? firstCols[headIdx].key : null
    const headLabel = o360cols.groups[headIdx] ? o360cols.groups[headIdx].label.replace(/^📅 /, '') : 'Key event'
    const shortName = (s) => (s && s.length > 24 ? s.slice(0, 22) + '…' : (s || '—'))
    const PIEK = ['#6d5efc', '#12b886', '#e0803a', '#4285f4', '#e1306c', '#f59e0b', '#9b8cff', '#ef4444']
    const barData = campRows.filter((c) => c._has360)
      .map((c) => ({ name: shortName(c.name), full: c.name, leads: c.leads || 0, event: headKey ? (c[headKey] || 0) : 0 }))
      .sort((a, b2) => (b2.event - a.event) || (b2.leads - a.leads)).slice(0, 8)
    const donutData = barData.filter((d) => d.event > 0).map((d, i) => ({ name: d.name, value: d.event, color: PIEK[i % PIEK.length] }))
    // A green key-events-by-campaign table for a set of campaigns + a column
    // descriptor (its pipeline's key events). Returns null if no CRM data matched.
    const renderCampTable = (rows, cols, label) => {
      const withF = rows.map((c) => ({ ...c, ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, cols) })).sort((a, b2) => b2.spend - a.spend).slice(0, 16)
      if (!cols || !withF.some((c) => c._has360)) return null
      return (
        <div key={label || 'all'} className="mr-camp-block">
          {label ? <div className="mr-section-lab">{label}</div> : null}
          <div className="mr-tablewrap mr-o360-wrap">
            <table className="mr-table o360-tbl mr-o360">
              <colgroup>
                <col style={{ width: 210 }} /><col style={{ width: 84 }} /><col style={{ width: 60 }} />
                {cols.cols.map((c) => <col key={c.key} className={o360ColClass(c)} />)}
              </colgroup>
              <thead>
                <C360GrpRow left={3} cols={cols} />
                <tr><th>Campaign</th><th className="r">Spend</th><th className="r">Leads</th><O360Head cols={cols} /></tr>
              </thead>
              <tbody>{withF.map((c, i) => (
                <tr key={i}>
                  <td className="mr-o360-name" title={c.name}><span className={`mr-src mr-src-${c.channel}`}>{c.channel === 'meta' ? 'Meta' : 'Google'}</span> {c.name}</td>
                  <td className="r">{money(c.spend)}</td><td className="r">{n0(c.leads)}</td>
                  {o360Cells(c, currency, cols)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    }
    // Multi-pipeline: one table per pipeline (campaigns grouped by their mapped
    // pipeline); unmapped campaigns fall back to a union table. Single-pipeline: one.
    const campTables = (() => {
      if (!multiPipe) { const t = renderCampTable(campSrc, o360cols, null); return t ? [t] : [] }
      const byPipe = new Map()
      for (const c of campSrc) { const pid = pipeOfCampaign(c.name) || '__all__'; if (!byPipe.has(pid)) byPipe.set(pid, []); byPipe.get(pid).push(c) }
      const pipeName = (pid) => ((pipelines.find((p) => p.id === pid) || {}).name || 'Pipeline')
      const entries = [...byPipe.entries()].sort((a, b2) => (a[0] === '__all__' ? 1 : 0) - (b2[0] === '__all__' ? 1 : 0))
      const out = []
      for (const [pid, rows] of entries) {
        const cols = pid === '__all__' ? o360cols : o360colsFor(rows[0].name)
        const label = pid === '__all__' ? 'Unmapped campaigns · all key events' : `Pipeline · ${pipeName(pid)}`
        const t = renderCampTable(rows, cols, label)
        if (t) out.push(t)
      }
      return out
    })()
    if ((rep.campOutcomes || []).length && campTables.length) {
      push(
        <MRSlide key="c360-camp" kicker="Caalano360" title="Key events by campaign" sub="Which campaigns are driving the key events — with the cost of each. CRM outcomes (utm_campaign) matched to paid spend.">
          {barData.length ? (
            <div className="mr-two mr-two-viz">
              <div>
                <div className="mr-viz-lab">Leads vs {headLabel} — top campaigns</div>
                <ResponsiveContainer width="100%" height={Math.max(180, barData.length * 40)}>
                  <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 9.5, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, n) => [fmtNumber(v), n]} labelFormatter={(l, p) => (p && p[0] && p[0].payload ? p[0].payload.full : l)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="leads" name="Leads" fill="#6d5efc" radius={[0, 3, 3, 0]} maxBarSize={13} />
                    <Bar dataKey="event" name={headLabel} fill="#12b886" radius={[0, 3, 3, 0]} maxBarSize={13}><LabelList dataKey="event" position="right" style={{ fontSize: 9, fill: 'var(--muted)' }} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="mr-viz-lab">{headLabel} — share by campaign</div>
                {donutData.length ? <MRDonut data={donutData} money={money} /> : <div className="mr-empty">No {headLabel.toLowerCase()} attributed to a campaign yet.</div>}
              </div>
            </div>
          ) : null}
          {campTables}
          <p className="mr-foot-note">Green columns are the client's configured <b>key events</b> — the count reached and the cost per each — plus the Won revenue block and ROAS. Scroll right to see every event. Matched by <b>utm_campaign</b>; “-” means no CRM leads carried that campaign's UTM.{multiPipe ? ' Each pipeline shows only its own key events (from the campaign→pipeline links in Settings); unmapped campaigns show all events.' : ''}</p>
        </MRSlide>
      )
    }
  }

  // ---- Google slides ----
  if (rep.hasGoogle && google) {
    const gt = google.totals || {}
    const gctr = (r) => (r.impressions ? (r.clicks / r.impressions) * 100 : null)
    const gcpc = (r) => (r.clicks ? r.cost / r.clicks : null)
    const gcpa = (r) => (r.conversions ? r.cost / r.conversions : null)
    const gCampCols = (nameLabel) => [
      { k: 'name', label: nameLabel, render: (r) => <span className="mr-name">{r.name}{r.campaign ? <small>{r.campaign}</small> : null}</span> },
      { k: 'cost', label: 'Cost', align: 'r', render: (r) => money(r.cost) },
      { k: 'impressions', label: 'Impr.', align: 'r', render: (r) => n0(r.impressions) },
      { k: 'clicks', label: 'Clicks', align: 'r', render: (r) => n0(r.clicks) },
      { k: 'ctr', label: 'CTR', align: 'r', render: (r) => { const v = gctr(r); return v == null ? '—' : fmtPct(v, 2) } },
      { k: 'cpc', label: 'CPC', align: 'r', render: (r) => { const v = gcpc(r); return v == null ? '—' : money(v) } },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n0(r.conversions) },
      { k: 'cpa', label: 'Cost / conv.', align: 'r', render: (r) => { const v = gcpa(r); return v == null ? '—' : money(v) } },
    ]
    // Conversion actions grouped by the campaign they were attributed to.
    const caByCamp = {}
    for (const r of (google.conversionActions || [])) { const cn = r.campaign || '—'; (caByCamp[cn] = caByCamp[cn] || []).push(r) }
    const aggCa = (rows) => { const m = new Map(); for (const r of rows) { const e = m.get(r.name) || { name: r.name, category: r.category, conversions: 0, allConversions: 0, value: 0 }; e.conversions += r.conversions || 0; e.allConversions += r.allConversions || 0; e.value += r.value || 0; m.set(r.name, e) } return [...m.values()].sort((a, b) => b.allConversions - a.allConversions) }
    const gDrillCols = [
      { k: 'name', label: 'Campaign', render: (r) => <span className="mr-name">{r.name}</span> },
      { k: 'cost', label: 'Cost', align: 'r', render: (r) => money(r.cost) },
      { k: 'impressions', label: 'Impr.', align: 'r', render: (r) => n0(r.impressions) },
      { k: 'clicks', label: 'Clicks', align: 'r', render: (r) => n0(r.clicks) },
      { k: 'ctr', label: 'CTR', align: 'r', render: (r) => { const v = gctr(r); return v == null ? '—' : fmtPct(v, 2) } },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n0(r.conversions) },
      { k: 'cpa', label: 'Cost/conv.', align: 'r', render: (r) => { const v = gcpa(r); return v == null ? '—' : money(v) } },
    ]
    // Primary conversion actions are the ones counted in Google's "Conversions"
    // column (conversions > 0); secondary actions only report All-conversions.
    const caCols = [
      { k: 'name', label: 'Conversion action', render: (r) => <span className="mr-name">{r.name}</span> },
      { k: 'primary', label: 'Type', render: (r) => (r.conversions > 0 ? <span className="mr-pill-pri">Primary</span> : <span className="mr-pill-sec">Secondary</span>) },
      { k: 'category', label: 'Category', render: (r) => <span className="mr-ca-cat">{r.category || '—'}</span> },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n0(r.conversions) },
      { k: 'allConversions', label: 'All conv.', align: 'r', render: (r) => n0(r.allConversions) },
      { k: 'value', label: 'Value', align: 'r', render: (r) => money(r.value) },
    ]
    const allCa = aggConvActions(google.conversionActions || [])
    const gDaily = (google.daily || [])
    push(
      <MRSlide key="g-camp" kicker="Google Ads · Platform" title="Campaign performance & conversions" sub={`${(google.campaigns || []).length} campaign(s) · ${b.label} · click a campaign to see the conversion actions it drove`}>
        <div className="mr-kpirow">
          <MRKpi label="Cost" value={money(gt.cost)} />
          <MRKpi label="Impressions" value={n0(gt.impressions)} />
          <MRKpi label="Clicks" value={n0(gt.clicks)} />
          <MRKpi label="CTR" value={gt.impressions ? fmtPct((gt.clicks / gt.impressions) * 100, 2) : '—'} />
          <MRKpi label="Conversions" value={n0(gt.conversions)} />
          <MRKpi label="Cost / conv." value={gt.conversions ? money(gt.cost / gt.conversions) : '—'} strong />
        </div>
        {gDaily.length > 1 && (
          <div className="soc-chart">
            <div className="mr-trend-lab">Daily — cost (bars) vs conversions (line)</div>
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={gDaily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="c" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis yAxisId="v" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} formatter={(v, n) => (n === 'Cost' ? fmtCurrency(v, currency) : fmtNumber(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="c" dataKey="cost" name="Cost" fill="#4285f4" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="v" type="monotone" dataKey="conversions" name="Conversions" stroke="#22b07d" strokeWidth={2.4} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mr-section-lab">Campaigns · click a row to drill into its conversion actions</div>
        <MRDrillTable
          cols={gDrillCols} rows={google.campaigns || []} max={16}
          rowKey={(r) => r.name}
          childrenOf={(r) => aggCa(caByCamp[r.name] || [])}
          renderChildren={(kids) => <div className="mr-kids-inner"><div className="mr-kids-lab">Conversion actions attributed to this campaign</div><MRTable cols={caCols} rows={kids} empty="No conversion actions recorded for this campaign." /></div>}
        />
        <div className="mr-section-lab">Conversion actions <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· green “Primary” = counted in the Conversions column above</span></div>
        <MRTable cols={caCols} rows={allCa} max={16} empty="No conversion actions recorded for this period." />
      </MRSlide>
    )
    const kwCols = (first) => [
      { k: 'text', label: first, render: (r) => <span className="mr-name">{r.text || r.term}<small>{[r.campaign, r.adGroup].filter(Boolean).join(' · ') || (r.match || '')}</small></span> },
      { k: 'cost', label: 'Cost', align: 'r', render: (r) => money(r.cost) },
      { k: 'clicks', label: 'Clicks', align: 'r', render: (r) => n0(r.clicks) },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n0(r.conversions) },
    ]
    push(
      <MRSlide key="g-ag" kicker="Google Ads · Platform" title="Ad groups, keywords & search terms" sub="Ad-group performance, plus the top keywords and search terms with the campaign / ad group they came from">
        <div className="mr-section-lab">Ad groups</div>
        <MRTable cols={gCampCols('Ad group')} rows={google.adGroups || []} max={10} />
        <div className="mr-two">
          <div>
            <div className="mr-section-lab">Keywords</div>
            <MRTable cols={kwCols('Keyword')} rows={google.keywords || []} max={12} />
          </div>
          <div>
            <div className="mr-section-lab">Search terms</div>
            <MRTable cols={kwCols('Search term')} rows={google.searchTerms || []} max={12} />
          </div>
        </div>
      </MRSlide>
    )
  }

  // ---- Caalano360 (order: User performance + Lost reasons combined → Account summary & ROI) ----
  if (rep.hasCrm && blend) {
    const rmap = reachedByStage(pipelines)
    const calMap = attribution ? calCountMap(attribution, 'all') : new Map()
    const keyEventsRaw = resolveKeyEvents(loadKeyEvents(rep.client.id), stagePos)
    // Pass the RAW key events to keyEventRows — it resolves internally, and
    // double-resolving drops bare stage events (Won, Shown, …), which is why the
    // funnel previously showed only Leads + the calendar-linked stage.
    // Use the deal-level created-on won count (coWon) — NOT the blend aggregate
    // crm.won — so the funnel's "Client Won" matches the "Deals won · created" KPI
    // and the status donut above (they can differ by a deal at the month boundary).
    const funnelRows = keyEventRows(loadKeyEvents(rep.client.id), rmap, calMap, stagePos, coWon.count || 0)
    // Paid vs all-sources per key event. "All" = the total funnel above (every lead
    // source in Caalano Systems). "Paid" = CRM outcomes attributed (via utm_campaign)
    // to a real Meta/Google campaign — aggregated across every paid campaign, then
    // read through the same green-column engine so paid ⊆ total at each step.
    const aggOutcome = (arr) => {
      const o = { booked: 0, cancelled: 0, shown: 0, shownStage: 0, won: 0, revenue: 0, wonNoVal: 0, leads: 0, stages: {}, cals: {}, calsShown: {}, calsOccurred: {} }
      for (const e of arr || []) {
        o.booked += e.booked || 0; o.cancelled += e.cancelled || 0; o.shown += e.shown || 0; o.shownStage += e.shownStage || 0
        o.won += e.won || 0; o.revenue += e.revenue || 0; o.wonNoVal += e.wonNoVal || 0; o.leads += e.leads || 0
        for (const k in (e.stages || {})) o.stages[k] = (o.stages[k] || 0) + e.stages[k]
        for (const k in (e.cals || {})) o.cals[k] = (o.cals[k] || 0) + e.cals[k]
        for (const k in (e.calsShown || {})) o.calsShown[k] = (o.calsShown[k] || 0) + e.calsShown[k]
        for (const k in (e.calsOccurred || {})) o.calsOccurred[k] = (o.calsOccurred[k] || 0) + e.calsOccurred[k]
      }
      return o
    }
    let paidCmp = null
    if (o360cols && (rep.campOutcomes || []).length) {
      const paidNames = new Set()
      for (const c of (meta && meta.campaigns) || []) paidNames.add(unorm(c.name))
      for (const c of (google && google.campaigns) || []) paidNames.add(unorm(c.name))
      const paidOutcomes = (rep.campOutcomes || []).filter((e) => paidNames.has(unorm(e.name)))
      if (paidOutcomes.length) {
        const paidO = aggOutcome(paidOutcomes)
        const pf = o360Fields(paidO, totalSpend, paidO.leads || 0, o360cols)
        const stripLab = (s) => String(s || '').replace(/^📅\s*/, '').trim().toLowerCase()
        const paidByLabel = new Map()
        let ci2 = 0
        for (const g of o360cols.groups) {
          const seg = o360cols.cols.slice(ci2, ci2 + g.span); ci2 += g.span
          const first = seg.find((c) => c.gfirst) || seg[0]
          paidByLabel.set(stripLab(g.label), pf[first.key] || 0)
        }
        const rows = [{ label: 'Leads', total: crm.leads || 0, paid: paidO.leads || 0 }]
        for (const r of funnelRows) rows.push({ label: r.label, total: r.count || 0, paid: paidByLabel.get(stripLab(r.label)) || 0, kind: r.kind })
        // Clamp paid to total so the stacked bar reads cleanly (different data feeds
        // can occasionally push paid a hair over total).
        for (const r of rows) r.paid = Math.min(r.paid, r.total)
        paidCmp = { rows, paidLeads: paidO.leads || 0, paidWon: paidO.won || 0 }
      }
    }
    const otherRev = Math.max(0, realisedRev - paidRev)
    const PIE = ['#6d5efc', '#e0803a', '#e1306c', '#4285f4', '#f59e0b', '#12b886', '#9b8cff', '#ef4444']
    const lostPie = (lost.byReason || []).slice(0, 8).map((r, i) => ({ name: r.name, value: r.count, color: PIE[i % PIE.length] }))
    const statusDonut = [
      { name: 'Open', value: crm.open || 0, color: '#6d5efc' },
      { name: 'Won', value: coWon.count || 0, color: '#22b07d' },
      { name: 'Lost', value: lost.total.count || 0, color: '#ef4444' },
    ].filter((d) => d.value)

    // ---- User performance + Lost reasons (combined) ----
    const ke = keyEventsRaw.filter((k) => k.kind === 'stage' || (k.kind === 'calendar' && k.stage)).slice(0, 5)
    const keRef = (k) => (k.kind === 'calendar' ? k.stage : k.ref)
    const urows = users.map((u) => {
      const sc = (scWon.byUser && scWon.byUser[u.id]) || { count: 0, revenue: 0 }
      const uc = u.crm || {}
      const urmap = reachedByStage(u.pipelines || [])
      const evReach = {}; for (const k of ke) evReach[k.ref] = stageReachOf(urmap, k.pipeline, keRef(k))
      return { id: u.id, name: u.name, leads: u.leads || uc.leads || 0, cohortWon: uc.won || 0, evReach, closed: (sc.count != null ? sc.count : (sc.won || 0)), revenue: sc.revenue || 0 }
    }).sort((a, b2) => (b2.revenue - a.revenue) || (b2.closed - a.closed) || (b2.leads - a.leads))
    const topU = urows.find((u) => u.closed > 0) || urows[0]
    const userDeals = (uid) => (scWon.deals || []).filter((d) => d.userId === uid)
    push(
      <MRSlide key="users" kicker="Caalano360 · Team" title="User performance & lost reasons" sub="Team performance this month, and why this month's closed-lost deals were lost — shown as two separate panels.">
        <section className="mr-bubble">
          <div className="mr-bubble-lab">👥 User performance</div>
          <p className="mr-bubble-sub">Ranked by revenue closed this month. Leads and key-event columns are each user's created-on cohort; “Closed this mo” is deals they marked won this month.</p>
          {topU && topU.closed > 0 && <div className="mr-top">
            <span className="mr-top-badge">★ Top performer</span>
            <b>{topU.name}</b>
            <span className="mr-top-stats">{money(topU.revenue)} closed · {n0(topU.closed)} deal(s) this month · {n0(topU.leads)} new leads</span>
          </div>}
          <MRTable
            cols={[
              { k: 'name', label: 'User', render: (r) => <span className="mr-name">{r.name}</span> },
              { k: 'leads', label: 'Leads', align: 'r', render: (r) => n0(r.leads) },
              ...ke.map((k) => ({ k: 'ev_' + k.ref, label: k.label, align: 'r', render: (r) => n0(r.evReach[k.ref] || 0) })),
              { k: 'cohortWon', label: 'Won (cohort)', align: 'r', render: (r) => n0(r.cohortWon) },
              { k: 'winrate', label: 'Cohort win %', align: 'r', render: (r) => pc(r.cohortWon, r.leads) },
              { k: 'closed', label: 'Closed this mo', align: 'r', render: (r) => (r.closed ? <button className="mr-cellbtn" onClick={() => openDrill({ title: `${r.name} — closed this month`, deals: userDeals(r.id) })}>{n0(r.closed)}</button> : '—') },
              { k: 'revenue', label: 'Revenue (closed)', align: 'r', render: (r) => money(r.revenue) },
            ]}
            rows={urows} max={16}
            empty="No assigned-user data for this period."
          />
          <p className="mr-foot-note">“Won (cohort)” counts this month's leads that are already won; “Closed this mo” counts deals won this month regardless of when the lead came in — click a number to see the deals.</p>
        </section>

        <section className="mr-bubble">
          <div className="mr-bubble-lab">📉 Lost reasons &amp; pipeline status</div>
          <p className="mr-bubble-sub">Why this month's closed-lost deals were lost, and where this month's leads currently stand.</p>
          <div className="mr-kpirow">
            <MRKpi label="Deals lost" value={n0(lost.total.count)} sub="closed-lost this month" />
            <MRKpi label="Value lost" value={money(lost.total.value)} />
            <MRKpi label="Win rate" value={pc(dealsWon, dealsWon + lost.total.count)} sub="won ÷ closed this month" />
            <MRKpi label="Still open" value={n0(crm.open)} sub={`${money(crm.openValue)} in pipeline`} />
          </div>
          <div className="mr-two mr-two-viz">
            <div>
              <div className="mr-viz-lab">Why deals were lost</div>
              {lostPie.length ? <MRDonut data={lostPie} money={money} /> : null}
              {lost.byReason && lost.byReason.length ? (
                <MRTable
                  cols={[
                    { k: 'name', label: 'Reason', render: (r) => (openDrill ? <button className="mr-cellbtn mr-cellbtn-l" onClick={() => openDrill({ title: `Lost — ${r.name}`, kind: 'lost', deals: (lost.deals || []).filter((d) => (d.reason || 'Not set') === r.name) })}>{r.name}</button> : <span className="mr-name">{r.name}</span>) },
                    { k: 'count', label: 'Deals', align: 'r', render: (r) => n0(r.count) },
                    { k: 'value', label: 'Value', align: 'r', render: (r) => money(r.value) },
                    { k: 'share', label: '%', align: 'r', render: (r) => pc(r.count, lost.total.count) },
                  ]}
                  rows={lost.byReason} max={8}
                />
              ) : <div className="mr-empty">No deals were marked lost this month{md ? '' : ' (regenerate the snapshot to pull lost-deal detail)'}.</div>}
            </div>
            <div>
              <div className="mr-viz-lab">This month's leads by status</div>
              {statusDonut.length ? <MRDonut data={statusDonut} money={money} /> : <div className="mr-empty">No leads this month.</div>}
              <p className="mr-foot-note" style={{ marginTop: 6 }}>Of {n0(crm.leads)} leads created this month: {n0(coWon.count)} won, {n0(lost.total.count)} lost, {n0(crm.open)} still open.</p>
            </div>
          </div>
        </section>
      </MRSlide>
    )

    // ---- Account summary & ROI ----
    const roiRows = ['meta', 'google'].map((cKey) => ({
      label: cKey === 'meta' ? 'Meta' : 'Google',
      spend: (cKey === 'meta' ? paid.metaSpend : paid.googleSpend) || 0,
      rev: (scWon.byChannel && scWon.byChannel[cKey] && scWon.byChannel[cKey].revenue) || 0,
      won: (scWon.byChannel && scWon.byChannel[cKey] && scWon.byChannel[cKey].count) || 0,
    })).filter((r) => r.spend || r.rev)
    push(
      <MRSlide key="c360" kicker="Caalano360" title="Account summary & ROI" sub="Ad platform + CRM. Spend & leads are this month's; ROAS is measured only on revenue from deals attributed to a paid channel (Meta/Google) via UTM — never total business.">
        <div className="mr-kpirow mr-kpirow-wide">
          <MRKpi label="Total ad spend" value={money(totalSpend)} />
          <MRKpi label="Paid leads" value={n0(paidLeads)} sub="ad results" />
          <MRKpi label="Blended CPL" value={paidLeads ? money(totalSpend / paidLeads) : '—'} />
          <MRKpi label="Deals won · created" value={n0(coWon.count)} sub="this month's leads" />
          <MRKpi label="Deals won · closed" value={n0(dealsWon)} sub="closed this month" />
          <MRKpi label="Paid revenue" value={money(paidRev)} strong sub="closed this month" />
          <MRKpi label="ROAS (paid)" value={roas != null ? roas.toFixed(1) + 'x' : '—'} sub="cash / status change" />
          <MRKpi label="Cost / won (paid)" value={paidWon ? money(totalSpend / paidWon) : '—'} />
          <MRKpi label="Avg time to close" value={scWon.avgCloseDays != null ? `${scWon.avgCloseDays} days` : '—'} sub="lead → won" />
          <MRKpi label="Open pipeline" value={money(crm.openValue)} sub={`${n0(crm.open)} open`} />
        </div>
        <div className="mr-two mr-two-viz">
          <div>
            <div className="mr-section-lab">Revenue — status change vs created on</div>
            <div className="mr-revmatrix-wrap"><MRRevMatrix sc={scWon} co={coWon} spend={totalSpend} money={money} n0={n0} onDrill={openDrill} /></div>
            {roiRows.length > 0 && (
              <>
                <div className="mr-section-lab">ROI by channel (closed this month)</div>
                <MRTable
                  cols={[
                    { k: 'label', label: 'Channel', render: (r) => <span className="mr-name">{r.label}</span> },
                    { k: 'spend', label: 'Spend', align: 'r', render: (r) => money(r.spend) },
                    { k: 'won', label: 'Won', align: 'r', render: (r) => n0(r.won) },
                    { k: 'rev', label: 'Revenue', align: 'r', render: (r) => money(r.rev) },
                    { k: 'roas', label: 'ROAS', align: 'r', render: (r) => (r.spend ? (r.rev / r.spend).toFixed(1) + 'x' : '—') },
                  ]}
                  rows={roiRows}
                />
              </>
            )}
          </div>
          <div>
            <div className="mr-viz-lab">Leads by status (this month)</div>
            {statusDonut.length ? <MRDonut data={statusDonut} money={money} /> : <div className="mr-empty">No leads this month.</div>}
            <p className="mr-foot-note" style={{ marginTop: 6 }}>Of {n0(crm.leads)} leads created this month: {n0(coWon.count)} won, {n0(lost.total.count)} lost, {n0(crm.open)} still open.</p>
          </div>
        </div>
        <p className="mr-foot-note">Status change = deals marked won this month (cash banked, any lead date). Created on = deals whose lead came in this month and are won. Total business closed this month was {money(realisedRev)} across {n0(dealsWon)} deal(s){otherRev > 0 ? `, of which ${money(otherRev)} came from organic / referral / untracked sources (excluded from paid ROAS)` : ''}.</p>
        <div className="mr-section-lab">This month's leads → key events (created-on cohort)</div>
        {funnelRows.length
          ? <div className="mr-funnel-big"><KeyEventsFunnel rows={funnelRows} total={crm.leads || 0} spend={totalSpend} currency={currency} caveat="One cohort: leads created this month and how far they've progressed. “Cost / event” spreads total ad spend across every event, so it's a blended guide, not paid-only CAC." /></div>
          : <div className="mr-empty">No key events configured — set them in Settings → Key events.</div>}
        {paidCmp && paidCmp.rows.length ? (
          <>
            <div className="mr-section-lab">Paid vs all lead sources — key events</div>
            <div className="mr-two mr-two-viz">
              <div>
                <div className="mr-viz-lab">Every step: paid (green) within all Caalano Systems (grey)</div>
                <ResponsiveContainer width="100%" height={Math.max(190, paidCmp.rows.length * 46)}>
                  <BarChart data={paidCmp.rows.map((r) => ({ name: r.label, Paid: r.paid, 'Other sources': Math.max(0, r.total - r.paid), total: r.total }))} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 9.5, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, n) => [fmtNumber(v), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Paid" stackId="a" fill="#12b886" radius={[0, 0, 0, 0]} maxBarSize={16} />
                    <Bar dataKey="Other sources" stackId="a" fill="#c7cdda" radius={[0, 3, 3, 0]} maxBarSize={16}>
                      <LabelList dataKey="total" position="right" style={{ fontSize: 9, fill: 'var(--muted)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="mr-viz-lab">All Caalano Systems vs paid results</div>
                <MRTable
                  cols={[
                    { k: 'label', label: 'Key event', render: (r) => <span className="mr-name">{r.label}</span> },
                    { k: 'total', label: 'All sources', align: 'r', render: (r) => n0(r.total) },
                    { k: 'paid', label: 'Paid', align: 'r', render: (r) => <span style={{ color: '#12b886', fontWeight: 700 }}>{n0(r.paid)}</span> },
                    { k: 'share', label: 'Paid %', align: 'r', render: (r) => pc(r.paid, r.total) },
                  ]}
                  rows={paidCmp.rows}
                />
                <p className="mr-foot-note" style={{ marginTop: 6 }}>“Paid” = leads whose CRM record carries a Meta/Google campaign UTM; “All sources” includes organic, referral, direct and untracked. The gap is business you're winning beyond ad spend.</p>
              </div>
            </div>
          </>
        ) : null}
      </MRSlide>
    )
  }

  // Number the slides (cover excluded from the count shown).
  return slides
}

// Aggregate conversion-action rows (which come per campaign/ad-group) up to the
// account level by action name.
function aggConvActions(rows) {
  const m = new Map()
  for (const r of rows) { const e = m.get(r.name) || { name: r.name, category: r.category, conversions: 0, allConversions: 0, value: 0 }; e.conversions += r.conversions || 0; e.allConversions += r.allConversions || 0; e.value += r.value || 0; m.set(r.name, e) }
  return [...m.values()].sort((a, b) => b.allConversions - a.allConversions)
}

// ---------------------------------------------------------------------------
// Organic Social Media dashboard — Instagram + Facebook Page organic, per client.
// ---------------------------------------------------------------------------
function SocPost({ p, platform }) {
  const [playing, setPlaying] = useState(false)
  const n = (v) => (v == null ? '—' : fmtNumber(v))
  const img = platform === 'ig' ? p.thumb : p.picture
  const text = platform === 'ig' ? p.caption : p.message
  const canPlay = platform === 'ig' && !!p.video
  return (
    <div className="soc-post" title={text || ''}>
      <div className="soc-post-thumb">
        {playing && canPlay
          ? <video className="soc-video" src={p.video} poster={img || undefined} controls autoPlay playsInline onError={() => setPlaying(false)} />
          : <>
              {img ? <img src={img} alt="" loading="lazy" /> : <span className="soc-noimg">{platform === 'ig' ? (p.type === 'VIDEO' || p.type === 'REEL' ? '▶' : '🖼') : '📄'}</span>}
              {canPlay && <button className="soc-play no-print" onClick={() => setPlaying(true)} aria-label="Play reel">▶</button>}
            </>}
      </div>
      <div className="soc-post-body">
        <div className="soc-post-top"><span className="soc-post-type">{platform === 'ig' ? (p.type || 'POST') : 'POST'}</span><span className="soc-post-date">{fmtDate(p.date)}</span></div>
        <div className="soc-post-cap">{text || <span className="soc-faint">No caption</span>}</div>
        <div className="soc-post-stats">
          {platform === 'ig' ? <>
            {p.reach != null && <span title="Reach">👁 {n(p.reach)}</span>}<span title="Likes">❤ {n(p.likes)}</span><span title="Comments">💬 {n(p.comments)}</span>{p.saves != null && <span title="Saves">🔖 {n(p.saves)}</span>}{p.shares != null && <span title="Shares">↗ {n(p.shares)}</span>}
          </> : <>
            <span title="Impressions">👁 {n(p.impressions)}</span><span title="Reactions">❤ {n(p.reactions)}</span><span title="Comments">💬 {n(p.comments)}</span><span title="Shares">↗ {n(p.shares)}</span><span title="Link clicks">🔗 {n(p.clicks)}</span>
          </>}
          <span className="soc-post-er" title="Engagement rate">{p.er != null ? `${p.er}% ER` : '—'}</span>
        </div>
        {p.permalink && <a className="soc-post-open no-print" href={p.permalink} target="_blank" rel="noreferrer">Open on {platform === 'ig' ? 'Instagram' : 'Facebook'} ↗</a>}
      </div>
    </div>
  )
}
function SocBars({ data, labelKey, valueKey, color, fmt }) {
  if (!data || !data.length) return <div className="soc-empty">No data.</div>
  const max = Math.max(1, ...data.map((d) => d[valueKey] || 0))
  return (
    <div className="soc-bars">{data.map((d, i) => (
      <div className="soc-bar-row" key={i}>
        <span className="soc-bar-lab" title={d[labelKey]}>{d[labelKey]}</span>
        <span className="soc-bar-track"><span className="soc-bar-fill" style={{ width: `${((d[valueKey] || 0) / max) * 100}%`, background: color }} /></span>
        <span className="soc-bar-val">{fmt ? fmt(d[valueKey]) : fmtNumber(d[valueKey])}</span>
      </div>
    ))}</div>
  )
}
// One competitor's card: mapping dropdown + (once mapped) a public Instagram
// summary pulled from Windsor's public connector.
function CompetitorCard({ comp, range, igList, igConnector, onMap, onRemove, onData }) {
  const [m, setM] = useState(null)
  const [postSort, setPostSort] = useState('engagement')
  const n0 = (v) => (v == null || isNaN(v) ? '—' : fmtNumber(Math.round(v)))
  useEffect(() => {
    if (!comp.igAcct) { setM(null); return }
    let alive = true; setM('loading')
    mrFetch(`scope=competitor&connector=${encodeURIComponent(comp.igConn || igConnector || 'instagram_public')}&account=${encodeURIComponent(comp.igAcct)}&${rangeQuery(range)}`)
      .then((r) => { if (alive) setM(r) }).catch((e) => { if (alive) setM({ error: String(e.message || e) }) })
    return () => { alive = false }
  }, [comp.igAcct, comp.igConn, range.from, range.to])
  const ig = m && m.ig
  useEffect(() => { if (onData) onData(comp.id, ig || null) }, [m])
  const fmt = ig && ig.formats ? Object.entries(ig.formats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase().replace('carousel_album', 'carousel')}`).join(' · ') : ''
  const bestDay = ig && ig.weekday ? ig.weekday.slice().sort((a, b) => b.avgEng - a.avgEng).filter((d) => d.posts)[0] : null
  const posts = ig ? [...ig.posts].sort((a, b) => (b[postSort] || 0) - (a[postSort] || 0)) : []
  return (
    <div className="soc-comp-card">
      <div className="soc-comp-head">
        <div><b>{comp.name}</b>{ig && ig.username ? <a className="soc-handle" href={`https://instagram.com/${ig.username}`} target="_blank" rel="noreferrer">@{ig.username}</a> : (comp.ig ? <a className="soc-handle" href={`https://instagram.com/${comp.ig}`} target="_blank" rel="noreferrer">@{comp.ig}</a> : null)}</div>
        <button className="soc-comp-x" onClick={onRemove} aria-label="Remove">✕</button>
      </div>
      <div className="soc-comp-map no-print">
        <label>Windsor IG account
          <select value={comp.igAcct || ''} onChange={(e) => onMap({ igAcct: e.target.value || null, igConn: e.target.value ? igConnector : null })}>
            <option value="">{igList.length ? '— not mapped —' : 'none available'}</option>
            {igList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      {comp.igAcct && (
        m === 'loading' ? <div className="soc-comp-pending"><Spinner label="Loading public data…" /></div>
          : ig ? (
            <div className="soc-comp-metrics">
              <div className="mr-kpirow">
                <MRKpi label="Followers" value={n0(ig.followers)} sub="current" strong />
                <MRKpi label="Posts" value={n0(ig.postCount)} sub="this period" />
                <MRKpi label="Engagement" value={n0(ig.engagement)} sub="likes + comments" />
                <MRKpi label="Est. eng. rate" value={ig.er != null ? `${ig.er}%` : '—'} sub="per post ÷ followers" />
                <MRKpi label="Avg / post" value={`${n0(ig.avgLikes)}❤ ${n0(ig.avgComments)}💬`} sub={`${n0(ig.avgEng)} eng/post`} />
                <MRKpi label="Total" value={`${n0(ig.likes)}❤`} sub={`${n0(ig.comments)} comments`} />
              </div>
              {fmt && <div className="soc-comp-sub">Format mix: {fmt}{bestDay ? ` · Best day: ${bestDay.name} (${n0(bestDay.avgEng)} avg eng)` : ''}</div>}
              {ig.daily && ig.daily.length > 1 && (
                <div className="soc-chart">
                  <div className="mr-trend-lab">Posting cadence &amp; engagement — posts per day (bars) vs engagement per day (line)</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={ig.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis yAxisId="posts" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                      <YAxis yAxisId="eng" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                      <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="posts" dataKey="posts" name="Posts" fill="#e1306c" radius={[3, 3, 0, 0]} maxBarSize={18} />
                      <Line yAxisId="eng" type="monotone" dataKey="engagement" name="Engagement" stroke="#6d5efc" strokeWidth={2.2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              {ig.weekday && ig.weekday.some((d) => d.posts) && (
                <div className="soc-chart">
                  <div className="mr-trend-lab">Posting cadence by weekday — posts (bars) vs avg engagement (line)</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <ComposedChart data={ig.weekday} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="p" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                      <YAxis yAxisId="e" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="p" dataKey="posts" name="Posts" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={26} />
                      <Line yAxisId="e" type="monotone" dataKey="avgEng" name="Avg engagement" stroke="#22b07d" strokeWidth={2.2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              {posts.length ? (
                <div className="soc-comp-block">
                  <div className="soc-subhead"><h4>Posts ({posts.length})</h4><div className="soc-sort no-print">{[['engagement', 'Engagement'], ['likes', 'Likes'], ['comments', 'Comments'], ['date', 'Newest']].map(([k, l]) => <button key={k} className={postSort === k ? 'on' : ''} onClick={() => setPostSort(k)}>{l}</button>)}</div></div>
                  <div className="soc-posts">{posts.map((p) => <SocPost key={p.id} p={p} platform="ig" />)}</div>
                </div>
              ) : <div className="soc-comp-pending">No public posts in this period.</div>}
            </div>
          ) : <div className="soc-comp-pending">{m && m.error ? `Couldn’t load: ${m.error}` : 'No public data returned for this account / period.'}</div>
      )}
    </div>
  )
}
// Competitors assigned to a client, for organic benchmarking / inspiration. The
// assignment (name + IG handle) is stored per client; public metrics come from the
// Windsor public connector once a competitor is mapped to an account.
function CompetitorsView({ client, range }) {
  useSettingsSync()
  const [pick, setPick] = useState('')
  const [accts, setAccts] = useState(null)
  const [self, setSelf] = useState(null)
  const [compData, setCompData] = useState({})
  useEffect(() => { mrFetch('scope=socialaccounts').then((r) => setAccts(r)).catch(() => setAccts({ ig: { accounts: [] }, fb: { accounts: [] } })) }, [])
  useEffect(() => {
    setCompData({})
    if (!client) { setSelf(null); return }
    let alive = true
    mrFetch(`scope=social&client=${encodeURIComponent(client.id)}&${rangeQuery(range)}`)
      .then((r) => { if (alive) setSelf(r && r.ig ? r.ig : null) }).catch(() => { if (alive) setSelf(null) })
    return () => { alive = false }
  }, [client && client.id, range.from, range.to])
  const onData = React.useCallback((id, cig) => setCompData((d) => (d[id] === cig ? d : { ...d, [id]: cig })), [])
  if (!client) return <div className="mr-note">Pick a client to assign competitors.</div>
  const igList = (accts && accts.ig && accts.ig.accounts) || []
  const fbList = (accts && accts.fb && accts.fb.accounts) || []
  const comps = loadCompetitors(client.id)
  const igConnector = accts && accts.ig ? accts.ig.connector : null
  const setMap = (id, patch) => saveCompetitors(client.id, comps.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const taken = new Set(comps.map((c) => c.igAcct).filter(Boolean))
  const options = igList.filter((a) => !taken.has(a.id))
  const addPick = () => {
    const a = igList.find((x) => x.id === pick); if (!a) return
    const handle = cleanHandle(a.handle || a.name) || a.id
    saveCompetitors(client.id, [...comps, { id: 'c' + Date.now().toString(36), name: a.name || handle, ig: handle, igAcct: a.id, igConn: igConnector }])
    setPick('')
  }
  const remove = (id) => saveCompetitors(client.id, comps.filter((c) => c.id !== id))
  // "You vs competitors" — compare on public-comparable metrics only (likes +
  // comments), so the client's private saves/shares don't unfairly inflate it.
  const rowFor = (nm, cig, isSelf) => {
    if (!cig) return null
    const followers = isSelf ? (cig.profile && cig.profile.followers) : cig.followers
    const posts = isSelf ? (cig.posts ? cig.posts.length : 0) : cig.postCount
    const likes = isSelf ? (cig.totals && cig.totals.likes) : cig.likes
    const comments = isSelf ? (cig.totals && cig.totals.comments) : cig.comments
    const eng = (likes || 0) + (comments || 0)
    const er = (followers && posts) ? Math.round((eng / posts / followers) * 1000) / 10 : null
    return { name: nm, isSelf, followers: followers || 0, posts: posts || 0, eng, er, avgEng: posts ? Math.round(eng / posts) : 0 }
  }
  const benchRows = [rowFor(client.name + ' (you)', self, true), ...comps.map((c) => rowFor(c.name, compData[c.id], false))].filter(Boolean)
  const bench = benchRows.length >= 2 ? benchRows.slice().sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : b.followers - a.followers)) : null
  const maxOf = bench ? { followers: Math.max(...bench.map((r) => r.followers)), er: Math.max(...bench.map((r) => r.er || 0)), avgEng: Math.max(...bench.map((r) => r.avgEng)), posts: Math.max(...bench.map((r) => r.posts)) } : null
  const nB = (v) => (v == null || isNaN(v) ? '—' : fmtNumber(Math.round(v)))
  return (
    <div className="soc-comp">
      <div className="soc-comp-add">
        <select className="mr-select" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{!accts ? 'Loading public Instagram accounts…' : (igList.length ? (options.length ? 'Select a public Instagram account…' : 'All available accounts added') : 'No public Instagram accounts found')}</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name}{a.handle && a.handle !== a.name ? ` (@${a.handle})` : ''}</option>)}
        </select>
        <button className="mr-btn primary" onClick={addPick} disabled={!pick}>+ Add competitor</button>
      </div>
      {bench && (
        <div className="soc-vs">
          <div className="soc-subhead"><h4>You vs competitors</h4><span className="soc-dm-note">Instagram · likes + comments only (public-comparable) · {rangeLabel(range)}</span></div>
          <div className="soc-vs-scroll">
            <table className="mr-table soc-vs-table">
              <thead><tr><th>Account</th><th className="r">Followers</th><th className="r">Posts</th><th className="r">Engagement</th><th className="r">Avg / post</th><th className="r">Est. ER</th></tr></thead>
              <tbody>{bench.map((r, i) => (
                <tr key={i} className={r.isSelf ? 'soc-vs-you' : ''}>
                  <td>{r.name}</td>
                  <td className={'r' + (r.followers === maxOf.followers ? ' soc-vs-win' : '')}>{nB(r.followers)}</td>
                  <td className={'r' + (r.posts === maxOf.posts ? ' soc-vs-win' : '')}>{nB(r.posts)}</td>
                  <td className="r">{nB(r.eng)}</td>
                  <td className={'r' + (r.avgEng === maxOf.avgEng ? ' soc-vs-win' : '')}>{nB(r.avgEng)}</td>
                  <td className={'r' + (r.er != null && r.er === maxOf.er ? ' soc-vs-win' : '')}>{r.er != null ? `${r.er}%` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mr-foot-note">Green = leads the group on that metric. Engagement rate is estimated (likes+comments per post ÷ followers) so it's comparable across you and competitors.{self ? '' : ' Connect this client’s own Instagram to see your row.'}</div>
        </div>
      )}
      {comps.length ? (
        <div className="soc-comp-grid">
          {comps.map((c) => <CompetitorCard key={c.id} comp={c} range={range} igList={igList} igConnector={accts && accts.ig ? accts.ig.connector : null} onMap={(patch) => setMap(c.id, patch)} onRemove={() => remove(c.id)} onData={onData} />)}
        </div>
      ) : <div className="mr-empty">No competitors yet — add {client.name}’s competitors above to start benchmarking.</div>}
      {accts && !igList.length && <p className="mr-foot-note" style={{ color: 'var(--neg)' }}>No public Instagram accounts found via Windsor{accts.ig && accts.ig.connector ? '' : ' (couldn’t find the public connector slug)'} — tell me the connector name you used in Windsor and I’ll point the mapping at it.</p>}
      <p className="mr-foot-note">Map each competitor to its <b>Windsor public Instagram account</b>. Metrics are pulled from public data (followers, posts, likes, comments); engagement rate is <b>estimated</b> (avg likes+comments per post ÷ followers) since reach/impressions stay private to the account owner. Facebook can be added later.</p>
    </div>
  )
}
// Organic-social KPIs + rolling 6-month trend. Monthly targets are set per client
// (saved to Settings/server) and measured against the latest complete month; the
// month-by-month table + trend charts read a lean per-month backend rollup.
function SocTrends({ client, range, nonce }) {
  const [st, setSt] = useState({ status: 'idle' })
  const [kpi, setKpi] = useState({})
  const [months, setMonths] = useState(6)
  const [plat, setPlat] = useState('blended') // blended | ig | fb
  useEffect(() => { setKpi(loadSocialKpis(client ? client.id : '')) }, [client && client.id, SETTINGS.loaded, nonce])
  useEffect(() => {
    if (!client) { setSt({ status: 'empty' }); return }
    let alive = true; setSt({ status: 'loading' })
    mrFetch(`scope=socialtrend&client=${encodeURIComponent(client.id)}&months=${months}`)
      .then((r) => { if (alive) setSt({ status: 'ok', data: r }) })
      .catch((e) => { if (alive) setSt({ status: 'err', error: String(e.message || e) }) })
    return () => { alive = false }
  }, [client && client.id, months, nonce])
  const n0 = (v) => (v == null || isNaN(v) ? '—' : fmtNumber(Math.round(v)))
  const signed = (v) => (v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + fmtNumber(Math.round(v)))
  const data = st.status === 'ok' ? st.data : null
  const raw = (data && data.months) || []
  const hasIg = data && data.hasIg, hasFb = data && data.hasFb
  // Normalise each month to the selected platform so the cards / charts / table
  // read a single flat shape. Paid vs organic followers only exist for Facebook.
  const mapMonth = (m) => {
    if (plat === 'ig') { const g = m.ig || {}; return { month: m.month, label: m.label, followersEnd: g.followersEnd, followersStart: g.followersStart, netFollowers: g.netFollowers, reach: g.reach, views: g.views, impressions: null, engagement: g.engagement, posts: g.posts, er: g.reach ? Math.round((g.engagement / g.reach) * 1000) / 10 : null, paid: null, organic: null } }
    if (plat === 'fb') { const g = m.fb || {}, fs = g.followerSource; return { month: m.month, label: m.label, followersEnd: g.followersEnd, followersStart: g.followersStart, netFollowers: g.netFollowers, reach: g.reachUnique, views: g.videoViews, impressions: g.impressions, engagement: g.engagements, posts: g.posts, er: g.reachUnique ? Math.round((g.engagements / g.reachUnique) * 1000) / 10 : null, paid: fs ? fs.paid : null, organic: fs ? fs.organic : null } }
    const fbP = m.fb && m.fb.followerSource ? m.fb.followerSource.paid : null
    return { month: m.month, label: m.label, followersEnd: m.followersEnd, followersStart: m.followersStart, netFollowers: m.netFollowers, reach: m.reach, views: m.views, impressions: m.impressions, engagement: m.engagement, posts: m.posts, er: m.er, paid: fbP, organic: fbP != null ? Math.max(0, (m.netFollowers || 0) - fbP) : null }
  }
  const rows = raw.map(mapMonth)
  const latest = rows.length ? rows[rows.length - 1] : null
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  const platLabel = plat === 'ig' ? 'Instagram' : plat === 'fb' ? 'Facebook' : 'Blended (IG + FB)'
  const METRICS = [
    { k: 'followersEnd', label: 'Total followers', fmt: n0 },
    { k: 'netFollowers', label: 'Net new followers', fmt: signed },
    { k: 'reach', label: 'Organic reach', fmt: n0 },
    { k: 'views', label: 'Views', fmt: n0 },
    { k: 'impressions', label: 'Impressions (FB)', fmt: n0, fbOnly: true },
    { k: 'engagement', label: 'Engagement', fmt: n0 },
    { k: 'posts', label: 'Posts', fmt: n0 },
    { k: 'er', label: 'Eng. rate %', fmt: (v) => (v == null ? '—' : `${v}%`) },
  ].filter((mt) => !(mt.fbOnly && plat === 'ig'))
  const CHARTS = [
    { k: 'followersEnd', label: 'Total followers', kind: 'line', color: '#0ea5e9' },
    { k: 'netFollowers', label: 'Net new followers', kind: 'bar', color: '#22b07d' },
    { k: 'reach', label: 'Organic reach', kind: 'line', color: '#e1306c' },
    { k: 'views', label: 'Views', kind: 'line', color: '#6d5efc' },
    { k: 'engagement', label: 'Engagement', kind: 'line', color: '#f59e0b' },
    { k: 'posts', label: 'Posts published', kind: 'bar', color: '#8a63d2' },
  ]
  // Paid vs organic new followers (Facebook source; blended attributes IG follows as organic).
  const paidKnown = plat !== 'ig' && rows.some((r) => r.paid != null)
  const paidSum = paidKnown ? rows.reduce((a, r) => a + (r.paid || 0), 0) : null
  const orgSum = paidKnown ? rows.reduce((a, r) => a + (r.organic || 0), 0) : null
  const paidPct = (paidSum != null && (paidSum + orgSum) > 0) ? Math.round((paidSum / (paidSum + orgSum)) * 100) : null
  if (!client) return <div className="mr-note">Pick a client above.</div>
  return (
    <div className="soc-trends">
      <div className="soc-trend-head no-print">
        <div><h3>Monthly KPIs &amp; rolling trend <span className="soc-organic-badge">Organic only</span></h3><p className="cap">All figures are <b>organic</b> (paid-boosted reach/impressions excluded). Actuals shown for the latest month ({latest ? latest.label : '—'}); charts roll the last {rows.length || months} months. Targets are managed in <b>Settings → Organic KPIs</b> (per client) and compared on the Blended view.</p></div>
        <label className="soc-trend-months">Months
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
      </div>
      <div className="soc-plat-toggle no-print">
        <button className={plat === 'blended' ? 'on' : ''} onClick={() => setPlat('blended')}>Blended</button>
        <button className={plat === 'ig' ? 'on' : ''} onClick={() => setPlat('ig')} disabled={!hasIg}>Instagram</button>
        <button className={plat === 'fb' ? 'on' : ''} onClick={() => setPlat('fb')} disabled={!hasFb}>Facebook</button>
        <span className="soc-plat-lab">{platLabel}</span>
      </div>

      {st.status === 'loading' && <div className="mr-note"><Spinner label="Loading monthly trend…" /></div>}
      {st.status === 'err' && <div className="mr-note mr-err">Couldn’t load: {st.error}</div>}
      {data && !rows.length && <div className="mr-note mr-empty-deep"><div className="big">📈</div><b>No monthly data yet for this client.</b></div>}

      {rows.length > 0 && (<>
        {/* KPI targets (from Settings) vs latest-month actuals — attainment only on Blended */}
        <div className="soc-kpi-grid">
          {METRICS.map((mt) => {
            const actual = latest ? latest[mt.k] : null
            const pv = prev ? prev[mt.k] : null
            const target = plat === 'blended' ? kpi[mt.k] : null
            const pct = (target && actual != null && actual !== 0) ? Math.round((actual / target) * 100) : (target ? 0 : null)
            const mom = (pv != null && pv !== 0 && actual != null) ? Math.round(((actual - pv) / Math.abs(pv)) * 100) : null
            return (
              <div className="soc-kpi-card" key={mt.k}>
                <div className="soc-kpi-h">{mt.label}</div>
                <div className="soc-kpi-actual"><b>{mt.fmt(actual)}</b>{mom != null && <span className={`soc-kpi-mom ${mom >= 0 ? 'up' : 'down'}`}>{mom >= 0 ? '▲' : '▼'} {Math.abs(mom)}% MoM</span>}</div>
                {plat === 'blended' && (target != null
                  ? <><div className="soc-kpi-tgt">Target {mt.fmt(target)}</div><div className="soc-kpi-bar"><span style={{ width: Math.min(100, Math.max(0, pct)) + '%', background: pct >= 100 ? 'var(--pos)' : pct >= 70 ? '#f59e0b' : 'var(--neg)' }} /></div><div className="soc-kpi-pct">{pct}% of target</div></>
                  : <div className="soc-kpi-notgt">No target · set in Settings</div>)}
              </div>
            )
          })}
        </div>

        {/* Paid vs organic followers (Facebook / blended) */}
        {plat !== 'ig' && (
          <div className="soc-paidorg">
            <div className="soc-subhead"><h4>New followers — paid vs organic {plat === 'blended' ? '(Facebook ad-driven)' : ''}</h4>{paidPct != null && <span className="soc-dm-note">{paidPct}% of new followers came from paid over the last {rows.length} months</span>}</div>
            {paidKnown ? (
              <div className="soc-paidorg-grid">
                <div className="mr-kpirow">
                  <MRKpi label="From paid ads" value={n0(paidSum)} sub={`${paidPct}% of new followers`} strong />
                  <MRKpi label="Organic (direct)" value={n0(orgSum)} sub={paidPct != null ? `${100 - paidPct}% of new followers` : null} />
                  <MRKpi label="Total net new" value={n0((paidSum || 0) + (orgSum || 0))} sub={`last ${rows.length} months`} />
                </div>
                <div className="soc-chart">
                  <div className="mr-trend-lab">New followers per month — paid vs organic</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                      <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtNumber(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="organic" name="Organic" stackId="f" fill="#22b07d" />
                      <Bar dataKey="paid" name="Paid ads" stackId="f" fill="#6d5efc" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : <div className="mr-note">Paid vs organic follower split isn't available from the connector for this account{data && data.followerSplitField ? '' : ' (no paid-fan field returned)'}. It appears once the Facebook page has ad-driven follows in the period.</div>}
          </div>
        )}
        {plat === 'ig' && <div className="mr-note">Instagram doesn't expose a paid-vs-organic follower split — new followers here are total net growth. The paid split is available on the Facebook / Blended view.</div>}

        {/* Rolling trend charts */}
        <div className="soc-trend-charts">
          {CHARTS.map((c) => (
            <div className="soc-chart" key={c.k}>
              <div className="mr-trend-lab">{c.label} · {platLabel} · last {rows.length} months</div>
              <ResponsiveContainer width="100%" height={170}>
                {c.kind === 'bar' ? (
                  <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtNumber(v)} />
                    <Bar dataKey={c.k} name={c.label} fill={c.color} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                ) : (
                  <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtNumber(v)} />
                    <Line type="monotone" dataKey={c.k} name={c.label} stroke={c.color} strokeWidth={2.4} dot={{ r: 2 }} connectNulls />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          ))}
        </div>

        {/* Month-by-month high-level stats */}
        <div className="soc-subhead"><h4>Month-by-month · {platLabel}</h4></div>
        <div className="mr-tablewrap">
          <table className="mr-table">
            <thead><tr><th>Month</th><th className="r">Total followers</th><th className="r">Net followers</th>{paidKnown && <th className="r">· paid</th>}<th className="r">Organic reach</th><th className="r">Views</th>{plat !== 'ig' && <th className="r">Impr. (FB)</th>}<th className="r">Engagement</th><th className="r">Posts</th><th className="r">ER</th></tr></thead>
            <tbody>{[...rows].reverse().map((m) => (
              <tr key={m.month}>
                <td><b>{m.label}</b></td>
                <td className="r"><b>{n0(m.followersEnd)}</b>{m.followersStart != null ? <small className="soc-fol-start"> from {n0(m.followersStart)}</small> : null}</td>
                <td className="r">{signed(m.netFollowers)}</td>
                {paidKnown && <td className="r">{m.paid != null ? n0(m.paid) : '—'}</td>}
                <td className="r">{n0(m.reach)}</td>
                <td className="r">{n0(m.views)}</td>
                {plat !== 'ig' && <td className="r">{n0(m.impressions)}</td>}
                <td className="r">{n0(m.engagement)}</td>
                <td className="r">{n0(m.posts)}</td>
                <td className="r">{m.er != null ? `${m.er}%` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mr-foot-note"><b>Total followers</b> = audience at each month-end (reconstructed from today's count back through the monthly net gains). <b>Net followers</b> = follows minus unfollows. <b>Paid</b> = new followers attributed to ad campaigns (Facebook); the rest are organic. Reach / views / engagement are organic only — Facebook paid-boosted reach &amp; impressions are excluded. Instagram reports reach &amp; views (not impressions), so the Impressions column is Facebook only.</p>
      </>)}
    </div>
  )
}
function SocialDashboard({ clients, range, nonce }) {
  const [enabled, setEnabled] = useState(null)
  // Cache-bust so removing a connector in Windsor refreshes the dropdown; re-runs on manual refresh (nonce).
  useEffect(() => { mrFetch(`scope=social&list=1&_r=${Date.now()}`).then((r) => setEnabled(r.clients || [])).catch(() => setEnabled([])) }, [nonce])
  // Pool Haus pinned first, then alphabetical.
  const PIN = 'pool-haus'
  const list = (clients || []).filter((c) => (enabled ? enabled.includes(c.id) : false)).slice().sort((a, b) => (a.id === PIN ? -1 : b.id === PIN ? 1 : String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })))
  const [clientId, setClientId] = useState('')
  useEffect(() => { if (list.length && !list.some((c) => c.id === clientId)) setClientId(list[0].id) }, [list.length])
  const client = list.find((c) => c.id === clientId) || null
  const [st, setSt] = useState({ status: 'idle' })
  const [dm, setDm] = useState(null)
  const [postSort, setPostSort] = useState('engagement')
  const [subview, setSubview] = useState('perf') // perf | competitors
  useEffect(() => {
    if (!client) { setSt({ status: 'empty' }); return }
    let alive = true; setSt({ status: 'loading' }); setDm(null)
    mrFetch(`scope=social&client=${encodeURIComponent(client.id)}&${rangeQuery(range)}`)
      .then((r) => { if (alive) setSt({ status: 'ok', data: r }) })
      .catch((e) => { if (alive) setSt({ status: 'err', error: String(e.message || e) }) })
    mrFetch(`scope=socialdm&client=${encodeURIComponent(client.id)}&${rangeQuery(range)}`)
      .then((r) => { if (alive && r && r.dm) setDm(r.dm) })
      .catch(() => {})
    return () => { alive = false }
  }, [clientId, range.from, range.to, nonce])

  const n0 = (v) => (v == null || isNaN(v) ? '—' : fmtNumber(Math.round(v)))
  const data = st.status === 'ok' ? st.data : null
  const ig = data && data.ig, fb = data && data.fb
  const igPosts = ig ? [...ig.posts].sort((a, b) => (b[postSort] || 0) - (a[postSort] || 0)).slice(0, 12) : []
  const fbPosts = fb ? [...fb.posts].slice(0, 12) : []
  const socRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  // Blended IG + FB "overall" view (only when both are connected).
  const overall = (ig && fb) ? (() => {
    const audience = (ig.profile.followers || 0) + (fb.page.fans || 0)
    const newAud = (ig.totals.newFollowers || 0) + (fb.totals.newFollows || 0) - (fb.totals.unfollows || 0)
    const reach = (ig.totals.reach || 0) + (fb.totals.reachUnique || 0)
    const engagement = (ig.totals.engagement || 0) + (fb.totals.engagements || 0)
    const posts = ig.posts.length + fb.posts.length
    const m = new Map()
    const add = (d, k, v) => { const e = m.get(d) || { date: d }; e[k] = (e[k] || 0) + v; m.set(d, e) }
    for (const d of ig.daily) { add(d.date, 'newAudience', d.newFollowers); add(d.date, 'posts', d.posts); add(d.date, 'engagement', d.interactions) }
    for (const d of fb.daily) { add(d.date, 'newAudience', d.netFollowers); add(d.date, 'posts', d.posts); add(d.date, 'engagement', d.engagements) }
    const daily = [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
    return { audience, newAud, reach, engagement, posts, er: reach ? Math.round((engagement / reach) * 1000) / 10 : null, daily }
  })() : null

  async function downloadPdf() {
    if (!socRef.current) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const canvas = await html2canvas(socRef.current, { scale: 2, backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff', useCORS: true, logging: false })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const pageHpx = Math.floor(canvas.width * (ph / pw)) // source px per page
      const slice = document.createElement('canvas'); slice.width = canvas.width
      const ctx = slice.getContext('2d')
      let y = 0, first = true
      while (y < canvas.height) {
        const h = Math.min(pageHpx, canvas.height - y)
        slice.height = h; ctx.clearRect(0, 0, slice.width, h); ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
        if (!first) pdf.addPage()
        pdf.addImage(slice.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pw, h * (pw / canvas.width))
        first = false; y += h
      }
      pdf.save(`${(client && client.name || 'social').replace(/[^\w]+/g, '-')}-organic-${range.from}_${range.to}.pdf`)
    } catch (e) { alert('PDF export failed: ' + (e.message || e)) }
    setExporting(false)
  }

  return (
    <div className="soc-page">
      <div className="soc-bar no-print">
        <select className="mr-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {list.length ? list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : <option>No connected accounts</option>}
        </select>
        <div className="soc-tabs">
          <button className={subview === 'perf' ? 'on' : ''} onClick={() => setSubview('perf')}>Performance</button>
          <button className={subview === 'trends' ? 'on' : ''} onClick={() => setSubview('trends')}>KPIs &amp; Trends</button>
          <button className={subview === 'competitors' ? 'on' : ''} onClick={() => setSubview('competitors')}>Competitors</button>
        </div>
        {subview === 'perf' && ig && ig.profile.username && <a className="soc-handle" href={`https://instagram.com/${ig.profile.username}`} target="_blank" rel="noreferrer">@{ig.profile.username}</a>}
        <div className="mr-bar-spacer" />
        {subview === 'perf' && <><button className="mr-btn" onClick={() => window.print()} disabled={!data} title="Print / Save as PDF">🖨 Print</button>
        <button className="mr-btn" onClick={downloadPdf} disabled={!data || exporting} title="Download as PDF">{exporting ? 'Exporting…' : '⤓ Download PDF'}</button></>}
      </div>

      {subview === 'trends' && <SocTrends client={client} range={range} nonce={nonce} />}
      {subview === 'competitors' && <CompetitorsView client={client} range={range} />}

      {subview === 'perf' && (<>
      {st.status === 'loading' && <div className="mr-note"><Spinner label="Loading social…" /></div>}
      {st.status === 'err' && <div className="mr-note mr-err">Couldn’t load: {st.error}</div>}
      {st.status === 'empty' && <div className="mr-note mr-empty-deep"><div className="big">📱</div><b>No organic social accounts connected.</b><p>Connect a client's Instagram / Facebook Page in Windsor and it’ll appear here.</p></div>}

      {data && !ig && !fb && <div className="mr-note mr-empty-deep"><div className="big">📱</div><b>No organic data for this client/period.</b></div>}

      <div className="soc-deck" ref={socRef}>
      {data && (ig || fb) && (
        <div className="soc-cover"><div><span className="soc-cover-brand">Caalano<b>360</b></span><h2>{client ? client.name : ''} — Organic Social</h2><p>{rangeLabel(range)}{ig && ig.profile.username ? ` · @${ig.profile.username}` : ''}</p></div></div>
      )}

      {dm && dm.total > 0 && (
        <section className="soc-section soc-dm">
          <div className="soc-head"><span className="soc-plat soc-all">Inbound DMs</span><h3>Conversations started via social</h3><span className="soc-dm-note">from GoHighLevel inbox · first message inbound via IG/FB</span></div>
          <div className="mr-kpirow">
            <MRKpi label="Total inbound DMs" value={n0(dm.total)} sub="IG + FB, this period" strong />
            <MRKpi label="Instagram DMs" value={n0(dm.ig)} />
            <MRKpi label="Facebook DMs" value={n0(dm.fb)} />
          </div>
          {dm.daily && dm.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Inbound DMs per day</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dm.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ig" name="Instagram" stackId="d" fill="#e1306c" />
                  <Bar dataKey="fb" name="Facebook" stackId="d" fill="#1877f2" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      {overall && (
        <section className="soc-section soc-overall">
          <div className="soc-head"><span className="soc-plat soc-all">Overall</span><h3>Blended organic performance</h3></div>
          <div className="mr-kpirow">
            <MRKpi label="Total audience" value={n0(overall.audience)} sub="IG followers + FB likes" strong />
            <MRKpi label="Net new audience" value={(overall.newAud >= 0 ? '+' : '') + n0(overall.newAud)} sub="this period" />
            <MRKpi label="Total reach" value={n0(overall.reach)} />
            <MRKpi label="Total engagement" value={n0(overall.engagement)} />
            <MRKpi label="Engagement rate" value={overall.er != null ? `${overall.er}%` : '—'} sub="blended" />
            <MRKpi label="Posts published" value={n0(overall.posts)} />
          </div>
          {overall.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Combined — posts per day (bars) · net new audience &amp; engagement (lines), Instagram + Facebook</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={overall.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis yAxisId="p" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                  <YAxis yAxisId="v" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="p" dataKey="posts" name="Posts" fill="#8a63d2" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Line yAxisId="v" type="monotone" dataKey="newAudience" name="Net new audience" stroke="#22b07d" strokeWidth={2.4} dot={false} />
                  <Line yAxisId="v" type="monotone" dataKey="engagement" name="Engagement" stroke="#6d5efc" strokeWidth={2.2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      {ig && (
        <section className="soc-section">
          <div className="soc-head"><span className="soc-plat soc-ig">Instagram</span><h3>Organic performance</h3></div>
          <div className="mr-kpirow">
            <MRKpi label="Followers" value={n0(ig.profile.followers)} sub={ig.totals.newFollowers ? `+${n0(ig.totals.newFollowers)} this period` : 'current'} strong />
            <MRKpi label="Reach" value={n0(ig.totals.reach)} sub="accounts reached" />
            <MRKpi label="Views" value={n0(ig.totals.views)} />
            <MRKpi label="Engagement" value={n0(ig.totals.engagement)} sub="likes+comments+saves+shares" />
            <MRKpi label="Engagement rate" value={ig.totals.er != null ? `${ig.totals.er}%` : '—'} sub="vs reach" />
            <MRKpi label="Profile link taps" value={n0(ig.totals.linkTaps)} sub="→ website/contact" />
            <MRKpi label="Posts" value={n0(ig.posts.length)} />
          </div>
          <div className="mr-kpirow">
            <MRKpi label="Likes" value={n0(ig.totals.likes)} />
            <MRKpi label="Comments" value={n0(ig.totals.comments)} />
            <MRKpi label="Saves" value={n0(ig.totals.saves)} />
            <MRKpi label="Shares" value={n0(ig.totals.shares)} />
            <MRKpi label="Replies" value={n0(ig.totals.replies)} />
            <MRKpi label="Accounts engaged" value={n0(ig.totals.engaged)} />
          </div>
          {ig.daily && ig.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Reach &amp; interactions over time</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={ig.daily} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Line type="monotone" dataKey="reach" name="Reach" stroke="#e1306c" strokeWidth={2.4} dot={false} />
                  <Line type="monotone" dataKey="interactions" name="Interactions" stroke="#6d5efc" strokeWidth={2.4} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {ig.daily && ig.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Posting cadence &amp; follower growth — posts per day (bars) vs new followers per day (line)</div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={ig.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis yAxisId="posts" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                  <YAxis yAxisId="fol" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="posts" dataKey="posts" name="Posts" fill="#e1306c" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Line yAxisId="fol" type="monotone" dataKey="newFollowers" name="New followers" stroke="#22b07d" strokeWidth={2.4} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {ig.daily && ig.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Engagement breakdown per day — likes · comments · saves · shares · replies</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ig.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="likes" name="Likes" stackId="e" fill="#e1306c" />
                  <Bar dataKey="comments" name="Comments" stackId="e" fill="#6d5efc" />
                  <Bar dataKey="saves" name="Saves" stackId="e" fill="#22b07d" />
                  <Bar dataKey="shares" name="Shares" stackId="e" fill="#e0803a" />
                  <Bar dataKey="replies" name="Replies" stackId="e" fill="#e6b800" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="soc-subhead"><h4>Top posts</h4><div className="soc-sort">{[['engagement', 'Engagement'], ['reach', 'Reach'], ['er', 'Eng. rate']].map(([k, l]) => <button key={k} className={postSort === k ? 'on' : ''} onClick={() => setPostSort(k)}>{l}</button>)}</div></div>
          <div className="soc-posts">{igPosts.length ? igPosts.map((p) => <SocPost key={p.id} p={p} platform="ig" />) : <div className="soc-empty">No posts in this period.</div>}</div>
          {(ig.demographics.age.length > 0 || ig.demographics.gender.length > 0 || ig.demographics.country.length > 0) && (
            <>
              <div className="soc-subhead"><h4>Audience</h4></div>
              <div className="soc-demo">
                {ig.demographics.gender.length > 0 && <div className="soc-demo-card"><div className="mr-trend-lab">Gender</div><SocBars data={ig.demographics.gender} labelKey="name" valueKey="size" color="#e1306c" /></div>}
                {ig.demographics.age.length > 0 && <div className="soc-demo-card"><div className="mr-trend-lab">Age</div><SocBars data={ig.demographics.age} labelKey="name" valueKey="size" color="#6d5efc" /></div>}
                {ig.demographics.country.length > 0 && <div className="soc-demo-card"><div className="mr-trend-lab">Top countries</div><SocBars data={ig.demographics.country} labelKey="name" valueKey="size" color="#22b07d" /></div>}
              </div>
            </>
          )}
        </section>
      )}

      {fb && (
        <section className="soc-section">
          <div className="soc-head"><span className="soc-plat soc-fb">Facebook Page</span><h3>Organic performance</h3></div>
          <div className="mr-kpirow">
            <MRKpi label="Page likes" value={n0(fb.page.fans)} strong />
            <MRKpi label="Follows" value={n0(fb.page.follows)} sub={fb.totals.newFollows ? `+${n0(fb.totals.newFollows)} · -${n0(fb.totals.unfollows)}` : null} />
            <MRKpi label="Reach" value={n0(fb.totals.reachUnique)} sub="unique" />
            <MRKpi label="Organic impressions" value={n0(fb.totals.impressionsOrganic)} />
            <MRKpi label="Paid impressions" value={n0(fb.totals.impressionsPaid)} />
            <MRKpi label="Engagements" value={n0(fb.totals.engagements)} />
            <MRKpi label="Page views" value={n0(fb.totals.pageViews)} />
            <MRKpi label="Video views" value={n0(fb.totals.videoViews)} />
          </div>
          {fb.daily && fb.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Impressions — organic vs paid</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={fb.daily} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Bar dataKey="impressionsOrganic" name="Organic" stackId="a" fill="#1877f2" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="impressionsPaid" name="Paid" stackId="a" fill="#9bbcf0" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {fb.daily && fb.daily.length > 1 && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Posting cadence &amp; follower growth — posts per day (bars) vs net new followers (line)</div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={fb.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis yAxisId="posts" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                  <YAxis yAxisId="fol" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="posts" dataKey="posts" name="Posts" fill="#1877f2" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Line yAxisId="fol" type="monotone" dataKey="netFollowers" name="Net new followers" stroke="#22b07d" strokeWidth={2.4} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {fb.daily && fb.daily.length > 1 && (fb.daily.some((d) => (d.reactions || d.comments || d.shares))) && (
            <div className="soc-chart">
              <div className="mr-trend-lab">Engagement breakdown per day — reactions · comments · shares</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={fb.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d) => fmtDate(d).slice(0, 5)} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d) => fmtDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="reactions" name="Reactions" stackId="e" fill="#1877f2" />
                  <Bar dataKey="comments" name="Comments" stackId="e" fill="#6d5efc" />
                  <Bar dataKey="shares" name="Shares" stackId="e" fill="#e0803a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="soc-subhead"><h4>Top posts</h4></div>
          <div className="soc-posts">{fbPosts.length ? fbPosts.map((p) => <SocPost key={p.id} p={p} platform="fb" />) : <div className="soc-empty">No posts in this period.</div>}</div>
        </section>
      )}
      </div>
      </>)}
    </div>
  )
}

// Monochrome sidebar icons (stroke = currentColor), so every nav item reads as
// one colour and matches the text weight — no multicolour emoji.
function NavIcon({ name }) {
  const P = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    trends: <><polyline points="3 16 9 10 13 14 21 6" /><polyline points="15 6 21 6 21 12" /></>,
    weekly: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M8.5 15l2 2 4-4" /></>,
    cockpit: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5M16 4v5M8 20v-5M16 20v-5" /></>,
    insights: <><path d="M3 12h4l2.5 7 4-15 2.5 8H21" /></>,
    update: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
    monthly: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
    report: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
    social: <><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.73 1.13V21a2 2 0 0 1-4 0v-.08A1.6 1.6 0 0 0 7.13 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 3 13.87H3a2 2 0 0 1 0-4h.08A1.6 1.6 0 0 0 4.6 7.13l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9.87 3H10a2 2 0 0 1 4 0v.08a1.6 1.6 0 0 0 2.73 1.13l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 21 9.87V10a2 2 0 0 1 0 4h-.08a1.6 1.6 0 0 0-1.52 1z" /></>,
  }[name] || null
  return <svg className="nav-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P}</svg>
}

// GoHighLevel-style client switcher for the sidebar: shows the active client
// (avatar + name + subline) as a chunky pill, and drops down a searchable list
// of every client. Picking one jumps straight to that client's workspace
// (the "Client View"). `idxOf` keeps avatar colours stable across the app.
function ClientSwitcher({ clients, active, onPick, idxOf }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const needle = q.trim().toLowerCase()
  const list = (needle ? clients.filter((c) => c.name.toLowerCase().includes(needle) || (c.industry || '').toLowerCase().includes(needle)) : clients).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  const pick = (c) => { onPick(c); setOpen(false); setQ('') }
  return (
    <div className={`csw ${open ? 'open' : ''}`} ref={ref}>
      <button className="csw-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Switch client">
        {active
          ? <Avatar id={active.id} name={active.name} i={idxOf(active)} sm />
          : <span className="avatar sm csw-ph">◎</span>}
        <span className="csw-txt">
          <b>{active ? active.name : 'Select a client'}</b>
          <small>{active ? (active.industry || 'Client workspace') : 'Jump to a client workspace'}</small>
        </span>
        <span className="csw-chev">▾</span>
      </button>
      {open && (
        <div className="csw-menu" role="listbox">
          <div className="csw-search"><input autoFocus placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="csw-list">
            {list.length ? list.map((c) => {
              const sel = active && active.id === c.id
              return (
                <button key={c.id} className={`csw-item ${sel ? 'sel' : ''}`} role="option" aria-selected={sel} onClick={() => pick(c)}>
                  <Avatar id={c.id} name={c.name} i={idxOf(c)} sm />
                  <span className="csw-txt"><b>{c.name}</b><small>{c.industry || '—'}</small></span>
                  {sel && <span className="csw-tick">✓</span>}
                </button>
              )
            }) : <div className="csw-empty">No clients match “{q}”.</div>}
          </div>
        </div>
      )}
    </div>
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
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('caalano_sb') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('caalano_sb', collapsed ? '1' : '0') } catch {} }, [collapsed])
  // Present mode: hide agency-internal (cost / spend / margin) figures so the
  // dashboard is safe to screen-share with a client. Not persisted — always
  // starts off so it can never be left on by accident.
  const [present, setPresent] = useState(false)
  const agency = useAgencyLive(range, refreshKey)
  useClientLogos() // one-time brand-logo sync from Caalano Systems (avatars)
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
  const baseClients = [...data.clients.map(applyOv), ...extras].filter((c) => !isClientDeleted(c.id))
  const visibleClients = baseClients.filter((c) => enabled[c.id] !== false && canSeeClientFE(authUser, c.id)).map((c) => (c.ghl || !ghlById[c.id] ? c : { ...c, ghl: ghlById[c.id] }))
  const rows = computeRows(visibleClients, agency.data)
  // Config for the Settings page keeps deleted clients (so the Deleted filter can
  // restore them); the main app's baseClients above already hides them everywhere else.
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
    <div className={`shell ${collapsed ? 'sb-collapsed' : ''} ${present ? 'present' : ''}`}>
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}
      {collapsed && <button className="sb-expand" onClick={() => setCollapsed(false)} aria-label="Show sidebar" title="Show sidebar">»</button>}
      <aside className={`side ${navOpen ? 'open' : ''}`}>
        <div className="brand"><div className="logo logo-360"><span>360</span></div><div><h1 className="brand-name">Caalano<span className="b360">360</span></h1><p>360° Reporting</p></div><button className="sb-toggle" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar">«</button><button className="side-close" onClick={() => setNavOpen(false)} aria-label="Close menu">✕</button></div>
        {(!isViewer || myClients.length > 1) && myClients.length > 0 && (
          <ClientSwitcher clients={myClients} active={curView === 'clients' ? curPicked : null} onPick={openClient} idxOf={(c) => Math.max(0, baseClients.findIndex((x) => x.id === c.id))} />
        )}
        <nav className="nav">
          {!isViewer && <>
            <button className={curView === 'overview' ? 'active' : ''} onClick={() => go('overview')}><span className="ic"><NavIcon name="overview" /></span>Agency Overview</button>
            <button className={curView === 'trends' ? 'active' : ''} onClick={() => go('trends')}><span className="ic"><NavIcon name="trends" /></span>Daily Performance</button>
            <button className={curView === 'weekly' ? 'active' : ''} onClick={() => go('weekly')}><span className="ic"><NavIcon name="weekly" /></span>Weekly Traffic Light</button>
            <button className={curView === 'cockpit' ? 'active' : ''} onClick={() => go('cockpit')}><span className="ic"><NavIcon name="cockpit" /></span>Creative Cockpit</button>
            <button className={curView === 'insights' ? 'active' : ''} onClick={() => go('insights')}><span className="ic"><NavIcon name="insights" /></span>Meta Insights</button>
            <button className={curView === 'update' ? 'active' : ''} onClick={() => go('update')}><span className="ic"><NavIcon name="update" /></span>Client Update</button>
            <button className={curView === 'monthly' ? 'active' : ''} onClick={() => go('monthly')}><span className="ic"><NavIcon name="monthly" /></span>Monthly Report</button>
            <button className={curView === 'social' ? 'active' : ''} onClick={() => go('social')}><span className="ic"><NavIcon name="social" /></span>Organic Social Media</button>
          </>}
          {isViewer && <>
            <div className="nav-lab">My reports</div>
            {myClients.length ? myClients.map((c) => <button key={c.id} className={curView === 'clients' && curPicked && curPicked.id === c.id ? 'active' : ''} onClick={() => openClient(c)}><span className="ic"><NavIcon name="report" /></span>{c.name}</button>) : <div className="nav-empty">No reports assigned yet — your admin will set these up.</div>}
          </>}
        </nav>
        <div className="side-foot">
          <button className={`settings-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><span className="ic"><NavIcon name="settings" /></span>Settings</button>
          {authUser && <div className="side-user"><span className="side-user-av">{(authUser.name || authUser.email || '?').trim().charAt(0).toUpperCase()}</span><div className="side-user-txt"><b>{authUser.name || authUser.email}</b><span>{ROLE_LABEL[authUser.role] || authUser.role}</span></div><button className="side-user-out" onClick={onLogout} title="Sign out">Sign out</button></div>}
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
            <h2>{curView === 'overview' ? 'Agency Overview' : curView === 'trends' ? 'Daily Performance' : curView === 'weekly' ? 'Weekly Traffic Light' : curView === 'cockpit' ? 'Creative Cockpit' : curView === 'insights' ? 'Meta Insights' : curView === 'update' ? 'Client Update' : curView === 'monthly' ? 'Monthly Report' : curView === 'social' ? 'Organic Social Media' : curView === 'settings' ? 'Settings' : isViewer ? 'Your report' : 'Clients'}</h2>
            <p>{curView === 'overview' ? 'Blended paid performance across all clients, live for the selected range.' : curView === 'trends' ? 'Rolling 3 / 7 / 14 / 21 / 28-day performance per client, each vs the prior equal window.' : curView === 'weekly' ? 'One client at a time, reported Monday-Sunday by ISO week - spend pacing, leads, appointments and wins vs KPI.' : curView === 'cockpit' ? 'Every creative for a client, with performance, categorisation and AI strategy.' : curView === 'insights' ? 'Everything Meta-derived in one place - delivery health, creative fatigue and more, across every active Meta client.' : curView === 'update' ? 'Generate a client-ready account update (WhatsApp + email) for the selected range.' : curView === 'monthly' ? 'Build a frozen, slide-based monthly report for one client — campaign → ad set → creative → Google → Caalano360 → team → ROI. Export to PDF.' : curView === 'social' ? 'Organic Instagram + Facebook Page performance per client — followers, reach, engagement, best posts and audience, for the selected range.' : curView === 'settings' ? (isViewer ? 'Your account.' : 'Clients, key events, KPI targets and campaign links - saved to the server and shared across your team.') : isViewer ? 'Your live reporting for the selected range.' : 'Open any client for their Overall, CRM, Meta and Google workspace.'}</p>
          </div>
          <div className="spacer" />
          {curView !== 'settings' && curView !== 'monthly' && <DateRange range={range} onChange={setRange} busy={agency.status === 'loading'} />}
          {curView !== 'monthly' && <button className="refresh-btn" title="Refresh live data" onClick={() => setRefreshKey((k) => k + 1)}><span className={agency.status === 'loading' ? 'spin sm' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh</button>}
        </div>
        <ErrorBoundary key={curView + '|' + (curPicked && curPicked.id || '')} onHome={() => { setPicked(null); setView(isViewer ? 'clients' : 'overview') }}>
          {curView === 'overview' && !isViewer && <Overview rows={rows} currency={data.currency} periodLabel={rangeLabel(range)} live={agency.status === 'ok'} alerts={agency.data && agency.data.alerts} range={range} nonce={refreshKey} onPick={(c) => { setPicked(c); setView('clients') }} />}
          {curView === 'trends' && !isViewer && <TrendsTab rows={rows} currency={data.currency} nonce={refreshKey} onPick={(c) => { setPicked(c); setView('clients') }} />}
          {curView === 'weekly' && !isViewer && <WeeklyTab rows={rows} currency={data.currency} nonce={refreshKey} />}
          {curView === 'cockpit' && !isViewer && <CreativeCockpitPage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} authUser={authUser} />}
          {curView === 'insights' && !isViewer && <MetaInsightsPage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} />}
          {curView === 'update' && !isViewer && <ClientUpdatePage clients={visibleClients} currency={data.currency} range={range} nonce={refreshKey} />}
          {curView === 'monthly' && !isViewer && <MonthlyReport clients={visibleClients} currency={data.currency} authUser={authUser} />}
          {curView === 'social' && !isViewer && <SocialDashboard clients={visibleClients} range={range} nonce={refreshKey} />}
          {curView === 'settings' && <SettingsPage config={cfgMerged} enabled={enabled} setEnabled={setEnabled} currency={data.currency} authUser={authUser} authEnabled={authEnabled} theme={theme} setTheme={setTheme} onPick={(c) => { const full = baseClients.find((x) => x.id === c.id) || c; setPicked(full); setView('clients') }} />}
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
