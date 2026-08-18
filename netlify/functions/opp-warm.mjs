// Scheduled opportunity-snapshot warmer. Every ~5 minutes it refreshes each CRM
// client's shared /opportunities/search snapshot (Blobs, 15-min TTL) so the
// interactive scopes (users / ccdrill / speed / appts / forms / health) read the
// warm cache instead of each re-paging GHL. That endpoint's concurrent cold pulls
// are the source of nearly every 429 in the reliability log; keeping the snapshot
// hot moves those pulls off the user path.
//
// Scheduled functions can't be invoked over HTTP in production; use the companion
// `opp-warm-now` endpoint to run it on demand and watch the result.
import { runOppWarm } from './windsor.mjs'

export const config = { schedule: '*/5 * * * *' }

export default async () => {
  try { return Response.json(await runOppWarm()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
