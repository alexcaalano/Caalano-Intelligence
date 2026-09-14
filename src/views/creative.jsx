// Creative Cockpit, Meta Insights and Client Update. Carved out of App.jsx so it loads on first open; the
// helpers it shares with the rest of the app are imported from there.
import React, { useEffect, useRef, useState } from 'react'
import { C360GrpRow, CC_ANGLES, CC_AUD_SUGGEST, CC_CTAS, CC_FORMATS, CC_STYLES, CURATOR_ENABLED, Caveat, CcChips, CcConceptCard, MdText, O360Head, PROFILE_FIELDS, PanScroll, SETTINGS, Sc, Spinner, aliasedOutcomeMap, buildO360Cols, ccBuild, ccFindA, ccFindC, ccFindF, groupAnswers, keyEventsForPipe, loadBoard, loadClientCtx, loadCreativeMeta, loadCreativeTax, loadInsights, loadKeyEvents, mergeLocations, o360Cells, o360Fields, pipeOfCampaign, profileFilled, profileText, rangeLabel, rangeQuery, readNavUrl, saveBoard, saveClientCtx, saveCreativeMeta, saveInsights, stagePosMap, unorm, useAttribution, useAuDb, useSettingsSync, writeNavUrl } from '../App.jsx'
import { fmtCurrency, fmtNumber } from '../lib/format.js'

export function CreativeCuratorPage({ clients }) {
  useSettingsSync()
  const [scope, setScope] = useState('research')
  const [clientId, setClientId] = useState(() => (clients[0] && clients[0].id) || null)
  const client = clients.find((c) => c.id === clientId) || null
  const boardKey = scope === 'client' && clientId ? `c:${clientId}` : 'research'
  const board = loadBoard(boardKey)
  const savedIds = new Set(board.map((b) => b.id))
  const [format, setFormat] = useState(null)
  const [styleId, setStyleId] = useState(null)
  const [cta, setCta] = useState(null)
  const [angle, setAngle] = useState(null)
  const [audience, setAudience] = useState('')
  const [concepts, setConcepts] = useState([])
  const [ai, setAi] = useState({ status: 'idle', text: null, error: null, at: null })
  const [libOpen, setLibOpen] = useState(false)
  const gen = () => setConcepts(ccBuild({ format, style: styleId, cta, audience, angle }, 6))
  const genAI = async () => {
    setAi({ status: 'loading', text: null, error: null, at: null })
    try {
      const sObj = CC_STYLES.find((s) => s.id === styleId)
      const payload = { mode: 'creative-curator', scope, clientName: client && scope === 'client' ? client.name : null, industry: (client && (client.industry || client.vertical)) || null,
        clientContext: scope === 'client' && clientId ? [profileText(clientId), loadClientCtx(clientId)].filter((s) => s && s.trim()).join('\n\n') : '',
        format: format ? ccFindF(format).label : null, style: sObj ? sObj.name : null, cta: cta ? ccFindC(cta).label : null, audience: audience.trim() || null, angle: angle ? ccFindA(angle).label : null,
        avoid: board.map((b) => `${b.styleName}: ${b.hook}`).slice(0, 12) }
      const r = await fetch('/.netlify/functions/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setAi({ status: 'ok', text: j.insights, error: null, at: j.generatedAt || new Date().toISOString() })
    } catch (e) { setAi({ status: 'err', text: null, error: String(e.message || e), at: null }) }
  }
  const save = (c) => { if (savedIds.has(c.id)) return; saveBoard(boardKey, [{ ...c, savedAt: Date.now() }, ...board]) }
  const removeSaved = (id) => saveBoard(boardKey, board.filter((b) => b.id !== id))
  return (
    <>
      <div className="lvl-title">Creative Curator <span className="sub">· strategise new creatives from Format × Style × CTA × Audience × Angle · {scope === 'client' && client ? client.name : 'general research'}</span></div>
      <div className="cc-modebar">
        <div className="chan-toggle sm">
          <button className={scope === 'research' ? 'on' : ''} onClick={() => setScope('research')}>🔎 Research</button>
          <button className={scope === 'client' ? 'on' : ''} onClick={() => setScope('client')}>🎯 Client deep-dive</button>
        </div>
        {scope === 'client' && <select className="cc-client-sel" value={clientId || ''} onChange={(e) => setClientId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <span className="cap">{scope === 'research' ? 'General ideas for a service / lead-gen business. Board saved under Research.'
          : clientId && profileFilled(clientId) ? `AI uses this client's brand profile (${profileFilled(clientId)}/${PROFILE_FIELDS.length} sections filled).`
            : 'Ideas are general until a brand profile is filled in for this client.'}</span>
      </div>
      <div className="card cc-builder">
        <div className="cc-row"><span className="cc-row-l">Format</span><CcChips options={CC_FORMATS} value={format} onChange={setFormat} /></div>
        <div className="cc-row"><span className="cc-row-l">Style</span><CcChips options={CC_STYLES} value={styleId} onChange={setStyleId} /></div>
        <div className="cc-row"><span className="cc-row-l">Call to action</span><CcChips options={CC_CTAS} value={cta} onChange={setCta} /></div>
        <div className="cc-row"><span className="cc-row-l">Angle</span><CcChips options={CC_ANGLES} value={angle} onChange={setAngle} /></div>
        <div className="cc-row"><span className="cc-row-l">Audience</span><div className="cc-aud"><input className="cc-aud-in" placeholder="e.g. Sydney homeowners with a tired old pool" value={audience} onChange={(e) => setAudience(e.target.value)} /><div className="cc-chips">{CC_AUD_SUGGEST.map((a) => <button key={a} className="cc-chip sm" onClick={() => setAudience(a)}>{a}</button>)}</div></div></div>
        <div className="cc-actions">
          <button className="cc-gen" onClick={gen}>✨ Generate ideas</button>
          <button className="cc-gen cc-gen-ai" onClick={genAI} disabled={ai.status === 'loading'}>{ai.status === 'loading' ? <><span className="spin sm" /> Thinking…</> : '🤖 Generate with AI'}</button>
          {(format || styleId || cta || angle || audience) && <button className="cc-clear" onClick={() => { setFormat(null); setStyleId(null); setCta(null); setAngle(null); setAudience('') }}>Clear</button>}
        </div>
      </div>
      {ai.status === 'err' && <div className="card"><p className="cap" style={{ margin: 0 }}>AI couldn’t generate this time: {ai.error}. The instant library still works - hit “Generate ideas”.</p></div>}
      {ai.status === 'ok' && ai.text && <div className="card cc-ai"><div className="cc-ai-h">🤖 AI concepts <span className="cap">· {scope === 'client' && client ? client.name : 'research'}</span></div><MdText text={ai.text} /></div>}
      {concepts.length > 0 && <>
        <div className="lvl-title" style={{ marginTop: 16 }}>Concepts <span className="sub">· from the library · click ☆ to save to your board</span></div>
        <div className="cc-grid">{concepts.map((c) => <CcConceptCard key={c.id} c={c} saved={savedIds.has(c.id)} onSave={save} />)}</div>
      </>}
      {concepts.length === 0 && ai.status === 'idle' && <div className="card cc-empty"><div className="big">🎨</div><b>Pick any mix of Format · Style · CTA · Angle · Audience</b><p style={{ maxWidth: 520, margin: '8px auto 0' }}>…then hit <b>Generate ideas</b> for instant concept briefs from the library, or <b>Generate with AI</b> for bespoke ones. Leave anything on “Any” to range wider. Star the good ones to build your board.</p></div>}
      <div className="lvl-title" style={{ marginTop: 18 }}>★ Saved board <span className="sub">· {scope === 'client' && client ? client.name : 'Research'} · {board.length} concept{board.length === 1 ? '' : 's'}</span></div>
      {board.length === 0 ? <div className="card"><p className="cap" style={{ margin: 0 }}>Nothing saved yet. Star concepts above to collect them here - the board is saved and shared with your team.</p></div>
        : <div className="cc-grid">{board.map((c) => <div className="cc-card cc-card-saved" key={c.id}>
            <div className="cc-card-h"><span className="cc-card-style">{c.emoji} {c.styleName}</span><button className="cc-star on" title="Remove from board" onClick={() => removeSaved(c.id)}>✕ Remove</button></div>
            <div className="cc-badges">{ccFindF(c.format) && <span className="cc-badge">{ccFindF(c.format).emoji} {ccFindF(c.format).label}</span>}{ccFindC(c.cta) && <span className="cc-badge cc-badge-cta">{ccFindC(c.cta).label}</span>}{ccFindA(c.angle) && <span className="cc-badge cc-badge-ang">{ccFindA(c.angle).label}</span>}{c.audience && <span className="cc-badge cc-badge-aud">{c.audience}</span>}</div>
            <div className="cc-hook"><span className="cc-lab">Hook</span>{c.hook}</div>
            <div className="cc-struct"><span className="cc-lab">Structure</span><ol>{(c.structure || []).map((b, i) => <li key={i}>{b}</li>)}</ol></div>
          </div>)}</div>}
      <div className="lvl-title" style={{ marginTop: 18 }}><button className="cc-liblink" onClick={() => setLibOpen((o) => !o)}>{libOpen ? '▾' : '▸'} Creative style library <span className="sub">· {CC_STYLES.length} researched styles · what they are & when to use them</span></button></div>
      {libOpen && <div className="cc-lib">{CC_STYLES.map((s) => <div className="cc-lib-item" key={s.id}>
        <div className="cc-lib-h">{s.emoji} <b>{s.name}</b></div>
        <p className="cc-lib-desc">{s.desc}</p>
        <p className="cc-lib-why">💡 {s.why}</p>
        <div className="cc-lib-meta"><span>Best formats: {s.formats.map((f) => ccFindF(f).label).join(', ')}</span><span>Pairs with: {s.ctas.map((c) => ccFindC(c).label).join(', ')}</span></div>
      </div>)}</div>}
    </>
  )
}

/* ============ Shell ============ */
/* ============ Creative Cockpit ============ */
// A hub for creative insight, performance and strategy: every Meta creative in
// one grid, with fillable categorisation columns (awareness stage, persona,
// angle, format, destination, CTA, copy) that save to the client and feed
// reusable dropdowns, joined to the real lead funnel behind each ad so we can
// see what's working and build more like it.
export const AWARENESS_OPTS = ['Unaware', 'Problem-aware', 'Solution-aware', 'Product-aware', 'Most-aware']
export const DEST_DEFAULTS = ['Landing page', 'Meta Lead Form', 'Schedule page', 'Caalano Systems landing', 'Website']

export function useCreatives(clientId, range, nonce = 0) {
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
export function useFatigue(clientId, range, nonce = 0) {
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
export function useAnomalies(clientId, range, nonce = 0) {
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
export function useFatigueWebhook(clientId, range, nonce = 0) {
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
export function FatigueBadge({ fat }) {
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
export function FatigueClientCard({ client, currency, range, nonce, onSummary }) {
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
                <td>{c.frequency != null ? `${c.frequency}x` : '-'}</td>
                <td>{c.ctrDrop != null ? <span className={c.ctrDrop > 0 ? 'fat-down' : 'fat-up'}>{c.ctrDrop > 0 ? '▼' : '▲'} {Math.abs(c.ctrDrop)}%</span> : '-'}</td>
                <td>{c.quality && c.quality !== 'UNKNOWN' ? titleCaseWord(c.quality) : '-'}</td>
              </tr>)}</tbody>
            </table></div>}
    </div>
  )
}
export const titleCaseWord = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function MetaFatiguePage({ clients, currency, range, nonce }) {
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
      <Caveat>A creative-fatigue proxy computed live from Meta delivery: frequency (impressions ÷ reach), CTR decline across the first vs second half of the window, and Meta’s quality ranking. Scored to <b>High 🔥</b> (refresh now), <b>Medium 👀</b> (watch) or ok. Thresholds are shared across clients and set in <b>Settings → Creative fatigue</b>. Not Meta’s official webhook signal (that needs a Meta App with App Review) - this is our best on-platform read of the same signals.</Caveat>
      <div className="fat-grid">{ordered.map((c) => <FatigueClientCard key={c.id} client={c} currency={currency} range={range} nonce={nonce} onSummary={onSummary} />)}</div>
    </>
  )
}

/* ============ Meta anomaly / delivery-health (agency-wide) ============ */
export const SEV_ICON = { high: '🔴', med: '🟠', good: '🟢' }
export function AnomalyClientCard({ client, currency, range, nonce, onSummary }) {
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
  const fmtCtr = (v) => v == null ? '-' : `${(v * 100).toFixed(2)}%`
  return (
    <div className="card fat-card">
      <div className="fat-card-h">
        <div className="fat-card-nm">{client.name}</div>
        {st.status === 'loading' ? <span className="cap">Checking…</span>
          /* A failed check returns a zeroed summary, which rendered a green
             "all steady" directly above the "Couldn't load." message below. */
          : st.status === 'err' || (d && d.error) ? <span className="al-count warn">not checked</span>
            : sum ? <div className="fat-counts">{sum.high ? <span className="fat-c fat-high">{sum.high} 🔴</span> : null}{sum.med ? <span className="fat-c fat-med">{sum.med} 🟠</span> : null}{sum.good ? <span className="fat-c fat-low">{sum.good} 🟢</span> : null}{!sum.high && !sum.med && !sum.good ? <span className="fat-c fat-low">all steady</span> : null}</div>
              : <span className="cap">No data</span>}
      </div>
      {st.status === 'loading' ? <Spinner label="" />
        : st.status === 'err' || d.meta === false ? <div className="cap">{d && d.meta === false ? 'No Meta account mapped.' : 'Couldn’t load.'}</div>
          : <>
            {m && <div className="anom-strip">
              <span>Spend <b>{money(m.cur.spend)}</b>{pctChip('spend')}</span>
              <span>Leads <b>{fmtNumber(m.cur.leads)}</b>{pctChip('leads')}</span>
              <span>CPL <b>{m.cur.cpl != null ? money(m.cur.cpl) : '-'}</b>{pctChip('cpl')}</span>
              <span>CTR <b>{fmtCtr(m.cur.ctr)}</b>{pctChip('ctr')}</span>
              <span>Freq <b>{m.cur.freq != null ? `${m.cur.freq.toFixed(1)}x` : '-'}</b>{pctChip('freq')}</span>
            </div>}
            {!alerts.length ? <div className="cap" style={{ marginTop: 8 }}>No anomalies in this window - delivery looks steady. ✅</div>
              : <div className="anom-list">{alerts.map((a, i) => <div key={i} className={`anom-row anom-${a.severity}`}>
                <span className="anom-ic">{SEV_ICON[a.severity]}</span>
                <span className="anom-txt"><b>{a.title}</b> - {a.detail}</span>
              </div>)}</div>}
            {d.zeroLeadAds && d.zeroLeadAds.length ? <div className="anom-ads">
              <div className="cap" style={{ marginBottom: 4 }}>Spending with no leads:</div>
              {d.zeroLeadAds.map((a, i) => <div key={i} className="anom-ad"><ThumbZoom src={a.thumb} /> <span className="cc-nm" title={a.name}>{a.name}</span> <span className="cap">· {money(a.spend)} · 0 leads</span></div>)}
            </div> : null}
          </>}
    </div>
  )
}
export function MetaAnomaliesPage({ clients, currency, range, nonce }) {
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
      <Caveat>Each active Meta client compared to the equal prior window: cost per lead, click-through rate, frequency, and spend-vs-leads movement, plus delivery stalls and any ad spending with zero leads. Computed live from Meta delivery data - no Meta App required. Clients needing attention float to the top.</Caveat>
      <div className="fat-grid">{ordered.map((c) => <AnomalyClientCard key={c.id} client={c} currency={currency} range={range} nonce={nonce} onSummary={onSummary} />)}</div>
    </>
  )
}

/* ====== Meta's own creative-fatigue verdicts (webhook-fed, agency-wide) ====== */
export function FatigueWebhookCard({ client, range, nonce, onStatus }) {
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
      {!creatives.length ? <div className="cap">Connected - waiting for Meta’s first fatigue event on this account.</div>
        : <div className="tbl-scroll"><table className="mini-tbl users-tbl cc-tbl">
          <thead><tr><th className="lft">Creative</th><th className="lft">Meta verdict</th><th className="lft">Updated</th></tr></thead>
          <tbody>{creatives.map((c) => <tr key={c.adId}>
            <td className="lft"><ThumbZoom src={c.thumb} /> <span className="cc-nm" title={c.name || c.adId}>{c.name || `Ad ${c.adId}`}</span></td>
            <td className="lft"><span className={`fat-badge ${c.level === 'High' ? 'fat-high' : c.level === 'Medium' ? 'fat-med' : ''}`}>{c.level === 'High' ? '🔥 High' : c.level === 'Medium' ? '👀 Medium' : `✅ ${c.level}`}</span></td>
            <td className="lft cap">{c.ts ? new Date(c.ts).toLocaleDateString('en-AU') : '-'}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
  )
}
// Live connection status: proves the receiver is wired up the moment any event
// (test or real) lands, even before accounts are mapped to clients.
export function WebhookStatusPanel({ nonce }) {
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
          <tbody>{d.events.map((e, i) => <tr key={i}><td className="lft cap">{e.ts ? new Date(e.ts).toLocaleString('en-AU') : '-'}</td><td className="lft">{e.client || e.acct || '-'}</td><td className="lft">{e.field || '-'}</td><td className="lft">{e.adId || '-'}</td><td className="lft">{e.level || '-'}</td></tr>)}</tbody>
        </table>
      </div> : null}
    </div>
  )
}
export function MetaFatigueWebhookPage({ clients, range, nonce }) {
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
        <p>This tab shows Meta’s <b>own</b> Low/Med/High creative-fatigue verdict - pushed by webhook, not computed. Once an ad account is <b>subscribed</b> (see the setup doc) and Meta detects fatigue on a live creative, its verdict appears here as a per-account card.</p>
        <p className="cap">Test events from Meta’s dashboard show in the receiver panel above (proving the pipe works) but won’t map to a client card - they carry a placeholder account id. Setup + subscription commands: <code>META-WEBHOOK-SETUP.md</code>. Meanwhile the <b>Creative fatigue · proxy</b> tab covers every client live.</p>
      </div>}
      {anyConnected && <Caveat>Meta’s official verdicts for the {connectedCount} account{connectedCount === 1 ? '' : 's'} that have sent events so far. A card appears once Meta pushes its first event for an account; verdicts fill in as creatives tire. Compare against the proxy tab, which explains the “why”.</Caveat>}
      <div className="fat-grid">{metaClients.map((c) => <FatigueWebhookCard key={c.id} client={c} range={range} nonce={nonce} onStatus={onStatus} />)}</div>
      {(() => {
        // Meta clients that have resolved but sent no events yet - surfaced so
        // subscribed-but-quiet accounts are visible rather than silently hidden.
        const awaiting = metaClients.filter((c) => status[c.id] && !status[c.id].connected)
        if (!awaiting.length) return null
        return <div className="card mi-await">
          <b>Awaiting Meta’s first event · {awaiting.length}</b>
          <p className="cap" style={{ margin: '4px 0 8px' }}>Set up, but Meta hasn’t pushed anything for these yet - they’ll move up as cards the moment it does (fatigue events are sparse and event-driven). If one never appears, re-check that its ad account is subscribed (<code>subscribed_apps</code>).</p>
          <div className="mi-await-list">{awaiting.map((c) => <span key={c.id} className="mi-await-chip">{c.name}</span>)}</div>
        </div>
      })()}
    </>
  )
}

/* ============ Meta ad recommendations (webhook-fed, agency-wide) ============ */
export function useRecommendations(nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=recommendations${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [nonce])
  return st
}
export function RecommendationsPage({ clients, nonce }) {
  const st = useRecommendations(nonce)
  const nameById = {}; for (const c of clients) nameById[c.id] = c.name
  const d = st.data
  const groups = (d && d.groups) || []
  return (
    <>
      <div className="lvl-title">Ad recommendations · Meta’s signal <span className="sub">· pushed by webhook</span></div>
      <Caveat>Meta’s own optimisation recommendations, delivered by webhook as they’re issued (the <code>ad_recommendations</code> field, per subscribed account). Each entry flags that Meta has a suggestion for an ad or account - open Ads Manager for the full write-up. Newest first.</Caveat>
      {st.status === 'loading' ? <div className="card"><Spinner label="Loading recommendations…" /></div>
        : !groups.length ? <div className="card empty-deep"><div className="big">💡</div><b>No recommendations received yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>They’ll appear here as Meta pushes them for your subscribed accounts. Make sure the <code>ad_recommendations</code> field is subscribed for each account.</p></div>
          : <div className="fat-grid">{groups.map((g, i) => (
            <div className="card fat-card" key={i}>
              <div className="fat-card-h"><div className="fat-card-nm">{nameById[g.client] || g.client || `Account ${g.acct}`}</div><span className="fat-c fat-low">{g.count} recommendation{g.count === 1 ? '' : 's'}</span></div>
              <div className="rec-list">{g.items.map((it, j) => (
                <div className="rec-row" key={j}>
                  <div className="rec-when cap">{it.ts ? new Date(it.ts).toLocaleString('en-AU') : '-'}</div>
                  <div className="rec-body">
                    {it.detail && it.detail.type ? <span className="rec-type">{it.detail.type}</span> : null}
                    {it.detail && it.detail.message ? <span className="rec-msg">{it.detail.message}</span> : <span className="cap">Meta flagged a recommendation{it.adId ? ` for ad ${it.adId}` : ''} - open Ads Manager for the detail.</span>}
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
export function useOpportunity(clientId, nonce = 0) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', data: null })
    fetch(`/.netlify/functions/windsor?scope=opportunity&client=${clientId}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).then((j) => { if (alive) setSt({ status: 'ok', data: j }) }).catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [clientId, nonce])
  return st
}
export function OpportunityCard({ client, nonce, onConfig }) {
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
        : !d.recommendations || !d.recommendations.length ? <div className="cap">No open recommendations - Meta considers this account well optimised. ✅</div>
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
export const prettyOppType = (t) => String(t || 'Recommendation').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
export function OpportunityPage({ clients, nonce }) {
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
        : <Caveat>Meta’s own 0–100 opportunity score per account, with its top recommendations ranked by expected <b>point lift</b>. Pulled live from the Graph API - higher means better aligned with Meta’s best practices. This is account-level, never per-campaign.</Caveat>}
      <div className="fat-grid">{metaClients.map((c) => <OpportunityCard key={c.id} client={c} nonce={nonce} onConfig={onConfig} />)}</div>
    </>
  )
}

/* ============ Meta Insights - hub for everything Meta-derived ============ */
// Sub-tabbed like the client workspace. Fatigue + Anomalies ship today (computed
// from Windsor data); the Meta-App-gated reads (opportunity score, benchmarks,
// recommendations, Ad Library) are listed as coming so the roadmap is visible.
export const META_INSIGHTS_TABS = [
  { id: 'anomalies', label: 'Delivery health', ready: true },
  { id: 'fatigue', label: 'Creative fatigue · proxy', ready: true },
  { id: 'fatigue-webhook', label: 'Creative fatigue · Meta', ready: true },
  { id: 'recommendations', label: 'Ad recommendations', ready: true },
  { id: 'opportunity', label: 'Opportunity score', ready: true },
  { id: 'benchmarks', label: 'Benchmarks', ready: false },
  { id: 'library', label: 'Ad Library', ready: false },
]
export function MetaInsightsPage({ clients, currency, range, nonce }) {
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
        <p style={{ maxWidth: 520, margin: '8px auto 0' }}>{tab === 'fatigue-webhook' ? 'Meta’s official creative-fatigue signal is push-only - it arrives via webhook, not a query. It needs a Meta App (System User token + App Review) that subscribes each client ad account. Once connected, Meta’s Low/Med/High verdict shows here beside our proxy read on the other tab.' : tab === 'benchmarks' ? 'Meta computes industry and auction benchmarks from cross-advertiser data we can’t replicate locally - this needs a Meta App with a System User token.' : tab === 'opportunity' ? 'The 0–100 opportunity score and Meta’s own recommendations are generated by Meta and require a direct Graph API connection (Meta App).' : 'Searching any advertiser’s live ads for inspiration needs the public Ad Library API, which requires a verified Meta App.'} Once the Meta App is set up, this tab lights up automatically.</p>
      </div>}
    </>
  )
}

export function CreativeCockpitPage({ clients, currency, range, nonce, authUser }) {
  const list = [...clients].sort((a, b) => a.name.localeCompare(b.name))
  // Seed the picked client from the URL (?c=) so a shared Cockpit link opens
  // straight on that client; fall back to the first client otherwise.
  const [selId, setSelId] = useState(() => {
    const c = readNavUrl().c
    return (c && list.some((x) => x.id === c)) ? c : (list[0] ? list[0].id : null)
  })
  const [sub, setSub] = useState('breakdown')
  const sel = list.find((c) => c.id === selId) || list[0]
  // Mirror the picked client into the URL (?c=) so the current selection is always
  // linkable - replace (not push) so it doesn't spam the browser history.
  const pickClient = (id) => { setSelId(id); writeNavUrl({ c: id }, false) }
  // Keep the URL in sync when the effective client falls back (e.g. deep-linked id
  // isn't in this user's list), so the link reflects what's actually shown.
  useEffect(() => { if (sel && sel.id !== readNavUrl().c) writeNavUrl({ c: sel.id }, false) }, [sel && sel.id])
  if (!list.length) return <div className="card empty-deep"><div className="big">🎬</div><b>No clients with a Meta account yet.</b></div>
  // Creative Curator is temporarily hidden (flip CURATOR_ENABLED back to true to
  // resurface its subtab). While off, the Cockpit shows only Creative Breakdown
  // with no subtab bar.
  const showCurator = CURATOR_ENABLED && sub === 'curator'
  return (
    <>
      {CURATOR_ENABLED && (
        <div className="subtabs">
          <button className={sub === 'breakdown' ? 'active' : ''} onClick={() => setSub('breakdown')}>Creative Breakdown</button>
          <button className={sub === 'curator' ? 'active' : ''} onClick={() => setSub('curator')}>Creative Curator</button>
        </div>
      )}
      {!showCurator ? <>
        <div className="c360-head" style={{ marginTop: 0 }}>
          <div className="pipe-sel"><label>Client</label>
            <select value={(sel && sel.id) || ''} onChange={(e) => pickClient(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
        </div>
        {sel ? <CreativeCockpit key={sel.id} client={sel} currency={currency} range={range} nonce={nonce} authUser={authUser} /> : null}
      </> : <CreativeCuratorPage clients={list} />}
    </>
  )
}

// A single reusable combobox: native input + datalist so you can pick a saved
// value or type a new one (which is then remembered for next time).
export function TagCombo({ value, onChange, options, listId, placeholder }) {
  return (
    <>
      <input className="cc-in" list={listId} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  )
}

export function CreativeCockpit({ client, currency, range, nonce }) {
  useSettingsSync()
  const st = useCreatives(client.id, range, nonce)
  // The CRM funnel behind each creative (green Caalano360 key-event columns) comes
  // from the attribution build (byCreative, joined by utm_content) - same source
  // the Meta Ads view + Monthly Report use, so the numbers line up across screens.
  const attr = useAttribution(client.id, range, nonce)
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

  // Green Caalano360 key-event columns behind each creative (booked / shown /
  // stage reach / won per the client's configured key events), joined to the ad by
  // utm_content - the same funnel the Meta Ads view + Monthly Report show. Computed
  // BEFORE the rows so each creative carries its per-event fields: the grid then
  // sorts by any green column, and the What's-working rollup totals each event.
  // Built from the attribution fetch (independent of the creatives load), so the
  // columns fill in a moment after the grid first paints; tag editing is unchanged.
  const hasCrm = d.hasCrm
  const A = attr && attr.data && attr.data.attribution
  const stagePos = A ? stagePosMap([...(A.allPipelines || []), ...((A.channels && A.channels.all && A.channels.all.pipelines) || [])]) : null
  const calNames = new Map(((A && A.appointments && A.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  // Each creative belongs to a pipeline (via its campaign → Settings link / name
  // match), so the green key-event columns - and the personas / angles that go with
  // them - are scoped PER PIPELINE. A multi-pipeline client is split into one
  // labelled section per pipeline, each with only that pipeline's creatives + key
  // events, so the columns line up (no duplicate "15 Minute Call" from two pipelines)
  // and the What's-working rollup only ranks personas that actually ran in it.
  const allPipes = (A && A.allPipelines) || []
  const rawKe = hasCrm ? loadKeyEvents(client.id) : []
  const _colsCache = {}
  const colsForPipe = (pid) => { const k = pid || '_all'; if (!(k in _colsCache)) _colsCache[k] = (hasCrm && A) ? buildO360Cols(keyEventsForPipe(rawKe, pid || 'all'), stagePos, calNames) : null; return _colsCache[k] }
  const oCre = (hasCrm && A) ? aliasedOutcomeMap(client.id, 'content', A.byCreative) : null
  const pipeOfCre = (c) => (allPipes.length ? pipeOfCampaign(client.id, c.campaign, allPipes) : null)
  const keLeft = hasCrm ? 10 : 8 // leading (non-green) grid column count, for the banner + expand colSpan

  // Attach saved tags + the per-creative key-event fields. Each creative's green
  // fields use ITS pipeline's key events (so a creative in Pipeline A never shows
  // counts under Pipeline B's events). Spread first so tag / perf fields always win.
  const rows = all.map((c) => {
    const t = tags[c.id] || {}
    const crm = c.crm || {}
    const fat = fatBy[c.name] || null
    const pid = pipeOfCre(c)
    const cols = colsForPipe(pid)
    const leads360 = crm.leads != null ? crm.leads : c.leads
    const f360 = cols ? o360Fields(oCre && oCre.get(unorm(c.name)), c.spend, leads360, cols) : null
    return { ...c, ...(f360 || {}), _pid: pid, t, fat, fatLevel: fat ? fat.level : null, fatScore: fat ? fat.score : -1, aware: t.aware || '', persona: t.persona || '', angle: t.angle || '', dest: t.dest || c.autoDest || '', cta: t.cta || c.autoCta || '', copy: t.copy || c.autoCopy || '', notes: t.notes || '', ql: crm.qualified || 0, bk: crm.booked || 0, wn: crm.won || 0, rev: crm.revenue || 0, cpq: crm.costPerQualified, cpb: crm.costPerBooked, cpw: crm.costPerWon }
  })
  const setKey = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))
  const Th = ({ k, children, l }) => <th className={l ? 'lft' : 'num'} onClick={() => setKey(k)} style={{ cursor: 'pointer' }}>{children}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>
  const tot = rows.reduce((a, c) => ({ spend: a.spend + c.spend, leads: a.leads + (c.crm ? c.crm.leads : c.leads), bk: a.bk + c.bk, tagged: a.tagged + (c.aware || c.persona || c.angle ? 1 : 0) }), { spend: 0, leads: 0, bk: 0, tagged: 0 })

  // "What's working" - rank the chosen dimension's values by cost per booked call,
  // totalling each key event (count) + cost per event. Parameterised by a row subset
  // + that subset's pipeline columns, so each pipeline section rolls up on its own.
  const dimFn = { aware: (c) => c.aware, persona: (c) => c.persona, angle: (c) => c.angle, format: (c) => c.format, dest: (c) => c.dest }[dim]
  const buildRollup = (rowsIn, cols, fn) => {
    const evFirstCols = cols ? cols.cols.filter((c) => c.gfirst) : []
    const m = new Map()
    for (const c of rowsIn) {
      const k = fn(c); if (!k) continue
      const e = m.get(k) || { key: k, n: 0, spend: 0, leads: 0, bk: 0, wn: 0, ev: evFirstCols.map(() => 0) }
      e.n++; e.spend += c.spend; e.leads += (c.crm ? c.crm.leads : c.leads); e.bk += c.bk; e.wn += c.wn
      evFirstCols.forEach((col, i) => { e.ev[i] += (col ? (c[col.key] || 0) : 0) })
      m.set(k, e)
    }
    return [...m.values()].map((e) => ({ ...e, cpb: e.bk ? Math.round(e.spend / e.bk) : null, evCost: e.ev.map((v) => (v ? Math.round(e.spend / v) : null)) })).sort((a, b) => (a.cpb == null ? 1 : b.cpb == null ? -1 : a.cpb - b.cpb))
  }
  // Split into labelled per-pipeline sections when the client runs more than one
  // pipeline AND the creatives actually span 2+ of them; otherwise one flat section.
  const pipeGroups = (() => {
    if (!hasCrm || allPipes.length < 2) return [{ pid: null, name: null, cols: colsForPipe('all'), rows }]
    const by = new Map()
    for (const c of rows) { const k = c._pid || '__none__'; if (!by.has(k)) by.set(k, []); by.get(k).push(c) }
    const named = allPipes.filter((p) => by.has(p.id)).map((p) => ({ pid: p.id, name: p.name, cols: colsForPipe(p.id), rows: by.get(p.id) }))
    const none = by.get('__none__')
    if (none && none.length) named.push({ pid: null, name: 'Unattributed (no pipeline link)', cols: colsForPipe('all'), rows: none })
    return named.length >= 2 ? named : [{ pid: null, name: null, cols: colsForPipe('all'), rows }]
  })()

  // AI creative strategy over the tagged + performance set.
  const rollupBy = (fn) => buildRollup(rows, colsForPipe('all'), fn)
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
      <div className="lvl-title">Creative Breakdown <span className="sub">· {client.name} · {rangeLabel(range)} · {fmtNumber(all.length)} creatives{hasCrm ? '' : ' · no CRM mapped (paid metrics only)'}</span></div>
      <div className="scorecard">
        <Sc label="Creatives" value={fmtNumber(all.length)} />
        <Sc label="Ad spend" value={money(tot.spend)} />
        <Sc label="Leads" value={fmtNumber(tot.leads)} />
        {hasCrm && <Sc label="Booked calls" value={fmtNumber(tot.bk)} />}
        {fatSum && (fatSum.high + fatSum.medium) > 0 && <Sc label="Fatiguing" value={`${fmtNumber(fatSum.high)} 🔥 · ${fmtNumber(fatSum.medium)} 👀`} />}
        <Sc label="Tagged" value={`${fmtNumber(tot.tagged)} / ${fmtNumber(all.length)}`} />
      </div>

      {pipeGroups.length > 1 && <p className="cap" style={{ marginTop: -4 }}>Split by pipeline - each section shows only that pipeline's creatives and its own key events, so the personas / angles and green columns line up.</p>}

      {/* Global filters - apply across every pipeline section. */}
      <div className="cc-filters">
        <input className="cc-search" placeholder="Search creative name…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <select value={f.format} onChange={(e) => set({ format: e.target.value })}><option value="">All formats</option><option>Image</option><option>Video</option></select>
        <select value={f.aware} onChange={(e) => set({ aware: e.target.value })}><option value="">All awareness</option>{AWARENESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.persona} onChange={(e) => set({ persona: e.target.value })}><option value="">All personas</option>{personaOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.angle} onChange={(e) => set({ angle: e.target.value })}><option value="">All angles</option>{angleOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.dest} onChange={(e) => set({ dest: e.target.value })}><option value="">All destinations</option>{destOpts.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.fat} onChange={(e) => set({ fat: e.target.value })}><option value="">All fatigue</option><option value="High">🔥 Fatiguing</option><option value="Medium">👀 Watch</option><option value="Low">✅ OK</option><option value="None">- No signal</option></select>
        {(f.aware || f.persona || f.angle || f.format || f.dest || f.fat || f.q) ? <button className="link-btn sm" onClick={() => setF({ aware: '', persona: '', angle: '', format: '', dest: '', fat: '', q: '' })}>Clear</button> : null}
      </div>

      {/* One section per pipeline (multi-pipeline clients) or a single flat section. */}
      {pipeGroups.map((g) => {
        const cols = g.cols
        const rollup = buildRollup(g.rows, cols, dimFn)
        const gFiltered = g.rows.filter((c) => (!f.aware || c.aware === f.aware) && (!f.persona || c.persona === f.persona) && (!f.angle || c.angle === f.angle) && (!f.format || c.format === f.format) && (!f.dest || c.dest === f.dest) && (!f.fat || (f.fat === 'None' ? !c.fat : c.fatLevel === f.fat)) && (!f.q || (c.name || '').toLowerCase().includes(f.q.toLowerCase())))
        const gSorted = [...gFiltered].sort((a, b) => { const av = a[sort.key], bv = b[sort.key]; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return typeof av === 'string' ? String(av).localeCompare(String(bv)) * sort.dir : (av - bv) * sort.dir })
        return (
          <React.Fragment key={g.pid || 'all'}>
            {g.name && <div className="lvl-title cc-pipe-lab" style={{ marginTop: 20 }}><span className="c360-dot" /> {g.name} <span className="sub">· {fmtNumber(g.rows.length)} creative{g.rows.length === 1 ? '' : 's'} · {money(g.rows.reduce((s, c) => s + c.spend, 0))}{g.rows.reduce((s, c) => s + c.bk, 0) ? ` · ${fmtNumber(g.rows.reduce((s, c) => s + c.bk, 0))} booked` : ''}</span></div>}

            {/* What's working - dimension rollup ranked by cost per booked call */}
            <div className="card cc-work">
              <div className="cc-work-h">What’s working <span className="sub">· ranked by cost / booked call · by</span>
                <div className="chan-toggle cc-dim">{[['aware', 'Awareness'], ['persona', 'Persona'], ['angle', 'Angle'], ['format', 'Format'], ['dest', 'Destination']].map(([k, l]) => <button key={k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>{l}</button>)}</div>
              </div>
              {rollup.length ? <PanScroll><table className="mini-tbl users-tbl">
                <thead>
                  {cols && <tr className="c360-grp-row"><th className="c360-grp-blank" colSpan={7} aria-hidden="true" />{cols.groups.map((gg, i) => <th key={i} className={`c360-grp${i > 0 ? ' c360-grp-sep' : ''}`} colSpan={2} title={gg.label}>{gg.label}</th>)}</tr>}
                  <tr><th className="lft">{dim === 'aware' ? 'Awareness' : dim === 'dest' ? 'Destination' : dim.charAt(0).toUpperCase() + dim.slice(1)}</th><th>Creatives</th><th>Spend</th><th>Leads</th>{hasCrm && <th>Booked</th>}{hasCrm && <th>Cost / book</th>}{hasCrm && <th>Won</th>}{cols && cols.groups.map((gg, i) => <React.Fragment key={i}><th className={`c360-col${i === 0 ? ' c360-gfirst' : ''}`} title={`${gg.label} - count`}>Count</th><th className="c360-col" title={`Spend ÷ ${gg.label}`}>Cost</th></React.Fragment>)}</tr>
                </thead>
                <tbody>{rollup.map((e) => <tr key={e.key}><td className="lft">{e.key}</td><td>{fmtNumber(e.n)}</td><td>{money(e.spend)}</td><td>{fmtNumber(e.leads)}</td>{hasCrm && <td>{fmtNumber(e.bk)}</td>}{hasCrm && <td>{e.cpb != null ? money(e.cpb) : '-'}</td>}{hasCrm && <td>{fmtNumber(e.wn)}</td>}{cols && e.ev.map((v, i) => <React.Fragment key={i}><td className={`c360-col${i === 0 ? ' c360-gfirst' : ''}`}>{fmtNumber(v)}</td><td className="c360-col">{e.evCost[i] != null ? money(e.evCost[i]) : '-'}</td></React.Fragment>)}</tr>)}</tbody>
              </table></PanScroll> : <div className="cap">Tag your creatives’ {dim === 'aware' ? 'awareness stage' : dim} to see which performs best.</div>}
            </div>

            {/* Creative grid */}
            <PanScroll className="cc-grid-wrap"><table className="mini-tbl users-tbl cc-tbl">
              <thead>
                {cols && <C360GrpRow left={keLeft} cols={cols} />}
                <tr>
                  <Th k="name" l>Creative</Th><Th k="format" l>Format</Th>
                  <th className="lft">Awareness</th><th className="lft">Persona</th><th className="lft">Angle</th><Th k="fatScore" l>Fatigue</Th>
                  <Th k="spend">Spend</Th><Th k="leads">Leads</Th>{hasCrm && <Th k="bk">Booked</Th>}{hasCrm && <Th k="cpb">Cost/book</Th>}
                  {cols && <O360Head sort={sort} on={setKey} cols={cols} />}
                </tr>
              </thead>
              <tbody>{gSorted.map((c) => <CreativeRow key={c.id} c={c} clientId={client.id} money={money} hasCrm={hasCrm} personaOpts={personaOpts} angleOpts={angleOpts} destOpts={destOpts} o360cols={cols} currency={currency} open={open.has(c.id)} onToggle={() => setOpen((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />)}</tbody>
            </table></PanScroll>
          </React.Fragment>
        )
      })}
      <Caveat>Every Meta creative in this period, with the real funnel behind it (leads → qualified) joined by <code>utm_content</code>. Format is auto-detected; tag awareness / persona / angle / destination / CTA / copy per creative - values save to {client.name} and feed the dropdowns next time. Click a row to edit its tags and open the ad.{pipeGroups.length > 1 ? ' A creative is placed in the pipeline its campaign is linked to (Settings → link a campaign to a pipeline to move it).' : ''}</Caveat>
      {d.unmatched && d.unmatched.length ? <p className="cap">{d.unmatched.length} CRM lead source{d.unmatched.length === 1 ? '' : 's'} (utm_content) didn’t match a live ad - likely paused or renamed creatives.</p> : null}
    </>
  )
}

// One creative: a scannable row (thumb, name, format, current tags, performance,
// and - when the client has key events configured - the green Caalano360 funnel
// columns behind this ad) that expands to the full tag editor + ad preview link.
export function CreativeRow({ c, clientId, money, hasCrm, personaOpts, angleOpts, destOpts, o360cols, currency, open, onToggle }) {
  const save = (patch) => saveCreativeMeta(clientId, c.id, patch)
  const chip = (v) => v ? <span className="cc-chip">{v}</span> : <span className="cc-none">-</span>
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
  // The per-creative key-event fields are already merged onto `c` (in the parent's
  // rows map, so the grid can sort by them), so the green cells read straight off c.
  return (
    <React.Fragment>
      <tr className={open ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="lft"><span className="u-chev">{open ? '▾' : '▸'}</span> {c.thumb ? <img className="cc-thumb" src={c.thumb} alt="" loading="lazy" /> : <span className="cc-thumb cc-thumb-none" />}<span className="cc-nm" title={c.name}>{c.name}<span className="cap"> · {c.adset || c.campaign}</span></span></td>
        <td className="lft"><span className={`cc-fmt ${c.format === 'Video' ? 'vid' : 'img'}`}>{c.format}</span></td>
        <td className="lft">{chip(c.aware)}</td>
        <td className="lft">{chip(c.persona)}</td>
        <td className="lft">{chip(c.angle)}</td>
        <td className="lft">{c.fat ? (c.fat.level === 'Low' ? <span className="fat-ok">✅ OK</span> : <FatigueBadge fat={c.fat} />) : <span className="cc-none">-</span>}</td>
        <td>{money(c.spend)}</td>
        <td>{fmtNumber(c.crm ? c.crm.leads : c.leads)}</td>
        {hasCrm && <td>{fmtNumber(c.bk)}</td>}
        {hasCrm && <td>{c.cpb != null ? money(c.cpb) : '-'}</td>}
        {o360cols && o360Cells(c, currency, o360cols)}
      </tr>
      {open && <tr className="cc-edit-row"><td colSpan={(hasCrm ? 10 : 8) + (o360cols ? o360cols.cols.length : 0)}>
        <div className="cc-edit" onClick={(e) => e.stopPropagation()}>
          <div className="cc-edit-perf">
            {hasCrm && <><span><b>{fmtNumber(c.bk)}</b> booked</span><span><b>{fmtNumber(c.wn)}</b> won</span><span><b>{money(c.rev)}</b> revenue</span></>}
            <span><b>{fmtNumber(c.impressions)}</b> impr</span><span><b>{fmtNumber(c.clicks)}</b> clicks</span>
            <button className="ai-btn sm" onClick={suggest} disabled={ai.busy} title="Let Claude suggest awareness / persona / angle from the copy">{ai.busy ? 'Thinking…' : '✨ Suggest tags'}</button>
            {(c.preview || c.igUrl) && <a className="cc-view" href={c.preview || c.igUrl} target="_blank" rel="noreferrer">{c.preview ? '↗ Open the ad preview' : '↗ View ad on Instagram'}</a>}
          </div>
          {c.fat && c.fat.level !== 'Low' && <div className="cap cc-fat-reason"><FatigueBadge fat={c.fat} /> {c.fat.frequency != null ? `frequency ${c.fat.frequency}x` : ''}{c.fat.ctrDrop != null ? ` · CTR ${c.fat.ctrDrop >= 0 ? 'down' : 'up'} ${Math.abs(c.fat.ctrDrop)}% over the period` : ''}{(c.fat.reasons && c.fat.reasons.length) ? ` · ${c.fat.reasons.join(' · ')}` : ''} - consider a fresh variation.</div>}
          {ai.err && <div className="cap" style={{ color: 'var(--neg)' }}>{ai.err}</div>}
          {ai.reason && <div className="cap cc-ai-reason">✨ {ai.reason} <span className="cc-ai-note">· suggested - edit anything below</span></div>}
          <div className="cc-fields">
            <label>Awareness<select value={c.aware} onChange={(e) => save({ aware: e.target.value })}><option value="">-</option>{AWARENESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select></label>
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
export function useUpdateData(clientId, range, nonce) {
  const [st, setSt] = useState({ status: 'idle', data: null })
  const q = rangeQuery(range)
  useEffect(() => {
    if (!clientId) { setSt({ status: 'idle', data: null }); return }
    let alive = true; setSt({ status: 'loading', data: null })
    const base = `/.netlify/functions/windsor?client=${clientId}`
    const g = (s) => fetch(`${base}&scope=${s}&${q}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({}))
    // The CORE numbers (health) are the same consolidated figures the client view
    // uses; the update is ready as soon as these load. Everything else is optional
    // enrichment that merges in as it arrives, so a slow / timing-out extra can
    // never block generating the update.
    g('health').then((health) => { if (alive) setSt({ status: (health && health.error) ? 'err' : 'ok', data: { health } }) })
    Promise.all([
      g('creatives'), g('updateextra'), g('users'),
      fetch(`${base}&channel=google&${q}${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({})),
      g('forms'), g('appts'), g('speed'),
      fetch(`${base}&scope=cohorts&weeks=12${nonce ? `&_r=${nonce}` : ''}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([creatives, extra, users, google, forms, appts, speed, cohorts]) => { if (alive) setSt((s) => (s.status === 'ok' ? { ...s, data: { ...s.data, creatives, extra, users, google, forms, appts, speed, cohorts } } : s)) })
    return () => { alive = false }
  }, [clientId, q, nonce])
  return st
}

// Small thumbnail that pops a larger preview on hover. The preview is
// position:fixed (positioned from the thumbnail's on-screen rect) so it renders
// over the table instead of being clipped by the scroll container's overflow.
export function ThumbZoom({ src }) {
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
export function MetaGroupRows({ groups, adsFor, money, level }) {
  const [open, setOpen] = useState(() => new Set())
  const toggle = (n) => setOpen((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s })
  const cpr = (spend, n) => (n ? money(Math.round(spend / n)) : '-')
  return groups.map((g) => {
    const isOpen = open.has(g.name); const kids = isOpen ? adsFor(g.name) : []
    return (
      <React.Fragment key={g.name}>
        <tr className={isOpen ? 'row-sel' : ''} style={{ cursor: 'pointer' }} onClick={() => toggle(g.name)}>
          <td className="lft"><span className="u-chev">{isOpen ? '▾' : '▸'}</span> {g.name}</td>
          <td>{money(g.spend)}</td><td>{fmtNumber(g.leads)}</td><td>{g.booked != null ? fmtNumber(g.booked) : '-'}</td><td>{g.booked ? cpr(g.spend, g.booked) : '-'}</td>
        </tr>
        {isOpen && kids.map((a, i) => (
          <tr className="ud-child" key={a.name + i}>
            <td className="lft"><ThumbZoom src={a.thumb} /> <span className="cc-nm" title={a.name}>{a.name}</span>{a.previewUrl ? <a className="ud-prev" href={a.previewUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗</a> : null}</td>
            <td>{money(a.spend)}</td><td>{fmtNumber(a.leads)}</td><td>{fmtNumber(a.booked)}</td><td>{a.booked ? cpr(a.spend, a.booked) : '-'}</td>
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
export function UpdateDataDashboard({ st, currency }) {
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
  for (const c of cre) { const key = c.campaign || '-'; const e = campMap.get(key) || { name: key, spend: 0, leads: 0, booked: 0 }; e.spend += c.spend || 0; e.leads += (c.crm ? c.crm.leads : c.leads) || 0; e.booked += (c.crm ? c.crm.booked : 0) || 0; campMap.set(key, e) }
  const metaCamps = [...campMap.values()].sort((a, b) => b.spend - a.spend)
  const topCre = [...cre].sort((a, b) => ((b.crm ? b.crm.booked : 0) - (a.crm ? a.crm.booked : 0)) || (b.spend - a.spend)).slice(0, 12)
  const cpr = (spend, n) => (n ? money(Math.round(spend / n)) : '-')
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
          <Sc label="Meta cost/lead" value={metaCpl != null ? money(metaCpl) : '-'} />
          <Sc label="Google conv." value={fmtNumber(ch.googleConv || 0)} />
          <Sc label="Google cost/conv" value={googCpc != null ? money(googCpc) : '-'} />
        </> : <>
          <Sc label="Leads (ads)" value={fmtNumber(adLeads)} />
          <Sc label="Cost / lead" value={adCpl != null ? money(adCpl) : '-'} />
        </>}
        <Sc label="Booked calls" value={fmtNumber(k.booked || 0)} />
        <Sc label="Cost / booked" value={k.cpBooked != null ? money(k.cpBooked) : '-'} />
        <Sc label="Won" value={fmtNumber(k.won || 0)} />
        <Sc label="Revenue" value={money(k.revenue || 0)} />
      </div>
      {twoChannels
        ? <p className="cap"><b>Two channels are running this period.</b> Meta and Google are shown separately above so each matches its own platform (Meta form/website leads vs Google conversions, which aren’t always the same thing). Combined that’s {fmtNumber(adLeads)} leads at {adCpl != null ? money(adCpl) : '-'} blended. Booked calls and wins are Caalano Systems, attributed to the ads by UTM. The CRM logged {fmtNumber(k.leads || 0)} opportunities across all sources.</p>
        : <p className="cap">Leads and cost per lead are ad-reported (Meta {fmtNumber(ch.metaLeads || 0)}, Google {fmtNumber(ch.googleConv || 0)}) so they match Ads Manager. Booked calls and wins are Caalano Systems, attributed to the ads by UTM. The CRM logged {fmtNumber(k.leads || 0)} opportunities across all sources.</p>}
      {ap && <p className="cap">Appointments: {fmtNumber(ap.attended)} attended, {fmtNumber(ap.noShow)} no-shows, {fmtNumber(ap.upcoming)} still upcoming, {fmtNumber(ap.occurred)} calls have happened.{ap.stageOnlyShown > 0 ? ` ${fmtNumber(ap.stageOnlyShown)} advanced past the show stage but weren’t marked attended (reporting gap).` : ''}</p>}

      {/* Pipelines */}
      {pls.length > 0 && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Pipeline - where leads are at</div>
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

      {/* Meta Ads - campaign / ad set rows drill into their ads */}
      {(metaCamps.length > 0 || segs.length > 0) && <>
        <div className="lvl-title" style={{ fontSize: 13, marginTop: 16 }}>Meta Ads <span className="sub">· click a campaign or ad set to see its ads · hover a thumbnail to enlarge</span></div>
        <div className="ud-tbls">
          {metaCamps.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Campaigns</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Campaign</th><th>Spend</th><th>Leads</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody><MetaGroupRows groups={metaCamps} adsFor={adsInCampaign} money={money} level="campaign" /></tbody></table></div>}
          {segs.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Ad sets (segments)</div><table className="mini-tbl users-tbl"><thead><tr><th className="lft">Ad set</th><th>Spend</th><th>Leads</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody><MetaGroupRows groups={segs} adsFor={adsInAdset} money={money} level="ad set" /></tbody></table></div>}
        </div>
        {topCre.length > 0 && <div className="tbl-scroll ud-tbl"><div className="ud-tbl-h">Top creatives</div><table className="mini-tbl users-tbl cc-tbl"><thead><tr><th className="lft">Creative</th><th className="lft">Format</th><th>Spend</th><th>Leads</th><th>Cost/lead</th><th>Booked</th><th>Cost/book</th></tr></thead><tbody>{topCre.map((c) => { const cl = c.crm ? c.crm.leads : c.leads, bkd = c.crm ? c.crm.booked : 0; return <tr key={c.id}><td className="lft"><ThumbZoom src={c.thumb} /> <span className="cc-nm" title={c.name}>{c.name}</span></td><td className="lft"><span className={`cc-fmt ${c.format === 'Video' ? 'vid' : 'img'}`}>{c.format}</span></td><td>{money(c.spend)}</td><td>{fmtNumber(cl)}</td><td>{cpr(c.spend, cl)}</td><td>{fmtNumber(bkd)}</td><td>{cpr(c.spend, bkd)}</td></tr> })}</tbody></table></div>}
      </>}

      {/* Which ads drove the bookings - traced through the lead UTMs */}
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

export function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1600) } catch { /* clipboard blocked */ } }
  return <button className="link-btn sm cu-copy" onClick={copy}>{done ? '✓ Copied' : label}</button>
}
export function ClientUpdatePage({ clients, currency, range, nonce, authUser }) {
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
      const { health, creatives = {}, extra = {}, users = {} } = dataSt.data
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
      const payload = { mode: 'client-update', clientName: sel.name, firstName: firstName.trim(), senderName: (authUser && (authUser.name || authUser.email)) || '', clientContext: [profileText(sel.id), (ctx || '').trim()].filter((s) => s && s.trim()).join('\n\n'), period: rangeLabel(range), periodDays, kpis: health.kpis, channels: health.channels, forecast: health.forecast, pipelines: health.pipelines || [], segments: creatives.segments || [], creatives: topCr, appts: extra.appts || null, lostReasons: extra.lostReasons || [], avgCloseDays: extra.avgCloseDays != null ? extra.avgCloseDays : null, nonBookerNotes: extra.nonBookerNotes || [], stalled, geo, apptInsights, speed, cohortTrend, forms }
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
      <p className="cap" style={{ marginTop: 2 }}>Pulls this client's computed results for <b>{rangeLabel(range)}</b> (spend, leads, booked calls, revenue, cost per result, best-performing ads) and writes a client-ready update. Set the period with the date range up top. Nothing is invented - it only uses the numbers on the dashboard.</p>
      <details className="cu-ctx" open={!!ctx}>
        <summary>Client context &amp; notes {ctx ? <span className="cu-ctx-on">· saved</span> : <span className="cap">· optional background the AI uses for tone &amp; framing</span>}</summary>
        <textarea className="cu-ctx-ta" rows={4} value={ctx} placeholder="Anything the AI should know about this client: their business, tone to use, what they care about, current focus, sensitivities, offers running, seasonality, relationship notes… This is fed into the update as background (it never invents numbers). Saved to this client and shared with the team." onChange={(e) => setCtx(e.target.value)} onBlur={() => sel && saveClientCtx(sel.id, ctx)} />
        <div className="cap">Saved to Settings for {sel ? sel.name : 'this client'} and shared across the team. Edited here for convenience.</div>
      </details>
      {err && <div className="card empty-deep" style={{ padding: 18 }}><b>Couldn’t generate.</b><p className="cap" style={{ marginTop: 6 }}>{err}</p></div>}
      {busy && <div className="card"><Spinner label="Pulling the numbers and writing the update…" /></div>}
      {!busy && rec && (rec.email || rec.whatsapp) && <>
        <div className="cu-meta cap">{err ? 'Showing your last saved update - the new one didn’t generate (see the error above). ' : ''}Last generated {new Date(rec.generatedAt).toLocaleString('en-AU')} · {rec.period}</div>
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
