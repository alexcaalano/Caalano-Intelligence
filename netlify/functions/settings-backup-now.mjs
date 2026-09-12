// On-demand backup - the HTTP twin of the daily scheduled `settings-backup`
// (scheduled functions can't be triggered over HTTP). Open
// /.netlify/functions/settings-backup-now as a superadmin: it starts a backup
// in the background and shows the last run's result. Reload to see it finish.
//   ?status=1   only show the last run, do not start another
import { readBackupStatus, triggerBackup } from '../lib/backup.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'
import { warmToken } from '../lib/warm.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const when = (iso) => { const ms = Date.now() - Date.parse(iso || 0); if (!isFinite(ms)) return 'never'; const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }

export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  const url = new URL(req.url)
  const statusOnly = url.searchParams.get('status') === '1'
  const configured = !!(process.env.BACKUP_GH_TOKEN && process.env.BACKUP_GH_REPO)
  const before = await readBackupStatus()
  let started = null
  const runningRecently = before && before.state === 'running' && Date.now() - Date.parse(before.startedAt || 0) < 20 * 60000
  if (configured && !statusOnly && !runningRecently) started = await triggerBackup(warmToken())
  const last = started && started.triggered ? { state: 'running', startedAt: new Date().toISOString() } : before
  if (url.searchParams.get('format') === 'json') return Response.json({ ok: true, configured, started, last })

  const lines = []
  if (!configured) lines.push('<p class="bad">Not set up: BACKUP_GH_TOKEN and BACKUP_GH_REPO are not both set in Netlify, so the daily backup does nothing.</p>')
  else if (started && started.triggered) lines.push('<p class="ok">Backup started. It usually takes under a minute. <a href="?status=1">Reload this page</a> to see the result.</p>')
  else if (started && !started.triggered) lines.push(`<p class="bad">Could not start the backup: ${esc(started.reason || started.status)}</p>`)
  else if (runningRecently) lines.push(`<p>A backup is running now (started ${when(before.startedAt)}). <a href="?status=1">Reload</a> in a minute.</p>`)
  if (!last) lines.push('<p>No backup has run on this site yet.</p>')
  else if (last.state === 'running') lines.push(`<p>Last run: started ${when(last.startedAt)}, still running.</p>`)
  else if (last.state === 'ok') {
    const r = last.result || {}
    lines.push(`<p class="ok">Last backup succeeded ${when(last.finishedAt)}: ${r.files || 0} files, ${Math.round((r.bytes || 0) / 1024)} KB, ${r.stores ? r.stores.length : 0} stores, ${r.mode === 'commit' ? 'one commit' : 'one file at a time'}${r.commit ? ` (${esc(String(r.commit).slice(0, 7))})` : ''} to <code>${esc(r.repo)}</code> branch <code>${esc(r.branch)}</code> in ${Math.round((r.ms || 0) / 1000)} s.</p>`)
    if (r.stores) lines.push('<ul>' + r.stores.map((s) => `<li>${esc(s.store)}: ${s.keys} keys${s.cutShort ? ' (cut short, partial)' : ''}</li>`).join('') + '</ul>')
    if (r.errors && r.errors.length) lines.push(`<p class="bad">Stores that failed: ${esc(r.errors.join('; '))}</p>`)
    if (r.fallbackReason) lines.push(`<p>Single-commit path failed and it fell back to file-by-file: ${esc(r.fallbackReason)}</p>`)
  } else if (last.state === 'skipped') lines.push(`<p class="bad">Last run was skipped: ${esc((last.result || {}).reason)}</p>`)
  else if (last.state === 'error') lines.push(`<p class="bad">Last run failed ${when(last.finishedAt)}: ${esc(last.error)}</p>`)
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Caalano360 backup</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2430}h1{font-size:20px}.ok{color:#136f3a}.bad{color:#a12626}code{background:#f0f1f4;padding:1px 4px;border-radius:3px}a{color:#1f4fbf}</style>
<h1>Daily backup to GitHub</h1>${lines.join('\n')}<p><a href="?">Run a backup now</a> · <a href="?status=1">Just show status</a></p>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
