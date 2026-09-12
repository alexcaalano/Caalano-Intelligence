// The daily backup, as a Netlify BACKGROUND function: the `-background` suffix
// gives it a 15-minute ceiling instead of ~10s and makes the platform answer
// the caller with a 202 at once. Fired by the scheduled `settings-backup` and
// by `settings-backup-now`; both just trigger this and return. Guarded by the
// same shared token the warmer uses, so only the site itself can start it.
import { runBackupJob } from '../lib/backup.mjs'
import { isWarmRequest } from '../lib/warm.mjs'

export default async (req) => {
  if (!isWarmRequest(req)) return new Response('forbidden', { status: 403 })
  const r = await runBackupJob()
  return Response.json(r)
}
