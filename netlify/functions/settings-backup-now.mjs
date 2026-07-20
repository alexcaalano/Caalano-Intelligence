// On-demand settings backup — the HTTP-invokable twin of the daily scheduled
// `settings-backup` function (scheduled functions can't be triggered over HTTP).
// Visit /.netlify/functions/settings-backup-now to run a backup immediately and
// confirm the GitHub token / repo env vars are set up correctly.
import { backupSettings } from '../lib/backup.mjs'

export default async () => {
  try { const r = await backupSettings(); return Response.json(r) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
