const ROOT = new URL('../', import.meta.url).pathname
// Metro / regional / remote, and the cut-then-group behaviour.
import { createRequire } from 'node:module'
const reg = createRequire(import.meta.url)(ROOT + 'src/data/auregions.json')
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
// Must mirror App.jsx: outer regional is the country-town band everyone calls
// RURAL, so it is named that rather than folded in with the regional centres.
const RA_BUCKET = { 1: 'Metro', 2: 'Regional', 3: 'Rural', 4: 'Remote', 5: 'Remote' }
const STATE_FULL = { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', SA: 'South Australia', WA: 'Western Australia', TAS: 'Tasmania', NT: 'Northern Territory', ACT: 'Australian Capital Territory' }
function areaIndexOf(regions) {
  const idx = new Map()
  for (const kind of ['districts', 'councils']) for (const r of (regions[kind] || [])) for (const p of r.p) {
    let e = idx.get(p); if (!e) { e = {}; idx.set(p, e) }
    e[kind === 'districts' ? 'district' : 'council'] = r.n
    e.state = r.s; e.stateName = STATE_FULL[r.s] || r.s
  }
  for (const [p, c] of Object.entries(regions.ra || {})) {
    let e = idx.get(p); if (!e) { e = {}; idx.set(p, e) }
    e.ra = c; e.remoteness = RA_BUCKET[c] || null; e.raName = regions.raLabels[c]
  }
  return idx
}
const idx = areaIndexOf(reg)

// --- the classification is the ABS one, and it is right where we can check it
ok(Object.keys(reg.ra).length > 2500, `remoteness for most postcodes (${Object.keys(reg.ra).length})`)
eq(idx.get('2000').remoteness, 'Metro', 'Sydney CBD is metro')
eq(idx.get('3000').remoteness, 'Metro', 'Melbourne CBD is metro')
eq(idx.get('2153').remoteness, 'Metro', 'Baulkham Hills is metro')
eq(idx.get('2880').remoteness, 'Remote', 'Broken Hill is remote')
eq(idx.get('2795').remoteness, 'Rural', 'Bathurst (outer regional) reads as rural')
eq(idx.get('3350').remoteness, 'Regional', 'Ballarat (inner regional) reads as regional')
eq(idx.get('2880').raName, 'Very remote', 'and the exact ABS class is kept for the hover')
// Every bucket is populated; a classification that collapses to one value is useless.
{
  const t = {}
  for (const [, e] of idx) if (e.remoteness) t[e.remoteness] = (t[e.remoteness] || 0) + 1
  ok(Object.keys(t).length === 4, `all four bands are populated (${JSON.stringify(t)})`)
  ok(t.Metro > 300 && t.Regional > 200 && t.Rural > 300 && t.Remote > 300, 'each band holds a realistic share of the country')
  // The split that justifies naming them separately: regional and rural must not
  // be near-duplicates of each other.
  ok(Math.min(t.Regional, t.Rural) > 200, `regional and rural are both substantial (${t.Regional} vs ${t.Rural}), not one band split hairs`)
}
ok(Object.values(reg.ra).every((c) => c >= 1 && c <= 5), 'every stored class is a real ABS level')

// --- cut then group
const P = (v, l, b, w) => ({ value: v, leads: l, booked: b, won: w })
const pts = [P('2000', 30, 10, 5), P('2153', 20, 8, 4), P('2795', 12, 3, 1), P('2880', 6, 1, 0), P('0001', 5, 0, 0)]
const group = (key, cut) => {
  const m = new Map(); let unknown = 0, cutOutLeads = 0
  for (const p of pts) {
    const e = idx.get(p.value); const name = e && e[key]
    if (!name) { unknown++; continue }
    if (cut !== 'all' && e.remoteness !== cut) { cutOutLeads += p.leads; continue }
    let g = m.get(name); if (!g) { g = { name, leads: 0 }; m.set(name, g) }
    g.leads += p.leads
  }
  const rows = [...m.values()].sort((a, b) => b.leads - a.leads)
  return { rows, unknown, cutOutLeads, totalLeads: rows.reduce((a, r) => a + r.leads, 0) }
}
{
  const all = group('remoteness', 'all')
  eq(all.totalLeads, 68, 'every placeable lead is banded')
  eq(all.unknown, 1, 'the unplaceable one is counted separately')
  eq(all.rows.find((r) => r.name === 'Metro').leads, 50, 'metro leads add up')
  eq(all.rows.find((r) => r.name === 'Rural').leads, 12, 'rural leads add up')
  eq(all.rows.find((r) => r.name === 'Remote').leads, 6, 'remote leads add up')
}
// The cut must apply to whatever grouping is showing, and account for what it removed.
{
  const c = group('council', 'Rural')
  eq(c.totalLeads, 12, 'cutting to rural leaves only the rural leads')
  eq(c.cutOutLeads, 56, 'and says how many it removed')
  ok(c.rows.every((r) => idx.get('2795').council === r.name || r.leads === 0), 'only rural councils survive the cut')
  const m = group('council', 'Metro')
  eq(m.totalLeads, 50, 'cutting to metro leaves the metro leads')
  eq(m.totalLeads + c.totalLeads + group('council', 'Regional').totalLeads + group('council', 'Remote').totalLeads, group('council', 'all').totalLeads, 'the four cuts partition the placeable leads exactly')
}
// Shares are of what is on screen after the cut, not of everything.
{
  const c = group('council', 'Rural')
  const share = c.rows.reduce((a, r) => a + r.leads / c.totalLeads, 0)
  ok(Math.abs(share - 1) < 1e-9, 'shares within a cut sum to 100%')
}
// State grouping.
{
  const st = group('stateName', 'all')
  ok(st.rows.some((r) => r.name === 'New South Wales'), 'state grouping names states in full')
  eq(st.totalLeads, 68, 'and accounts for the same leads')
}
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
