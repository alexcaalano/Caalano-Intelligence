// On-demand opportunity-snapshot warmer - the HTTP-invokable twin of the scheduled
// `opp-warm` function (scheduled functions can't be triggered over HTTP). Visit
// /.netlify/functions/opp-warm-now to warm every CRM client's opportunity snapshot
// immediately and see how many opps each holds.
import { runOppWarm } from './windsor.mjs'

export default async () => {
  try { return Response.json(await runOppWarm()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
