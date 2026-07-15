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
const TRACK = {
  full: { label: 'Full tracking', cls: 'tk-full' },
  wins_no_value: { label: 'Wins, no value', cls: 'tk-wins' },
  intelligence_only: { label: 'Intel only', cls: 'tk-intel' },
  no_outcome_tracking: { label: 'No tracking', cls: 'tk-none' },
}
const rate = (a, b) => (b ? (a / b) * 100 : 0)
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
      {flat ? <span className="flat">{flat}</span> : <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />}
    </div>
  )
}

/* ============ Overview ============ */
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
      <div className="section-title">New-business pipeline <span className="sub">· GoHighLevel · tracked, not invoiced</span></div>
      <div className="grid kpis">
        <Kpi label="Open Pipeline" tag="CRM" value={fmtNumber(g.summary.open)} flat={`${fmtCurrency(g.summary.openValue, cur)} recorded`} />
        <Kpi label="Won (tracked)" tag="CRM" value={fmtCurrency(g.summary.wonValue, cur)} flat={`${g.summary.won} deals · avg ${fmtCurrency(g.summary.avgWonValue, cur)}`} />
        <Kpi label="Close Rate" tag="CRM" value={fmtPct(g.summary.closedWinRatePct, 1)} flat={`${g.summary.won} of ${g.summary.won + g.summary.lostTotal} closed`} />
        <Kpi label="Lost Deals" tag="CRM" value={fmtNumber(g.summary.lostTotal)} flat="open a client → CRM" />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card chart-card">
          <h3>Ad spend by client</h3><p className="cap">Combined Meta + Google, {data.period.label}</p>
          <ResponsiveContainer width="100%" height={Math.max(230, byClient.length * 34)}>
            <BarChart data={byClient} layout="vertical" margin={{ left: 8, right: 18 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tickFormatter={fmtCompact} stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="name" width={130} stroke="var(--muted)" fontSize={11} />
              <Tooltip formatter={(v) => fmtCurrency(v, cur)} cursor={{ fill: 'var(--panel-2)' }} />
              <Bar dataKey="spend" radius={[0, 6, 6, 0]}>{byClient.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Channel split</h3><p className="cap">Share of ad spend</p>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart><Pie data={[{ name: 'Meta', value: t.cur.metaSpend }, { name: 'Google', value: t.cur.googleSpend }]} dataKey="value" innerRadius={56} outerRadius={86} paddingAngle={2} stroke="none"><Cell fill="#4f7cff" /><Cell fill="#12b886" /></Pie><Tooltip formatter={(v) => fmtCurrency(v, cur)} /></PieChart>
          </ResponsiveContainer>
          <div className="legend"><span><i className="swatch" style={{ background: '#4f7cff' }} /> Meta {fmtCurrency(t.cur.metaSpend, cur)}</span><span><i className="swatch" style={{ background: '#12b886' }} /> Google {fmtCurrency(t.cur.googleSpend, cur)}</span></div>
        </div>
      </div>
      <div className="section-title">Client leaderboard <span className="sub">· click a row to open the client workspace</span></div>
      <ClientTable data={data} onPick={onPick} />
    </>
  )
}

function ClientTable({ data, onPick }) {
  const [sort, setSort] = useState({ key: 'spend', dir: -1 })
  const rows = useMemo(() => data.clients.map((c, i) => {
    const { cur, prev } = clientTotals(c)
    return { c, i, name: c.name, industry: c.industry, track: c.trackingStatus, spend: cur.spend, conversions: cur.conversions, cpl: cur.cpl, ctr: cur.ctr, convChange: pctChange(cur.conversions, prev.conversions), hasMeta: !!c.meta, hasGoogle: !!c.google }
  }), [data])
  const sorted = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir)
  const setKey = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
  const Th = ({ k, children }) => <th onClick={() => setKey(k)}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  return (
    <div className="table-wrap"><table>
      <thead><tr><Th k="name">Client</Th><Th k="spend">Spend</Th><Th k="conversions">Results</Th><Th k="cpl">Cost / result</Th><Th k="ctr">CTR</Th><th>Tracking</th><th>Channels</th></tr></thead>
      <tbody>{sorted.map((r) => {
        const tk = TRACK[r.track] || TRACK.full; const has = r.conversions > 0
        return (
          <tr key={r.c.id} onClick={() => onPick(r.c)}>
            <td><div className="client-cell"><span className="avatar" style={{ background: acolor(r.i) }}>{initials(r.name)}</span><div>{r.name}<small>{r.industry}</small></div></div></td>
            <td>{fmtCurrency(r.spend, data.currency)}</td>
            <td>{has ? fmtNumber(r.conversions) : '—'}</td>
            <td>{has ? fmtCurrency(r.cpl, data.currency) : '—'}</td>
            <td>{fmtPct(r.ctr, 2)}</td>
            <td><span className={`tk ${tk.cls}`}>{tk.label}</span></td>
            <td><div className="chan-tags">{r.hasMeta && <span className="chan" style={{ background: '#4f7cff' }}>Meta</span>}{r.hasGoogle && <span className="chan" style={{ background: '#12b886' }}>Google</span>}</div></td>
          </tr>
        )
      })}</tbody>
    </table></div>
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
      <div className="note"><b>Scope.</b> This pipeline is the agency's own GoHighLevel HQ, pulled live via MCP. Per-client CRM (this client's own funnel) unlocks with an agency-level GoHighLevel token — the workspace is already built to swap it in.</div>
    </>
  )
}

/* ============ Meta deep ============ */
const qClass = (q) => q === 'ABOVE_AVERAGE' ? 'q-above' : q === 'AVERAGE' ? 'q-avg' : q === 'BELOW_AVERAGE' ? 'q-below' : 'q-unk'
function MetaDeep({ deep, currency }) {
  if (!deep?.meta) return <EmptyDeep channel="Meta Ads" />
  const m = deep.meta
  const tot = m.campaigns.reduce((a, c) => ({ spend: a.spend + c.spend, imp: a.imp + c.impressions, clk: a.clk + c.clicks, leads: a.leads + c.leads }), { spend: 0, imp: 0, clk: 0, leads: 0 })
  const avgCpl = tot.leads ? tot.spend / tot.leads : 0
  const ads = [...m.ads].sort((a, b) => b.spend - a.spend)
  const Row = ({ n, sp, im, ck, ld }) => (
    <tr><td>{n}</td><td>{fmtCurrency(sp, currency)}</td><td>{fmtNumber(im)}</td><td>{fmtPct(rate(ck, im), 2)}</td><td>{fmtNumber(ld)}</td><td>{ld ? fmtCurrency(sp / ld, currency) : '—'}</td></tr>
  )
  return (
    <>
      <div className="grid kpis">
        <Kpi label="Spend" value={fmtCurrency(tot.spend, currency)} flat={`${m.campaigns.length} campaigns`} />
        <Kpi label="Leads" value={fmtNumber(tot.leads)} flat={`${fmtCurrency(avgCpl, currency)} / lead`} />
        <Kpi label="Impressions" value={fmtCompact(tot.imp)} flat={`${fmtNumber(tot.clk)} clicks`} />
        <Kpi label="CTR" value={fmtPct(rate(tot.clk, tot.imp), 2)} flat="all clicks" />
      </div>
      <div className="lvl-title">Campaigns <span className="sub">· {m.campaigns.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>{[...m.campaigns].sort((a, b) => b.spend - a.spend).map((c) => <Row key={c.name} n={c.name} sp={c.spend} im={c.impressions} ck={c.clicks} ld={c.leads} />)}</tbody></table></div>
      <div className="lvl-title">Ad sets <span className="sub">· {m.adsets.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Ad set</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>{[...m.adsets].sort((a, b) => b.spend - a.spend).map((c) => <Row key={c.name} n={c.name} sp={c.spend} im={c.impressions} ck={c.clicks} ld={c.leads} />)}</tbody></table></div>
      <div className="lvl-title">Creatives <span className="sub">· top {ads.length} by spend · CPL vs account avg {fmtCurrency(avgCpl, currency)}</span></div>
      <div className="cre-grid">{ads.map((a) => {
        const cpl = a.leads ? a.spend / a.leads : 0
        const hook = a.type === 'Video' ? rate(a.videoViews, a.impressions) : null
        const cvr = rate(a.leads, a.linkClicks)
        return (
          <div className="cre" key={a.name}>
            <div className="thumb"><span className="type">{a.type}</span><img src={a.thumb} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} /></div>
            <div className="body">
              <div className="nm" title={a.name}>{a.name}</div>
              <div className="stats">
                <div className="st"><div className="l">Spend</div><div className="v">{fmtCurrency(a.spend, currency)}</div></div>
                <div className="st"><div className="l">CPL</div><div className={`v ${a.leads ? (cpl <= avgCpl ? 'good' : 'bad') : ''}`}>{a.leads ? fmtCurrency(cpl, currency) : '—'}</div></div>
                <div className="st"><div className="l">CTR</div><div className="v">{fmtPct(rate(a.clicks, a.impressions), 2)}</div></div>
                <div className="st"><div className="l">{hook != null ? 'Hook rate' : 'Lead rate'}</div><div className="v">{hook != null ? fmtPct(hook, 1) : fmtPct(cvr, 1)}</div></div>
              </div>
            </div>
          </div>
        )
      })}</div>
      <p className="caveat">Creative thumbnails come straight from Reporting Ninja (Meta CDN) and refresh with each data pull. Hook rate = 3-second video plays ÷ impressions.</p>
    </>
  )
}

/* ============ Google deep ============ */
const qsClass = (n) => n === '' || n == null ? 'q-unk' : n >= 7 ? 'q-above' : n >= 4 ? 'q-avg' : 'q-low'
function GoogleDeep({ deep, currency }) {
  if (!deep?.google) return <EmptyDeep channel="Google Ads" />
  const g = deep.google
  const tot = g.campaigns.reduce((a, c) => ({ cost: a.cost + c.cost, imp: a.imp + c.impressions, clk: a.clk + c.clicks, conv: a.conv + c.conversions }), { cost: 0, imp: 0, clk: 0, conv: 0 })
  const mtMax = Math.max(...g.matchTypes.map((x) => x.cost))
  const GRow = ({ n, st, co, im, ck, cv }) => (<tr><td>{n}{st && st !== 'Enabled' ? <span className="q-badge q-unk" style={{ marginLeft: 6 }}>{st}</span> : null}</td><td>{fmtCurrency(co, currency)}</td><td>{fmtNumber(im)}</td><td>{fmtPct(rate(ck, im), 2)}</td><td>{fmtNumber(cv)}</td><td>{cv ? fmtCurrency(co / cv, currency) : '—'}</td></tr>)
  return (
    <>
      <div className="grid kpis">
        <Kpi label="Cost" value={fmtCurrency(tot.cost, currency)} flat={`${g.campaigns.length} campaigns`} />
        <Kpi label="Conversions" value={fmtNumber(tot.conv)} flat={`${fmtCurrency(tot.conv ? tot.cost / tot.conv : 0, currency)} / conv`} />
        <Kpi label="Clicks" value={fmtNumber(tot.clk)} flat={`${fmtPct(rate(tot.clk, tot.imp), 2)} CTR`} />
        <Kpi label="Keywords" value={fmtNumber(g.keywordsTotal)} flat={`${fmtNumber(g.searchTermsTotal)} search terms`} />
      </div>
      <div className="lvl-title">Campaigns <span className="sub">· {g.campaigns.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Cost</th><th>Impr.</th><th>CTR</th><th>Conv.</th><th>Cost/conv</th></tr></thead>
        <tbody>{[...g.campaigns].sort((a, b) => b.cost - a.cost).map((c) => <GRow key={c.name} n={c.name} st={c.status} co={c.cost} im={c.impressions} ck={c.clicks} cv={c.conversions} />)}</tbody></table></div>
      <div className="lvl-title">Ad groups <span className="sub">· {g.adGroups.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>Ad group</th><th>Cost</th><th>Impr.</th><th>CTR</th><th>Conv.</th><th>Cost/conv</th></tr></thead>
        <tbody>{[...g.adGroups].sort((a, b) => b.cost - a.cost).map((c) => <GRow key={c.name} n={c.name} co={c.cost} im={c.impressions} ck={c.clicks} cv={c.conversions} />)}</tbody></table></div>
      <div className="grid two" style={{ marginTop: 4 }}>
        <div className="card chart-card"><h3>Spend by match type</h3><p className="cap">{g.matchTypeNote}</p>
          {g.matchTypes.map((x) => (<div className="bar-row" key={x.type} style={{ gridTemplateColumns: '90px 1fr 70px' }}><span className="nm">{x.type}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(x.cost / mtMax) * 100}%`, background: x.type === 'Broad' ? 'var(--warn)' : x.type === 'Phrase' ? 'var(--brand)' : 'var(--pos)' }} /></span><span className="ct" style={{ fontSize: 11 }}>{fmtCurrency(x.cost, currency)}</span></div>))}
          <p className="caveat">Broad match carries almost all spend. Watch the search-term report to catch waste before it compounds.</p>
        </div>
        <div className="card chart-card"><h3>Quality snapshot</h3><p className="cap">Historical quality score on top keywords</p>
          <div className="stat-hero" style={{ gap: 20 }}>
            <div className="s"><div className="v">{(g.keywords.filter(k => k.qs !== '' && k.qs != null).reduce((a, k) => a + k.qs, 0) / Math.max(1, g.keywords.filter(k => k.qs !== '' && k.qs != null).length)).toFixed(1)}</div><div className="l">Avg quality score</div></div>
            <div className="s"><div className="v">{g.keywords.filter(k => k.qs !== '' && k.qs <= 3).length}</div><div className="l">Low-QS keywords (≤3)</div></div>
          </div>
          <p className="caveat">Low quality scores (e.g. "psychiatrist melbourne" at QS 1) inflate CPCs — tighten ad-to-keyword relevance or pause.</p>
        </div>
      </div>
      <div className="lvl-title">Keywords <span className="sub">· top {g.keywords.length} of {g.keywordsTotal} by spend</span></div>
      <div className="table-wrap"><table><thead><tr><th>Keyword</th><th>Match</th><th>Cost</th><th>Clicks</th><th>Conv.</th><th>QS</th></tr></thead>
        <tbody>{[...g.keywords].sort((a, b) => b.cost - a.cost).map((k) => (<tr key={k.text}><td>{k.text}</td><td><span className="q-badge q-unk">{k.match}</span></td><td>{fmtCurrency(k.cost, currency)}</td><td>{fmtNumber(k.clicks)}</td><td>{fmtNumber(k.conversions)}</td><td><span className={`q-badge ${qsClass(k.qs)}`}>{k.qs === '' || k.qs == null ? '—' : k.qs}</span></td></tr>))}</tbody></table></div>
      <p className="caveat">Search-term analysis (which actual queries triggered ads, and where spend leaked) covers {fmtNumber(g.searchTermsTotal)} terms — the ranked view lands with the live API pull.</p>
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
        <Kpi label="Results" value={has ? fmtNumber(d.conversions) : '—'} cur={d.conversions} prev={other.conversions} flat={has ? null : 'outcomes not tracked'} />
        <Kpi label="Cost / Result" value={has ? fmtCurrency(d.cpl, currency) : '—'} cur={d.cpl} prev={other.cpl} goodWhenDown flat={has ? null : 'n/a'} />
        <Kpi label="CTR" value={fmtPct(d.ctr, 2)} cur={d.ctr} prev={other.ctr} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        {m ? <div className="card"><div className="chead"><span className="chan-badge" style={{ background: '#4f7cff' }}>M</span><h3 style={{ margin: 0, fontSize: 15 }}>Meta Ads</h3></div>
          {[['Amount spent', fmtCurrency(m.spend, currency)], ['Leads', fmtNumber(m.leads)], ['Cost per lead', m.leads ? fmtCurrency(m.spend / m.leads, currency) : '—'], ['Impressions', fmtNumber(m.impressions)], ['CTR', fmtPct(rate(m.clicks, m.impressions), 2)]].map(([l, v]) => <div className="metric-row" key={l}><span className="m">{l}</span><span className="v">{v}</span></div>)}
        </div> : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Meta Ads.</p></div>}
        {g ? <div className="card"><div className="chead"><span className="chan-badge" style={{ background: '#12b886' }}>G</span><h3 style={{ margin: 0, fontSize: 15 }}>Google Ads</h3></div>
          {[['Cost', fmtCurrency(g.cost, currency)], ['Conversions', fmtNumber(g.conversions)], ['Cost per conv.', g.conversions ? fmtCurrency(g.cost / g.conversions, currency) : '—'], ['Impressions', fmtNumber(g.impressions)], ['CTR', fmtPct(rate(g.clicks, g.impressions), 2)]].map(([l, v]) => <div className="metric-row" key={l}><span className="m">{l}</span><span className="v">{v}</span></div>)}
        </div> : <div className="card"><p className="cap" style={{ margin: 0 }}>No active Google Ads.</p></div>}
      </div>
    </>
  )
}

function ClientWorkspace({ client, index, data, onBack }) {
  const [tab, setTab] = useState('overall')
  const [period, setPeriod] = useState('jun')
  const [deep, setDeep] = useState(undefined)
  useEffect(() => {
    setDeep(undefined)
    fetch(`data/clients/${client.id}.json`).then((r) => r.ok ? r.json() : null).then(setDeep).catch(() => setDeep(null))
  }, [client.id])
  const side = period === 'jun' ? 'cur' : 'prev'
  const tk = TRACK[client.trackingStatus] || TRACK.full
  const tabs = [{ id: 'overall', label: 'Overall Business' }, { id: 'crm', label: 'CRM' }, { id: 'meta', label: 'Meta Ads' }]
  if (client.google) tabs.push({ id: 'google', label: 'Google Ads' })
  const deepReady = deep && (tab === 'meta' ? deep.meta : tab === 'google' ? deep.google : true)
  return (
    <>
      <div className="cw-head">
        <button className="back" onClick={onBack}>← All clients</button>
        <div className="cw-top">
          <span className="avatar" style={{ background: acolor(index) }}>{initials(client.name)}</span>
          <div><h2>{client.name} <span className={`tk ${tk.cls}`}>{tk.label}</span></h2><div className="meta">{client.industry}</div></div>
          <div className="date-sel"><label>Period</label><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="jun">June 2026</option><option value="may">May 2026</option></select></div>
        </div>
        <div className="subtabs">{tabs.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}{(t.id === 'meta' || t.id === 'google') && deep && !deep[t.id] ? <span className="lock">🔒</span> : null}</button>)}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        {(tab === 'meta' || tab === 'google') && period === 'may' && <div className="set-note">Deep breakdown was pulled for <b>June 2026</b>. Other date ranges populate live once the Reporting Ninja API backend is connected.</div>}
        {tab === 'overall' && <OverallTab client={client} currency={data.currency} side={side} />}
        {tab === 'crm' && <CrmTab ghl={data.ghl} currency={data.currency} />}
        {tab === 'meta' && (deep === undefined ? <div className="card">Loading…</div> : <MetaDeep deep={deep} currency={data.currency} />)}
        {tab === 'google' && (deep === undefined ? <div className="card">Loading…</div> : <GoogleDeep deep={deep} currency={data.currency} />)}
      </div>
    </>
  )
}

/* ============ Settings ============ */
function Settings({ config, enabled, setEnabled, onClose }) {
  if (!config) return null
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><h3>Settings · Clients & connections</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="m-body">
          <div className="set-note">Toggle clients on or off, and see which Meta / Google / CRM account each maps to. Changes persist in this browser now. With the live API backend, toggling a client on will trigger its data pull automatically, and new-client onboarding writes here.</div>
          <div className="set-note" style={{ background: 'rgba(245,165,36,.12)' }}>Reachable via MCP today — Meta: <b>{config.availableAccounts.meta.total}</b> accounts · Google: <b>{config.availableAccounts.google.total}</b> · GA4: <b>{config.availableAccounts.ga4.total}</b> · GoHighLevel: <b>{config.availableAccounts.ghl.agencyTokenConnected ? 'agency token' : 'HQ location only'}</b>.</div>
          {config.clients.map((c) => (
            <div className="set-client" key={c.id}>
              <div className="row1">
                <div><div className="nm">{c.name}</div><div className="ver">{c.deep ? 'Deep dashboards built' : 'Summary only'}</div></div>
                <div className={`toggle ${enabled[c.id] !== false ? 'on' : ''}`} onClick={() => setEnabled((s) => ({ ...s, [c.id]: s[c.id] === false ? true : false }))}><span className="knob" /></div>
              </div>
              <div className="ids">
                <span className="idtag">Meta <b>{c.meta || '—'}</b></span>
                <span className="idtag">Google <b>{c.google || '—'}</b></span>
                <span className="idtag">CRM <b>{c.ghl || 'agency token needed'}</b></span>
              </div>
            </div>
          ))}
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
  const [theme, setTheme] = useState('dark')
  const [showSettings, setShowSettings] = useState(false)
  const [enabled, setEnabled] = useState(() => { try { return JSON.parse(localStorage.getItem('caalano_enabled') || '{}') } catch { return {} } })

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { try { localStorage.setItem('caalano_enabled', JSON.stringify(enabled)) } catch {} }, [enabled])
  useEffect(() => {
    fetch('data/snapshot.json').then((r) => { if (!r.ok) throw new Error('snapshot not found'); return r.json() }).then(setData).catch((e) => setErr(e.message))
    fetch('data/config.json').then((r) => r.ok ? r.json() : null).then(setConfig).catch(() => {})
  }, [])

  if (err) return <div className="main"><div className="card">Failed to load data: {err}</div></div>
  if (!data) return <div className="main"><div className="card">Loading dashboard…</div></div>

  const visibleClients = data.clients.filter((c) => enabled[c.id] !== false)
  const dataView = { ...data, clients: visibleClients }
  const idx = picked ? data.clients.findIndex((c) => c.id === picked.id) : -1
  const go = (v) => { setView(v); setPicked(null) }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><div className="logo">C</div><div><h1>Caalano Digital</h1><p>Reporting Dashboard</p></div></div>
        <nav className="nav">
          <button className={view === 'overview' ? 'active' : ''} onClick={() => go('overview')}><span className="ic">◎</span>Agency Overview</button>
          <button className={view === 'clients' ? 'active' : ''} onClick={() => go('clients')}><span className="ic">❑</span>Clients</button>
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button className="settings-btn" onClick={() => setShowSettings(true)}><span className="ic">⚙</span>Settings</button>
          <button className="settings-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><span className="ic">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <div className="foot-note">Live via Reporting Ninja + GoHighLevel. Refreshed {new Date(data.generatedAt).toLocaleDateString('en-AU')}.</div>
        </div>
      </aside>

      <main className="main">
        {!picked && <div className="head">
          <div><h2>{view === 'overview' ? 'Agency Overview' : 'Clients'}</h2><p>{view === 'overview' ? 'Blended paid performance plus the new-business pipeline.' : 'Open any client for their Overall, CRM, Meta and Google workspace.'}</p></div>
          <div className="spacer" /><span className="pill"><span className="dot" /> Live · {data.period.label}</span>
        </div>}
        {view === 'overview' && <Overview data={dataView} onPick={(c) => { setPicked(c); setView('clients') }} />}
        {view === 'clients' && !picked && <ClientTable data={dataView} onPick={setPicked} />}
        {view === 'clients' && picked && <ClientWorkspace client={picked} index={idx} data={data} onBack={() => setPicked(null)} />}
      </main>

      {showSettings && <Settings config={config} enabled={enabled} setEnabled={setEnabled} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
