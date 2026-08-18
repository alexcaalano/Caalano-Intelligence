// On-demand executive-health snapshot - the HTTP-invokable twin of the daily
// scheduled `health-snapshot` function (scheduled functions can't be triggered
// over HTTP). Visit /.netlify/functions/health-snapshot-now to compute today's
// trailing-30-day health point for every client immediately.
import { runHealthSnapshots } from './windsor.mjs'

export default async () => {
  try { return Response.json(await runHealthSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
