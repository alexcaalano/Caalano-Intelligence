const ROOT = new URL('../', import.meta.url).pathname
// Intelligence across tabs (V2): page tagging, the wider cuts (calendars,
// reps, locations, forms, time to win) and the movers they add.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const consts = src.slice(src.indexOf('const INTEL_MIN_BASE'), src.indexOf('function intelReach('))
const consts2 = src.slice(src.indexOf('const INTEL_DIMS'), src.indexOf('function intelFindings('))
const body = consts + consts2 + ['intelMovers', 'intelFindings', 'intelMedian'].map(lift).join('\n') + "\nconst fmtNumber = (v) => String(v)\n"
const { intelMovers, intelFindings, intelPageOf, INTEL_PAGES } = new Function(body + 'return { intelMovers, intelFindings, intelPageOf, INTEL_PAGES }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// Page mapping.
ok('pipeline → overall', intelPageOf({ dim: 'pipeline' }) === 'overall')
ok('campaign follows its channel', intelPageOf({ dim: 'campaign', chan: 'google' }) === 'google' && intelPageOf({ dim: 'campaign', chan: 'meta' }) === 'meta' && intelPageOf({ dim: 'adset' }) === 'meta')
ok('keyword → google', intelPageOf({ dim: 'keyword' }) === 'google')
ok('stage/reason → lost reasons', intelPageOf({ dim: 'stage' }) === 'lostreasons' && intelPageOf({ key: 'lost:Cost' }) === 'lostreasons')
ok('calendar/show → appts', intelPageOf({ dim: 'calendar' }) === 'appts' && intelPageOf({ key: 'show:Consult' }) === 'appts')
ok('rep → users', intelPageOf({ dim: 'rep' }) === 'users')
ok('location/form', intelPageOf({ dim: 'location' }) === 'location' && intelPageOf({ dim: 'form' }) === 'forms')
ok('ttw → timing', intelPageOf({ metric: 'ttw' }) === 'timing' && intelPageOf({ key: 'ttw' }) === 'timing')
ok('channel movers', intelPageOf({ key: 'cpl:meta' }) === 'meta' && intelPageOf({ key: 'won:google' }) === 'google' && intelPageOf({ key: 'revenue' }) === 'overall')
ok('explicit page wins', intelPageOf({ dim: 'rep', page: 'calls' }) === 'calls')
ok('every page has a label', Object.keys(INTEL_PAGES).length >= 9 && INTEL_PAGES.appts === 'Appointments')

// Wide findings: a calendar with a poor show rate, a rep who wins more, a suburb that books more.
const keys = ['pipeline', 'stage', 'campaign', 'adset', 'creative', 'keyword', 'source', 'channel']
const dict = { pipeline: ['P'], stage: ['New', 'Won'], campaign: ['A', 'B'], adset: ['x'], creative: ['x'], keyword: ['x'], source: ['Paid Social', 'Paid Search'], channel: ['meta', 'google'] }
// rows: [status, pipeline, stage, campaign, adset, creative, keyword, source, channel, stagePos, days]
const rows = []
for (let i = 0; i < 30; i++) rows.push([i < 6 ? 1 : 0, 0, i < 6 ? 1 : 0, 0, 0, 0, 0, 0, 0, i < 6 ? 1 : 0, i < 6 ? 4 : null])   // campaign A (meta): 6 of 30 win, fast
for (let i = 0; i < 30; i++) rows.push([i < 6 ? 1 : 0, 0, i < 6 ? 1 : 0, 1, 0, 0, 0, 1, 1, i < 6 ? 1 : 0, i < 6 ? 30 : null])  // campaign B (google): 6 of 30 win, slow
const cc = { oppFacts: { keys, dict, rows }, lostFacts: null, bookingByCalendar: [{ id: 'c1', calendar: 'Consult', booked: 40, occurred: 30, shown: 12 }, { id: 'c2', calendar: 'Follow-up', booked: 40, occurred: 30, shown: 27 }] }
const f = intelFindings(cc, null, null, null, { wide: true, calendars: cc.bookingByCalendar, reps: [{ name: 'Ann', leads: 40, won: 12, booked: 20 }, { name: 'Bob', leads: 40, won: 2, booked: 20 }], locations: [{ label: 'Frankston', leads: 30, booked: 24, won: 3 }, { label: 'Berwick', leads: 30, booked: 6, won: 3 }], forms: [{ form: 'Enquiry', leads: 50, booked: 25, won: 5 }, { form: 'Callback', leads: 50, booked: 5, won: 5 }] })
const has = (dim, label, metric) => f.find((x) => x.dim === dim && x.label === label && (!metric || x.metric === metric))
ok('calendar show-rate finding', has('calendar', 'Consult', 'show') && has('calendar', 'Consult').better === false && has('calendar', 'Consult').page === 'appts', f.filter((x) => x.dim === 'calendar'))
ok('rep win-rate finding', has('rep', 'Ann', 'win') && has('rep', 'Ann').better === true && has('rep', 'Ann').page === 'users')
ok('no rep booking finding when equal', !has('rep', 'Ann', 'book') && !has('rep', 'Bob', 'book'))
ok('location booking finding', has('location', 'Frankston', 'book') && has('location', 'Frankston').page === 'location')
ok('form booking finding', has('form', 'Callback', 'book') && has('form', 'Callback').better === false && has('form', 'Callback').page === 'forms')
ok('time to win finding per campaign', has('campaign', 'B', 'ttw') && has('campaign', 'B').better === false && has('campaign', 'B').page === 'timing', f.filter((x) => x.metric === 'ttw'))
ok('campaign page by channel', has('campaign', 'A', 'ttw') && has('campaign', 'A', 'ttw').chan === 'meta')
ok('every finding tagged', f.every((x) => x.page && INTEL_PAGES[x.page]))
const narrow = intelFindings(cc, null, null, null, {})
ok('V1 (no wide) adds nothing new', !narrow.some((x) => ['calendar', 'rep', 'location', 'form'].includes(x.dim) || x.metric === 'ttw'))

// Wide movers: show rate per calendar and median days to win, tagged.
const mk = (shown, ttw) => ({ totals: { leads: 100, won: 10, lost: 10 }, revenue: { total: 1000 }, spend: {}, paid: {}, bookingByCalendar: [{ id: 'c1', calendar: 'Consult', occurred: 40, shown }], timeToWon: { median: ttw, n: 10 }, lostByReason: [] })
const mv = intelMovers(mk(20, 6), mk(32, 12), [], [], { wide: true })
ok('show-rate mover', mv.some((m) => m.key === 'show:Consult' && m.page === 'appts' && m.good === false), mv)
ok('days-to-win mover', mv.some((m) => m.key === 'ttw' && m.kind === 'days' && m.good === true && m.page === 'timing'), mv)
ok('movers all tagged', mv.every((m) => m.page))
ok('V1 movers unchanged', !intelMovers(mk(20, 6), mk(32, 12), [], []).some((m) => m.key === 'ttw' || m.key.startsWith('show:')))

console.log(`intelwide_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
