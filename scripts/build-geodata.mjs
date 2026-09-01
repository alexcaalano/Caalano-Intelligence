// Rebuilds the two geographic data files the Catchment feature needs.
//
//   src/data/poashapes.json    postcode -> outline rings, for shading a zone as
//                              the real postcode boundaries rather than a blur of
//                              circles around centroids.
//   src/data/auregions.json    state -> capital-city group -> LGA -> postcodes,
//                              so a service area can be built by picking a council
//                              rather than typing postcodes one at a time.
//
// Run with:  node scripts/build-geodata.mjs
// It fetches from the two upstream sources below and writes into src/data. Both
// are open data; the attributions in ATTRIBUTION are rendered in the app.
//
// Sources
//   Boundaries  ABS Australian Statistical Geography Standard (ASGS) Edition 3,
//               Postal Areas 2021, via the pre-simplified copy at
//               Offbeatmammal/AU_Postcode_Map. © Commonwealth of Australia
//               (Australian Bureau of Statistics), CC BY 4.0.
//   Regions     matthewproctor/australianpostcodes, a community dataset carrying
//               the ABS SA4 and LGA name for every postcode. CC BY 4.0.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const POA_URL = 'https://raw.githubusercontent.com/Offbeatmammal/AU_Postcode_Map/main/POA_2021_AUST_GDA2020_15percent.json'
const PC_URL = 'https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.json'
const OUT = path.join(process.cwd(), 'src', 'data')

// The SA4s that make up each Greater Capital City Statistical Area. Taken from
// the ABS structure and listed explicitly rather than matched on name, because
// name matching gets Brisbane wrong: Greater Brisbane includes Ipswich, Logan and
// Moreton Bay, and excludes the Gold Coast and Sunshine Coast, none of which a
// "starts with Brisbane" rule would get right.
const GREATER = {
  NSW: { label: 'Greater Sydney', sa4: ['115', '116', '117', '118', '119', '120', '121', '122', '123', '124', '125', '126', '127', '128'] },
  VIC: { label: 'Greater Melbourne', sa4: ['206', '207', '208', '209', '210', '211', '212', '213', '214'] },
  QLD: { label: 'Greater Brisbane', sa4: ['301', '302', '303', '304', '305', '310', '311', '313', '314'] },
  SA: { label: 'Greater Adelaide', sa4: ['401', '402', '403', '404'] },
  WA: { label: 'Greater Perth', sa4: ['503', '504', '505', '506', '507'] },
  TAS: { label: 'Greater Hobart', sa4: ['601'] },
  NT: { label: 'Greater Darwin', sa4: ['701'] },
  ACT: { label: 'Australian Capital Territory', sa4: ['801'] },
}
const STATE_NAME = {
  NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', SA: 'South Australia',
  WA: 'Western Australia', TAS: 'Tasmania', NT: 'Northern Territory', ACT: 'Australian Capital Territory',
}

async function getJson(url, label) {
  process.stdout.write(`fetching ${label}… `)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`)
  const j = await r.json()
  console.log('ok')
  return j
}

// --- boundary simplification -------------------------------------------------
const perp = (p, a, b) => {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1)
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}
function dp(pts, tol) {
  if (pts.length < 3) return pts
  let idx = 0, max = 0
  for (let i = 1; i < pts.length - 1; i++) { const d = perp(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]]
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)]
}
// Tolerance scaled to each polygon's own size. A fixed one is wrong at both ends:
// a CBD postcode a kilometre across would be flattened to a triangle by the same
// stick that barely touches an outback postcode fifty kilometres wide.
const tolFor = (ring) => {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  return Math.max(0.00025, Math.min(0.006, Math.max(maxX - minX, maxY - minY) / 90))
}
const r4 = (v) => Math.round(v * 1e4) / 1e4   // ~11m, far finer than a shaded area needs
function ring(r) {
  const out = dp(r, tolFor(r)).map(([x, y]) => [r4(y), r4(x)])   // GeoJSON is [lng,lat]; Leaflet wants [lat,lng]
  const ded = []
  for (const p of out) { const l = ded[ded.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) ded.push(p) }
  if (ded.length >= 2) { const a = ded[0], b = ded[ded.length - 1]; if (a[0] === b[0] && a[1] === b[1]) ded.pop() }
  return ded.length >= 4 ? ded : null
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const [poa, pcs] = await Promise.all([getJson(POA_URL, 'postcode boundaries'), getJson(PC_URL, 'postcode regions')])

  // --- shapes ---------------------------------------------------------------
  const shapes = {}
  let parts = 0, coords = 0
  for (const f of poa.features) {
    const g = f.geometry; if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const out = []
    // Outer rings only. Holes exist (an enclave inside another postcode) but are
    // invisible at the zoom anyone reads a catchment at, and cost as much as the
    // outlines that carry the shape.
    for (const p of polys) { const rr = ring(p[0]); if (rr) out.push(rr) }
    if (!out.length) continue
    shapes[f.properties.POA_CODE21] = out
    parts += out.length
    for (const r of out) coords += r.length
  }
  const shapesJson = JSON.stringify(shapes)
  fs.writeFileSync(path.join(OUT, 'poashapes.json'), shapesJson)
  console.log(`poashapes.json   ${Object.keys(shapes).length} postcodes, ${parts} parts, ${coords.toLocaleString()} coords, ${(shapesJson.length / 1048576).toFixed(1)}MB (${(zlib.gzipSync(Buffer.from(shapesJson)).length / 1048576).toFixed(2)}MB gzipped)`)

  // --- regions --------------------------------------------------------------
  // "Post Office Boxes" and "LVR" rows are postcodes with no ground under them: a
  // PO box range is not somewhere a lead lives and has no boundary to draw.
  // Including them seeded every council with phantom postcodes and was the whole
  // reason a sixth of them could not be shaded.
  const live = pcs.filter((r) => r.postcode && r.lat && Number(r.lat) !== 0 && r.state && r.type === 'Delivery Area')
  const sub2pc = {}                 // SUBURB NAME -> postcode, for converting named places
  // Two ways of grouping postcodes into pickable areas, because neither is
  // "right": postcodes do not nest inside council boundaries, so any postcode ->
  // LGA mapping has to pick one council for a postcode that spans several.
  //
  //   district  the ABS SA3, built up from statistical areas designed to follow
  //             real communities. Measurably the tighter grouping - a median
  //             spread of 8km around its own centre against the council list's
  //             23km, and fewer scattered groups.
  //   council   the LGA name, which is what people ask for by name even though
  //             the source assigns some postcodes to a neighbouring council.
  //
  // Both are emitted and the UI lets you switch, with the caveat stated there.
  const build = (field) => {
    const byState = new Map()
    for (const r of live) {
      const st = r.state
      const grp = GREATER[st] && GREATER[st].sa4.includes(String(r.sa4)) ? GREATER[st].label : `Rest of ${STATE_NAME[st] || st}`
      const name = r[field]
      if (!name) continue
      let m = byState.get(st); if (!m) { m = new Map(); byState.set(st, m) }
      let e = m.get(name); if (!e) { e = { st, name, pcs: new Set(), groups: new Map() }; m.set(name, e) }
      // Postcodes always accumulate. An earlier version replaced the set whenever
      // a larger one turned up for the same area, which silently dropped every
      // postcode from the other group - so an area straddling the city boundary
      // lost half of itself.
      e.pcs.add(r.postcode)
      e.groups.set(grp, (e.groups.get(grp) || 0) + 1)
    }
    // An area can straddle the capital-city boundary. It is listed once, under
    // whichever group most of it sits in, rather than appearing twice.
    return [...byState.values()].flatMap((m) => [...m.values()]).map((e) => ({
      s: e.st, n: e.name, p: [...e.pcs].sort(),
      g: [...e.groups.entries()].sort((a, b) => b[1] - a[1])[0][0],
    })).sort((a, b) => a.s.localeCompare(b.s) || a.g.localeCompare(b.g) || a.n.localeCompare(b.n))
  }
  for (const r of live) if (r.locality && !sub2pc[r.locality.toUpperCase()]) sub2pc[r.locality.toUpperCase()] = r.postcode
  const districts = build('sa3name')
  const councils = build('lgaregion')
  const regions = districts
  // ABS Remoteness Areas: the official measure of how far a place sits from
  // services, and the only defensible basis for calling somewhere metro, regional
  // or remote. Stored as its numeric class so the app can present the coarse
  // three-way split most people want while keeping the real five-level detail.
  const RA = { 'Major Cities of Australia': 1, 'Inner Regional Australia': 2, 'Outer Regional Australia': 3, 'Remote Australia': 4, 'Very Remote Australia': 5 }
  const ra = {}
  for (const r of live) { const c = RA[r.RA_2021_NAME]; if (c && !ra[r.postcode]) ra[r.postcode] = c }
  const out = {
    states: Object.keys(STATE_NAME).map((k) => ({ code: k, name: STATE_NAME[k] })),
    districts,
    councils,
    ra,
    raLabels: { 1: 'Major cities', 2: 'Inner regional', 3: 'Outer regional', 4: 'Remote', 5: 'Very remote' },
    sub2pc,
    attribution: 'Boundaries and region names: Australian Bureau of Statistics, ASGS Edition 3 (CC BY 4.0).',
  }
  const regJson = JSON.stringify(out)
  fs.writeFileSync(path.join(OUT, 'auregions.json'), regJson)
  const groups = new Set(regions.map((r) => `${r.s}|${r.g}`))
  console.log(`auregions.json   ${districts.length} districts + ${councils.length} councils + ${Object.keys(ra).length} remoteness across ${groups.size} state groups, ${Object.keys(sub2pc).length} suburb names, ${(regJson.length / 1048576).toFixed(2)}MB (${(zlib.gzipSync(Buffer.from(regJson)).length / 1024).toFixed(0)}KB gzipped)`)

  // How much of what we can shade, we actually have a shape for.
  const need = new Set(regions.flatMap((r) => r.p))
  let have = 0
  for (const p of need) if (shapes[p]) have++
  console.log(`coverage         ${have} of ${need.size} postcodes in a region have a boundary (${Math.round((have / need.size) * 100)}%)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
