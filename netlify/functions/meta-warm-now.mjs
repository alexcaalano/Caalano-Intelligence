// On-demand Meta warmer - the HTTP-invokable twin of the scheduled `meta-warm`
// function (scheduled functions can't be triggered over HTTP). Visit
// /.netlify/functions/meta-warm-now to pre-build every Meta client's last-7d / last-30d
// payload into the result cache immediately and see how many ranges each warmed.
// Owner-guarded. Note: warming every client can exceed the 10s HTTP budget, so a
// manual run may return partial results - the scheduled run has the full budget.
import { runMetaWarm } from './windsor.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'

export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  try { return Response.json(await runMetaWarm()) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
