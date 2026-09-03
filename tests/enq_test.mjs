const ROOT = new URL('../', import.meta.url).pathname
// The flat->grid reshape and the two clocks. Getting the day/hour indexing wrong
// would silently rotate the whole heatmap, which no amount of eyeballing catches.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const i = src.indexOf('function flatGrid(flat)')
const j = src.indexOf('function EnquiryTimesSection')
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_enq.mjs', src.slice(i, j) + '\nexport { flatGrid }\n')
const { flatGrid } = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_enq.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
// The backend writes flat[d * 24 + h]; the grid must read g[d][h].
const flat = new Array(168).fill(0)
flat[0 * 24 + 9] = 5        // Monday 9am (day 0 is Monday in this grid)
flat[4 * 24 + 17] = 12      // Friday 5pm
flat[6 * 24 + 23] = 1       // Sunday 11pm - the last slot
const g = flatGrid(flat)
ok(g.length === 7 && g.every((r) => r.length === 24), 'reshapes to 7 days x 24 hours')
ok(g[0][9].leads === 5, 'Monday 9am lands on Monday 9am, not rotated')
ok(g[4][17].leads === 12, 'Friday 5pm lands on Friday 5pm')
ok(g[6][23].leads === 1, 'the last slot is not dropped')
ok(g.flat().reduce((a, c) => a + c.leads, 0) === 18, 'every count survives the reshape')
ok(g.flat().every((c) => c.booked === 0), 'booked is zero for outcome grids - there is no booking rate to imply')
ok(flatGrid(null) === null && flatGrid([]) === null, 'an absent grid returns null so the section hides rather than rendering an empty week')
// Business-hours bucketing uses jsDay = (dy + 1) % 7 against a Sunday-zero list.
// Monday..Friday must map to JS 1..5, and Sunday (row 6) to JS 0.
const jsDay = (dy) => (dy + 1) % 7
ok([0, 1, 2, 3, 4].map(jsDay).join() === '1,2,3,4,5', 'grid rows 0-4 are JS weekdays Mon-Fri')
ok(jsDay(5) === 6 && jsDay(6) === 0, 'row 5 is Saturday (6) and row 6 is Sunday (0)')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
