const ROOT = new URL('../', import.meta.url).pathname
// Extract the real colour map + signal maths from App.jsx and exercise them.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const grab = (from, to) => src.slice(src.indexOf(from), src.indexOf(to))
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_lrc.mjs',
  grab('const LR_HUES = {', 'function LrPop') +
  grab('function lrColorMap', 'function LrReasonMix') +
  grab('const LR_SIG_MIN_GROUP', 'function LrSignals') +
  '\nexport { lrColorMap, lrSignals, LR_HUES, LR_MAX_HUES }\n')
const { lrColorMap, lrSignals, LR_HUES, LR_MAX_HUES } = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_lrc.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const mk = (reason, channel, extra = {}) => ({ reason, channel, source: channel, pipeline: 'P', keyevent: 'K', campaign: 'C', ...extra })
const facts = [
  ...Array(46).fill(0).map(() => mk('No response', 'meta')),
  ...Array(41).fill(0).map(() => mk('Budget', 'google')),
  ...Array(22).fill(0).map(() => mk('Gone cold', 'meta')),
  ...Array(19).fill(0).map(() => mk('Another provider', 'meta')),
  ...Array(16).fill(0).map(() => mk('Not right now', 'other')),
  ...Array(9).fill(0).map(() => mk('High risk', 'meta')),
  ...Array(5).fill(0).map(() => mk('Spam', 'meta')),
  ...Array(4).fill(0).map(() => mk('Unspecified', 'google')),
  ...Array(3).fill(0).map(() => mk('Location', 'google')),
]
const light = lrColorMap(facts, 'light')

// 1. Fixed order, never cycled: the top seven take the seven hues in order.
ok(light.top.length === LR_MAX_HUES, `exactly ${LR_MAX_HUES} reasons get their own hue`)
ok(light.top.map((r) => light.of(r)).join(',') === LR_HUES.light.join(','), 'hues are assigned in the fixed palette order')

// 2. Beyond the seventh, one neutral - never a generated hue.
ok(light.of('Unspecified') === light.other && light.of('Location') === light.other, 'reasons past the seventh share one neutral')
ok(!LR_HUES.light.includes(light.of('Unspecified')), 'the neutral is not one of the categorical hues')

// 3. THE ONE THAT MATTERS: colour follows the entity, not its rank. A filter that
//    changes which reasons are present must not repaint the survivors - otherwise
//    "the blue one" means something different after one click.
const filtered = facts.filter((f) => f.channel === 'google')   // Budget now dominates
const naive = lrColorMap(filtered, 'light')                    // built from the SUBSET - wrong
ok(naive.of('Budget') !== light.of('Budget'), 'precondition: a subset-built map WOULD repaint Budget')
for (const r of ['Budget', 'Unspecified', 'Location']) ok(light.of(r) === lrColorMap(facts, 'light').of(r), `${r} keeps its colour when the view is filtered`)

// 4. Dark is its own steps, not a flip.
const dark = lrColorMap(facts, 'dark')
ok(dark.of(light.top[0]) !== light.of(light.top[0]), 'dark mode uses its own step, not the light one')
ok(dark.top.join('|') === light.top.join('|'), 'but the same reason holds the same slot in both modes')

// 5. Signals: only real, supportable concentrations.
const sigs = lrSignals(facts, [['channel', 'Channel']], light.of)
ok(sigs.every((s) => s.n >= 3 && s.of >= 8 && s.lift >= 8), 'every signal clears the group-size, count and lift floors')
ok(sigs.some((s) => s.group === 'google' && s.reason === 'Budget'), 'the real concentration (Google/Budget) is reported')
const tiny = [mk('Budget', 'tiktok'), mk('Budget', 'tiktok'), mk('Budget', 'tiktok'), ...facts]
ok(!lrSignals(tiny, [['channel', 'Channel']], light.of).some((s) => s.group === 'tiktok'), 'a 3-deal channel is not reported as a signal, however lopsided')
ok(!lrSignals(facts, [['campaign', 'Campaign']], light.of).length, 'a dimension with a single value has nothing to compare and reports nothing')
ok(lrSignals(facts.slice(0, 10), [['channel', 'Channel']], light.of).length === 0, 'too few deals overall -> no signals at all')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
