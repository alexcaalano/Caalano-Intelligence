const ROOT = new URL('../', import.meta.url).pathname
// V2 release 2: the story-card pick, the per-channel bar split, and the
// daily spend aggregation behind the Spend and ROAS sparklines.
import fs from 'fs'
const app = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const win = fs.readFileSync(ROOT + 'netlify/functions/windsor.mjs', 'utf8')
const liftFrom = (src) => (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const la = liftFrom(app), lw = liftFrom(win)
const { v2StoryPick, v2ReachSplit } = new Function(['v2StoryPick', 'v2ReachSplit'].map(la).join('\n') + '\nreturn { v2StoryPick, v2ReachSplit }')()
const { spendByDay } = new Function("const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }\n" + lw('spendByDay') + '\nreturn { spendByDay }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// Story pick: by what the line says, never the same line twice, filled from the rest.
const lines = [
  { sev: 'low', tags: ['overall'], text: 'Only 12 opportunities in this period - the rates below are indicative, not a trend.' },
  { sev: 'high', tags: ['overall'], text: 'Biggest leak: 43% of those reaching the step before go on to Assessment (41 of 96).' },
  { sev: 'med', tags: ['overall', 'meta', 'google'], text: 'Meta wins 10% of its 138 leads at $1,062 each; Google 8% of 51.' },
  { sev: 'good', tags: ['overall'], text: 'Won up 27% vs the previous period: 19 from 15.' },
  { sev: 'low', tags: ['overall'], text: 'Cash collected $32,400 of $60,300 closed (54%), 9 of 19 won deals paid in full.' },
]
const cards = v2StoryPick(lines)
ok('three cards', cards.length === 3, cards)
ok('leak first', cards[0].k === 'leak' && /^Biggest leak/.test(cards[0].line.text) && cards[0].go === 'reach')
ok('channels second', cards[1].k === 'channels' && /^Meta wins/.test(cards[1].line.text) && cards[1].go === 'channels')
ok('mover third', cards[2].k === 'moving' && / vs the previous period/.test(cards[2].line.text) && cards[2].go === 'movers')
const noLeak = v2StoryPick(lines.filter((l) => !/^Biggest/.test(l.text)))
ok('leak falls back to the first unused line', noLeak.length === 3 && noLeak[0].line.text.startsWith('Only 12'))
ok('no duplicates', new Set(noLeak.map((c) => c.line)).size === 3)
ok('mover falls back to cash', v2StoryPick(lines.filter((l) => !/vs the previous/.test(l.text)))[2].line.text.startsWith('Cash collected'))
ok('one line, one card', v2StoryPick([lines[1]]).length === 1)
ok('empty', v2StoryPick([]).length === 0 && v2StoryPick(null).length === 0)

// Bar split: other is the remainder; a split larger than the row is scaled to it.
ok('split remainder', JSON.stringify(v2ReachSplit(100, 60, 25)) === JSON.stringify({ meta: 60, google: 25, other: 15 }))
ok('split exact', JSON.stringify(v2ReachSplit(85, 60, 25)) === JSON.stringify({ meta: 60, google: 25, other: 0 }))
ok('split overflow scaled', (() => { const r = v2ReachSplit(50, 60, 40); return r.meta + r.google === 50 && r.other === 0 && r.meta === 30 })(), v2ReachSplit(50, 60, 40))
ok('split zero', JSON.stringify(v2ReachSplit(0, 5, 5)) === JSON.stringify({ meta: 0, google: 0, other: 0 }))
ok('split no channels', JSON.stringify(v2ReachSplit(7, 0, 0)) === JSON.stringify({ meta: 0, google: 0, other: 7 }))

// Daily spend: summed per day, aligned to the day list, unknown days ignored, rounded to cents.
const days = ['2026-09-01', '2026-09-02', '2026-09-03']
const sd = spendByDay(days, [{ date: '2026-09-01', spend: '10.5' }, { date: '2026-09-01', spend: 4.25 }, { date: '2026-09-03', spend: 7 }, { date: '2026-08-31', spend: 99 }], [{ date: '2026-09-02T00:00:00', spend: 3 }])
ok('meta by day', JSON.stringify(sd.meta) === '[14.75,0,7]', sd)
ok('google by day', JSON.stringify(sd.google) === '[0,3,0]', sd)
ok('days echoed', sd.days === days)
ok('empty rows', JSON.stringify(spendByDay(days, [], null).meta) === '[0,0,0]')
ok('garbage spend is zero', spendByDay(days, [{ date: '2026-09-01', spend: 'n/a' }], []).meta[0] === 0)

console.log(`v2story_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
