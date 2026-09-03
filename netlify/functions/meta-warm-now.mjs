// On-demand twin of the scheduled `meta-warm`: kicks off a full roster pass in
// the background right now and reports what the LAST completed pass did.
// Superadmin only. The pass takes a few minutes; call again to see it land.
import { triggerWarm, readWarmLast, readWarmLock } from '../lib/warm.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'
export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  const [trigger, last, lock] = await Promise.all([triggerWarm({ plan: 'full' }), readWarmLast(), readWarmLock()])
  return Response.json({ trigger, running: lock ? { since: new Date(lock.at).toISOString(), plan: lock.plan } : null, last })
}
