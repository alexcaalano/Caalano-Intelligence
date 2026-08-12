// On-demand organic-social snapshot — the HTTP-invokable twin of the daily
// scheduled `social-snapshot` function. Visit /.netlify/functions/social-snapshot-now
// to capture today's metrics for every connected client immediately; the first
// run per client also backfills ~90 days of whatever the API still returns.
import { runSocialSnapshots } from './windsor.mjs'

export default async () => {
  try { return Response.json(await runSocialSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
