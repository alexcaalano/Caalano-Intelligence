// Settings: the client editors and the Settings page. Carved out of App.jsx so it loads on first open; the
// helpers it shares with the rest of the app are imported from there.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { APP_VERSION, AnnotationToggle, Avatar, BIZ_TYPES, CC_CHANS, Caveat, ChangePasswordCard, ClinicSettings, DASH_AUD, DASH_MODULES, DASH_PRESETS, DEFAULT_HOURS, DOW_LABELS, FATIGUE_DEFAULTS, FAVICON, FormsSettingsTab, GeoSettings, HelpNote, OptLogSettings, PROFILE_FIELDS, ROLE_LABEL, SEED_KEYEVENTS, SETTINGS, SignOutEverywhereCard, YourDetailsCard, Spinner, TAB_OPTIONS, TermsAdmin, TermsRegister, UsersAdmin, acolor, apiJson, applyAliases, clientLogoSrc, dashAudience, dashModuleFits, dedupeFetch, deleteClient, domainOf, dpClientOn, dpPipeOn, fetchDiscover, fmtDMY, fmtHours, formKeyEvents, formsDoneCount, hhmm, initials, isAdminishFE, isClientDeleted, iso, loadAliases, loadBizType, loadCampMap, loadCashOn, loadCloseOverride, loadDashboard, loadFatigueCfg, loadHours, loadKeep, loadKeyEvents, loadKeyEventsRaw, loadKpis, loadLogo, loadMetaConv, loadProfile, loadQualStage, loadSocialKpis, mkOutcomeMap, normId, presetRange, rangeLabel, rangeMaturity, rangeQuery, readNavUrl, removeCustomClient, restoreClient, roleLabelOf, saveBizType, saveCampMap, saveCashOn, saveCloseOverride, saveCustomClient, saveDashboard, saveFatigueCfg, saveHours, saveKeyEvents, saveKpis, saveLogo, saveMetaConv, saveProfile, saveQualStage, saveSocialKpis, setAlias, setDpClient, setDpPipe, setKeep, syncLogos, unorm, useDiscoverNames, useSettingsSync, writeNavUrl, normCrmUrl, saveCrmUrl, CRM_DEFAULT_URL } from '../App.jsx'
import { fmtCurrency, fmtNumber } from '../lib/format.js'
import { VIS_ROLES, VIS_ROLE_LABELS, viewsForRole, tabsForRole, normVisibility, hasOverride } from '../lib/visibility.js'
import { authApi, saveSettingsRemote, bumpSettings } from '../App.jsx'
import { GoalsEditor } from './sales-hub.jsx'

/* ============ Settings ============ */
// Campaign → pipeline linker, per client. Fetches the client's campaigns +
// pipelines on expand and writes overrides to the shared localStorage map that
// Caalano360 reads for spend attribution.
// A target is one number per stage, but it can be thought of two ways - "we
// want 40 site visits" or "a site visit should cost $150" - and with a monthly
// budget in hand the two are the same statement. So both columns are offered
// and typing in either fills the other: volume -> cost = spend / volume, cost ->
// volume = spend / cost. The side that was TYPED is what is stored as the
// intent; the other is recomputed from the budget whenever the budget changes,
// so raising the budget lifts every volume target set by cost, and every cost
// target set by volume gets cheaper - which is what a person changing the
// budget means.
export const KPI_LEADS_KEY = '*leads'   // the top of the funnel, which is not a pipeline stage
export function KpiEditor({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [pid, setPid] = useState('') // '' = client-level; a pipeline id = per-pipeline
  const [k, setK] = useState(() => loadKpis(clientId))
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
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
  const selPipe = multi ? pipes.find((p) => p.id === pid) : pipes[0]
  const stageRows = selPipe ? (selPipe.stages || []) : [...new Set(pipes.flatMap((p) => (p.stages || []).map((s) => s.name)))].map((name) => ({ name }))
  const numOr = (v) => (v == null || v === '' ? '' : v)
  // The budget is one number for the CLIENT - it is what the client pays - and
  // each pipeline gets its share of it by that pipeline's share of last month's
  // leads, the same allocation the Channel split uses. A pipeline can be given
  // its own figure instead, which sticks until it is cleared.
  useSettingsSync()
  const clientAll = SETTINGS.kpis[clientId] || {}
  const clientBudget = Number(clientAll.monthlySpend) > 0 ? Number(clientAll.monthlySpend) : null
  const totalLeads30 = (st.blend && st.blend.crm && st.blend.crm.leads) || 0
  const shareOf = (p) => (p && totalLeads30 ? ((p.crm && p.crm.leads) || 0) / totalLeads30 : 1)
  const share = multi ? shareOf(selPipe) : 1
  const pipeOverride = multi && Number(k.pipeBudget) > 0 ? Number(k.pipeBudget) : null
  const spend = multi ? (pipeOverride || (clientBudget ? Math.round(clientBudget * share) : null)) : clientBudget
  const actualLeads = selPipe ? ((selPipe.crm && selPipe.crm.leads) || 0) : totalLeads30
  // Which stages are key events, so they stand out in the table: those are the
  // ones the rest of the app reports on, and the targets that matter most.
  const keNames = useMemo(() => {
    try { const ke = formKeyEvents(clientId, pid || 'all', pipes); return new Set((ke.events || []).map((e) => (e.kind === 'calendar' ? e.stage : e.ref)).filter(Boolean)) } catch { return new Set() }
  }, [clientId, pid, pipes])

  // One edit updates both columns. `basis` records which side was typed.
  const setTarget = (key, side, raw) => setK((p) => {
    const stages = { ...(p.stages || {}) }, stageCost = { ...(p.stageCost || {}) }, stageBasis = { ...(p.stageBasis || {}) }
    if (raw === '') { delete stages[key]; delete stageCost[key]; delete stageBasis[key] }
    else {
      const v = Number(raw)
      if (side === 'volume') { stages[key] = v; stageBasis[key] = 'volume'; if (spend && v > 0) stageCost[key] = Math.round(spend / v); else delete stageCost[key] }
      else { stageCost[key] = v; stageBasis[key] = 'cost'; if (spend && v > 0) stages[key] = Math.round(spend / v); else delete stages[key] }
    }
    const nx = { ...p, stages, stageCost, stageBasis }; saveKpis(clientId, nx, pid || undefined); return nx
  })
  // A new budget re-derives every stage's non-typed side from the typed one.
  const rederive = (p, sp) => {
    const stages = { ...(p.stages || {}) }, stageCost = { ...(p.stageCost || {}) }, stageBasis = p.stageBasis || {}
    for (const key of new Set([...Object.keys(stages), ...Object.keys(stageCost)])) {
      const basis = stageBasis[key] || (stages[key] != null ? 'volume' : 'cost')
      if (!sp) { if (basis === 'volume') delete stageCost[key]; else delete stages[key]; continue }
      if (basis === 'volume' && stages[key] > 0) stageCost[key] = Math.round(sp / stages[key])
      if (basis === 'cost' && stageCost[key] > 0) stages[key] = Math.round(sp / stageCost[key])
    }
    return { ...p, stages, stageCost }
  }
  // The client's budget. Every pipeline's derived side follows it, so all of
  // them are re-derived and written, not only the one on screen.
  const setSpend = (raw) => {
    const sp = raw === '' ? undefined : Number(raw)
    const all = SETTINGS.kpis[clientId] || {}
    const { byPipeline, ...clientLevel } = all
    if (multi && byPipeline) {
      for (const p of pipes) {
        const cur = byPipeline[p.id]; if (!cur) continue
        const eff = Number(cur.pipeBudget) > 0 ? Number(cur.pipeBudget) : (sp ? Math.round(sp * shareOf(p)) : undefined)
        saveKpis(clientId, rederive(cur, eff), p.id)
      }
    }
    saveKpis(clientId, { ...clientLevel, monthlySpend: sp }, undefined)
    setK(loadKpis(clientId, pid || undefined))
  }
  // A pipeline's own figure, overriding its share; empty goes back to the share.
  const setPipeBudget = (raw) => setK((p) => {
    const v = raw === '' ? undefined : Number(raw)
    const eff = v || (clientBudget ? Math.round(clientBudget * share) : undefined)
    const nx = { ...rederive(p, eff), pipeBudget: v }; saveKpis(clientId, nx, pid || undefined); return nx
  })
  const money0 = (v) => (v == null || !isFinite(v) ? '-' : `$${fmtNumber(Math.round(v))}`)
  const row = (key, label) => {
    const vol = k.stages && k.stages[key], cost = k.stageCost && k.stageCost[key]
    const basis = k.stageBasis && k.stageBasis[key]
    return (
      <tr key={key} className={`${key === KPI_LEADS_KEY ? 'kpi-row-leads' : ''}${keNames.has(key) ? ' kpi-row-ke' : ''}`}>
        <td className="lft" title={keNames.has(key) ? `${label} - a key event` : label}>{label}{keNames.has(key) ? <span className="kpi-ke-tag" title="A key event: this stage is reported on throughout the app">key event</span> : null}</td>
        <td><input type="number" min="0" className={basis === 'cost' ? 'kpi-derived' : ''} value={numOr(vol)} onChange={(e) => setTarget(key, 'volume', e.target.value)} placeholder={spend && cost ? String(Math.round(spend / cost)) : '#'} title={basis === 'cost' ? 'Worked out from the cost target and the monthly budget' : 'Target volume this month'} /></td>
        <td><input type="number" min="0" className={basis === 'volume' ? 'kpi-derived' : ''} value={numOr(cost)} onChange={(e) => setTarget(key, 'cost', e.target.value)} placeholder={spend && vol ? String(Math.round(spend / vol)) : '$'} title={basis === 'volume' ? 'Worked out from the volume target and the monthly budget' : 'Target cost per one of these'} disabled={!spend && basis !== 'cost'} /></td>
      </tr>
    )
  }
  const body = (
    <div className={embedded ? '' : 'linker-body'}>
      {multi && <div className="kpi-pipe-sel">
        <label>Pipeline</label>
        <select value={pid} onChange={(e) => setPid(e.target.value)}>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="cap">Targets are set per pipeline for this client.</span>
      </div>}

      <div className="kpi-block">
        <div className="kpi-block-h">Monthly budget <span className="sub">· the number every cost and volume target below is worked out from</span></div>
        <div className="kpi-spend">
          <span className="kpi-spend-cur">$</span>
          <input type="number" min="0" value={numOr(clientAll.monthlySpend)} onChange={(e) => setSpend(e.target.value)} placeholder="per month" />
          <span className="cap">The paid budget for the month{multi ? ', across every pipeline' : ''}.</span>
        </div>
        {multi && selPipe ? (
          <div className="kpi-share">
            <div className="kpi-share-h">This pipeline's share <span className="sub">· {Math.round(share * 100)}% of the budget, by its share of last month's leads ({fmtNumber(actualLeads)} of {fmtNumber(totalLeads30)})</span></div>
            <div className="kpi-spend">
              <span className="kpi-spend-cur">$</span>
              <input type="number" min="0" className={pipeOverride ? '' : 'kpi-derived'} value={numOr(k.pipeBudget)} onChange={(e) => setPipeBudget(e.target.value)} placeholder={clientBudget ? String(Math.round(clientBudget * share)) : '-'} title={pipeOverride ? 'Set for this pipeline - clear it to go back to the share' : 'Worked out from the client budget; type a figure to override it'} />
              <span className="cap">{pipeOverride ? `Overriding the ${money0(clientBudget ? clientBudget * share : 0)} share.` : clientBudget ? `Type a figure to give this pipeline a different budget.` : 'Set the client budget above first.'}</span>
            </div>
            <div className="kpi-share-list">{pipes.map((p) => <span key={p.id} className={p.id === pid ? 'on' : ''}>{p.name} <b>{Math.round(shareOf(p) * 100)}%</b></span>)}</div>
          </div>
        ) : null}
      </div>

      <div className="kpi-block">
        <div className="kpi-block-h">Funnel targets{multi && selPipe ? ` · ${selPipe.name}` : ''} <span className="sub">· type a volume or a cost - the other is worked out for you</span></div>
        {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
          : stageRows.length || st.status === 'ok' ? (
            <div className="table-wrap"><table className="mini-tbl appt-tbl kpi-tbl">
              <thead><tr><th className="lft">Stage</th><th title="How many you want to reach this stage per month">Target volume</th><th title="What you want each one to cost">Target cost</th></tr></thead>
              <tbody>
                {row(KPI_LEADS_KEY, 'Leads')}
                {stageRows.map((r) => row(r.name, r.name))}
              </tbody>
            </table></div>
          ) : st.status === 'err' ? <p className="cap">Couldn’t load the pipeline just now - targets can still be typed and will apply once it loads.</p> : null}
        {!spend ? <p className="cap kpi-hint">Enter a monthly budget above to unlock the cost column.</p> : null}
        <HelpNote>Volume is how many leads reach a stage in a month. A cost target is the budget divided by that volume - so it is a cost per lead that <i>reaches</i> the stage, not a cost per action at it.</HelpNote>
      </div>

      <div className="kpi-block">
        <div className="kpi-block-h">Efficiency targets <span className="sub">· used by the scorecards and the Weekly Traffic Light</span></div>
        <div className="kpi-inputs">
          <label>Meta cost / lead<input type="number" min="0" value={numOr(k.metaCpl)} onChange={(e) => set({ metaCpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Google cost / conv<input type="number" min="0" value={numOr(k.googleCostConv)} onChange={(e) => set({ googleCostConv: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>All-leads CPL<input type="number" min="0" value={numOr(k.cpl)} onChange={(e) => set({ cpl: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Cost / booked appt<input type="number" min="0" value={numOr(k.cpba)} onChange={(e) => set({ cpba: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Cost / won (CPA)<input type="number" min="0" value={numOr(k.cpa)} onChange={(e) => set({ cpa: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ target" /></label>
          <label>Booking rate %<input type="number" min="0" value={numOr(k.bookingRate)} onChange={(e) => set({ bookingRate: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="% target" /></label>
          <label>Weekly spend<input type="number" min="0" value={numOr(k.wkSpend)} onChange={(e) => set({ wkSpend: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder={spend ? String(Math.round(spend / 4.345)) : '$ per week'} /></label>
          <label>Avg client LTV<input type="number" min="0" value={numOr(k.clientLtv)} onChange={(e) => set({ clientLtv: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="$ lifetime" /></label>
        </div>
        <div className="cap">LTV powers the Caalano360 unit-economics header (LTV:CAC, profit per client). Leave blank to use average deal value.</div>
      </div>
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
export function TrackingHealth({ paid, crmLeads, attribData, channels, periodLabel }) {
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
      <Caveat>Ad-reported leads are what Meta/Google count; CRM opportunities are what landed in Caalano Systems. <b>Manual (CRM UI)</b> opportunities were added by hand in the CRM (not driven by ads), so <b>True variance</b> compares ad-reported leads to CRM <b>excluding</b> those - the real gap. A remaining gap usually means duplicate/again-counted ad conversions, leads not reaching the CRM, or missing UTMs (see source-tag coverage). ✋ = a manually-added source.</Caveat>
    </div>
  )
}

// Attribution diagnostics (moved to Settings). Exposes where paid spend and CRM
// revenue fail to tie together, with token-overlap "looks like" hints.
export function AttributionDiagnostics({ attribData, camps, currency }) {
  if (!attribData || !camps || !camps.length) return null
  const money = (v) => fmtCurrency(v, currency)
  const badge = (s) => <span className="src-badge" style={{ background: s === 'Meta' ? '#4f7cff' : '#12b886' }}>{s === 'Meta' ? 'M' : 'G'}</span>
  // Auto-fold numeric Google/Meta campaign IDs in utm_campaign to their live name
  // first (from Windsor's campaign_id↔name pairing), so IDs that resolve to a real
  // campaign aren't flagged as "unmatched" here - only genuinely orphaned UTMs are.
  const byCampaign = applyAliases(attribData.byCampaign, attribData.campIdMap)
  const oCamp = mkOutcomeMap(byCampaign)
  const adNames = new Set(camps.map((cc) => unorm(cc.name)).filter(Boolean))
  const unmatchedAd = camps.filter((cc) => cc.spend > 0 && !oCamp.has(unorm(cc.name))).sort((a, z) => z.spend - a.spend)
  const notSet = (byCampaign || []).find((x) => x.name === '(not set)') || null
  const unmatchedUtm = (byCampaign || []).filter((x) => x.name !== '(not set)' && x.leads > 0 && !adNames.has(unorm(x.name))).sort((a, z) => (z.won - a.won) || (z.revenue - a.revenue) || (z.leads - a.leads))
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
        <Caveat>A utm_campaign that carries the ad campaign ID (or a shortened slug) instead of the exact campaign name will land here even though it is really the same campaign - the "looks like" hint flags the likely pair. Set the campaign to pipeline links above to force a match for reporting.</Caveat>
      </div>
    </details>
  )
}

// Per-client tracking diagnostics for Settings. Lazily fetches the blend +
// attribution feeds on expand (one client at a time), then renders tracking
// health and attribution diagnostics.
export function ClientTrackingDiagnostics({ clientId, currency, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null, attr: null })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null, attr: null })
    const r = presetRange('last_30d')
    Promise.all([
      dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=attribution&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
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

export function KeyEventsEditor({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [sel, setSel] = useState(() => loadKeyEventsRaw(clientId))
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [cals, setCals] = useState({ status: 'idle', list: [] })
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [open, st.status, clientId])
  useEffect(() => {
    if (!open || cals.status !== 'idle') return
    setCals({ status: 'loading', list: [] })
    fetch(`/.netlify/functions/windsor?scope=calendars&client=${clientId}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setCals({ status: 'ok', list: j.calendars || [], pipelines: j.pipelines || [] }))
      .catch(() => setCals({ status: 'err', list: [], pipelines: [] }))
  }, [open, cals.status, clientId])
  // Prefer Windsor's blend pipelines (they carry per-stage open-deal counts), but
  // fall back to the direct-GHL pipeline list from the calendars scope when the
  // blend has none - e.g. a just-linked client Windsor hasn't synced yet, so the
  // stages still appear immediately instead of "No pipeline stages found".
  const blendPipes = (st.blend && st.blend.pipelines) || []
  const directPipes = cals.pipelines || []
  // Stage NAMES come from Caalano Systems, which is where they're edited; the
  // blend feed is a periodic mirror, so preferring it meant a renamed stage kept
  // its old name here until that sync caught up. Counts still come from the
  // blend - it's the only side that has them - matched to the live stage by id.
  const pipes = React.useMemo(() => {
    if (!directPipes.length) return blendPipes
    const bById = new Map(blendPipes.map((p) => [p.id, p]))
    return directPipes.map((p) => {
      const b = bById.get(p.id)
      if (!b) return p
      const bStage = new Map((b.stages || []).map((x) => [x.id, x]))
      return {
        ...b, ...p,
        // Live id/name/position wins; anything else the blend knows about a
        // stage (open counts, value) rides along.
        stages: (p.stages || []).map((x) => ({ ...(bStage.get(x.id) || {}), ...x })),
      }
    })
  }, [directPipes, blendPipes])
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
        <HelpNote>Tick the pipeline stages and booked calendars that count as progress for this client - they drive the Key Events funnel and cost-per-event everywhere. Link each ticked calendar to the stage it represents so the two count as one step (the stage catches leads that got there without a tracked booking); several calendars can share a stage. Leave everything empty for the default leads → booked → shown → won.</HelpNote>
        <div className="kev-group">
          <div className="kev-pipe">📅 Booked calendars <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· tick the ones that matter, then link each to its pipeline stage</span></div>
          {cals.status === 'loading' ? <Spinner label="Loading calendars…" />
            : cals.list.length ? <div className="kev-caltbl">
              <div className="kev-calhead"><span /><span>Calendar</span>{multi ? <span>Pipeline</span> : null}<span>Counts as stage</span></div>
              {[...cals.list].sort((a, b) => (hasCal(b.id) - hasCal(a.id)) || String(a.name).localeCompare(String(b.name))).map((cal) => {
              const on = hasCal(cal.id)
              return (
                <div className={`kev-cal ${on ? 'on' : ''}`} key={cal.id}>
                  <label className={`kev-item ${on ? 'on' : ''}`}><input type="checkbox" checked={on} onChange={() => toggleCal(cal)} /><span title={cal.name}>{cal.name}</span>{cal.typeLabel && cal.type !== 'round_robin' ? <em className="kev-caltype">{cal.typeLabel}</em> : null}</label>
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
                  {!on ? <span className="kev-off cap">not counted</span> : null}
                </div>
              )
            })}</div>
              : cals.status === 'ok' ? <p className="cap">No calendars found for this client.</p>
                : <p className="cap">Couldn’t load calendars.</p>}
        </div>
        <div className="kev-pipe" style={{ marginTop: 10 }}>Pipeline stages{multi ? ' · grouped by pipeline' : ''}</div>
        {(st.status === 'loading' || (cals.status === 'loading' && !withStages.length)) ? <Spinner label="Loading pipeline stages…" />
          : withStages.length ? withStages.map((p) => (
            <div className="kev-group" key={p.id}>
              {multi && <div className="kev-pipe">{p.name}</div>}
              <div className="kev-list">{(p.stages || []).slice().sort((a, b) => a.pos - b.pos).map((s) => (
                <label className={`kev-item ${hasStage(s.name, p.id) ? 'on' : ''}`} key={s.name}><input type="checkbox" checked={hasStage(s.name, p.id)} onChange={() => toggleStage(s.name, p.id)} /><span title={s.name}>{s.name}</span></label>
              ))}</div>
            </div>
          ))
          : (st.status === 'ok' || cals.status === 'ok') ? <p className="cap">No Caalano Systems pipeline stages found.</p>
            : <p className="cap">Couldn’t load pipeline stages.</p>}
      </div>}
    </div>
  )
}
// Settings pane: pick the "qualified lead" stage per pipeline.
export function QualStageEditor({ clientId, nonce }) {
  useSettingsSync()
  const [st, setSt] = useState({ status: 'idle', blend: null })
  useEffect(() => {
    if (st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error('http'))))
      .then((j) => setSt({ status: 'ok', blend: j.blend }))
      .catch(() => setSt({ status: 'err', blend: null }))
  }, [st.status, clientId])
  const pipes = ((st.blend && st.blend.pipelines) || []).filter((p) => (p.stages || []).length)
  const map = loadQualStage(clientId)
  const setStage = (pid, stage) => { const nx = { ...loadQualStage(clientId) }; if (stage) nx[pid] = stage; else delete nx[pid]; saveQualStage(clientId, nx) }
  return (
    <div className="linker">
      <HelpNote>Pick the stage that marks a lead <b>qualified</b> for each pipeline - typically just after the discovery call. A lead counts as qualified once it <b>reaches that stage or beyond</b>, and any won deal always counts. Leave a pipeline on “Not set” to keep Qualified off for it. <b>Qualified only appears on the dashboards when at least one pipeline has a stage set here.</b></HelpNote>
      {st.status === 'loading' ? <Spinner label="Loading pipeline stages…" />
        : pipes.length ? pipes.map((p) => (
          <div className="camp-row" key={p.id}>
            <span className="camp-nm" title={p.name}>{p.name}</span>
            <select className="camp-lnk" value={map[p.id] || ''} onChange={(e) => setStage(p.id, e.target.value)}>
              <option value="">Not set - no qualified metric</option>
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
export function AliasEditor({ clientId, nonce }) {
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
      dedupeFetch(`/.netlify/functions/windsor?channel=attribution&${q}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      // Lightweight name-only endpoint (not the heavy buildMeta) so the current
      // campaign / ad-set / ad names load reliably even for large accounts.
      fetch(`/.netlify/functions/windsor?scope=adnames&${q}`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]).then(([a, n]) => setSt({ status: 'ok', attr: a && a.attribution, names: (n && !n.error) ? { campaign: n.campaigns || [], medium: n.adsets || [], content: n.ads || [], ids: n.ids || { campaign: [], medium: [], content: [] } } : null }))
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
  // utm values that are organic traffic sources, not ads - never offer them for
  // ad-set / creative aliasing.
  const NONAD = new Set(['social', 'organic', 'manual', 'calendar', 'email', 'referral', 'direct', 'none', 'sms', 'whatsapp', 'qr', 'link', 'bio', 'link_in_bio', 'linktree', 'linkinbio', 'profile'])
  const isNonAd = (name) => { const s = String(name || '').trim().toLowerCase(); return NONAD.has(s) || /link.?in.?bio|linktree/.test(s) }
  // Current-name lists are now channel-tagged: [{ name, channel }]. Tolerate the
  // old string-array shape too (cached responses) so nothing breaks mid-deploy.
  const curListRaw = st.names || { campaign: [], medium: [], content: [] }
  const asObjs = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { name: x, channel: null } : x)).filter((x) => x && x.name)
  const curList = { campaign: asObjs(curListRaw.campaign), medium: asObjs(curListRaw.medium), content: asObjs(curListRaw.content) }
  // Match on names AND raw entity IDs, so a UTM carrying a live campaign/ad-set/ad
  // ID (not its name) is treated as matched and hidden too.
  const curIds = curListRaw.ids || { campaign: [], medium: [], content: [] }
  const matchSet = (lvl) => new Set([...curList[lvl].map((o) => unorm(o.name)), ...((curIds[lvl] || []).map(unorm))])
  const curSet = { campaign: matchSet('campaign'), medium: matchSet('medium'), content: matchSet('content') }
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
  // Old spellings that differ from a current name only by case or punctuation.
  // They are not offered for linking because they already fold into that name
  // everywhere - but they are listed, so "no unmatched UTMs" never hides them.
  const folded = (lvl) => {
    if (!namesLoaded) return []
    const live = new Map(curList[lvl].map((o) => [unorm(o.name), o.name]))
    return (outcomes[lvl] || []).filter((o) => o.leads > 0 && o.name && live.has(unorm(o.name)) && live.get(unorm(o.name)) !== o.name && !(aliases[lvl] && aliases[lvl][o.name]))
      .map((o) => ({ ...o, cur: live.get(unorm(o.name)) })).sort((a, b) => b.leads - a.leads).slice(0, 40)
  }
  const LEVELS = [['campaign', 'Campaigns', 'utm_campaign'], ['medium', 'Ad sets', 'utm_medium'], ['content', 'Creatives', 'utm_content']]
  return (
    <div className="linker">
      <HelpNote>When you rename a campaign, ad set or creative, historical CRM leads keep the <b>old</b> UTM they were stamped with - so their results don't roll into the new name. Link each old UTM below to the current name and they'll aggregate together everywhere (live views and reports). We match on the <b>ad number</b> (the <code>CD_62</code> / <code>CDa_72</code> code) shown as a badge: a green <b>✓ #CODE</b> means the numbers match (high confidence); an amber <b>✓ Approve</b> is a wording guess to verify first. Nothing is linked until you click approve or pick from the dropdown - <b>ignore a row and it keeps its own identity, untouched.</b> If a row is a legit standalone (e.g. a paused campaign) and not a rename, hit <b>Keep separate</b> to clear it from the list without merging anything.</HelpNote>
      {st.status === 'loading' ? <Spinner label="Scanning for unmatched UTMs (last 90 days)…" />
        : st.status === 'err' ? <p className="cap">Couldn't load campaign / CRM data for this client.</p>
        : !namesLoaded ? <div className="alias-warn"><b>⚠ Couldn't load the current campaign / ad-set / ad names</b> from the ad account, so we can't tell which UTMs are unmatched (everything would look unmatched). This is usually a temporary load issue on a large account.<button className="btn-ghost sm" style={{ marginLeft: 8 }} onClick={() => setSt({ status: 'idle' })}>↻ Retry</button></div>
          : LEVELS.map(([lvl, label, utm]) => {
            const un = unmatched(lvl)
            const fo = folded(lvl)
            const existing = Object.entries(aliases[lvl] || {})
            const keptList = Object.keys(keep[lvl] || {})
            return (
              <div className="kev-group" key={lvl}>
                <div className="kev-pipe">{label} <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {utm}</span></div>
                {existing.length > 0 && <div className="alias-existing">{existing.map(([oldN, cur]) => (
                  <div className="alias-row alias-set" key={oldN}><span className="alias-old" title={oldN}>{oldN}</span><span className="alias-arrow">→</span><span className="alias-cur" title={cur}>{cur}</span><button className="alias-x" title="Remove link" onClick={() => setAlias(clientId, lvl, oldN, '')}>✕</button></div>
                ))}</div>}
                {keptList.length > 0 && <div className="alias-existing">{keptList.map((oldN) => (
                  <div className="alias-row alias-kept" key={oldN}><span className="alias-old" title={oldN}>{oldN}</span><span className="alias-kept-tag">kept separate</span><button className="alias-x" title="Undo - show this UTM in the unmatched list again" onClick={() => setKeep(clientId, lvl, oldN, false)}>✕</button></div>
                ))}</div>}
                {fo.length > 0 && <details className="alias-folded"><summary><b>{fo.length} spelling{fo.length === 1 ? '' : 's'}</b> fold into current names automatically <span className="cap">· same name, different case or punctuation - already counted together everywhere</span></summary>{fo.map((o) => (
                  <div className="alias-row alias-fold" key={o.name}><span className="alias-old" title={o.name}>{o.name} <span className="alias-leads">· {fmtNumber(o.leads)} lead{o.leads === 1 ? '' : 's'}</span></span><span className="alias-arrow">→</span><span className="alias-cur" title={o.cur}>{o.cur}</span></div>
                ))}</details>}
                {un.length === 0 ? <p className="cap" style={{ margin: '2px 0 0' }}>{existing.length ? 'No further unmatched UTMs.' : 'No unmatched UTMs - everything ties to a current name.'}</p>
                  : un.map((o) => {
                    const oc = adCode(o.name)
                    const cand = curList[lvl].map((x) => x.name)
                    const sug = suggestFor(o.name, cand)
                    const sc = sug.value ? adCode(sug.value) : null
                    return (
                      <div className="alias-row" key={o.name}>
                        <span className="alias-old" title={o.name}>{oc ? <span className="alias-code">{oc.toUpperCase()}</span> : null}{o.name} <span className="alias-leads">· {fmtNumber(o.leads)} lead{o.leads === 1 ? '' : 's'}{o.won ? `, ${fmtNumber(o.won)} won` : ''}</span></span>
                        <span className="alias-arrow">→</span>
                        <div className="alias-pick">
                          <select className="camp-lnk alias-sel" value="" onChange={(e) => e.target.value && setAlias(clientId, lvl, o.name, e.target.value)}>
                            <option value="">Not linked - leave as is</option>
                            {[['meta', 'Meta'], ['google', 'Google'], [null, 'Other']].map(([ch, chLbl]) => {
                              const opts = curList[lvl].filter((x) => (ch === null ? !x.channel : x.channel === ch))
                              if (!opts.length) return null
                              return <optgroup key={chLbl} label={chLbl}>{opts.map((x) => { const cc = adCode(x.name); return <option key={x.name} value={x.name}>{cc ? cc.toUpperCase() + ' · ' : ''}{x.name}</option> })}</optgroup>
                            })}
                          </select>
                          {sug.value ? <button className={`alias-ok ${sug.by === 'code' ? 'by-code' : 'by-words'}`} title={`Approve: ${o.name} → ${sug.value}${sug.by === 'code' ? ` (ad-number match ${(sc || '').toUpperCase()})` : ' (wording guess - verify the ad number first)'}`} onClick={() => setAlias(clientId, lvl, o.name, sug.value)}>✓ {sug.by === 'code' ? `#${(sc || '').toUpperCase()}` : 'Approve'} <span className="alias-ok-tgt">{sug.value}</span></button> : null}
                          <button className="alias-keep" title="Not a rename - this is a legit standalone (e.g. a paused campaign). Hide it and keep its data under its own name." onClick={() => setKeep(clientId, lvl, o.name, true)}>Keep separate</button>
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
export function CampaignLinker({ clientId, embedded, nonce }) {
  const [open, setOpen] = useState(!!embedded)
  const [st, setSt] = useState({ status: 'idle', blend: null })
  const [manual, setManual] = useState(() => loadCampMap(clientId))
  useEffect(() => {
    if (!open || st.status !== 'idle') return
    setSt({ status: 'loading', blend: null })
    const r = presetRange('last_30d')
    dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}${nonce ? `&_r=${nonce}` : ''}`)
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
export function TagAudit({ clients }) {
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
          <Caveat>The tag is a lifetime flag on the contact, so the self-booking rate is "share of booked deals whose contact self-booked at least once," sampled from the most recent opportunities. For a per-appointment figure we would add the appointments API. Rate is split by channel in the data if you want it surfaced next.</Caveat>
        </>
      )}
    </div>
  )
}

// Per-client timezone alignment badge. All CRM reporting is bucketed by the
// Caalano Systems location timezone; this shows it and confirms the Meta ad
// account is on the same zone (so Meta and CRM days match).
export function TimezoneBadge({ clientId, hasMeta }) {
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
export function AddClientModal({ existing, editClient, onClose }) {
  const isEdit = !!editClient
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [name, setName] = useState(editClient ? editClient.name : '')
  const [ghl, setGhl] = useState(editClient ? (editClient.ghl || '') : '')
  const [meta, setMeta] = useState(editClient ? (editClient.meta || '') : '')
  const [google, setGoogle] = useState(editClient ? (editClient.google || '') : '')
  const [ga4, setGa4] = useState(editClient ? (editClient.ga4 || '') : '')
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
  const canSave = name.trim() && (meta || google || ghl || (ga4 || '').trim())
  const save = () => {
    if (!canSave) return
    const mapping = {
      name: name.trim(),
      meta: meta || null, google: google || null, ghl: ghl || null, ga4: (ga4 || '').trim() || null,
      metaName: nameOf(d.meta, meta), googleName: nameOf(d.google, google), ghlName: nameOf(d.ghl, ghl), ga4Name: nameOf(d.ga4, ga4),
    }
    saveCustomClient(isEdit ? editClient.id : uniqueId(slug(name)), mapping)
    setSaved(true); setTimeout(onClose, 900)
  }
  const remove = () => { if (isEdit && confirm(`Remove ${editClient.name} from the dashboard? This only removes the mapping; no CRM/ad data is touched.`)) { removeCustomClient(editClient.id); onClose() } }
  // Picking any account fills the client name from that account (unless the user
  // typed their own) - so a Meta-only or Google-only client still gets a name.
  const fillName = (nm) => { if (nm && !nameEdited) setName(nm) }
  const pickGhl = (id) => { setGhl(id); fillName(nameOf(d.ghl, id)) }
  const pickMeta = (id) => { setMeta(id); fillName(nameOf(d.meta, id)) }
  const pickGoogle = (id) => { setGoogle(id); fillName(nameOf(d.google, id)) }
  const pickGa4 = (id) => { setGa4(id); fillName(nameOf(d.ga4, id)) }
  // A selected id that isn't in the discovered list (e.g. a brand-new Windsor
  // account not yet backfilled, or an existing link whose account has no recent
  // activity) still needs to show as selected + be linkable - so the picker also
  // takes a manual ID entry and surfaces any off-list selection at the top.
  const Col = ({ title, items, sel, onSel, empty }) => {
    const inList = !!sel && (items || []).some((it) => normId(it.id) === normId(sel))
    return (
      <div className="addcl-col">
        <div className="addcl-col-h">{title} <span className="addcl-count">{items ? items.length : 0}</span></div>
        <div className="addcl-list">
          {sel && !inList ? (
            <button className="addcl-item on" onClick={() => onSel('')} title={String(sel)}>
              <span className="addcl-nm">Manually linked</span>
              <span className="addcl-meta"><span className="addcl-mapped">selected</span> · <code>{String(sel).slice(0, 20)}</code></span>
            </button>
          ) : null}
          {!items || !items.length ? (sel && !inList ? null : <div className="cap" style={{ padding: 8 }}>{empty}</div>) : items.map((it) => (
            <button key={it.id} className={`addcl-item ${normId(sel) === normId(it.id) ? 'on' : ''}`} onClick={() => onSel(normId(sel) === normId(it.id) ? '' : it.id)} title={it.id}>
              <span className="addcl-nm">{it.name}</span>
              <span className="addcl-meta">{it.mapped ? <span className="addcl-mapped">in use</span> : <span className="addcl-free">available</span>} · <code>{String(it.id).slice(0, 14)}</code></span>
            </button>
          ))}
        </div>
        <input className="addcl-manual" placeholder="or paste an account ID + Enter"
          defaultValue=""
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) { onSel(v); e.target.value = '' } } }}
          onBlur={(e) => { const v = e.target.value.trim(); if (v) { onSel(v); e.target.value = '' } }} />
      </div>
    )
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal addcl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head"><div><h3>{isEdit ? `Edit ${editClient.name}` : 'Add a client'}</h3><span className="cap">Link any mix of Caalano Systems, Meta &amp; Google - you only need one</span></div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn-ghost sm" onClick={refreshAccounts} disabled={refreshing} title="Re-check the Meta / Google / Caalano Systems connections for newly added accounts">{refreshing ? 'Refreshing…' : '⟳ Refresh accounts'}</button><button className="icon-btn" onClick={onClose}>✕</button></div></div>
        <div className="m-body">
          {st.status === 'loading' ? <Spinner label="Exploring available accounts…" />
            : st.status === 'err' ? <div className="cap">Couldn’t load available accounts - <button className="btn-ghost sm" onClick={refreshAccounts}>try again</button>.</div>
              : <>
                <div className="addcl-name">
                  <label>Client name <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· auto-fills from the first account you pick - edit freely</span></label>
                  <input value={name} onChange={(e) => { setName(e.target.value); setNameEdited(true) }} placeholder="Type a name, or pick an account below" />
                </div>
                <div className="addcl-cols">
                  <Col title="🟢 Caalano Systems" items={d.ghl} sel={ghl} onSel={pickGhl} empty={d.ghlErr || (d.connected === false ? 'Caalano Systems not connected.' : 'No locations found.')} />
                  <Col title="🔵 Meta Ads" items={d.meta} sel={meta} onSel={pickMeta} empty={d.metaErr ? `⚠ Windsor Meta connector error - it may need re-authorising in Windsor: ${d.metaErr}` : 'No Meta accounts found yet - a just-connected account can take a while to sync. Paste its ID below to link it now.'} />
                  <Col title="🟩 Google Ads" items={d.google} sel={google} onSel={pickGoogle} empty={d.googleErr ? `⚠ Windsor Google connector error - it may need re-authorising in Windsor: ${d.googleErr}` : 'No Google accounts found yet - a just-connected account can take a while to sync. Paste its ID below to link it now.'} />
                  <Col title="📊 Google Analytics 4" items={d.ga4} sel={ga4} onSel={pickGa4} empty={d.ga4Err ? (/don'?t\s+have\s+this\s+connector/i.test(d.ga4Err) ? `⚠ Windsor doesn't recognise the GA4 connector on this key. Add the "Google Analytics 4" data source in your Windsor account (Data sources → add GA4), then hit Refresh accounts.` : `⚠ Windsor GA4 connector error - it may need re-authorising in Windsor: ${d.ga4Err}`) : 'No GA4 properties found yet from Windsor. Paste the property ID below to link it now.'} />
                </div>
                <div className="addcl-status cap">
                  {d.connected === false ? <span className="addcl-stat-bad">● Caalano Systems not connected</span> : <span className="addcl-stat-ok">● Live from Windsor</span>}
                  {d.fetchedAt ? <> · refreshed {new Date(d.fetchedAt).toLocaleTimeString()}</> : null}
                  {' · '}{fmtNumber((d.meta || []).length)} Meta · {fmtNumber((d.google || []).length)} Google · {fmtNumber((d.ga4 || []).length)} GA4 · {fmtNumber((d.ghl || []).length)} CRM accounts visible
                  {d.metaErr || d.googleErr ? <span className="addcl-stat-bad"> · a connector is erroring (see above)</span> : null}
                </div>
                <div className="addcl-foot">
                  {isEdit ? <button className="addcl-remove" onClick={remove}>Remove client</button> : <span className="cap">{!name.trim() ? 'Add a name to continue.' : (ghl || meta || google || (ga4 || '').trim()) ? `Linking${ghl ? ' CRM' : ''}${meta ? ' · Meta' : ''}${google ? ' · Google' : ''}${(ga4 || '').trim() ? ' · GA4' : ''}` : 'Pick at least one account (any one is fine).'}</span>}
                  <button className="addcl-save" disabled={!canSave || saved} onClick={save}>{saved ? '✓ Saved' : (isEdit ? 'Save changes' : 'Add client')}</button>
                </div>
                <Caveat style={{ marginTop: 10 }}>You only need <b>one</b> account linked - a Meta-only (or Google-only, or CRM-only) client is fine. Saved to the shared settings store and merged in immediately. Meta / Google accounts come from Windsor (any account with activity in the last 12 months); Caalano Systems locations from the agency connection. <b>New account not showing?</b> Windsor only lists an account here once it has <b>synced data with activity in the last 12 months</b> - so a just-connected account (still backfilling) or a dormant one with no recent spend won't appear yet, even though Windsor may count it as "connected". That's why the numbers here can be lower than the account totals in your Windsor dashboard. In the meantime, paste its <b>account ID</b> into the box under the relevant column to link it right away, or hit <b>Refresh accounts</b>.</Caveat>
              </>}
        </div>
      </div>
    </div>
  )
}
// --- Auto-onboard --------------------------------------------------------
// Name-normaliser + similarity for matching a GHL location to its Meta / Google
// ad accounts. Strips punctuation and common legal/industry filler so
// "Quad Care Pty Ltd" ~ "Quad Care - ADHD" still match on their real name.
export const AO_STOP = new Set(['pty', 'ltd', 'inc', 'llc', 'co', 'the', 'group', 'and', 'pl'])
export const aoTokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !AO_STOP.has(t)))
export const aoSim = (a, b) => { const A = aoTokens(a), B = aoTokens(b); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / Math.max(A.size, B.size) }
export const aoBest = (name, list) => { let best = null, score = 0; for (const it of list) { const s = aoSim(name, it.name); if (s > score) { score = s; best = it } } return score >= 0.5 ? { id: best.id, name: best.name, score } : null }
export const aoSlug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client'
// Auto-onboard modal: pulls every GHL agency location + Windsor Meta/Google
// account, fuzzy-matches each unmapped location to its ad accounts, and lets you
// confirm + create them all in one pass. The closest thing to "install to a
// sub-account and it connects" with the accounts we can already see.
export function AutoOnboardModal({ existing, onClose }) {
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const load = (force) => {
    setSt({ status: 'loading', data: null })
    const scanUrl = `/.netlify/functions/windsor?scope=onboardscan${force ? `&_r=${Date.now()}` : ''}`
    Promise.all([
      fetchDiscover(force),
      apiJson(scanUrl, { timeoutMs: 25000, tries: 1 }).catch(() => ({ locations: [] })),
    ]).then(([d, scan]) => {
      setSt({ status: 'ok', data: d })
      // Readiness per location: true = API reachable (app installed), false = app
      // not installed on that sub-account, null/undefined = not scanned/unknown.
      const readyMap = {}
      for (const l of (scan.locations || [])) readyMap[normId(l.id)] = l.ready
      const mapped = new Set()
      for (const c of existing || []) { if (c.ghl) mapped.add(normId(c.ghl)) }
      const meta = d.meta || [], google = d.google || []
      // Anchor on GHL locations not already linked to a client; suggest the best
      // Meta + Google match for each. Default-select only the API-ready ones.
      const next = (d.ghl || []).filter((l) => !mapped.has(normId(l.id)) && !l.mapped).map((l) => {
        const m = aoBest(l.name, meta.filter((x) => !x.mapped)) || aoBest(l.name, meta)
        const g = aoBest(l.name, google.filter((x) => !x.mapped)) || aoBest(l.name, google)
        const ready = normId(l.id) in readyMap ? readyMap[normId(l.id)] : null
        return { ghlId: l.id, ghlName: l.name, name: l.name, meta: m ? m.id : '', google: g ? g.id : '', sel: ready !== false, matchM: m ? Math.round(m.score * 100) : null, matchG: g ? Math.round(g.score * 100) : null, ready }
      }).sort((a, b) => (a.ready === false) - (b.ready === false) || String(a.name).localeCompare(String(b.name)))
      setRows(next)
    }).catch(() => setSt({ status: 'err', data: null }))
  }
  useEffect(() => { load(false) /* eslint-disable-next-line */ }, [])
  const d = st.data || {}
  const metaList = d.meta || [], googleList = d.google || []
  const nameOf = (list, id) => { const it = list.find((x) => normId(x.id) === normId(id)); return it ? it.name : null }
  const upd = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const selected = rows.filter((r) => r.sel && r.ready !== false)
  const notReady = rows.filter((r) => r.ready === false).length
  const createAll = async () => {
    if (!selected.length || busy) return
    setBusy(true); let n = 0
    const taken = new Set((existing || []).map((c) => c.id))
    for (const r of selected) {
      let base = aoSlug(r.name), id = base, k = 2
      while (taken.has(id)) id = `${base}-${k++}`
      taken.add(id)
      saveCustomClient(id, {
        name: r.name.trim() || r.ghlName, meta: r.meta || null, google: r.google || null, ghl: r.ghlId || null,
        metaName: nameOf(metaList, r.meta), googleName: nameOf(googleList, r.google), ghlName: r.ghlName,
      })
      n++; setDone(n)
    }
    setBusy(false); setTimeout(onClose, 700)
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal addcl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div><h3>✨ Auto-onboard clients</h3><span className="cap">Every Caalano Systems location that isn’t linked yet, matched to its Meta &amp; Google ad accounts</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn-ghost sm" onClick={() => load(true)} disabled={st.status === 'loading'}>⟳ Refresh</button><button className="icon-btn" onClick={onClose}>✕</button></div>
        </div>
        <div className="m-body">
          {st.status === 'loading' ? <Spinner big label="Scanning your Caalano Systems, Meta &amp; Google accounts…" />
            : st.status === 'err' ? <div className="cap">Couldn’t load accounts - <button className="btn-ghost sm" onClick={() => load(true)}>try again</button>.</div>
              : rows.length === 0 ? <div className="empty-deep" style={{ padding: '26px 10px' }}><div className="big">✓</div><b>Every Caalano Systems location is already linked to a client.</b><p className="cap">New sub-account? Install the app on it and add its ad account to your Meta Business Manager + Windsor, then hit Refresh.</p></div>
                : (<>
                  <p className="cap" style={{ marginTop: 0 }}>{rows.length} unlinked location{rows.length === 1 ? '' : 's'} found. Review the suggested Meta / Google matches (green = confident), untick any you don’t want, then create them all. You can fine-tune links afterwards on each client.{notReady ? <> <b style={{ color: 'var(--warn)' }}>{notReady} can’t be onboarded yet</b> - the marketplace app isn’t installed on those sub-accounts, so the API can’t reach them. Install it (or enable “install on all sub-accounts” in your Caalano Systems app) and hit Refresh.</> : null}</p>
                  <div className="ao-table">
                    <div className="ao-h"><span /><span>Client name</span><span>Caalano Systems</span><span>Meta</span><span>Google</span></div>
                    {rows.map((r, i) => (
                      <div className={`ao-row${r.sel && r.ready !== false ? '' : ' off'}`} key={r.ghlId}>
                        <label className="ao-chk"><input type="checkbox" checked={r.sel && r.ready !== false} disabled={r.ready === false} onChange={() => upd(i, { sel: !r.sel })} /></label>
                        <input className="ao-name" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} disabled={r.ready === false} />
                        <span className="ao-ghl" title={r.ghlId}>{r.ghlName}{r.ready === false ? <span className="ao-badge weak" title="Install the marketplace app on this sub-account to enable API access">⚠ app not installed</span> : r.ready === true ? <span className="ao-badge good">✓ API ready</span> : null}</span>
                        <span className="ao-sel">
                          <select value={r.meta} onChange={(e) => upd(i, { meta: e.target.value })}><option value="">- none -</option>{metaList.map((m) => <option key={m.id} value={m.id}>{m.name}{m.mapped ? ' (in use)' : ''}</option>)}</select>
                          {r.matchM != null && r.meta ? <span className={`ao-badge ${r.matchM >= 60 ? 'good' : 'weak'}`}>{r.matchM}%</span> : null}
                        </span>
                        <span className="ao-sel">
                          <select value={r.google} onChange={(e) => upd(i, { google: e.target.value })}><option value="">- none -</option>{googleList.map((g) => <option key={g.id} value={g.id}>{g.name}{g.mapped ? ' (in use)' : ''}</option>)}</select>
                          {r.matchG != null && r.google ? <span className={`ao-badge ${r.matchG >= 60 ? 'good' : 'weak'}`}>{r.matchG}%</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="addcl-foot">
                    <span className="cap">{selected.length} of {rows.length} selected{busy ? ` · creating ${done}/${selected.length}…` : ''}</span>
                    <button className="addcl-save" disabled={!selected.length || busy} onClick={createAll}>{busy ? 'Creating…' : `Create ${selected.length} client${selected.length === 1 ? '' : 's'}`}</button>
                  </div>
                  <Caveat style={{ marginTop: 10 }}>Matches are by account name - a location with no confident ad-account match is created CRM-only, which is fine (link Meta/Google later). Meta/Google accounts only appear once Windsor has synced them, so add the ad account to your Business Manager + Windsor first if it’s missing.</Caveat>
                </>)}
        </div>
      </div>
    </div>
  )
}
// An account chip that shows the account NAME (resolved from discovery) with the
// raw id underneath, so mis-links are obvious at a glance.
export function AccountTag({ label, id, name }) {
  if (!id) return <span className="idtag">{label} <b>-</b></span>
  return <span className="idtag has" title={String(id)}>{label} <b>{name || id}</b>{name ? <code className="idtag-id">{id}</code> : null}</span>
}
// Per-client setup health for the compact status strip on each Settings card.
// ok (green ✓) / warn (amber !) / bad (red ✗).
export function clientHealth(c) {
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
export const CRM_LOGO = 'https://assets.cdn.filesafe.space/4iJNxErzfROlH5M5akcm/media/694b2a2bd573507fc6f55bd6.png'
export const STATE_TXT = { ok: 'connected / done', warn: 'needs attention', bad: 'not connected' }
export function HealthIcon({ h }) {
  if (!h.img) return <span className="sth-ic">{h.ic}</span>
  return <span className="sth-ic"><img src={h.img} alt="" width="16" height="16" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /></span>
}
export function HealthStrip({ c }) {
  return (
    <div className="set-health">
      {clientHealth(c).map((h) => (
        <span key={h.label} className="sth" title={`${h.label} - ${STATE_TXT[h.state]}`}>
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
export function LogoSyncButton() {
  const [state, setState] = useState('idle') // idle | syncing | done | err
  const go = () => { setState('syncing'); syncLogos({ force: true }).then((ok) => setState(ok ? 'done' : 'err')).catch(() => setState('err')) }
  const label = state === 'syncing' ? '⟳ Syncing logos…' : state === 'done' ? '✓ Logos synced' : state === 'err' ? '⚠ Retry logos' : '🖼 Sync logos'
  return <button className="set-add ghost" onClick={go} disabled={state === 'syncing'} title="Pull each business's website + logo from Caalano Systems and use it as their avatar everywhere">{label}</button>
}
export const SET_FILTERS = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['deleted', 'Deleted']]
// Global creative-fatigue thresholds - one shared set, applied to every active
// Meta client's fatigue read (Cockpit badges + the Meta Creative Fatigue tab).
export function FatigueSettings() {
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
      <HelpNote>One shared set of rules, applied live to every active Meta client. A creative scores points for high frequency, a falling click-through rate, and a below-average quality ranking: <b>2+ points = High 🔥</b>, <b>1 point = Medium 👀</b>. Changes save to the server and apply on the next load.</HelpNote>
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
export function SocialKpiSettings({ clients }) {
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
      <HelpNote>Set each client's <b>monthly</b> organic-social targets. They're scored against the latest month on the Blended view of Organic Social → <b>KPIs &amp; Trends</b>. Saved to the server and shared with the team.</HelpNote>
      <div className="pipe-sel" style={{ marginBottom: 12 }}><label>Client</label>
        <select value={cid} onChange={(e) => setCid(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="soc-kpiset-grid">
        {FIELDS.map((f) => (
          <label className="soc-kpiset" key={f.k}>
            <span>{f.label}{f.hint ? <em> · {f.hint}</em> : null}</span>
            <input type="number" min="0" value={cur[f.k] ?? ''} placeholder="-" onChange={(e) => set(f.k, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  )
}
// A small on/off switch (accessible) reused across Settings.
export function Toggle({ on, onChange, sm, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} disabled={disabled} className={`tgl${on ? ' on' : ''}${sm ? ' sm' : ''}`} onClick={() => onChange(!on)}>
      <span className="tgl-knob" />
    </button>
  )
}
// Settings → Daily performance: per-client (and per-pipeline) visibility on the Daily
// Performance tab. Pulls the same trends feed the tab uses to know each client's
// channels + pipelines; toggles persist via the shared settings store.
export function DailyPerfSettings({ clients }) {
  useSettingsSync()
  const [st, setSt] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true
    fetch('/.netlify/functions/windsor?scope=trends')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setSt({ status: j && j.clients ? 'ok' : 'err', data: j }) })
      .catch(() => { if (alive) setSt({ status: 'err', data: null }) })
    return () => { alive = false }
  }, [])
  if (st.status === 'loading') return <div className="card"><Spinner label="Loading Daily Performance clients…" /></div>
  if (st.status === 'err' || !st.data || !st.data.clients) return <div className="card"><p className="cap" style={{ margin: 0 }}>Couldn't load the Daily Performance client list - try Refresh.</p></div>
  const tc = st.data.clients
  const list = (clients || [])
    .filter((c) => tc[c.id] && (tc[c.id].hasMeta || tc[c.id].hasGoogle) && !isClientDeleted(c.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  const shown = list.filter((c) => dpClientOn(c.id)).length
  const setAll = (on) => { for (const c of list) setDpClient(c.id, on) }
  return (
    <div className="card dp-set">
      <h3 style={{ marginTop: 0 }}>Daily performance visibility</h3>
      <HelpNote>Choose which clients appear on the <b>Daily Performance</b> tab - and, for clients running more than one pipeline, which pipeline tiles show. Everything is on by default. Saved to the server &amp; shared across your team.</HelpNote>
      <div className="dp-bar">
        <span className="dp-count">{shown} of {list.length} clients shown</span>
        <div className="dp-bulk"><button onClick={() => setAll(true)}>Show all</button><button onClick={() => setAll(false)}>Hide all</button></div>
      </div>
      <div className="dp-list">
        {list.map((c) => {
          const t = tc[c.id]
          const on = dpClientOn(c.id)
          const pipes = (t.pipelines || []).filter((p) => !p.unlinked)
          return (
            <div className={`dp-row${on ? '' : ' is-off'}`} key={c.id}>
              <div className="dp-row-h">
                <Toggle on={on} onChange={(v) => setDpClient(c.id, v)} />
                <span className="dp-nm">{c.name}</span>
                <span className="dp-tags cap">{t.hasMeta ? 'Meta' : ''}{t.hasMeta && t.hasGoogle ? ' · ' : ''}{t.hasGoogle ? 'Google' : ''}{pipes.length > 1 ? ` · ${pipes.length} pipelines` : ''}</span>
              </div>
              {on && pipes.length > 1 ? (
                <div className="dp-pipes">
                  {pipes.map((p) => (
                    <label className="dp-pipe" key={p.id}>
                      <Toggle on={dpPipeOn(c.id, p.id)} onChange={(v) => setDpPipe(c.id, p.id, v)} sm />
                      <span className="dp-pipe-nm">{p.name}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
        {!list.length ? <p className="cap" style={{ margin: 0 }}>No clients with Meta or Google ad data to configure.</p> : null}
      </div>
    </div>
  )
}
// Parse CHANGELOG.md (bundled at build time) into version entries for the Logs
// panel. Each release is a `## vX.Y.Z - date · `status` - title` block followed
// by `- ` bullet lines.
// Two shapes are in the file: older releases put a title on the heading and
// `- ` bullets underneath; newer ones have `## vX.Y.Z - date · \`hash\`` and
// paragraphs that open with a bold lead ("**What changed** - detail"). Both
// come out as a title plus one line per change.
export function parseChangelog(raw) {
  const strip = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
  return String(raw || '').split(/\n## /).slice(1).map((block) => {
    const nl = block.indexOf('\n')
    const head = (nl === -1 ? block : block.slice(0, nl)).trim()
    const body = nl === -1 ? '' : block.slice(nl + 1)
    const m = head.match(/^(v[\d.]+)\s*-\s*(\d{4}-\d{2}-\d{2})?\s*(?:·\s*`?([^`\s]*)`?)?\s*(?:-\s*(.+))?$/)
    const lines = body.split('\n')
    const bullets = lines.map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => strip(l.replace(/^-\s*/, '')))
    // Paragraphs: blank-line separated, ignoring bullet lines and the --- rule.
    const paras = body.split(/\n\s*\n/).map((pp) => pp.split('\n').filter((l) => !/^\s*-\s/.test(l) && !/^---\s*$/.test(l.trim())).join(' ').trim()).filter(Boolean)
    const leads = paras.map((pp) => { const mm = pp.match(/^\*\*(.+?)\*\*\s*[-–:]?\s*(.*)$/); return mm ? { lead: strip(mm[1]), text: strip(mm[2]) } : { lead: '', text: strip(pp) } })
    const items = bullets.length ? bullets : leads.map((x) => (x.lead ? `${x.lead}: ${x.text}` : x.text))
    const title = (m && m[4] && m[4].trim()) || (leads[0] && leads[0].lead) || (items[0] || '').slice(0, 80) || head
    return m
      ? { version: m[1], date: (m[2] || '').trim(), status: (m[3] || '').trim(), title, bullets: items }
      : { version: head.split(/\s/)[0], date: '', status: '', title, bullets: items }
  })
}
// Human labels for the top-level views, for the activity trail.
export const VIEW_LABEL = {
  overview: 'Agency Overview', trends: 'Trends', weekly: 'Weekly Traffic Light', forecast: 'Funnel Forecaster', cockpit: 'Creative Cockpit',
  insights: 'Meta Insights', update: 'Client Update', monthly: 'Monthly Report', reports: 'Monthly Reports',
  social: 'Organic Social Media', settings: 'Settings', clients: 'Client workspace',
}
export const auditMins = (n) => (n == null ? null : n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${n % 60}m`)
export const auditAgo = (ms) => {
  if (!ms) return null
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`
}
// Logs - Super-Admin only. Two views: build/version history (from CHANGELOG.md)
// and the live reliability failure log (server-side ring buffer).
// One-click backup from Settings → Logs: the same file the backup-export
// function serves, fetched with the session cookie and saved, so nobody has to
// type a function URL. Three flavours: config only, with the CRM token (goes
// in the password manager), with the logs (bulky).
// One quiet line: when the daily backup last ran. The download buttons that
// used to sit here are gone - the backup is automatic now and the file holds
// everything sensitive, so it is not something to leave a button for on a
// page people share screenshots of. Superadmins can still fetch it by URL
// (see BACKUP.md).
export function BackupStatus() {
  const [st, setSt] = useState(null)
  useEffect(() => {
    let dead = false
    fetch('/.netlify/functions/settings-backup-now?status=1&format=json', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) setSt(j || { error: true }) }).catch(() => { if (!dead) setSt({ error: true }) })
    return () => { dead = true }
  }, [])
  if (!st) return null
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso || 0)) / 60000); return !isFinite(m) ? 'never' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
  let text, cls = ''
  if (st.error) { text = 'Daily backup status unavailable.'; cls = 'logs-backup-err' }
  else if (!st.configured) { text = 'Daily backup is not set up (BACKUP_GH_TOKEN / BACKUP_GH_REPO).'; cls = 'logs-backup-err' }
  else if (!st.last) text = 'Daily backup: has not run yet.'
  else if (st.last.state === 'ok') { const r = st.last.result || {}; text = `Daily backup: last succeeded ${ago(st.last.finishedAt)} (${r.files || 0} files, ${Math.round((r.bytes || 0) / 1024)} KB).`; cls = 'logs-backup-ok' }
  else if (st.last.state === 'running') text = `Daily backup: running (started ${ago(st.last.startedAt)}).`
  else { text = `Daily backup: last run ${st.last.state} ${ago(st.last.finishedAt)}${st.last.error ? ` - ${st.last.error}` : ''}.`; cls = 'logs-backup-err' }
  return <p className={`cap logs-backup-line ${cls}`}>{text} <a href="/.netlify/functions/settings-backup-now?status=1" target="_blank" rel="noreferrer">Details</a></p>
}

export function LogsPanel({ clients }) {
  const [tab, setTab] = useState('versions')
  const nameOf = (id) => { const c = (clients || []).find((x) => x.id === id); return c ? c.name : (id ? `…${String(id).slice(-6)}` : '-') }
  // Load the (large) changelog markdown on demand instead of inlining it into the
  // main bundle for every visitor - this panel is Super-Admin only.
  const [changelogRaw, setChangelogRaw] = useState('')
  const [clState, setClState] = useState('loading') // loading | ok | err
  // The changelog ships as its own lazy chunk. After a fresh deploy a browser can
  // still be running the previous index.html, which points at the OLD chunk hash -
  // that 404s and, if swallowed silently, the panel just shows "0 releases". Load
  // it explicitly with a visible error + retry so a stale page is obvious (and a
  // reload fixes it) instead of looking like the history vanished.
  const clAlive = useRef(true)
  const loadChangelog = React.useCallback(() => {
    setClState('loading')
    // Fetched from a Super-Admin-only function rather than bundled. As an
    // import it became a 343KB chunk under /assets/, which is served without a
    // session - so the whole development history, naming clients and explaining
    // every calculation, was readable by anyone who found the URL.
    fetch('/.netlify/functions/changelog')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => { if (clAlive.current) { setChangelogRaw(txt || ''); setClState((txt || '').trim() ? 'ok' : 'err') } })
      .catch(() => { if (clAlive.current) setClState('err') })
  }, [])
  useEffect(() => { clAlive.current = true; loadChangelog(); return () => { clAlive.current = false } }, [loadChangelog])
  const versions = useMemo(() => parseChangelog(changelogRaw), [changelogRaw])
  const [log, setLog] = useState({ status: 'idle' })
  const [days, setDays] = useState(3)
  const loadLog = () => {
    setLog({ status: 'loading' })
    apiJson(`/.netlify/functions/windsor?scope=diaglog&days=${days}&_r=${Date.now()}`, { timeoutMs: 20000, tries: 1 })
      .then((j) => setLog({ status: j && j.error ? 'err' : 'ok', data: j }))
      .catch((e) => setLog({ status: 'err', data: { error: String(e.message || e) } }))
  }
  useEffect(() => { if (tab === 'failures') loadLog() /* eslint-disable-next-line */ }, [tab, days])
  // Navigation audit trail.
  const [audit, setAudit] = useState({ status: 'idle' })
  const [aDays, setADays] = useState(7)
  const [aUser, setAUser] = useState('')
  const loadAudit = () => {
    setAudit({ status: 'loading' })
    apiJson(`/.netlify/functions/windsor?scope=auditlog&days=${aDays}${aUser ? `&user=${encodeURIComponent(aUser)}` : ''}&_r=${Date.now()}`, { timeoutMs: 20000, tries: 1 })
      .then((j) => setAudit({ status: j && j.error ? 'err' : 'ok', data: j }))
      .catch(() => setAudit({ status: 'err' }))
  }
  useEffect(() => { if (tab === 'activity') loadAudit() /* eslint-disable-next-line */ }, [tab, aDays, aUser])
  const sevMeta = { error: ['✗', 'bad', 'Error'], 'error-stale': ['◐', 'warn', 'Error (served cached)'], slow: ['⏱', 'warn', 'Slow'], client: ['◱', 'bad', 'Browser'] }
  // Download the current reliability log (with resolved client names) as a JSON
  // file - so it can be handed off for diagnosis without needing live log access.
  const exportLog = (fmt) => {
    const d = (log && log.data) || {}
    const entries = (d.entries || []).map((e) => ({ when: new Date(e.t).toISOString(), sev: e.sev, scope: e.scope, client: nameOf(e.client), clientId: e.client || null, user: e.user || null, userName: e.userName || null, userRole: e.userRole || null, ms: e.ms != null ? e.ms : null, ageMs: e.ageMs != null ? e.ageMs : null, cache: e.cache || null, where: e.where || null, q: e.q || null, error: e.error || null }))
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    let blob, name
    if (fmt === 'csv') {
      const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
      const head = ['when', 'sev', 'scope', 'client', 'user', 'userName', 'userRole', 'ms', 'ageMs', 'cache', 'where', 'q', 'error']
      const lines = [head.join(','), ...entries.map((e) => head.map((k) => esc(e[k])).join(','))]
      blob = new Blob([lines.join('\n')], { type: 'text/csv' }); name = `caalano360-reliability-log-${days}d-${stamp}.csv`
    } else {
      const payload = { exportedAt: new Date().toISOString(), appVersion: APP_VERSION, windowDays: days, count: d.count != null ? d.count : entries.length, summary: d.summary || {}, entries }
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); name = `caalano360-reliability-log-${days}d-${stamp}.json`
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const canExport = log.status === 'ok' && log.data && Array.isArray(log.data.entries) && log.data.entries.length > 0
  return (
    <div className="logs-panel">
      <div className="card">
        <div className="logs-head">
          <div><h3 style={{ margin: 0 }}>Logs</h3><p className="cap" style={{ margin: '4px 0 0' }}>Super-Admin only. Build history, the reliability log, and where each person has been in the app.</p></div>
          <div className="chan-toggle">
            <button className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>Build versions</button>
            <button className={tab === 'failures' ? 'on' : ''} onClick={() => setTab('failures')}>Failure logs</button>
            <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity trail</button>
          </div>
        </div>
        <BackupStatus />
      </div>
      {tab === 'versions' && (
        <div className="card">
          <div className="cap" style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>Version history <span style={{ fontWeight: 400 }}>· {clState === 'ok' ? `${versions.length} releases · ` : ''}current <b>v{APP_VERSION}</b></span></span>
            {clState === 'err' && <button className="set-add" onClick={loadChangelog}>↻ Retry</button>}
          </div>
          {clState === 'loading' && <Spinner label="Loading version history…" />}
          {clState === 'err' && (
            <div className="cap" style={{ padding: '4px 2px 8px', lineHeight: 1.5 }}>
              Couldn't load the changelog. This usually means the page is running an older cached build after a fresh
              deploy - the version file it points to has rotated. <b>Hard-refresh</b> the app (Cmd/Ctrl+Shift+R), or
              <button className="btn-ghost sm" style={{ margin: '0 4px' }} onClick={() => window.location.reload()}>reload now</button>
              then reopen this panel.
            </div>
          )}
          <div className="logs-ver">
            {versions.map((v) => (
              <div className="logs-verrow" key={v.version}>
                <div className="logs-vermeta">
                  <span className="logs-ver">{v.version}</span>
                  {v.date && <span className="logs-verdate">{fmtDMY(v.date)}</span>}
                  {v.status && <span className={`logs-verstat ${/pending/i.test(v.status) ? 'pend' : 'live'}`}>{/pending/i.test(v.status) ? 'PENDING' : v.status}</span>}
                </div>
                <div className="logs-verbody">
                  <div className="logs-vertitle">{v.title}</div>
                  {v.bullets.length > 0 && <ul>{v.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'activity' && (
        <>
          <div className="card">
            <div className="u-head-row">
              <div>
                <h3 style={{ margin: 0 }}>Activity trail</h3>
                <p className="cap terms-reg-intro" style={{ margin: '4px 0 0', maxWidth: 760 }}>
                  Where each person went and how long they stayed - views, clients and tabs. Navigation only: within-page
                  clicks aren&rsquo;t recorded. Kept for 90 days. Disclosed in clause 6 of the terms everyone signs.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="inp sm" value={aUser} onChange={(e) => setAUser(e.target.value)} title="Filter to one person">
                  <option value="">Everyone</option>
                  {(audit.data && audit.data.summary || []).map((u) => <option key={u.user} value={u.user}>{u.name || u.user}</option>)}
                </select>
                <div className="chan-toggle">
                  {[1, 7, 30].map((d) => <button key={d} className={aDays === d ? 'on' : ''} onClick={() => setADays(d)}>{d}d</button>)}
                </div>
                <button className="btn-ghost sm" onClick={loadAudit}>Refresh</button>
              </div>
            </div>
            {audit.status === 'loading' ? <Spinner label="Loading the trail…" />
              : audit.status === 'err' ? <p className="cap">Couldn&rsquo;t load the activity trail.</p>
                : !(audit.data && audit.data.summary || []).length ? <p className="cap">Nothing recorded yet. Activity appears here as people use the app.</p>
                  : (
                    <div className="table-wrap" style={{ marginTop: 12 }}><table className="mini-tbl appt-tbl users-tbl">
                      <thead><tr><th className="lft">Person</th><th className="lft">Role</th><th className="lft">Views</th><th className="lft">Time</th><th className="lft">Accounts opened</th><th className="lft">Last seen</th></tr></thead>
                      <tbody>{(audit.data.summary || []).map((u) => (
                        <tr key={u.user} className="terms-row" onClick={() => setAUser(u.user === aUser ? '' : u.user)} title="Filter the timeline to this person">
                          <td className="lft">{u.name || u.user}<small style={{ display: 'block', color: 'var(--faint)' }}>{u.user}</small></td>
                          <td className="lft"><span className={`u-role-tag r-${u.role}`}>{roleLabelOf(u) || '-'}</span></td>
                          <td className="lft">{u.views}</td>
                          <td className="lft">{auditMins(Math.round(u.ms / 60000))}</td>
                          <td className="lft" title={(u.clientList || []).map(nameOf).join(', ')}>{u.clients || '-'}</td>
                          <td className="lft">{auditAgo(u.last) || '-'}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
          </div>
          {audit.status === 'ok' && (audit.data.entries || []).length ? (
            <div className="card">
              <div className="cap" style={{ fontWeight: 700, marginBottom: 8 }}>
                Timeline{aUser ? ` · ${aUser}` : ''} · {audit.data.count} event{audit.data.count === 1 ? '' : 's'} over {aDays}d
                {audit.data.count > (audit.data.entries || []).length ? ` · showing the most recent ${(audit.data.entries || []).length}` : ''}
              </div>
              <div className="table-wrap"><table className="mini-tbl appt-tbl logs-tbl">
                <thead><tr><th className="lft">When</th><th className="lft">Person</th><th className="lft">Where</th><th className="lft">Account</th><th className="lft">Stayed</th></tr></thead>
                <tbody>{(audit.data.entries || []).map((e, i) => (
                  <tr key={i}>
                    <td className="lft">{new Date(e.t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="lft logs-who">{e.userName || e.user || <span className="cap">-</span>}{e.userRole ? <small>{ROLE_LABEL[e.userRole] || e.userRole}</small> : null}</td>
                    <td className="lft">{VIEW_LABEL[e.view] || e.view}{e.tab ? <span className="aud-tab">{(TAB_OPTIONS.find((t) => t.id === e.tab) || {}).label || e.tab}</span> : null}</td>
                    <td className="lft">{e.client ? nameOf(e.client) : <span className="cap">-</span>}</td>
                    <td className="lft">{e.ms > 1000 ? (e.ms >= 60000 ? auditMins(Math.round(e.ms / 60000)) : `${Math.round(e.ms / 1000)}s`) : '-'}{e.ref === 'close' ? <small>left</small> : null}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          ) : null}
        </>
      )}
      {tab === 'failures' && (
        <div className="card">
          <div className="logs-head" style={{ marginBottom: 8 }}>
            <div className="cap" style={{ fontWeight: 700 }}>Reliability log <span style={{ fontWeight: 400 }}>· failures &amp; slow builds (&gt;6s), newest first</span></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="chan-toggle">{[1, 3, 7, 14].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>)}</div>
              <button className="set-add" onClick={loadLog}>↻ Refresh</button>
              <button className="set-add" onClick={() => exportLog('json')} disabled={!canExport} title={canExport ? 'Download the log as JSON (best for sharing / diagnosis)' : 'Nothing to export yet'}>⭳ Export JSON</button>
              <button className="set-add" onClick={() => exportLog('csv')} disabled={!canExport} title={canExport ? 'Download the log as CSV (opens in Excel/Sheets)' : 'Nothing to export yet'}>⭳ CSV</button>
            </div>
          </div>
          {log.status === 'loading' && <Spinner label="Loading reliability log…" />}
          {log.status === 'err' && <div className="cap">Couldn't load the log: {log.data && log.data.error}</div>}
          {log.status === 'ok' && (log.data.count === 0
            ? <div className="empty-deep" style={{ padding: '26px 10px' }}><div className="big">✓</div><b>No failures or slow builds in the last {days} day{days === 1 ? '' : 's'}.</b><p className="cap">Everything served within budget. Entries appear here automatically when something times out, errors, or runs slow.</p></div>
            : (<>
              <div className="logs-summary">{Object.entries(log.data.summary || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [sev, scope] = k.split('|'); const sm = sevMeta[sev] || ['•', '', sev]; return <span key={k} className={`logs-chip ${sm[1]}`}>{sm[0]} {scope} <b>{n}</b></span> })}</div>
              {/* Who was hit. One person dominating the list usually means their
                  session, client mix or filters - not a system-wide fault. */}
              {(() => {
                const by = new Map()
                for (const e of (log.data.entries || [])) {
                  const k = e.user || null
                  const cur = by.get(k) || { n: 0, name: e.userName || e.user || null }
                  cur.n++; by.set(k, cur)
                }
                const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n)
                if (rows.length < 2 && rows[0] && rows[0][0] == null) return null
                return <div className="logs-summary logs-who-sum">{rows.map(([k, v]) => (
                  <span key={k || 'system'} className="logs-chip" title={k || 'Scheduled jobs, warmers and unauthenticated requests'}>👤 {k ? (v.name || k) : 'system'} <b>{v.n}</b></span>
                ))}</div>
              })()}
              <div className="table-wrap"><table className="mini-tbl logs-tbl">
                <thead><tr><th className="lft">When</th><th className="lft">Type</th><th className="lft">Scope</th><th className="lft">Client</th><th className="lft">Who</th><th>ms</th><th className="lft">Detail</th></tr></thead>
                <tbody>{log.data.entries.map((e, i) => { const sm = sevMeta[e.sev] || ['•', '', e.sev]; return (
                  <tr key={i}>
                    <td className="lft logs-when">{new Date(e.t).toLocaleString('en-AU')}</td>
                    <td className="lft"><span className={`logs-chip ${sm[1]}`}>{sm[0]} {sm[2]}</span></td>
                    <td className="lft">{e.scope}</td>
                    <td className="lft">{nameOf(e.client)}</td>
                    <td className="lft logs-who" title={e.user ? `${e.user}${e.userRole ? ` · ${ROLE_LABEL[e.userRole] || e.userRole}` : ''}` : 'No signed-in user - a scheduled job, a warmer, or a request made before sign-in'}>
                      {e.user ? <>{e.userName || e.user}{e.userRole ? <small>{ROLE_LABEL[e.userRole] || e.userRole}</small> : null}</> : <span className="cap">system</span>}
                    </td>
                    <td>{e.ms != null ? fmtNumber(e.ms) : '-'}</td>
                    <td className="lft logs-detail">{e.error || (e.sev === 'slow' ? 'Slow build (approaching the 10s function limit)' : '')}{e.ageMs != null ? ` · served cached ${Math.round(e.ageMs / 60000)}m old` : ''}{e.where ? <span className="logs-where"> · {e.where}</span> : ''}{e.q ? <span className="logs-where"> · {e.q}</span> : ''}</td>
                  </tr>
                ) })}</tbody>
              </table></div>
              <Caveat style={{ marginTop: 10 }}>Rolling log, ~400 entries/day, kept ~60 days. <b>Slow</b> = a build over 6s (close to the 10s function ceiling - a caching candidate). <b>Error (served cached)</b> = a rebuild failed but the user still saw the last good data instead of an error.</Caveat>
            </>))}
        </div>
      )}
    </div>
  )
}
// Settings -> CRM connection: one place for everything about the agency's
// Caalano Systems link. Connection status and how to (re)connect at agency
// level, the CRM web address every Open in CRM link uses, and for a Super
// Admin the live-events webhook. In the SaaS this is the Connections card.
export function CrmConnectionSection({ isSuper, clients }) {
  const [st, setSt] = useState({ loading: true })
  const [hook, setHook] = useState(null)
  const firstClient = (clients || []).find((c) => c.ghl) || (clients || [])[0]
  const load = () => { setSt({ loading: true }); fetch('/.netlify/functions/caalano-connect?status=1', { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))).then((j) => setSt(j && typeof j === 'object' ? j : { error: 'Could not read the connection.' })).catch(() => setSt({ error: 'Could not read the connection.' })) }
  useEffect(load, [])
  const agency = !!(st.connected && String(st.tokenType || '').toLowerCase() === 'company' && st.hasCompanyId)
  const tone = st.loading ? '' : agency ? 'good' : st.connected ? 'warn' : 'bad'
  const line = st.loading ? 'Checking…' : st.error ? st.error : !st.hasClientId ? 'The app credentials are not set on the site.' : agency ? `Connected at agency level${st.companyId ? ` (company ${st.companyId})` : ''}: every sub-account can be read.` : st.connected ? `Connected to a single sub-account only (${st.tokenType || 'location'} token). Reconnect at agency level.` : 'Not connected.'
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Caalano Systems connection</h3>
        <p className={`cap ${tone === 'bad' ? 'act-bad' : ''}`} style={{ marginTop: -4 }}><span className={`hub-livechip ${tone === 'good' ? 'on' : ''}`}>{tone === 'good' ? '●' : '○'}</span> {line}</p>
        <div className="set-sec-t" style={{ marginTop: 14 }}>How to connect or reconnect at agency level</div>
        <ol className="cap" style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.6 }}>
          <li>Sign in here as an admin, in this browser.</li>
          <li>In GoHighLevel, switch to the agency view, open Marketplace, find <b>Caalano 360 Reporting</b> and install it for all sub-accounts.</li>
          <li>GoHighLevel brings you back to a Caalano360 page that says "Complete the connection". Click the button.</li>
          <li>The next page must show the green "Agency (Company) token" line. Come back here and press Check again.</li>
        </ol>
        <p className="cap">Reinstalling the app inside the CRM without step 3 does not store the access here. Removing the app from the agency revokes the access until it is connected again.</p>
        <div className="act-note-btns" style={{ marginTop: 10 }}><button type="button" className="btn-ghost sm" onClick={load}>Check again</button><a className="btn-ghost sm" href="/.netlify/functions/caalano-connect" target="_blank" rel="noreferrer">Open the connect page</a></div>
      </div>
      <div className="card"><CrmAddressCard /></div>
      {isSuper ? <div className="card">
        <div className="set-sec-t" style={{ marginTop: 0 }}>Live events webhook <span className="cap">· Super Admin only</span></div>
        <p className="cap">The address the marketplace app posts to the moment a deal, appointment or message changes; it drives the gong and the TV cues. One address serves every connected account.</p>
        {!hook ? <div className="act-note-btns"><button type="button" className="btn-ghost sm" onClick={() => { setHook({ loading: true }); fetch(`/.netlify/functions/windsor?scope=webhookurl${firstClient ? `&client=${encodeURIComponent(firstClient.id)}` : ''}`, { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))).then((j) => setHook(j || {})).catch(() => setHook({ error: 'Could not load.' })) }}>Show the webhook address</button></div>
          : hook.loading ? <p className="cap">Loading…</p> : hook.error ? <p className="cap act-bad">{hook.error}</p> : !hook.url ? <p className="cap">No site secret is set, so no webhook token can be made.</p> : <>
            <p className="cap">In the marketplace app's Webhooks page paste this as the webhook URL and tick: {(hook.events || []).join(', ')}. {hook.signed ? 'Deliveries are signature-checked.' : 'Set GHL_WEBHOOK_PUBLIC_KEY on the site to signature-check every delivery as well.'}</p>
            <div className="act-note-btns"><input className="act-in hub-setup-url" type="text" readOnly value={hook.url} onFocus={(e) => e.target.select()} /><button type="button" className="btn-primary act-btn" onClick={() => { try { navigator.clipboard.writeText(hook.url) } catch { /* select and copy by hand */ } }}>Copy</button></div>
          </>}
      </div> : null}
    </>
  )
}
// The CRM web address, agency-wide: every "Open in CRM" link across the app
// uses it, so a white-label domain keeps people inside the agency's brand.
export function CrmAddressCard() {
  useSettingsSync()
  const cur = (SETTINGS.ui && SETTINGS.ui.crmUrl) || ''
  const [v, setV] = useState(cur)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setV(cur) }, [cur])
  const clean = normCrmUrl(v)
  const dirty = clean !== normCrmUrl(cur)
  return (
    <div className="annot-set">
      <div className="set-sec-t" style={{ marginTop: 0 }}>CRM web address <span className="cap">· agency-wide</span></div>
      <p className="cap" style={{ marginTop: 4 }}>Where "Open in CRM" links go. Enter the white-label address your team and clients sign in at, such as <code>app.caalanosystems.com.au</code>. Leave it blank to use {CRM_DEFAULT_URL.replace('https://', '')}. Links open as <b>{clean || CRM_DEFAULT_URL}</b>.</p>
      <div className="act-note-btns"><input type="text" inputMode="url" placeholder={CRM_DEFAULT_URL} value={v} onChange={(e) => { setV(e.target.value); setSaved(false) }} style={{ minWidth: 280 }} />
        <button type="button" className="btn-primary act-btn" disabled={!dirty || (!!v.trim() && !clean)} onClick={() => { saveCrmUrl(v); setSaved(true) }}>Save</button>
        {saved ? <span className="cap">Saved.</span> : v.trim() && !clean ? <span className="cap act-bad">Enter a web address such as app.example.com</span> : null}</div>
    </div>
  )
}
/* ============ Visibility: who sees which views and tabs ============ */
// Super Admin only. A default per role (what everyone of that role gets) and,
// per person, a custom set that replaces the default. Only what is switched
// off is stored, so anything new is visible until it is deliberately hidden -
// which is how a feature stays out of sight until launch.
function VisPanel({ role, entry, onChange }) {
  const views = viewsForRole(role), tabs = tabsForRole(role)
  const on = (kind, id) => !(entry && entry[kind] && entry[kind][id] === false)
  const flip = (kind, id) => { const cur = { ...((entry && entry[kind]) || {}) }; if (cur[id] === false) delete cur[id]; else cur[id] = false; onChange({ ...entry, [kind]: cur }) }
  const grp = (title, hint, list, kind) => (
    <div className="vis-grp">
      <div className="vis-grp-h"><b>{title}</b><span className="cap">{hint}</span></div>
      {list.length ? <div className="vis-grid">{list.map((it) => <label key={it.id} className={`vis-row${on(kind, it.id) ? '' : ' off'}`}><span>{it.label}</span><Toggle sm on={on(kind, it.id)} onChange={() => flip(kind, it.id)} /></label>)}</div> : <p className="cap">Nothing to set for this role.</p>}
    </div>
  )
  return (
    <>
      {grp('Sidebar', 'Pages down the left-hand side. Settings is always available.', views, 'views')}
      {grp('Client workspace tabs', role === 'account_user' ? 'An Account User holds Deals & Actions and nothing else.' : 'Tabs across the top of a client. A tab the client has no data for never shows anyway.', tabs, 'tabs')}
    </>
  )
}
export function VisibilitySettings() {
  const [mode, setMode] = useState('roles') // 'roles' | 'people'
  const [role, setRole] = useState('admin')
  const [vis, setVis] = useState(() => normVisibility(SETTINGS.visibility))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(null)
  const [users, setUsers] = useState(null)
  const [who, setWho] = useState('')
  const [draft, setDraft] = useState(null) // the person's custom entry being edited
  useEffect(() => { let alive = true; authApi('users').then((r) => { if (alive) setUsers(r && r.ok ? (r.users || []).filter((u) => u.role !== 'superadmin' && u.status !== 'disabled') : []) }); return () => { alive = false } }, [])
  // Roles: edit the default for the picked role, save all defaults together.
  const setRoleEntry = (e) => { setVis((v) => ({ ...v, roles: { ...v.roles, [role]: e } })); setDirty(true); setSaved(null) }
  const saveRoles = () => {
    const next = normVisibility(vis)
    SETTINGS.visibility = { ...(SETTINGS.visibility || {}), roles: next.roles }
    saveSettingsRemote({ visibility: { roles: next.roles } }); bumpSettings()
    setVis(next); setDirty(false); setSaved('Role defaults saved. People sign in with the new defaults on their next load.')
  }
  const resetRole = () => { setVis((v) => ({ ...v, roles: { ...v.roles, [role]: { views: {}, tabs: {} } } })); setDirty(true); setSaved(null) }
  // People: a custom set replaces the role default; returning to default deletes it.
  const person = users && users.find((u) => u.email === who)
  const pickPerson = (email) => { setWho(email); setSaved(null); const u = users && users.find((x) => x.email === email); if (!u) { setDraft(null); return } const key = u.email.toLowerCase(); setDraft(vis.users[key] ? { ...vis.users[key] } : { ...vis.roles[u.role === 'viewer' ? 'account_admin' : u.role] }) }
  const writeUsers = (nextUsers, msg) => {
    const next = normVisibility({ ...vis, users: nextUsers })
    SETTINGS.visibility = { ...(SETTINGS.visibility || {}), users: next.users }
    saveSettingsRemote({ visibility: { users: next.users } }); bumpSettings()
    setVis(next); setSaved(msg)
  }
  const savePerson = () => { if (!person || !draft) return; writeUsers({ ...vis.users, [person.email.toLowerCase()]: draft }, `Custom visibility saved for ${person.name || person.email}.`) }
  const resetPerson = () => { if (!person) return; const u = { ...vis.users }; delete u[person.email.toLowerCase()]; writeUsers(u, `${person.name || person.email} is back on the ${VIS_ROLE_LABELS[person.role] || person.role} default.`); setDraft({ ...vis.roles[person.role === 'viewer' ? 'account_admin' : person.role] }) }
  const customCount = Object.keys(vis.users).length
  return (
    <div className="card vis-card">
      <h3 style={{ marginTop: 0 }}>Visibility</h3>
      <p className="cap" style={{ marginTop: -4 }}>Choose which pages and client tabs each role sees, and override it for one person. Anything new is visible until you switch it off here, so this is where a feature waits until it is ready to launch. Super Admins always see everything; use <b>View as</b> at the bottom of the sidebar to check what someone else gets.</p>
      <div className="chan-toggle sm vis-mode"><button className={mode === 'roles' ? 'on' : ''} onClick={() => setMode('roles')}>Role defaults</button><button className={mode === 'people' ? 'on' : ''} onClick={() => setMode('people')}>People{customCount ? ` · ${customCount} custom` : ''}</button></div>
      {mode === 'roles' ? (
        <>
          <div className="chan-toggle sm vis-roles">{VIS_ROLES.map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{VIS_ROLE_LABELS[r]}</button>)}</div>
          <VisPanel role={role} entry={vis.roles[role]} onChange={setRoleEntry} />
          <div className="vis-foot">
            <button type="button" className="btn-primary" onClick={saveRoles} disabled={!dirty}>Save role defaults</button>
            <button type="button" className="btn-ghost" onClick={resetRole}>Show everything to {VIS_ROLE_LABELS[role]}s</button>
            {saved ? <span className="cap vis-saved">{saved}</span> : dirty ? <span className="cap">Unsaved changes.</span> : null}
          </div>
        </>
      ) : (
        <>
          {users == null ? <Spinner label="Loading people…" /> : (
            <div className="vis-people">
              <label className="vis-pick">Person
                <select value={who} onChange={(e) => pickPerson(e.target.value)}>
                  <option value="">Choose someone…</option>
                  {users.map((u) => <option key={u.email} value={u.email}>{u.name || u.email} · {VIS_ROLE_LABELS[u.role === 'viewer' ? 'account_admin' : u.role] || u.role}{hasOverride(vis, u.email) ? ' · custom' : ''}</option>)}
                </select>
              </label>
              {person && draft ? (
                <>
                  <p className="cap">{hasOverride(vis, person.email) ? <><span className="vis-pill custom">Custom</span> {person.name || person.email} has their own settings, replacing the {VIS_ROLE_LABELS[person.role] || person.role} default.</> : <><span className="vis-pill">Default</span> {person.name || person.email} gets the {VIS_ROLE_LABELS[person.role] || person.role} default. Change anything below and save to give them their own.</>}</p>
                  <VisPanel role={person.role === 'viewer' ? 'account_admin' : person.role} entry={draft} onChange={(e) => { setDraft(e); setSaved(null) }} />
                  <div className="vis-foot">
                    <button type="button" className="btn-primary" onClick={savePerson}>Save custom visibility</button>
                    <button type="button" className="btn-ghost" onClick={resetPerson} disabled={!hasOverride(vis, person.email)}>Return to role default</button>
                    {saved ? <span className="cap vis-saved">{saved}</span> : null}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
export function SettingsPage({ config, enabled, setEnabled, restricted = {}, setRestricted, currency, authUser, authEnabled, theme, setTheme, onPick }) {
  const [filter, setFilter] = useState('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // client being configured (modal)
  const [adding, setAdding] = useState(false)   // add/edit-client explorer modal (true = new, client = edit)
  const [autoOnboard, setAutoOnboard] = useState(false) // auto-onboard matcher modal
  const role = authEnabled && authUser ? authUser.role : 'admin' // legacy/basic = full admin
  const isAdmin = isAdminishFE(role)
  const isSuper = !authEnabled || role === 'superadmin' // legacy/basic = super
  // Sections this person can actually reach - a deep link to one they can't
  // would otherwise render an empty page.
  const allowedSections = [
    ...(isAdmin ? ['clients', 'crm', 'fatigue', 'socialkpis', 'dailyperf'] : []),
    ...((!authEnabled || isAdmin) ? ['team'] : []),
    ...(authEnabled ? ['account'] : []),
    'appearance',
    ...(isSuper && authEnabled ? ['visibility', 'terms'] : []),
    ...(isSuper ? ['logs'] : []),
  ]
  const defaultSection = isAdmin ? 'clients' : 'account'
  const sectionFromUrl = () => { const want = readNavUrl().s; return want && allowedSections.includes(want) ? want : defaultSection }
  const [section, setSectionRaw] = useState(sectionFromUrl)
  // Pushed, not replaced, so Back steps through the sections you visited.
  const setSection = (v) => { setSectionRaw(v); writeNavUrl({ s: v }, true) }
  // Back / Forward, and a first load that arrived with ?s= already set.
  useEffect(() => {
    // Back to a URL with no ?s means the default section, not whichever one
    // happened to be open - otherwise Back appears to do nothing.
    const sync = () => setSectionRaw(sectionFromUrl())
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
    /* eslint-disable-next-line */
  }, [])
  const names = useDiscoverNames()
  const nm = (kind, id) => (names && id ? names[kind][normId(id)] : null)
  if (!config) return <div className="card"><Spinner label="Loading settings…" /></div>
  const w = config.availableAccounts?.windsor || {}
  const isOn = (c) => enabled[c.id] !== false
  const isRestr = (c) => !!(restricted && restricted[c.id])
  const toggleRestr = (c) => setRestricted && setRestricted((s) => ({ ...(s || {}), [c.id]: !((s || {})[c.id]) }))
  // Non-super admins never see Super-Admin-only clients in the Settings list either.
  const liveClients = config.clients.filter((c) => !isClientDeleted(c.id) && (isSuper || !isRestr(c)))
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
        {isAdmin && <button className={section === 'crm' ? 'on' : ''} onClick={() => setSection('crm')}>CRM connection</button>}
        {isAdmin && <button className={section === 'fatigue' ? 'on' : ''} onClick={() => setSection('fatigue')}>Creative fatigue</button>}
        {isAdmin && <button className={section === 'socialkpis' ? 'on' : ''} onClick={() => setSection('socialkpis')}>Organic KPIs</button>}
        {isAdmin && <button className={section === 'dailyperf' ? 'on' : ''} onClick={() => setSection('dailyperf')}>Daily performance</button>}
        {(!authEnabled || isAdmin) && <button className={section === 'team' ? 'on' : ''} onClick={() => setSection('team')}>Team &amp; access</button>}
        {authEnabled && <button className={section === 'account' ? 'on' : ''} onClick={() => setSection('account')}>Your account</button>}
        <button className={section === 'appearance' ? 'on' : ''} onClick={() => setSection('appearance')}>Appearance</button>
        {isSuper && authEnabled && <button className={section === 'visibility' ? 'on' : ''} onClick={() => setSection('visibility')}>Visibility</button>}
        {isSuper && authEnabled && <button className={section === 'terms' ? 'on' : ''} onClick={() => setSection('terms')}>Terms of use</button>}
        {isSuper && <button className={section === 'logs' ? 'on' : ''} onClick={() => setSection('logs')}>Logs</button>}
      </div>
      {/* Super-Admin only: the document itself, and the register of who signed it.
          Both hold the legal record, so neither is shown to Admins. */}
      {isSuper && authEnabled && section === 'terms' && <><TermsRegister /><TermsAdmin authUser={authUser} /></>}
      {isSuper && section === 'logs' && <LogsPanel clients={config.clients} />}
      {isSuper && authEnabled && section === 'visibility' && <VisibilitySettings />}
      {section === 'appearance' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Appearance</h3>
          <p className="cap" style={{ marginTop: -4 }}>Choose how Caalano360 looks. Saved to this browser.</p>
          <div className="theme-choose">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme && setTheme('light')}>☀ Light</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme && setTheme('dark')}>☾ Dark</button>
          </div>
          {isSuper ? <AnnotationToggle /> : null}
        </div>
      )}
      {isAdmin && section === 'crm' && <CrmConnectionSection isSuper={isSuper} clients={liveClients} />}
      {isAdmin && section === 'fatigue' && <FatigueSettings />}
      {isAdmin && section === 'socialkpis' && <SocialKpiSettings clients={config.clients} />}
      {isAdmin && section === 'dailyperf' && <DailyPerfSettings clients={config.clients} />}
      {section === 'team' && (!authEnabled || isAdmin) && <UsersAdmin authUser={authUser} authEnabled={authEnabled} clients={(config.clients || []).map((c) => ({ id: c.id, name: c.name, meta: c.meta || null, google: c.google || null, ga4: c.ga4 || null, ghl: c.ghl || null }))} />}
      {authEnabled && section === 'account' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your account</h3>
          <p className="cap" style={{ marginTop: -4 }}>Signed in as <b>{authUser ? (authUser.name || authUser.email) : ''}</b>{authUser ? ` · ${roleLabelOf(authUser)}` : ''}. Your name and mobile number are kept for account verification.</p>
          <YourDetailsCard user={authUser} />
          <h4 style={{ margin: '16px 0 4px' }}>Password</h4>
          <ChangePasswordCard />
          <SignOutEverywhereCard />
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
        {isSuper && <button className="set-add" onClick={() => setAutoOnboard(true)} title="Auto-match every unlinked Caalano Systems location to its Meta & Google accounts">✨ Auto-onboard</button>}
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
            <div className={`set-card ${on ? '' : 'is-off'} ${isRestr(c) ? 'is-restr' : ''}`} key={c.id}>
              <div className="set-card-head">
                <Avatar id={c.id} name={c.name} i={config.clients.indexOf(c)} />
                <div className="sc-id"><div className="nm">{c.name}{isRestr(c) ? <span className="restr-badge" title="Super-Admin only - hidden from the rest of the team">🔒</span> : null}</div><div className="ver">{c.industry || (c.deep ? 'Deep dashboards' : 'Summary only')}</div></div>
                <div className={`toggle ${on ? 'on' : ''}`} title={on ? 'Active - click to hide from the dashboard' : 'Inactive - click to show'} onClick={() => setEnabled((s) => ({ ...s, [c.id]: s[c.id] === false ? true : false }))}><span className="knob" /></div>
              </div>
              <HealthStrip c={c} />
              <div className="set-card-actions">
                <button className="set-expand" onClick={() => setEditing(c)}>✎ Edit</button>
                {isSuper && <button className={`set-restr-btn ${isRestr(c) ? 'on' : ''}`} onClick={() => toggleRestr(c)} title={isRestr(c) ? 'Visible to Super Admins only - click to show the whole team' : 'Restrict to Super Admins only'}>{isRestr(c) ? '🔒 Super-Admin only' : '🔓 Visible to team'}</button>}
              </div>
            </div>
          )
        })}
        {!list.length && <div className="card empty-deep"><div className="big">🔍</div><b>No clients match.</b></div>}
      </div>}
      </>)}
      {editing && <SettingsEditModal client={editing} names={names} currency={currency} canManageAccounts={isSuper} onClose={() => setEditing(null)} onOpen={() => { const cc = editing; setEditing(null); onPick(cc) }} onRelink={() => { const cc = editing; setEditing(null); setAdding(cc) }} />}
      {adding && <AddClientModal existing={config.clients} editClient={typeof adding === 'object' ? adding : null} onClose={() => setAdding(false)} />}
      {autoOnboard && <AutoOnboardModal existing={config.clients} onClose={() => setAutoOnboard(false)} />}
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
export function LogoField({ clientId, name }) {
  useSettingsSync()
  const rec = loadLogo(clientId)
  const [val, setVal] = useState(rec.logo || '')
  useEffect(() => { setVal(loadLogo(clientId).logo || '') }, [clientId, SETTINGS.loaded])
  const src = clientLogoSrc(clientId, 64)
  const source = rec.logo ? 'Manual override' : rec.logoUrl ? 'Caalano Systems logo' : rec.website ? `Favicon · ${domainOf(rec.website)}` : 'None found - showing initials'
  const save = () => saveLogo(clientId, { logo: val.trim() || null })
  return (
    <div className="set-cycle">
      <div className="set-sec-t">Business logo</div>
      <div className="set-logo-row">
        {src ? <span className="avatar avatar-img"><img src={src} alt="" /></span> : <span className="avatar" style={{ background: acolor(0) }}>{initials(name)}</span>}
        <div className="set-logo-meta"><span className="cap">{source}</span>{rec.website ? <a className="cap" href={/^https?:/i.test(rec.website) ? rec.website : 'https://' + rec.website} target="_blank" rel="noreferrer">{rec.website}</a> : null}</div>
      </div>
      <div className="set-field"><label>Override logo URL <span className="cap">· optional - paste a direct image link to force a specific logo</span></label>
        <div className="set-logo-in"><input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://…/logo.png" /><button className="btn-ghost sm" onClick={save} disabled={val === (rec.logo || '')}>Save</button>{rec.logo ? <button className="btn-ghost sm" onClick={() => { setVal(''); saveLogo(clientId, { logo: null }) }}>Clear</button> : null}</div>
      </div>
    </div>
  )
}
// Everything about WHEN for one client, in one place: which clock the CRM
// runs on, how long a deal takes, which hours count as working, and - read
// straight off those - which date ranges are old enough to trust for won and
// revenue figures.
export function TimingSettings({ clientId, hasMeta }) {
  useSettingsSync()
  const ov = loadCloseOverride(clientId)
  const ranges = [['last_7d', 'Last 7 days'], ['last_14d', 'Last 14 days'], ['last_30d', 'Last 30 days'], ['last_60d', 'Last 60 days'], ['last_90d', 'Last 90 days'], ['this_month', 'This month']]
  return (
    <div className="tm-wrap">
      <div className="set-sec-t">Timezone</div>
      <TimezoneBadge clientId={clientId} hasMeta={hasMeta} />
      <div className="set-sec-t" style={{ marginTop: 18 }}>Sales cycle</div>
      <SalesCycleField clientId={clientId} />
      <div className="set-sec-t" style={{ marginTop: 18 }}>Work hours <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· speed to lead is measured inside these, so an overnight lead answered at 9am is not a 10-hour response</span></div>
      <ActiveHoursField clientId={clientId} />
      <div className="set-sec-t" style={{ marginTop: 18 }}>Data maturity <span className="cap" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· which ranges are old enough to trust for won and revenue</span></div>
      {ov != null && ov > 0 ? (
        <div className="tm-mat">
          {ranges.map(([id, label]) => { const m = rangeMaturity(ov, presetRange(id)); return (
            <div className={`tm-mat-row${m && m.maturing ? ' maturing' : ' ok'}`} key={id}>
              <span className="tm-mat-l">{label}</span>
              <span className="tm-mat-v">{m && m.maturing ? `⏳ still maturing · ${m.shortfall} day${m.shortfall === 1 ? '' : 's'} short` : '✓ mature'}</span>
            </div>
          ) })}
          <HelpNote>A range needs to be about 20% longer than the sales cycle ({ov} days → {Math.round(ov * 1.2)} days) before most of its deals have had time to close. Shorter ranges show the amber ⏳ badge on the client's header and read low on Won, Revenue and ROAS - not because performance is worse, but because the deals are not in yet.</HelpNote>
        </div>
      ) : <HelpNote>Set the sales cycle above (or let the CRM average stand) and this shows which date ranges are mature. Without a figure, the app uses the CRM's own create → won average when it has one.</HelpNote>}
    </div>
  )
}
export function SalesCycleField({ clientId }) {
  const [crm, setCrm] = useState(undefined) // undefined = loading, null = none
  const [ov, setOv] = useState(() => { const v = loadCloseOverride(clientId); return v == null ? '' : String(v) })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true; setCrm(undefined)
    const r = presetRange('last_90d')
    dedupeFetch(`/.netlify/functions/windsor?client=${clientId}&channel=blend&${rangeQuery(r)}`)
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
      <div className="set-sec-t">Data maturity - average time to close</div>
      <HelpNote>Calculated automatically by the CRM from your won deals (average days from lead created to won). A <b>20% buffer</b> is added, and any date range shorter than that shows a <b>“Still maturing”</b> flag - a reminder that recent leads haven’t had time to convert yet, so Won / Revenue / ROAS understate the true result. This is never shown on the dashboards as a metric.</HelpNote>
      <div className="set-cycle-grid">
        <div className="set-cycle-stat"><span className="cap">CRM average</span><b>{crm === undefined ? '…' : crm == null ? 'No won deals yet' : `${crm} days`}</b></div>
        <div className="set-cycle-stat"><span className="cap">With 20% buffer</span><b>{buffered ? `${buffered} days` : '-'}</b></div>
        <div className="set-field set-cycle-in"><label>Manual override (days)</label><input type="number" min="0" value={ov} onChange={(e) => save(e.target.value)} placeholder={crm != null ? `${crm} (CRM)` : 'e.g. 40'} />{saved && <span className="set-saved-tick">✓</span>}</div>
      </div>
      <HelpNote>⚠ Leave blank to use the CRM figure. Only override if you know the true sales cycle (e.g. the CRM history is too short) - the 20% buffer is still applied on top of whatever you enter.</HelpNote>
    </div>
  )
}
// Working-hours editor. Auto-detects from the client's calendars, and lets you
// override the days + open/close time. Drives the Speed to Lead measurement so
// after-hours gaps aren't counted as slow responses.
export function ActiveHoursField({ clientId }) {
  const saved = loadHours(clientId) // DEFAULT_HOURS when unset; null only if explicitly off
  const init = saved || DEFAULT_HOURS
  const [enabled, setEnabled] = useState(() => !!saved)
  const [days, setDays] = useState(() => init.days)
  const [start, setStart] = useState(() => hhmm(init.startMin))
  const [end, setEnd] = useState(() => hhmm(init.endMin))
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
      <HelpNote>When on, Speed to Lead counts only <b>business minutes</b> - a lead that arrives at 11pm and gets a reply at 9am is a fast response, not a 10-hour one.</HelpNote>
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
          : <span className="cap">Couldn't auto-detect hours from calendars - set them manually above.</span>}
      </div>
    </div>
  )
}
// Per-client Meta conversion picker: loads the conversion events that actually
// fired for the account and lets an admin choose a primary result + secondaries.
export function MetaConversionsEditor({ clientId, currency }) {
  const [st, setSt] = useState({ status: 'loading', actions: [] })
  const [cfg, setCfg] = useState(() => loadMetaConv(clientId))
  const [saved, setSaved] = useState(false)
  const [addName, setAddName] = useState('')
  const [added, setAdded] = useState([])
  const [probe, setProbe] = useState({ status: 'idle' })
  const [dbg, setDbg] = useState(false)
  const findCustom = () => {
    const ev = addName.trim(); if (!ev) return
    setProbe({ status: 'loading' })
    fetch(`/.netlify/functions/windsor?scope=metaprobe&client=${clientId}&event=${encodeURIComponent(ev)}`)
      .then((r) => r.json())
      .then((j) => {
        const found = (j && j.found) || []
        setProbe({ status: found.length ? 'ok' : 'none' })
        if (found.length) { setAdded((a) => { const seen = new Set(a.map((x) => x.id)); return [...a, ...found.filter((f) => !seen.has(f.id))] }); setAddName('') }
      })
      .catch(() => setProbe({ status: 'err' }))
  }
  useEffect(() => {
    let alive = true; setSt({ status: 'loading', actions: [] })
    // Auto-detect: read the account's optimisation event + every firing conversion.
    fetch(`/.netlify/functions/windsor?scope=metadetect&client=${clientId}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setSt({ status: j && j.error ? 'err' : 'ok', actions: (j && j.actions) || [], error: j && j.error, spend: j && j.spend, suggest: j && j.suggest, goal: j && j.goal, evNames: (j && j.evNames) || [], tried: (j && j.tried) || [], customIds: (j && j.customIds) || [], promoted: j && j.promoted, acceptedFields: (j && j.acceptedFields) || [] }) })
      .catch((e) => { if (alive) setSt({ status: 'err', actions: [], error: String((e && e.message) || e) }) })
    return () => { alive = false }
  }, [clientId])
  const isPrimary = (id) => (cfg.primary || []).includes(id)
  const togglePrimary = (id) => setCfg((c) => { const has = (c.primary || []).includes(id); return { primary: has ? c.primary.filter((p) => p !== id) : [...(c.primary || []), id], secondary: (c.secondary || []).filter((s) => s !== id) } })
  const addPrimary = (id) => setCfg((c) => ((c.primary || []).includes(id) ? c : { primary: [...(c.primary || []), id], secondary: (c.secondary || []).filter((s) => s !== id) }))
  const toggleSecondary = (id) => setCfg((c) => { const has = (c.secondary || []).includes(id); return { ...c, secondary: has ? c.secondary.filter((s) => s !== id) : [...(c.secondary || []), id] } })
  const save = () => { saveMetaConv(clientId, cfg); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  const money = (v) => fmtCurrency(v, currency)
  const known = st.actions || []
  // Merge, de-duplicated by id: discovered events + probed custom events + any saved
  // choice not otherwise present. Custom events keep their probed label / count.
  const byId = new Map()
  for (const a of [...known, ...added]) if (!byId.has(a.id)) byId.set(a.id, a)
  for (const id of [...(cfg.primary || []), ...(cfg.secondary || [])].filter(Boolean)) if (!byId.has(id)) byId.set(id, { id, label: id, count: 0, costPer: null })
  const list = [...byId.values()]
  const labelOf = (id) => (byId.get(id) || {}).label || id
  return (
    <div className="mconv">
      <p className="cap" style={{ marginTop: 0 }}>The Meta tab reads each ad set's own optimisation event from Meta (lead forms, a custom conversion, reach) and reports that as its result, so the campaign table matches Ads Manager; every other action a row drove, custom conversions included, sits in the hover. The <b>primary</b> you tick here is the fallback for an ad set whose event can't be read, and the definition of a result on Daily Performance and the cross-client trends, where results are counted by day rather than by ad set - so tick the event the account actually optimises to, and only that. Tick any <b>secondary</b> events to show alongside. Standard + previously-fired custom events are listed; add any other <b>custom conversion</b> by name below.</p>
      <div className="mconv-add">
        <input type="text" placeholder="Add a custom conversion by name (e.g. B_Page_View)" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') findCustom() }} />
        <button className="btn-ghost sm" onClick={findCustom} disabled={probe.status === 'loading' || !addName.trim()}>{probe.status === 'loading' ? 'Finding…' : 'Find + add'}</button>
        {probe.status === 'none' ? <span className="cap">No data for that event name in the last 90 days - check the exact custom-conversion name in Ads Manager.</span>
          : probe.status === 'err' ? <span className="cap">Probe failed - try again.</span>
            : probe.status === 'ok' ? <span className="cap" style={{ color: '#16a34a' }}>✓ Added - tick it Primary below.</span> : null}
      </div>
      {st.status === 'ok' ? (
        <div className="mconv-dbg">
          <button className="linker-toggle" onClick={() => setDbg((d) => !d)}>{dbg ? '▾' : '▸'} Not seeing your custom conversion?</button>
          {dbg ? (
            <div className="mconv-dbg-body cap">
              <div>Detected optimisation goal: <b>{st.goal ? String(st.goal).replace(/_/g, ' ').toLowerCase() : '-'}</b></div>
              {st.evNames && st.evNames.length ? <div>Event names on the ad sets: <b>{st.evNames.join(', ')}</b></div> : null}
              {st.customIds && st.customIds.length ? <div>Custom-conversion IDs found: <b>{st.customIds.join(', ')}</b></div> : null}
              {st.promoted ? <div>Ad-set promoted object: <code style={{ fontSize: 10 }}>{typeof st.promoted === 'string' ? st.promoted : JSON.stringify(st.promoted)}</code></div> : null}
              <div style={{ marginTop: 4 }}>Windsor <b>accepts</b> these result fields (valid on this account): <code style={{ fontSize: 10 }}>{(st.acceptedFields || []).length ? st.acceptedFields.join(', ') : 'none of the custom / native `results` variants'}</code></div>
              <div style={{ marginTop: 4 }}>Custom conversions are counted only if Windsor exposes the exact field. We probed <b>{(st.tried || []).length}</b> field names. If your event still isn't listed, its Windsor field id is non-standard - send the goal / IDs / promoted-object above to your Caalano admin to hard-map it.</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {st.status === 'loading' ? <Spinner label="Loading Meta conversions…" />
        : st.status === 'err' ? <div className="cap">Couldn’t load conversions{st.error ? ` - ${st.error}` : ''}.</div>
          : !list.length ? (
            <div className="mconv-empty">
              <div className="cap">No Meta conversions were detected firing for this account.{st.spend ? ` (${money(st.spend)} spent in the last 30 days.)` : ''}</div>
              {(st.goal || (st.evNames && st.evNames.length)) ? <div className="cap" style={{ marginTop: 6 }}>Detected optimisation goal: <b>{st.goal ? String(st.goal).replace(/_/g, ' ').toLowerCase() : '-'}</b>{st.evNames && st.evNames.length ? <> · event(s) named on the ad sets: <b>{st.evNames.join(', ')}</b></> : null}. If your custom conversion (e.g. from Ads Manager’s Results column) should be here but isn’t, its Windsor field name differs from what we tried - send this to your Caalano admin: <code style={{ fontSize: 10 }}>{(st.tried || []).slice(0, 8).join(', ')}{(st.tried || []).length > 8 ? '…' : ''}</code></div> : null}
            </div>
          )
            : <>
              {st.suggest && !isPrimary(st.suggest) ? (
                <div className="mconv-auto">
                  <span>🎯 Auto-detected optimisation event: <b>{labelOf(st.suggest)}</b>{st.goal ? <span className="cap"> · goal: {String(st.goal).replace(/_/g, ' ').toLowerCase()}</span> : null}</span>
                  <button className="btn-ghost sm" onClick={() => addPrimary(st.suggest)}>{(cfg.primary || []).length ? 'Add as primary' : 'Use as primary'}</button>
                </div>
              ) : null}
              <div className="table-wrap"><table className="mini-tbl mconv-tbl">
                <thead><tr><th className="lft">Conversion event</th><th>Count · 90d</th><th>Cost / action</th><th>Primary</th><th>Secondary</th></tr></thead>
                <tbody>{list.map((a) => (
                  <tr key={a.id} className={isPrimary(a.id) ? 'row-sel' : ''}>
                    <td className="lft">{a.label}</td>
                    <td>{fmtNumber(a.count)}</td>
                    <td>{a.costPer != null ? money(a.costPer) : '-'}</td>
                    <td><input type="checkbox" checked={isPrimary(a.id)} onChange={() => togglePrimary(a.id)} /></td>
                    <td><input type="checkbox" checked={(cfg.secondary || []).includes(a.id)} disabled={isPrimary(a.id)} onChange={() => toggleSecondary(a.id)} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="mconv-foot">
                <button className="btn-primary" onClick={save}>{saved ? '✓ Saved' : 'Save conversions'}</button>
                {(cfg.primary || []).length ? <button className="btn-ghost sm" onClick={() => setCfg({ primary: [], secondary: [] })}>Clear</button> : null}
                <span className="cap">{(cfg.primary || []).length ? `Primary: ${cfg.primary.map(labelOf).join(' + ')}${(cfg.secondary || []).length ? ` · ${cfg.secondary.length} secondary` : ''}${cfg.primary.length > 1 ? ' · summed where the primary is used' : ''}` : 'No primary set - an ad set whose event can\'t be read shows Leads.'}</span>
              </div>
            </>}
    </div>
  )
}
// Client Brand Profile editor (Settings → Overview). A structured "everything
// about this brand" file that feeds the AI features. Auto-saves on blur.
export function ClientProfileEditor({ clientId }) {
  useSettingsSync()
  const [form, setForm] = useState(() => loadProfile(clientId))
  const [tick, setTick] = useState(false)
  useEffect(() => { setForm(loadProfile(clientId)) }, [clientId])
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const persist = () => { saveProfile(clientId, form); setTick(true); setTimeout(() => setTick(false), 1200) }
  const filled = PROFILE_FIELDS.reduce((n, f) => n + (String(form[f.k] || '').trim() ? 1 : 0), 0)
  return (
    <div className="prof">
      <p className="cap" style={{ marginTop: 0 }}>Capture everything about this brand: what they do, who they sell to, their voice, offers, proof, objections and the words that work. This becomes the client's context file - the <b>Creative Curator</b> reads it in Client deep-dive mode, and more AI features will use it. Saved to the server and shared with your team.{tick && <span className="set-saved-tick" style={{ position: 'static', marginLeft: 8 }}>✓ saved</span>}</p>
      <div className="prof-meter"><span className="prof-meter-fill" style={{ width: `${Math.round((filled / PROFILE_FIELDS.length) * 100)}%` }} /></div>
      <div className="prof-meter-lab cap">{filled} / {PROFILE_FIELDS.length} sections filled</div>
      <div className="prof-grid">
        {PROFILE_FIELDS.map((f) => (
          <div className={`prof-field${f.area ? ' prof-field-wide' : ''}`} key={f.k}>
            <label>{f.label}</label>
            {f.area
              ? <textarea rows={3} placeholder={f.ph} value={form[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} onBlur={persist} />
              : <input type="text" placeholder={f.ph} value={form[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} onBlur={persist} />}
          </div>
        ))}
      </div>
    </div>
  )
}
// Composes a client's custom dashboard from the module registry: pick, order,
// retitle, save. The result appears as a tab on the client's workspace, Super
// Admin only. Presets give a starting point; nothing here computes a figure.
export function DashboardBuilder({ client: c }) {
  useSettingsSync()
  const blank = { name: 'Client view', chan: 'all', audience: 'super', modules: [] }
  const [d, setD] = useState(() => loadDashboard(c.id) || blank)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [pick, setPick] = useState('')
  const up = (patch) => { setD((x) => ({ ...x, ...patch })); setDirty(true) }
  const avail = DASH_MODULES.filter((m) => dashModuleFits(m, c))
  const used = new Set(d.modules.filter((m) => !(DASH_MODULES.find((x) => x.type === m.type) || {}).multi).map((m) => m.type))
  const groups = [...new Set(avail.map((m) => m.group))]
  const move = (i, dir) => { const arr = [...d.modules]; const j = i + dir; if (j < 0 || j >= arr.length) return; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; up({ modules: arr }) }
  const remove = (i) => up({ modules: d.modules.filter((_, k) => k !== i) })
  const add = (type) => { if (!type || used.has(type)) return; up({ modules: [...d.modules, { type }] }); setPick('') }
  const isHeading = (m) => m.type === 'heading'
  const setTitle = (i, title) => up({ modules: d.modules.map((m, k) => (k === i ? { ...m, title: title || undefined } : m)) })
  const preset = (key) => { const p = DASH_PRESETS.find((x) => x.key === key); if (!p) return; up({ modules: p.types.filter((t) => avail.some((m) => m.type === t)).map((type) => ({ type })) }) }
  const save = () => { if (!d.modules.length) return; saveDashboard(c.id, { ...d, name: (d.name || '').trim() || 'Client view', updatedAt: new Date().toISOString() }); setDirty(false); setSavedAt(Date.now()) }
  const clear = () => { if (!window.confirm('Remove this client’s custom dashboard? The tab disappears from the workspace.')) return; saveDashboard(c.id, null); setD(blank); setDirty(false) }
  const saved = loadDashboard(c.id)
  return (
    <div className="dash-builder">
      <p className="cap" style={{ margin: 0 }}>Pick the modules this client should see, in order. Every module is the same component the tabs use, reading the same figures, so the custom view reconciles with the tabs to the number. The dashboard appears as a <b>{d.name || 'Client view'}</b> tab on the client's workspace, next to Caalano360.</p>
      <div className="dash-add">
        <span className="cap">Who can see it</span>
        <span className="chan-toggle sm">
          {DASH_AUD.map((a) => <button key={a} type="button" className={dashAudience(d) === a ? 'on' : ''} onClick={() => up({ audience: a })}>{a === 'super' ? 'Super Admins only' : a === 'admin' ? 'Admin' : a === 'user' ? 'User' : 'Account Admin/User'}</button>)}
        </span>
        {(() => {
          const a = dashAudience(d)
          if (a === 'viewer') return <span className="cap">Open to <b>everyone</b>: every staff role sees the tab, and it appears as a <b>Custom dashboard</b> tick box in each Account Admin's or Account User's allocation for this client - they see it only once their box is ticked, and then they see every module on it, spend and cost included.</span>
          if (a === 'user') return <span className="cap">Open to <b>Users, Admins and Super Admins</b>. Account Admins and Account Users (clients) do not see it.</span>
          if (a === 'admin') return <span className="cap">Open to <b>Admins and Super Admins</b>. Users, Account Admins and Account Users do not see it.</span>
          return <span className="cap">Only Super Admins see the tab. Staff, Account Admins and Account Users see nothing new.</span>
        })()}
      </div>
      <div className="dash-add">
        <label className="dash-name">Tab name <input value={d.name || ''} onChange={(e) => up({ name: e.target.value })} placeholder="Client view" maxLength={32} /></label>
        <span className="cap">Channel</span>
        <span className="chan-toggle sm">{CC_CHANS.map(([kk, lbl]) => <button key={kk} type="button" className={(d.chan || 'all') === kk ? 'on' : ''} onClick={() => up({ chan: kk })}>{lbl}</button>)}</span>
      </div>
      <div className="dash-presets"><span className="cap">Start from</span>{DASH_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => preset(p.key)}>{p.label}</button>)}</div>
      {d.modules.length ? d.modules.map((m, i) => {
        const def = DASH_MODULES.find((x) => x.type === m.type) || { label: m.type }
        return <div className={`dash-row${isHeading(m) ? ' dash-row-h' : ''}`} key={`${m.type}:${i}`}>
          <span className="dash-n">{i + 1}</span>
          <div className="dash-lab"><b>{def.label}{def.internal ? <span className="dash-int" title="This module includes the agency's spend and cost figures; everyone given the dashboard sees them">shows spend and cost</span> : null}</b>{def.hint ? <small>{def.hint}</small> : null}<input value={m.title || ''} onChange={(e) => setTitle(i, e.target.value)} placeholder={isHeading(m) ? 'Section title, e.g. Sales performance' : `Title shown to the client (default: ${def.label})`} maxLength={60} /></div>
          <div className="dash-btns"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">▲</button><button type="button" onClick={() => move(i, 1)} disabled={i === d.modules.length - 1} title="Move down">▼</button><button type="button" onClick={() => remove(i)} title="Remove">✕</button></div>
        </div>
      }) : <div className="cap">No modules yet. Add one below, or start from a preset.</div>}
      <div className="dash-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a module…</option>
          {groups.map((g) => <optgroup key={g} label={g}>{avail.filter((m) => m.group === g).map((m) => <option key={m.type} value={m.type} disabled={used.has(m.type)}>{m.label}{used.has(m.type) ? ' (added)' : ''}</option>)}</optgroup>)}
        </select>
        <button type="button" className="set-relink" onClick={() => add(pick)} disabled={!pick || used.has(pick)}>Add</button>
      </div>
      <div className="dash-add">
        <button type="button" className="set-open" onClick={save} disabled={!dirty || !d.modules.length}>{saved ? 'Save changes' : 'Create dashboard'}</button>
        {saved ? <button type="button" className="set-relink" onClick={clear}>Remove dashboard</button> : null}
        {savedAt && !dirty ? <span className="cap">Saved. Open the client view and pick the <b>{d.name || 'Client view'}</b> tab.</span> : dirty ? <span className="cap">Unsaved changes.</span> : null}
      </div>
    </div>
  )
}
export function SettingsEditModal({ client: c, names, currency, canManageAccounts, onClose, onOpen, onRelink }) {
  const canLink = (c.meta || c.google) && c.ghl
  const nm = (kind, id) => (names && id ? names[kind][normId(id)] : null)
  useSettingsSync()
  const bizType = loadBizType(c.id)
  const [cashOn, setCashOn] = useState(() => loadCashOn(c.id))
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
      meta: c.meta || null, google: c.google || null, ghl: c.ghl || null, ga4: c.ga4 || null,
      metaName: nm('meta', c.meta) || c.metaName || null, googleName: nm('google', c.google) || c.googleName || null, ghlName: nm('ghl', c.ghl) || c.ghlName || null,
    })
    setSavedDetails(true); setTimeout(() => setSavedDetails(false), 1500)
  }
  // Cache-buster tied to the linked accounts, so relinking a client bypasses
  // the 10-min CDN cache on the blend/attribution/calendar responses.
  const sig = normId(c.ghl) + '-' + normId(c.meta) + '-' + normId(c.google)
  // The brand-profile editor ("Overview") is hidden from the tab strip. Its
  // component stays, since the Creative Cockpit still reads what was filled in;
  // it just no longer earns a tab nobody opened.
  // Grouped, so eleven destinations read as four ideas rather than a strip
  // that wraps onto two lines. Each entry: [key, label, group, hint].
  const tabs = [['summary', 'Summary', 'Account', 'Name, linked accounts, logo']]
  if (c.ghl) tabs.push(['timing', 'Timing', 'Account', 'Timezone, sales cycle, work hours, maturity'])
  if (canManageAccounts) tabs.push(['dashboard', 'Custom dashboard', 'Account', 'Compose a view from existing modules'])
  if (c.ghl) tabs.push(['keyevents', 'Key events', 'Tracking', 'The stages and calendars that count as progress'])
  if (c.meta) tabs.push(['metaconv', 'Meta conversions', 'Tracking', 'Which Meta result counts as a lead'])
  if (canLink) tabs.push(['links', 'Campaign links', 'Tracking', 'Campaign → pipeline'])
  if (canLink) tabs.push(['aliases', 'UTM aliases', 'Tracking', 'Renamed campaigns, ad sets, creatives'])
  if (c.ghl) tabs.push(['qualstage', 'Qualified lead', 'Tracking', 'The stage that means qualified'])
  if (c.ghl) tabs.push(['forms', 'Forms', 'Tracking', 'Form → pipeline, and notes'])
  if (c.meta || c.google || c.ghl) tabs.push(['kpis', 'KPI targets', 'Targets', 'Budget, funnel and efficiency targets'])
  if (c.ghl) tabs.push(['geo', 'Catchment', 'Targets', 'Where the leads should come from'])
  if (c.ghl) tabs.push(['goals', 'Goals', 'Targets', 'Business, pipeline and rep targets'])
  if (c.ghl && bizType === 'clinic') tabs.push(['clinic', 'Clinic', 'Operations', 'Practitioners and appointment types'])
  tabs.push(['optlog', 'Optimisation Log', 'Operations', 'The Google Sheet of changes made'])
  if (c.ghl && (c.meta || c.google)) tabs.push(['diagnostics', 'Diagnostics', 'Operations', 'Is tracking actually working'])
  const groups = [...new Set(tabs.map((t) => t[2]))]
  // The last tab opened for this client is where it reopens: someone setting
  // KPI targets across ten clients should not land on Summary ten times.
  const tabKey = `caalano_set_tab:${c.id}`
  const [tab, setTabRaw] = useState(() => { try { const t = localStorage.getItem(tabKey); return t && tabs.some((x) => x[0] === t) ? t : 'summary' } catch { return 'summary' } })
  const setTab = (t) => { setTabRaw(t); try { localStorage.setItem(tabKey, t) } catch { /* private mode */ } }
  // ↑ / ↓ move through the list, so the whole of a client's setup can be
  // walked without reaching for the mouse.
  const onNavKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = tabs.findIndex((x) => x[0] === tab)
    const n = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length]
    if (n) setTab(n[0])
  }
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
        <div className="set-split">
          <nav className="set-nav" aria-label="Client settings" onKeyDown={onNavKey}>
            {groups.map((g) => (
              <div className="set-nav-grp" key={g}>
                <div className="set-nav-glab">{g}</div>
                {tabs.filter((t) => t[2] === g).map(([k, lbl, , hint]) => (
                  <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                    <span className="set-nav-l">{lbl}</span><span className="set-nav-h">{hint}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <select className="set-nav-select" value={tab} onChange={(e) => setTab(e.target.value)} aria-label="Client settings section">
            {groups.map((g) => <optgroup key={g} label={g}>{tabs.filter((t) => t[2] === g).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}</optgroup>)}
          </select>
        <div className="m-body set-tabbody">
          {tab === 'summary' && <div className="set-summary">
            <div className="set-details">
              <div className="set-field"><label>Client name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="set-field"><label>Description / Industry</label><input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Pool builder (trades, high-ticket)" /></div>
              <div className="set-field set-field-sm"><label>Type of business</label>
                <select value={bizType} onChange={(e) => saveBizType(c.id, e.target.value)} title="Clinic shows the Clinic tab here and in the client view; the rest are descriptive">
                  {BIZ_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="set-field set-field-sm"><label>Cash collected</label>
                <label className="set-check" title="Reads the numeric opportunity field named 'Cash Collected' in Caalano Systems - a running total of what each won deal has paid. Shows cash collected, cash ROAS, paid in full and outstanding on Caalano360.">
                  <input type="checkbox" checked={cashOn} onChange={(e) => { saveCashOn(c.id, e.target.checked); setCashOn(e.target.checked) }} /> Show cash position on Caalano360
                </label></div>
              <button className="set-details-save" disabled={!dirty || !name.trim()} onClick={saveDetails}>{savedDetails ? '✓ Saved' : 'Save details'}</button>
            </div>
            <div className="set-sec-t">Linked accounts</div>
            <div className="set-linked">
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd meta">Meta</span></span><span className="set-linked-v">{c.meta ? <><b>{nm('meta', c.meta) || c.metaName || 'Linked'}</b> <code>{c.meta}</code></> : <span className="cap">Not linked</span>}</span></div>
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd google">Google</span></span><span className="set-linked-v">{c.google ? <><b>{nm('google', c.google) || c.googleName || 'Linked'}</b> <code>{c.google}</code></> : <span className="cap">Not linked</span>}</span></div>
              <div className="set-linked-row"><span className="set-linked-l"><span className="ov-pd" style={{ background: '#12b886' }}>CRM</span></span><span className="set-linked-v">{c.ghl ? <><b>{nm('ghl', c.ghl) || c.ghlName || 'Linked'}</b> <code>{c.ghl}</code></> : <span className="cap">Not linked</span>}</span></div>
            </div>
            {canManageAccounts ? <button className="set-relink" onClick={onRelink} title="Change which Caalano Systems / Meta / Google accounts this client links to">✎ Edit linked accounts</button> : <p className="cap" style={{ margin: '4px 0 0' }}>🔒 Only a Super Admin can change or remove the linked accounts.</p>}
            <LogoField clientId={c.id} name={name || c.name} />
            {canManageAccounts && (
              <div className="set-danger">
                <div className="set-sec-t">Delete client</div>
                <p className="cap" style={{ marginTop: 0 }}>Removes <b>{c.name}</b> from every list - the dashboard, sidebar, Settings and agency aggregates. Its per-client settings (key events, KPIs, notes) are kept in case you re-add it later.{c.custom ? '' : ' This account is defined in the app; deleting hides it everywhere (a Super Admin can restore it).'}</p>
                {confirmDel
                  ? <div className="set-danger-confirm"><span>Delete <b>{c.name}</b>?</span><button className="set-del-yes" onClick={doDelete}>Yes, delete</button><button className="btn-ghost sm" onClick={() => setConfirmDel(false)}>Cancel</button></div>
                  : <button className="set-del-btn" onClick={() => setConfirmDel(true)}>🗑 Delete client</button>}
              </div>
            )}
          </div>}
          {tab === 'keyevents' && <div className="set-tabpane"><div className="set-sec-t">Key events</div><KeyEventsEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'timing' && <div className="set-tabpane"><TimingSettings clientId={c.id} hasMeta={!!c.meta} /></div>}
          {tab === 'dashboard' && canManageAccounts && <div className="set-tabpane"><div className="set-sec-t">Custom dashboard</div><DashboardBuilder client={c} /></div>}
          {tab === 'geo' && <GeoSettings clientId={c.id} />}
          {tab === 'goals' && <div className="set-tabpane"><div className="set-sec-t">Goals - business, pipeline and rep targets</div><GoalsEditor clientId={c.id} currency={c.currency} /></div>}
          {tab === 'clinic' && <ClinicSettings clientId={c.id} nonce={sig} />}
          {tab === 'metaconv' && <div className="set-tabpane"><div className="set-sec-t">Meta conversions - primary &amp; secondary results</div><MetaConversionsEditor clientId={c.id} currency={currency} /></div>}
          {tab === 'links' && <div className="set-tabpane"><div className="set-sec-t">Link campaigns to pipelines</div><CampaignLinker clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'kpis' && <div className="set-tabpane"><div className="set-sec-t">KPI targets</div><KpiEditor clientId={c.id} embedded nonce={sig} /></div>}
          {tab === 'forms' && <div className="set-tabpane"><div className="set-sec-t">Forms - link to a pipeline &amp; add notes</div><p className="cap" style={{ marginTop: 0 }}>Set each form's pipeline and notes here. The client's Forms tab shows these (and its full performance).</p><FormsSettingsTab clientId={c.id} /></div>}
          {tab === 'aliases' && <div className="set-tabpane"><div className="set-sec-t">UTM aliases - link renamed campaigns / ad sets / creatives</div><AliasEditor clientId={c.id} nonce={sig} /></div>}
          {tab === 'qualstage' && <div className="set-tabpane"><div className="set-sec-t">Qualified lead - stage per pipeline</div><QualStageEditor clientId={c.id} nonce={sig} /></div>}
          {tab === 'optlog' && <div className="set-tabpane"><div className="set-sec-t">Optimisation Log - Google Sheet</div><OptLogSettings clientId={c.id} /></div>}
          {tab === 'diagnostics' && <div className="set-tabpane"><ClientTrackingDiagnostics clientId={c.id} currency={currency} embedded nonce={sig} /></div>}
        </div>
        </div>
      </div>
    </div>
  )
}

// Catches render errors in a view so one bad client/component shows a message
// with a way back instead of blanking the whole app to a white screen.
