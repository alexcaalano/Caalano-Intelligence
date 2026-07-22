// Daily executive-health snapshot. Computes a fixed trailing-30-day health score
// for every client and appends today's point to the `caalano-health` blob, so
// the Caalano 360 executive tab builds a real score trend from launch forward.
//
// Scheduled functions can't be invoked over HTTP in production; use the
// companion `health-snapshot-now` endpoint to run it on demand.
import { runHealthSnapshots } from './windsor.mjs'

export const config = { schedule: '@daily' }

export default async () => {
  try { return Response.json(await runHealthSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
