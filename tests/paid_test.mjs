const ROOT = new URL('../', import.meta.url).pathname
// The blend: leads at their arrival hour against spend at that hour, per channel.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const i = src.indexOf('const PAID_BLOCKS =')
const j = src.indexOf('function PaidByHour')
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_pb.mjs',
  'const enqHourLabel = (h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`)\n' +
  src.slice(i, j) + '\nexport { paidByHour, PAID_BLOCKS }\n')
const { paidByHour, PAID_BLOCKS } = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_pb.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const mk = () => { const g = []; for (let d = 0; d < 7; d++) { const r = []; for (let h = 0; h < 24; h++) r.push({ leads: 0, booked: 0, won: 0, lost: 0 }); g.push(r) } return g }
const meta = mk(), google = mk()
meta[0][10] = { leads: 20, booked: 0, won: 5, lost: 10 }    // Mon 10am -> Morning
meta[1][2]  = { leads: 6,  booked: 0, won: 0, lost: 5 }     // Tue 2am  -> Overnight
google[3][10] = { leads: 10, booked: 0, won: 4, lost: 4 }   // Thu 10am -> Morning
const spend = { meta: new Array(24).fill(0), google: new Array(24).fill(0) }
spend.meta[10] = 600; spend.meta[2] = 300; spend.google[10] = 200

const blocks = paidByHour({ meta, google }, spend, 'block', 'paid')
const morn = blocks.find((r) => r.label === 'Morning'), night = blocks.find((r) => r.label === 'Overnight')
ok(morn.leads === 30 && morn.won === 9, 'Morning sums both channels’ leads and wins')
ok(morn.cost === 800, 'and both channels’ spend for those hours')
ok(Math.abs(morn.cpl - 800 / 30) < 1e-9, `cost per lead is spend / leads (${morn.cpl.toFixed(2)})`)
ok(Math.abs(morn.cpa - 800 / 9) < 1e-9, `cost per won is spend / wins (${morn.cpa.toFixed(2)})`)
ok(night.leads === 6 && night.won === 0 && night.cpa === null, 'an hour with no wins has no cost-per-won rather than infinity')
ok(Math.abs(night.cpl - 50) < 1e-9, 'but it still has a cost per lead')
ok(morn.decided === 23 && Math.abs(morn.winRate - 9 / 23) < 1e-12, 'win rate is wins over DECIDED (9 of 23), not over leads (9 of 30)')
ok(night.winRate === 0, 'a block that won nothing has a zero rate, not a null one')

// Channel isolation - the whole point of splitting by channel.
const metaOnly = paidByHour({ meta, google }, spend, 'block', 'meta')
const mOn = metaOnly.find((r) => r.label === 'Morning')
ok(mOn.leads === 20 && mOn.cost === 600, 'Meta only takes Meta leads and Meta spend')
const googleOnly = paidByHour({ meta, google }, spend, 'block', 'google')
ok(googleOnly.find((r) => r.label === 'Morning').leads === 10, 'Google only takes Google leads')
ok(metaOnly.reduce((a, r) => a + r.leads, 0) + googleOnly.reduce((a, r) => a + r.leads, 0)
   === blocks.reduce((a, r) => a + r.leads, 0), 'the two channels partition the paid total exactly')

// No spend available: the lead columns must still be right, costs simply absent.
const noSpend = paidByHour({ meta, google }, null, 'block', 'paid')
ok(noSpend.find((r) => r.label === 'Morning').leads === 30, 'leads are unaffected when spend is unavailable')
ok(noSpend.every((r) => r.cost === 0 && (r.cpl === 0 || r.cpl === null)), 'and no cost is invented from nothing')

// Hourly granularity, and that the blocks tile the day.
const hours = paidByHour({ meta, google }, spend, 'hour', 'paid')
ok(hours.length === 24 && hours[10].leads === 30 && hours[2].leads === 6, 'hourly rows land on the right hours')
ok(hours.reduce((a, r) => a + r.leads, 0) === blocks.reduce((a, r) => a + r.leads, 0), 'hourly and block cuts agree on the total')
ok(hours.reduce((a, r) => a + r.cost, 0) === 1100, 'and on the total spend')
const cov = []; for (const [, a, b] of PAID_BLOCKS) for (let h = a; h < b; h++) cov.push(h)
ok(cov.length === 24 && new Set(cov).size === 24, 'the day-parts tile 24 hours exactly once')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
