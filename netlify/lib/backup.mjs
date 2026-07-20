// Shared settings-backup logic, used by both the daily scheduled function
// (settings-backup) and the on-demand endpoint (settings-backup-now).
// Snapshots the live settings blob to the GitHub repo under backups/.
import { getStore } from '@netlify/blobs'

const GH = 'https://api.github.com'

export async function backupSettings() {
  const token = process.env.BACKUP_GH_TOKEN
  const repo = process.env.BACKUP_GH_REPO
  if (!token || !repo) return { ok: false, skipped: true, reason: 'Set BACKUP_GH_TOKEN and BACKUP_GH_REPO env vars to enable settings backups.' }
  const auth = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json', 'User-Agent': 'caalano360-backup' })
  // Target branch: BACKUP_GH_BRANCH if set, else the repo's actual default branch
  // (this repo's default is the working branch, not "main").
  let branch = process.env.BACKUP_GH_BRANCH
  if (!branch) { const rr = await fetch(`${GH}/repos/${repo}`, { headers: auth() }); branch = rr.ok ? (await rr.json()).default_branch : 'main' }
  const data = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }).catch(() => null)
  const body = JSON.stringify(data || {}, null, 2)
  const content = Buffer.from(body, 'utf8').toString('base64')
  const ts = new Date().toISOString()
  const day = ts.slice(0, 10)
  const put = async (path, message) => {
    const url = `${GH}/repos/${repo}/contents/${path}`
    let sha
    const g = await fetch(`${url}?ref=${branch}`, { headers: auth() })
    if (g.ok) { const j = await g.json(); sha = j.sha }
    const r = await fetch(url, { method: 'PUT', headers: auth(), body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }) })
    if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  }
  // A stable "latest" file (easy to diff) + a dated snapshot (history).
  await put('backups/settings-latest.json', `chore(backup): settings ${ts}`)
  await put(`backups/daily/settings-${day}.json`, `chore(backup): settings snapshot ${day}`)
  return { ok: true, backedUp: true, at: ts, bytes: body.length, branch }
}
