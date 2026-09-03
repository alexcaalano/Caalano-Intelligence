// The key-event test, mirroring formKeyEvents. The point of this suite is the bug
// it would have caught: a person record with no stagePos silently reaches NOTHING,
// so every stage-type key event counts zero and the column looks like real data.
const WON_RE = /^won$|won/i
const stagePosMap = (pipes) => {
  const m = new Map()
  for (const p of pipes) (p.stages || []).forEach((st, i) => { m.set(p.id + '::' + st.name, i); if (!m.has(st.name)) m.set(st.name, i) })
  return m
}
function evaluator(pipes, events) {
  const stagePos = stagePosMap(pipes)
  const posAt = (pipeline, name) => (pipeline && stagePos.has(pipeline + '::' + name) ? stagePos.get(pipeline + '::' + name) : stagePos.get(name))
  const keyPos = (k) => (k.kind === 'calendar' ? (k.stage ? posAt(k.pipeline, k.stage) : null) : posAt(k.pipeline, k.ref))
  const reachedStage = (p, k) => {
    const kp = keyPos(k)
    if (kp == null || p.stagePos == null) return false
    if (k.pipeline && p.pipelineId && k.pipeline !== p.pipelineId) return false
    return p.stagePos >= kp
  }
  const reached = (p, k) => {
    if (!p) return false
    if (k.kind === 'won' || WON_RE.test(k.label)) return p.status === 'won'
    if (k.kind === 'calendar') {
      const refs = k.refs || [k.ref]
      return (p.calendars || []).some((c) => refs.includes(c.name) || refs.includes(c.id))
    }
    return reachedStage(p, k)
  }
  return { reached }
}
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)

const PIPES = [{ id: 'p1', stages: [{ name: 'New Lead' }, { name: '15 Minute Call' }, { name: 'Quoted' }, { name: 'Booking Made' }] }]
const EV = [
  { kind: 'stage', label: '15 Minute Call', ref: '15 Minute Call', pipeline: 'p1' },
  { kind: 'stage', label: 'Quoted', ref: 'Quoted', pipeline: 'p1' },
  { kind: 'calendar', label: 'Consult', ref: 'Consult', refs: ['Consult'] },
  { kind: 'won', label: 'Won', ref: 'Won' },
]
const ke = evaluator(PIPES, EV)
const P = (o) => ({ pipelineId: 'p1', status: 'open', calendars: [], ...o })

// --- the regression this suite exists for
{
  const withPos = P({ stagePos: 2 })
  const without = { ...withPos, stagePos: undefined }
  ok(ke.reached(withPos, EV[0]), 'a lead at Quoted has reached the 15 Minute Call')
  ok(!ke.reached(without, EV[0]), 'the SAME lead with no stagePos reaches nothing - which is exactly how the location columns read zero while looking like data')
}
// --- stage events are cumulative: reaching a later stage means passing the earlier one
{
  const at = (i) => P({ stagePos: i })
  eq([0, 1, 2, 3].map((i) => ke.reached(at(i), EV[0])), [false, true, true, true], 'the 15 Minute Call is reached from its own stage onward')
  eq([0, 1, 2, 3].map((i) => ke.reached(at(i), EV[1])), [false, false, true, true], 'Quoted is reached from Quoted onward')
  ok(ke.reached(at(3), EV[0]) && ke.reached(at(3), EV[1]), 'a lead at the end has reached every earlier event')
}
// --- a key event pinned to one pipeline must not count another pipeline's leads
{
  const other = P({ stagePos: 3, pipelineId: 'p2' })
  ok(!ke.reached(other, EV[0]), "a lead in another pipeline does not count toward this pipeline's event")
  ok(ke.reached(P({ stagePos: 3, pipelineId: 'p1' }), EV[0]), 'but its own pipeline does')
  ok(ke.reached({ stagePos: 3, status: 'open', calendars: [] }, EV[0]), 'a lead with no pipeline recorded is not excluded')
}
// --- won counts on status, never on stage
{
  ok(ke.reached(P({ status: 'won', stagePos: 0 }), EV[3]), 'won counts on status even from the first stage')
  ok(!ke.reached(P({ status: 'open', stagePos: 3 }), EV[3]), 'and the last stage is not a win')
  ok(!ke.reached(P({ status: 'lost', stagePos: 3 }), EV[3]), 'nor is a lost deal')
}
// --- calendar events look at the bookings, not the stage
{
  ok(ke.reached(P({ calendars: [{ name: 'Consult' }] }), EV[2]), 'a lead booked into the calendar has reached it')
  ok(!ke.reached(P({ calendars: [{ name: 'Something else' }] }), EV[2]), 'another calendar does not count')
  ok(!ke.reached(P({ stagePos: 3, calendars: [] }), EV[2]), 'and neither does being deep in the pipeline with no booking')
}
// --- counting across a set of leads, which is what a table cell does
{
  const people = [P({ stagePos: 0 }), P({ stagePos: 1 }), P({ stagePos: 2 }), P({ stagePos: 3, status: 'won' }), P({ stagePos: null })]
  const count = (k) => people.reduce((a, p) => a + (ke.reached(p, k) ? 1 : 0), 0)
  eq(count(EV[0]), 3, 'three of five reached the 15 Minute Call')
  eq(count(EV[1]), 2, 'two reached Quoted')
  eq(count(EV[3]), 1, 'one won')
  ok(count(EV[0]) >= count(EV[1]), 'an earlier event is never reached by fewer than a later one')
  ok(count(EV[1]) >= count(EV[3]), 'and the funnel holds through to won')
  eq(count(EV[2]), 0, 'nobody booked the calendar')
}
// --- defensive
ok(!ke.reached(null, EV[0]), 'no person, no event')
ok(!ke.reached(P({ stagePos: 2 }), { kind: 'stage', label: 'Ghost', ref: 'A Stage That No Longer Exists', pipeline: 'p1' }), 'a renamed or deleted stage counts nobody rather than everybody')
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
