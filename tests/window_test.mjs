const ROOT = new URL('../', import.meta.url).pathname
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const i = src.indexOf('const normCdf =')
const j = src.indexOf('function EnqWindowTest')
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_ww.mjs',
  src.slice(i, j) + '\nexport { normCdf, twoProp, hoursInWindow, hourWrap }\n')
const { normCdf, twoProp, hoursInWindow, hourWrap } = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_ww.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }

// --- the wrap, which is where the stated hypothesis lives -------------------
ok(hoursInWindow(9, 12).join() === '9,10,11', 'a simple window is the hours up to but not including the end')
ok(hoursInWindow(12, 3).join() === '12,13,14,15,16,17,18,19,20,21,22,23,0,1,2', 'noon to 3am wraps past midnight (the actual hypothesis)')
ok(hoursInWindow(21, 6).join() === '21,22,23,0,1,2,3,4,5', '9pm to 6am wraps')
ok(hoursInWindow(0, 6).join() === '0,1,2,3,4,5', 'midnight to 6am does not wrap')
ok(new Set(hoursInWindow(12, 3)).size === 15 && hourWrap(12, 3) === 15, 'the hour count matches the window length')
ok(hoursInWindow(0, 0).length === 24, 'a window from an hour back to itself is the whole day')
for (const [a, b] of [[9, 12], [12, 3], [21, 6], [0, 6], [23, 1]]) {
  const w = new Set(hoursInWindow(a, b))
  const rest = [...Array(24).keys()].filter((h) => !w.has(h))
  ok(w.size + rest.length === 24 && [...w].every((h) => !rest.includes(h)), `window ${a}->${b} and its complement partition the day exactly once`)
}

// --- the test ---------------------------------------------------------------
ok(Math.abs(normCdf(0) - 0.5) < 1e-6, 'the normal CDF is centred')
ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3, 'and calibrated at 1.96 sigma')
let t = twoProp(10, 100, 30, 100)
ok(t.diff < 0 && t.p < 0.01, `10% vs 30% on 100 each is a clear difference (p=${t.p.toFixed(4)})`)
t = twoProp(28, 100, 30, 100)
ok(t.p > 0.05, `28% vs 30% on 100 each is not (p=${t.p.toFixed(2)})`)
// The trap: a big gap on tiny numbers must not read as significant.
t = twoProp(0, 4, 30, 100)
ok(t.p > 0.05, `0 of 4 against 30 of 100 is not significant despite a 30pp gap (p=${t.p.toFixed(2)})`)
// The same gap with real volume is.
t = twoProp(0, 40, 30, 100)
ok(t.p < 0.05, `0 of 40 against 30 of 100 IS significant (p=${t.p.toFixed(4)})`)
ok(twoProp(5, 20, 5, 20).diff === 0 && twoProp(5, 20, 5, 20).p > 0.99, 'identical rates give no difference and no surprise')
ok(twoProp(1, 10, 0, 0) === null && twoProp(0, 0, 1, 10) === null, 'an empty side returns nothing rather than dividing by zero')
ok(twoProp(0, 10, 0, 10).p === 1, 'two groups that never win are not different from each other')
// Symmetry: swapping the groups flips the sign and keeps the p-value.
const a = twoProp(12, 60, 30, 90), b = twoProp(30, 90, 12, 60)
ok(Math.abs(a.diff + b.diff) < 1e-12 && Math.abs(a.p - b.p) < 1e-12, 'the test is symmetric in its two groups')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
