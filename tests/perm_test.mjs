const ROOT = new URL('../', import.meta.url).pathname
// Extract the real map and predicate from windsor.mjs and exercise them, so this
// tests the shipped rules rather than a restatement of them.
import fs from 'fs'
import os from 'os'
import path from 'path'
// A scratch dir that exists on every machine, including the CI runner.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c360-test-')) + '/'
const src = fs.readFileSync(ROOT + 'netlify/functions/windsor.mjs', 'utf8')
const i = src.indexOf('const VIEWER_TABS_ALL =')
const j = src.indexOf('\n}', src.indexOf('function viewerAllowed')) + 2
fs.writeFileSync(TMP + '_perm.mjs',
  src.slice(i, j) + '\nexport { viewerAllowed, VIEWER_TABS_ALL, VIEWER_REQ_TABS }\n')
const { viewerAllowed } = await import(TMP + '_perm.mjs')

let fails = 0
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg) } else console.log('ok  ', msg) }
const TIMING = ['scope:speed', 'scope:enqtimes', 'scope:stagetiming']
const sc = (k) => k.replace('scope:', '')

// A viewer WITH the Timing tab gets all three sections.
const withTiming = { role: 'viewer', tabs: ['overall', 'timing'] }
for (const k of TIMING) ok(viewerAllowed(withTiming, sc(k), null), `Timing granted -> ${sc(k)} allowed`)

// A viewer WITHOUT it gets none of them. This is the part that matters: the new
// entries must not become a way in for someone who was never given the tab.
const noTiming = { role: 'viewer', tabs: ['overall', 'meta'] }
for (const k of TIMING) ok(!viewerAllowed(noTiming, sc(k), null), `Timing not granted -> ${sc(k)} denied`)

// A viewer with NO tabs recorded falls back to the full set - check the new
// scopes follow the same rule as the existing one rather than diverging.
const legacy = { role: 'viewer' }
ok(viewerAllowed(legacy, 'enqtimes', null) === viewerAllowed(legacy, 'speed', null), 'no-tabs viewer treats enqtimes exactly like speed')
ok(viewerAllowed(legacy, 'stagetiming', null) === viewerAllowed(legacy, 'speed', null), 'no-tabs viewer treats stagetiming exactly like speed')

// Deny-by-default is intact: an unmapped or staff-only scope is still refused.
for (const s of ['ccdrill2', 'diaglog', 'audit', 'clientlog', 'warm']) ok(!viewerAllowed(withTiming, s, null), `unmapped scope "${s}" still denied`)
// ccdrill is mapped to overall+lostreasons, not timing - a Timing-only viewer must not reach it.
ok(!viewerAllowed({ role: 'viewer', tabs: ['timing'] }, 'ccdrill', null), 'Timing-only viewer cannot reach ccdrill')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
