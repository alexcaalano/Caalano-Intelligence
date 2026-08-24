// Daily clinic snapshot. The practice-management sync overwrites each contact's
// stats on every run, so the CRM only ever holds "now" - there is no history to
// read back. This appends today's aggregate for every clinic client to the
// `caalano-clinic` blob, which is what lets the Clinic tab show real period
// revenue (lifetime spend is cumulative, so the difference between two days is
// the revenue booked between them) and genuine rate trends.
//
// Scheduled functions can't be invoked over HTTP in production; use the
// companion `clinic-snapshot-now` endpoint to run it on demand.
import { runClinicSnapshots } from './windsor.mjs'

export const config = { schedule: '@daily' }

export default async () => {
  try { return Response.json(await runClinicSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
