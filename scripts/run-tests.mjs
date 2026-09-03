// Runs every tests/*_test.mjs in its own process and reports. A test that
// starts with `// @needs-fake-blobs` is run with the in-memory Blobs shim.
// Exit code is non-zero if any test fails, so CI stops there.
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const dir = new URL('../tests/', import.meta.url).pathname
const files = readdirSync(dir).filter((f) => f.endsWith('_test.mjs')).sort()
let failed = 0
const t0 = Date.now()
for (const f of files) {
  const src = readFileSync(dir + f, 'utf8')
  const args = src.startsWith('// @needs-fake-blobs') ? ['--import', dir + 'fixtures/register-fake-blobs.mjs', dir + f] : [dir + f]
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000 })
  const last = (r.stdout || '').trim().split('\n').pop() || ''
  const ok = r.status === 0
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(28)} ${ok ? last : ((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 220))}`)
}
console.log(`\n${files.length - failed}/${files.length} test files passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failed ? 1 : 0)
