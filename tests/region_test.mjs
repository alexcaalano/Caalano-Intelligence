const ROOT = new URL('../', import.meta.url).pathname
import fs from 'node:fs'
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const reg = req(ROOT + 'src/data/auregions.json')
const poa = req(ROOT + 'src/data/poashapes.json')
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)

// --- the hierarchy the user asked for
eq(reg.states.length, 8, 'all eight states and territories')
ok(reg.states.some((s) => s.code === 'NSW' && s.name === 'New South Wales'), 'NSW is named in full')
const nsw = reg.districts.filter((r) => r.s === 'NSW')
const grpsNsw = [...new Set(nsw.map((r) => r.g))]
eq(grpsNsw.sort(), ['Greater Sydney', 'Rest of New South Wales'], 'NSW splits into Greater Sydney and the rest')
const gs = nsw.filter((r) => r.g === 'Greater Sydney')
ok(gs.length > 25, `Greater Sydney holds a realistic number of councils (${gs.length})`)
// Councils that must be in Greater Sydney, including the two a naive "name starts
// with Sydney" rule would miss.
// Districts covering the Hills, which is the area the council list gets wrong.
for (const name of ['Baulkham Hills', 'Dural - Wisemans Ferry', 'Blacktown', 'Parramatta', 'Blue Mountains', 'Penrith', 'Wollondilly'])
  ok(gs.some((r) => r.n === name || r.n.startsWith(name)), `${name} is a Greater Sydney district`)
// The council list must carry the same regional split.
const gsC = reg.councils.filter((r) => r.s === 'NSW' && r.g === 'Greater Sydney')
for (const name of ['The Hills', 'Blacktown', 'Parramatta', 'Sutherland', 'Blue Mountains', 'Hawkesbury', 'Penrith', 'Camden'])
  ok(gsC.some((r) => r.n === name), `${name} council is in Greater Sydney`)
// ...and ones that must NOT be.
for (const name of ['Newcastle', 'Wollongong', 'Central Coast'])
  ok(!gsC.some((r) => r.n === name), `${name} is not counted as Greater Sydney`)
// Brisbane is the case name-matching gets wrong.
const gb = reg.councils.filter((r) => r.s === 'QLD' && r.g === 'Greater Brisbane')
for (const name of ['Ipswich', 'Logan', 'Moreton Bay', 'Redland'])
  ok(gb.some((r) => r.n.startsWith(name)), `${name} is in Greater Brisbane`)
for (const name of ['Gold Coast', 'Sunshine Coast', 'Cairns', 'Townsville'])
  ok(!gb.some((r) => r.n === name), `${name} is NOT in Greater Brisbane`)

// --- every council is usable
for (const [kind, list] of [['districts', reg.districts], ['councils', reg.councils]]) {
  ok(list.length > 300, `${kind}: a national list (${list.length})`)
  ok(list.every((r) => r.n && r.s && r.g), `${kind}: every area has a name, state and group`)
  ok(list.every((r) => Array.isArray(r.p) && r.p.length), `${kind}: every area carries postcodes`)
  ok(list.every((r) => r.p.every((p) => /^\d{4}$/.test(p))), `${kind}: every postcode is four digits`)
  const ids = list.map((r) => `${r.s}|${r.n}`)
  eq(new Set(ids).size, ids.length, `${kind}: no area is listed twice`)
  // No PO-box-only postcodes: they have no ground and cannot be drawn.
  const undrawable = list.flatMap((r) => r.p).filter((p) => !poa[p])
  ok(new Set(undrawable).size < 60, `${kind}: almost every postcode offered can be drawn (${new Set(undrawable).size} cannot)`)
}
// The two groupings must cover the same postcodes - one is not a subset.
{
  const a = new Set(reg.districts.flatMap((r) => r.p)), b = new Set(reg.councils.flatMap((r) => r.p))
  const only = [...a].filter((p) => !b.has(p)).length + [...b].filter((p) => !a.has(p)).length
  ok(only < 40, `districts and councils cover essentially the same postcodes (${only} differ)`)
}
// The Hills Shire should carry the postcodes anyone would expect.
const hills = reg.councils.find((r) => r.s === 'NSW' && r.n === 'The Hills')
ok(hills, 'The Hills council is present')
// Councils come from overlaying the ABS postcode and council boundaries, each
// postcode filed under the council holding most of its area. The community
// dataset's own council column filed Castle Hill under Hornsby, Baulkham Hills
// under Parramatta and Kellyville under Blacktown; the overlay does not.
for (const pc of ['2153', '2154', '2155', '2156']) ok(hills.p.includes(pc), `The Hills carries ${pc}`)
const nswC = (n) => reg.councils.find((r) => r.s === 'NSW' && r.n === n)
ok(!nswC('Hornsby').p.includes('2154'), '2154 is not filed under Hornsby')
ok(!nswC('Parramatta').p.includes('2153'), '2153 is not filed under Parramatta')
ok(!nswC('Blacktown').p.includes('2155'), '2155 is not filed under Blacktown')
ok(nswC('Ku-ring-gai').p.includes('2076') && nswC('Woollahra').p.includes('2030') && nswC('Inner West').p.includes('2042'), 'Wahroonga, Vaucluse and Newtown sit under their real councils')
// A council smaller than the postcode around it is kept on borrowed postcodes and
// flagged, so the picker offers it while the per-postcode index keeps the majority.
const orange = nswC('Orange')
ok(orange && orange.b === true && orange.p.includes('2800'), 'Orange is kept, flagged as borrowed, carrying 2800')
ok(nswC('Cabonne').p.includes('2800') && !nswC('Cabonne').b, '2800 still belongs first to Cabonne')
// (A council straddling a state border is listed once per state, as before, so
// the check is on distinct council names.)
const perPc = {}; for (const r of reg.councils) if (!r.b) for (const p of r.p) (perPc[p] = perPc[p] || new Set()).add(r.n)
eq(Object.values(perPc).filter((v) => v.size > 1).length, 0, 'no postcode is filed under two majority councils')
ok(reg.councils.filter((r) => r.b).length < 40, `only a handful of councils are borrowed (${reg.councils.filter((r) => r.b).length})`)
{
  // The app's index must prefer the majority council over a borrowed one.
  const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
  const lift = (name) => {
    const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
    let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
    for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
    return src.slice(a, i + 1)
  }
  const areaIndexOf = new Function("const RA_BUCKET = { 1: 'Metro', 2: 'Regional', 3: 'Rural', 4: 'Remote', 5: 'Remote' }; const STATE_FULL = { NSW: 'New South Wales' }\n" + lift('areaIndexOf') + '\nreturn areaIndexOf')()
  const idx = areaIndexOf(reg)
  eq(idx.get('2800').council, 'Cabonne', 'the index files 2800 under Cabonne, not borrowed Orange')
  eq(idx.get('2154').council, 'The Hills', 'the index files 2154 under The Hills')
  const small = areaIndexOf({ districts: [], councils: [{ s: 'NSW', n: 'Small', p: ['2800'], g: 'x', b: true }, { s: 'NSW', n: 'Big', p: ['2800'], g: 'x' }] })
  eq(small.get('2800').council, 'Big', 'a borrowed council listed first still loses to the majority one')
}

// --- boundaries
ok(Object.keys(poa).length > 2500, `boundaries for most postcodes (${Object.keys(poa).length})`)
const shapeOf = (pc) => poa[pc]
for (const pc of ['2000', '2153', '3000', '4000', '5000', '6000', '7000', '0800']) {
  const s = shapeOf(pc)
  ok(s && s.length, `${pc} has a boundary`)
  if (!s) continue
  ok(s.every((r) => r.length >= 4), `${pc} rings have enough points to be a shape`)
  ok(s.every((r) => r.every(([la, ln]) => la < -8 && la > -45 && ln > 108 && ln < 155)), `${pc} coordinates land inside Australia`)
}
// Sydney CBD's outline must actually sit on Sydney.
{
  const r = poa['2000'][0]
  const lat = r.reduce((a, c) => a + c[0], 0) / r.length
  const lng = r.reduce((a, c) => a + c[1], 0) / r.length
  ok(Math.abs(lat - -33.87) < 0.1 && Math.abs(lng - 151.21) < 0.1, `2000 is drawn over Sydney (${lat.toFixed(2)}, ${lng.toFixed(2)})`)
}
// Coordinates are [lat,lng] for Leaflet, not GeoJSON's [lng,lat] - getting this
// backwards puts every zone in the ocean off Somalia.
ok(Object.values(poa).every((parts) => parts.every((r) => r[0][0] < 0)), 'every ring starts with a negative latitude, so the pair order is [lat,lng]')

// --- suburb -> postcode conversion
eq(reg.sub2pc['BONDI'], '2026', 'BONDI converts to 2026')
eq(reg.sub2pc['BAULKHAM HILLS'], '2153', 'BAULKHAM HILLS converts to 2153')
eq(reg.sub2pc['MELBOURNE'], '3000', 'MELBOURNE converts to 3000')
ok(!reg.sub2pc['NOT A REAL SUBURB'], 'an invented name converts to nothing')
ok(Object.keys(reg.sub2pc).length > 10000, `a broad suburb index (${Object.keys(reg.sub2pc).length})`)
ok(Object.values(reg.sub2pc).every((p) => /^\d{4}$/.test(p)), 'every conversion yields a four-digit postcode')

// --- how much of a real council can actually be drawn
{
  const miss = hills.p.filter((p) => !poa[p])
  ok(miss.length <= hills.p.length * 0.1, `nearly all of The Hills can be drawn (${hills.p.length - miss.length}/${hills.p.length})`)
  // Every council, not just this one - the PO-box rows used to make this fail.
  const bad = reg.councils.filter((r) => r.p.filter((p) => !poa[p]).length > r.p.length * 0.5)
  ok(bad.length <= reg.councils.length * 0.02, `almost every council is mostly drawable (${bad.length} of ${reg.councils.length} are not)`)
  // The measured claim behind defaulting to districts: they group more tightly.
  const km = (a, b) => { const R = 6371, t = (x) => x * Math.PI / 180
    const dLat = t(b[0] - a[0]), dLng = t(b[1] - a[1])
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(q)) }
  const cent = (pcs) => { const cs = pcs.map((p) => poa[p]).filter(Boolean).map((parts) => parts[0][0]); return cs.length ? cs : null }
  const spread = (list) => {
    const v = []
    for (const r of list) {
      const cs = cent(r.p); if (!cs || cs.length < 2) continue
      const c = [cs.reduce((a, x) => a + x[0], 0) / cs.length, cs.reduce((a, x) => a + x[1], 0) / cs.length]
      const ds = cs.map((x) => km(c, x)).sort((a, b) => a - b)
      v.push(ds[Math.floor(ds.length / 2)])
    }
    v.sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const dS = spread(reg.districts), cS = spread(reg.councils)
  ok(dS < cS, `districts really are the tighter grouping (${dS.toFixed(1)}km vs ${cS.toFixed(1)}km median spread) - which is why they are the default`)
}
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
