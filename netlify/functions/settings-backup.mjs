// Automatic backup of the live settings (Netlify Blobs) to the GitHub repo.
//
// The CODE is already backed up on GitHub every time it's pushed. The thing that
// ISN'T in git is the app's live configuration - key events, KPI targets, client
// mappings, form meta, working hours, sales-cycle overrides, AI briefings - which
// lives in Netlify Blobs (the `caalano-settings` store). This function snapshots
// that blob to the repo on a schedule so it can't be lost.
//
// Runs daily (see `config.schedule`). Also callable on demand via HTTPS to test.
// Requires two Netlify environment variables (Site settings -> Environment):
//   BACKUP_GH_TOKEN  - a GitHub token with `contents:write` on the repo
//                      (fine-grained PAT scoped to just this repo is ideal)
//   BACKUP_GH_REPO   - "owner/name", e.g. "alexcaalano/Caalano-Intelligence"
//   BACKUP_GH_BRANCH - optional, defaults to "main"
// Without the token/repo it safely no-ops (so it never errors the deploy).
import { getStore } from '@netlify/blobs'

export const config = { schedule: '@daily' }

const GH = 'https://api.github.com'
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export default async () => {
  const token = process.env.BACKUP_GH_TOKEN
  const repo = process.env.BACKUP_GH_REPO
  if (!token || !repo) return json({ ok: false, skipped: true, reason: 'Set BACKUP_GH_TOKEN and BACKUP_GH_REPO env vars to enable settings backups.' })
  const auth = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json', 'User-Agent': 'caalano360-backup' })
  try {
    // Target branch: BACKUP_GH_BRANCH if set, else the repo's actual default
    // branch (this repo's default is the working branch, not "main").
    let branch = process.env.BACKUP_GH_BRANCH
    if (!branch) { const rr = await fetch(`${GH}/repos/${repo}`, { headers: auth() }); branch = rr.ok ? (await rr.json()).default_branch : 'main' }
    const data = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' }).catch(() => null)
    const body = JSON.stringify(data || {}, null, 2)
    const content = Buffer.from(body, 'utf8').toString('base64')
    const ts = new Date().toISOString()
    const day = ts.slice(0, 10)
    // Write a file: fetch its current sha (if any) so we update rather than fail.
    const put = async (path, message) => {
      let sha
      const g = await fetch(`${GH}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${branch}`, { headers: auth() })
      if (g.ok) { const j = await g.json(); sha = j.sha }
      const r = await fetch(`${GH}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, { method: 'PUT', headers: auth(), body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }) })
      if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    }
    // A stable "latest" file (easy to diff) + a dated snapshot (history).
    await put('backups/settings-latest.json', `chore(backup): settings ${ts}`)
    await put(`backups/daily/settings-${day}.json`, `chore(backup): settings snapshot ${day}`)
    return json({ ok: true, backedUp: true, at: ts, bytes: body.length })
  } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, 500) }
}
