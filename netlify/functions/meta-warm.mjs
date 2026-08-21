// Scheduled Meta warmer. Every ~10 minutes it pre-builds each Meta client's payload
// for the common rolling ranges (last 7 / 30 days) into the result cache, so opening
// the Meta Ads tab is a warm-cache hit instead of a cold 8-query Windsor fan-out.
// That cold fan-out is what makes the first Meta load slow and, when one of the eight
// parallel Windsor calls is slow that minute, occasionally tips past the 10s function
// budget and fails. Keeping the common ranges hot moves that cost off the user path.
//
// Scheduled functions can't be invoked over HTTP in production; use the companion
// `meta-warm-now` endpoint to run it on demand and watch the result.
import { runMetaWarm } from './windsor.mjs'

export const config = { schedule: '*/10 * * * *' }

export default async () => {
  try { return Response.json(await runMetaWarm()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
