// "Lost at this stage" vs "lost at this stage or later", with two pipelines that
// share a stage name at DIFFERENT positions - the case a naive implementation
// gets wrong by treating a shared name as a shared position.
const stageOrder = {
  ADHD:   { 'New Lead': 0, 'Called #1': 1, '15 Minute Call': 2, 'Booking Made': 3 },
  Allied: { '15 Minute Call': 0, 'Called #1': 1, 'Booking Made': 2 }, // same names, different order
}
const posIn = (pipeline, stage) => { const so = stageOrder[pipeline]; return so && so[stage] !== undefined ? so[stage] : null }
const facts = [
  { pipeline: 'ADHD', stage: 'New Lead', stagePos: 0 },
  { pipeline: 'ADHD', stage: 'Called #1', stagePos: 1 },
  { pipeline: 'ADHD', stage: '15 Minute Call', stagePos: 2 },
  { pipeline: 'ADHD', stage: 'Booking Made', stagePos: 3 },
  { pipeline: 'Allied', stage: '15 Minute Call', stagePos: 0 },
  { pipeline: 'Allied', stage: 'Called #1', stagePos: 1 },
  { pipeline: 'Allied', stage: 'Booking Made', stagePos: 2 },
]
const build = (rows, cumulative) => {
  const m = new Map()
  const add = (k) => m.set(k, (m.get(k) || 0) + 1)
  if (cumulative) {
    const names = new Set()
    for (const r of rows) for (const n of Object.keys(stageOrder[r.pipeline] || {})) names.add(n)
    for (const r of rows) for (const n of names) { const p = posIn(r.pipeline, n); if (p != null && r.stagePos >= p) add(n) }
  } else for (const r of rows) add(r.stage)
  return m
}
let f = 0
const ok = (c, m) => { if (!c) { f++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const at = build(facts, false), be = build(facts, true)

ok([...at.values()].reduce((a, b) => a + b, 0) === facts.length, 'exclusive mode: rows add up to the total')
ok(at.get('Called #1') === 2 && at.get('Booking Made') === 2, 'exclusive counts are where each deal actually died')
// ADHD: New Lead is position 0, so every ADHD deal (4) reached it. Allied has no
// such stage, so its 3 deals are excluded entirely - not silently counted in.
ok(be.get('New Lead') === 4, `"New Lead or later" = 4, only the pipeline that has that stage (got ${be.get('New Lead')})`)
// Booking Made is last in both: only the deals that died there. 1 + 1.
ok(be.get('Booking Made') === 2, `"Booking Made or later" = 2 (got ${be.get('Booking Made')})`)
// 15 Minute Call: ADHD pos 2 -> deals at pos >=2 are 2 of 4. Allied pos 0 -> all 3.
ok(be.get('15 Minute Call') === 5, `position is read per pipeline, not per name: 2 + 3 = 5 (got ${be.get('15 Minute Call')})`)
// Called #1: ADHD pos 1 -> 3 deals; Allied pos 1 -> 2 deals.
ok(be.get('Called #1') === 5, `"Called #1 or later" = 3 + 2 = 5 (got ${be.get('Called #1')})`)
ok([...be.values()].every((v) => v <= facts.length), 'no cumulative row can exceed the total')
ok([...be.entries()].every(([k, v]) => v >= (at.get(k) || 0)), 'every cumulative count is at least its exclusive count')
ok([...be.values()].reduce((a, b) => a + b, 0) > facts.length, 'cumulative rows overlap and so do not add up - as documented')
// A name-blind implementation would give 15 Minute Call = 2+3 only by luck; check
// the failure mode directly: sharing positions across pipelines would give 4.
const naive = facts.filter((r) => r.stagePos >= 2).length
ok(naive !== be.get('15 Minute Call'), `a shared-position implementation would say ${naive}, not ${be.get('15 Minute Call')}`)
console.log(f ? `\n${f} failed` : '\nall passed')
process.exit(f ? 1 : 0)
