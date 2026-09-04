const ROOT = new URL('../', import.meta.url).pathname
// Which figures an opportunity feeds under each won basis, lifted from ghl.mjs.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'netlify/lib/ghl.mjs', 'utf8')
const a = src.indexOf('export function ccDrillClassify('); let i = src.indexOf('{', src.indexOf(')', a)), d = 0
for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break } }
const { ccDrillClassify } = new Function(src.slice(a + 7, i + 1) + '\nreturn { ccDrillClassify }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }
const T = (s) => Date.parse(s)
const from = T('2026-08-21T00:00:00Z'), to = T('2026-09-03T23:59:59Z')
const opp = (status, created, changed) => ({ status, createdAt: created, lastStatusChangeAt: changed })
const inWon = opp('won', '2026-08-25T10:00:00Z', '2026-09-01T10:00:00Z')      // arrived and closed in range
const oldWon = opp('won', '2026-05-02T10:00:00Z', '2026-08-28T10:00:00Z')     // arrived months ago, closed in range
const lateWon = opp('won', '2026-08-30T10:00:00Z', '2026-09-10T10:00:00Z')    // arrived in range, closed after it
const oldLost = opp('lost', '2026-06-01T10:00:00Z', '2026-08-29T10:00:00Z')   // arrived before, lost in range
const inOpen = opp('open', '2026-08-29T10:00:00Z', null)
const inLost = opp('abandoned', '2026-08-22T10:00:00Z', '2026-08-23T10:00:00Z')
for (const basis of ['created', 'closed']) {
  const c = (o) => ccDrillClassify(o, from, to, basis)
  ok(`${basis}: a lead that arrived and closed in range is cohort + won`, c(inWon).inCohort && c(inWon).isWon && !c(inWon).isOpen)
  ok(`${basis}: open lead in range is cohort + open`, c(inOpen).inCohort && c(inOpen).isOpen && !c(inOpen).isWon)
  ok(`${basis}: lost lead in range is cohort + lost`, c(inLost).inCohort && c(inLost).isLost && !c(inLost).isOpen)
  ok(`${basis}: a deal lost this range but created before is nothing`, !c(oldLost).counts)
}
// The two bases part ways on wins outside the cohort and after the range.
ok('created: an old lead closed this range does not count', !ccDrillClassify(oldWon, from, to, 'created').counts)
ok('closed: an old lead closed this range is a win but not a lead', (() => { const c = ccDrillClassify(oldWon, from, to, 'closed'); return c.isWon && !c.inCohort && c.counts && !c.isOpen })())
ok('created: a lead won after the range still counts as won', ccDrillClassify(lateWon, from, to, 'created').isWon)
ok('closed: a lead won after the range is a lead only', (() => { const c = ccDrillClassify(lateWon, from, to, 'closed'); return c.inCohort && !c.isWon && !c.isOpen && !c.isLost && c.isWonNow })())
ok('no window = everything is cohort', ccDrillClassify(oldWon, null, null, 'closed').inCohort)
ok('unparseable dates never count', !ccDrillClassify({ status: 'won', createdAt: 'x', lastStatusChangeAt: 'y' }, from, to, 'closed').counts)
console.log(`${n - bad}/${n} drill-basis checks passed`)
if (bad) process.exit(1)
