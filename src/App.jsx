import React, { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  fmtCurrency, fmtNumber, fmtCompact, fmtPct, pctChange,
  clientTotals, agencyTotals,
} from './lib/format.js'

const AVATAR_COLORS = ['#6366f1', '#12b886', '#4f7cff', '#f59e0b', '#ec4899', '#8b5cf6', '#0ea5e9', '#ef4444']
const avatarColor = (i) => AVATAR_COLORS[i % AVATAR_COLORS.length]
const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function Delta({ cur, prev, goodWhenDown = false, suffix = '' }) {
  const pct = pctChange(cur, prev)
  const up = pct >= 0
  const good = goodWhenDown ? !up : up
  return (
    <span className={`delta ${good ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {fmtPct(Math.abs(pct))}{suffix}
      <span className="vs">vs prev</span>
    </span>
  )
}

function Kpi({ label, value, cur, prev, goodWhenDown }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />
    </div>
  )
}

function Overview({ data, onPick }) {
  const cur = data.currency
  const t = useMemo(() => agencyTotals(data.clients), [data])
  const split = [
    { name: 'Meta Ads', value: t.cur.metaSpend, color: 'var(--meta)' },
    { name: 'Google Ads', value: t.cur.googleSpend, color: 'var(--google)' },
  ]
  const byClient = useMemo(() =>
    data.clients.map((c, i) => ({
      name: c.name, spend: clientTotals(c).cur.spend, color: avatarColor(i),
    })).sort((a, b) => b.spend - a.spend), [data])

  return (
    <>
      <div className="grid cards">
        <Kpi label="Total Ad Spend" value={fmtCurrency(t.cur.spend, cur)} cur={t.cur.spend} prev={t.prev.spend} />
        <Kpi label="Leads & Conversions" value={fmtNumber(t.cur.conversions)} cur={t.cur.conversions} prev={t.prev.conversions} />
        <Kpi label="Blended Cost / Result" value={fmtCurrency(t.cur.cpl, cur)} cur={t.cur.cpl} prev={t.prev.cpl} goodWhenDown />
        <Kpi label="Impressions" value={fmtCompact(t.cur.impressions)} cur={t.cur.impressions} prev={t.prev.impressions} />
        <Kpi label="Clicks" value={fmtNumber(t.cur.clicks)} cur={t.cur.clicks} prev={t.prev.clicks} />
        <Kpi label="Blended CTR" value={fmtPct(t.cur.ctr, 2)} cur={t.cur.ctr} prev={t.prev.ctr} />
      </div>

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <div className="card chart-card">
          <h3>Spend by client</h3>
          <p className="cap">Combined Meta + Google, {data.period.label}</p>
          <ResponsiveContainer width="100%" height={Math.max(240, byClient.length * 46)}>
            <BarChart data={byClient} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tickFormatter={(v) => fmtCompact(v)} stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="name" width={130} stroke="var(--muted)" fontSize={12} />
              <Tooltip formatter={(v) => fmtCurrency(v, cur)} cursor={{ fill: 'var(--surface-2)' }} />
              <Bar dataKey="spend" radius={[0, 6, 6, 0]}>
                {byClient.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Channel split</h3>
          <p className="cap">Share of ad spend</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={split} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                <Cell fill="#4f7cff" />
                <Cell fill="#12b886" />
              </Pie>
              <Tooltip formatter={(v) => fmtCurrency(v, cur)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend" style={{ justifyContent: 'center' }}>
            <span><i className="swatch" style={{ background: '#4f7cff' }} /> Meta {fmtCurrency(t.cur.metaSpend, cur)}</span>
            <span><i className="swatch" style={{ background: '#12b886' }} /> Google {fmtCurrency(t.cur.googleSpend, cur)}</span>
          </div>
        </div>
      </div>

      <div className="section-title">Client leaderboard <span className="sub">· click a row to drill in</span></div>
      <ClientTable data={data} onPick={onPick} />

      <div className="note">
        <b>Data source.</b> Meta Ads &amp; Google Ads pulled live via <b>Reporting Ninja</b>; agency
        pipeline via <b>GoHighLevel / Caalano Systems</b>. Figures are {data.period.label} vs {data.compareLabel},
        attribution 1-day view / 7-day click. Snapshot refreshes on schedule — last updated {new Date(data.generatedAt).toLocaleDateString('en-AU')}.
      </div>
    </>
  )
}

function ClientTable({ data, onPick }) {
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const rows = useMemo(() => data.clients.map((c, i) => {
    const { cur, prev } = clientTotals(c)
    return {
      c, i,
      name: c.name, industry: c.industry,
      spend: cur.spend, conversions: cur.conversions, cpl: cur.cpl, ctr: cur.ctr,
      spendChange: pctChange(cur.spend, prev.spend),
      convChange: pctChange(cur.conversions, prev.conversions),
      hasMeta: !!c.meta, hasGoogle: !!c.google,
    }
  }), [data])
  const sorted = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir)
  const setKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
  const Th = ({ k, children }) => <th onClick={() => setKey(k)}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <Th k="name">Client</Th>
            <Th k="spend">Spend</Th>
            <Th k="conversions">Results</Th>
            <Th k="cpl">Cost / result</Th>
            <Th k="ctr">CTR</Th>
            <Th k="convChange">Results Δ</Th>
            <th>Channels</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.c.id} onClick={() => onPick(r.c)}>
              <td>
                <div className="client-cell">
                  <span className="avatar" style={{ background: avatarColor(r.i) }}>{initials(r.name)}</span>
                  <div>{r.name}<small>{r.industry}</small></div>
                </div>
              </td>
              <td>{fmtCurrency(r.spend, data.currency)}</td>
              <td>{fmtNumber(r.conversions)}</td>
              <td>{fmtCurrency(r.cpl, data.currency)}</td>
              <td>{fmtPct(r.ctr, 2)}</td>
              <td><span className={`chip ${r.convChange >= 0 ? 'up' : 'down'}`}>{r.convChange >= 0 ? '+' : ''}{fmtPct(r.convChange)}</span></td>
              <td>
                <div className="chan-tags">
                  {r.hasMeta && <span className="chan" style={{ background: '#4f7cff' }}>Meta</span>}
                  {r.hasGoogle && <span className="chan" style={{ background: '#12b886' }}>Google</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChannelCard({ title, color, badge, currency, metrics }) {
  return (
    <div className="card chan-card">
      <div className="head">
        <span className="chan-badge" style={{ background: color }}>{badge}</span>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      </div>
      {metrics.map((m) => (
        <div className="metric-row" key={m.label}>
          <span className="m">{m.label}</span>
          <span className="v">{m.value} {m.delta != null && (
            <span className={`chip ${m.deltaGood ? 'up' : 'down'}`} style={{ marginLeft: 6 }}>
              {m.delta >= 0 ? '+' : ''}{fmtPct(m.delta)}
            </span>
          )}</span>
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
        <span className="avatar" style={{ background: avatarColor(index) }}>{initials(client.name)}</span>
        <div>
          <h2>{client.name}</h2>
          <p>{client.industry} · combined spend {fmtCurrency(cur.spend, currency)} · {fmtNumber(cur.conversions)} results</p>
        </div>
      </div>

      <div className="grid cards">
        <Kpi label="Total Spend" value={fmtCurrency(cur.spend, currency)} cur={cur.spend} prev={prev.spend} />
        <Kpi label="Results" value={fmtNumber(cur.conversions)} cur={cur.conversions} prev={prev.conversions} />
        <Kpi label="Cost / Result" value={fmtCurrency(cur.cpl, currency)} cur={cur.cpl} prev={prev.cpl} goodWhenDown />
        <Kpi label="CTR" value={fmtPct(cur.ctr, 2)} cur={cur.ctr} prev={prev.ctr} />
      </div>

      <div className="grid two-col" style={{ marginTop: 16 }}>
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
    </>
  )
}

function AgencyPipeline({ ghl, currency }) {
  const max = Math.max(...ghl.stages.map((s) => s.count))
  return (
    <>
      <div className="card">
        <div className="stat-hero">
          <div className="s"><div className="v">{ghl.openOpportunities}</div><div className="l">Open opportunities</div></div>
          <div className="s"><div className="v">{fmtCurrency(ghl.openValue, currency)}</div><div className="l">Open pipeline value</div></div>
          <div className="s"><div className="v">{ghl.stages.length}</div><div className="l">Active stages</div></div>
        </div>
      </div>

      <div className="section-title">Pipeline by stage <span className="sub">· {ghl.pipelineName}</span></div>
      <div className="card">
        {ghl.stages.map((s) => (
          <div className="bar-row" key={s.name}>
            <span className="nm">{s.name}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(s.count / max) * 100}%` }} /></span>
            <span className="ct">{s.count}</span>
          </div>
        ))}
      </div>

      <div className="note">
        <b>Scope.</b> This is <b>{ghl.locationName}</b>'s own new-business pipeline, pulled live from
        GoHighLevel. The connector is currently authorised for a single sub-account. To surface
        <b> every client's</b> GHL pipeline agency-wide, add an agency-level (company) API token — the
        dashboard's data layer is already built to slot that in per client.
      </div>
    </>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('overview')
  const [picked, setPicked] = useState(null)
  const [theme, setTheme] = useState('dark')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => {
    fetch('data/snapshot.json')
      .then((r) => { if (!r.ok) throw new Error('snapshot not found'); return r.json() })
      .then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="app"><div className="card">Failed to load data: {err}</div></div>
  if (!data) return <div className="app"><div className="card">Loading dashboard…</div></div>

  const pickedIndex = picked ? data.clients.findIndex((c) => c.id === picked.id) : -1

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">C</div>
          <div>
            <h1>Caalano · Reporting Dashboard</h1>
            <p>Meta · Google · Caalano Systems (GoHighLevel)</p>
          </div>
        </div>
        <div className="spacer" />
        <span className="pill"><span className="dot" /> Live · {data.period.label}</span>
        <button className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => { setTab('overview'); setPicked(null) }}>Agency Overview</button>
        <button className={`tab ${tab === 'clients' ? 'active' : ''}`} onClick={() => { setTab('clients'); setPicked(null) }}>Clients</button>
        <button className={`tab ${tab === 'pipeline' ? 'active' : ''}`} onClick={() => { setTab('pipeline'); setPicked(null) }}>Agency Pipeline</button>
      </div>

      <div style={{ marginTop: 20 }}>
        {tab === 'overview' && <Overview data={data} onPick={(c) => { setPicked(c); setTab('clients') }} />}
        {tab === 'clients' && !picked && (
          <>
            <div className="section-title">All clients <span className="sub">· {data.clients.length} active · click to drill in</span></div>
            <ClientTable data={data} onPick={setPicked} />
          </>
        )}
        {tab === 'clients' && picked && (
          <ClientDetail client={picked} index={pickedIndex} currency={data.currency} onBack={() => setPicked(null)} />
        )}
        {tab === 'pipeline' && <AgencyPipeline ghl={data.ghl} currency={data.currency} />}
      </div>

      <div className="foot">
        Built for Caalano Digital · data via Reporting Ninja &amp; GoHighLevel · refreshed {new Date(data.generatedAt).toLocaleDateString('en-AU')}
      </div>
    </div>
  )
}
