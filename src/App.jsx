import React, { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ComposedChart, ReferenceLine, LabelList,
} from 'recharts'
import {
  fmtCurrency, fmtNumber, fmtCompact, fmtPct, pctChange,
  clientTotals, agencyTotals,
} from './lib/format.js'

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
const O360_COLS = [['booked', 'Booked'], ['cBook', 'C/Book'], ['shown', 'Shown'], ['cShow', 'C/Show'], ['won', 'Won'], ['cWon', 'C/Won'], ['wonVal', 'Won val'], ['roas', 'ROAS']]
// Flatten an outcome into sortable numeric fields merged onto each ad row.
function o360Fields(o, spend) {
  if (!o) return { booked: null, cBook: null, shown: null, cShow: null, won: null, cWon: null, wonVal: null, roas: null, _has360: false }
  return {
    booked: o.booked, cBook: o.booked && spend ? spend / o.booked : null,
    shown: o.shown, cShow: o.shown && spend ? spend / o.shown : null,
    won: o.won, cWon: o.won && spend ? spend / o.won : null,
    wonVal: o.revenue, roas: spend ? o.revenue / spend : null, _has360: true,
  }
}
// A little "Caalano360" banner spanning the green columns, above the header row.
function C360GrpRow({ left }) {
  return <tr className="c360-grp-row"><th className="c360-grp-blank" colSpan={left} aria-hidden="true" /><th className="c360-grp" colSpan={O360_COLS.length}>Caalano360</th></tr>
}
function O360Head({ sort, on }) {
  return <>{O360_COLS.map(([k, label], i) => (sort
    ? <SortTh key={k} k={k} sort={sort} on={on} className={`c360-col${i === 0 ? ' c360-first' : ''}`}>{label}</SortTh>
    : <th key={k} className={`c360-col${i === 0 ? ' c360-first' : ''}`}>{label}</th>))}</>
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
// Renders the green Caalano360 cells from the sortable fields merged onto a row.
function o360Cells(r, currency) {
  if (!r || !r._has360) return <>{O360_COLS.map(([k], i) => <td key={k} className={`c360-col dim${i === 0 ? ' c360-first' : ''}`}>-</td>)}</>
  return <>
    <td className="c360-col c360-first">{fmtNumber(r.booked || 0)}</td>
    <td className="c360-col">{r.cBook != null ? fmtCurrency(r.cBook, currency) : '-'}</td>
    <td className="c360-col">{fmtNumber(r.shown || 0)}</td>
    <td className="c360-col">{r.cShow != null ? fmtCurrency(r.cShow, currency) : '-'}</td>
    <td className="c360-col">{fmtNumber(r.won || 0)}</td>
    <td className="c360-col">{r.cWon != null ? fmtCurrency(r.cWon, currency) : '-'}</td>
    <td className="c360-col">{r.wonVal != null ? fmtCurrency(r.wonVal, currency) : '-'}</td>
    <td className="c360-col">{r.roas != null ? `${r.roas.toFixed(2)}×` : '-'}</td>
  </>
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
    return { c, i, id: c.id, name: c.name, industry: c.industry, track: c.trackingStatus, spend, impressions, clicks, conversions, revenue, cpl: conversions ? spend / conversions : 0, ctr: impressions ? (clicks / impressions) * 100 : 0, roas: spend ? revenue / spend : 0, metaSpend: meta?.spend || 0, googleSpend: google?.cost || 0, hasMeta: !!c.meta, hasGoogle: !!c.google }
  })
}

/* ============ Overview ============ */
function Overview({ rows, currency, periodLabel, live, alerts, onPick }) {
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
          <AlertCol title="Meta" color="#4f7cff" list={alerts.meta || []} />
          <AlertCol title="Google" color="#12b886" list={alerts.google || []} />
        </div>
      </>}
      <div className="section-title">Client leaderboard <span className="sub">· click a row to open the client workspace</span></div>
      <ClientTable rows={rows} currency={currency} onPick={onPick} />
    </>
  )
}

function ClientTable({ rows, currency, onPick }) {
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const sorted = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir)
  const setKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
  const Th = ({ k, children }) => <th onClick={() => setKey(k)}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <div className="table-wrap"><table>
      <thead><tr><Th k="name">Client</Th><Th k="spend">Spend</Th><Th k="conversions">Results</Th><Th k="cpl">Cost / result</Th><Th k="revenue">Revenue</Th><Th k="roas">ROAS</Th><Th k="ctr">CTR</Th><th>Tracking</th><th>Channels</th></tr></thead>
      <tbody>{sorted.map((r) => {
        const tk = TRACK[r.track] || TRACK.full; const has = r.conversions > 0
        return (
          <tr key={r.id} onClick={() => onPick(r.c)}>
            <td><div className="client-cell"><span className="avatar" style={{ background: acolor(r.i) }}>{initials(r.name)}</span><div>{r.name}<small>{r.industry}</small></div></div></td>
            <td>{fmtCurrency(r.spend, currency)}</td>
            <td>{has ? fmtNumber(r.conversions) : '-'}</td>
            <td>{has ? fmtCurrency(r.cpl, currency) : '-'}</td>
            <td>{r.revenue ? fmtCurrency(r.revenue, currency) : '-'}</td>
            <td>{r.revenue && r.spend ? `${r.roas.toFixed(2)}×` : '-'}</td>
            <td>{fmtPct(r.ctr, 2)}</td>
            <td><span className={`tk ${tk.cls}`}>{tk.label}</span></td>
            <td><div className="chan-tags">{r.hasMeta && <span className="chan" style={{ background: '#4f7cff' }}>Meta</span>}{r.hasGoogle && <span className="chan" style={{ background: '#12b886' }}>Google</span>}</div></td>
          </tr>
        )
      })}</tbody>
    </table></div>
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
// AI insights persist per client (localStorage) until regenerated.
const AI_KEY = 'caalano_ai_insights'
function loadInsights(clientId) { try { return (JSON.parse(localStorage.getItem(AI_KEY) || '{}')[clientId]) || null } catch { return null } }
function saveInsights(clientId, v) { try { const all = JSON.parse(localStorage.getItem(AI_KEY) || '{}'); all[clientId] = v; localStorage.setItem(AI_KEY, JSON.stringify(all)) } catch {} }
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
  const clients = rows
  const [cid, setCid] = useState(clients[0]?.id || null)
  const [weeks, setWeeks] = useState(6)
  const wk = useWeekly(cid, weeks, nonce)
  const kpis = cid ? loadKpis(cid) : {}
  const money = (v) => fmtCurrency(v, currency)
  const clientName = clients.find((c) => c.id === cid)?.name || '-'
  const [ai, setAi] = useState(() => (cid ? loadInsights(cid) : null))
  const [aiLoading, setAiLoading] = useState(false)
  const [aiErr, setAiErr] = useState(null)
  useEffect(() => { setAi(cid ? loadInsights(cid) : null); setAiErr(null) }, [cid])
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

function MetaDeep({ deep, currency, attr, clientId }) {
  const kpis = loadKpis(clientId)
  const [sel, setSel] = useState(null)
  const [day, setDay] = useState(null)
  const [campSort, onCampSort] = useSort('spend')
  const [adsetSort, onAdsetSort] = useSort('spend')
  const [creSort, onCreSort] = useSort('spend')
  const [crePage, setCrePage] = useState(0)
  useEffect(() => { setCrePage(0) }, [sel])
  if (!deep?.meta) return <EmptyDeep channel="Meta Ads" />
  const m = deep.meta
  const A = attr && attr.data && attr.data.attribution
  const has360 = !!A
  const oCamp = mkOutcomeMap(A && A.byCampaign)
  const oTerm = mkOutcomeMap(A && A.byTerm)
  const oCre = mkOutcomeMap(A && A.byCreative)
  // account CRM totals (every opp lands in exactly one utm_campaign bucket incl. "(not set)")
  const crmTot = A ? (A.byCampaign || []).reduce((a, x) => ({ booked: a.booked + x.booked, shown: a.shown + x.shown, won: a.won + x.won, revenue: a.revenue + x.revenue }), { booked: 0, shown: 0, won: 0, revenue: 0 }) : null
  const t = m.totals || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, reach: 0 }
  const cpm = t.impressions ? t.spend / t.impressions * 1000 : 0
  const cpl = t.leads ? t.spend / t.leads : 0
  const cpcLink = t.linkClicks ? t.spend / t.linkClicks : 0
  const pv = m.prev || null
  const D = (fn) => (pv ? fn(pv) : null) // previous-period value or null
  const daily = (m.daily || []).map((d) => ({ ...d, label: dayLabel(d.date), cpl: d.leads ? d.spend / d.leads : 0, cpm: d.impressions ? d.spend / d.impressions * 1000 : 0, ctr: d.impressions ? d.clicks / d.impressions * 100 : 0, cpc: d.clicks ? d.spend / d.clicks : 0 }))
  const adsets = sel ? m.adsets.filter((a) => a.campaign === sel) : m.adsets
  const adsFull = sel ? m.ads.filter((a) => a.campaign === sel) : m.ads
  const CRE_PAGE = 15
  const creTotalPages = Math.max(1, Math.ceil(adsFull.length / CRE_PAGE))
  const crePageC = Math.min(crePage, creTotalPages - 1)
  const ads = adsFull.slice(crePageC * CRE_PAGE, crePageC * CRE_PAGE + CRE_PAGE)
  // account averages for creative colour-coding (higher = better, except CPL)
  const avgLinkCtr = rate(t.linkClicks, t.impressions)
  const avgCvr = rate(t.leads, t.linkClicks)
  const vidA = adsFull.filter((a) => a.type === 'Video')
  const avgHook = vidA.length ? rate(vidA.reduce((s, a) => s + a.videoViews, 0), vidA.reduce((s, a) => s + a.impressions, 0)) : 0
  const gb = (v, avg) => (avg ? (v >= avg ? 'good' : 'bad') : '')
  const formats = ['Video', 'Image'].map((type) => {
    const rs = adsFull.filter((a) => a.type === type); if (!rs.length) return null
    const s = rs.reduce((a, x) => ({ spend: a.spend + x.spend, impressions: a.impressions + x.impressions, linkClicks: a.linkClicks + x.linkClicks, leads: a.leads + x.leads, videoViews: a.videoViews + x.videoViews }), { spend: 0, impressions: 0, linkClicks: 0, leads: 0, videoViews: 0 })
    return { type, count: rs.length, ...s }
  }).filter(Boolean)
  return (
    <>
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
        <Sc label="Leads" value={fmtNumber(t.leads)} cur={t.leads} prev={D((x) => x.leads)} />
        <Sc label="CPL" value={fmtCurrency(cpl, currency)} cur={cpl} prev={D((x) => x.leads ? x.spend / x.leads : 0)} goodWhenDown kpi={kpis.metaCpl ? { text: `Target ${fmtCurrency(kpis.metaCpl, currency)}`, cls: kpiClass(cpl, kpis.metaCpl, true) } : null} />
        <Sc label="CVR (Lead)" value={fmtPct(rate(t.leads, t.linkClicks), 2)} cur={rate(t.leads, t.linkClicks)} prev={D((x) => rate(x.leads, x.linkClicks))} />
        {crmTot && <Sc label="Scheduled Appts" value={fmtNumber(crmTot.booked)} />}
        {crmTot && <Sc label="Cost / Appt" value={crmTot.booked ? fmtCurrency(t.spend / crmTot.booked, currency) : '-'} />}
      </div>
      {daily.length > 0 && <div className="card chart-card" style={{ marginTop: 14 }}>
        <h3>Daily trend</h3><p className="cap">Spend, Leads and CPL by day</p>
        <ResponsiveContainer width="100%" height={250}>
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
      </div>}
      <div className="lvl-title">Campaigns <span className="sub">· {m.campaigns.length}{sel ? ` · filtered to "${sel}" (click to clear)` : ' · click a row to drill in'}{has360 ? ' · green = Caalano360 outcomes (UTM-matched)' : ''}</span></div>
      <div className="table-wrap"><table><thead>{has360 && <C360GrpRow left={6} />}<tr><SortTh k="name" sort={campSort} on={onCampSort}>Campaign</SortTh><SortTh k="spend" sort={campSort} on={onCampSort}>Spend</SortTh><SortTh k="impressions" sort={campSort} on={onCampSort}>Impr.</SortTh><SortTh k="ctr" sort={campSort} on={onCampSort}>CTR</SortTh><SortTh k="leads" sort={campSort} on={onCampSort}>Leads</SortTh><SortTh k="cpl" sort={campSort} on={onCampSort}>CPL</SortTh>{has360 && <O360Head sort={campSort} on={onCampSort} />}</tr></thead>
        <tbody>{sortRows(m.campaigns.map((c) => ({ ...c, ctr: rate(c.clicks, c.impressions), cpl: c.leads ? c.spend / c.leads : null, ...o360Fields(oCamp.get(unorm(c.name)), c.spend) })), campSort).map((c) => (<tr key={c.name} className={sel === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setSel(sel === c.name ? null : c.name)}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td>{fmtPct(c.ctr, 2)}</td><td>{fmtNumber(c.leads)}</td><td>{c.cpl != null ? fmtCurrency(c.cpl, currency) : '-'}</td>{has360 && o360Cells(c, currency)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Ad sets <span className="sub">· {adsets.length}{sel ? ` in "${sel}"` : ''}</span></div>
      <div className="table-wrap"><table><thead>{has360 && <C360GrpRow left={6} />}<tr><SortTh k="name" sort={adsetSort} on={onAdsetSort}>Ad set</SortTh><SortTh k="spend" sort={adsetSort} on={onAdsetSort}>Spend</SortTh><SortTh k="impressions" sort={adsetSort} on={onAdsetSort}>Impr.</SortTh><SortTh k="ctr" sort={adsetSort} on={onAdsetSort}>CTR</SortTh><SortTh k="leads" sort={adsetSort} on={onAdsetSort}>Leads</SortTh><SortTh k="cpl" sort={adsetSort} on={onAdsetSort}>CPL</SortTh>{has360 && <O360Head sort={adsetSort} on={onAdsetSort} />}</tr></thead>
        <tbody>{sortRows(adsets.map((c) => ({ ...c, ctr: rate(c.clicks, c.impressions), cpl: c.leads ? c.spend / c.leads : null, ...o360Fields(oTerm.get(unorm(c.name)), c.spend) })), adsetSort).map((c) => (<tr key={c.name}><td>{c.name}</td><td>{fmtCurrency(c.spend, currency)}</td><td>{fmtNumber(c.impressions)}</td><td>{fmtPct(c.ctr, 2)}</td><td>{fmtNumber(c.leads)}</td><td>{c.cpl != null ? fmtCurrency(c.cpl, currency) : '-'}</td>{has360 && o360Cells(c, currency)}</tr>))}</tbody></table></div>
      {formats.length > 0 && <>
        <div className="lvl-title">Performance by format <span className="sub">· image vs video</span></div>
        <div className="table-wrap"><table><thead><tr><th>Format</th><th>Ads</th><th>Spend</th><th>Impr.</th><th>Link CTR</th><th>Leads</th><th>CPL</th><th>Hook rate</th></tr></thead>
          <tbody>{formats.map((f) => (<tr key={f.type}><td>{f.type}</td><td>{fmtNumber(f.count)}</td><td>{fmtCurrency(f.spend, currency)}</td><td>{fmtNumber(f.impressions)}</td><td>{fmtPct(rate(f.linkClicks, f.impressions), 2)}</td><td>{fmtNumber(f.leads)}</td><td>{f.leads ? fmtCurrency(f.spend / f.leads, currency) : '-'}</td><td>{f.type === 'Video' ? fmtPct(rate(f.videoViews, f.impressions), 1) : '-'}</td></tr>))}</tbody></table></div>
      </>}
      <div className="lvl-title">Creatives <span className="sub">· {adsFull.length}{sel ? ` in "${sel}"` : ''} · table + visuals · green/red vs account average</span></div>
      <div className="table-wrap"><table><thead>{has360 && <C360GrpRow left={9} />}<tr>
        <SortTh k="name" sort={creSort} on={onCreSort}>Creative</SortTh><SortTh k="type" sort={creSort} on={onCreSort}>Type</SortTh><SortTh k="spend" sort={creSort} on={onCreSort}>Spend</SortTh><SortTh k="impressions" sort={creSort} on={onCreSort}>Impr.</SortTh><SortTh k="linkCtr" sort={creSort} on={onCreSort}>Link CTR</SortTh><SortTh k="hook" sort={creSort} on={onCreSort}>Hook</SortTh><SortTh k="leads" sort={creSort} on={onCreSort}>Leads</SortTh><SortTh k="cvr" sort={creSort} on={onCreSort}>CVR</SortTh><SortTh k="cpl" sort={creSort} on={onCreSort}>CPL</SortTh>{has360 && <O360Head sort={creSort} on={onCreSort} />}</tr></thead>
        <tbody>{sortRows(adsFull.map((a) => ({ ...a, linkCtr: rate(a.linkClicks, a.impressions), hook: a.type === 'Video' ? rate(a.videoViews, a.impressions) : null, cvr: rate(a.leads, a.linkClicks), cpl: a.leads ? a.spend / a.leads : null, ...o360Fields(oCre.get(unorm(a.name)), a.spend) })), creSort).map((a) => (<tr key={a.name}>
          <td title={a.name} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</td><td>{a.type}</td><td>{fmtCurrency(a.spend, currency)}</td><td>{fmtNumber(a.impressions)}</td>
          <td className={gb(a.linkCtr, avgLinkCtr)}>{fmtPct(a.linkCtr, 2)}</td><td className={a.hook != null ? gb(a.hook, avgHook) : ''}>{a.hook != null ? fmtPct(a.hook, 1) : '-'}</td>
          <td>{fmtNumber(a.leads)}</td><td className={a.leads ? gb(a.cvr, avgCvr) : ''}>{a.leads ? fmtPct(a.cvr, 1) : '-'}</td>
          <td className={a.cpl != null ? (a.cpl <= cpl ? 'good' : 'bad') : ''}>{a.cpl != null ? fmtCurrency(a.cpl, currency) : '-'}</td>
          {has360 && o360Cells(a, currency)}</tr>))}</tbody></table></div>
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
                    <div className="st"><div className="l">Booked</div><div className="v">{fmtNumber(o.booked)}</div></div>
                    <div className="st"><div className="l">C/Book</div><div className="v">{o.booked ? fmtCurrency(a.spend / o.booked, currency) : '-'}</div></div>
                    <div className="st"><div className="l">Shown</div><div className="v">{fmtNumber(o.shown)}</div></div>
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
    </>
  )
}

/* ============ Google deep ============ */
const qsClass = (n) => n === '' || n == null ? 'q-unk' : n >= 7 ? 'q-above' : n >= 4 ? 'q-avg' : 'q-low'
const MT_COLOR = { Broad: '#f5a524', Phrase: '#4f7cff', Exact: '#12b886' }
const mtColor = (t) => MT_COLOR[t] || '#8b5cf6'
function GoogleDeep({ deep, currency, attr, clientId }) {
  const kpis = loadKpis(clientId)
  const [sel, setSel] = useState({ campaign: null, adGroup: null })
  const [day, setDay] = useState(null)
  const [cSort, onCSort] = useSort('cost')
  const [aSort, onASort] = useSort('cost')
  const [kSort, onKSort] = useSort('cost')
  const [sSort, onSSort] = useSort('cost')
  if (!deep?.google) return <EmptyDeep channel="Google Ads" />
  const g = deep.google
  const A = attr && attr.data && attr.data.attribution
  const has360 = !!A
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
  const GHead = ({ first, o360, sort, on }) => (<thead>{o360 && has360 && <C360GrpRow left={7} />}<tr><SortTh k="name" sort={sort} on={on}>{first}</SortTh><SortTh k="cost" sort={sort} on={on}>Cost</SortTh><SortTh k="impressions" sort={sort} on={on}>Impr.</SortTh><SortTh k="ctr" sort={sort} on={on}>CTR</SortTh><SortTh k="cpc" sort={sort} on={on}>CPC</SortTh><SortTh k="conversions" sort={sort} on={on}>Conv.</SortTh><SortTh k="costConv" sort={sort} on={on}>Cost/conv</SortTh>{o360 && has360 && <O360Head sort={sort} on={on} />}</tr></thead>)
  const GCells = (r) => (<><td>{fmtCurrency(r.cost, currency)}</td><td>{fmtNumber(r.impressions)}</td><td>{fmtPct(rate(r.clicks, r.impressions), 2)}</td><td>{fmtCurrency(r.clicks ? r.cost / r.clicks : 0, currency)}</td><td>{fmtNumber(r.conversions)}</td><td>{r.conversions ? fmtCurrency(r.cost / r.conversions, currency) : '-'}</td></>)
  const gMetrics = (r) => ({ ...r, ctr: rate(r.clicks, r.impressions), cpc: r.clicks ? r.cost / r.clicks : null, costConv: r.conversions ? r.cost / r.conversions : null })
  return (
    <>
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
      <div className="lvl-title">Campaigns <span className="sub">· {g.campaigns.length}{sel.campaign ? ` · filtered to "${sel.campaign}" (click to clear)` : ' · click a row to drill in'}{has360 ? ' · green = Caalano360 outcomes (UTM-matched)' : ''}</span></div>
      <div className="table-wrap"><table><GHead first="Campaign" o360 sort={cSort} on={onCSort} />
        <tbody>{sortRows(g.campaigns.map((c) => ({ ...gMetrics(c), ...o360Fields(oCampG.get(unorm(c.name)), c.cost) })), cSort).map((c) => (<tr key={c.name} className={sel.campaign === c.name ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickCamp(c.name)}><td>{c.name}{c.status && c.status !== 'Enabled' ? <span className="q-badge q-unk" style={{ marginLeft: 6 }}>{c.status}</span> : null}</td>{GCells(c)}{has360 && o360Cells(c, currency)}</tr>))}</tbody></table></div>
      <div className="lvl-title">Ad groups <span className="sub">· {adGroups.length}{sel.campaign ? ` in "${sel.campaign}"` : ''}{sel.adGroup ? ` · filtered to "${sel.adGroup}"` : adGroups.length ? ' · click to drill in' : ''}</span></div>
      <div className="table-wrap"><table><GHead first="Ad group" o360 sort={aSort} on={onASort} />
        <tbody>{sortRows(adGroups.map((c) => ({ ...gMetrics(c), ...o360Fields(oAgG.get(unorm(c.name)), c.cost) })), aSort).map((c) => (<tr key={c.campaign + '|' + c.name} className={sel.adGroup === c.name && sel.campaign === c.campaign ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => pickAg(c)}><td>{c.name}</td>{GCells(c)}{has360 && o360Cells(c, currency)}</tr>))}</tbody></table></div>
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
    </>
  )
}

function EmptyDeep({ channel }) {
  return <div className="card empty-deep"><div className="big">📊</div><b>{channel} deep breakdown not pulled yet for this client.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Campaign, ad-set and creative level data pulls on demand via Reporting Ninja. Nexia Health Care is built out as the first full example. Ask me to build this client next, or connect the live API to populate every client automatically.</p></div>
}

/* ============ Client workspace ============ */
function OverallTab({ client, currency, side }) {
  const tt = clientTotals(client); const d = tt[side]; const other = tt[side === 'cur' ? 'prev' : 'cur']
  const m = client.meta, g = client.google
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
  const money = (v) => fmtCurrency(v, currency)
  const pipe = pid === 'all' ? null : pipes.find((p) => p.id === pid)
  // Every scorecard / breakdown pivots to the selected pipeline (within the user).
  const t = pipe ? pipe.totals : src.totals
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
      <div className="scorecard">
        <Sc label="Leads" value={fmtNumber(t.leads)} />
        <Sc label="Open" value={fmtNumber(t.open)} />
        <Sc label="Won" value={fmtNumber(t.won)} />
        <Sc label="Lost" value={fmtNumber(t.lost)} />
        <Sc label="Abandoned" value={fmtNumber(t.abandoned)} />
        <Sc label="Close Rate" value={fmtPct(t.closeRate, 1)} />
        <Sc label="Pipeline Value" value={money(t.openValue)} />
        <Sc label="Won Value" value={money(t.revenue)} />
        <Sc label="Avg Deal" value={t.won ? money(t.avgWonValue) : '-'} />
        <Sc label="Avg Days to Won" value={t.avgDaysToWon != null ? `${t.avgDaysToWon}d` : '-'} />
      </div>
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
const CMAP_KEY = 'caalano_campmap'
function loadCampMap(clientId) { try { return (JSON.parse(localStorage.getItem(CMAP_KEY) || '{}')[clientId]) || {} } catch { return {} } }
function saveCampMap(clientId, map) { try { const all = JSON.parse(localStorage.getItem(CMAP_KEY) || '{}'); all[clientId] = map; localStorage.setItem(CMAP_KEY, JSON.stringify(all)) } catch {} }

/* Per-client KPI targets - { metaCpl, googleCostConv, stages: { [stageName]: leadsTarget } } */
const KPI_KEY = 'caalano_kpis'
function loadKpis(clientId) { try { return (JSON.parse(localStorage.getItem(KPI_KEY) || '{}')[clientId]) || {} } catch { return {} } }
function saveKpis(clientId, k) { try { const all = JSON.parse(localStorage.getItem(KPI_KEY) || '{}'); all[clientId] = k; localStorage.setItem(KPI_KEY, JSON.stringify(all)) } catch {} }
// colour helper: is `actual` hitting `target`? goodWhenUnder for cost metrics.
function kpiClass(actual, target, goodWhenUnder) { if (target == null || target === '' || !actual) return ''; const hit = goodWhenUnder ? actual <= target : actual >= target; return hit ? 'good' : 'bad' }

/* Per-client key events - array of pipeline stage names to feature as the
   Caalano360 funnel (with cost per stage). Empty = default leads→booked→shown→won. */
const KEV_KEY = 'caalano_keyevents'
function loadKeyEvents(clientId) { try { return (JSON.parse(localStorage.getItem(KEV_KEY) || '{}')[clientId]) || [] } catch { return [] } }
function saveKeyEvents(clientId, arr) { try { const all = JSON.parse(localStorage.getItem(KEV_KEY) || '{}'); all[clientId] = arr; localStorage.setItem(KEV_KEY, JSON.stringify(all)) } catch {} }
// reached-per-stage across a set of pipelines: cumulative from the last stage
// (an opp at a stage passed through every earlier stage), summed by stage name.
function reachedByStage(pipelines) {
  const m = new Map(); let total = 0
  for (const p of pipelines) {
    const sts = (p.stages || []).slice().sort((a, b) => a.pos - b.pos)
    let acc = 0; const reached = []
    for (let i = sts.length - 1; i >= 0; i--) { acc += sts[i].count; reached[i] = acc }
    if (sts.length) total += reached[0]
    sts.forEach((s, i) => m.set(s.name, (m.get(s.name) || 0) + reached[i]))
  }
  return { m, total }
}

function Caalano360({ blend, client, currency, range, nonce, utmAttr }) {
  const b = blend
  const users = b.users || []
  const camps = b.campaigns || []
  const [uid, setUid] = useState('all')
  const [pid, setPid] = useState('all')
  const [chan, setChan] = useState('all')
  useEffect(() => { setPid('all'); setChan('all'); setUid('all') }, [client.id])
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
  const norm360 = (t) => ({ leads: t.leads, booked: t.booked, shown: t.shown, won: t.won, revenue: t.revenue, avgValue: t.avgWonValue, openValue: t.openValue, lost: t.lost, open: t.open })
  const chSel = chan !== 'all' && channels ? channels[chan] : null
  const pipesSrc = chSel ? (chSel.pipelines || []) : pipes
  const crmAll = chSel ? norm360(chSel.totals) : base.crm
  const multiSrc = pipesSrc.length > 1
  const c = pid === 'all' ? crmAll : (pipesSrc.find((x) => x.id === pid)?.crm || crmAll)
  const attr = pid === 'all'
    ? { adSpend: p.adSpend, metaSpend: p.metaSpend, googleSpend: p.googleSpend, adConversions: p.adConversions, campaigns: camps.map((x) => ({ ...x, target: effTarget(x.name) })) }
    : attrFor(pid)
  const spend = chan === 'meta' ? attr.metaSpend : chan === 'google' ? attr.googleSpend : attr.adSpend
  const lostReasons = chSel ? chSel.lostReasons : (channels && channels.all ? channels.all.lostReasons : null)
  const roas = spend ? c.revenue / spend : 0
  // Previous equal-length period - deltas only at account level (no per-pipeline
  // / channel / user split in the prior period).
  const pv = (uid === 'all' && chan === 'all' && pid === 'all' && b.prev) ? b.prev : null
  const pc = pv ? pv.crm : null
  const money = (v) => fmtCurrency(v, currency)
  const chanPie = chan === 'meta' ? [{ name: 'Meta', value: attr.metaSpend, color: '#4f7cff' }].filter((x) => x.value > 0)
    : chan === 'google' ? [{ name: 'Google', value: attr.googleSpend, color: '#12b886' }].filter((x) => x.value > 0)
    : [{ name: 'Meta', value: attr.metaSpend, color: '#4f7cff' }, { name: 'Google', value: attr.googleSpend, color: '#12b886' }].filter((x) => x.value > 0)
  // Key Events funnel - user-chosen pipeline stages (Settings), else the
  // default leads → booked → shown → won. Cost per stage = spend ÷ reached.
  const keyEvents = loadKeyEvents(client.id)
  const scopePipes = pid !== 'all' ? pipesSrc.filter((x) => x.id === pid) : pipesSrc
  const rmap = reachedByStage(scopePipes)
  const keSel = keyEvents.filter((n) => rmap.m.has(n))
  const keTotal = Math.max(1, c.leads || rmap.total)
  const keRows = keSel.length
    ? keSel.map((n) => ({ stage: n, count: rmap.m.get(n) || 0 })).sort((a, b) => b.count - a.count)
    : [{ stage: 'Leads', count: c.leads }, { stage: 'Bookings', count: c.booked }, { stage: 'Shown', count: c.shown }, { stage: 'Won', count: c.won }]
  const keMax = Math.max(1, ...keRows.map((r) => r.count))
  const activeStages = pid !== 'all'
    ? (pipesSrc.find((x) => x.id === pid)?.stages || [])
    : (pipesSrc.length === 1 ? pipesSrc[0].stages : null)
  const stageMax = activeStages ? Math.max(1, ...activeStages.map((s) => s.count)) : 1
  const stageName = pid !== 'all' ? pipesSrc.find((x) => x.id === pid)?.name : (pipesSrc.length === 1 ? pipesSrc[0].name : null)
  const srcBadge = (s) => <span className="src-badge" style={{ background: s === 'Meta' ? '#4f7cff' : '#12b886' }}>{s === 'Meta' ? 'M' : 'G'}</span>
  return (
    <>
      <div className="c360-head">
        <div className="section-title" style={{ margin: 0 }}>Caalano360 <span className="sub">· blended paid + Caalano Systems · {rangeLabel(range)}{chan !== 'all' ? ` · ${chan === 'meta' ? 'Meta' : 'Google'} only` : ''}{uid !== 'all' ? ` · ${users.find((u) => u.id === uid)?.name || 'user'}` : ''}{pid !== 'all' ? ' · attributed spend' : ''}</span></div>
        <div className="c360-controls">
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
        </div>
      </div>
      <div className="scorecard">
        <Sc label={pid === 'all' ? 'Ad Spend' : 'Attributed Spend'} value={money(spend)} cur={spend} prev={pv ? pv.adSpend : null} />
        <Sc label="Total Leads" value={fmtNumber(c.leads)} cur={c.leads} prev={pc ? pc.leads : null} />
        <Sc label="Bookings Made" value={fmtNumber(c.booked)} cur={c.booked} prev={pc ? pc.booked : null} />
        <Sc label="Shown Bookings" value={fmtNumber(c.shown)} cur={c.shown} prev={pc ? pc.shown : null} />
        <Sc label="Won Clients" value={fmtNumber(c.won)} cur={c.won} prev={pc ? pc.won : null} />
        <Sc label="Revenue Closed" value={money(c.revenue)} cur={c.revenue} prev={pc ? pc.revenue : null} />
        <Sc label="Avg Deal Value" value={c.won ? money(c.avgValue) : '-'} cur={c.avgValue} prev={pc ? pc.avgValue : null} />
        <Sc label="Cost / Lead" value={spend && c.leads ? money(spend / c.leads) : '-'} cur={spend && c.leads ? spend / c.leads : null} prev={pv && pc && pc.leads ? pv.adSpend / pc.leads : null} goodWhenDown />
        <Sc label="Cost / Booked" value={spend && c.booked ? money(spend / c.booked) : '-'} cur={spend && c.booked ? spend / c.booked : null} prev={pv && pc && pc.booked ? pv.adSpend / pc.booked : null} goodWhenDown />
        <Sc label="Cost / Won" value={spend && c.won ? money(spend / c.won) : '-'} cur={spend && c.won ? spend / c.won : null} prev={pv && pc && pc.won ? pv.adSpend / pc.won : null} goodWhenDown />
        <Sc label="ROAS" value={spend ? `${roas.toFixed(2)}×` : '-'} cur={spend ? roas : null} prev={pv && pc && pv.adSpend ? pc.revenue / pv.adSpend : null} />
        <Sc label="Conversion Rate" value={fmtPct(rate(c.won, c.leads), 1)} cur={rate(c.won, c.leads)} prev={pc ? rate(pc.won, pc.leads) : null} />
      </div>
      {b.hasCrm && (() => {
        const adLeads = (p.metaLeads || 0) + (p.googleConv || 0)
        const crmLeads = b.crm.leads
        const variance = adLeads ? ((crmLeads - adLeads) / adLeads) * 100 : null
        const opps = attribData ? attribData.opps : null
        const attributed = attribData ? attribData.attributed : null
        const cov = opps ? (attributed / opps) * 100 : null
        const covCls = cov == null ? '' : cov >= 80 ? 'good' : cov >= 50 ? 'warn' : 'bad'
        const chMeta = channels ? (channels.meta?.totals?.leads || 0) : 0
        const chGoogle = channels ? (channels.google?.totals?.leads || 0) : 0
        const chOther = channels ? (channels.other?.totals?.leads || 0) : 0
        const totCh = chMeta + chGoogle + chOther || 1
        return (
          <div className="card th-card" style={{ marginTop: 14 }}>
            <div className="th-head">
              <h3>Tracking health &amp; lead reconciliation</h3>
              {cov != null && <span className={`th-cov ${covCls}`}>{cov.toFixed(0)}% of opportunities have a source tag</span>}
            </div>
            <div className="th-grid">
              <div className="th-stat"><div className="th-l">Ad-reported leads</div><div className="th-v">{fmtNumber(adLeads)}</div><div className="th-sub">Meta {fmtNumber(p.metaLeads || 0)} · Google {fmtNumber(p.googleConv || 0)}</div></div>
              <div className="th-stat"><div className="th-l">CRM opportunities</div><div className="th-v">{fmtNumber(crmLeads)}</div><div className="th-sub">created in {rangeLabel(range)}</div></div>
              <div className="th-stat"><div className="th-l">Variance</div><div className={`th-v ${variance == null ? '' : Math.abs(variance) <= 15 ? 'good' : Math.abs(variance) <= 35 ? 'warn' : 'bad'}`}>{variance == null ? '-' : `${variance > 0 ? '+' : ''}${variance.toFixed(0)}%`}</div><div className="th-sub">CRM vs ad-reported</div></div>
              <div className="th-stat"><div className="th-l">Tagged source split</div>
                {attribData ? <>
                  <div className="th-bar"><span style={{ width: `${(chMeta / totCh) * 100}%`, background: '#4f7cff' }} /><span style={{ width: `${(chGoogle / totCh) * 100}%`, background: '#12b886' }} /><span style={{ width: `${(chOther / totCh) * 100}%`, background: 'var(--faint)' }} /></div>
                  <div className="th-sub">Meta {fmtNumber(chMeta)} · Google {fmtNumber(chGoogle)} · Other/untagged {fmtNumber(chOther)}</div>
                </> : <div className="th-sub">Connect Caalano Systems for source tagging.</div>}
              </div>
            </div>
            <p className="caveat">Ad-reported leads are what Meta/Google count; CRM opportunities are what actually landed in Caalano Systems. A large gap usually means duplicate/again-counted ad conversions or leads not reaching the CRM. Source-tag coverage tells you how much of the Caalano360 channel split you can trust - low coverage means many opportunities arrived without a UTM.</p>
          </div>
        )
      })()}
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card"><h3>Key events</h3><p className="cap">{keSel.length ? 'Your key pipeline stages' : 'Default: leads → booked → shown → won'} · reached · % of leads · cost per stage</p>
          <div className="pfunnel pf4">
            <div className="pf-row pf-head"><span className="pf-stage">Stage</span><span className="pf-bar">Reached</span><span className="pf-num">% leads</span><span className="pf-num">Cost / stage</span></div>
            {keRows.map((s, i) => {
              const pct = (s.count / keTotal) * 100
              const hue = 210 + Math.round((i / Math.max(1, keRows.length - 1)) * -70)
              return (
                <div className="pf-row" key={s.stage}>
                  <span className="pf-stage" title={s.stage}>{s.stage}</span>
                  <span className="pf-bar"><span className="pf-fill" style={{ width: `${Math.max(4, (s.count / keMax) * 100)}%`, background: `hsl(${hue} 70% 55%)` }}>{fmtNumber(s.count)}</span></span>
                  <span className="pf-num">{fmtPct(pct, 1)}</span>
                  <span className="pf-num">{spend && s.count ? money(spend / s.count) : '-'}</span>
                </div>
              )
            })}
          </div>
          <p className="caveat">{keSel.length ? 'Key events are the pipeline stages you selected in Settings.' : 'Set a client’s key events in Settings to replace the default stages.'} Reached = opportunities that got to that stage or beyond. Cost / stage = attributed spend ({money(spend)}) ÷ reached.</p>
        </div>
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

function ClientWorkspace({ client, index, data, range, nonce, onBack }) {
  const [tab, setTab] = useState('overall')
  const [baked, setBaked] = useState(undefined)
  useEffect(() => { setBaked(undefined); fetch(`data/clients/${client.id}.json`).then((r) => (r.ok ? r.json() : null)).then(setBaked).catch(() => setBaked(null)) }, [client.id])
  const channel = tab === 'meta' ? 'meta' : tab === 'google' ? 'google' : tab === 'crm' ? 'crm' : tab === 'overall' ? 'blend' : null
  const live = useLiveDeep(client.id, channel, range, nonce)
  const attr = useAttribution(client.id, range, nonce)
  const tk = TRACK[client.trackingStatus] || TRACK.full
  const tabs = [{ id: 'overall', label: 'Caalano360' }, { id: 'crm', label: 'CRM' }, { id: 'meta', label: 'Meta Ads' }]
  if (client.google) tabs.push({ id: 'google', label: 'Google Ads' })
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
        <button className="back" onClick={onBack}>← All clients</button>
        <div className="cw-top">
          <span className="avatar" style={{ background: acolor(index) }}>{initials(client.name)}</span>
          <div><h2>{client.name} <span className={`tk ${tk.cls}`}>{tk.label}</span></h2><div className="meta">{client.industry}</div></div>
        </div>
        <div className="subtabs">{tabs.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        {tab === 'overall' && (live.status === 'loading' ? <div className="card"><Spinner label="Loading Caalano360…" /></div> : live.status === 'ok' && live.data && live.data.blend ? <Caalano360 blend={live.data.blend} client={client} currency={data.currency} range={range} nonce={nonce} utmAttr={attr} /> : <OverallTab client={client} currency={data.currency} side="cur" />)}
        {tab === 'crm' && (
          live.status === 'loading' ? <div className="card"><Spinner label="Loading Caalano Systems CRM…" /></div>
            : live.data && live.data.connected === false ? <div className="card empty-deep"><div className="big">🔌</div><b>Caalano Systems isn't connected yet.</b><p style={{ maxWidth: 480, margin: '8px auto 0' }}>Authorise the agency connection at <code>/.netlify/functions/caalano-connect</code> to unlock live CRM + UTM attribution.</p></div>
              : live.data && live.data.crm ? <CrmGhl crm={live.data.crm} currency={data.currency} clientId={client.id} />
                : live.data && live.data.error ? <div className="card empty-deep"><div className="big">⚠️</div><b>Couldn't load CRM for this client.</b><p style={{ maxWidth: 520, margin: '8px auto 0', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{live.data.error}</p><p style={{ maxWidth: 460, margin: '8px auto 0' }}>If this is a token / access error, the agency app may not have access to this sub-account. Try the audit endpoint <code>?scope=ghlaudit</code>.</p></div>
                  : <div className="card empty-deep"><div className="big">🗂️</div><b>No Caalano Systems data for this client in range.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>This client may not have a Caalano Systems sub-account mapped, or has no opportunities in the selected period.</p></div>
        )}
        {tab === 'meta' && (live.status === 'loading' ? <div className="card"><Spinner label="Loading live Meta data…" /></div> : <><LiveBadge mode={liveOK('meta') ? 'live' : (baked ? 'snapshot' : null)} label={presetLabel} /><MetaDeep deep={srcFor('meta')} currency={data.currency} attr={attr} clientId={client.id} /></>)}
        {tab === 'google' && (live.status === 'loading' ? <div className="card"><Spinner label="Loading live Google data…" /></div> : <><LiveBadge mode={liveOK('google') ? 'live' : (baked ? 'snapshot' : null)} label={presetLabel} /><GoogleDeep deep={srcFor('google')} currency={data.currency} attr={attr} clientId={client.id} /></>)}
      </div>
    </>
  )
}

/* ============ Settings ============ */
// Campaign → pipeline linker, per client. Fetches the client's campaigns +
// pipelines on expand and writes overrides to the shared localStorage map that
// Caalano360 reads for spend attribution.
function KpiEditor({ clientId }) {
  const [open, setOpen] = useState(false)
  const [k, setK] = useState(() => loadKpis(clientId))
  const [st, setSt] = useState({ status: 'idle', blend: null })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  const set = (patch) => setK((p) => { const nx = { ...p, ...patch }; saveKpis(clientId, nx); return nx })
  const setStage = (name, val) => setK((p) => { const stages = { ...(p.stages || {}) }; if (val === '') delete stages[name]; else stages[name] = Number(val); const nx = { ...p, stages }; saveKpis(clientId, nx); return nx })
  const pipes = (st.blend && st.blend.pipelines) || []
  const stageNames = [...new Set(pipes.flatMap((p) => (p.stages || []).map((s) => s.name)))]
  const numOr = (v) => (v == null || v === '' ? '' : v)
  return (
    <div className="linker">
      <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} KPI targets</button>
      {open && <div className="linker-body">
        <div className="kpi-inputs">
          <label>Meta cost / lead<input type="number" min="0" value={numOr(k.metaCpl)} onChange={(e) => set({ metaCpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Google cost / conv<input type="number" min="0" value={numOr(k.googleCostConv)} onChange={(e) => set({ googleCostConv: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
        </div>
        <div className="cap" style={{ marginTop: 4 }}>Weekly Traffic Light targets</div>
        <div className="kpi-inputs">
          <label>Weekly spend<input type="number" min="0" value={numOr(k.wkSpend)} onChange={(e) => set({ wkSpend: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ / week" /></label>
          <label>All-leads CPL<input type="number" min="0" value={numOr(k.cpl)} onChange={(e) => set({ cpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Cost / booked appt<input type="number" min="0" value={numOr(k.cpba)} onChange={(e) => set({ cpba: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Cost / won (CPA)<input type="number" min="0" value={numOr(k.cpa)} onChange={(e) => set({ cpa: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Booking rate %<input type="number" min="0" value={numOr(k.bookingRate)} onChange={(e) => set({ bookingRate: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="% target" /></label>
        </div>
        {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
          : stageNames.length ? <>
            <div className="cap" style={{ marginTop: 4 }}>Target leads at each pipeline stage</div>
            {stageNames.map((n) => <label className="kpi-stage" key={n}><span title={n}>{n}</span><input type="number" min="0" value={numOr(k.stages && k.stages[n])} onChange={(e) => setStage(n, e.target.value)} placeholder="-" /></label>)}
          </> : st.status === 'ok' ? <p className="cap">No Caalano Systems pipeline stages found.</p> : null}
      </div>}
    </div>
  )
}
function KeyEventsEditor({ clientId }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(() => loadKeyEvents(clientId))
  const [st, setSt] = useState({ status: 'idle', blend: null })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  const pipes = (st.blend && st.blend.pipelines) || []
  const withStages = pipes.filter((p) => (p.stages || []).length)
  const multi = withStages.length > 1
  const toggle = (n) => setSel((prev) => { const nx = prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]; saveKeyEvents(clientId, nx); return nx })
  return (
    <div className="linker">
      <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Key events{sel.length ? ` · ${sel.length}` : ''}</button>
      {open && <div className="linker-body">
        <p className="cap" style={{ marginTop: 0 }}>Pick the pipeline stages that count as key events for this client - they drive the Key Events funnel &amp; cost-per-stage in Caalano360. Leave empty for the default leads → booked → shown → won.{multi ? ' Stages are grouped by pipeline below.' : ''}</p>
        {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
          : withStages.length ? withStages.map((p) => (
            <div className="kev-group" key={p.id}>
              {multi && <div className="kev-pipe">{p.name}</div>}
              <div className="kev-list">{(p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => (
                <label className={`kev-item ${sel.includes(s.name) ? 'on' : ''}`} key={s.name}><input type="checkbox" checked={sel.includes(s.name)} onChange={() => toggle(s.name)} /><span title={s.name}>{s.name}</span></label>
              ))}</div>
            </div>
          ))
          : st.status === 'ok' ? <p className="cap">No Caalano Systems pipeline stages found.</p>
            : <p className="cap">Couldn’t load pipeline stages.</p>}
      </div>}
    </div>
  )
}
function CampaignLinker({ clientId }) {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [manual, setManual] = useState(() => loadCampMap(clientId))
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    fetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}`)
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
      <button className="linker-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Link campaigns to pipelines</button>
      {open && <div className="linker-body">
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
function Settings({ config, enabled, setEnabled, onClose }) {
  if (!config) return null
  const w = config.availableAccounts?.windsor || {}
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><h3>Settings</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          <div className="set-stats">
            <div className="set-stat"><div className="v">{config.clients.length}</div><div className="l">Clients</div></div>
            <div className="set-stat"><div className="v">{w.facebook ?? '-'}</div><div className="l">Meta accounts</div></div>
            <div className="set-stat"><div className="v">{w.google_ads ?? '-'}</div><div className="l">Google accounts</div></div>
            <div className="set-stat"><div className="v">{w.gohighlevel ?? '-'}</div><div className="l">Caalano Systems</div></div>
          </div>
          <div className="set-note">Toggle clients on or off, see their mapped accounts, and link each ad campaign to a Caalano Systems pipeline so paid spend attributes correctly in Caalano360. Changes persist in this browser.</div>
          {config.clients.map((c) => {
            const on = enabled[c.id] !== false
            const canLink = (c.meta || c.google) && c.ghl
            return (
              <div className={`set-client ${on ? '' : 'is-off'}`} key={c.id}>
                <div className="row1">
                  <div className="sc-id"><div className="nm">{c.name}</div><div className="ver">{c.industry || (c.deep ? 'Deep dashboards' : 'Summary only')}</div></div>
                  <div className={`toggle ${on ? 'on' : ''}`} onClick={() => setEnabled((s) => ({ ...s, [c.id]: s[c.id] === false ? true : false }))}><span className="knob" /></div>
                </div>
                <div className="ids">
                  <span className="idtag">Meta <b>{c.meta || '-'}</b></span>
                  <span className="idtag">Google <b>{c.google || '-'}</b></span>
                  <span className="idtag">Caalano Systems <b>{c.ghl || '-'}</b></span>
                </div>
                {canLink && <CampaignLinker clientId={c.id} />}
                {c.ghl && <KeyEventsEditor clientId={c.id} />}
                {(c.meta || c.google || c.ghl) && <KpiEditor clientId={c.id} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ============ Shell ============ */
export default function App() {
  const [data, setData] = useState(null)
  const [config, setConfig] = useState(null)
  const [err, setErr] = useState(null)
  const [view, setView] = useState('overview')
  const [picked, setPicked] = useState(null)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('caalano_theme') || 'dark' } catch { return 'dark' } })
  const [showSettings, setShowSettings] = useState(false)
  const [range, setRange] = useState(() => presetRange('last_30d'))
  const [enabled, setEnabled] = useState(() => { try { return JSON.parse(localStorage.getItem('caalano_enabled') || '{}') } catch { return {} } })
  const [refreshKey, setRefreshKey] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const agency = useAgencyLive(range, refreshKey)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('caalano_theme', theme) } catch {} }, [theme])
  useEffect(() => { try { localStorage.setItem('caalano_enabled', JSON.stringify(enabled)) } catch {} }, [enabled])
  useEffect(() => {
    fetch('data/snapshot.json').then((r) => { if (!r.ok) throw new Error('snapshot not found'); return r.json() }).then(setData).catch((e) => setErr(e.message))
    fetch('data/config.json').then((r) => r.ok ? r.json() : null).then(setConfig).catch(() => {})
  }, [])

  if (err) return <div className="main"><div className="card">Failed to load data: {err}</div></div>
  if (!data) return <div className="main"><div className="card">Loading dashboard…</div></div>

  const visibleClients = data.clients.filter((c) => enabled[c.id] !== false)
  const rows = computeRows(visibleClients, agency.data)
  const idx = picked ? data.clients.findIndex((c) => c.id === picked.id) : -1
  const go = (v) => { setView(v); setPicked(null); setNavOpen(false) }

  return (
    <div className="shell">
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}
      <aside className={`side ${navOpen ? 'open' : ''}`}>
        <div className="brand"><div className="logo logo-360"><span>360</span></div><div><h1 className="brand-name">Caalano<span className="b360">360</span></h1><p>360° Reporting</p></div><button className="side-close" onClick={() => setNavOpen(false)} aria-label="Close menu">✕</button></div>
        <nav className="nav">
          <button className={view === 'overview' ? 'active' : ''} onClick={() => go('overview')}><span className="ic">◎</span>Agency Overview</button>
          <button className={view === 'trends' ? 'active' : ''} onClick={() => go('trends')}><span className="ic">📈</span>Daily Performance</button>
          <button className={view === 'weekly' ? 'active' : ''} onClick={() => go('weekly')}><span className="ic">🚦</span>Weekly Traffic Light</button>
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button className="settings-btn" onClick={() => { setShowSettings(true); setNavOpen(false) }}><span className="ic">⚙</span>Settings</button>
          <button className="settings-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><span className="ic">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <div className="foot-note">Live data via the Meta and Google API - Meta, Google, Caalano Systems.</div>
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
            <h2>{view === 'overview' ? 'Agency Overview' : view === 'trends' ? 'Daily Performance' : view === 'weekly' ? 'Weekly Traffic Light' : 'Clients'}</h2>
            <p>{view === 'overview' ? 'Blended paid performance across all clients, live for the selected range.' : view === 'trends' ? 'Rolling 3 / 7 / 14 / 21 / 28-day performance per client, each vs the prior equal window.' : view === 'weekly' ? 'One client at a time, reported Monday-Sunday by ISO week - spend pacing, leads, appointments and wins vs KPI.' : 'Open any client for their Overall, CRM, Meta and Google workspace.'}</p>
          </div>
          <div className="spacer" />
          <DateRange range={range} onChange={setRange} busy={agency.status === 'loading'} />
          <button className="refresh-btn" title="Refresh live data" onClick={() => setRefreshKey((k) => k + 1)}><span className={agency.status === 'loading' ? 'spin sm' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh</button>
        </div>
        {view === 'overview' && <Overview rows={rows} currency={data.currency} periodLabel={rangeLabel(range)} live={agency.status === 'ok'} alerts={agency.data && agency.data.alerts} onPick={(c) => { setPicked(c); setView('clients') }} />}
        {view === 'trends' && <TrendsTab rows={rows} currency={data.currency} nonce={refreshKey} onPick={(c) => { setPicked(c); setView('clients') }} />}
        {view === 'weekly' && <WeeklyTab rows={rows} currency={data.currency} nonce={refreshKey} />}
        {view === 'clients' && picked && <ClientWorkspace client={picked} index={idx} data={data} range={range} nonce={refreshKey} onBack={() => { setPicked(null); setView('overview') }} />}
      </main>

      {showSettings && <Settings config={config} enabled={enabled} setEnabled={setEnabled} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
