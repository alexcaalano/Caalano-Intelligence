// Daily automatic backup of the live settings (Netlify Blobs) to the GitHub repo.
//
// The CODE is already backed up on GitHub every push. What ISN'T in git is the
// app's live configuration - key events, KPI targets, client mappings, form
// meta, working hours, sales-cycle overrides, AI briefings - which lives in the
// `caalano-settings` blob. This snapshots it to the repo under backups/ daily.
//
// Scheduled functions can't be invoked over HTTP in production - use the
// companion `settings-backup-now` endpoint to test on demand. Requires two
// Netlify env vars (Site configuration -> Environment variables):
//   BACKUP_GH_TOKEN  - GitHub token with Contents: read & write on the repo
//   BACKUP_GH_REPO   - "owner/name", e.g. "alexcaalano/Caalano-Intelligence"
//   BACKUP_GH_BRANCH - optional; defaults to the repo's default branch
// Without the token/repo it safely no-ops.
import { backupSettings } from '../lib/backup.mjs'

export const config = { schedule: '@daily' }

export default async () => {
  try { const r = await backupSettings(); return Response.json(r) }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 }) }
}
