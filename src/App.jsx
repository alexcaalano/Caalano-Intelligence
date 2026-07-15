import React, { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from 'recharts'
import {
  fmtCurrency, fmtNumber, fmtCompact, fmtPct, pctChange,
  clientTotals, agencyTotals,
} from './lib/format.js'

const AVATAR = ['#6d5efc', '#12b886', '#4f7cff', '#f5a524', '#ec4899', '#0ea5e9', '#f0435b', '#8b5cf6']
const acolor = (i) => AVATAR[i % AVATAR.length]
const initials = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const PHASE_COLOR = { contact: '#4f7cff', 'appt-set': '#6d5efc', 'at-risk': '#f0435b', held: '#12b886', proposal: '#f5a524', onboarding: '#0ea5e9' }

function Delta({ cur, prev, goodWhenDown = false }) {
  const pct = pctChange(cur, prev)
  const up = pct >= 0
  const good = goodWhenDown ? !up : up
  return <span className={`delta ${good ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {fmtPct(Math.abs(pct))}<span className="vs">vs {'prev'}</span></span>
}

function Kpi({ label, value, tag, cur, prev, goodWhenDown, flat }) {
  return (
    <div className="card kpi">
      <div className="top">
        <span className="label">{label}</span>
        {tag && <span className={`tag ${tag.toLowerCase()}`}>{tag}</span>}
      </div>
      <div className="value">{value}</div>
      {flat ? <span className="flat">{flat}</span> : <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />}
    </div>
  )
}

/* ---------- Overview ---------- */
function Overview({ data, onPick }) {
  const cur = data.currency
  const t = useMemo(() => agencyTotals(data.clients), [data])
  const g = data.ghl
  const byClient = useMemo(() => data.clients.map((c, i) => ({ name: c.name, spend: clientTotals(c).cur.spend, color: acolor(i) })).sort((a, b) => b.spend - a.spend), [data])

  return (
    <>
      <div className="section-title">Paid performance <span className="sub">· Meta + Google · {data.period.label} vs {data.compareLabel}</span></div>
      <div className="grid kpis">
        <Kpi label="Ad Spend" tag="ADS" value={fmtCurrency(t.cur.spend, cur)} cur={t.cur.spend} prev={t.prev.spend} />
        <Kpi label="Leads & Conversions" tag="ADS" value={fmtNumber(t.cur.conversions)} cur={t.cur.conversions} prev={t.prev.conversions} />
        <Kpi label="Blended Cost / Result" tag="ADS" value={fmtCurrency(t.cur.cpl, cur)} cur={t.cur.cpl} prev={t.prev.cpl} goodWhenDown />
        <Kpi label="Blended CTR" tag="ADS" value={fmtPct(t.cur.ctr, 2)} cur={t.cur.ctr} prev={t.prev.ctr} />
      </div>

      <div className="section-title">New-business pipeline <span className="sub">· GoHighLevel · {g.pipelineName} · tracked, not invoiced</span></div>
      <div className="grid kpis">
        <Kpi label="Open Pipeline" tag="CRM" value={fmtNumber(g.summary.open)} flat={`${fmtCurrency(g.summary.openValue, cur)} recorded value`} />
        <Kpi label="Won (tracked)" tag="CRM" value={fmtCurrency(g.summary.wonValue, cur)} flat={`${g.summary.won} deals · avg ${fmtCurrency(g.summary.avgWonValue, cur)}`} />
        <Kpi label="Close Rate" tag="CRM" value={fmtPct(g.summary.closedWinRatePct, 1)} flat={`${g.summary.won} won of ${g.summary.won + g.summary.lostTotal} closed`} />
        <Kpi label="Lost Deals" tag="CRM" value={fmtNumber(g.summary.lostTotal)} flat="see Pipeline Intelligence" />
      </div>

      <div className="card insight" style={{ marginTop: 14 }}>
        <span className="em">🔎</span>
        <div><h4>Biggest leak right now</h4><p>{g.biggestLeak}</p></div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card">
          <h3>Ad spend by client</h3>
          <p className="cap">Combined Meta + Google, {data.period.label}</p>
          <ResponsiveContainer width="100%" height={Math.max(230, byClient.length * 44)}>
            <BarChart data={byClient} layout="vertical" margin={{ left: 8, right: 18 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tickFormatter={fmtCompact} stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="name" width={132} stroke="var(--muted)" fontSize={12} />
              <Tooltip formatter={(v) => fmtCurrency(v, cur)} cursor={{ fill: 'var(--panel-2)' }} />
              <Bar dataKey="spend" radius={[0, 6, 6, 0]}>{byClient.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Channel split</h3>
          <p className="cap">Share of ad spend</p>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={[{ name: 'Meta', value: t.cur.metaSpend }, { name: 'Google', value: t.cur.googleSpend }]} dataKey="value" innerRadius={56} outerRadius={86} paddingAngle={2} stroke="none">
                <Cell fill="#4f7cff" /><Cell fill="#12b886" />
              </Pie>
              <Tooltip formatter={(v) => fmtCurrency(v, cur)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend">
            <span><i className="swatch" style={{ background: '#4f7cff' }} /> Meta {fmtCurrency(t.cur.metaSpend, cur)}</span>
            <span><i className="swatch" style={{ background: '#12b886' }} /> Google {fmtCurrency(t.cur.googleSpend, cur)}</span>
          </div>
        </div>
      </div>

      <div className="section-title">Client leaderboard <span className="sub">· click a row to drill in</span></div>
      <ClientTable data={data} onPick={onPick} />
      <p className="caveat">Ad figures are {data.period.label} vs {data.compareLabel}, Meta attribution 1-day view / 7-day click. Pipeline figures are all-time in the connected GoHighLevel sub-account and are CRM-tracked, not invoiced revenue.</p>
    </>
  )
}

function ClientTable({ data, onPick }) {
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const rows = useMemo(() => data.clients.map((c, i) => {
    const { cur, prev } = clientTotals(c)
    return { c, i, name: c.name, industry: c.industry, spend: cur.spend, conversions: cur.conversions, cpl: cur.cpl, ctr: cur.ctr, convChange: pctChange(cur.conversions, prev.conversions), hasMeta: !!c.meta, hasGoogle: !!c.google }
  }), [data])
  const sorted = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir)
  const setKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
  const Th = ({ k, children }) => <th onClick={() => setKey(k)}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <Th k="name">Client</Th><Th k="spend">Spend</Th><Th k="conversions">Results</Th>
          <Th k="cpl">Cost / result</Th><Th k="ctr">CTR</Th><Th k="convChange">Results Δ</Th><th>Channels</th>
        </tr></thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.c.id} onClick={() => onPick(r.c)}>
              <td><div className="client-cell"><span className="avatar" style={{ background: acolor(r.i) }}>{initials(r.name)}</span><div>{r.name}<small>{r.industry}</small></div></div></td>
              <td>{fmtCurrency(r.spend, data.currency)}</td>
              <td>{fmtNumber(r.conversions)}</td>
              <td>{fmtCurrency(r.cpl, data.currency)}</td>
              <td>{fmtPct(r.ctr, 2)}</td>
              <td><span className={`chip ${r.convChange >= 0 ? 'up' : 'down'}`}>{r.convChange >= 0 ? '+' : ''}{fmtPct(r.convChange)}</span></td>
              <td><div className="chan-tags">{r.hasMeta && <span className="chan" style={{ background: '#4f7cff' }}>Meta</span>}{r.hasGoogle && <span className="chan" style={{ background: '#12b886' }}>Google</span>}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChannelCard({ title, color, badge, currency, metrics }) {
  return (
    <div className="card">
      <div className="chead"><span className="chan-badge" style={{ background: color }}>{badge}</span><h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3></div>
      {metrics.map((m) => (
        <div className="metric-row" key={m.label}>
          <span className="m">{m.label}</span>
          <span className="v">{m.value}{m.delta != null && <span className={`chip ${m.deltaGood ? 'up' : 'down'}`} style={{ marginLeft: 6 }}>{m.delta >= 0 ? '+' : ''}{fmtPct(m.delta)}</span>}</span>
        </div>
      ))}
    </div>
  )
}

function ClientDetail({ client, currency, index, onBack }) {
  const { cur, prev } = clientTotals(client)
  const m = client.meta, g = client.google
  return (
    <>
      <button className="back" onClick={onBack}>← Back to all clients</button>
      <div className="detail-head">
        <span className="avatar" style={{ background: acolor(index) }}>{initials(client.name)}</span>
        <div><h2>{client.name}</h2><p>{client.industry} · combined spend {fmtCurrency(cur.spend, currency)} · {fmtNumber(cur.conversions)} results</p></div>
      </div>
      <div className="grid kpis">
        <Kpi label="Total Spend" value={fmtCurrency(cur.spend, currency)} cur={cur.spend} prev={prev.spend} />
        <Kpi label="Results" value={fmtNumber(cur.conversions)} cur={cur.conversions} prev={prev.conversions} />
        <Kpi label="Cost / Result" value={fmtCurrency(cur.cpl, currency)} cur={cur.cpl} prev={prev.cpl} goodWhenDown />
        <Kpi label="CTR" value={fmtPct(cur.ctr, 2)} cur={cur.ctr} prev={prev.ctr} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        {m ? (
          <ChannelCard title="Meta Ads" color="#4f7cff" badge="M" currency={currency} metrics={[
            { label: 'Amount spent', value: fmtCurrency(m.spend, currency), delta: pctChange(m.spend, m.prev.spend), deltaGood: m.spend >= m.prev.spend },
            { label: 'Leads', value: fmtNumber(m.leads), delta: pctChange(m.leads, m.prev.leads), deltaGood: m.leads >= m.prev.leads },
            { label: 'Cost per lead', value: fmtCurrency(m.leads ? m.spend / m.leads : 0, currency), delta: pctChange(m.spend / m.leads, m.prev.spend / m.prev.leads), deltaGood: (m.spend / m.leads) <= (m.prev.spend / m.prev.leads) },
            { label: 'Impressions', value: fmtNumber(m.impressions) },
            { label: 'Clicks', value: fmtNumber(m.clicks) },
            { label: 'CTR', value: fmtPct(m.impressions ? (m.clicks / m.impressions) * 100 : 0, 2) },
          ]} />
        ) : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Meta Ads this period.</p></div>}
        {g ? (
          <ChannelCard title="Google Ads" color="#12b886" badge="G" currency={currency} metrics={[
            { label: 'Cost', value: fmtCurrency(g.cost, currency), delta: pctChange(g.cost, g.prev.cost), deltaGood: g.cost >= g.prev.cost },
            { label: 'Conversions', value: fmtNumber(g.conversions), delta: pctChange(g.conversions, g.prev.conversions), deltaGood: g.conversions >= g.prev.conversions },
            { label: 'Cost per conv.', value: fmtCurrency(g.conversions ? g.cost / g.conversions : 0, currency), delta: pctChange(g.cost / g.conversions, g.prev.cost / g.prev.conversions), deltaGood: (g.cost / g.conversions) <= (g.prev.cost / g.prev.conversions) },
            { label: 'Impressions', value: fmtNumber(g.impressions) },
            { label: 'Clicks', value: fmtNumber(g.clicks) },
            { label: 'CTR', value: fmtPct(g.impressions ? (g.clicks / g.impressions) * 100 : 0, 2) },
          ]} />
        ) : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Google Ads this period.</p></div>}
      </div>
      <p className="caveat">Per-client CRM funnel, wins and lost reasons unlock when an agency-level GoHighLevel token is connected. Today this client shows live ad performance only.</p>
    </>
  )
}

/* ---------- Pipeline Intelligence ---------- */
function Pipeline({ ghl, currency }) {
  const fmax = Math.max(...ghl.funnel.map((s) => s.count))
  const lmax = Math.max(...ghl.lostReasons.map((s) => s.count))
  const won = ghl.wonByMonth.map((w) => ({ ...w, label: w.month.slice(2) }))
  const srcMax = Math.max(...ghl.sources.map((s) => s.won + s.open + s.lostSampled))
  return (
    <>
      <div className="card">
        <div className="stat-hero">
          <div className="s"><div className="v">{ghl.summary.open}</div><div className="l">Open opportunities</div></div>
          <div className="s"><div className="v">{fmtCurrency(ghl.summary.wonValue, currency)}</div><div className="l">Won value (tracked)</div></div>
          <div className="s"><div className="v">{fmtCurrency(ghl.summary.avgWonValue, currency)}</div><div className="l">Avg won deal</div></div>
          <div className="s"><div className="v">{fmtPct(ghl.summary.closedWinRatePct, 1)}</div><div className="l">Close rate</div></div>
          <div className="s"><div className="v">{ghl.summary.lostTotal}</div><div className="l">Lost deals</div></div>
        </div>
      </div>

      <div className="card insight" style={{ marginTop: 14 }}>
        <span className="em">🔎</span>
        <div><h4>Biggest leak</h4><p>{ghl.biggestLeak}</p></div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card">
          <h3>Open pipeline by phase</h3>
          <p className="cap">Where the {ghl.summary.open} live deals sit today</p>
          <div className="funnel">
            {ghl.funnel.map((s) => (
              <div className="fn" key={s.stage}>
                <span className="lab">{s.stage}</span>
                <span className="bar" style={{ width: `${Math.max(12, (s.count / fmax) * 100)}%`, background: PHASE_COLOR[s.phase] || 'var(--brand)' }}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card chart-card">
          <h3>Why deals are lost</h3>
          <p className="cap">Top reasons · sample of {ghl.summary.lostSampled} of {ghl.summary.lostTotal}</p>
          {ghl.lostReasons.slice(0, 8).map((r) => (
            <div className="bar-row" key={r.name}>
              <span className="nm">{r.name}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.count / lmax) * 100}%`, background: r.name.includes('Contact') || r.name.includes('No Show') || r.name.includes('Cancel') ? 'var(--neg)' : 'var(--warn)' }} /></span>
              <span className="ct">{r.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card">
          <h3>Wins over time</h3>
          <p className="cap">Deals marked won per month in this pipeline</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={won} margin={{ left: -18, right: 10, top: 6 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
              <Tooltip cursor={{ stroke: 'var(--border-2)' }} />
              <Line type="monotone" dataKey="count" stroke="#6d5efc" strokeWidth={2.5} dot={{ r: 3, fill: '#6d5efc' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Lead source performance</h3>
          <p className="cap">Won / open / lost by source</p>
          {ghl.sources.map((s) => {
            const total = s.won + s.open + s.lostSampled || 1
            return (
              <div className="bar-row" key={s.name} style={{ gridTemplateColumns: '170px 1fr 58px' }}>
                <span className="nm">{s.name}</span>
                <span className="bar-track" style={{ display: 'flex' }}>
                  <span style={{ width: `${(s.won / srcMax) * 100}%`, background: 'var(--pos)' }} />
                  <span style={{ width: `${(s.open / srcMax) * 100}%`, background: 'var(--brand)' }} />
                  <span style={{ width: `${(s.lostSampled / srcMax) * 100}%`, background: 'var(--neg)' }} />
                </span>
                <span className="ct" style={{ fontSize: 11 }}>{s.won}/{s.open}/{s.lostSampled}</span>
              </div>
            )
          })}
          <div className="legend" style={{ justifyContent: 'flex-start' }}>
            <span><i className="swatch" style={{ background: 'var(--pos)' }} /> Won</span>
            <span><i className="swatch" style={{ background: 'var(--brand)' }} /> Open</span>
            <span><i className="swatch" style={{ background: 'var(--neg)' }} /> Lost (sampled)</span>
          </div>
        </div>
      </div>

      <div className="section-title">Recommendations <span className="sub">· ranked by revenue leverage</span></div>
      <div className="card">
        <ol className="recs">
          {ghl.recommendations.map((r, i) => <li key={i}><span className="n">{i + 1}</span><span>{r}</span></li>)}
        </ol>
      </div>

      <div className="note">
        <b>Scope.</b> This is <b>{ghl.locationName}</b>'s own new-business pipeline, pulled live from GoHighLevel via MCP. The connector is authorised for a single sub-account, so these are the agency's own numbers. Connect an agency-level GoHighLevel token to unlock the same funnel, loss-reason and source analysis for every client. All values are CRM-tracked, not invoiced.
      </div>
    </>
  )
}

/* ---------- Shell ---------- */
const NAV = [
  { id: 'overview', label: 'Agency Overview', ic: '◎' },
  { id: 'clients', label: 'Clients', ic: '❑' },
  { id: 'pipeline', label: 'Pipeline Intelligence', ic: '⚑' },
]

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [view, setView] = useState('overview')
  const [picked, setPicked] = useState(null)
  const [theme, setTheme] = useState('dark')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { fetch('data/snapshot.json').then((r) => { if (!r.ok) throw new Error('snapshot not found'); return r.json() }).then(setData).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="main"><div className="card">Failed to load data: {err}</div></div>
  if (!data) return <div className="main"><div className="card">Loading dashboard…</div></div>
  const idx = picked ? data.clients.findIndex((c) => c.id === picked.id) : -1
  const go = (v) => { setView(v); setPicked(null) }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="logo">C</div>
          <div><h1>Caalano Digital</h1><p>Reporting Dashboard</p></div>
        </div>
        <nav className="nav">
          {NAV.map((n) => <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => go(n.id)}><span className="ic">{n.ic}</span>{n.label}</button>)}
        </nav>
        <div className="foot-note">Live data via Reporting Ninja (Meta, Google) and GoHighLevel. Refreshed {new Date(data.generatedAt).toLocaleDateString('en-AU')}.</div>
      </aside>

      <main className="main">
        <div className="head">
          <div>
            <h2>{view === 'overview' ? 'Agency Overview' : view === 'clients' ? (picked ? picked.name : 'Clients') : 'Pipeline Intelligence'}</h2>
            <p>{view === 'overview' ? 'Blended paid performance across active clients, plus the new-business pipeline.' : view === 'clients' ? 'Live Meta and Google performance per client. Click through for the channel breakdown.' : 'Live GoHighLevel funnel, win and loss analysis for the agency pipeline.'}</p>
          </div>
          <div className="spacer" />
          <span className="pill"><span className="dot" /> Live · {data.period.label}</span>
          <button className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </div>

        {view === 'overview' && <Overview data={data} onPick={(c) => { setPicked(c); setView('clients') }} />}
        {view === 'clients' && !picked && <ClientTable data={data} onPick={setPicked} />}
        {view === 'clients' && picked && <ClientDetail client={picked} index={idx} currency={data.currency} onBack={() => setPicked(null)} />}
        {view === 'pipeline' && <Pipeline ghl={data.ghl} currency={data.currency} />}
      </main>
    </div>
  )
}
