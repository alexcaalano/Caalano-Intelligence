// Daily automatic backup of the live settings (Netlify Blobs) to a GitHub repo.
//
// The CODE is already backed up on GitHub every push. What ISN'T in git is the
// app's live configuration - key events, KPI targets, client mappings, form
// meta, working hours, users, terms acceptances, health and report history -
// which lives in Netlify Blobs. This snapshots every store to the repo under
// backups/ daily, as one commit.
//
// The work itself runs in `settings-backup-background` (15-minute ceiling);
// this scheduled function only kicks it. Use `settings-backup-now` to run and
// check on demand. Requires two Netlify env vars:
//   BACKUP_GH_TOKEN  - GitHub token with Contents: read & write on the repo
//   BACKUP_GH_REPO   - "owner/name", e.g. "alexcaalano/caalano360-backups"
//   BACKUP_GH_BRANCH - optional; defaults to the repo's default branch
// Without the token/repo it safely no-ops.
import { runBackupJob, triggerBackup } from '../lib/backup.mjs'
import { warmToken } from '../lib/warm.mjs'

export const config = { schedule: '@daily' }

export default async () => {
  if (!process.env.BACKUP_GH_TOKEN || !process.env.BACKUP_GH_REPO) return Response.json({ ok: false, skipped: true, reason: 'BACKUP_GH_TOKEN / BACKUP_GH_REPO not set' })
  const t = await triggerBackup(warmToken())
  if (t.triggered) return Response.json({ ok: true, started: true })
  // No site URL to call ourselves on (local dev): do it inline.
  return Response.json(await runBackupJob())
}
