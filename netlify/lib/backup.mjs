// Backups of what lives ONLY in Netlify Blobs.
//
// The code is on GitHub with every push. What is not in git is everything the
// app has written since: its configuration, its users and their terms
// acceptances, and the history it has been accumulating - health scores,
// monthly report snapshots, social and clinic snapshots - which cannot be
// regenerated. This used to back up one store (settings). It backs up every
// store that matters now, and can also hand a superadmin the whole lot as one
// download, so a backup never depends on a GitHub token being set.
import { getStore } from '@netlify/blobs'

const GH = 'https://api.github.com'

// Every store, and whether it is worth keeping. Caches and warm state rebuild
// themselves; the rest is either configuration, identity, or history.
export const BACKUP_STORES = [
  { name: 'caalano-settings', what: 'Configuration: key events, KPIs, mappings, hours, geo, forecasts, everything in Settings' },
  { name: 'caalano-auth', what: 'Users, roles, invites, sessions' },
  { name: 'caalano-terms', what: 'Terms-of-use acceptances' },
  { name: 'caalano-health', what: 'Health score history per client' },
  { name: 'caalano-monthly', what: 'Monthly report snapshots' },
  { name: 'caalano-social', what: 'Organic social snapshots' },
  { name: 'caalano-clinic', what: 'Clinic snapshots' },
  { name: 'caalano-audit', what: 'Who opened what, when' },
  { name: 'caalano-diag', what: 'Reliability log', cap: 4000 },
  { name: 'meta-webhooks', what: 'Meta creative-fatigue verdicts' },
  { name: 'caalano-speedscan', what: 'Speed-to-lead scan state' },
]
// Holds the Caalano Systems OAuth tokens. Never written to GitHub; included in
// the manual download only when explicitly asked for, so it can be kept where
// secrets are kept and nowhere else.
export const SECRET_STORES = [{ name: 'ghl-auth', what: 'Caalano Systems agency OAuth token' }]
const NOT_BACKED_UP = ['caalano-cache', 'caalano-oppcache', 'caalano-pipecache', 'caalano-warm', 'caalano-auth-throttle']

// One store -> { key: value }. Values are JSON where they parse and text where
// they do not, so nothing is dropped for being an unexpected shape.
async function dumpStore(name, cap = 20000) {
  const store = getStore({ name, consistency: 'strong' })
  const out = {}
  let cursor, n = 0, truncated = false
  do {
    const page = await store.list({ cursor })
    for (const b of page.blobs || []) {
      if (n >= cap) { truncated = true; break }
      const txt = await store.get(b.key, { type: 'text' }).catch(() => null)
      if (txt == null) continue
      try { out[b.key] = JSON.parse(txt) } catch { out[b.key] = { _text: txt } }
      n++
    }
    cursor = truncated ? null : page.cursor
  } while (cursor)
  return { keys: n, truncated, data: out }
}

// Everything, as one object. `includeSecrets` adds the token store.
export async function collectBackup({ includeSecrets = false } = {}) {
  const at = new Date().toISOString()
  const stores = {}
  const list = includeSecrets ? [...BACKUP_STORES, ...SECRET_STORES] : BACKUP_STORES
  for (const s of list) {
    try { stores[s.name] = { what: s.what, ...(await dumpStore(s.name, s.cap)) } }
    catch (e) { stores[s.name] = { what: s.what, error: String((e && e.message) || e).slice(0, 200), keys: 0, data: {} } }
  }
  return { format: 'caalano360-backup/2', at, site: process.env.URL || null, includesSecrets: includeSecrets, notBackedUp: NOT_BACKED_UP, stores }
}

// The scheduled path: every non-secret store to the GitHub repo, as one file
// per store under a dated folder plus a stable "latest" copy that is easy to
// diff. Skips cleanly when the token is not configured - and says so, so the
// -now endpoint can tell you the daily job has never actually run.
export async function backupSettings() {
  const token = process.env.BACKUP_GH_TOKEN
  const repo = process.env.BACKUP_GH_REPO
  if (!token || !repo) return { ok: false, skipped: true, reason: 'Set BACKUP_GH_TOKEN and BACKUP_GH_REPO env vars to enable backups to GitHub. Until then use backup-export to download one by hand.' }
  const auth = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json', 'User-Agent': 'caalano360-backup' })
  let branch = process.env.BACKUP_GH_BRANCH
  if (!branch) { const rr = await fetch(`${GH}/repos/${repo}`, { headers: auth() }); branch = rr.ok ? (await rr.json()).default_branch : 'main' }
  const put = async (path, body, message) => {
    const url = `${GH}/repos/${repo}/contents/${path}`
    let sha
    const g = await fetch(`${url}?ref=${branch}`, { headers: auth() })
    if (g.ok) { const j = await g.json(); sha = j.sha }
    const content = Buffer.from(body, 'utf8').toString('base64')
    const r = await fetch(url, { method: 'PUT', headers: auth(), body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }) })
    if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  }
  const all = await collectBackup({ includeSecrets: false })
  const day = all.at.slice(0, 10)
  const written = []
  let bytes = 0
  for (const [name, s] of Object.entries(all.stores)) {
    if (s.error) continue
    const body = JSON.stringify({ store: name, what: s.what, at: all.at, keys: s.keys, truncated: s.truncated, data: s.data }, null, 1)
    bytes += body.length
    await put(`backups/latest/${name}.json`, body, `chore(backup): ${name} ${all.at}`)
    await put(`backups/daily/${day}/${name}.json`, body, `chore(backup): ${name} snapshot ${day}`)
    written.push({ store: name, keys: s.keys, bytes: body.length })
  }
  // Keep the old single-file path alive for anything that reads it.
  const settings = all.stores['caalano-settings']
  if (settings && !settings.error && settings.data.all) await put('backups/settings-latest.json', JSON.stringify(settings.data.all, null, 2), `chore(backup): settings ${all.at}`)
  return { ok: true, backedUp: true, at: all.at, branch, stores: written, bytes, errors: Object.entries(all.stores).filter(([, s]) => s.error).map(([n, s]) => `${n}: ${s.error}`) }
}
