// On-demand clinic snapshot - the HTTP-invokable twin of the daily scheduled
// `clinic-snapshot` function. Visit /.netlify/functions/clinic-snapshot-now to
// record today's point for every clinic client immediately (useful to seed the
// history the day a new clinic comes online).
import { runClinicSnapshots } from './windsor.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'

export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  try { return Response.json(await runClinicSnapshots()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
