const ROOT = new URL('../', import.meta.url).pathname
// Grouping leads by district/council, which is the reading that needs no zones.
import { createRequire } from 'node:module'
const reg = createRequire(import.meta.url)(ROOT + 'src/data/auregions.json')
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
// Same inversion the component does.
function areaIndexOf(regions) {
  if (!regions) return null
  const idx = new Map()
  for (const kind of ['districts', 'councils']) for (const r of (regions[kind] || [])) for (const p of r.p) {
    let e = idx.get(p); if (!e) { e = {}; idx.set(p, e) }
    e[kind === 'districts' ? 'district' : 'council'] = r.n
    e.state = r.s
  }
  return idx
}
const idx = areaIndexOf(reg)
ok(idx.size > 2500, `every postcode is indexed (${idx.size})`)
ok([...idx.values()].every((e) => e.state), 'every entry carries its state')
const both = [...idx.values()].filter((e) => e.district && e.council).length
ok(both > idx.size * 0.95, `nearly every postcode has both a district and a council (${both}/${idx.size})`)
eq(idx.get('2000').state, 'NSW', '2000 is in NSW')
ok(idx.get('2000').district && idx.get('2000').council, '2000 resolves both ways')
eq(idx.get('3000').state, 'VIC', '3000 is in VIC')

// The grouping itself, with leads deliberately inside and outside the targeted set.
const group = (pts, zones, key) => {
  const mine = new Set()
  for (const a of zones) for (const pl of a.places) { const e = idx.get(pl); if (e && e[key]) mine.add(e[key]) }
  const m = new Map()
  let unknown = 0, unknownLeads = 0
  for (const p of pts) {
    const e = idx.get(p.value)
    const name = e && e[key]
    if (!name) { unknown++; unknownLeads += p.leads; continue }
    let g = m.get(name); if (!g) { g = { name, places: 0, leads: 0, booked: 0, won: 0, mine: mine.has(name) }; m.set(name, g) }
    g.places++; g.leads += p.leads; g.booked += p.booked; g.won += p.won
  }
  const rows = [...m.values()].sort((a, b) => b.leads - a.leads)
  return { rows, dry: [...mine].filter((x) => !m.has(x)), unknown, unknownLeads, mineCount: rows.filter((r) => r.mine).length }
}
const P = (v, l, b, w) => ({ value: v, leads: l, booked: b, won: w })
const pts = [P('2000', 10, 4, 2), P('2010', 6, 2, 1), P('2153', 20, 8, 5), P('2154', 12, 4, 2), P('2155', 14, 5, 3), P('3000', 9, 3, 1), P('0001', 4, 1, 0)]
const zones = [{ places: ['2153', '2155'] }]
{
  const r = group(pts, zones, 'council')
  eq(r.rows.reduce((a, x) => a + x.leads, 0) + r.unknownLeads, 75, 'every lead lands in exactly one row or in "could not be placed"')
  eq(r.unknown, 1, 'the invalid postcode is counted, not dropped')
  eq(r.unknownLeads, 4, 'and so are its leads')
  ok(r.rows[0].leads >= r.rows[r.rows.length - 1].leads, 'rows are sorted by leads, busiest first')
  ok(r.rows.some((x) => x.mine), 'the targeted areas are flagged')
  ok(r.rows.some((x) => !x.mine), 'and so are the ones that are not targeted - which is the point of the view')
  eq(r.mineCount, r.rows.filter((x) => x.mine).length, 'the targeted count matches the flagged rows')
  // A lead outside every targeted area still appears - that is the question this
  // view answers and the zone view cannot.
  const mel = r.rows.find((x) => idx.get('3000').council === x.name)
  ok(mel && !mel.mine, 'Melbourne shows up as an untargeted source rather than vanishing')
}
// Filtering to targeted only must never invent or lose a row.
{
  const r = group(pts, zones, 'council')
  const only = r.rows.filter((x) => x.mine)
  ok(only.length < r.rows.length, 'filtering to targeted areas narrows the table')
  ok(only.every((x) => r.rows.includes(x)), 'and never adds a row that was not there')
}
// Targeted areas that produced nothing are reported, since that is the actionable case.
{
  const r = group([P('2000', 5, 1, 0)], [{ places: ['6000'] }], 'council')
  eq(r.dry.length, 1, 'a targeted area with no leads at all is reported')
  eq(r.rows.length, 1, 'and does not appear as a zero row in the table')
}
// District vs council must give different groupings of the same leads.
{
  const d = group(pts, zones, 'district'), c = group(pts, zones, 'council')
  // 2154 is district "Baulkham Hills" but council "Hornsby" - the groupings are
  // not two names for the same split.
  const dn = new Set(d.rows.map((x) => x.name)), cn = new Set(c.rows.map((x) => x.name))
  ok([...dn].some((x) => !cn.has(x)), `the two groupings genuinely differ (districts: ${[...dn].join(', ')} vs councils: ${[...cn].join(', ')})`)
  eq(d.rows.reduce((a, x) => a + x.leads, 0), c.rows.reduce((a, x) => a + x.leads, 0), 'but both account for the same leads')
}
eq(group([], [], 'council').rows, [], 'no leads, no rows')
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
