// A lead must be counted once per place. The bug this guards: the postcode was
// bumped, then bumped again by the answer loop when the postcode question itself
// looked location-shaped, so the lead tally doubled while the people list - which
// dedupes on contact id - did not. A location read "4 leads" and could only ever
// show two of them.
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
const LOC_RE = /post ?code|suburb|location|area|region|where/i

const bumpLocFactory = () => {
  const m = new Map()
  const bumpLoc = (value, person) => {
    if (!value) return
    let a = m.get(value)
    if (!a) { a = { value, leads: 0, people: [], _seen: new Set() }; m.set(value, a) }
    a.leads++
    if (person && person.contactId && !a._seen.has(person.contactId) && a.people.length < 60) { a._seen.add(person.contactId); a.people.push(person) }
  }
  return { m, bumpLoc }
}
// The shipped behaviour: one Set per contact, every place counted once.
const runFixed = (contacts) => {
  const { m, bumpLoc } = bumpLocFactory()
  for (const c of contacts) {
    const hit = new Set()
    const once = (v) => { const k = String(v || '').trim().toUpperCase(); if (!k || hit.has(k)) return; hit.add(k); bumpLoc(v, { contactId: c.id }) }
    if (c.pc) once(c.pc)
    for (const [q, v] of Object.entries(c.answers || {})) if (LOC_RE.test(q)) once(v)
  }
  return m
}
// The old behaviour, kept so the regression is demonstrated rather than asserted.
const runOld = (contacts) => {
  const { m, bumpLoc } = bumpLocFactory()
  for (const c of contacts) {
    if (c.pc) bumpLoc(c.pc, { contactId: c.id })
    for (const [q, v] of Object.entries(c.answers || {})) if (LOC_RE.test(q)) bumpLoc(v, { contactId: c.id })
  }
  return m
}

// Four contacts whose form asks "Postcode" - the exact shape that doubled.
const C = [1, 2, 3, 4].map((i) => ({ id: `c${i}`, pc: '2117', answers: { Postcode: '2117' } }))
{
  const oldM = runOld(C).get('2117')
  eq([oldM.leads, oldM.people.length], [8, 4], 'the old path double-counted: 8 leads for 4 people')
  const m = runFixed(C).get('2117')
  eq([m.leads, m.people.length], [4, 4], 'each lead is now counted once, and the lead count matches the detail')
}
// The general invariant: for any contact set, leads == distinct contacts per place.
{
  const mixed = [
    { id: 'a', pc: '2117', answers: { Postcode: '2117', Suburb: 'PARRAMATTA' } },
    { id: 'b', pc: '2151', answers: { 'Which area?': '2151' } },
    { id: 'c', pc: '2117', answers: {} },
    { id: 'd', answers: { Location: '2117' } },
    { id: 'e', pc: '2117', answers: { Postcode: ' 2117 ' } },   // whitespace variant
  ]
  const m = runFixed(mixed)
  eq(m.get('2117').leads, 4, 'four distinct contacts in 2117')
  eq(m.get('2117').people.length, 4, 'and detail for all four')
  eq(m.get('2151').leads, 1, 'one contact in 2151')
  eq(m.get('PARRAMATTA').leads, 1, 'a suburb answer is its own place')
  for (const [, a] of m) eq(a.leads, a.people.length, `${a.value}: lead count equals the number of leads with detail`)
}
// Case and whitespace must not create a second place for the same contact.
{
  const m = runFixed([{ id: 'x', pc: '2117', answers: { Suburb: 'parramatta', Location: 'PARRAMATTA' } }])
  eq(m.get('parramatta').leads, 1, 'the same suburb in two cases counts once')
  ok(!m.has('PARRAMATTA'), 'and does not open a second place under a different case')
}
// A genuinely different second place still counts.
{
  const m = runFixed([{ id: 'y', pc: '2117', answers: { Suburb: 'PENRITH' } }])
  eq(m.get('2117').leads, 1, 'the postcode counts')
  eq(m.get('PENRITH').leads, 1, 'and so does a different location answer - this is not over-deduping')
}
// Non-location questions are ignored.
{
  const m = runFixed([{ id: 'z', pc: '2117', answers: { Budget: '2117', Name: 'Bob' } }])
  eq(m.size, 1, 'a budget that happens to look like a postcode is not a place')
}
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
