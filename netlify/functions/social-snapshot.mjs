// Daily organic-social snapshot. Captures each connected client's Instagram +
// Facebook-organic daily metrics, follower count and audience demographics into
// the `caalano-social` blob store, so the data survives once it falls outside the
// Meta/IG API's ~90-day insights window (and followers/demographics, which are
// "now only"). The Organic Social dashboard auto-fills gaps from this store.
//
// Scheduled functions can't be invoked over HTTP; use the companion
// `social-snapshot-now` endpoint to run it on demand (and to seed the backfill).
import { runSocialSnapshots } from './windsor.mjs'

export const config = { schedule: '@daily' }

export default async () => {
  try { return Response.json(await runSocialSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
