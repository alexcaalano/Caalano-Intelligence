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
  { name: 'caalano-audit', what: 'Who opened what, when', logs: true },
  { name: 'caalano-diag', what: 'Reliability log', cap: 4000, logs: true },
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
// Reads run twelve at a time: one at a time, a store with a few thousand keys
// took longer than a function is allowed to run, and the download never came.
async function dumpStore(name, cap = 20000, deadline = 0) {
  const store = getStore({ name, consistency: 'strong' })
  const out = {}
  let cursor, n = 0, truncated = false, cutShort = false
  const keys = []
  do {
    const page = await store.list({ cursor })
    for (const b of page.blobs || []) { if (keys.length >= cap) { truncated = true; break } keys.push(b.key) }
    cursor = truncated ? null : page.cursor
  } while (cursor)
  let i = 0
  const worker = async () => {
    while (i < keys.length) {
      if (deadline && Date.now() > deadline) { cutShort = true; return }
      const key = keys[i++]
      const txt = await store.get(key, { type: 'text' }).catch(() => null)
      if (txt == null) continue
      try { out[key] = JSON.parse(txt) } catch { out[key] = { _text: txt } }
      n++
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker))
  return { keys: n, truncated, ...(cutShort ? { cutShort: true } : {}), data: out }
}

// Everything, as one object. `includeSecrets` adds the token store.
// `includeLogs` adds the two log stores (reliability, activity), which are the
// bulky ones; the interactive download leaves them out unless asked so it always
// finishes inside the function limit. `budgetMs` cuts a store short rather than
// losing the whole download; a cut-short store is marked so a restore knows.
export async function collectBackup({ includeSecrets = false, includeLogs = true, budgetMs = 0 } = {}) {
  const at = new Date().toISOString()
  const started = Date.now()
  const stores = {}
  const list = (includeSecrets ? [...BACKUP_STORES, ...SECRET_STORES] : BACKUP_STORES).filter((s) => includeLogs || !s.logs)
  for (const s of list) {
    try { stores[s.name] = { what: s.what, ...(await dumpStore(s.name, s.cap, budgetMs ? started + budgetMs : 0)) } }
    catch (e) { stores[s.name] = { what: s.what, error: String((e && e.message) || e).slice(0, 200), keys: 0, data: {} } }
  }
  const skippedLogs = includeLogs ? [] : BACKUP_STORES.filter((s) => s.logs).map((s) => s.name)
  return { format: 'caalano360-backup/2', at, site: process.env.URL || null, includesSecrets: includeSecrets, includesLogs: includeLogs, notBackedUp: [...NOT_BACKED_UP, ...skippedLogs], stores }
}

// The scheduled path: every non-secret store to the GitHub repo, as one file
// per store under a dated folder plus a stable "latest" copy that is easy to
// diff. Skips cleanly when the token is not configured - and says so, so the
// -now endpoint can tell you the daily job has never actually run.
//
// Runs inside `settings-backup-background` (15-minute ceiling). The first
// version wrote each file with its own GitHub round trip from a plain function
// and was cut off at ten seconds with a 502 before it finished. All files now
// go up as ONE commit through the git data API (blobs in parallel, one tree,
// one commit, one ref update); if that path fails for any reason it falls back
// to the one-file-at-a-time contents API, which the background budget allows.
export async function backupSettings({ budgetMs = 120000, fetchImpl = globalThis.fetch } = {}) {
  const token = process.env.BACKUP_GH_TOKEN
  const repo = process.env.BACKUP_GH_REPO
  if (!token || !repo) return { ok: false, skipped: true, reason: 'Set BACKUP_GH_TOKEN and BACKUP_GH_REPO env vars to enable backups to GitHub. Until then use backup-export to download one by hand.' }
  const t0 = Date.now()
  const auth = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json', 'User-Agent': 'caalano360-backup' })
  const gh = async (method, path, body) => {
    const r = await fetchImpl(`${GH}/repos/${repo}${path}`, { method, headers: auth(), ...(body ? { body: JSON.stringify(body) } : {}) })
    const txt = await r.text()
    let j = null; try { j = txt ? JSON.parse(txt) : null } catch { /* not json */ }
    return { ok: r.ok, status: r.status, json: j, text: txt }
  }
  let branch = process.env.BACKUP_GH_BRANCH
  if (!branch) { const rr = await gh('GET', ''); if (rr.status === 401 || rr.status === 404) throw new Error(`GitHub says ${rr.status} for ${repo}: check BACKUP_GH_REPO is owner/name and the token has access to that repository`); branch = (rr.ok && rr.json && rr.json.default_branch) || 'main' }

  const all = await collectBackup({ includeSecrets: false, budgetMs })
  const day = all.at.slice(0, 10)
  const files = []
  const written = []
  let bytes = 0
  for (const [name, s] of Object.entries(all.stores)) {
    if (s.error) continue
    const body = JSON.stringify({ store: name, what: s.what, at: all.at, keys: s.keys, truncated: s.truncated, cutShort: s.cutShort, data: s.data }, null, 1)
    bytes += body.length
    files.push({ path: `backups/latest/${name}.json`, body })
    files.push({ path: `backups/daily/${day}/${name}.json`, body })
    written.push({ store: name, keys: s.keys, bytes: body.length, ...(s.cutShort ? { cutShort: true } : {}) })
  }
  // Keep the old single-file path alive for anything that reads it.
  const settings = all.stores['caalano-settings']
  if (settings && !settings.error && settings.data.all) files.push({ path: 'backups/settings-latest.json', body: JSON.stringify(settings.data.all, null, 2) })
  const message = `chore(backup): ${day} ${all.at}`

  // One file through the contents API (creates the branch on an empty repo).
  const putOne = async (path, body, msg) => {
    const g = await gh('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`)
    const sha = g.ok && g.json ? g.json.sha : undefined
    const r = await gh('PUT', `/contents/${path}`, { message: msg, content: Buffer.from(body, 'utf8').toString('base64'), branch, ...(sha ? { sha } : {}) })
    if (!r.ok) throw new Error(`${path}: ${r.status} ${r.text.slice(0, 200)}`)
  }
  // Everything as one commit.
  const commitAll = async () => {
    let ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)
    if (!ref.ok) {
      // 409 = empty repository, 404 = branch does not exist yet. The contents
      // API is the one call that can create the first commit / the branch.
      await putOne('backups/README.md', `# Caalano360 backups\n\nWritten automatically by the site's daily backup. One folder per day under daily/, the newest copy under latest/. Restore with scripts/restore-backup.mjs in the app repository.\n`, 'chore(backup): initialise')
      ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)
      if (!ref.ok) throw new Error(`ref: ${ref.status} ${ref.text.slice(0, 200)}`)
    }
    const headSha = ref.json.object.sha
    const head = await gh('GET', `/git/commits/${headSha}`)
    if (!head.ok) throw new Error(`commit: ${head.status}`)
    const blobs = new Array(files.length)
    let i = 0
    const worker = async () => {
      while (i < files.length) {
        const k = i++
        const b = await gh('POST', '/git/blobs', { content: Buffer.from(files[k].body, 'utf8').toString('base64'), encoding: 'base64' })
        if (!b.ok) throw new Error(`blob ${files[k].path}: ${b.status} ${b.text.slice(0, 120)}`)
        blobs[k] = b.json.sha
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    const tree = await gh('POST', '/git/trees', { base_tree: head.json.tree.sha, tree: files.map((f, k) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[k] })) })
    if (!tree.ok) throw new Error(`tree: ${tree.status} ${tree.text.slice(0, 120)}`)
    const commit = await gh('POST', '/git/commits', { message, tree: tree.json.sha, parents: [headSha] })
    if (!commit.ok) throw new Error(`commit: ${commit.status} ${commit.text.slice(0, 120)}`)
    const upd = await gh('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.json.sha })
    if (!upd.ok) throw new Error(`ref update: ${upd.status} ${upd.text.slice(0, 120)}`)
    return commit.json.sha
  }
  let commitSha = null, mode = 'commit', fallbackReason = null
  try { commitSha = await commitAll() }
  catch (e) {
    fallbackReason = String((e && e.message) || e).slice(0, 200)
    mode = 'files'
    for (const f of files) await putOne(f.path, f.body, message)
  }
  return { ok: true, backedUp: true, at: all.at, repo, branch, mode, ...(fallbackReason ? { fallbackReason } : {}), commit: commitSha, files: files.length, stores: written, bytes, ms: Date.now() - t0, errors: Object.entries(all.stores).filter(([, s]) => s.error).map(([n, s]) => `${n}: ${s.error}`) }
}

// --- running it in the background --------------------------------------------
// The daily job and the -now endpoint both just kick `settings-backup-background`
// and return; the result of the last run is kept in the warm store (not backed
// up itself: it is only a status line) so the -now page can show it.
const STATUS_STORE = 'caalano-warm'
const STATUS_KEY = 'backup:last'
export async function readBackupStatus() {
  return getStore({ name: STATUS_STORE, consistency: 'strong' }).get(STATUS_KEY, { type: 'json' }).catch(() => null)
}
export async function writeBackupStatus(v) {
  await getStore({ name: STATUS_STORE, consistency: 'strong' }).setJSON(STATUS_KEY, v).catch(() => {})
}
// Runs the backup and records how it went. What the background function calls.
export async function runBackupJob() {
  const startedAt = new Date().toISOString()
  await writeBackupStatus({ state: 'running', startedAt })
  try {
    const r = await backupSettings()
    await writeBackupStatus({ state: r.ok ? 'ok' : 'skipped', startedAt, finishedAt: new Date().toISOString(), result: r })
    return r
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 300)
    await writeBackupStatus({ state: 'error', startedAt, finishedAt: new Date().toISOString(), error })
    return { ok: false, error }
  }
}
// Kicks the background function. Returns as soon as Netlify has accepted the
// job. `token` is the warm token (same shared secret the warmer uses).
export async function triggerBackup(token) {
  const base = process.env.URL
  if (!base || !token) return { triggered: false, reason: !base ? 'no site URL (local dev?)' : 'no secret to derive a token from' }
  try {
    const r = await fetch(`${base}/.netlify/functions/settings-backup-background`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-warm-token': token }, body: '{}', signal: AbortSignal.timeout(4000) })
    return { triggered: r.status === 202 || r.ok, status: r.status }
  } catch (e) {
    return { triggered: false, reason: String((e && e.message) || e).slice(0, 120) }
  }
}
