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
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: prompt }] }),
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
  const { clientName, firstName, period, kpis: k = {}, channels: ch = {}, forecast: fc = {}, creatives: cr = [], pipelines: pls = [], segments: segs = [] } = body
  const pv = k.prev || {}
  const delta = (cur, prev, lowerBetter) => { if (cur == null || prev == null || !prev) return ''; const pc = Math.round(((cur - prev) / prev) * 100); const better = lowerBetter ? pc < 0 : pc > 0; return ` (${pc >= 0 ? 'up' : 'down'} ${Math.abs(pc)}% vs previous period, ${better ? 'good' : 'worse'})` }
  const lines = []
  lines.push(`Ad spend $${n0(k.adSpend)}${delta(k.adSpend, pv.adSpend, false)} (Meta $${n0(ch.metaSpend)}, Google $${n0(ch.googleSpend)})`)
  lines.push(`Leads ${n0(k.leads)}${delta(k.leads, pv.leads, false)}`)
  lines.push(`Booked calls ${n0(k.booked)}${delta(k.booked, pv.booked, false)}`)
  if (k.shown != null) lines.push(`Attended / shown ${n0(k.shown)}${delta(k.shown, pv.shown, false)}`)
  lines.push(`Deals won ${n0(k.won)}${delta(k.won, pv.won, false)}, revenue $${n0(k.revenue)}${delta(k.revenue, pv.revenue, false)}`)
  if (k.avgDeal) lines.push(`Average deal value $${n0(k.avgDeal)}`)
  lines.push(`Cost per lead $${n0(k.cpl)}, cost per booked call ${k.cpBooked != null ? '$' + n0(k.cpBooked) : 'n/a'}, cost per won ${k.cpWon != null ? '$' + n0(k.cpWon) : 'n/a'}`)
  if (k.openValue) lines.push(`Open pipeline value right now $${n0(k.openValue)}`)
  if (fc && fc.projectedRevenue != null && fc.elapsedPct != null && fc.elapsedPct < 100) lines.push(`On current run rate this period projects to about $${n0(fc.projectedRevenue)} revenue and ${n0(fc.projectedLeads)} leads`)
  // Best-performing creatives (ads) for the period, so the update can call them out.
  const topCreatives = (cr || []).slice(0, 4).map((c) => `${c.name} (${c.format || 'ad'}): ${n0(c.leads)} leads, ${n0(c.booked)} booked calls`)
  const creativeBlock = topCreatives.length ? `\nBest performing ads this period (highest lead and booking volume):\n${topCreatives.join('\n')}` : ''
  // Per-pipeline funnels + where open deals are sitting.
  const multiPipe = (pls || []).filter((p) => p.leads > 0 || p.booked > 0 || p.won > 0).length > 1
  const pipeBlock = (pls || []).length ? `\nBy pipeline (each pipeline is a different part of the business):\n${pls.filter((p) => p.leads > 0 || p.booked > 0 || p.won > 0 || p.open > 0).map((p) => {
    const sits = (p.stages || []).slice().sort((a, b) => b.open - a.open).slice(0, 6).map((s) => `${n0(s.open)} at "${s.name}"`).join(', ')
    return `- ${p.name}: ${n0(p.leads)} leads, ${n0(p.booked)} booked, ${n0(p.won)} won${p.revenue ? `, $${n0(p.revenue)} revenue` : ''}${p.openValue ? `, $${n0(p.openValue)} still open in the pipeline` : ''}.${sits ? ` Open deals are currently sitting: ${sits}.` : ''}`
  }).join('\n')}` : ''
  // Ad-set segments (sub-campaigns) — identify the theme from each ad set name.
  const segTop = (segs || []).filter((s) => (s.leads || 0) > 0 || (s.spend || 0) > 0).slice(0, 8)
  const segBlock = segTop.length ? `\nAd set segments / sub-campaigns (work out the audience or theme from each ad set name, e.g. two names containing "Health Professionals" and "Borrowing Capacity" are two segments):\n${segTop.map((s) => `- ${s.name}: $${n0(s.spend)} spend, ${n0(s.leads)} leads${s.booked != null ? `, ${n0(s.booked)} booked` : ''}${s.won ? `, ${n0(s.won)} won` : ''}`).join('\n')}` : ''
  const prompt = `You are the account manager at Caalano Digital, a marketing agency, writing a results update to a client for a reporting period. Write in Australian English (spelling: optimise, prioritise, colour, etc.). Never use em dashes or en dashes; use commas, colons or hyphens.

CRITICAL: Use ONLY the figures and facts provided below. Do NOT invent, estimate, extrapolate or add any number, metric, claim or insight that is not explicitly given. Do not speculate about causes or make up context. If a figure is marked n/a or is not provided, do not mention it. Every statement you make must be directly supported by the data below.

Client business: ${clientName || 'the client'}
Client first name: ${firstName || '(none given)'}
Reporting period: ${period || 'the selected period'}

Reporting period label: ${period || 'the selected period'}

Results:
${lines.join('\n')}${creativeBlock}${pipeBlock}${segBlock}

Refer to the time period casually and naturally so it reads like a human wrote it (for example "over the last month", "this past fortnight", "in the last few weeks"). Do NOT quote the raw dates or say "reporting period".

Produce TWO versions of the same update and reply with ONLY a JSON object, no prose outside it, shaped exactly:
{"subject":"<email subject line>","email":"<full formal email body>","whatsapp":"<casual WhatsApp message>"}

Email version: formal and structured. ${firstName ? `Open with "Hi ${firstName},"` : 'Open with "Hi there,"'} Then a short intro, then clearly grouped results (short headings or bullets) covering: spend and cost efficiency; lead and booking generation; revenue/wins; and a short "top performing ads" callout (only if ad data is provided). Call out notable movements versus the previous period.
${multiPipe ? 'This client runs MORE THAN ONE pipeline. Give a SHORT dedicated section for EACH pipeline listed above, using its name, covering that pipeline\'s leads/bookings/wins AND, importantly, where its open deals have got to (name the stages deals are sitting at). If a pipeline has no wins yet, do not gloss over it: say how many leads and bookings it produced and where those deals are now sitting in the funnel and heading next.' : 'If there are no wins yet, do not gloss over it: explain how many leads and bookings came through and where those deals have got to in the funnel (which stages they are sitting at).'}
${segTop.length ? 'Add a short "what\'s working in the ads" note: identify the sub-campaign segments from the ad set names above and give a one-line insight on how each key segment performed (e.g. which audience is driving the most leads or bookings). Only mention segments in the data.' : ''}
Then invite the client to share feedback: how the lead quality has been, how the business is tracking on their end, and any wins or closed jobs we should know about. Finish with a brief forward-looking line and sign off from the Caalano Digital team. Professional, confident, warm. No emojis.

WhatsApp version: casual and conversational, like a real text to a client you get on well with. ${firstName ? `Start with "Hey ${firstName},"` : 'Start with "Hey,"'} Shorter than the email: hit the headline numbers and the best news${multiPipe ? ', mention each pipeline briefly in a sentence (do not do a full breakdown)' : ''}${segTop.length ? ', and a quick word on the standout ad or audience if it stands out' : ''}. Plain language, no jargon. End by asking how the leads have been on their end and if they have had any wins lately. NO emojis. Sign off casually from the Caalano Digital team.

Both must be positive but honest: if something went down, frame it constructively without hiding it. Keep the email under 420 words and the WhatsApp under 150 words.`
  const out = await callClaude(apiKey, prompt)
  let parsed = null
  try { const m = out.insights.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null } catch { parsed = null }
  if (!parsed || (!parsed.email && !parsed.whatsapp)) throw new Error('could not parse the generated update')
  return { subject: String(parsed.subject || '').slice(0, 200), email: String(parsed.email || ''), whatsapp: String(parsed.whatsapp || ''), model: out.model, period: period || '', generatedAt: new Date().toISOString() }
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
