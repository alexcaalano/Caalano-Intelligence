// On-demand twin of the scheduled `opp-warm`: refreshes every CRM client's
// opportunity snapshot in the background right now and reports the last
// completed pass. Superadmin only.
import { triggerWarm, readWarmLast, readWarmLock } from '../lib/warm.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'
export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  const [trigger, last, lock] = await Promise.all([triggerWarm({ plan: 'opps' }), readWarmLast(), readWarmLock()])
  return Response.json({ trigger, running: lock ? { since: new Date(lock.at).toISOString(), plan: lock.plan } : null, last })
}
