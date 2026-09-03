const ROOT = new URL('../', import.meta.url).pathname
// Extract fetchCalendarConfig from ghl.mjs and drive it with injected stubs, so
// this exercises the shipped function rather than a paraphrase of it.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'netlify/lib/ghl.mjs', 'utf8')
const i = src.indexOf('const CAL_MEM_MS')
const j = src.indexOf('async function fetchAppointments')
const body = src.slice(i, j)
  .replace('const _calStore = () => getStore({ name: \'caalano-pipecache\', consistency: \'strong\' })', 'const _calStore = () => STORE')
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_cal.mjs',
  'export let STORE, ghlGet\nexport function __inject(s, g) { STORE = s; ghlGet = g }\n' + body + '\nexport { fetchCalendarConfig, _calMem }\n')
const M = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_cal.mjs')

const mkStore = () => { const b = new Map(); return { get: async (k) => b.has(k) ? JSON.parse(JSON.stringify(b.get(k))) : null, setJSON: async (k, v) => { b.set(k, JSON.parse(JSON.stringify(v))) }, dump: () => b } }
let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }

// 1. Cold: one call for calendars, one for the catalog, both cached after.
let calls = []
let store = mkStore()
M.__inject(store, async (_t, path) => { calls.push(path); return path === '/calendars/' ? { calendars: [{ id: 'c1' }] } : { services: [{ id: 's1' }] } })
M._calMem.clear()
let r = await M.fetchCalendarConfig('tok', 'LOC')
ok(r.calendars.length === 1 && r.services.length === 1, 'cold read returns calendars and services')
ok(calls.length === 2, `cold read costs exactly 2 CRM calls (got ${calls.length})`)

// 2. Warm memory: no further CRM calls at all.
calls = []
r = await M.fetchCalendarConfig('tok', 'LOC')
ok(calls.length === 0, `second call in the same invocation costs 0 CRM calls (got ${calls.length})`)
ok(r.calendars.length === 1, 'and still returns the calendars')

// 3. Warm Blobs, cold memory - the cross-invocation case, which is the one that
//    matters for forty separate ovrow invocations.
calls = []
M._calMem.clear()
r = await M.fetchCalendarConfig('tok', 'LOC')
ok(calls.length === 0, `a fresh invocation reads Blobs, not the CRM (got ${calls.length} CRM calls)`)
ok(r.calendars.length === 1, 'and gets the same calendars')

// 4. THE DANGEROUS CASE: the calendar read fails on a cold cache. It must not be
//    cached as "no calendars" - every booking count downstream would read zero.
calls = []
const empty = mkStore()
M.__inject(empty, async (path) => { throw new Error('ghl GET /calendars/ 429') })
M._calMem.clear()
r = await M.fetchCalendarConfig('tok', 'LOC2')
ok(r.calendars === null, 'a failed calendar read returns null, not an empty list')
ok(!!r.error, 'and carries the error so the caller can say "unavailable"')
ok((await empty.get('cal:LOC2')) === null, 'a failed read is never written to the cache')

// 5. Failure WITH a good copy already cached: serve the last good one rather than
//    blanking, the same way pipelines already behave.
M._calMem.clear()
M.__inject(store, async () => { throw new Error('ghl GET /calendars/ 429') })
r = await M.fetchCalendarConfig('tok', 'LOC')
ok(r.calendars && r.calendars.length === 1, 'a transient failure serves the last good copy instead of blanking bookings')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
