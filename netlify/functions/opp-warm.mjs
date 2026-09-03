// Scheduled trigger for the opportunity-snapshot warmer. Every five minutes it
// asks the background function to refresh each CRM client's shared
// /opportunities/search snapshot (Blobs, 15-min TTL), so the interactive scopes
// read a warm page instead of each re-paging GoHighLevel - those concurrent
// cold pulls were the source of nearly every 429 in the reliability log.
//
// The refresh itself used to run here, budgeted at ten minutes on the belief
// that a scheduled function had a long ceiling. It has the same ~26s as any
// other, so the pass was killed after a couple of clients every time. It now
// runs where the ten minutes are real. Local dev falls back to running inline.
import { triggerWarm } from '../lib/warm.mjs'
export const config = { schedule: '*/5 * * * *' }
export default async () => {
  const t = await triggerWarm({ plan: 'opps' })
  if (t.triggered) return Response.json({ ok: true, ...t })
  const { default: run } = await import('./warm-background.mjs')
  const { warmToken } = await import('../lib/warm.mjs')
  const r = await run(new Request('https://local/.netlify/functions/warm-background', { method: 'POST', headers: { 'x-warm-token': warmToken() || '' }, body: JSON.stringify({ plan: 'opps' }) }))
  return Response.json({ ok: r.ok, inline: true, trigger: t, ...(await r.json().catch(() => ({}))) })
}
