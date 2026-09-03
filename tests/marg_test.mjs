const ROOT = new URL('../', import.meta.url).pathname
// The marginal rollups: every cell counted once, in the right bucket.
import fs from 'fs'
import os from 'os'
import path from 'path'
// A scratch dir that exists on every machine, including the CI runner.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c360-test-')) + '/'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const i = src.indexOf('const ENQ_BLOCKS =')
const j = src.indexOf('function EnqMarginal')
fs.writeFileSync(TMP + '_mg.mjs',
  'const ENQ_DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]\nconst enqHourLabel = (h) => `${h}:00`\n' +
  src.slice(i, j) + '\nexport { enqMarginal, ENQ_BLOCKS }\n')
const { enqMarginal, ENQ_BLOCKS } = await import(TMP + '_mg.mjs')
// pickMeasure, tested against the same grid.
const k = src.indexOf('function pickMeasure')
fs.writeFileSync(TMP + '_pm.mjs', src.slice(k, src.indexOf('function flatGrid')) + '\nexport { pickMeasure }\n')
const { pickMeasure } = await import(TMP + '_pm.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const g = []
for (let d = 0; d < 7; d++) { const r = []; for (let h = 0; h < 24; h++) r.push({ leads: 0, booked: 0, won: 0, lost: 0 }); g.push(r) }
g[0][9]  = { leads: 10, booked: 4, won: 3, lost: 5 }   // Mon 9am  -> Morning
g[2][1]  = { leads: 4,  booked: 0, won: 1, lost: 2 }   // Wed 1am  -> Overnight
g[4][19] = { leads: 6,  booked: 2, won: 0, lost: 4 }   // Fri 7pm  -> Evening
g[6][23] = { leads: 2,  booked: 0, won: 1, lost: 1 }   // Sun 11pm -> Late evening
const TOTAL = 22

for (const gran of ['hour', 'block', 'day']) {
  const rows = enqMarginal(g, gran)
  ok(rows.reduce((a, r) => a + r.n, 0) === TOTAL, `${gran}: every lead counted exactly once (${rows.reduce((a, r) => a + r.n, 0)}/${TOTAL})`)
}
ok(enqMarginal(g, 'hour').length === 24, 'hour: 24 rows, including empty hours')
ok(enqMarginal(g, 'day').length === 7, 'day: 7 rows')
ok(enqMarginal(g, 'block').length === ENQ_BLOCKS.length, `block: ${ENQ_BLOCKS.length} rows`)
const byHour = enqMarginal(g, 'hour')
ok(byHour[9].n === 10 && byHour[1].n === 4 && byHour[19].n === 6 && byHour[23].n === 2, 'hours land where they should')
ok(byHour[9].booked === 4, 'booked carries through so the tooltip can show it')
const byDay = enqMarginal(g, 'day')
ok(byDay[0].n === 10 && byDay[2].n === 4 && byDay[4].n === 6 && byDay[6].n === 2, 'days land where they should')
const byBlock = enqMarginal(g, 'block')
const bl = (n) => byBlock.find((b) => b.label === n).n
ok(bl('Morning') === 10 && bl('Overnight') === 4 && bl('Evening') === 6 && bl('Late evening') === 2, 'blocks land where they should')
// Blocks must tile the day with no gap and no overlap.
const covered = []
for (const [, a, b] of ENQ_BLOCKS) for (let h = a; h < b; h++) covered.push(h)
ok(covered.length === 24 && new Set(covered).size === 24, 'the blocks cover all 24 hours exactly once')

// Won / lost by arrival are derived from the same grid, at the arrival cell.
const won = pickMeasure(g, 'won'), lost = pickMeasure(g, 'lost')
ok(won[0][9].leads === 3 && lost[0][9].leads === 5, 'a Monday-9am lead that was later won stays at Monday 9am')
ok(enqMarginal(won, 'hour').reduce((a, r) => a + r.n, 0) === 5, 'won-by-arrival totals the wins, not the leads')
ok(enqMarginal(lost, 'hour').reduce((a, r) => a + r.n, 0) === 12, 'lost-by-arrival totals the losses')
ok(enqMarginal(won, 'day')[2].n === 1, 'and they roll up by day the same way')
ok(pickMeasure(null, 'won') === null, 'no grid gives no measure rather than throwing')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
