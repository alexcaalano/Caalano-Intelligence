// The headline sentence. It must not just report the biggest drop - that is
// almost always day 0 -> day 1, which is expected and useless to act on.
const CAD_MAX_DAY = 7
function cliffOf(rows) {
  const solid = rows.filter((r) => r.openCalled >= 10 && r.bookPerLead != null && r.day <= CAD_MAX_DAY)
  if (solid.length < 3) return null
  const base = solid[0]
  if (!base || base.day !== 0 || !base.bookPerLead) return null
  const floor = base.bookPerLead / 2
  let last = base
  for (const r of solid) { if (r.bookPerLead >= floor) last = r; else break }
  const after = solid.find((r) => r.day > last.day) || null
  return { base, last, after, floor }
}
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(a === b, `${m} · got ${a} want ${b}`)
const mk = (rates, called = 50) => rates.map((v, i) => ({ day: i, label: String(i), bookPerLead: v, openCalled: called }))

// The shape from the generated cohort: 22, 14, 10, 5, 3, 1, 6, 0
{
  const c = cliffOf(mk([22, 14, 10, 5, 3, 1, 6, 0]))
  eq(c.last.day, 1, 'holds through day 1 (14% is above half of 22%)')
  eq(c.after.day, 2, 'and day 2 is the first below half')
  ok(c.last.day !== 0, 'never reports "through day 0" when a later day still returns')
}
// A team whose calls keep working all week.
{
  const c = cliffOf(mk([20, 19, 18, 17, 16, 15, 14, 13]))
  eq(c.last.day, 7, 'a flat curve holds all the way through day 7')
  eq(c.after, null, 'and there is no fall-off day to report')
}
// A cliff right after day 0.
{
  const c = cliffOf(mk([30, 5, 4, 3, 2, 1, 1, 1]))
  eq(c.last.day, 0, 'a curve that collapses immediately holds only day 0')
  eq(c.after.day, 1, 'and day 1 is where it fell')
}
// A late bounce must NOT extend the run - the scan stops at the first day below
// the floor, so a noisy day 6 cannot claim the whole week is productive.
{
  const c = cliffOf(mk([20, 12, 4, 3, 2, 1, 18, 1]))
  eq(c.last.day, 1, 'the run stops at the first day below half, not the last')
  eq(c.after.day, 2, 'and reports that day')
}
// Thin days are excluded, so a 100% day built on three leads cannot set the base.
{
  const rows = mk([22, 14, 10, 5, 3, 1, 6, 0])
  rows[0].openCalled = 4
  eq(cliffOf(rows), null, 'with day 0 too thin to trust, no claim is made at all')
}
// Not enough days with data -> say nothing rather than guess.
eq(cliffOf(mk([22, 14])), null, 'two days is not a curve')
eq(cliffOf([]), null, 'no rows')
{
  const rows = mk([0, 0, 0, 0, 0, 0, 0, 0])
  eq(cliffOf(rows), null, 'a cohort that never books produces no claim')
}
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
