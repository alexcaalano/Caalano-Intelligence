// The figures behind a calendar tile: show rate on resulted appointments,
// cancellation against bookings, unresulted as the hygiene number.
import fs from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const calShowOf = new Function(lift('calShowOf') + '\nreturn calShowOf')()
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
const r = { kind: 'calendar', fromCal: 47, occurred: 15, shown: 8, noShow: 4, cancelled: 4 }
const s = calShowOf(r, { kind: 'calendar', fromCal: 30, occurred: 10, shown: 2, noShow: 8 })
eq(Math.round(s.rate), 67, 'show rate is shown ÷ (shown + no-show), not ÷ occurred')
eq(s.resulted, 12, 'resulted = shown + no-show')
eq(s.unresulted, 3, 'unresulted = occurred - resulted')
eq(s.cancelled, 4, 'cancellations carried')
eq(s.booked, 47, 'bookings carried for the cancellation rate')
eq(Math.round(s.prevRate), 20, 'previous rate on the same basis')
eq(calShowOf({ kind: 'calendar', fromCal: 5, occurred: 3, shown: 0, noShow: 0 }, null).rate, null, 'no resulted appointments → no rate, not 0%')
eq(calShowOf({ kind: 'calendar', fromCal: 0, occurred: 0 }, null), null, 'nothing booked and nothing occurred → no line')
eq(calShowOf({ kind: 'stage', count: 9 }, null), null, 'stage rows have no show line')
eq(calShowOf({ kind: 'calendar', fromCal: 10, occurred: 4, shown: 4 }, null).rate, 100, 'missing noShow reads as zero')
console.log(`${n} assertions, ${f} failed`)
if (f) process.exit(1)
