// On-demand AI insights for the Weekly Traffic Light. Called only when the user
// clicks "Generate" (never on load), so credit use is deliberate. Receives the
// already-computed weekly payload from the browser and asks Claude to interpret
// the Meta + Google performance against the CRM outcomes / lost reasons.
// Requires ANTHROPIC_API_KEY in Netlify env.
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

// Shared: call Claude and normalise the response into { insights, model }.
async function callClaude(apiKey, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    // thinking disabled: Sonnet 5 runs adaptive thinking by default, which can
    // eat the whole max_tokens budget and return no text block for a simple
    // generation task. Disabling keeps the full budget for the answer.
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2400, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j.error && j.error.message) || `AI error ${r.status}`)
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
  if (!text) throw new Error('empty AI response')
  return { insights: text, model: j.model || 'claude-sonnet-5' }
}

const n0 = (v) => (v == null || isNaN(v) ? 0 : Math.round(v))
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0')

// Blended Caalano360 briefing: interprets the whole-picture snapshot for the
// selected period (paid + CRM outcomes + targets), not the weekly board.
async function blendInsights(apiKey, body) {
  const { clientName, period, scope, blend: b } = body
  if (!b) throw new Error('no blend data supplied')
  const roas = b.spend ? (b.revenue / b.spend).toFixed(2) : '0.00'
  const lines = []
  lines.push(`Spend $${n0(b.spend)} (Meta $${n0(b.metaSpend)} / Google $${n0(b.googleSpend)}), impressions ${n0(b.impressions)}, clicks ${n0(b.clicks)}`)
  lines.push(`Leads ${n0(b.leads)} (Meta ${n0(b.metaLeads)} / Google ${n0(b.googleLeads)}), booked ${n0(b.booked)}, shown ${n0(b.shown)}, won ${n0(b.won)}`)
  lines.push(`Revenue $${n0(b.revenue)} (created basis), ROAS ${roas}x, avg deal $${n0(b.avgDeal)}`)
  lines.push(`Funnel rates: lead->booked ${pct(b.booked, b.leads)}%, booked->shown ${pct(b.shown, b.booked)}%, shown->won ${pct(b.won, b.shown)}%, lead->won ${pct(b.won, b.leads)}%`)
  if (b.wonClosed) lines.push(`Deals marked Won in this window (realised, any created date): ${n0(b.wonClosed.won)} worth $${n0(b.wonClosed.revenue)}`)
  if (b.prev) lines.push(`Previous period: spend $${n0(b.prev.spend)}, leads ${n0(b.prev.leads)}, booked ${n0(b.prev.booked)}, won ${n0(b.prev.won)}, revenue $${n0(b.prev.revenue)}`)
  if (b.channels) {
    if (b.channels.meta) lines.push(`Meta CRM: leads ${n0(b.channels.meta.leads)}, booked ${n0(b.channels.meta.booked)}, won ${n0(b.channels.meta.won)}, revenue $${n0(b.channels.meta.revenue)}`)
    if (b.channels.google) lines.push(`Google CRM: leads ${n0(b.channels.google.leads)}, booked ${n0(b.channels.google.booked)}, won ${n0(b.channels.google.won)}, revenue $${n0(b.channels.google.revenue)}`)
  }
  const camps = (b.topCampaigns || []).slice(0, 8).map((c) => `${c.name} (${c.source}): spend $${n0(c.spend)}, leads ${n0(c.leads)}, won ${n0(c.won)}, rev $${n0(c.revenue)}, ROAS ${c.roas != null ? c.roas.toFixed(2) + 'x' : 'n/a'}`).join('\n') || 'none'
  const lost = (b.lostReasons || []).slice(0, 10).map((r) => `${r.name} (${r.count})`).join(', ') || 'none recorded'
  const t = b.targets || {}
  const targets = `Targets - weekly spend $${t.wkSpend || '-'}, all-leads CPL $${t.cpl || '-'}, cost/booked $${t.cpba || '-'}, cost/won $${t.cpa || '-'}, booking rate ${t.bookingRate || '-'}%`
  const prompt = `You are a senior paid-media + CRM analyst at a marketing agency, briefing the account team on one client's blended results.

Client: ${clientName || 'Client'}
Period: ${period || 'selected period'} (${scope || 'whole account'})
${targets}

Blended performance this period:
${lines.join('\n')}

Top campaigns by spend (with CRM-attributed revenue):
${camps}

CRM lost reasons this period: ${lost}

Write a concise briefing in markdown:
1. **Headline** - one sentence on overall health this period, referencing ROAS and spend.
2. **Funnel read** - 2-4 bullets on where leads convert or drop (booking rate, show rate, win rate) and cost per step vs targets. Cite specific numbers.
3. **Channel split** - 1-2 bullets comparing Meta vs Google on efficiency and outcomes (only if both ran).
4. **Revenue** - 1 bullet on created-basis revenue and, if provided, realised (won-in-period) revenue, and what the gap implies about sales-cycle lag.
5. **Actions** - 2-3 concrete next steps.

Be specific and numeric. Keep it under 300 words. Do not use em-dashes or en-dashes anywhere; use commas, colons or hyphens instead.`
  const out = await callClaude(apiKey, prompt)
  return { ...out, period: period || 'selected period', generatedAt: new Date().toISOString() }
}

// Executive summary for the Caalano 360 executive tab. The health score, KPIs,
// forecast and priority flags are ALL computed server-side and passed in here;
// Claude only narrates them into a board-level briefing. It must not invent or
// recompute figures - if a number isn't supplied it says so.
async function execInsights(apiKey, body) {
  const { clientName, period, health: h } = body
  if (!h || !h.score) throw new Error('no health data supplied')
  const s = h.score, k = h.kpis || {}, pv = k.prev || {}, fc = h.forecast || {}
  const pillarLine = ['marketing', 'sales', 'ops', 'revenue'].map((key) => `${key} ${s[key] == null ? 'n/a' : s[key]}`).join(', ')
  const lines = []
  lines.push(`Composite health ${s.composite == null ? 'n/a' : s.composite}/100 (pillars: ${pillarLine}). Weights: ${JSON.stringify(s.weights || {})}.`)
  lines.push(`This period: ad spend $${n0(k.adSpend)}, leads ${n0(k.leads)}, qualified ${n0(k.qualified)}, booked ${n0(k.booked)}, shown ${n0(k.shown)}, won ${n0(k.won)}, revenue $${n0(k.revenue)}, cost/lead $${n0(k.cpl)}, cost/qualified $${n0(k.cpql)}, open pipeline $${n0(k.openValue)}.`)
  if (k.prev) lines.push(`Previous period: spend $${n0(pv.adSpend)}, leads ${n0(pv.leads)}, qualified ${n0(pv.qualified)}, booked ${n0(pv.booked)}, won ${n0(pv.won)}, revenue $${n0(pv.revenue)}.`)
  if (fc && fc.projectedRevenue != null) lines.push(`Run-rate forecast (at ${fc.elapsedPct}% elapsed): projected revenue $${n0(fc.projectedRevenue)} vs last period $${n0(fc.prevRevenue)}, projected won ${n0(fc.projectedWon)}, pace ${fc.pacePct == null ? 'n/a' : fc.pacePct + '%'} of prior revenue.`)
  // The pillar working (each metric's actual vs reference) for grounded detail.
  for (const key of ['marketing', 'sales', 'ops', 'revenue']) {
    const p = s.pillars && s.pillars[key]
    if (p && p.components && p.components.length) lines.push(`${p.label} detail: ${p.components.map((c) => `${c.label} ${c.actual == null ? 'n/a' : c.fmt === 'pct' ? Math.round(c.actual * 100) + '%' : c.fmt === 'money' ? '$' + n0(c.actual) : n0(c.actual)} (score ${c.score == null ? 'n/a' : c.score})`).join('; ')}.`)
  }
  const prompt = `You are the head of a marketing agency writing a short executive briefing to the leadership team about one client's overall business health. Every figure below has already been calculated - use only these numbers, never invent or recompute, and if something is marked n/a say it isn't available.

Client: ${clientName || 'Client'}
Period: ${period || 'selected period'}

${lines.join('\n')}

The health score compares this period to the previous equal-length period. Note: unanswered CRM messages do NOT mean a lead was ignored - clients may respond on phone or other channels, so treat any responsiveness signal as indicative only.

Write a concise executive briefing in markdown:
1. **Bottom line** - one sentence: overall health (cite the composite score and whether it improved) and the single most important thing leadership should know.
2. **What's driving it** - 2-4 bullets on the strongest and weakest pillars, citing the specific metrics and their vs-previous movement.
3. **Watch list** - 1-3 bullets on risks (pacing behind, rising cost per lead, falling conversion, stalled pipeline value).
4. **Recommended focus** - 2-3 concrete actions for the team this period.

Be specific and numeric. Keep it under 280 words. Do not use em-dashes or en-dashes anywhere; use commas, colons or hyphens instead.`
  const out = await callClaude(apiKey, prompt)
  return { ...out, period: period || 'selected period', generatedAt: new Date().toISOString() }
}

// Creative Cockpit — suggest categorisation tags for ONE creative from its copy
// + format + performance. Returns strict JSON (awareness / persona / angle) that
// the UI drops into the editor for the user to confirm. Reuses the client's
// existing persona / angle lists so tagging stays consistent.
async function creativeTagSuggest(apiKey, body) {
  const { creative: c, personas = [], angles = [] } = body
  if (!c) throw new Error('no creative supplied')
  const prompt = `You are a paid-social creative strategist. Categorise ONE ad from its details. Reply with ONLY a JSON object, no prose, shaped exactly:
{"aware":"<one of: Unaware, Problem-aware, Solution-aware, Product-aware, Most-aware>","persona":"<short persona label>","angle":"<short angle label>","reason":"<one sentence>"}

Prefer reusing an existing label when it fits.
Existing personas: ${personas.length ? personas.join(', ') : 'none yet'}
Existing angles: ${angles.length ? angles.join(', ') : 'none yet'}

Ad name: ${c.name || 'n/a'}
Format: ${c.format || 'n/a'}
Call to action: ${c.cta || 'n/a'}
Primary text / copy: ${c.copy ? c.copy.slice(0, 1200) : '(none provided)'}
${c.transcript ? `Video transcript: ${String(c.transcript).slice(0, 2000)}` : ''}`
  const out = await callClaude(apiKey, prompt)
  let parsed = null
  try { const m = out.insights.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null } catch { parsed = null }
  if (!parsed) throw new Error('could not parse AI tag suggestion')
  const AW = ['Unaware', 'Problem-aware', 'Solution-aware', 'Product-aware', 'Most-aware']
  return { suggestion: { aware: AW.includes(parsed.aware) ? parsed.aware : '', persona: String(parsed.persona || '').slice(0, 60), angle: String(parsed.angle || '').slice(0, 60), reason: String(parsed.reason || '').slice(0, 240) }, model: out.model, generatedAt: new Date().toISOString() }
}

// Creative Cockpit — a strategy briefing over the whole tagged + performance set:
// what's working, what to double down on, and new concepts to test. Every number
// is supplied; Claude only interprets it.
// Creative Curator: brainstorm ready-to-brief paid-social creative concepts from
// the chosen Format / Style / CTA / Audience / Angle, in general research mode or
// framed for one client (name + industry + free-text context). Returns markdown.
async function creativeCurator(apiKey, body) {
  const { scope = 'research', clientName, industry, clientContext, format, style, cta, audience, angle, avoid = [] } = body
  const ctx = scope === 'client' && clientName
    ? `You are briefing creative for a SPECIFIC client. Client: ${clientName}${industry ? ` (industry: ${industry})` : ''}.${clientContext ? ` Context about the brand, offer and customers: ${String(clientContext).slice(0, 1500)}` : ''} Frame every concept for this business and its real customers; reference their offer where you can.`
    : 'General research mode: give broadly useful ideas for a service / lead-generation business. Keep them adaptable across verticals.'
  const pick = (label, v) => (v ? `${label}: ${v}. ` : '')
  const constraints = `${pick('Format', format)}${pick('Creative style', style)}${pick('Call to action', cta)}${pick('Target audience', audience)}${pick('Messaging angle', angle)}`.trim() || 'No fixed constraints: range across formats, styles, CTAs and angles for variety.'
  const avoidLine = avoid && avoid.length ? `\nDo NOT repeat these concepts already on the board: ${avoid.slice(0, 12).join(' | ')}.` : ''
  const prompt = `You are a senior paid-social (Meta / Instagram) creative strategist at a lead-generation agency. Generate fresh, ready-to-brief creative concepts a team could shoot this week.

${ctx}

Requested constraints (honour any that are set; where something is not set, choose what fits best and vary it): ${constraints}${avoidLine}

Produce 5 distinct concepts. For EACH, use exactly this markdown block:
### [n]. [Punchy concept title]
- **Format / Style / CTA:** ...
- **Audience & angle:** ...
- **Hook (first 3 seconds):** one scroll-stopping opening line, in quotes
- **Structure:** 3 to 5 quick beats (video), or card-by-card (carousel), or the layout (image)
- **On-screen / caption idea:** one line
- **Why it works:** one line

Make them concrete and production-ready, not generic. Vary the angles across the five. Australian spelling. Do NOT use em dashes or en dashes; use commas, colons or hyphens. Keep the whole thing under 550 words.`
  const out = await callClaude(apiKey, prompt)
  return { ...out, generatedAt: new Date().toISOString() }
}

async function creativeStrategy(apiKey, body) {
  const { clientName, period, rollups = {}, top = [], bottom = [] } = body
  const dimLine = (label, arr) => `${label}: ${(arr || []).slice(0, 8).map((e) => `${e.key} (${e.n} ads, $${n0(e.spend)} spend, ${n0(e.leads)} leads${e.bk != null ? `, ${n0(e.bk)} booked` : ''}${e.cpb != null ? `, $${n0(e.cpb)}/booked call` : ''})`).join('; ') || 'untagged'}`
  const lines = []
  for (const [k, label] of [['angle', 'By angle'], ['persona', 'By persona'], ['aware', 'By awareness'], ['format', 'By format'], ['dest', 'By destination']]) if (rollups[k]) lines.push(dimLine(label, rollups[k]))
  const cLine = (c) => `${c.name} (${c.format}${c.angle ? `, ${c.angle}` : ''}${c.persona ? `, ${c.persona}` : ''}): $${n0(c.spend)} spend, ${n0(c.leads)} leads${c.booked != null ? `, ${n0(c.booked)} booked` : ''}${c.cpb != null ? `, $${n0(c.cpb)}/booked call` : ''}`
  const prompt = `You are the creative strategy lead at a paid-social agency, briefing the team on one client's Meta creative. Every figure below is already calculated; use only these numbers, do not invent.

Client: ${clientName || 'Client'}
Period: ${period || 'selected period'}

Performance rolled up by category (ranked by cost per qualified lead where available):
${lines.join('\n') || 'No tagged creatives yet.'}

Best performers:
${top.map(cLine).join('\n') || 'n/a'}

Weakest performers:
${bottom.map(cLine).join('\n') || 'n/a'}

Write a concise creative strategy briefing in markdown:
1. **What's working** - 2-3 bullets on the angles / personas / formats / awareness stages driving the best qualified-lead efficiency, citing the numbers.
2. **Cut or fix** - 1-2 bullets on what's underperforming and whether to kill or iterate.
3. **Make more like this** - 2-3 concrete new creative concepts to test next (angle + persona + format + hook idea), grounded in what's already winning.
4. **Coverage gaps** - 1 bullet on any awareness stage or persona that's under-served.

Be specific and numeric. Under 320 words. Do not use em-dashes or en-dashes; use commas, colons or hyphens.`
  const out = await callClaude(apiKey, prompt)
  return { ...out, period: period || 'selected period', generatedAt: new Date().toISOString() }
}

// Client Update generator — a client-facing account update for a period, in two
// formats: a casual WhatsApp message and a formal structured email. Every figure
// is supplied; Claude only writes it up. Returns strict JSON {subject, email,
// whatsapp}. Australian spelling, no em dashes, from Caalano Digital.
async function clientUpdate(apiKey, body) {
  const { clientName, firstName, period, periodDays, clientContext = '', kpis: k = {}, channels: ch = {}, forecast: fc = {}, creatives: cr = [], pipelines: pls = [], segments: segs = [], appts: ap = null, lostReasons: lr = [], avgCloseDays = null, nonBookerNotes: nbn = [], stalled: stl = [], geo = [], apptInsights: aii = null, speed: spd = null, cohortTrend: coh = [], forms: fms = [] } = body
  const pv = k.prev || {}
  const delta = (cur, prev, lowerBetter) => { if (cur == null || prev == null || !prev) return ''; const pc = Math.round(((cur - prev) / prev) * 100); const better = lowerBetter ? pc < 0 : pc > 0; return ` (${pc >= 0 ? 'up' : 'down'} ${Math.abs(pc)}% on the previous period, ${better ? 'better' : 'worse'})` }
  // Ad-reported leads (matches Meta/Google Ads Manager) are the basis for the
  // headline lead count and cost per lead. The CRM opportunity count is reported
  // separately, because it counts every source and counts differently.
  const adLeads = (ch.metaLeads || 0) + (ch.googleConv || 0)
  const prevAdLeads = (ch.prevMetaLeads != null || ch.prevGoogleConv != null) ? ((ch.prevMetaLeads || 0) + (ch.prevGoogleConv || 0)) : null
  const adCpl = adLeads ? Math.round(k.adSpend / adLeads) : null
  const twoChannels = (ch.metaSpend || 0) > 0 && (ch.googleSpend || 0) > 0
  const lines = []
  lines.push(`Ad spend $${n0(k.adSpend)}${delta(k.adSpend, pv.adSpend, false)} (Meta $${n0(ch.metaSpend)}, Google $${n0(ch.googleSpend)})`)
  lines.push(`Leads from the ads: ${n0(adLeads)}${delta(adLeads, prevAdLeads, false)}. THIS is the headline lead number to use; it is the ad-reported count and matches Meta/Google Ads Manager (Meta ${n0(ch.metaLeads)}, Google ${n0(ch.googleConv)}).`)
  lines.push(`Cost per lead $${adCpl != null ? n0(adCpl) : 'n/a'} (ad spend divided by ad-reported leads, so it matches Ads Manager), cost per booked call ${k.cpBooked != null ? '$' + n0(k.cpBooked) : 'n/a'}.`)
  lines.push(`Booked calls ${n0(k.booked)}${delta(k.booked, pv.booked, false)} (Caalano Systems bookings attributed to the ads by UTM).`)
  if (k.leads != null && k.leads !== adLeads) lines.push(`For context only (do NOT use as the ad lead count): the CRM logged ${n0(k.leads)} opportunities across all pipelines and sources this period. This differs from the ${n0(adLeads)} ad-reported leads because the CRM counts every source and can count differently. If you mention pipeline lead numbers, describe them as opportunities in the CRM, not ad leads.`)
  if (k.openValue) lines.push(`Open pipeline value right now $${n0(k.openValue)}`)
  // Appointment reporting nuance: attendance can look low simply because calls
  // are still upcoming, and a pipeline-vs-appointment gap flags a reporting issue.
  if (ap) {
    lines.push(`Appointment attendance breakdown (from the calendar): ${n0(ap.attended)} attended, ${n0(ap.noShow)} no-shows, ${n0(ap.upcoming)} still upcoming (the call has not happened yet, so it cannot count as shown yet), and ${n0(ap.occurred)} calls have actually taken place so far. Use this to explain the attended number honestly, especially that upcoming calls cannot have shown yet.`)
    if (ap.stageOnlyShown > 0) lines.push(`Reporting note: ${n0(ap.stageOnlyShown)} deals have been advanced past the "attended/shown" stage in the pipeline, but their appointment status was never marked as attended. This is likely a reporting gap where the team moved the deal forward but did not update the appointment (unless the deal sits in a no-show stage, which means they genuinely did not attend). Worth flagging to check.`)
  } else if (k.shown != null) {
    lines.push(`Attended / shown ${n0(k.shown)}${delta(k.shown, pv.shown, false)}`)
  }
  lines.push(`Deals won ${n0(k.won)}${delta(k.won, pv.won, false)}, revenue $${n0(k.revenue)}${delta(k.revenue, pv.revenue, false)}`)
  if (k.avgDeal) lines.push(`Average deal value $${n0(k.avgDeal)}`)
  if (avgCloseDays != null) lines.push(`Historically a won deal takes on average ${avgCloseDays} days from lead to close.${(k.won === 0 && periodDays && periodDays < avgCloseDays) ? ` The leads this period are only ${periodDays} days old at most, which is less than the typical close time, so no wins YET is an expected result for a cohort this recent, not a concern.` : ''}`)
  if (lr && lr.length) lines.push(`Lost reasons this period (reason: count): ${lr.map((r) => `${r.reason} (${r.count})`).join(', ')}.`)
  // Stalled deals (open, no movement 30+ days) from the Users/pipeline data —
  // used to ask the client informed questions about where things are stuck.
  if (stl && stl.length) lines.push(`Deals currently stalled (still open, no movement for 30 or more days), by stage: ${stl.map((s) => `${n0(s.count)} at "${s.stage}"${s.pipeline ? ` in ${s.pipeline}` : ''}${s.value ? ` worth $${n0(s.value)}` : ''} (oldest ${n0(s.maxAge)} days)`).join('; ')}. Use these to ask the client, gently, whether we can help move them or get context on where they are at.`)
  // --- Additional context (geo / appointments / speed-to-lead / cohorts / forms) ---
  if (geo && geo.length) lines.push(`Where leads came from (top regions by leads): ${geo.map((g) => `${g.region} ${n0(g.leads)}${g.booked ? `, ${n0(g.booked)} booked` : ''}${g.won ? `, ${n0(g.won)} won` : ''}`).join('; ')}.`)
  if (aii) lines.push(`Appointment insights: booked calls sit on average ${aii.avgLeadDays != null ? `${aii.avgLeadDays} days` : 'n/a'} out from when they were booked${aii.avgTimeToBookDays != null ? `, and leads take about ${aii.avgTimeToBookDays} days from first contact to booking` : ''}. ${n0(aii.self)} were self-booked vs ${n0(aii.staff)} booked by the team${aii.selfPct != null ? ` (${aii.selfPct}% self-booked)` : ''}. Show rate ${aii.showRate != null ? `${aii.showRate}%` : 'n/a'}. Of ${n0(aii.booked)} booked calls, ${n0(aii.won)} have gone on to win${aii.winRate != null ? ` (${aii.winRate}%)` : ''}.`)
  if (spd) lines.push(`Speed to lead: typical (median) first human response ${spd.medianMin != null ? `${spd.medianMin} min` : 'n/a'}${spd.within5Pct != null ? `, ${spd.within5Pct}% answered within 5 min` : ''} (across ${n0(spd.measured)} measured leads). Book rate when followed up fast (under 15 min) ${spd.fastBookRate != null ? `${spd.fastBookRate}% (${n0(spd.fastCount)} leads)` : 'n/a'} vs slow (over 4 hrs) ${spd.slowBookRate != null ? `${spd.slowBookRate}% (${n0(spd.slowCount)} leads)` : 'n/a'}. A strong basis for a question if the gap is large.`)
  if (coh && coh.length) lines.push(`Recent lead cohorts by acquisition week (leads -> booked -> won; newest weeks are still maturing so low wins there are expected): ${coh.map((w) => `${w.week}: ${n0(w.leads)} leads, ${n0(w.booked)} booked, ${n0(w.won)} won`).join('; ')}. Use to say whether newer cohorts are converting better or worse.`)
  if (fms && fms.length) lines.push(`Top forms/offers by submissions: ${fms.map((f) => `${f.name}${f.kind ? ` (${f.kind})` : ''} ${n0(f.leads)} leads${f.booked ? `, ${n0(f.booked)} booked` : ''}${f.won ? `, ${n0(f.won)} won` : ''}`).join('; ')}. Use to note which form/offer pulls the best-converting leads.`)
  // Best-performing ads, with cost per lead and cost per booked call.
  const topCreatives = (cr || []).slice(0, 5).map((c) => { const cpl = c.leads ? Math.round(c.spend / c.leads) : null; const cpb = c.booked ? Math.round(c.spend / c.booked) : null; return `${c.name} (${c.format || 'ad'}): $${n0(c.spend)} spend, ${n0(c.leads)} leads${cpl != null ? ` at $${n0(cpl)}/lead` : ''}, ${n0(c.booked)} booked calls${cpb != null ? ` at $${n0(cpb)}/booked` : ''}` })
  const creativeBlock = topCreatives.length ? `\nTop performing ads (booked calls are Caalano Systems bookings attributed to the ad by UTM):\n${topCreatives.join('\n')}` : ''
  // Per-pipeline funnels; stages are already in pipeline (funnel) order.
  const multiPipe = (pls || []).filter((p) => p.leads > 0 || p.booked > 0 || p.won > 0).length > 1
  const pipeBlock = (pls || []).length ? `\nBy pipeline (each pipeline is a different part of the business; stages listed in funnel order):\n${pls.filter((p) => p.leads > 0 || p.booked > 0 || p.won > 0 || p.open > 0).map((p) => {
    const bookRate = p.leads ? Math.round((p.booked / p.leads) * 100) : null
    const sits = (p.stages || []).slice(0, 8).map((s) => `${n0(s.open)} at "${s.name}"`).join(', ')
    return `- ${p.name}: ${n0(p.leads)} leads, ${n0(p.booked)} booked${bookRate != null ? ` (${bookRate}% booking rate)` : ''}, ${n0(p.won)} won${p.revenue ? `, $${n0(p.revenue)} revenue` : ''}${p.openValue ? `, $${n0(p.openValue)} still open` : ''}.${sits ? ` Open deals sit (funnel order): ${sits}.` : ''}`
  }).join('\n')}` : ''
  // Ad-set segments (sub-campaigns) — identify the theme from each ad set name.
  const segTop = (segs || []).filter((s) => (s.leads || 0) > 0 || (s.spend || 0) > 0).slice(0, 10)
  const segBlock = segTop.length ? `\nAd set segments (work out the audience/theme from each ad set name, e.g. names containing "Health Professionals", "Borrowing Capacity" and "Buyers Advocacy" are separate segments; group the ad sets into these named segments):\n${segTop.map((s) => `- ${s.name}: $${n0(s.spend)} spend, ${n0(s.leads)} leads${s.booked != null ? `, ${n0(s.booked)} booked` : ''}${s.won ? `, ${n0(s.won)} won` : ''}`).join('\n')}` : ''
  // A sample of notes from leads who did NOT book, for cause detection only.
  const notesBlock = (nbn && nbn.length) ? `\nNotes from a sample of ${nbn.length} leads who did NOT book (use ONLY to detect common themes/causes; summarise the pattern, never quote them verbatim and never use any names):\n${nbn.map((n) => `[${n.pipeline}] ${n.note}`).join('\n')}` : ''
  const prompt = `You are the account manager at Caalano Digital, a marketing agency, writing a results update to a client. Write in Australian English (spelling: optimise, prioritise, colour, enquiry, etc.). Never use em dashes or en dashes; use commas, colons or hyphens.

CRITICAL: Never invent, estimate or add a NUMBER, metric or hard fact that is not explicitly given below. If a figure is n/a or not provided, do not state it. But do NOT just restate the numbers back: interpret them, and draw conclusions and a point of view that follow logically from the data (which audience or ad is performing, where the funnel is getting stuck, what looks worth exploring). Opinions and a clear read are welcome and expected; fabricated figures are not.

STYLE: Write as one real account manager at Caalano Digital who knows this client, emailing them directly. Warm, direct, specific and confident: a sharp operator, not a corporate template. Vary sentence length; short punchy sentences are good. Contractions are fine. Lead with the real story of the period in the first two sentences (the single thing that actually matters), not a summary of every metric. Every number you cite must be followed by what it means for their business, never a bare stat. Have a point of view.

BANNED PHRASES (these make it read like AI or a template; never use them): "I hope this finds you well", "I'm pleased/excited/thrilled to share", "As always", "Rest assured", "moving forward", "Overall", "In summary", "it's worth noting", "at the end of the day", "that said", "delighted to". BANNED WORDS: leverage, robust, delve, streamline, testament, landscape, elevate, unlock, synergy, seamless. No clichés, idioms or sporting/boxing metaphors ("punching above its weight", "moving the needle", "hit the ground running", "smashing it"). When you cite a percentage change, say what it is compared to naturally (for example "up 143% on the last fortnight"). Refer to the time period casually (for example "over the last fortnight", "this past month") and never quote raw dates or say "reporting period".

NOUNS: Do NOT call the client's customers "jobs" (that is trade-specific and wrong for most clients). Use neutral terms: clients, customers, new business, or closed deals; or mirror the client's own terminology from the background context if it is given.

BUDGET: Never assume the ad budget can simply be increased or moved around. Many clients run a fixed budget. Only ever raise a budget change as something to explore together, and only if the client's feedback supports it.

FORMATTING: The email must be plain text that pastes cleanly straight into an email client. Do NOT use any Markdown: no asterisks for bold (no **), no hash symbols for headings, no backticks. Write section headings as plain words on their own line (for example "Quick Summary" then a line break), optionally with a colon. Use a simple hyphen and a space ("- ") for bullet points. The WhatsApp version should be plain text with no formatting symbols at all.

Client business: ${clientName || 'the client'}
Reporting period label (for length only, describe it casually): ${period || 'the selected period'}
${clientContext ? `\nBackground and context about this client (provided by the Caalano team; use it to guide tone, framing, what to emphasise and any relevant mentions, but it does NOT contain metrics - never treat anything here as a number or performance figure, and never contradict the data below):\n"""\n${String(clientContext).slice(0, 2000)}\n"""\n` : ''}
Data:
${lines.join('\n')}${creativeBlock}${pipeBlock}${segBlock}${notesBlock}

ADDITIONAL CONTEXT (geo, appointments, speed to lead, cohorts, forms): the facts above on where leads came from, appointment behaviour, response speed, cohort maturation and top forms are here to deepen your read of the period. Do NOT list every one of these stats and do NOT add new sections for them. Weave in only the ONE or TWO most valuable of these insights, either inside an existing section or as one of the closing questions (for example: a large fast-vs-slow follow-up book-rate gap, a standout region, or a maturation trend that backs up why recent leads have not won yet). Everything else here is for your understanding only.

Produce TWO versions of the same update. Reply in EXACTLY this format and nothing else (no preamble, no JSON, no code fences). Use these literal marker lines so the sections can be separated:
###SUBJECT###
<the email subject line on one line>
###EMAIL###
<the full formal email body, which can span many lines>
###WHATSAPP###
<the casual WhatsApp message, which can span many lines>

EMAIL version: formal and structured with clear headings/bullets. Structure it high level first, then drill down. ${firstName ? `Open with "Hi ${firstName},"` : 'Open with "Hi there,"'} then a one-line intro. Sections in THIS order:
1. "Quick Summary" - fold spend, cost efficiency, leads and booked calls together here with the key movements versus the previous period.${twoChannels ? ' IMPORTANT: both Meta and Google ran this period, so explicitly break out the channel split here (Meta spend and Meta leads; Google spend and Google conversions). Call the Google ones "conversions", not leads, since Google conversions are not always the same as a form lead, and make clear the combined lead figure includes Google conversions, so the client can reconcile against each platform.' : ''}
2. Attendance and Wins - explain attended calls honestly using the appointments breakdown: if attendance looks low, make clear how many calls are still upcoming (not yet happened) and how many were no-shows, and if there is a reporting gap noted above, mention it gently as something for the team to tidy up. For revenue: if there are no wins yet and the average close time note says it is expected for a cohort this recent, say so plainly rather than framing it as bad.
3. Segments - group the ad sets into their named audience segments (e.g. Health Professionals, Borrowing Capacity, Buyers Advocacy) and give a one-line read on how each is performing on leads AND booked calls where booked figures are available. Only mention segments present in the data.
${multiPipe ? '4. Pipelines - a SHORT dedicated section per pipeline (this client runs more than one), each with its leads/bookings/booking rate/wins and, in funnel order, where its open deals are sitting. If a pipeline has no wins, do not gloss over it: cover its leads and bookings and where the deals have got to and are heading.' : '4. Pipeline - cover leads/bookings/wins and, if there are no wins yet, where the open deals have got to in the funnel (in order).'}
5. "Top Performing Ads" - the most granular level, last: list the best individual ads with their leads, cost per lead, booked calls and cost per booked call. This is the ONLY individual-ads section; do not add a separate "what's working" list.
${(nbn && nbn.length) ? '6. If a pipeline or segment has a notably low lead-to-booking rate, add ONE short, tactful observation about the likely cause based on the themes in the non-booker notes (themes only, no names, no quotes).' : ''}
FINAL SECTION - the most important one. Head it naturally (for example "A few things we'd love your take on" or "Over to you"). Do NOT tell the client what we are unilaterally doing next, and do NOT prescribe budget changes. Instead ask 2 or 3 specific, genuine questions, grounded in the data above, that get them to reply:
- Where a segment or ad is showing strong front-end value (cheap leads and booked calls), ask whether those leads and calls are turning into good conversations and quality prospects at their end. Then, only if they are, note that we can look together at whether there is room to lean further into it (never assume the budget can simply be increased; frame it as a joint decision that depends on their answer).
- If there are stalled deals in the data, ask whether there is anything we can do to help move the ones sitting at a particular stage, or get their context on where those are at.
- Optionally, ask how the lead quality has felt for them generally.
Make each question specific to this client's actual numbers, not generic. The point is to earn a reply. Then a short, warm sign-off from the Caalano Digital team (no emojis). Do NOT call their customers "jobs"; if you ask about closed business, say "closed deals" or "new clients".

WHATSAPP version: casual and conversational, like a real text to a client you get on well with. ${firstName ? `Start with "Hey ${firstName},"` : 'Start with "Hey,"'} Shorter than the email: the headline numbers, the best news${twoChannels ? ', noting briefly the leads came across both Meta and Google' : ''}${multiPipe ? ', a brief one-line mention of each pipeline' : ''}${segTop.length ? ', and a quick word on the standout audience/ad' : ''}. If attendance looks low, reassure briefly that some calls are still to come. Plain language, no jargon, no clichés. End with ONE specific question that gets a reply: ideally whether the strong leads are turning into good conversations at their end, or (if deals are stalled) whether we can help nudge the ones sitting idle. Do not assume budget can be increased. Do not call their customers "jobs". NO emojis. Sign off casually from the Caalano Digital team.

Both must be positive but honest: if something dropped, frame it constructively without hiding it. Keep the email under 480 words and the WhatsApp under 150 words.`
  const out = await callClaude(apiKey, prompt)
  // Robust marker-based parse (the email/WhatsApp bodies are multi-line, which
  // makes JSON brittle). Fall back to a JSON parse if markers are absent.
  const raw = String(out.insights || '')
  const sec = (name) => { const m = raw.match(new RegExp(`###\\s*${name}\\s*###([\\s\\S]*?)(?=###\\s*[A-Z]+\\s*###|$)`, 'i')); return m ? m[1].trim() : '' }
  let subject = sec('SUBJECT'), email = sec('EMAIL'), whatsapp = sec('WHATSAPP')
  if (!email && !whatsapp) {
    try { const m = raw.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : null; if (j) { subject = subject || j.subject || ''; email = j.email || ''; whatsapp = j.whatsapp || '' } } catch { /* ignore */ }
  }
  if (!email && !whatsapp) throw new Error('could not parse the generated update')
  return { subject: String(subject || '').slice(0, 200), email: String(email || ''), whatsapp: String(whatsapp || ''), model: out.model, period: period || '', generatedAt: new Date().toISOString() }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'AI insights not configured - add ANTHROPIC_API_KEY in Netlify, then redeploy.' }, 400)
  let body; try { body = await req.json() } catch { return json({ error: 'bad request body' }, 400) }

  // Client Update generator.
  if (body && body.mode === 'client-update') {
    try { return json(await clientUpdate(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Creative Cockpit paths.
  if (body && body.mode === 'creative-tag') {
    try { return json(await creativeTagSuggest(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }
  if (body && body.mode === 'creative-strategy') {
    try { return json(await creativeStrategy(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }
  if (body && body.mode === 'creative-curator') {
    try { return json(await creativeCurator(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Caalano 360 executive summary path.
  if (body && (body.mode === 'exec' || body.health)) {
    try { return json(await execInsights(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  // Caalano360 blended briefing path.
  if (body && (body.mode === 'blend' || body.blend)) {
    try { return json(await blendInsights(apiKey, body)) }
    catch (e) { return json({ error: String(e.message || e) }, 502) }
  }

  const { clientName, weekly, kpis } = body || {}
  if (!weekly || !Array.isArray(weekly.weeks) || !weekly.weeks.length) return json({ error: 'no weekly data supplied' }, 400)

  const W = weekly.weeks
  const rows = W.map((w) => `${w.label}: spend $${w.spend}, leads ${w.leads} (Meta ${w.metaLeads} / Google ${w.googleConv}), booked ${w.booked}, shown ${w.shown}, won ${w.won}, revenue $${w.wonValue}`).join('\n')
  const lost = (weekly.lostReasons || []).slice(0, 12).map((r) => `${r.name} (${r.count})`).join(', ') || 'none recorded'
  const k = kpis || {}
  const targets = `Targets - weekly spend $${k.wkSpend || '-'}, Meta CPL $${k.metaCpl || '-'}, all-leads CPL $${k.cpl || '-'}, cost/booked $${k.cpba || '-'}, CPA $${k.cpa || '-'}, booking rate ${k.bookingRate || '-'}%`
  const weekRange = `${W[0].label}-${W[W.length - 1].label}`
  const prompt = `You are a senior paid-media + CRM analyst at a marketing agency, briefing the account team.

Client: ${clientName || 'Client'}
Weeks (Mon-Sun): ${weekRange}
${targets}

Weekly performance:
${rows}

CRM lost reasons this period: ${lost}

Write a concise briefing in markdown:
1. **Headline** - one sentence on overall health this period.
2. **What's working / slipping** - 3-5 bullets, each citing specific week-over-week numbers (CPL, cost per booked call, booking rate = booked/leads, show rate = shown/booked, win rate, and spend pacing vs target).
3. **Lost-reason read** - 1-2 bullets on what the lost reasons suggest and how to address them.
4. **Actions** - 2-3 concrete next steps for next week.

Be specific and numeric, reference the weeks by label (e.g. W27), and keep it under 300 words. Do not use em-dashes or en-dashes anywhere; use commas, colons or hyphens instead.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: (j.error && j.error.message) || `AI error ${r.status}` }, 502)
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
    if (!text) return json({ error: 'empty AI response' }, 502)
    return json({ insights: text, weekRange, model: j.model || 'claude-sonnet-5', generatedAt: new Date().toISOString() })
  } catch (e) { return json({ error: String(e.message || e) }, 502) }
}
