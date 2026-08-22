// Scheduled ad-tab warmer. Every ~10 minutes it pre-builds each client's payload for
// the common rolling ranges into the result cache, so opening the Meta Ads / Google
// Ads / Caalano360 tabs is a warm-cache hit instead of a cold multi-query Windsor
// (+ GHL) fan-out. That cold fan-out is what makes the first load slow and, when an
// upstream call is slow that minute, occasionally tips past the 10s function budget
// and fails. Meta is warmed for last 7 + 30 days; Google + the Caalano360 blend for
// last 30 days. Keeping the common ranges hot moves that cost off the user path.
//
// Scheduled functions can't be invoked over HTTP in production; use the companion
// `meta-warm-now` endpoint to run it on demand and watch the result.
import { runMetaWarm } from './windsor.mjs'

export const config = { schedule: '*/10 * * * *' }

export default async () => {
  try { return Response.json(await runMetaWarm()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
