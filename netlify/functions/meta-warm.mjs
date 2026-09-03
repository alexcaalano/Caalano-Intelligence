// Scheduled trigger for the view warmer. Every ten minutes it asks the
// background function to walk the roster; it does none of the work itself.
//
// It used to. A scheduled function has the same ~26s ceiling as any other, and
// walking every client sequentially - three builds of ~8s each - was cut off
// after the second or third client, every run, forever. The clients that sorted
// first were always warm; the rest never were. The background function has a
// 15-minute ceiling and warms stalest-first, so a full pass actually completes.
//
// With no site URL (local dev) there is no background function to call, so it
// falls back to a single in-process pass, which is what it always was.
import { triggerWarm } from '../lib/warm.mjs'
export const config = { schedule: '*/10 * * * *' }
export default async () => {
  const t = await triggerWarm({ plan: 'full' })
  if (t.triggered) return Response.json({ ok: true, ...t })
  const { default: run } = await import('./warm-background.mjs')
  const { warmToken } = await import('../lib/warm.mjs')
  const r = await run(new Request('https://local/.netlify/functions/warm-background', { method: 'POST', headers: { 'x-warm-token': warmToken() || '' }, body: JSON.stringify({ plan: 'full' }) }))
  return Response.json({ ok: r.ok, inline: true, trigger: t, ...(await r.json().catch(() => ({}))) })
}
