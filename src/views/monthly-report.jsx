// Monthly Report. Carved out of App.jsx so it loads on first open; the
// helpers it shares with the rest of the app are imported from there.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { C360GrpRow, Dlt, KeyEventsFunnel, KeyPeopleModal, MRKpi, O360ColGroup, O360Head, SortTh, Spinner, aliasedOutcomeMap, buildO360Cols, calCountMap, clientDownloadOn, fmtDate, formKeyEvents, isAdminishFE, isClientRoleFE, keyEventRows, campIsSplit, keyEventsForPipe, loadAdsetRules, loadCampMap, loadKeyEvents, loadMReport, mkOutcomeMap, mrFetch, o360Cells, o360ColClass, o360Fields, pipeOfAdset, rangeQuery, reachedByStage, readNavUrl, resolveKeyEvents, saveMReport, setClientDownload, sortRows, stagePosMap, stageReachOf, suggestPipeline, unorm, useSettingsSync, useSort, writeNavUrl } from '../App.jsx'
import { fmtCompact, fmtCurrency, fmtNumber, fmtPct } from '../lib/format.js'

// ---------------------------------------------------------------------------
// Monthly Report - a full-page, one-client, one-month slide deck built from a
// FROZEN snapshot. Wins/revenue are attributed by close month (won date), not
// lead-created date, so late-closing leads land in the month they closed.
// Exports via native print (Save-as-PDF) and a direct jsPDF download.
// ---------------------------------------------------------------------------

// PDF export: standard A4 landscape pages. Each slide is fit to the full page WIDTH
// (kept readable, never shrunk to fit a whole tall slide onto one page). A slide that
// fits within one page is centred vertically; a taller slide flows across as many A4
// pages as it needs, with every page break snapped to a block-level element edge (row
// / card / section) so nothing is sliced through the middle.
export const A4L_W = 842, A4L_H = 595 // A4 landscape, points
export async function exportSlidesToPdf(slides, fileName) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff'
  const buf = document.createElement('canvas'); const bctx = buf.getContext('2d')
  let started = false
  const page = () => { if (started) pdf.addPage('a4', 'landscape'); started = true }
  for (const el of slides) {
    const top = el.getBoundingClientRect().top
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: bg, useCORS: true, logging: false })
    const fit = A4L_W / canvas.width // canvas px -> pt at full page width
    const fullH = canvas.height * fit
    if (fullH <= A4L_H + 1) {
      // Fits one page: place at full width, centred vertically.
      page()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, (A4L_H - fullH) / 2, A4L_W, fullH)
      continue
    }
    // Taller than a page: paginate. Break only at block-level element edges (not inline
    // text), so table rows / cards aren't cut. Require each page to fill >=50% first.
    // Re-measure the slide top NOW (after html2canvas) so it matches the descendant
    // rects measured just below - html2canvas can shift scroll during its async render.
    const elTop = el.getBoundingClientRect().top
    const factor = canvas.width / (el.offsetWidth || 1)
    const cutSet = new Set([canvas.height])
    const addEdge = (n) => { const r = n.getBoundingClientRect(); if (r.height > 0) cutSet.add(Math.round((r.bottom - elTop) * factor)) }
    // Table rows / cards / funnel rows are the safe break points - collect them
    // unconditionally (compressed export rows can be <14px, so no height filter here).
    el.querySelectorAll('tr, .mr-cre, .card, .kef-row, .mr-block, .pp-block, .mr-cretbl-row').forEach(addEdge)
    // Plus any other non-inline block with real height, as a fallback for other layouts.
    el.querySelectorAll('*').forEach((n) => { const r = n.getBoundingClientRect(); if (r.height < 8) return; const d = getComputedStyle(n).display; if (d === 'inline' || d === 'none') return; cutSet.add(Math.round((r.bottom - elTop) * factor)) })
    const cuts = [...cutSet].filter((v) => v > 0 && v <= canvas.height).sort((a, b) => a - b)
    const pageHpx = Math.floor(A4L_H / fit) // source px that fill one A4 page
    let y = 0; buf.width = canvas.width
    while (y < canvas.height) {
      let end = Math.min(y + pageHpx, canvas.height)
      if (end < canvas.height) { const safe = cuts.filter((c) => c > y + pageHpx * 0.5 && c <= end); if (safe.length) end = safe[safe.length - 1] }
      const h = end - y
      buf.height = h; bctx.fillStyle = bg; bctx.fillRect(0, 0, buf.width, h); bctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
      page()
      pdf.addImage(buf.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4L_W, h * fit) // top-aligned
      y = end
    }
  }
  if (started) pdf.save(fileName)
}

// Bounds + label for a 'YYYY-MM' month string (UTC-safe).
export function monthBounds(m) {
  const [y, mo] = m.split('-').map(Number)
  const from = `${m}-01`
  const end = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const to = `${m}-${String(end).padStart(2, '0')}`
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { from, to, label }
}
export const monthShort = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' }) }
// A report period spanning one or more months (from month `a` to month `b`).
export function periodOf(a, b) {
  const lo = a <= b ? a : b, hi = a <= b ? b : a
  const from = `${lo}-01`, to = monthBounds(hi).to, single = lo === hi
  const label = single ? monthBounds(lo).label : `${monthBounds(lo).label} – ${monthBounds(hi).label}`
  return { from, to, label, key: single ? lo : `${lo}_${hi}`, single, lo, hi }
}
// Pretty label for a stored snapshot key - a single month ("2026-07") or a
// range ("2026-06_2026-07"). Used by the reports lists / month pickers.
export function snapLabel(key) {
  if (!key) return ''
  const s = String(key)
  const [lo, hi] = s.includes('_') ? s.split('_') : [s, s]
  return periodOf(lo, hi).label
}
// Default month = last complete calendar month.
export function lastCompleteMonth() {
  const d = new Date()
  const first = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))
  first.setUTCDate(0) // → last day of previous month
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`
}
export const MR_MONTHS = (back = 18) => {
  const out = []; const now = new Date()
  let y = now.getFullYear(), m = now.getMonth() // 0-based; start at current month, walk back
  for (let i = 0; i < back; i++) { out.push(`${y}-${String(m + 1).padStart(2, '0')}`); m--; if (m < 0) { m = 11; y-- } }
  return out
}


// Resilient fetch for report assembly: retries a section that times out / 429s /
// returns a soft error, so a cold-cache first "Generate" doesn't freeze a snapshot
// with missing sections (which is why it used to take a few refreshes). Aborts a
// hung request so one slow pull can't stall the whole generate.
export async function mrFetchTry(qs, { tries = 3, timeoutMs = 22000 } = {}) {
  let lastErr = null
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(`/.netlify/functions/windsor?${qs}`, { signal: ctrl.signal })
      const j = await r.json().catch(() => null)
      if (r.ok && j && !j.error) return j
      lastErr = new Error((j && j.error) || `HTTP ${r.status}`)
    } catch (e) { lastErr = e }
    finally { clearTimeout(timer) }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, Math.min(8000, 1200 * (i + 1))))
  }
  throw lastErr || new Error('failed')
}

// Pull every scope the deck needs for one client + month, in parallel, and
// shape the frozen report payload.
export async function assembleMonthlyReport(client, period, onProgress) {
  const b = { from: period.from, to: period.to, label: period.label }
  const q = `client=${encodeURIComponent(client.id)}&${rangeQuery(b)}`
  // Every part is retried (twelve goes, pauses growing to eight seconds) and
  // the report is only built once every part has answered - a deck with a
  // section quietly missing reads as real figures. Progress goes to the caller.
  const failed = []
  const wanted = []
  let done = 0
  const note = (t) => { if (onProgress) onProgress({ done, total: wanted.length, note: t }) }
  const section = (label, want, qs2, pick) => {
    if (!want) return Promise.resolve(null)
    wanted.push(label)
    return mrFetchTry(qs2, { tries: 12 }).then(pick).catch(() => { failed.push(label); return null }).finally(() => { done++; note(`${label} · ${done} of ${wanted.length} parts`) })
  }
  const parts = Promise.all([
    section('Meta Ads', client.meta, `channel=meta&${q}`, (r) => r.meta),
    section('Google Ads', client.google, `channel=google&${q}`, (r) => r.google),
    section('Overview', true, `channel=blend&${q}`, (r) => r.blend),
    section('CRM attribution', client.ghl, `channel=attribution&${q}`, (r) => r.attribution),
    section('13-month trend', client.meta || client.google, `scope=monthlytrend&months=13&${q}`, (r) => ({ trend: r.trend || [], gtrend: r.gtrend || [] })),
    section('CRM deals', client.ghl, `scope=monthlydeals&${q}`, (r) => r.deals),
    section('Form performance', client.ghl, `scope=forms&${q}`, (r) => ({ forms: r.forms, pipelines: r.pipelines })),
  ])
  note('Reading Meta, Google and the CRM…')
  const [meta, google, blend, attribution, trendR, dealsR, formsR] = await parts
  if (failed.length) throw new Error(`These parts did not answer after twelve tries: ${failed.join(', ')}. Nothing was saved - press Generate to try again.`)
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
  // Form performance: compute the client's configured key-event reach PER FORM at
  // freeze time (same helper the live Forms tab uses), so the report slide matches
  // the client view - Leads → each key event → Revenue - instead of the generic
  // booked/shown/won. Store only the counts (not the heavy per-lead people arrays).
  let formsRich = [], formKe = [], formKeByPipe = null
  try {
    const fArr = formsR && Array.isArray(formsR.forms) ? formsR.forms : (Array.isArray(formsR) ? formsR : [])
    if (fArr.length) {
      const pipesArr = (formsR && formsR.pipelines) || []
      const liveForms = fArr.filter((f) => (f.leads || 0) > 0)
      // Build a Leads → key-event reach block for a pipeline scope. 'all' = the
      // union across every pipeline (single-pipeline clients / back-compat); a real
      // pipeline id scopes both the key-event COLUMNS and each form's reach to that
      // pipeline, so multi-pipeline clients get one clean table per pipeline with no
      // duplicated columns. pipeLeads = the form's leads whose opp sits in this
      // pipeline (the denominator for that table); union keeps the raw lead count.
      const buildBlock = (pipeKey) => {
        const fke = formKeyEvents(client.id, pipeKey, pipesArr)
        const evs = fke.events || []
        const events = evs.map((k) => ({ label: k.label, kind: k.kind || 'stage' }))
        const forms = liveForms.map((f) => ({
          form: f.form, kind: f.kind, leads: f.leads || 0, booked: f.booked || 0, shown: f.shown || 0, won: f.won || 0, revenue: f.revenue || 0,
          ke: evs.map((k) => (f.people || []).reduce((n, p) => n + (fke.reached(p, k) ? 1 : 0), 0)),
          pipeLeads: pipeKey === 'all' ? (f.leads || 0) : (f.people || []).reduce((n, p) => n + (p && p.pipelineId === pipeKey ? 1 : 0), 0),
        }))
        return { events, forms }
      }
      const uni = buildBlock('all')
      formKe = uni.events
      formsRich = uni.forms.slice(0, 30).map(({ pipeLeads, ...f }) => f)
      if (pipesArr.length > 1) {
        formKeByPipe = pipesArr.map((p) => {
          const b = buildBlock(p.id)
          const forms = b.forms.filter((f) => f.pipeLeads > 0).sort((a, b2) => b2.pipeLeads - a.pipeLeads).slice(0, 30)
            .map(({ pipeLeads, ...f }) => ({ ...f, leads: pipeLeads }))
          return { pipelineId: p.id, pipelineName: p.name, events: b.events, forms }
        }).filter((blk) => blk.events.length && blk.forms.length)
        if (formKeByPipe.length < 2) formKeByPipe = null
      }
    }
  } catch { formsRich = []; formKe = []; formKeByPipe = null }
  return {
    v: 1, client: { id: client.id, name: client.name, industry: client.industry || null },
    month: period.key, period: b, currency: undefined,
    hasMeta: !!client.meta, hasGoogle: !!client.google, hasCrm: !!client.ghl,
    meta, google, blend, attribution: attrTrim, trend: (trendR && trendR.trend) || [], gtrend: (trendR && trendR.gtrend) || [], deals: dealsR || null,
    // ID→name folds so Google's utm_campaign / utm_content (which carry the numeric
    // campaign / ad-group ID, not the name) resolve to the live campaign name - the
    // exact map the Meta/Google views pass to aliasedOutcomeMap. Without it the
    // report's per-campaign key-event columns show "-" for Google (Meta matches by
    // name so it was unaffected).
    campIdMap: (attribution && attribution.campIdMap) || {},
    mediumIdMap: (attribution && attribution.mediumIdMap) || {},
    // Per-campaign CRM outcome entities (utm_campaign) so the report can render
    // the Caalano360 green key-event columns + costings by campaign, same as the
    // Meta Ads view. Top 40 by leads keeps the frozen blob lean.
    campOutcomes: (attribution && Array.isArray(attribution.byCampaign)) ? attribution.byCampaign.slice(0, 40) : [],
    // Per-ad-set / ad-group CRM outcome entities (utm_medium) so the "Key events by
    // campaign" slide can expand a campaign into its ad sets (Meta) / ad groups
    // (Google) with the same green key-event columns. Google's utm_medium carries the
    // numeric ad-group ID, folded to its name via mediumIdMap in aliasedOutcomeMap.
    medOutcomes: (attribution && Array.isArray(attribution.byMedium)) ? attribution.byMedium.slice(0, 80).map((m) => { const { detail, opps, ...rest } = m; return rest }) : [],
    // Per-source CRM outcome entities (utm_source) - same key-event fields as the
    // campaign ones - so the report can break the non-paid "other sources" into
    // named channels (organic / direct / referral / email / social / CRM). The heavy
    // nested `detail`/`opps` are dropped to keep the frozen blob lean.
    srcOutcomes: (attribution && Array.isArray(attribution.bySource)) ? attribution.bySource.slice(0, 40).map((s) => { const { detail, opps, ...rest } = s; return rest }) : [],
    // Per-creative CRM outcome entities (utm_content) so the creative slide can show
    // the client's full configured key events per creative, not just leads/booked/won.
    creOutcomes: (attribution && Array.isArray(attribution.byCreative)) ? attribution.byCreative.slice(0, 120) : [],
    wonClosed: (blend && blend.wonClosed) || null,
    // Per-form performance for the Form Performance slide: leads + the client's
    // configured key-event reach counts per form (formKe = the column labels), top
    // 30 by leads - so the slide mirrors the live Forms tab.
    forms: formsRich, formKe, formKeByPipe,
    generatedAt: new Date().toISOString(),
    _incomplete: failed, // sections that failed after retries (transient, for a UI warning)
  }
}

// --- small presentational pieces -------------------------------------------
export function MRSlide({ n, total, kicker, title, sub, children, tone, notes }) {
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
      {notes && String(notes).trim() ? <div className="mr-notes"><div className="mr-notes-lab">Notes</div><div className="mr-notes-txt">{String(notes).trim()}</div></div> : null}
    </section>
  )
}
export function MRTable({ cols, rows, empty = 'No data for this period.', max, wrapClass = '' }) {
  const data = max ? rows.slice(0, max) : rows
  if (!rows || !rows.length) return <div className="mr-empty">{empty}</div>
  return (
    <div className={'mr-tablewrap' + (wrapClass ? ' ' + wrapClass : '')}>
      <table className="mr-table">
        <thead><tr>{cols.map((c) => <th key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i}>{cols.map((c) => <td key={c.k} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(row) : row[c.k]}</td>)}</tr>)}</tbody>
      </table>
      {max && rows.length > max && <div className="mr-more">+ {rows.length - max} more not shown</div>}
    </div>
  )
}
// Three compact month-over-month charts (Spend, Leads, CPL) for the Meta slide.
export function MRTrend({ trend, currency }) {
  if (!trend || trend.length < 2) return <div className="mr-empty">Not enough history yet for a trend - this fills in as months accrue.</div>
  const money = (v) => fmtCurrency(v, currency)
  const charts = [
    { key: 'spend', label: 'Ad spend', kind: 'bar', color: '#6d5efc', fmt: money },
    { key: 'leads', label: 'Results', kind: 'bar', color: '#22b07d', fmt: (v) => fmtNumber(v) },
    { key: 'cpl', label: 'Cost per result', kind: 'line', color: '#e0803a', fmt: (v) => (v == null ? '-' : money(v)) },
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

// A platform's month-by-month page: the report month beside up to twelve
// months before it - each tile against the month before, the three-month
// average and the same month a year earlier; two bar series and a line on one
// chart (counts on the left scale, money on the right); a month table. Reads
// the trend the deck froze; older decks carry fewer fields and read accordingly.
export function MRMonthPerf({ trend, monthKey, money, spec }) {
  const rows = (trend || []).filter((r) => r && r.month).slice(-13)
  if (rows.length < 2) return <div className="mr-empty">Not enough history yet for a month-by-month view - this fills in as months accrue.</div>
  const lab = (m) => { const [y, mo] = String(m).split('-'); return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' }) }
  const data = rows.map((r) => ({ ...spec.derive(r), month: r.month, lbl: lab(r.month) }))
  let ci = data.findIndex((r) => r.month === monthKey); if (ci < 0) ci = data.length - 1
  const cur = data[ci], prev = ci > 0 ? data[ci - 1] : null
  const last3 = data.slice(Math.max(0, ci - 3), ci)
  const avg3 = last3.length === 3 ? (k) => { const vs = last3.map((r) => r[k]).filter((v) => v != null && isFinite(v)); return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : null } : null
  const yoy = ci >= 12 ? data[ci - 12] : null
  const tiles = spec.tiles.filter(Boolean)
  const cmps = (k) => [prev && ['vs ' + prev.lbl, prev[k]], avg3 && ['vs 3-mo avg', avg3(k)], yoy && ['vs ' + yoy.lbl, yoy[k]]].filter((x) => x && x[1] != null)
  const tableRows = data.slice().reverse()
  const cols = spec.cols.filter(Boolean)
  return (
    <div className="mr-mp">
      <div className="mr-kpirow mr-kpirow-wide">
        {tiles.map((t) => (
          <div key={t.k} className={`mr-kpi${t.strong ? ' mr-kpi-strong' : ''}`}>
            <span className="mr-kpi-lab">{t.label}</span>
            <b className="mr-kpi-val">{cur[t.k] == null ? '-' : t.fmt(cur[t.k])}</b>
            <div className="mr-cmp">{cmps(t.k).map(([l, v]) => <span key={l} className="mr-cmp-row"><Dlt cur={cur[t.k]} prev={v} good={t.good} dp={1} /><small>{l}</small></span>)}</div>
          </div>
        ))}
      </div>
      <div className="mr-mp-chart">
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={data} margin={{ top: 18, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="lbl" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={0} />
            <YAxis yAxisId="n" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => fmtCompact(v)} />
            <YAxis yAxisId="$" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => '$' + fmtCompact(v)} />
            <Tooltip formatter={(v, name, item) => [item && item.dataKey === spec.bars.k ? spec.bars.fmt(v) : money(v), name]} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="n" dataKey={spec.bars.k} name={spec.bars.name} fill="#4f7cff" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="$" dataKey={spec.bars2.k} name={spec.bars2.name} fill="#c3c7d3" radius={[4, 4, 0, 0]}>
              <LabelList dataKey={spec.bars2.k} position="top" formatter={(v) => (v == null ? '' : money(v))} style={{ fontSize: 10, fill: 'var(--muted)' }} />
            </Bar>
            <Line yAxisId="$" type="monotone" dataKey={spec.line.k} name={spec.line.name} stroke="var(--text)" strokeWidth={2} dot={{ r: 2.5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table className="mini-tbl mr-mp-tbl">
          <thead><tr><th className="lft">Month</th>{cols.map((c) => <th key={c.k}>{c.label}</th>)}</tr></thead>
          <tbody>{tableRows.map((r) => (
            <tr key={r.month} className={r.month === cur.month ? 'row-sel' : ''}>
              <td className="lft">{r.lbl}</td>
              {cols.map((c) => <td key={c.k}>{r[c.k] == null ? '-' : c.fmt(r[c.k])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
export function MRMetaPerf({ trend, monthKey, money, n0, resultType }) {
  const hasImpr = (trend || []).some((r) => r && r.impressions > 0)
  const resLabel = resultType || 'Leads'
  const one = resLabel.toLowerCase().replace(/s$/, '')
  const pct2 = (v) => fmtPct(v, 2)
  const spec = {
    derive: (r) => ({ ...r, cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null, ctr: r.impressions ? ((r.linkClicks || 0) / r.impressions) * 100 : null, cpc: r.linkClicks ? r.spend / r.linkClicks : null, cpl: r.leads ? r.spend / r.leads : null }),
    tiles: [
      { k: 'spend', label: 'Amount spent', fmt: money, good: 'neu' },
      hasImpr && { k: 'cpm', label: 'CPM', fmt: money, good: 'down' },
      hasImpr && { k: 'impressions', label: 'Impressions', fmt: n0, good: 'neu' },
      hasImpr && { k: 'linkClicks', label: 'Link clicks', fmt: n0, good: 'up' },
      hasImpr && { k: 'ctr', label: 'CTR', fmt: pct2, good: 'up' },
      hasImpr && { k: 'cpc', label: 'CPC', fmt: money, good: 'down' },
      { k: 'leads', label: resLabel, fmt: n0, good: 'up' },
      { k: 'cpl', label: `Cost / ${one}`, fmt: money, good: 'down', strong: true },
    ],
    bars: { k: 'leads', name: resLabel, fmt: (v) => fmtNumber(v) }, bars2: { k: 'cpl', name: `Cost / ${one}` }, line: { k: 'spend', name: 'Amount spent' },
    cols: [hasImpr && { k: 'impressions', label: 'Impressions', fmt: n0 }, hasImpr && { k: 'linkClicks', label: 'Link clicks', fmt: n0 }, { k: 'leads', label: resLabel, fmt: n0 }, { k: 'spend', label: 'Cost', fmt: money }, hasImpr && { k: 'cpc', label: 'CPC', fmt: money }, hasImpr && { k: 'cpm', label: 'CPM', fmt: money }, hasImpr && { k: 'ctr', label: 'CTR', fmt: pct2 }, { k: 'cpl', label: `Cost / ${one}`, fmt: money }],
  }
  return <MRMonthPerf trend={trend} monthKey={monthKey} money={money} spec={spec} />
}
export function MRGooglePerf({ trend, monthKey, money, n0 }) {
  const n1 = (v) => (v == null || isNaN(v) ? '-' : fmtNumber(Math.round(v * 10) / 10))
  const pct2 = (v) => fmtPct(v, 2)
  const spec = {
    derive: (r) => ({ ...r, ctr: r.impressions ? (r.clicks / r.impressions) * 100 : null, cpc: r.clicks ? r.cost / r.clicks : null, cpa: r.conversions ? r.cost / r.conversions : null, cvr: r.clicks ? (r.conversions / r.clicks) * 100 : null }),
    tiles: [
      { k: 'impressions', label: 'Impressions', fmt: n0, good: 'neu' },
      { k: 'clicks', label: 'Clicks', fmt: n0, good: 'up' },
      { k: 'ctr', label: 'CTR', fmt: pct2, good: 'up' },
      { k: 'cost', label: 'Cost', fmt: money, good: 'neu' },
      { k: 'conversions', label: 'Conversions', fmt: n1, good: 'up' },
      { k: 'cpa', label: 'Cost / conv.', fmt: money, good: 'down', strong: true },
      { k: 'cvr', label: 'Conv. rate', fmt: pct2, good: 'up' },
      { k: 'cpc', label: 'Avg CPC', fmt: money, good: 'down' },
    ],
    bars: { k: 'conversions', name: 'Conversions', fmt: n1 }, bars2: { k: 'cpa', name: 'Cost / conv.' }, line: { k: 'cost', name: 'Cost' },
    cols: [{ k: 'impressions', label: 'Impressions', fmt: n0 }, { k: 'cvr', label: 'Conv. rate', fmt: pct2 }, { k: 'clicks', label: 'Clicks', fmt: n0 }, { k: 'ctr', label: 'CTR', fmt: pct2 }, { k: 'cost', label: 'Cost', fmt: money }, { k: 'conversions', label: 'Conversions', fmt: n1 }, { k: 'cpa', label: 'Cost / conv.', fmt: money }],
  }
  return <MRMonthPerf trend={trend} monthKey={monthKey} money={money} spec={spec} />
}

// Beside the lost-reasons table: one pie, flipped between where this month's
// leads stand (won, lost, still open) and why the lost ones were lost.
export function MRLostPie({ status, reasons, money }) {
  const [mode, setMode] = useState('status')
  const data = mode === 'status' ? status : reasons
  return (
    <div className="mr-lost-pie">
      <div className="mr-viz-lab mr-pie-head"><span>{mode === 'status' ? 'Where this month\'s leads stand' : 'Why deals were lost'}</span>
        <span className="subtabs mr-pie-toggle no-print"><button type="button" className={mode === 'status' ? 'active' : ''} onClick={() => setMode('status')}>Status</button><button type="button" className={mode === 'reasons' ? 'active' : ''} onClick={() => setMode('reasons')}>Lost reason</button></span>
      </div>
      {data && data.length ? <MRDonut data={data} money={money} /> : <div className="mr-empty">{mode === 'status' ? 'No leads this month.' : 'No deals were marked lost this month.'}</div>}
      <p className="mr-foot-note">{mode === 'status' ? 'This month\'s leads by where they stand now. Abandoned deals count as lost.' : 'Share of the deals marked lost this month.'}</p>
    </div>
  )
}

// Client-facing Monthly Reports: read-only, PUBLISHED frozen reports only, for the
// clients the viewer is allocated. No generate / refresh / publish controls. Reuses
// the same deck renderer as the agency Monthly Report, in continuous (scroll) view.
export function ClientReports({ clients, currency }) {
  useSettingsSync() // notes and the key events shown arrive with the settings
  const list = (clients || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  // Deep link: ?c= client, ?m= published report month - so a shared link opens
  // straight onto that report.
  const nav0 = readNavUrl()
  const [clientId, setClientId] = useState((nav0.c && list.some((c) => c.id === nav0.c)) ? nav0.c : (list[0] ? list[0].id : ''))
  const client = list.find((c) => c.id === clientId) || list[0] || null
  const [months, setMonths] = useState(null) // [{ month, publishedAt }]
  const [month, setMonth] = useState(nav0.m || '')
  const wantMonthRef = useRef(nav0.m || '') // honour the URL month on first load only
  const [canDownload, setCanDownload] = useState(false) // agency-controlled (server flag)
  const [st, setSt] = useState({ status: 'idle' })
  const [exporting, setExporting] = useState(false)
  const [drill, setDrill] = useState(null)
  const [formDrill, setFormDrill] = useState(null) // {form, event, pipeKey} - who is behind one Form performance cell
  const [copied, setCopied] = useState(false)
  // Slides by default, as on the staff view: one page at a time reads better
  // than a long scroll. Scroll stays one click away.
  const [view, setView] = useState('slides')
  const [idx, setIdx] = useState(0)
  const copyLink = () => { try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ } }
  const deckRef = useRef(null)
  const money = (v) => (v == null || isNaN(v) ? '-' : fmtCurrency(v, currency))
  const n0 = (v) => (v == null || isNaN(v) ? '-' : fmtNumber(Math.round(v)))
  const pc = (a, b) => (b ? fmtPct((a / b) * 100, 1) : '-')
  useEffect(() => {
    if (!client) { setMonths(null); return }
    let alive = true; setMonths(null); setMonth('')
    const want = wantMonthRef.current; wantMonthRef.current = '' // URL month applies to the first load only
    mrFetch(`scope=monthlysnap&client=${encodeURIComponent(client.id)}&list=1`)
      .then((r) => { if (!alive) return; const ms = ((r && r.months) || []).map((x) => (typeof x === 'string' ? { month: x } : x)); setMonths(ms); const pick = (want && ms.some((x) => x.month === want)) ? want : (ms[0] ? ms[0].month : ''); setMonth(pick); setCanDownload(!!(r && r.downloadAllowed)) })
      .catch(() => { if (alive) { setMonths([]); setCanDownload(false) } })
    return () => { alive = false }
  }, [clientId])
  // Mirror client + report into the URL (the shareable deep link).
  useEffect(() => { if (client && month) writeNavUrl({ v: 'reports', c: client.id, m: month }, false) }, [clientId, month])
  useEffect(() => {
    if (!client || !month) { setSt({ status: 'idle' }); return }
    let alive = true; setSt({ status: 'loading' })
    mrFetch(`scope=monthlysnap&client=${encodeURIComponent(client.id)}&month=${encodeURIComponent(month)}`)
      .then((r) => { if (!alive) return; if (r && r.saved && r.report) setSt({ status: 'ok', report: r.report, publishedAt: r.publishedAt }); else setSt({ status: 'empty' }) })
      .catch(() => { if (alive) setSt({ status: 'err' }) })
    return () => { alive = false }
  }, [clientId, month])
  const rep = st.status === 'ok' ? st.report : null
  const mrsC = client ? loadMReport(client.id) : {}
  const notesC = (rep && mrsC.notes && mrsC.notes[rep.month]) || null
  const keOffC = mrsC.keOff || []
  const hiddenC = Array.isArray(mrsC.hidden) ? mrsC.hidden : MR_DEFAULT_HIDDEN
  const deck = React.useMemo(() => (rep ? renderMonthlyDeck(rep, { currency, money, n0, pc, openDrill: (d) => setDrill(d), setFormDrill, notes: notesC, keOff: new Set(keOffC) }).filter((el) => !hiddenC.includes(el.key)) : []), [rep, currency, JSON.stringify(notesC), keOffC.join('|'), hiddenC.join('|')])
  const total = deck.length
  const cur = Math.max(0, Math.min(idx, total - 1))
  const slideTitle = (el, i) => (el && el.props && (el.props.title || el.props.kicker)) || (el && el.key === 'cover' ? 'Cover' : `Slide ${i + 1}`)
  useEffect(() => { setIdx(0) }, [clientId, month, view])
  useEffect(() => {
    if (view !== 'slides' || !total || drill || formDrill) return
    const onKey = (e) => {
      if (/^(input|select|textarea)$/i.test((e.target && e.target.tagName) || '')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { setIdx((i) => Math.min(i + 1, total - 1)); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { setIdx((i) => Math.max(i - 1, 0)); e.preventDefault() }
      else if (e.key === 'Home') { setIdx(0) } else if (e.key === 'End') { setIdx(total - 1) }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [view, total, drill, formDrill])
  async function downloadPdf() {
    if (!deckRef.current) return
    setExporting(true); deckRef.current.classList.add('mr-exporting')
    try {
      const slides = [...deckRef.current.querySelectorAll('.mr-slide')]
      await exportSlidesToPdf(slides, `${((client && client.name) || 'report').replace(/[^\w]+/g, '-')}-${month}.pdf`)
    } catch (e) { alert('PDF export failed: ' + (e.message || e)) }
    if (deckRef.current) deckRef.current.classList.remove('mr-exporting')
    setExporting(false)
  }
  if (!list.length) return <div className="mr-page"><div className="mr-note mr-empty-deep"><div className="big">🗓️</div><b>No reports assigned yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>Your account has Monthly Reports access, but no client is linked to it yet. Your agency will set this up.</p></div></div>
  return (
    <div className="mr-page">
      <div className="mr-bar no-print">
        {list.length > 1 && <select className="mr-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <select className="mr-select" value={month} onChange={(e) => setMonth(e.target.value)} disabled={!months || !months.length}>
          {months && months.length ? months.map((m) => <option key={m.month} value={m.month}>{snapLabel(m.month)}</option>) : <option value="">No published reports</option>}
        </select>
        <div className="mr-bar-spacer" />
        {st.publishedAt && <span className="mr-saved pub" title={`Published ${new Date(st.publishedAt).toLocaleString('en-AU')}`}>🟢 Published {new Date(st.publishedAt).toLocaleDateString('en-AU')}</span>}
        {rep && <span className="mr-seg" role="group" aria-label="Layout">
          <button className={view === 'slides' ? 'on' : ''} onClick={() => setView('slides')}>▤ Slides</button>
          <button className={view === 'scroll' ? 'on' : ''} onClick={() => setView('scroll')}>▦ Scroll</button>
        </span>}
        {rep && <button className="mr-btn" onClick={copyLink} title="Copy a direct link to this report">{copied ? '✓ Link copied' : '🔗 Copy link'}</button>}
        {canDownload && <button className="mr-btn" onClick={downloadPdf} disabled={!rep || exporting} title="Download as PDF">{exporting ? 'Exporting…' : '⤓ Download PDF'}</button>}
      </div>
      {months && !months.length && <div className="mr-note mr-empty-deep"><div className="big">🗓️</div><b>No published reports yet.</b><p style={{ maxWidth: 460, margin: '8px auto 0' }}>When your agency publishes a monthly report for {client ? client.name : 'your account'}, it will appear here.</p></div>}
      {st.status === 'loading' && <div className="card pv-loading"><Spinner big label="Loading the report…" /></div>}
      {st.status === 'err' && <div className="mr-note mr-err">Couldn’t load this report - please try again shortly.</div>}
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
      {rep && <div className={'mr-deck' + (view === 'slides' ? ' mr-slides' : '')} ref={deckRef}><div className="mr-track" style={view === 'slides' ? { transform: `translateX(-${cur * 100}%)` } : undefined}>{deck}</div></div>}
      {drill && <MRDrill drill={drill} currency={currency} campMap={rep && rep.campIdMap} medMap={rep && rep.mediumIdMap} onClose={() => setDrill(null)} />}
      {formDrill && rep && rep.client && <MRFormDrill clientId={rep.client.id} range={rep.period} form={formDrill.form} event={formDrill.event} pipeKey={formDrill.pipeKey} currency={currency} onClose={() => setFormDrill(null)} />}
    </div>
  )
}
export function MonthlyReport({ clients, currency, authUser }) {
  useSettingsSync() // re-render when the client-download flag is toggled
  const canToggleDownload = isAdminishFE(authUser && authUser.role) // admin / super-admin only
  const list = (clients || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  // Seed client + report month from the URL (?c=&m=) so a shared link opens
  // straight onto that client's report. m is a snapshot key: "2026-07" or a range
  // "2026-05_2026-07".
  const nav0 = readNavUrl()
  const urlM = nav0.m && /^\d{4}-\d{2}(_\d{4}-\d{2})?$/.test(nav0.m) ? nav0.m : null
  const [clientId, setClientId] = useState((nav0.c && list.some((c) => c.id === nav0.c)) ? nav0.c : (list[0] ? list[0].id : ''))
  const client = list.find((c) => c.id === clientId) || list[0] || null
  const [fromMonth, setFromMonth] = useState(urlM ? urlM.split('_')[0] : lastCompleteMonth())
  const [toMonth, setToMonth] = useState(urlM ? (urlM.includes('_') ? urlM.split('_')[1] : urlM.split('_')[0]) : lastCompleteMonth())
  const period = periodOf(fromMonth, toMonth)
  // Mirror the selected client + report into the URL (replace, so it doesn't spam
  // history) - this is the shareable deep link.
  useEffect(() => { if (client) writeNavUrl({ v: 'monthly', c: client.id, m: period.key }, false) }, [clientId, period.key])
  const [copied, setCopied] = useState(false)
  const copyLink = () => {
    try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }
  const [st, setSt] = useState({ status: 'idle' }) // idle|loading|ok|err|empty ; {report, frozen}
  const [saved, setSaved] = useState(null) // {savedAt, savedBy, published, publishedAt, publishedBy, edited}
  const [busy, setBusy] = useState(false)
  const [pubBusy, setPubBusy] = useState(false)
  const [snapList, setSnapList] = useState(null) // [{month, savedAt, publishedAt, published, edited}]
  const [snapBump, setSnapBump] = useState(0)    // re-fetch trigger after publish/generate
  const [showList, setShowList] = useState(false)
  const [genWarn, setGenWarn] = useState(null) // sections that failed on the last generate
  const [prog, setProg] = useState(null) // {done, total, note} while generating
  const [editing, setEditing] = useState(false) // the notes panel beside the deck
  const [exporting, setExporting] = useState(false)
  const [drill, setDrill] = useState(null) // {title, kind, deals}
  const [formDrill, setFormDrill] = useState(null) // {form, event, pipeKey} - who is behind one Form performance cell
  const [view, setView] = useState('slides') // slides (one page at a time) | scroll (continuous)
  const [idx, setIdx] = useState(0)
  const deckRef = useRef(null)
  const pageRef = useRef(null)
  const [fs, setFs] = useState(false)
  const present = () => { const el = pageRef.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}) }
  useEffect(() => { const on = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on) }, [])
  const money = (v) => (v == null || isNaN(v) ? '-' : fmtCurrency(v, currency))
  const n0 = (v) => (v == null || isNaN(v) ? '-' : fmtNumber(Math.round(v)))
  const pc = (a, b) => (b ? fmtPct((a / b) * 100, 1) : '-')

  // Load the frozen snapshot whenever client or the selected period changes.
  useEffect(() => {
    if (!client) return
    let alive = true
    setSt({ status: 'loading' }); setSaved(null)
    mrFetch(`scope=monthlysnap&client=${encodeURIComponent(client.id)}&month=${period.key}`)
      .then((r) => { if (!alive) return; if (r && r.saved) { setSaved({ savedAt: r.savedAt, savedBy: r.savedBy, published: !!r.published, publishedAt: r.publishedAt || null, publishedBy: r.publishedBy || null, edited: !!r.edited }); setSt({ status: 'ok', report: r.report, frozen: true }) } else setSt({ status: 'empty' }) })
      .catch(() => { if (alive) setSt({ status: 'empty' }) })
    return () => { alive = false }
  }, [clientId, period.key, snapBump])
  // Per-client list of every generated report + its saved/published status.
  useEffect(() => {
    if (!client) { setSnapList(null); return }
    let alive = true
    mrFetch(`scope=monthlysnap&client=${encodeURIComponent(client.id)}&list=1`)
      .then((r) => { if (alive) setSnapList(Array.isArray(r && r.rows) ? r.rows : []) })
      .catch(() => { if (alive) setSnapList([]) })
    return () => { alive = false }
  }, [clientId, snapBump])
  // Publish / unpublish a generated month for the client's Reports view.
  async function publishAction(month, action) {
    if (!client) return
    setPubBusy(true)
    try {
      const r = await fetch(`/.netlify/functions/windsor?scope=monthlysnap&client=${encodeURIComponent(client.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month, action }) }).then((x) => x.json()).catch(() => null)
      if (r && r.ok) setSnapBump((n) => n + 1)
    } finally { setPubBusy(false) }
  }

  async function generate() {
    if (!client) return
    setBusy(true); setSt({ status: 'loading' }); setGenWarn(null); setProg({ done: 0, total: 1, note: 'Starting…' })
    try {
      const report = await assembleMonthlyReport(client, period, setProg)
      delete report._incomplete
      setSt({ status: 'ok', report, frozen: false })
      const save = await fetch(`/.netlify/functions/windsor?scope=monthlysnap&client=${encodeURIComponent(client.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: period.key, report }) }).then((x) => x.json()).catch(() => null)
      if (save && save.ok) { setSaved({ savedAt: save.savedAt, savedBy: save.savedBy, published: !!save.publishedAt, publishedAt: save.publishedAt || null, edited: !!save.publishedAt }); setSt({ status: 'ok', report, frozen: true }); setSnapBump((n) => n + 1) }
    } catch (e) { setSt({ status: 'err', error: String(e.message || e) }) }
    setProg(null); setBusy(false)
  }

  async function downloadPdf() {
    if (!deckRef.current) return
    setExporting(true)
    // Force the deck into a laid-out, non-transformed column so every slide
    // (including the ones translated off-screen in Slides view) captures cleanly.
    deckRef.current.classList.add('mr-exporting')
    try {
      const slides = [...deckRef.current.querySelectorAll('.mr-slide')]
      await exportSlidesToPdf(slides, `${(client && client.name || 'report').replace(/[^\w]+/g, '-')}-${period.key}.pdf`)
    } catch (e) { alert('PDF export failed: ' + (e.message || e)) }
    if (deckRef.current) deckRef.current.classList.remove('mr-exporting')
    setExporting(false)
  }

  const rep = st.status === 'ok' ? st.report : null
  // Notes per page for this report, drafted here and saved as you type; the
  // key events the client sees on the creative screen, per client.
  const canEdit = !isClientRoleFE(authUser && authUser.role)
  const [draft, setDraft] = useState({})
  useEffect(() => { const m = client ? loadMReport(client.id) : {}; setDraft((m.notes && m.notes[period.key]) || {}) }, [clientId, period.key])
  const noteTimer = useRef(null)
  const saveNotes = (d) => { if (!client) return; const cur = loadMReport(client.id); saveMReport(client.id, { notes: { ...(cur.notes || {}), [period.key]: d } }) }
  const setNote = (k, v) => setDraft((d) => { const nx = { ...d, [k]: v }; clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => saveNotes(nx), 800); return nx })
  const keOffArr = (client && loadMReport(client.id).keOff) || []
  const toggleKe = (label) => { if (!client) return; const set = new Set(loadMReport(client.id).keOff || []); if (set.has(label)) set.delete(label); else set.add(label); saveMReport(client.id, { keOff: [...set] }) }
  const notesKey = JSON.stringify(draft)
  // Pages the client does not get: a saved list per client, or the default
  // (the key-events-by-campaign and form pages stay off until switched on).
  const hiddenArr = (client && Array.isArray(loadMReport(client.id).hidden)) ? loadMReport(client.id).hidden : MR_DEFAULT_HIDDEN
  const togglePage = (key) => { if (!client) return; const set = new Set(hiddenArr); if (set.has(key)) set.delete(key); else set.add(key); saveMReport(client.id, { hidden: [...set] }) }
  const deckAll = React.useMemo(() => (rep ? renderMonthlyDeck(rep, { currency, money, n0, pc, openDrill: (d) => setDrill(d), setFormDrill, notes: draft, keOff: new Set(keOffArr), onKeOff: canEdit && editing ? toggleKe : null }) : []), [rep, currency, notesKey, keOffArr.join('|'), editing])
  const deck = React.useMemo(() => deckAll.filter((el) => !hiddenArr.includes(el.key)), [deckAll, hiddenArr.join('|')])
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
        {saved && (saved.published
          ? <button className="mr-btn" onClick={() => publishAction(period.key, 'unpublish')} disabled={pubBusy} title={`Published ${saved.publishedAt ? new Date(saved.publishedAt).toLocaleString('en-AU') : ''}${saved.publishedBy ? ' by ' + saved.publishedBy : ''} - click to hide from clients`}>{pubBusy ? '…' : (saved.edited ? '● Re-publish' : '✕ Unpublish')}</button>
          : <button className="mr-btn primary" onClick={() => publishAction(period.key, 'publish')} disabled={pubBusy} title="Make this frozen report visible to clients with Monthly Reports access">{pubBusy ? '…' : '▲ Publish'}</button>)}
        {saved && saved.published && saved.edited && <button className="mr-btn primary" onClick={() => publishAction(period.key, 'publish')} disabled={pubBusy} title="You've regenerated since publishing - push the new version to clients">↻ Push update</button>}
        <button className={`mr-btn${showList ? ' on' : ''}`} onClick={() => setShowList((v) => !v)} title="Show every generated report for this client">☰ Reports{snapList && snapList.length ? ` (${snapList.length})` : ''}</button>
        <div className="mr-bar-spacer" />
        {saved && <span className={`mr-saved${saved.published ? ' pub' : ''}`} title={`Frozen ${new Date(saved.savedAt).toLocaleString('en-AU')}${saved.savedBy ? ' by ' + saved.savedBy : ''}`}>{saved.published ? (saved.edited ? '🟠 Published (edited since)' : '🟢 Published') : '🔒 Frozen - not published'} {saved.savedAt ? new Date(saved.savedAt).toLocaleDateString('en-AU') : ''}</span>}
        <div className="mr-viewtoggle" title="Slides = one section per page · Scroll = continuous">
          <button className={view === 'slides' ? 'on' : ''} onClick={() => setView('slides')}>▤ Slides</button>
          <button className={view === 'scroll' ? 'on' : ''} onClick={() => setView('scroll')}>▦ Scroll</button>
        </div>
        {canToggleDownload && client && <button className={`mr-btn${clientDownloadOn(client.id) ? ' on' : ''}`} onClick={() => setClientDownload(client.id, !clientDownloadOn(client.id))} title={`Allow ${client.name} to download the PDF of their published reports. Off by default - per client.`}>{clientDownloadOn(client.id) ? `✓ ${client.name} PDF: On` : `⃠ ${client.name} PDF: Off`}</button>}
        {canEdit && <button className={`mr-btn${editing ? ' on' : ''}`} onClick={() => setEditing((e) => !e)} disabled={!rep} title="Write notes for each page, and choose the key events the client sees on the creative screen">✎ Notes</button>}
        <button className="mr-btn" onClick={copyLink} title="Copy a direct link to this client + report - share it and it opens right here">{copied ? '✓ Link copied' : '🔗 Copy link'}</button>
        <button className="mr-btn" onClick={present} disabled={!rep} title="Present fullscreen (for screen-share)">{fs ? '⤢ Exit' : '⛶ Present'}</button>
        <button className="mr-btn" onClick={() => window.print()} disabled={!rep} title="Print / Save as PDF">🖨 Print</button>
        <button className="mr-btn" onClick={downloadPdf} disabled={!rep || exporting} title="Download as PDF">{exporting ? 'Exporting…' : '⤓ Download PDF'}</button>
      </div>

      {showList && (
        <div className="mr-snaplist card">
          <div className="cap" style={{ fontWeight: 700, marginBottom: 6 }}>Generated reports · {client ? client.name : ''} <span style={{ fontWeight: 400 }}>· {(snapList || []).length} · a report is only visible to clients once <b>Published</b></span></div>
          {snapList == null ? <Spinner label="Loading…" />
            : snapList.length === 0 ? <p className="cap" style={{ margin: 0 }}>No reports generated for this client yet.</p>
              : <div className="table-wrap"><table className="mini-tbl"><thead><tr><th className="lft">Month</th><th className="lft" title="When this report snapshot was last built / refreshed">Generated</th><th className="lft" title="When this report was last published (made visible to the client)">Published to client</th><th className="lft">Status</th><th /></tr></thead>
                <tbody>{snapList.map((r) => {
                  const isCur = r.month === period.key
                  return (<tr key={r.month} className={isCur ? 'row-sel' : ''}>
                    <td className="lft"><button className="mr-linkbtn" onClick={() => { const k = String(r.month); const [lo, hi] = k.includes('_') ? k.split('_') : [k, k]; setFromMonth(lo); setToMonth(hi) }} title="Open this report">{snapLabel(r.month)}</button></td>
                    <td className="lft">{r.savedAt ? new Date(r.savedAt).toLocaleDateString('en-AU') : '-'}{r.savedBy ? ` · ${r.savedBy}` : ''}</td>
                    <td className="lft">{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString('en-AU') : '-'}{r.publishedBy ? ` · ${r.publishedBy}` : ''}</td>
                    <td className="lft">{r.published ? (r.edited ? <span className="mr-pill-sec">🟠 Published · edited since</span> : <span className="mr-pill-pri">🟢 Published</span>) : <span className="cap">Not published</span>}</td>
                    <td className="lft">{r.published
                      ? <>{r.edited && <button className="mr-btn sm" disabled={pubBusy} onClick={() => publishAction(r.month, 'publish')}>Push update</button>} <button className="mr-btn sm" disabled={pubBusy} onClick={() => publishAction(r.month, 'unpublish')}>Unpublish</button></>
                      : <button className="mr-btn sm primary" disabled={pubBusy} onClick={() => publishAction(r.month, 'publish')}>Publish</button>}</td>
                  </tr>)
                })}</tbody></table></div>}
        </div>
      )}

      {genWarn && <div className="mr-note mr-warn">⚠ These sections didn’t load after a few tries: <b>{genWarn.join(', ')}</b>. They may be missing from this snapshot - click <b>Refresh snapshot</b> to try again (the data is usually cached by now).</div>}
      {st.status === 'loading' && (
        <div className="card pv-loading">
          <Spinner big label={prog ? `Building ${client ? client.name : ''} · ${period.label}` : 'Loading the report…'} />
          {prog ? <><div className="pv-prog"><span style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div><p className="cap">{prog.note}. Every part is read before the report shows, and a slow part is retried.</p></> : null}
        </div>
      )}
      {st.status === 'err' && <div className="card"><p className="cap act-bad" style={{ margin: 0 }}>Couldn’t build the report: {st.error}</p><p style={{ margin: '10px 0 0' }}><button className="mr-btn primary" onClick={generate} disabled={busy}>Try again</button></p></div>}
      {st.status === 'empty' && <div className="mr-note mr-empty-deep"><div className="big">🗓️</div><b>No snapshot for {period.label} yet.</b><p>Pick the client and period (one month, or a range via the two pickers), then <b>Generate snapshot</b> to freeze these numbers. Wins are captured by the month a deal was marked won - so late-closing leads show in the month they closed.</p></div>}

      <div className={'mr-split' + (editing && rep ? ' on' : '')}>
        <div className="mr-main">
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
        </div>
        {editing && rep && (
          <aside className="mr-notes-panel no-print">
            <div className="mr-notes-panel-h"><b>Notes</b><span className="cap">A page shows its notes when they are filled in · saved as you type</span><button type="button" className="mr-btn sm" onClick={() => setEditing(false)}>Done</button></div>
            <p className="cap mr-notes-panel-tip">The key events the client sees on the creative screen are ticked on that page while this panel is open.</p>
            <div className="mr-pages-pick">
              <span className="mr-notes-fld-lab">Pages in this client's reports</span>
              {deckAll.filter((el) => el && el.key !== 'cover').map((el) => <label key={el.key} className={`pv-ke-box${hiddenArr.includes(el.key) ? '' : ' on'}`}><input type="checkbox" checked={!hiddenArr.includes(el.key)} onChange={() => togglePage(el.key)} />{(el.props && el.props.title) || el.key}</label>)}
            </div>
            {deck.map((el, i) => (el && el.props && el.props.title && el.key !== 'cover') ? (
              <label key={el.key} className="mr-notes-fld">
                <span>{i + 1} · {el.props.title}</span>
                <textarea rows={4} value={draft[el.key] || ''} onChange={(e) => setNote(el.key, e.target.value)} onFocus={() => { if (view === 'slides') setIdx(i) }} placeholder="Nothing yet" />
              </label>
            ) : null)}
          </aside>
        )}
      </div>
      {drill && <MRDrill drill={drill} currency={currency} campMap={rep && rep.campIdMap} medMap={rep && rep.mediumIdMap} onClose={() => setDrill(null)} />}
      {formDrill && rep && rep.client && <MRFormDrill clientId={rep.client.id} range={rep.period} form={formDrill.form} event={formDrill.event} pipeKey={formDrill.pipeKey} currency={currency} onClose={() => setFormDrill(null)} />}
    </div>
  )
}

// Drill-down modal: a scrollable list of the actual deals behind a number, so
// figures can be sense-checked live with the client (who, when the lead came in,
// when it closed, value, source). Screen-only (never in the PDF).
// A non-paid "Other" lead's real source (from the opportunity source / utm_source):
// CRM UI, Organic, Referral, Direct, etc. - so the drill isn't just "Other".
export function mrPrettySource(s) {
  const t = String(s || '').trim(); if (!t) return 'Other'
  const l = t.toLowerCase()
  if (/crm|manual|admin|import|internal|\badded\b|bulk|migrat/.test(l)) return 'CRM UI'
  if (/organic|seo|(?:^|[^a-z])search/.test(l)) return 'Organic'
  if (/referr/.test(l)) return 'Referral'
  if (/email|newsletter|mailchimp|klaviyo/.test(l)) return 'Email'
  if (/facebook|instagram|\bfb\b|\big\b|social|tiktok|linkedin|youtube/.test(l)) return 'Social'
  if (/direct|type.?in|\(none\)|\(not\s*set\)|^none$/.test(l)) return 'Direct'
  return t.length > 24 ? t.slice(0, 24) + '…' : t.charAt(0).toUpperCase() + t.slice(1)
}
// Google reports campaign / ad-group / content as numeric IDs in the UTMs; fold them
// to the live names via the same campIdMap / mediumIdMap the Caalano360 green columns
// use. Meta already carries readable names.
export function mrAdDetail(d, campMap, medMap) {
  const camp = (campMap && campMap[d.campaign]) || d.campaign
  const grp = (medMap && medMap[d.medium]) || d.medium
  if (d.channel === 'google') { const parts = [camp, grp].filter(Boolean); return parts.length ? parts.join(' · ') : (d.ad || null) }
  return d.ad || camp || null
}
// Who is behind one cell of the Form performance table. The monthly snapshot
// deliberately stores counts only - keeping every lead's record per form would
// bloat every frozen report - so the people are fetched on demand for the
// report's own period, which returns exactly the leads that cell counted.
export function MRFormDrill({ clientId, range, form, event, pipeKey, currency, onClose }) {
  const [st, setSt] = useState({ status: 'loading', people: [] })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    let alive = true
    fetch(`/.netlify/functions/windsor?client=${clientId}&scope=forms&${rangeQuery(range)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => {
        if (!alive) return
        const arr = (j && j.forms) || []
        const f = arr.find((x) => x.form === form)
        const all = (f && f.people) || []
        // Re-apply the same reach test the table used, so the list and the count
        // can't disagree.
        const fke = formKeyEvents(clientId, pipeKey || 'all', (j && j.pipelines) || [])
        const ev = (fke.events || []).find((k) => k.label === event.label && (k.kind || 'stage') === (event.kind || 'stage'))
        const people = ev ? all.filter((p) => fke.reached(p, ev)) : all
        setSt({ status: 'ok', people })
      })
      .catch(() => { if (alive) setSt({ status: 'err', people: [] }) })
    return () => { alive = false }
  }, [clientId, range, form, event, pipeKey])
  const money = (v) => (v == null || isNaN(v) ? '-' : fmtCurrency(v, currency))
  const ppl = st.people
  const chan = ppl.reduce((a, p) => { a[p.channel === 'meta' ? 'meta' : p.channel === 'google' ? 'google' : 'other']++; return a }, { meta: 0, google: 0, other: 0 })
  const pctc = (n) => (ppl.length ? Math.round((n / ppl.length) * 100) : 0) + '%'
  return (
    <div className="mr-drill-overlay no-print" onClick={onClose}>
      <div className="mr-drill" onClick={(e) => e.stopPropagation()} style={{ '--mr-drill-cols': 7 }}>
        <div className="mr-drill-head">
          <div>
            <h3>{form} · {event.label}</h3>
            <span>{st.status === 'loading' ? 'Loading…' : <>{fmtNumber(ppl.length)} lead(s){ppl.length ? <> · <span className="mr-src mr-src-meta">Meta {chan.meta} · {pctc(chan.meta)}</span> <span className="mr-src mr-src-google">Google {chan.google} · {pctc(chan.google)}</span> <span className="mr-src mr-src-other">Other {chan.other} · {pctc(chan.other)}</span></> : null}</>}</span>
          </div>
          <button className="mr-drill-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mr-drill-body">
          {st.status === 'loading' ? <Spinner label="Loading the leads behind this…" />
            : st.status === 'err' ? <div className="cap">Couldn’t load the leads for this form.</div>
              : ppl.length ? (
                <table className="mr-table">
                  <thead><tr><th>Contact</th><th>Status</th><th>Pipeline · stage</th><th>Source</th><th>Campaign / creative</th><th className="r">Age</th><th className="r">Value</th></tr></thead>
                  <tbody>{ppl.map((p, i) => (
                    <tr key={p.contactId || i}>
                      <td>{p.name}</td>
                      <td><span className={`mr-pill-${p.status === 'won' ? 'won' : p.status === 'lost' ? 'lost' : 'open'}`}>{p.status === 'won' ? 'Won' : p.status === 'lost' ? 'Lost' : 'Open'}</span></td>
                      <td>{[p.pipelineName, p.stageName].filter(Boolean).join(' · ') || '-'}</td>
                      <td>{p.channel === 'meta' ? 'Meta' : p.channel === 'google' ? 'Google' : 'Other'}</td>
                      <td title={[p.campaign, p.adset, p.creative].filter(Boolean).join(' / ')}>{p.creative || p.campaign || '-'}</td>
                      <td className="r">{p.ageDays != null ? `${p.ageDays}d` : '-'}</td>
                      <td className="r">{money(p.value)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <div className="cap">No leads reached this step for this form.</div>}
        </div>
      </div>
    </div>
  )
}
export function MRDrill({ drill, currency, campMap, medMap, onClose }) {
  const money = (v) => (v == null || isNaN(v) ? '-' : fmtCurrency(v, currency))
  const n0f = (v) => fmtNumber(Math.round(Number(v) || 0))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [])
  const deals = drill.deals || []
  const isLost = drill.kind === 'lost'
  const total = deals.reduce((s, d) => s + (d.value || 0), 0)
  // Per-channel split of these deals, so a lost-reason popup shows what share came
  // from Meta vs Google vs everything else.
  const chanBk = deals.reduce((a, d) => { a[d.channel === 'meta' ? 'meta' : d.channel === 'google' ? 'google' : 'other']++; return a }, { meta: 0, google: 0, other: 0 })
  const chanPct = (n) => (deals.length ? Math.round((n / deals.length) * 100) : 0) + '%'
  // Show the Ad/creative column only when we actually have attribution detail for
  // at least one deal (older snapshots won't carry ad/campaign). The overlay width
  // scales to the column count so more data never forces horizontal scrolling.
  const hasAd = deals.some((d) => d.ad || d.campaign)
  const colCount = 7 + (isLost ? 1 : 1) + (hasAd ? 1 : 0)
  const isLostSum = drill.kind === 'lostsum' && drill.lost
  const lostPeople = (rows) => (
    <table className="mr-table mr-kids-tbl">
      <thead><tr><th>Contact</th><th>Lead created</th><th>Lost</th><th>Source</th><th>Pipeline · stage</th><th>Owner</th><th className="r">Value</th></tr></thead>
      <tbody>{rows.map((d, i) => <tr key={i}>
        <td>{d.name}</td><td>{fmtDate(d.createdAt)}</td><td>{fmtDate(d.statusAt)}</td>
        <td><span className={`mr-src mr-src-${d.channel || 'other'}`}>{d.channel === 'meta' ? 'Meta' : d.channel === 'google' ? 'Google' : mrPrettySource(d.source)}</span></td>
        <td>{[d.pipeline, d.stage].filter(Boolean).join(' · ') || '-'}</td><td>{d.userName || '-'}</td><td className="r">{money(d.value)}</td>
      </tr>)}</tbody>
    </table>
  )
  return (
    <div className="mr-drill-overlay no-print" onClick={onClose}>
      <div className="mr-drill" onClick={(e) => e.stopPropagation()} style={{ '--mr-drill-cols': colCount }}>
        <div className="mr-drill-head">
          <div><h3>{drill.title}</h3><span>{deals.length} deal(s) · {money(total)} total{deals.length ? <> · <span className="mr-src mr-src-meta">Meta {chanBk.meta} · {chanPct(chanBk.meta)}</span> <span className="mr-src mr-src-google">Google {chanBk.google} · {chanPct(chanBk.google)}</span> <span className="mr-src mr-src-other">Other {chanBk.other} · {chanPct(chanBk.other)}</span></> : ''}</span></div>
          <button className="mr-drill-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mr-drill-body">
          {isLostSum ? (
            <>
              {drill.basis ? <p className="mr-drill-basis">{drill.basis}. {n0f(drill.lost.total.count)} deal{drill.lost.total.count === 1 ? '' : 's'} · {money(drill.lost.total.value)} lost in total. Click a reason to see who.</p> : null}
              <MRDrillTable
                cols={[
                  { k: 'name', label: 'Reason' },
                  { k: 'count', label: 'Deals', align: 'r', render: (r) => n0f(r.count) },
                  { k: 'share', label: '%', align: 'r', render: (r) => (drill.lost.total.count ? Math.round((r.count / drill.lost.total.count) * 100) + '%' : '-') },
                  { k: 'value', label: 'Value lost', align: 'r', render: (r) => money(r.value) },
                ]}
                rows={drill.lost.byReason || []}
                rowKey={(r) => r.name}
                childrenOf={(r) => (drill.lost.deals || []).filter((d) => (d.reason || 'Not set') === r.name)}
                renderChildren={(kids) => lostPeople(kids)}
                empty="No lost deals on this basis."
              />
            </>
          ) : deals.length ? (
            <table className="mr-table">
              <thead><tr>
                <th>Contact</th><th>Lead created</th><th>{isLost ? 'Lost' : 'Won'}</th>
                {!isLost && <th className="r">Days to close</th>}
                {isLost && <th>Reason</th>}<th>Source</th>
                {hasAd && <th>Campaign / creative</th>}
                <th>Pipeline · stage</th><th>Owner</th><th className="r">Value</th>
              </tr></thead>
              <tbody>{deals.map((d, i) => {
                const days = (d.createdAt && d.statusAt) ? Math.max(0, Math.round((Date.parse(d.statusAt) - Date.parse(d.createdAt)) / 86400000)) : null
                const srcTxt = d.channel === 'meta' ? 'Meta' : d.channel === 'google' ? 'Google' : mrPrettySource(d.source)
                const adTxt = mrAdDetail(d, campMap, medMap)
                return (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>{fmtDate(d.statusAt)}</td>
                  {!isLost && <td className="r">{days == null ? '-' : days}</td>}
                  {isLost && <td>{d.reason || '-'}</td>}
                  <td><span className={`mr-src mr-src-${d.channel || 'other'}`} title={d.channel === 'other' && d.source ? d.source : undefined}>{srcTxt}</span></td>
                  {hasAd && <td className="mr-drill-ad">{adTxt ? <span title={adTxt}>{adTxt}</span> : '-'}</td>}
                  <td>{[d.pipeline, d.stage].filter(Boolean).join(' · ') || '-'}</td>
                  <td>{d.userName || '-'}</td>
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
export function MRCreative({ a, money, n0, clientId, range, channel, currency }) {
  const [play, setPlay] = useState(false)
  // The direct mp4 Meta serves for the ad's Instagram media plays in a popup;
  // if that link has expired (they are signed for a limited time) the popup
  // falls back to the Instagram embed, then to Meta's shareable preview.
  const [videoFailed, setVideoFailed] = useState(false)
  const [drill, setDrill] = useState(null)
  const canDrill = !!(clientId && range)
  const ctrV = a.impressions ? (a.clicks / a.impressions) * 100 : null
  const results = a.results != null ? a.results : a.leads
  const cprV = results ? a.spend / results : null
  const freqV = a.reach ? a.impressions / a.reach : null
  const embed = a.igUrl ? a.igUrl.replace(/\/+$/, '') + '/embed' : null
  const canPlay = !!((a.video && !videoFailed) || embed)
  const openHref = a.preview || a.igUrl || null
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
          {canPlay
            ? <button className="mr-cre-play no-print" onClick={() => setPlay(true)} aria-label="Play">▶</button>
            : (openHref && <a className="mr-cre-play no-print" href={openHref} target="_blank" rel="noreferrer" aria-label="Open the ad preview">▶</a>)}
          {a.type === 'Video' && <span className="mr-cre-badge">▶ Video</span>}
        </div>
        <div className="mr-cre-head">
          <div className="mr-cre-name" title={a.name}>{a.name}{a.adset ? <small>{a.adset}</small> : null}</div>
          {a.pipeName ? <div className="mr-cre-pipe" title={`This creative's campaign is attached to the ${a.pipeName} pipeline`}>🔗 {a.pipeName}</div> : null}
          <div className="mr-cre-metrics">
            <div><b>{money(a.spend)}</b><span>Spend</span></div>
            <div><b>{n0(a.impressions)}</b><span>Impr</span></div>
            <div><b>{ctrV == null ? '-' : fmtPct(ctrV, 2)}</b><span>CTR</span></div>
            <div><b>{freqV != null ? freqV.toFixed(1) + 'x' : '-'}</b><span>Freq</span></div>
            <div><b>{n0(results)}</b><span>{a.resultType || 'Results'}</span></div>
            <div><b>{cprV == null ? '-' : money(cprV)}</b><span>Cost/result</span></div>
          </div>
        </div>
      </div>
      {events && events.length ? (
        <div className="mr-cre-ke">
          <div className="mr-cre-ke-lab">📈 Caalano360 · key events <span className="mr-cre-ke-hint">· “Cost per” = spend ÷ reached</span></div>
          <div className="mr-cre-ketbl-wrap">
            <table className="mr-cre-ketbl">
              <colgroup>
                <col className="ke-name" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" /><col className="ke-num" />
              </colgroup>
              <thead><tr>
                <th>Key event</th>
                <th className="r">Count</th>
                <th className="r" title="This creative's total ad spend ÷ the number of people who reached this stage (e.g. spend ÷ Site Visits Booked)">Cost per</th>
                <th className="r" title="This event's count ÷ this creative's leads">% leads</th>
                <th className="r" title="This step ÷ the previous step">Next</th>
                <th className="r" title="Appointment events only: shown ÷ occurred (appointments whose date has passed)">Show %</th>
              </tr></thead>
              <tbody>
                {feRows.map((e, i) => {
                  const isCal = e.kind === 'calendar'
                  const prev = i > 0 ? feRows[i - 1].count : null
                  const pctLeads = a.leads && e.count != null ? (e.count / a.leads) * 100 : null
                  const nextStep = prev && e.count != null ? (e.count / prev) * 100 : null
                  const costEv = e.count && a.spend ? a.spend / e.count : null
                  const cls = e.kind === 'won' ? 'mr-ketbl-won' : e.kind === 'lead' ? 'mr-ketbl-lead' : ''
                  const rowDrill = canDrill && e.count > 0
                  const openDrill = rowDrill ? () => setDrill({ kind: e.kind, label: e.label, stage: e.stage || null, pipeline: e.kind === 'lead' ? null : (e.pipeline || null), refs: e.kind === 'calendar' ? (e.refs || null) : null, ad: a.name }) : undefined
                  return (
                    <tr key={i} className={`${cls}${rowDrill ? ' mr-ketbl-clickable' : ''}`} onClick={openDrill} title={rowDrill ? 'Click to see the people behind this' : undefined}>
                      <td title={e.label}>{e.label}{isCal && e.shown != null ? <small> · {n0(e.shown)} shown</small> : null}{rowDrill ? <span className="mr-ketbl-chev"> ›</span> : null}</td>
                      <td className="r">{n0(e.count)}</td>
                      <td className="r">{costEv == null ? '-' : money(costEv)}</td>
                      <td className="r">{e.kind === 'lead' ? '100%' : pctLeads == null ? '-' : fmtPct(pctLeads, 0)}</td>
                      <td className="r">{nextStep == null ? '-' : fmtPct(nextStep, 0)}</td>
                      <td className="r">{isCal && e.showRate != null ? fmtPct(e.showRate, 0) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mr-cre-cash">
            <div><b>{money(revenue)}</b><span>Revenue</span></div>
            <div><b>{cpw == null ? '-' : money(cpw)}</b><span>Cost / won</span></div>
            <div><b>{roas == null ? '-' : roas.toFixed(1) + 'x'}</b><span>ROAS</span></div>
          </div>
        </div>
      ) : <div className="mr-cre-ke mr-cre-ke-empty">No CRM-attributed leads matched this creative’s UTM (utm_content).</div>}
      {play && canPlay && createPortal(
        <div className="mr-play-overlay no-print" onClick={() => setPlay(false)}>
          <div className="mr-play-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mr-play-head"><b title={a.name}>{a.name}</b><button className="mr-play-x" onClick={() => setPlay(false)} aria-label="Close">✕</button></div>
            {a.video && !videoFailed
              ? <video className="mr-play-video" src={a.video} poster={a.thumb || undefined} controls autoPlay playsInline onError={() => setVideoFailed(true)} />
              : <iframe className="mr-play-frame" src={embed} title={a.name} scrolling="no" frameBorder="0" allow="autoplay; encrypted-media; clipboard-write; picture-in-picture" allowFullScreen />}
            {openHref && <a className="mr-play-open" href={openHref} target="_blank" rel="noreferrer">{a.preview ? 'Open the ad preview ↗' : 'Open on Instagram ↗'}</a>}
          </div>
        </div>, document.body)}
      {drill ? <KeyPeopleModal event={drill} clientId={clientId} channel={channel || 'meta'} ad={drill.ad} range={range} currency={currency} onClose={() => setDrill(null)} /> : null}
    </div>
  )
}

// Status Change vs Created On revenue matrix - the same figures side by side so
// the client can see cash banked this month vs how this month's leads are doing.
export function MRRevMatrix({ sc, co, spend, money, n0, onDrill, lostSc, lostCo }) {
  const cell = (v, deals, title) => onDrill && deals && deals.length
    ? <button className="mr-cellbtn" onClick={() => onDrill({ title, deals })}>{v}</button> : v
  // Lost on the same two bases. A click opens the reasons behind the number,
  // with the value lost, and each reason opens to the people.
  const lostCell = (L, title, basis) => {
    if (!L) return <span className="mr-cell-na" title="Regenerate this month's snapshot to read lost deals on this basis">-</span>
    const v = n0(L.total.count)
    return onDrill && L.total.count ? <button className="mr-cellbtn" onClick={() => onDrill({ kind: 'lostsum', title, basis, lost: L, deals: L.deals })}>{v}</button> : v
  }
  const days = (v) => (v == null ? '-' : `${v} day${v === 1 ? '' : 's'}`)
  const roas = (rev) => (spend ? (rev / spend).toFixed(1) + 'x' : '-')
  const cac = (paidWon) => (spend && paidWon ? money(spend / paidWon) : '-')
  return (
    <table className="mr-table mr-revmatrix">
      <thead><tr><th></th><th className="r">Status change<small>closed this month</small></th><th className="r">Created on<small>leads created this month</small></th></tr></thead>
      <tbody>
        <tr><td>Total revenue</td><td className="r">{money(sc.revenue)}</td><td className="r">{money(co.revenue)}</td></tr>
        <tr><td>Paid revenue</td><td className="r">{money(sc.paid.revenue)}</td><td className="r">{money(co.paid.revenue)}</td></tr>
        <tr><td>Paid ROAS</td><td className="r">{roas(sc.paid.revenue)}</td><td className="r">{roas(co.paid.revenue)}</td></tr>
        <tr><td>CAC (cost / paid won)</td><td className="r">{cac(sc.paid.count)}</td><td className="r">{cac(co.paid.count)}</td></tr>
        <tr><td>Deals won</td><td className="r">{cell(n0(sc.count), sc.deals, 'Deals won - closed this month')}</td><td className="r">{cell(n0(co.count), co.deals, 'Deals won - leads created this month')}</td></tr>
        <tr><td>Avg won value</td><td className="r">{sc.avgValue ? money(sc.avgValue) : '-'}</td><td className="r">{co.avgValue ? money(co.avgValue) : '-'}</td></tr>
        <tr><td>Avg time to close</td><td className="r">{days(sc.avgCloseDays)}</td><td className="r">{days(co.avgCloseDays)}</td></tr>
        {(lostSc || lostCo) ? <>
          <tr className="mr-revmatrix-lost"><td>Deals lost <small>click for the reasons</small></td><td className="r">{lostCell(lostSc, 'Deals lost - marked lost this month', 'Marked lost this month, whatever month the lead arrived')}</td><td className="r">{lostCell(lostCo, 'Deals lost - leads created this month', "This month's leads that are already lost")}</td></tr>
          <tr className="mr-revmatrix-lost"><td>Lost value</td><td className="r">{lostSc ? money(lostSc.total.value) : '-'}</td><td className="r">{lostCo ? money(lostCo.total.value) : '-'}</td></tr>
        </> : null}
      </tbody>
    </table>
  )
}

// Expandable parent/child table for the report drills (campaign→ad set,
// campaign→conversion actions). Interactive on screen; every child row is forced
// open in the PDF/print export so nothing is lost on paper.
export function MRDrillTable({ cols, rows, rowKey, childrenOf, renderChildren, max, empty = 'No data for this period.' }) {
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
export function MRDonut({ data, money, isMoney = false }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  if (!total) return <div className="mr-empty">No leads in this period.</div>
  return (
    <div className="mr-donut">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, n) => [isMoney && money ? money(v) : fmtNumber(v), n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
// Creative performance - visual cards (big thumbnail + all stats + the client's
// configured key events), with a sort control and pagination (10 per page).
// One page-through grid of creative cards. Owns its own paging so, in a
// multi-pipeline deck, each pipeline's card block pages independently. The
// parent hands down a `doSort` that ranks by the shared sort chip, and a
// `sortToken` that resets paging to the first page whenever the sort changes.
export function MRCreativeCards({ ads, doSort, sortToken, sortLabel, label, money, n0, currency, clientId, range, channel }) {
  const [page, setPage] = useState(0)
  const PER = 10
  useEffect(() => { setPage(0) }, [sortToken])
  const sorted = doSort(ads)
  const pages = Math.max(1, Math.ceil(sorted.length / PER))
  const cur = Math.min(page, pages - 1)
  const pageAds = sorted.slice(cur * PER, cur * PER + PER)
  return (
    <>
      {label && <div className="mr-pipe-head" style={{ marginTop: 14 }}><span className="c360-dot" /> {label} <span className="cap">· {sorted.length} creative(s)</span></div>}
      <div className="mr-cre-grid">{pageAds.map((a) => <MRCreative key={a.name} a={a} money={money} n0={n0} clientId={clientId} range={range} channel={channel} currency={currency} />)}</div>
      {pages > 1 && (
        <div className="mr-cre-pager no-print">
          <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button>
          <span>Page {cur + 1} / {pages} · {sorted.length} creatives · sorted by {sortLabel}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
        </div>
      )}
    </>
  )
}

// One creative data-table (the sortable green Caalano360 table). In a
// multi-pipeline deck each pipeline gets its own table under an optional label;
// the header sort (tsort/onTsort) is shared so every table sorts together.
export function MRCreativeTable({ rows, o360cols, tsort, onTsort, currency, money, n0, label }) {
  const tableRows = sortRows(rows, tsort)
  return (
    <>
      <div className="mr-section-lab" style={{ marginTop: 18 }}>{label ? `Creative table · ${label}` : 'Creative table'}</div>
      <div className="table-wrap"><table className="o360-tbl">
        <O360ColGroup left={8} green={!!o360cols} cols={o360cols} />
        <thead>
          {o360cols && <C360GrpRow left={8} cols={o360cols} />}
          <tr>
            <SortTh k="name" sort={tsort} on={onTsort}>Creative</SortTh>
            <SortTh k="type" sort={tsort} on={onTsort}>Type</SortTh>
            <SortTh k="spend" sort={tsort} on={onTsort}>Spend</SortTh>
            <SortTh k="impressions" sort={tsort} on={onTsort}>Impr.</SortTh>
            <SortTh k="ctrV" sort={tsort} on={onTsort}>CTR</SortTh>
            <SortTh k="freqV" sort={tsort} on={onTsort}>Freq</SortTh>
            <SortTh k="leads" sort={tsort} on={onTsort}>{tableRows[0] && tableRows[0].resultType ? tableRows[0].resultType : 'Results'}</SortTh>
            <SortTh k="cpl" sort={tsort} on={onTsort}>Cost/res</SortTh>
            {o360cols && <O360Head sort={tsort} on={onTsort} cols={o360cols} />}
          </tr>
        </thead>
        <tbody>{tableRows.map((a) => (
          <tr key={a.name}>
            <td title={a.name}><div className="cre-cell">{a.thumb ? <img className="cre-th" src={a.thumb} alt="" loading="lazy" crossOrigin="anonymous" onError={(e) => { e.target.style.display = 'none' }} /> : <span className="cre-th cre-th-none" />}<span className="cre-cell-nm">{a.name}</span></div></td>
            <td>{a.type}</td>
            <td>{money(a.spend)}</td>
            <td>{n0(a.impressions)}</td>
            <td>{a.ctrV == null ? '-' : fmtPct(a.ctrV, 2)}</td>
            <td>{a.freqV == null ? '-' : a.freqV.toFixed(1) + 'x'}</td>
            <td>{n0(a.leads)}</td>
            <td>{a.cpl == null ? '-' : money(a.cpl)}</td>
            {o360cols && o360Cells(a, currency, o360cols)}
          </tr>
        ))}</tbody>
      </table></div>
    </>
  )
}

export function MRCreativeSection({ ads, oCre, o360cols: o360colsAll, o360colsFor: o360colsForAll, pipeLabelFor, money, n0, currency, showTable = false, clientId, range, channel, keOff, onKeOff }) {
  // Key events the client should not see on this screen (the agency's choice,
  // per client): dropped from every card, sort chip and table column here.
  const off = keOff instanceof Set ? keOff : new Set(keOff || [])
  const filterCols = (cols) => {
    if (!cols || !off.size) return cols
    const groups = [], out = []; let ci = 0
    for (const g of cols.groups) { const seg = cols.cols.slice(ci, ci + g.span); ci += g.span; if (off.has(g.label)) continue; groups.push(g); out.push(...seg) }
    return { ...cols, groups, cols: out }
  }
  const o360cols = filterCols(o360colsAll)
  const o360colsFor = o360colsForAll ? (c, a) => filterCols(o360colsForAll(c, a)) : null
  const allLabels = [...new Set(((o360colsAll && o360colsAll.groups) || []).map((g) => g.label))]
  const [tblOpen, setTblOpen] = useState(false)
  const groups = o360cols ? o360cols.groups : []
  // Enrich each creative: platform metrics + the per-client key-event counts + cash.
  // Each creative's key events come from the pipeline attached to its campaign
  // (o360colsFor), so multi-pipeline clients only show that ad's pipeline's events.
  const enriched = ads.map((a) => {
    const o = oCre.get(unorm(a.name))
    const leads = a.results != null ? a.results : a.leads
    const cols = (o360colsFor ? o360colsFor(a.campaign, a.adset) : o360cols) || o360cols
    let events = [], won = 0, revenue = 0
    const evByLabel = new Map()
    if (cols && o) {
      const f = o360Fields(o, a.spend, leads, cols)
      let ci = 0
      for (const g of cols.groups) {
        const seg = cols.cols.slice(ci, ci + g.span); ci += g.span
        const first = seg.find((c) => c.gfirst) || seg[0]
        const count = f[first.key] || 0
        // Carry the drill context (calendar ids / linked stage / pipeline) so a
        // click on this event can open the people behind it, scoped to this ad.
        const ev = { label: g.label, count, kind: g.kind, rate: null, shown: null, showRate: null, occurred: null, stage: first.stage || null, pipeline: first.pipeline || null, refs: first.refs || (first.ref ? [first.ref] : null) }
        if (g.kind === 'calendar') {
          const shCol = seg.find((c) => c.metric === 'calShown')
          const srCol = seg.find((c) => c.metric === 'calShowRate')
          const brCol = seg.find((c) => c.metric === 'calBookRate')
          const ocCol = seg.find((c) => c.metric === 'calOccurred')
          ev.shown = shCol ? f[shCol.key] : null
          ev.showRate = srCol ? f[srCol.key] : null
          ev.occurred = ocCol ? f[ocCol.key] : null
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
    const pipeName = pipeLabelFor ? pipeLabelFor(a.campaign, a.adset) : null
    return { ...a, leads, ctrV: ctr, cpl: leads ? a.spend / leads : null, events, evByLabel, won, revenue, pipeName, roas: revenue && a.spend ? revenue / a.spend : null, cpw: won && a.spend ? a.spend / won : null }
  })
  // Sort chips span the UNION of every pipeline's key events (shared o360cols); a
  // creative without that event just sorts as 0.
  // Dedupe event chips by label - the union spans every pipeline, so the same
  // stage name (e.g. "Booked Discovery Call") can appear in more than one pipeline.
  const uniqGroups = [...new Map(groups.map((g) => [g.label, g])).values()]
  // Volume sort chips (by count, high→low) + a parallel set of "cheapest cost per
  // event" chips (spend ÷ that event's count, low→high) so you can rank creatives
  // by the best cost per booked call / quote / etc. Creatives that never reached
  // an event sort last on the cost view (sentinel below).
  const NOCOST = 9e15
  const evMetrics = uniqGroups.map((g, i) => ({ k: 'ev' + i, label: g.label, evLabel: g.label }))
  const costMetrics = uniqGroups.map((g, i) => ({ k: 'cpe' + i, label: g.label, costEvLabel: g.label, asc: true }))
  const METRICS = [
    { k: 'spend', label: 'Spend' }, { k: 'ctrV', label: 'CTR' }, { k: 'leads', label: 'Leads' }, { k: 'cpl', label: 'CPL', asc: true },
    ...evMetrics,
    { k: 'revenue', label: 'Revenue' }, { k: 'roas', label: 'ROAS' },
    ...costMetrics,
  ]
  // Natural direction for a metric: cost / CPL metrics read best cheapest-first
  // (asc), everything else biggest-first (desc). Picking a metric resets to its
  // natural direction; the arrow toggle then flips it either way.
  const natDir = (mm) => (mm && (mm.asc || mm.costEvLabel != null) ? 'asc' : 'desc')
  const [sortK, setSortK] = useState('spend')
  const [dir, setDir] = useState('desc')
  const m = METRICS.find((x) => x.k === sortK) || METRICS[0]
  const pickMetric = (k) => { setSortK(k); setDir(natDir(METRICS.find((x) => x.k === k))) }
  const valOf = (a) => {
    if (m.evLabel != null) return (a.evByLabel && a.evByLabel.get(m.evLabel)) || 0
    if (m.costEvLabel != null) { const c = (a.evByLabel && a.evByLabel.get(m.costEvLabel)) || 0; return c > 0 && a.spend ? a.spend / c : NOCOST }
    return a[m.k] || 0
  }
  const doSort = (list) => [...list].sort((x, y) => (dir === 'asc' ? valOf(x) - valOf(y) : valOf(y) - valOf(x)))
  // Data-table view (same sortable green Caalano360 table as the Meta ads view).
  // Header sort is shared, so every pipeline's table sorts together.
  const [tsort, onTsort] = useSort('spend')
  const mapRow = (a) => ({ ...a, freqV: a.reach ? a.impressions / a.reach : null, ...o360Fields(oCre.get(unorm(a.name)), a.spend, a.leads, o360cols) })
  // Multi-pipeline decks split the whole screen by pipeline: every pipeline's
  // cards first (Cards P1, Cards P2 …), then every pipeline's table (Table P1,
  // Table P2 …). A creative's pipeline comes from its campaign (pipeLabelFor);
  // creatives whose campaign maps to no pipeline collect into a trailing
  // "Unattributed" group. Single-pipeline decks (pipeLabelFor null, or only one
  // pipeline actually present) keep the flat layout.
  const pipeGroups = (() => {
    if (!pipeLabelFor) return null
    const by = new Map()
    for (const a of enriched) { const k = a.pipeName || '__none__'; if (!by.has(k)) by.set(k, []); by.get(k).push(a) }
    if ([...by.keys()].filter((k) => k !== '__none__').length < 2) return null
    const arr = [...by.entries()].map(([k, items]) => ({ key: k, label: k === '__none__' ? 'Unattributed' : k, items, spend: items.reduce((s, a) => s + (a.spend || 0), 0) }))
    arr.sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : b.spend - a.spend))
    return arr
  })()
  const sortToken = sortK + '|' + dir
  const kePick = onKeOff && allLabels.length ? (
    <div className="mr-ke-pick no-print">
      <span className="mr-ke-pick-lab">Key events shown to the client</span>
      {allLabels.map((l) => <label key={l} className={`pv-ke-box${off.has(l) ? '' : ' on'}`}><input type="checkbox" checked={!off.has(l)} onChange={() => onKeOff(l)} />{l}</label>)}
    </div>
  ) : null
  const tblToggle = showTable ? <button type="button" className="mr-collapse no-print" onClick={() => setTblOpen((o) => !o)}>{tblOpen ? '▾' : '▸'} Creative table</button> : null
  const sortCtl = (
    <div className="mr-cre-sort no-print">
      <span>Sort by</span>
      <select className="mr-cre-sort-sel" value={sortK} onChange={(e) => pickMetric(e.target.value)}>
        <optgroup label="Performance">
          {METRICS.filter((x) => x.evLabel == null && x.costEvLabel == null).map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
        </optgroup>
        {evMetrics.length ? <optgroup label="Key event - volume reached">
          {evMetrics.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
        </optgroup> : null}
        {costMetrics.length ? <optgroup label="Cheapest cost per event">
          {costMetrics.map((x) => <option key={x.k} value={x.k}>Cost / {x.label}</option>)}
        </optgroup> : null}
      </select>
      <button className="mr-cre-sort-dir" onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))} title={dir === 'asc' ? 'Ascending (lowest first) - click for highest first' : 'Descending (highest first) - click for lowest first'}>{dir === 'asc' ? '↑ Low→High' : '↓ High→Low'}</button>
    </div>
  )
  if (pipeGroups) {
    return (
      <>
        {kePick}
        {sortCtl}
        {pipeGroups.map((g) => (
          <MRCreativeCards key={'c-' + g.key} ads={g.items} doSort={doSort} sortToken={sortToken} sortLabel={m.label} label={g.label} money={money} n0={n0} currency={currency} clientId={clientId} range={range} channel={channel} />
        ))}
        {tblToggle}
        {showTable && tblOpen && pipeGroups.map((g) => (
          <MRCreativeTable key={'t-' + g.key} rows={g.items.map(mapRow)} o360cols={o360cols} tsort={tsort} onTsort={onTsort} currency={currency} money={money} n0={n0} label={g.label} />
        ))}
      </>
    )
  }
  return (
    <>
      {kePick}
      {sortCtl}
      <MRCreativeCards ads={enriched} doSort={doSort} sortToken={sortToken} sortLabel={m.label} money={money} n0={n0} currency={currency} clientId={clientId} range={range} channel={channel} />
      {tblToggle}
      {showTable && tblOpen && <MRCreativeTable rows={enriched.map(mapRow)} o360cols={o360cols} tsort={tsort} onTsort={onTsort} currency={currency} money={money} n0={n0} />}
    </>
  )
}

// Pages off by default for every client until switched on in the notes panel.
export const MR_DEFAULT_HIDDEN = ['c360-camp', 'forms']
// Pure renderer for the deck so it can be reused by both the live view and the
// frozen snapshot (identical shape). Returns an array of <MRSlide> elements.
export function renderMonthlyDeck(rep, h) {
  const { currency, money, n0, pc, openDrill, setFormDrill } = h
  // The form drill fetches its people live for the report's own period, so it
  // needs a client and a range; frozen decks rendered without them stay static.
  const fDrillOk = !!(setFormDrill && rep.client && rep.client.id && rep.period && rep.period.from && rep.period.to)
  const b = rep.period
  const meta = rep.meta, google = rep.google, blend = rep.blend, attribution = rep.attribution
  const won = rep.wonClosed || (blend && blend.wonClosed) || null
  const paid = (blend && blend.paid) || {}
  const crm = (blend && blend.crm) || {}          // created-on cohort (opps created this month)
  const pipelines = (blend && blend.pipelines) || []
  const users = (blend && blend.users) || []
  const totalSpend = paid.adSpend || (((meta && meta.totals && meta.totals.spend) || 0) + ((google && google.totals && google.totals.cost) || 0))
  // Paid leads = Meta's optimised RESULTS (sum of each campaign's own objective
  // result, matching Ads Manager) + Google conversions - not native lead-form
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
  // A page's saved notes ride on the slide; a page without any shows none.
  const notes = h.notes || null
  const push = (el) => slides.push(notes && el && el.key && notes[el.key] && String(notes[el.key]).trim() ? React.cloneElement(el, { notes: notes[el.key] }) : el)
  // "Key events by campaign" is built in place but pushed later (after the Google ad
  // groups, before Users) so the deck reads platform → key events → forms → team.
  let keCampSlide = null

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
    { k: 'freq', label: 'Freq.', align: 'r', render: (r) => { const f = freq(r); return f == null ? '-' : f.toFixed(1) + 'x' } },
    { k: 'cpm', label: 'CPM', align: 'r', render: (r) => { const v = cpm(r); return v == null ? '-' : money(v) } },
    { k: 'ctr', label: 'CTR', align: 'r', render: (r) => { const v = ctr(r); return v == null ? '-' : fmtPct(v, 2) } },
    { k: 'results', label: 'Results', align: 'r', render: (r) => (r.results ? `${n0(r.results)}${r.resultType ? ' ' + r.resultType : ''}` : '-') },
    { k: 'leads', label: 'Leads', align: 'r', render: (r) => n0(r.leads) },
    { k: 'cpl', label: 'CPL', align: 'r', render: (r) => { const v = cpl(r); return v == null ? '-' : money(v) } },
  ]

  // Caalano360 green key-event setup - shared by the creative table, the
  // key-events-by-campaign slide and the CRM slides. Position map comes from the
  // full pipeline registry (allPipelines) so every key event orders by its real
  // funnel position; the blend pipelines are activity-derived and can omit stages.
  const stagePos = stagePosMap([...((attribution && attribution.allPipelines) || []), ...pipelines])
  const calNames = new Map(((attribution && attribution.appointments && attribution.appointments.byCalendar) || []).map((cc) => [cc.id, cc.name]))
  const o360cols = rep.hasCrm ? buildO360Cols(loadKeyEvents(rep.client.id), stagePos, calNames) : null
  const oCamp = aliasedOutcomeMap(rep.client.id, 'campaign', rep.campOutcomes || [], rep.campIdMap)
  const oCre = aliasedOutcomeMap(rep.client.id, 'content', rep.creOutcomes || [])
  // Ad-set / ad-group key-event maps for the "Key events by campaign" drill.
  // Meta ad sets match byMedium by name; Google ad groups match byMedium+byCreative
  // with the numeric utm_medium folded to its ad-group name (same as the live views).
  const oMedMeta = aliasedOutcomeMap(rep.client.id, 'medium', rep.medOutcomes || [])
  const oMedGoogle = aliasedOutcomeMap(rep.client.id, 'medium', [...(rep.medOutcomes || []), ...(rep.creOutcomes || [])], rep.mediumIdMap)
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
  // Ad-set level links count too: with an ad set named, that ad set's own rule
  // wins. Without one, a campaign split across pipelines at the ad-set level
  // resolves to the one pipeline its ad sets agree on, else to the union.
  const cid = rep.client && rep.client.id
  const pipeOfCampaign = (campName, adset) => {
    if (!multiPipe || campName == null) return null
    if (adset != null) return pipeOfAdset(cid, campName, adset, pipelines)
    if (!campIsSplit(cid, campName)) {
      const t = campPipeMap[campName]
      if (t === 'all') return null
      if (t) return t
      return suggestPipeline(campName, pipelines) || null
    }
    const kids = [...((meta && meta.adsets) || []), ...((google && google.adGroups) || [])].filter((a) => a.campaign === campName)
    const pids = new Set(kids.length ? kids.map((a) => pipeOfAdset(cid, campName, a.name, pipelines)) : Object.values(loadAdsetRules(cid, campName)).map((v) => (v === 'all' ? null : v)))
    return pids.size === 1 ? ([...pids][0] || null) : null
  }
  const pipeNameOf = (pid) => ((pipelines.find((p) => p.id === pid) || {}).name || null)
  const pipeLabelFor = (campName, adset) => pipeNameOf(pipeOfCampaign(campName, adset))
  const o360colsFor = (campName, adset) => {
    if (!o360cols) return null
    const pid = pipeOfCampaign(campName, adset)
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
      <div className="mr-cover-foot">Generated {new Date(rep.generatedAt).toLocaleDateString('en-AU')} · Wins &amp; revenue attributed to the month each deal was marked won.</div>
    </section>
  )

  // ---- Meta slides ----
  if (rep.hasMeta && meta) {
    const t = meta.totals || {}
    // Compact platform columns for the campaign→ad-set drill table.
    // Link-click CTR, conversion rate (results ÷ link clicks) and CPM read truer than
    // impressions / reach / all-click CTR for lead campaigns - and ad-set reach comes
    // back 0 from Meta's per-adset breakdown, so drop it here.
    const metaDrillCols = (nameLabel) => [
      { k: 'name', label: nameLabel, render: (r) => <span className="mr-name">{r.name}</span> },
      { k: 'spend', label: 'Spend', align: 'r', render: (r) => money(r.spend) },
      { k: 'lctr', label: 'Link CTR', align: 'r', render: (r) => (r.impressions ? fmtPct((r.linkClicks / r.impressions) * 100, 2) : '-') },
      { k: 'cvr', label: 'Conv. rate', align: 'r', render: (r) => { const res = r.results != null ? r.results : r.leads; return r.linkClicks ? fmtPct((res / r.linkClicks) * 100, 1) : '-' } },
      { k: 'cpm', label: 'CPM', align: 'r', render: (r) => (r.impressions ? money((r.spend / r.impressions) * 1000) : '-') },
      { k: 'results', label: 'Results', align: 'r', render: (r) => n0(r.results != null ? r.results : r.leads) },
      { k: 'cpl', label: 'Cost/res', align: 'r', render: (r) => { const res = r.results != null ? r.results : r.leads; return res ? money(r.spend / res) : '-' } },
    ]
    const adsetsOf = (campName) => (meta.adsets || []).filter((a) => a.campaign === campName)
    push(
      <MRSlide key="m-camp" kicker="Meta Ads · Platform" title="Meta performance" sub={`${b.label} against the months before it · ${(meta.campaigns || []).length} campaign(s) · click a campaign to drill into its ad sets`}>
        <MRMetaPerf trend={rep.trend} monthKey={String(b.to || b.from || '').slice(0, 7)} money={money} n0={n0} resultType={t.resultBreakdown && t.resultBreakdown.length === 1 ? t.resultBreakdown[0].label : null} />
        <div className="mr-section-lab">Campaigns &amp; ad sets · {b.label}</div>
        <MRDrillTable
          cols={metaDrillCols('Campaign')} rows={meta.campaigns || []} max={16}
          rowKey={(r) => r.name}
          childrenOf={(r) => adsetsOf(r.name)}
          renderChildren={(kids) => <div className="mr-kids-inner"><div className="mr-kids-lab">Ad sets</div><MRTable cols={metaDrillCols('Ad set')} rows={kids} /></div>}
        />
      </MRSlide>
    )
    const spendAds = (meta.ads || []).filter((a) => (a.spend || 0) > 0)
    push(
      <MRSlide key="m-cre" kicker="Meta Ads · Creative" title="Creative performance" sub={`${spendAds.length} creative(s) with spend · sort & page through, 10 at a time`}>
        {spendAds.length
          ? <MRCreativeSection ads={spendAds} oCre={oCre} o360cols={o360cols} o360colsFor={o360colsFor} pipeLabelFor={multiPipe ? pipeLabelFor : null} money={money} n0={n0} currency={currency} showTable keOff={h.keOff} onKeOff={h.onKeOff} clientId={rep.client && rep.client.id} range={b} channel="meta" />
          : <div className="mr-empty">No creatives with spend for this period.</div>}
        <p className="mr-foot-note">All creatives that spent this period, sortable by any metric, 10 per page. <b>Leads</b> = Meta results; the key-event chips are the client's configured <b>key events</b> (Settings → Key events) for leads whose ad UTM (utm_content) matches the creative. ▶ plays the Instagram post inline where a permalink is available.</p>
      </MRSlide>
    )
  }

  // ---- Key events by campaign (Caalano360 green columns) - right after creative ----
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
    const shortName = (s) => (s && s.length > 24 ? s.slice(0, 22) + '…' : (s || '-'))
    const PIEK = ['#6d5efc', '#12b886', '#e0803a', '#4285f4', '#e1306c', '#f59e0b', '#9b8cff', '#ef4444']
    const barData = campRows.filter((c) => c._has360)
      .map((c) => ({ name: shortName(c.name), full: c.name, leads: c.leads || 0, event: headKey ? (c[headKey] || 0) : 0 }))
      .sort((a, b2) => (b2.event - a.event) || (b2.leads - a.leads)).slice(0, 8)
    const donutData = barData.filter((d) => d.event > 0).map((d, i) => ({ name: d.name, value: d.event, color: PIEK[i % PIEK.length] }))
    // A green key-events-by-campaign table for a set of campaigns + a column
    // descriptor (its pipeline's key events). Each campaign row is expandable into
    // its ad sets (Meta) / ad groups (Google) - shown by name, with the same green
    // key-event columns matched by utm_medium. Returns null if no CRM data matched.
    const CampKeyEventsTable = ({ rows, cols, label }) => {
      const [open, setOpen] = useState(() => new Set())
      // Click any column header to sort the campaigns by it (name / spend / leads
      // or any green key-event column). The top-16-by-spend selection is fixed;
      // the chosen column only reorders what's shown.
      const [tsort, onTsort] = useSort('spend')
      const withF = rows.map((c) => ({ ...c, ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, cols) })).sort((a, b2) => b2.spend - a.spend).slice(0, 16)
      if (!cols || !withF.some((c) => c._has360)) return null
      const shown = sortRows(withF, tsort)
      // Ad sets (Meta) / ad groups (Google) under a campaign, each with its own green
      // columns. Kept if it has spend, leads or any matched key event.
      const kidsOf = (c) => {
        const src = c.channel === 'meta'
          ? ((meta && meta.adsets) || []).filter((a) => a.campaign === c.name).map((a) => ({ name: a.name, channel: 'meta', spend: a.spend || 0, leads: (a.results != null ? a.results : a.leads) || 0 }))
          : ((google && google.adGroups) || []).filter((a) => a.campaign === c.name).map((a) => ({ name: a.name, channel: 'google', spend: a.cost || 0, leads: a.conversions || 0 }))
        const oMed = c.channel === 'meta' ? oMedMeta : oMedGoogle
        return src.map((k) => ({ ...k, ...o360Fields(oMed.get(unorm(k.name)), k.spend, k.leads, cols) }))
          .filter((k) => k.spend > 0 || k.leads > 0 || k._has360)
          .sort((a, b2) => b2.spend - a.spend).slice(0, 20)
      }
      const toggle = (name) => setOpen((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
      const rowsWithKids = shown.map((c) => ({ c, kids: kidsOf(c) }))
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
                <tr>
                  <SortTh k="name" sort={tsort} on={onTsort}>Campaign</SortTh>
                  <SortTh k="spend" sort={tsort} on={onTsort} className="r">Spend</SortTh>
                  <SortTh k="leads" sort={tsort} on={onTsort} className="r">Leads</SortTh>
                  <O360Head sort={tsort} on={onTsort} cols={cols} />
                </tr>
              </thead>
              <tbody>{rowsWithKids.map(({ c, kids }, i) => {
                const hasKids = kids.length > 0
                const isOpen = open.has(c.name)
                return (
                  <React.Fragment key={i}>
                    <tr className={'mr-o360-camprow' + (hasKids ? ' has-kids' : '')} onClick={hasKids ? () => toggle(c.name) : undefined}>
                      <td className="mr-o360-name" title={c.name}><span className={'mr-o360-exp' + (hasKids ? '' : ' mr-o360-exp-none')}>{hasKids ? (isOpen ? '▾' : '▸') : ''}</span><span className={`mr-src mr-src-${c.channel}`}>{c.channel === 'meta' ? 'Meta' : 'Google'}</span> {c.name}</td>
                      <td className="r">{money(c.spend)}</td><td className="r">{n0(c.leads)}</td>
                      {o360Cells(c, currency, cols)}
                    </tr>
                    {isOpen ? kids.map((k, j) => (
                      <tr key={'k' + j} className="mr-o360-kid">
                        <td className="mr-o360-name mr-o360-kidname" title={k.name}><span className="mr-o360-kidtick" />{k.name}</td>
                        <td className="r">{money(k.spend)}</td><td className="r">{n0(k.leads)}</td>
                        {o360Cells(k, currency, cols)}
                      </tr>
                    )) : null}
                  </React.Fragment>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      )
    }
    const renderCampTable = (rows, cols, label) => {
      const withF = rows.map((c) => ({ ...c, ...o360Fields(oCamp.get(unorm(c.name)), c.spend, c.leads, cols) })).sort((a, b2) => b2.spend - a.spend).slice(0, 16)
      if (!cols || !withF.some((c) => c._has360)) return null
      return <CampKeyEventsTable key={label || 'all'} rows={rows} cols={cols} label={label} />
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
      keCampSlide = (
        <MRSlide key="c360-camp" kicker="Caalano360" title="Key events by campaign" sub="Which campaigns are driving the key events - with the cost of each. CRM outcomes (utm_campaign) matched to paid spend.">
          {barData.length ? (
            <div className="mr-two mr-two-viz">
              <div>
                <div className="mr-viz-lab">Leads vs {headLabel} - top campaigns</div>
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
                <div className="mr-viz-lab">{headLabel} - share by campaign</div>
                {donutData.length ? <MRDonut data={donutData} money={money} /> : <div className="mr-empty">No {headLabel.toLowerCase()} attributed to a campaign yet.</div>}
              </div>
            </div>
          ) : null}
          {campTables}
          <p className="mr-foot-note"><b>▸ Click a campaign</b> to break it into its ad sets (Meta) / ad groups (Google) - by name, with the same key-event columns. Green columns are the client's configured <b>key events</b> - the count reached and the cost per each - plus the Won revenue block and ROAS. Scroll right to see every event. Matched by <b>utm_campaign</b> (ad sets by <b>utm_medium</b>); “-” means no CRM leads carried that UTM.{multiPipe ? ' Each pipeline shows only its own key events (from the campaign→pipeline links in Settings); unmapped campaigns show all events.' : ''}</p>
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
    const n1 = (v) => (v == null || isNaN(v) ? '-' : fmtNumber(Math.round(v * 10) / 10))
    const gSideCols = (nameLabel) => [
      { k: 'name', label: nameLabel, render: (r) => <span className="mr-name">{r.name}{r.campaign ? <small>{r.campaign}</small> : null}</span> },
      { k: 'cost', label: 'Cost', align: 'r', render: (r) => money(r.cost) },
      { k: 'clicks', label: 'Clicks', align: 'r', render: (r) => n0(r.clicks) },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n1(r.conversions) },
      { k: 'cpa', label: 'Cost/conv.', align: 'r', render: (r) => { const v = gcpa(r); return v == null ? '-' : money(v) } },
    ]
    // Primary conversion actions are the ones counted in Google's "Conversions"
    // column (conversions > 0); secondary actions only report All-conversions.
    const caColsCompact = [
      { k: 'name', label: 'Action', render: (r) => <span className="mr-name">{r.conversions > 0 ? <span className="mr-ca-star">★ </span> : null}{r.name}<small>{r.category || '-'} · {r.conversions > 0 ? 'primary' : 'secondary'}</small></span> },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n1(r.conversions) },
      { k: 'value', label: 'Value', align: 'r', render: (r) => (r.value ? money(r.value) : '-') },
    ]
    const allCa = aggConvActions(google.conversionActions || [])
    const MT_COL = { Exact: '#22b07d', Phrase: '#4f7cff', Broad: '#f0a53a' }
    const matchAgg = (google.matchTypes || []).filter((m) => m.cost > 0).map((m) => ({ name: m.type, value: Math.round(m.cost), color: MT_COL[m.type] || '#8b5cf6' }))
    const locs = ((google.geo && google.geo.locations) || []).filter((l) => l.conversions > 0).slice(0, 12)
    const locMax = Math.max(1, ...locs.map((l) => l.conversions))
    // The fifteen keywords that converted most (clicks break the tie), clicks
    // and conversions each on their own scale so conversions stay readable.
    const topKw = (google.keywords || []).filter((k) => k.clicks > 0 || k.conversions > 0).slice().sort((x, y) => (y.conversions - x.conversions) || (y.clicks - x.clicks)).slice(0, 15).map((k) => ({ kw: k.text || k.term || '-', clicks: k.clicks || 0, conversions: Math.round((k.conversions || 0) * 10) / 10 }))
    push(
      <MRSlide key="g-camp" kicker="Google Ads · Platform" title="Google Ads" sub={`${b.label} against the months before it · ${(google.campaigns || []).length} campaign(s) · ${(google.adGroups || []).length} ad group(s)`}>
        <MRGooglePerf trend={rep.gtrend} monthKey={String(b.to || b.from || '').slice(0, 7)} money={money} n0={n0} />
        <div className="mr-two">
          <div><div className="mr-section-lab">Campaigns · {b.label}</div><MRTable cols={gSideCols('Campaign')} rows={google.campaigns || []} max={10} /></div>
          <div><div className="mr-section-lab">Ad groups · {b.label}</div><MRTable cols={gSideCols('Ad group')} rows={google.adGroups || []} max={10} /></div>
        </div>
        <div className="mr-three mr-gblocks">
          <div><div className="mr-section-lab">Spend by match type</div>{matchAgg.length ? <MRDonut data={matchAgg} money={money} isMoney /> : <div className="mr-empty">No keyword spend this period.</div>}</div>
          <div><div className="mr-section-lab">Conversion actions <span className="mr-lab-note">· ★ primary = counted in Conversions</span></div><MRTable cols={caColsCompact} rows={allCa} max={8} empty="No conversion actions recorded for this period." /></div>
          <div><div className="mr-section-lab">Conversion locations{google.geo && google.geo.dim ? <span className="mr-lab-note"> · by {String(google.geo.dim).replace(/_/g, ' ')}</span> : null}</div>
            {locs.length ? <div className="mr-locs">{locs.map((l) => <div className="loc-row" key={l.name}><span className="loc-nm" title={l.name}>{l.name}</span><span className="loc-bar"><span className="loc-fill" style={{ width: `${(l.conversions / locMax) * 100}%` }} /></span><span className="loc-ct">{n1(l.conversions)}</span></div>)}</div> : <div className="mr-empty">No location data this period.</div>}
          </div>
        </div>
        {topKw.length ? (
          <>
            <div className="mr-section-lab">Top keywords <span className="mr-lab-note">· the {topKw.length} that converted most · clicks (bottom scale) and conversions (top scale)</span></div>
            <div className="mr-kw-chart">
              <ResponsiveContainer width="100%" height={Math.max(220, topKw.length * 30 + 56)}>
                <BarChart data={topKw} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis xAxisId="clicks" type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompact(v)} />
                  <XAxis xAxisId="conv" type="number" orientation="top" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="kw" width={200} tick={{ fontSize: 11, fill: 'var(--text)' }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, name) => [name === 'Clicks' ? fmtNumber(v) : n1(v), name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar xAxisId="clicks" dataKey="clicks" name="Clicks" fill="#4f7cff" radius={[0, 3, 3, 0]} barSize={9} />
                  <Bar xAxisId="conv" dataKey="conversions" name="Conversions" fill="var(--text)" radius={[0, 3, 3, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : null}
      </MRSlide>
    )
    const kwCols = (first) => [
      { k: 'text', label: first, render: (r) => <span className="mr-name">{r.text || r.term}<small>{[r.campaign, r.adGroup].filter(Boolean).join(' · ') || (r.match || '')}</small></span> },
      { k: 'cost', label: 'Cost', align: 'r', render: (r) => money(r.cost) },
      { k: 'clicks', label: 'Clicks', align: 'r', render: (r) => n0(r.clicks) },
      { k: 'conversions', label: 'Conv.', align: 'r', render: (r) => n0(r.conversions) },
    ]
    push(
      <MRSlide key="g-ag" kicker="Google Ads · Platform" title="Keywords & search terms" sub="The top keywords and search terms with the campaign / ad group they came from">
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

  // ---- Key events by campaign (moved here: after the Google ad groups) ----
  if (keCampSlide) push(keCampSlide)

  // ---- Form performance ---- (right after key events, before the team slide)
  // Mirrors the live Forms tab: Leads → each configured key event (count + % of the
  // form's leads) → Revenue → Avg deal. Falls back to the booked/shown/won table for
  // older snapshots frozen before per-form key events were stored.
  if (rep.forms && rep.forms.length) {
    const frate = (x, y) => (y ? fmtPct((x / y) * 100, 0) : '-')
    const fkind = (k) => (k === 'facebook' ? 'Meta Lead Form' : k === 'website' ? 'Website form' : (k || ''))
    const evLbl = (k) => (k.kind === 'calendar' ? '📅 ' : '') + k.label
    // One "Leads → each key event → Revenue → Avg deal" table for a set of forms
    // and its own column list. Multi-pipeline decks render one of these per
    // pipeline (each pipeline's own key events, no duplicated columns).
    const keTable = (events, forms, pipeKey = 'all') => {
      const ftot = forms.reduce((a, f) => ({ leads: a.leads + (f.leads || 0), won: a.won + (f.won || 0), revenue: a.revenue + (f.revenue || 0), ke: a.ke.map((v, i) => v + ((f.ke && f.ke[i]) || 0)) }), { leads: 0, won: 0, revenue: 0, ke: events.map(() => 0) })
      return (
        <div className="mr-tablewrap"><table className="mr-table mr-forms-tbl">
          <thead><tr><th className="lft">Form</th><th className="r">Leads</th>{events.map((k, i) => <th key={i} className="r">{evLbl(k)}</th>)}<th className="r">Revenue</th><th className="r">Avg deal</th></tr></thead>
          <tbody>
            {forms.map((f, i) => (
              <tr key={i}>
                <td className="lft"><span className="mr-name mr-name-form" title={f.form}>{f.form}{f.kind ? <small>{fkind(f.kind)}</small> : null}</span></td>
                <td className="r">{f.leads > 0 && fDrillOk
                  ? <button className="mr-cellbtn" onClick={() => setFormDrill({ form: f.form, event: { label: 'Leads', kind: 'lead' }, pipeKey })} title="Click to see the leads behind this">{n0(f.leads)}</button>
                  : n0(f.leads)}</td>
                {events.map((k, j) => {
                  const c = (f.ke && f.ke[j]) || 0
                  const pctSm = f.leads ? <small className="mr-fpct"> {fmtPct((c / f.leads) * 100, 0)}</small> : null
                  // Only offer the drill where there is something to look at and
                  // we know which client/period to ask about.
                  return <td key={j} className="r">{c > 0 && fDrillOk
                    ? <button className="mr-cellbtn" onClick={() => setFormDrill({ form: f.form, event: k, pipeKey })} title="Click to see the leads behind this">{n0(c)}{pctSm}</button>
                    : <>{n0(c)}{pctSm}</>}</td>
                })}
                <td className="r">{money(f.revenue)}</td>
                <td className="r">{f.won ? money(f.revenue / f.won) : '-'}</td>
              </tr>
            ))}
            <tr className="mr-tot"><td className="lft">Total</td><td className="r">{n0(ftot.leads)}</td>{ftot.ke.map((v, i) => <td key={i} className="r">{n0(v)}</td>)}<td className="r">{money(ftot.revenue)}</td><td className="r">{ftot.won ? money(ftot.revenue / ftot.won) : '-'}</td></tr>
          </tbody>
        </table></div>
      )
    }
    // Legacy booked/shown/won table (snapshots frozen before per-form key events).
    const legacyTable = (forms) => {
      const ftot = forms.reduce((a, f) => ({ leads: a.leads + (f.leads || 0), booked: a.booked + (f.booked || 0), shown: a.shown + (f.shown || 0), won: a.won + (f.won || 0), revenue: a.revenue + (f.revenue || 0) }), { leads: 0, booked: 0, shown: 0, won: 0, revenue: 0 })
      return (
        <div className="mr-tablewrap"><table className="mr-table mr-forms-tbl">
          <thead><tr><th className="lft">Form</th><th className="r">Leads</th><th className="r">Booked</th><th className="r">Book %</th><th className="r">Shown</th><th className="r">Won</th><th className="r">Win %</th><th className="r">Revenue</th></tr></thead>
          <tbody>
            {forms.map((f, i) => (
              <tr key={i}>
                <td className="lft"><span className="mr-name mr-name-form" title={f.form}>{f.form}{f.kind ? <small>{fkind(f.kind)}</small> : null}</span></td>
                <td className="r">{n0(f.leads)}</td><td className="r">{n0(f.booked)}</td><td className="r">{frate(f.booked, f.leads)}</td>
                <td className="r">{n0(f.shown)}</td><td className="r">{n0(f.won)}</td><td className="r">{frate(f.won, f.leads)}</td><td className="r">{money(f.revenue)}</td>
              </tr>
            ))}
            <tr className="mr-tot"><td className="lft">Total</td><td className="r">{n0(ftot.leads)}</td><td className="r">{n0(ftot.booked)}</td><td className="r">{frate(ftot.booked, ftot.leads)}</td><td className="r">{n0(ftot.shown)}</td><td className="r">{n0(ftot.won)}</td><td className="r">{frate(ftot.won, ftot.leads)}</td><td className="r">{money(ftot.revenue)}</td></tr>
          </tbody>
        </table></div>
      )
    }
    // Merge duplicate key-event columns by label+kind (a union table built before
    // per-pipeline blocks existed can list the same event once per pipeline). The
    // per-pipeline reach is disjoint, so stage counts sum; won-kind reach isn't
    // pipeline-scoped, so take the max to avoid double counting.
    const dedupeUnion = (events, forms) => {
      const idxOf = new Map(); const merged = []; const groups = []
      events.forEach((k, i) => { const key = (k.kind || 'stage') + '|' + k.label; if (!idxOf.has(key)) { idxOf.set(key, merged.length); merged.push(k); groups.push([i]) } else groups[idxOf.get(key)].push(i) })
      if (merged.length === events.length) return { events, forms }
      const mForms = forms.map((f) => ({ ...f, ke: groups.map((g, gi) => { const vals = g.map((i) => (f.ke && f.ke[i]) || 0); return merged[gi].kind === 'won' ? Math.max(0, ...vals) : vals.reduce((s, v) => s + v, 0) }) }))
      return { events: merged, forms: mForms }
    }
    const byPipe = (rep.formKeByPipe && rep.formKeByPipe.length > 1) ? rep.formKeByPipe : null
    const uniFke = rep.formKe || []
    const hasFke = uniFke.length > 0
    const uni = hasFke ? dedupeUnion(uniFke, rep.forms) : null
    push(
      <MRSlide key="forms" kicker="Caalano360 · Forms" title="Form performance" sub={hasFke ? `Every lead form this month, from leads through your configured key events - so you can compare friction vs quality (fewer but higher-converting vs more but lower-quality).${byPipe ? ' Split per pipeline - each shows only that pipeline’s key events.' : ''}` : "Every lead form this month, from leads through to won - so you can compare friction vs quality."}>
        {byPipe
          ? byPipe.map((blk, bi) => (
              <div key={bi} className="mr-camp-block">
                <div className="mr-pipe-head" style={{ marginTop: bi ? 16 : 0 }}><span className="c360-dot" /> {blk.pipelineName || 'Pipeline'} <span className="cap">· {blk.forms.length} form(s)</span></div>
                {keTable(blk.events, blk.forms, blk.pipelineId || 'all')}
              </div>
            ))
          : hasFke
            ? keTable(uni.events, uni.forms, 'all')
            : legacyTable(rep.forms)}
      </MRSlide>
    )
  }

  // ---- Caalano360 (order: User performance + Lost reasons combined → Account summary & ROI) ----
  if (rep.hasCrm && blend) {
    const rmap = reachedByStage(pipelines)
    const calMap = attribution ? calCountMap(attribution, 'all') : new Map()
    const keyEventsRaw = resolveKeyEvents(loadKeyEvents(rep.client.id), stagePos)
    // Pass the RAW key events to keyEventRows - it resolves internally, and
    // double-resolving drops bare stage events (Won, Shown, …), which is why the
    // funnel previously showed only Leads + the calendar-linked stage.
    // Use the deal-level created-on won count (coWon) - NOT the blend aggregate
    // crm.won - so the funnel's "Client Won" matches the "Deals won · created" KPI
    // and the status donut above (they can differ by a deal at the month boundary).
    const funnelRows = keyEventRows(loadKeyEvents(rep.client.id), rmap, calMap, stagePos, coWon.count || 0)
    // Per-pipeline funnels: for multi-pipeline clients (FINR = BA + Finance, Nexia =
    // ADHD + Allied Health, …) render ONE funnel per pipeline. Scoping the key events
    // via keyEventsForPipe means each calendar merges cleanly with its own pipeline's
    // stage (the union view otherwise showed the same step twice - 📅 calendar AND
    // plain stage). Single-pipeline clients keep the one account-level funnel.
    const funnelPipeSpec = multiPipe ? pipelines : [null]
    const funnelPipes = funnelPipeSpec.map((p) => {
      const kev = p ? keyEventsForPipe(rawKeyEvents, p.id) : rawKeyEvents
      const prmap = p ? reachedByStage([p]) : rmap
      const wt = p ? ((p.crm && p.crm.won) || p.won || 0) : (coWon.count || 0)
      const rows = keyEventRows(kev, prmap, calMap, stagePos, wt)
      const leads = p ? ((p.crm && p.crm.leads) || p.leads || 0) : (crm.leads || 0)
      return { pipe: p, rows, leads }
    }).filter((f) => f.rows.length)
    // Blended spend allocated across pipelines by lead share (same basis the live
    // pipeline-performance view uses) so each funnel's "cost / event" reads sensibly.
    const funnelLeadTotal = funnelPipes.reduce((s, f) => s + f.leads, 0)
    const funnelSpendOf = (f) => (funnelPipes.length > 1 && funnelLeadTotal ? totalSpend * (f.leads / funnelLeadTotal) : totalSpend)
    const otherRev = Math.max(0, realisedRev - paidRev)
    const PIE = ['#6d5efc', '#e0803a', '#e1306c', '#4285f4', '#f59e0b', '#12b886', '#9b8cff', '#ef4444']
    const statusDonut = [
      { name: 'Open', value: crm.open || 0, color: '#6d5efc' },
      { name: 'Won', value: coWon.count || 0, color: '#22b07d' },
      { name: 'Lost', value: lost.total.count || 0, color: '#ef4444' },
    ].filter((d) => d.value)
    // This month's leads that have an outcome: won, or lost (abandoned counts
    // as lost in the CRM feed) - the rest are still open.
    const cohortLost = crm.lost != null ? crm.lost : Math.max(0, (crm.leads || 0) - (coWon.count || 0) - (crm.open || 0))
    const cohortResulted = (coWon.count || crm.won || 0) + cohortLost
    const cohortDonut = [
      { name: 'Won', value: coWon.count || crm.won || 0, color: '#22b07d' },
      { name: 'Lost', value: cohortLost, color: '#ef4444' },
      { name: 'Open', value: crm.open || 0, color: '#6d5efc' },
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
    // ---- Per-pipeline breakdowns (multi-pipeline clients only) ----
    // Each pipeline gets its own User-performance table and Lost-reasons panel, so a
    // FINR (BA + Finance) / Nexia (ADHD + Allied Health) report reads pipeline by
    // pipeline instead of blending two books of business into one.
    const keFor = (pid) => (pid ? resolveKeyEvents(keyEventsForPipe(rawKeyEvents, pid), stagePos) : keyEventsRaw)
      .filter((k) => k.kind === 'stage' || (k.kind === 'calendar' && k.stage)).slice(0, 5)
    // Closed-this-month deals for a user, optionally scoped to a pipeline by name.
    const userDealsPipe = (uid, pname) => (scWon.deals || []).filter((d) => d.userId === uid && (pname == null || d.pipeline === pname))
    // Cohort-won deals for a rep: this-month's leads (created-on cohort) that are won.
    const userCohortDealsPipe = (uid, pname) => (coWon.deals || []).filter((d) => d.userId === uid && (pname == null || d.pipeline === pname))
    const buildUrows = (P) => {
      const kelist = P ? keFor(P.id) : ke
      const rows = users.map((u) => {
        const up = P ? (u.pipelines || []).find((p) => p.id === P.id) : null
        if (P && !up) return null
        const uc = P ? (up.crm || {}) : (u.crm || {})
        const urmap = reachedByStage(P ? [up] : (u.pipelines || []))
        const evReach = {}; for (const k of kelist) evReach[k.ref] = stageReachOf(urmap, k.pipeline, keRef(k))
        const deals = P ? userDealsPipe(u.id, P.name) : null
        const closed = P ? deals.length : (() => { const sc = (scWon.byUser && scWon.byUser[u.id]) || {}; return sc.count != null ? sc.count : (sc.won || 0) })()
        const revenue = P ? deals.reduce((s, d) => s + (d.value || 0), 0) : (((scWon.byUser && scWon.byUser[u.id]) || {}).revenue || 0)
        const leads = P ? (uc.leads || 0) : (u.leads || uc.leads || 0)
        return { id: u.id, name: u.name, leads, cohortWon: uc.won || 0, evReach, closed, revenue }
      }).filter(Boolean).filter((r) => !P || r.leads || r.closed || r.cohortWon)
      return { ke: kelist, rows: rows.sort((a, b2) => (b2.revenue - a.revenue) || (b2.closed - a.closed) || (b2.leads - a.leads)) }
    }
    // Which paid channel a lost deal's lead came from (Meta / Google / everything
    // else), so we can total each lost reason by platform.
    const chanKey = (d) => (d.channel === 'meta' ? 'meta' : d.channel === 'google' ? 'google' : 'other')
    // Single-pipeline lost reasons rebuilt from the deal list so each reason carries
    // its per-channel split (the backend byReason has no channel breakdown). Falls
    // back to the backend rows (no channel columns) if the deal detail is absent.
    const lostByReasonChan = (() => {
      if (!(lost.deals && lost.deals.length)) return { rows: lost.byReason || [], hasChan: false }
      const m = new Map()
      for (const d of lost.deals) {
        const rn = d.reason || 'Not set'
        const e = m.get(rn) || { name: rn, count: 0, value: 0, meta: 0, google: 0, other: 0 }
        e.count++; e.value += d.value || 0; e[chanKey(d)]++; m.set(rn, e)
      }
      return { rows: [...m.values()].sort((a, b2) => b2.count - a.count), hasChan: true }
    })()
    // Lost reasons grouped by pipeline (from the capped closed-lost deal list, which
    // is the only feed carrying each deal's pipeline).
    const lostByPipe = () => {
      const m = new Map()
      for (const d of (lost.deals || [])) {
        const pn = d.pipeline || 'Unassigned'
        let g = m.get(pn); if (!g) { g = { name: pn, deals: [], byReason: new Map(), count: 0, value: 0 }; m.set(pn, g) }
        g.deals.push(d); g.count++; g.value += d.value || 0
        const rn = d.reason || 'Not set'; const rr = g.byReason.get(rn) || { count: 0, value: 0, meta: 0, google: 0, other: 0 }
        rr.count++; rr.value += d.value || 0; rr[chanKey(d)]++; g.byReason.set(rn, rr)
      }
      // Order by the account pipeline order, then any extras.
      const order = new Map(pipelines.map((p, i) => [p.name, i]))
      return [...m.values()].map((g) => ({
        name: g.name, count: g.count, value: g.value, deals: g.deals,
        byReason: [...g.byReason.entries()].map(([name, v]) => ({ name, count: v.count, value: v.value, meta: v.meta, google: v.google, other: v.other })).sort((a, b2) => b2.count - a.count),
      })).sort((a, b2) => (order.has(a.name) ? order.get(a.name) : 99) - (order.has(b2.name) ? order.get(b2.name) : 99) || b2.count - a.count)
    }
    // Render one user-performance MRTable for a given {ke, rows} bundle + drill scope.
    const UserPerfTable = ({ bundle, pname }) => (
      <MRTable
        cols={[
          { k: 'name', label: 'User', render: (r) => <span className="mr-name">{r.name}</span> },
          { k: 'leads', label: 'Leads', align: 'r', render: (r) => n0(r.leads) },
          ...bundle.ke.map((k) => ({ k: 'ev_' + k.ref, label: k.label, align: 'r', render: (r) => n0(r.evReach[k.ref] || 0) })),
          { k: 'cohortWon', label: 'Won (cohort)', align: 'r', render: (r) => (r.cohortWon ? <button className="mr-cellbtn" onClick={() => openDrill({ title: `${r.name} - won (cohort, leads created this month)${pname ? ` · ${pname}` : ''}`, deals: userCohortDealsPipe(r.id, pname) })}>{n0(r.cohortWon)}</button> : '-') },
          { k: 'winrate', label: 'Cohort win %', align: 'r', render: (r) => pc(r.cohortWon, r.leads) },
          { k: 'closed', label: 'Closed this mo', align: 'r', render: (r) => (r.closed ? <button className="mr-cellbtn" onClick={() => openDrill({ title: `${r.name} - closed this month${pname ? ` · ${pname}` : ''}`, deals: userDealsPipe(r.id, pname) })}>{n0(r.closed)}</button> : '-') },
          { k: 'revenue', label: 'Revenue (closed)', align: 'r', render: (r) => money(r.revenue) },
        ]}
        rows={bundle.rows} max={16}
        empty="No assigned-user data for this pipeline."
        wrapClass="mr-userperf"
      />
    )
    push(
      <MRSlide key="users" kicker="Caalano360 · Sales" title="Sales Performance" sub="Each rep's month, then how this month's leads were resulted and why the deals marked lost were lost.">
        <section className="mr-bubble">
          <div className="mr-bubble-lab">👥 User performance</div>
          <p className="mr-bubble-sub">Ranked by revenue closed this month. Leads and key-event columns are each user's created-on cohort; “Closed this mo” is deals they marked won this month.</p>
          {topU && topU.closed > 0 && <div className="mr-top">
            <span className="mr-top-badge">★ Top performer</span>
            <b>{topU.name}</b>
            <span className="mr-top-stats">{money(topU.revenue)} closed · {n0(topU.closed)} deal(s) this month · {n0(topU.leads)} new leads</span>
          </div>}
          {multiPipe
            ? pipelines.map((P) => {
              const bundle = buildUrows(P)
              if (!bundle.rows.length) return null
              return (
                <div className="mr-pipe-block" key={P.id}>
                  <div className="mr-pipe-head"><span className="c360-dot" /> {P.name}</div>
                  <UserPerfTable bundle={bundle} pname={P.name} />
                </div>
              )
            })
            : <UserPerfTable bundle={{ ke, rows: urows }} pname={null} />}
          <p className="mr-foot-note">“Won (cohort)” counts this month's leads that are already won; “Closed this mo” counts deals won this month regardless of when the lead came in - click a number to see the deals.{multiPipe ? ' Each table is scoped to that pipeline.' : ''}</p>
        </section>

        <section className="mr-bubble">
          <div className="mr-bubble-lab">📉 Lost reasons &amp; pipeline status</div>
          <p className="mr-bubble-sub">Why the deals marked lost this month were lost - by status change, whatever month the lead arrived, so it reads as what the team has just been through - and where this month's leads currently stand.</p>
          <div className="mr-kpirow mr-kpirow-wide">
            <MRKpi label="Deals lost" value={n0(lost.total.count)} sub="marked lost this month (status change)" />
            <MRKpi label="Value lost" value={money(lost.total.value)} />
            <MRKpi label="Win rate" value={pc(dealsWon, dealsWon + lost.total.count)} sub="won ÷ resulted this month" />
            <MRKpi label="Resulted leads" value={n0(cohortResulted)} sub={`of ${n0(crm.leads)} leads this month · won, lost or abandoned`} />
            <MRKpi label="Result rate" value={pc(cohortResulted, crm.leads)} sub="resulted ÷ this month's leads" strong />
            <MRKpi label="Still open" value={n0(crm.open)} sub={`${money(crm.openValue)} in pipeline`} />
          </div>
          <div className="mr-two mr-lost-split">
          <div className="mr-lost-full">
            <div className="mr-viz-lab">Why deals were lost{multiPipe ? ' · by pipeline' : ''} · by channel</div>
            {(() => {
              // Reason + Deals/Value/% then a per-channel split (Meta / Google / Other),
              // so you can see which platform's leads drive each lost reason.
              const chanCols = [
                { k: 'meta', label: 'Meta', align: 'r', render: (r) => n0(r.meta || 0) },
                { k: 'google', label: 'Google', align: 'r', render: (r) => n0(r.google || 0) },
                { k: 'other', label: 'Other', align: 'r', render: (r) => n0(r.other || 0) },
              ]
              const reasonCol = (drillTitle, deals) => ({ k: 'name', label: 'Reason', render: (r) => (openDrill ? <button className="mr-cellbtn mr-cellbtn-l" onClick={() => openDrill({ title: drillTitle(r), kind: 'lost', deals: deals(r) })}>{r.name}</button> : <span className="mr-name">{r.name}</span>) })
              if (multiPipe) {
                const groups = lostByPipe()
                if (!groups.length) return <div className="mr-empty">No deals were marked lost this month{md ? '' : ' (regenerate the snapshot to pull lost-deal detail)'}.</div>
                return groups.map((g) => (
                  <div className="mr-pipe-block" key={g.name}>
                    <div className="mr-pipe-head"><span className="c360-dot" /> {g.name} <span className="cap">· {n0(g.count)} lost · {money(g.value)}</span></div>
                    <MRTable
                      cols={[
                        reasonCol((r) => `Lost - ${r.name} · ${g.name}`, (r) => g.deals.filter((d) => (d.reason || 'Not set') === r.name)),
                        { k: 'count', label: 'Deals', align: 'r', render: (r) => n0(r.count) },
                        { k: 'value', label: 'Value', align: 'r', render: (r) => money(r.value) },
                        { k: 'share', label: '% of lost', align: 'r', render: (r) => pc(r.count, g.count) },
                        { k: 'ofLeads', label: '% of leads', align: 'r', render: (r) => pc(r.count, crm.leads) },
                        ...chanCols,
                      ]}
                      rows={g.byReason} max={6}
                    />
                  </div>
                ))
              }
              if (!lostByReasonChan.rows.length) return <div className="mr-empty">No deals were marked lost this month{md ? '' : ' (regenerate the snapshot to pull lost-deal detail)'}.</div>
              return (
                <MRTable
                  cols={[
                    reasonCol((r) => `Lost - ${r.name}`, (r) => (lost.deals || []).filter((d) => (d.reason || 'Not set') === r.name)),
                    { k: 'count', label: 'Deals', align: 'r', render: (r) => n0(r.count) },
                    { k: 'value', label: 'Value', align: 'r', render: (r) => money(r.value) },
                    { k: 'share', label: '% of lost', align: 'r', render: (r) => pc(r.count, lost.total.count) },
                    { k: 'ofLeads', label: '% of leads', align: 'r', render: (r) => pc(r.count, crm.leads) },
                    ...(lostByReasonChan.hasChan ? chanCols : []),
                  ]}
                  rows={lostByReasonChan.rows} max={10}
                />
              )
            })()}
            <p className="mr-foot-note" style={{ marginTop: 8 }}>Of {n0(crm.leads)} leads created this month: {n0(coWon.count)} won, {n0(crm.lost != null ? crm.lost : Math.max(0, n0(crm.leads) - n0(coWon.count) - n0(crm.open)))} lost, {n0(crm.open)} still open. The table above counts deals marked lost this month whatever month their lead arrived, so its total can differ. The Meta / Google / Other columns split each lost reason by the platform its lead first came from.</p>
          </div>
          <MRLostPie status={cohortDonut} reasons={lostByReasonChan.rows.map((r, k) => ({ name: r.name, value: r.count, color: PIE[k % PIE.length] }))} money={money} />
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
      close: (scWon.byChannel && scWon.byChannel[cKey] && scWon.byChannel[cKey].avgCloseDays != null) ? scWon.byChannel[cKey].avgCloseDays : null,
    })).filter((r) => r.spend || r.rev)
    push(
      <MRSlide key="c360" kicker="Caalano360" title="Account summary & ROI" sub="Ad platform + CRM. Spend & leads are this month's; ROAS is measured only on revenue from deals attributed to a paid channel (Meta/Google) via UTM - never total business.">
        <div className="mr-kpirow mr-kpirow-wide">
          <MRKpi label="Total ad spend" value={money(totalSpend)} />
          <MRKpi label="Paid results" value={n0(paidLeads)} sub="Meta results + Google conv · not CRM leads" />
          <MRKpi label="Cost / result" value={paidLeads ? money(totalSpend / paidLeads) : '-'} sub="spend ÷ ad results" />
          <MRKpi label="Deals won · created" value={n0(coWon.count)} sub="this month's leads" />
          <MRKpi label="Deals won · closed" value={n0(dealsWon)} sub="closed this month" />
          <MRKpi label="Paid revenue" value={money(paidRev)} strong sub="closed this month" />
          <MRKpi label="ROAS (paid)" value={roas != null ? roas.toFixed(1) + 'x' : '-'} sub="cash / status change" />
          <MRKpi label="Cost / won (paid)" value={paidWon ? money(totalSpend / paidWon) : '-'} />
          <MRKpi label="Avg time to close" value={scWon.avgCloseDays != null ? `${scWon.avgCloseDays} days` : '-'} sub="lead → won" />
          <MRKpi label="Open pipeline" value={money(crm.openValue)} sub={`${n0(crm.open)} open`} />
        </div>
        <div className="mr-two mr-two-viz">
          <div>
            <div className="mr-section-lab">Revenue - status change vs created on</div>
            <div className="mr-revmatrix-wrap"><MRRevMatrix sc={scWon} co={coWon} spend={totalSpend} money={money} n0={n0} onDrill={openDrill} lostSc={md ? md.lost : null} lostCo={md && md.lostCreatedOn ? md.lostCreatedOn : null} /></div>
            {roiRows.length > 0 && (
              <>
                <div className="mr-section-lab">ROI by channel (closed this month)</div>
                <MRTable
                  cols={[
                    { k: 'label', label: 'Channel', render: (r) => <span className="mr-name">{r.label}</span> },
                    { k: 'spend', label: 'Spend', align: 'r', render: (r) => money(r.spend) },
                    { k: 'won', label: 'Won', align: 'r', render: (r) => n0(r.won) },
                    { k: 'rev', label: 'Revenue', align: 'r', render: (r) => money(r.rev) },
                    { k: 'roas', label: 'ROAS', align: 'r', render: (r) => (r.spend ? (r.rev / r.spend).toFixed(1) + 'x' : '-') },
                    { k: 'cac', label: 'CAC', align: 'r', render: (r) => (r.won ? money(r.spend / r.won) : '-') },
                    { k: 'close', label: 'Avg close', align: 'r', render: (r) => (r.close != null ? `${r.close} days` : '-') },
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
        <div className="mr-section-lab">This month's leads → key events (created-on cohort){multiPipe && funnelPipes.length > 1 ? ' · one funnel per pipeline' : ''}</div>
        {funnelPipes.length
          ? (multiPipe && funnelPipes.length > 1
            ? <div className="mr-funnel-split">
              {funnelPipes.map((f) => (
                <div className="mr-funnel-big" key={f.pipe.id}>
                  <KeyEventsFunnel rows={f.rows} total={f.leads} spend={funnelSpendOf(f)} currency={currency}
                    title={f.pipe.name} sub={`${n0(f.leads)} leads created this month in this pipeline · spend allocated by lead share`}
                    caveat="One cohort: this pipeline's leads created this month and how far they've progressed. “Cost / event” spreads that pipeline's share of ad spend across every event - a blended guide, not paid-only CAC." />
                </div>
              ))}
            </div>
            : <div className="mr-funnel-big"><KeyEventsFunnel rows={funnelPipes[0].rows} total={funnelPipes[0].leads} spend={totalSpend} currency={currency} caveat="One cohort: leads created this month and how far they've progressed. “Cost / event” spreads total ad spend across every event, so it's a blended guide, not paid-only CAC." /></div>)
          : <div className="mr-empty">No key events configured - set them in Settings → Key events.</div>}
      </MRSlide>
    )
  }

  // Number the slides (cover excluded from the count shown).
  return slides
}

// Aggregate conversion-action rows (which come per campaign/ad-group) up to the
// account level by action name.
export function aggConvActions(rows) {
  const m = new Map()
  for (const r of rows) { const e = m.get(r.name) || { name: r.name, category: r.category, conversions: 0, allConversions: 0, value: 0 }; e.conversions += r.conversions || 0; e.allConversions += r.allConversions || 0; e.value += r.value || 0; m.set(r.name, e) }
  return [...m.values()].sort((a, b) => b.allConversions - a.allConversions)
}

// ---------------------------------------------------------------------------
// Organic Social Media dashboard - Instagram + Facebook Page organic, per client.
// ---------------------------------------------------------------------------
