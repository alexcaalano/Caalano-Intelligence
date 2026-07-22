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

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'AI insights not configured - add ANTHROPIC_API_KEY in Netlify, then redeploy.' }, 400)
  let body; try { body = await req.json() } catch { return json({ error: 'bad request body' }, 400) }

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
