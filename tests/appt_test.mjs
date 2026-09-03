const ROOT = new URL('../', import.meta.url).pathname
// Extract the coalescing wrapper from ghl.mjs and drive it with a stub builder.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'netlify/lib/ghl.mjs', 'utf8')
const i = src.indexOf('const APPT_MEM_MS')
const j = src.indexOf('async function _fetchAppointments')
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_appt.mjs',
  'export let _fetchAppointments\nexport function __inject(f) { _fetchAppointments = f }\n' +
  src.slice(i, j) + '\nexport { fetchAppointments, _apptMem, _apptInflight }\n')
const M = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_appt.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const reset = () => { M._apptMem.clear(); M._apptInflight.clear() }

// 1. Eleven concurrent callers, same window -> one build. This is the ccdrill /
//    agency-overview shape: several builders in one Promise.all.
let builds = 0
reset(); M.__inject(async () => { builds++; await sleep(30); return { byContact: new Map([['c', 1]]), connected: true } })
let res = await Promise.all(Array.from({ length: 11 }, () => M.fetchAppointments('t', 'LOC', '2026-08-01', '2026-08-28')))
ok(builds === 1, `11 concurrent callers -> ${builds} build (was 11)`)
ok(res.every((r) => r === res[0]), 'every caller gets the same object')

// 2. A sequential caller just afterwards reuses it too.
builds = 0
await M.fetchAppointments('t', 'LOC', '2026-08-01', '2026-08-28')
ok(builds === 0, 'a sequential caller inside the window costs no extra build')

// 3. Different windows must NOT share - that would be a correctness bug, not a
//    speed win: the previous period would show the current period's bookings.
builds = 0
await M.fetchAppointments('t', 'LOC', '2026-07-01', '2026-07-31')
ok(builds === 1, 'a different date range builds separately')
builds = 0
await M.fetchAppointments('t', 'OTHER', '2026-08-01', '2026-08-28')
ok(builds === 1, 'a different location builds separately')

// 4. A failed calendar read must not be cached as "no bookings".
reset(); builds = 0
M.__inject(async () => { builds++; return { byContact: new Map(), perCalendar: new Map(), connected: false, error: '429' } })
await M.fetchAppointments('t', 'LOC', '2026-08-01', '2026-08-28')
await M.fetchAppointments('t', 'LOC', '2026-08-01', '2026-08-28')
ok(builds === 2, `a failed read is retried, not cached (${builds} builds for 2 calls)`)

// 5. A throwing build must not wedge the key forever.
reset()
M.__inject(async () => { throw new Error('boom') })
await M.fetchAppointments('t', 'LOC', 'a', 'b').catch(() => {})
ok(M._apptInflight.size === 0, 'a thrown build clears its in-flight entry')
builds = 0
M.__inject(async () => { builds++; return { byContact: new Map(), connected: true } })
await M.fetchAppointments('t', 'LOC', 'a', 'b')
ok(builds === 1, 'and the next caller can build normally')

// 6. The memory map is bounded, so a long-lived warm Lambda cannot grow forever.
reset()
M.__inject(async () => ({ byContact: new Map(), connected: true }))
for (let k = 0; k < 40; k++) await M.fetchAppointments('t', 'L' + k, 'a', 'b')
ok(M._apptMem.size <= 12, `memory map stays bounded (${M._apptMem.size} entries after 40 distinct windows)`)
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
