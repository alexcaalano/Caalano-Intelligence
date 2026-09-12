// @needs-fake-blobs
// The daily backup to GitHub: every store lands as ONE commit through the git
// data API; an empty repository is initialised first through the contents API;
// and if the commit path fails it falls back to one file at a time.
import assert from 'node:assert/strict'
import { backupSettings, runBackupJob, readBackupStatus } from '../netlify/lib/backup.mjs'

process.env.BACKUP_GH_TOKEN = 't'
process.env.BACKUP_GH_REPO = 'alexcaalano/caalano360-backups'
delete process.env.BACKUP_GH_BRANCH

// A tiny fake of the GitHub REST API: enough state to answer the calls we make.
function fakeGitHub({ empty = false, breakTrees = false } = {}) {
  const calls = []
  let hasCommit = !empty
  let seq = 0
  const files = {}
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET'
    const path = url.replace('https://api.github.com/repos/alexcaalano/caalano360-backups', '')
    calls.push(`${method} ${path.split('?')[0]}`)
    const json = (status, body) => new Response(JSON.stringify(body), { status })
    if (method === 'GET' && path === '') return json(200, { default_branch: 'main' })
    if (method === 'GET' && path.startsWith('/git/ref/')) return hasCommit ? json(200, { object: { sha: 'head1' } }) : json(409, { message: 'Git Repository is empty.' })
    if (method === 'GET' && path.startsWith('/git/commits/')) return json(200, { tree: { sha: 'tree0' } })
    if (method === 'GET' && path.startsWith('/contents/')) { const p = path.slice('/contents/'.length).split('?')[0]; return files[p] ? json(200, { sha: 'f' + p }) : json(404, {}) }
    if (method === 'PUT' && path.startsWith('/contents/')) { const p = path.slice('/contents/'.length); files[p] = JSON.parse(init.body).content; hasCommit = true; return json(201, { content: { sha: 'f' + p } }) }
    if (method === 'POST' && path === '/git/blobs') return json(201, { sha: 'b' + (++seq) })
    if (method === 'POST' && path === '/git/trees') { if (breakTrees) return json(422, { message: 'nope' }); const t = JSON.parse(init.body).tree; for (const e of t) files[e.path] = e.sha; return json(201, { sha: 'tree1' }) }
    if (method === 'POST' && path === '/git/commits') return json(201, { sha: 'commit1' })
    if (method === 'PATCH' && path.startsWith('/git/refs/')) return json(200, {})
    return json(500, { message: 'unexpected ' + method + ' ' + path })
  }
  return { fetchImpl, calls, files }
}

// Normal repository: one commit, no contents-API writes.
{
  const gh = fakeGitHub()
  const r = await backupSettings({ fetchImpl: gh.fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'commit')
  assert.equal(r.commit, 'commit1')
  assert.equal(r.branch, 'main')
  assert.ok(r.files >= 2 * r.stores.length, 'latest + daily copy per store')
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT /contents/')).length, 0, 'no per-file writes on the commit path')
  assert.equal(gh.calls.filter((c) => c === 'POST /git/commits').length, 1, 'exactly one commit')
  assert.ok(Object.keys(gh.files).some((p) => p.startsWith('backups/latest/caalano-settings.json')), 'settings store landed under latest/')
  assert.ok(Object.keys(gh.files).some((p) => /^backups\/daily\/\d{4}-\d{2}-\d{2}\/caalano-auth\.json$/.test(p)), 'auth store landed under daily/<date>/')
  assert.ok(!Object.keys(gh.files).some((p) => p.includes('ghl-auth')), 'token store never goes to GitHub')
}

// Empty repository: initialised with one contents write, then the same single commit.
{
  const gh = fakeGitHub({ empty: true })
  const r = await backupSettings({ fetchImpl: gh.fetchImpl })
  assert.equal(r.mode, 'commit')
  assert.deepEqual(gh.calls.filter((c) => c.startsWith('PUT /contents/')), ['PUT /contents/backups/README.md'], 'only the README goes through the contents API')
  assert.equal(gh.calls.filter((c) => c === 'POST /git/commits').length, 1)
}

// Commit path broken: falls back to file-by-file and still succeeds.
{
  const gh = fakeGitHub({ breakTrees: true })
  const r = await backupSettings({ fetchImpl: gh.fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'files')
  assert.match(r.fallbackReason, /tree: 422/)
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT /contents/')).length, r.files)
}

// The job records its outcome where the -now page reads it.
{
  const gh = fakeGitHub()
  const origFetch = globalThis.fetch
  globalThis.fetch = gh.fetchImpl
  try { await runBackupJob() } finally { globalThis.fetch = origFetch }
  const st = await readBackupStatus()
  assert.equal(st.state, 'ok')
  assert.equal(st.result.commit, 'commit1')
}

// Not configured: says so, touches nothing.
{
  delete process.env.BACKUP_GH_TOKEN
  const r = await backupSettings({ fetchImpl: () => { throw new Error('should not be called') } })
  assert.equal(r.skipped, true)
}
console.log('backup_github_test ok')
