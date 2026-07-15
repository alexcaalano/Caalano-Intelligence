// On-demand AI insights for the Weekly Traffic Light. Called only when the user
// clicks "Generate" (never on load), so credit use is deliberate. Receives the
// already-computed weekly payload from the browser and asks Claude to interpret
// the Meta + Google performance against the CRM outcomes / lost reasons.
// Requires ANTHROPIC_API_KEY in Netlify env.
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'AI insights not configured - add ANTHROPIC_API_KEY in Netlify, then redeploy.' }, 400)
  let body; try { body = await req.json() } catch { return json({ error: 'bad request body' }, 400) }
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
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: (j.error && j.error.message) || `AI error ${r.status}` }, 502)
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
    if (!text) return json({ error: 'empty AI response' }, 502)
    return json({ insights: text, weekRange, model: j.model || 'claude-sonnet-5', generatedAt: new Date().toISOString() })
  } catch (e) { return json({ error: String(e.message || e) }, 502) }
}
