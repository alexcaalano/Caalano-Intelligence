const ROOT = new URL('../', import.meta.url).pathname
// The guard chain that has now crashed the view twice. Tested against the payload
// shapes the two fetches actually produce, including the ones that broke it.
import fs from 'fs'
import os from 'os'
import path from 'path'
// A scratch dir that exists on every machine, including the CI runner.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c360-test-')) + '/'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const i = src.indexOf('function speedViewState')
const j = src.indexOf('function TimingView')
fs.writeFileSync(TMP + '_sv.mjs', src.slice(i, j) + '\nexport { speedViewState }\n')
const { speedViewState } = await import(TMP + '_sv.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const payload = { buckets: [{ label: 'Under 5 min', count: 3 }], sampled: 40, totalLeads: 180, sourceBreakdown: [] }
const running = { status: 'running', processed: 0, total: 0, data: null }

// The exact bug: the scan starts immediately, so `scan` is truthy while the
// sampled fetch is still in flight. Every guard used to be `!scan`, so all of
// them switched off and the body ran against {}.
ok(speedViewState({ status: 'loading', data: null }, running).view === 'loading',
  'scan running + sample still loading -> spinner, NOT the body (this is what crashed)')
ok(speedViewState({ status: 'loading', data: null }, null).view === 'loading', 'no scan + loading -> spinner')

// A scan that comes back useless must not displace a good sampled view.
for (const bad of [{ ghl: false }, { connected: false }, { status: 'err', error: 'boom' }, {}, null]) {
  const r = speedViewState({ status: 'ok', data: payload }, { status: 'done', data: bad })
  ok(r.view === 'ready' && r.d === payload, `a scan response of ${JSON.stringify(bad)} falls back to the sampled payload`)
}

// A real scan payload is preferred over the sample.
const full = { ...payload, sampled: 180, full: true }
ok(speedViewState({ status: 'ok', data: payload }, { status: 'done', data: full }).d === full, 'a complete scan payload replaces the sample')

// Genuine failure states still surface as messages, not as a crash.
ok(speedViewState({ status: 'err', data: null }, null).view === 'error', 'sampled fetch failed -> error card')
ok(speedViewState({ status: 'ok', data: { connected: false } }, null).view === 'error', 'CRM not connected -> error card')
ok(speedViewState({ status: 'ok', data: { buckets: [], sampled: 0 } }, null).view === 'empty', 'no leads measured -> empty card')
ok(speedViewState({ status: 'ok', data: {} }, null).view === 'empty', 'a payload with no buckets never reaches the body')

// The invariant that matters: `ready` is the ONLY state the body renders in, and
// it must always carry the arrays the body maps over.
const cases = [
  [{ status: 'loading', data: null }, null], [{ status: 'loading', data: null }, running],
  [{ status: 'err', data: null }, null], [{ status: 'ok', data: {} }, null],
  [{ status: 'ok', data: payload }, running], [{ status: 'ok', data: payload }, { status: 'done', data: { ghl: false } }],
  [{ status: 'ok', data: payload }, { status: 'done', data: full }],
]
ok(cases.every(([a, b]) => { const r = speedViewState(a, b); return r.view !== 'ready' || Array.isArray(r.d.buckets) }),
  'across every state, `ready` always has buckets to map over')
ok(cases.every(([a, b]) => ['loading', 'error', 'empty', 'ready'].includes(speedViewState(a, b).view)), 'every state resolves to a known view')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
