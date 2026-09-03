// The classification is the whole point of the change, so test it on the cases
// that distinguish a sound fallback from an inflated one.
const now = Date.now(), DAY = 86400000
const stageMeta = new Map([
  ['s0', { pipelineId: 'p', name: 'New Lead', pos: 0 }],
  ['s1', { pipelineId: 'p', name: 'Called #1', pos: 1 }],
  ['s2', { pipelineId: 'p', name: 'Booked', pos: 2 }],
])
// Mirrors the classification in buildStageTiming.
const classify = (o) => {
  const meta = stageMeta.get(o.stageId)
  const firstStage = !meta || meta.pos === 0
  return o.dated ? 'exact' : (firstStage ? 'assumed' : 'inflated')
}
const opps = [
  { stageId: 's1', dated: true,  note: 'moved, and the CRM recorded when' },
  { stageId: 's2', dated: true,  note: 'moved, and the CRM recorded when' },
  { stageId: 's0', dated: false, note: 'never moved - created date IS the entry date' },
  { stageId: 's0', dated: false, note: 'never moved' },
  { stageId: 's2', dated: false, note: 'moved but no date - figure overstates' },
  { stageId: 'sX', dated: false, note: 'unknown stage, no date - treated as first' },
]
let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const got = opps.map(classify)
ok(got[0] === 'exact' && got[1] === 'exact', 'a recorded stage-change date is exact, wherever the deal sits')
ok(got[2] === 'assumed' && got[3] === 'assumed', 'no date but still in the first stage is sound, not flagged')
ok(got[4] === 'inflated', 'no date past the first stage is flagged as an upper bound')
ok(got[5] === 'assumed', 'an unresolvable stage is treated as first rather than accused of inflating')

// The direction of the error matters: the fallback can only ever overstate.
const created = now - 90 * DAY, entered = now - 1 * DAY
const reported = Math.max(0, (now - created) / DAY)   // the fallback
const truth = Math.max(0, (now - entered) / DAY)
ok(reported > truth, `the fallback overstates and never understates (${Math.round(reported)}d reported vs ${Math.round(truth)}d actual)`)

// Counts must partition: every deal lands in exactly one bucket.
const tally = got.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {})
ok((tally.exact || 0) + (tally.assumed || 0) + (tally.inflated || 0) === opps.length, 'every deal is counted exactly once')
ok(tally.inflated === 1 && tally.exact === 2 && tally.assumed === 3, `buckets: ${JSON.stringify(tally)}`)

// And the flag only fires when there is something to warn about.
const clean = [{ stageId: 's1', dated: true }, { stageId: 's0', dated: false }].map(classify)
ok(!clean.includes('inflated'), 'a client whose CRM records stage moves sees no warning at all')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
