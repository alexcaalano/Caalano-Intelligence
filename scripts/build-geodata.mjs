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
//               the ABS SA4 and SA3 name for every postcode. CC BY 4.0.
//   Councils    ABS Local Government Areas 2022 (ASGS Edition 3), via the
//               simplified copy published by geoBoundaries (wmgeolab). © Commonwealth
//               of Australia (Australian Bureau of Statistics), CC BY 4.0. Each
//               postcode is filed under the council most of its area sits in, worked
//               out here by overlaying the two boundary sets - the community dataset
//               carries a council name per postcode too, but it is wrong often enough
//               to matter (it filed Castle Hill under Hornsby and Baulkham Hills under
//               Parramatta), so it is only the fallback for a postcode with no shape.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const POA_URL = 'https://raw.githubusercontent.com/Offbeatmammal/AU_Postcode_Map/main/POA_2021_AUST_GDA2020_15percent.json'
const PC_URL = 'https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.json'
// Stored in Git LFS, so the raw.githubusercontent.com path only returns a pointer.
const LGA_URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/AUS/ADM2/geoBoundaries-AUS-ADM2_simplified.geojson'
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

// --- postcode -> council by area ------------------------------------------------
// Which council a postcode belongs to, decided by where its area actually is: a
// grid of points is laid over each postcode's boundary and every point inside it
// is looked up against the council boundaries. The council holding the most
// points wins, and its share is kept so a genuinely split postcode can be told
// apart from a clean one. Point-in-polygon with holes, bounding boxes to skip
// councils that cannot contain the point.
const bboxOf = (rings) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const r of rings) for (const [x, y] of r) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y } return [a, b, c, d] }
const inRing = (x, y, r) => {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).map((p) => ({ outer: p[0], holes: p.slice(1), bb: bboxOf([p[0]]) }))
const inShape = (x, y, polys) => {
  for (const p of polys) {
    if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) continue
    if (inRing(x, y, p.outer) && !p.holes.some((h) => inRing(x, y, h))) return true
  }
  return false
}
// Planar area of a shape in square degrees with longitude scaled to the latitude,
// good enough for comparing shares; holes subtracted.
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2) }
const shapeArea = (polys) => polys.reduce((t, p) => { const lat = (p.bb[1] + p.bb[3]) / 2, k = Math.cos((lat * Math.PI) / 180); return t + k * (ringArea(p.outer) - p.holes.reduce((h, r) => h + ringArea(r), 0)) }, 0)
// The state suffix geoBoundaries adds to a council whose name is used in more
// than one state ("Bayside (Vic.)"). The state is carried separately.
const lgaName = (n) => String(n || '').replace(/\s*\((NSW|Vic\.|Qld|SA|WA|Tas\.|NT|ACT)\)$/, '')
function poaToLga(poa, lga) {
  const areas = lga.features.map((f) => ({ name: lgaName(f.properties.shapeName), polys: polysOf(f.geometry) })).filter((a) => a.name && a.polys.length)
  const lgaArea = {}
  for (const a of areas) { a.bb = bboxOf(a.polys.map((p) => p.outer)); lgaArea[a.name] = (lgaArea[a.name] || 0) + shapeArea(a.polys) }
  const out = {}
  for (const f of poa.features) {
    const polys = polysOf(f.geometry); if (!polys.length) continue
    const bb = bboxOf(polys.map((p) => p.outer))
    const cands = areas.filter((a) => !(a.bb[2] < bb[0] || a.bb[0] > bb[2] || a.bb[3] < bb[1] || a.bb[1] > bb[3]))
    // Finer grids for small postcodes, so a CBD block still gets enough points
    // to be judged; coarser for the outback ones that would otherwise take minutes.
    let n = 24, tally = null, total = 0
    while (n <= 96) {
      tally = new Map(); total = 0
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = bb[0] + ((i + 0.5) / n) * (bb[2] - bb[0]), y = bb[1] + ((j + 0.5) / n) * (bb[3] - bb[1])
        if (!inShape(x, y, polys)) continue
        total++
        const a = cands.find((c) => inShape(x, y, c.polys))
        if (a) tally.set(a.name, (tally.get(a.name) || 0) + 1)
      }
      if (total >= 40) break
      n *= 2
    }
    if (!tally.size) continue
    const [name, hits] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    const shares = {}; for (const [k, v] of tally) shares[k] = v / total
    out[f.properties.POA_CODE21] = { name, share: Math.round((hits / total) * 100), shares, area: shapeArea(polys) }
  }
  return { by: out, lgaArea, areas }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const [poa, pcs, lga] = await Promise.all([getJson(POA_URL, 'postcode boundaries'), getJson(PC_URL, 'postcode regions'), getJson(LGA_URL, 'council boundaries')])
  process.stdout.write('overlaying postcodes on councils… ')
  const { by: lgaOf, lgaArea, areas: lgaShapes } = poaToLga(poa, lga)
  console.log(`${Object.keys(lgaOf).length} postcodes placed`)

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
  //   council   the LGA, which is what people ask for by name. A postcode goes
  //             to the council most of its area sits in (see poaToLga); the
  //             community dataset's own council column is only used for the few
  //             postcodes that have no boundary to overlay.
  //
  // Both are emitted and the UI lets you switch, with the caveat stated there.
  const build = (nameOf) => {
    const byState = new Map()
    for (const r of live) {
      const st = r.state
      const grp = GREATER[st] && GREATER[st].sa4.includes(String(r.sa4)) ? GREATER[st].label : `Rest of ${STATE_NAME[st] || st}`
      const name = nameOf(r)
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
  const districts = build((r) => r.sa3name)
  const councils = build((r) => (lgaOf[r.postcode] ? lgaOf[r.postcode].name : r.lgaregion))
  // A council smaller than the postcode around it (Orange inside 2800, which is
  // mostly Cabonne) wins no postcode outright and would vanish from the list.
  // It is kept, carrying every postcode that holds at least a fifth of the
  // council's own area, and flagged (b) so the app knows those postcodes belong
  // first to a neighbour: the picker still offers them, the per-postcode index
  // does not let them override the majority council.
  const named = new Set(councils.map((c) => c.n))
  const cover = {}                  // council -> postcode -> share of the council's area
  for (const [pc, o] of Object.entries(lgaOf)) for (const [c, sh] of Object.entries(o.shares)) { if (!lgaArea[c]) continue; (cover[c] = cover[c] || {})[pc] = (sh * o.area) / lgaArea[c] }
  let borrowed = 0
  for (const c of Object.keys(lgaArea)) {
    if (named.has(c)) continue
    const pcs = Object.entries(cover[c] || {}).filter(([, sh]) => sh >= 0.2).map(([pc]) => pc).filter((pc) => live.some((r) => r.postcode === pc))
    if (!pcs.length) continue
    const rows = live.filter((r) => pcs.includes(r.postcode))
    const top = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0][0]
    // The state comes from the localities that actually sit inside the council,
    // not from the postcode as a whole: 0872 is mostly NT localities, but the
    // APY Lands council inside it is in SA.
    const shape = lgaShapes.find((a) => a.name === c)
    const inside = shape ? rows.filter((r) => inShape(Number(r.long), Number(r.lat), shape.polys)) : []
    const base = inside.length ? inside : rows
    const st = top(base.map((r) => r.state))
    const g = top(base.map((r) => (GREATER[r.state] && GREATER[r.state].sa4.includes(String(r.sa4)) ? GREATER[r.state].label : `Rest of ${STATE_NAME[r.state] || r.state}`)))
    councils.push({ s: st, n: c, p: pcs.sort(), g, b: true }); borrowed++
  }
  councils.sort((a, b) => a.s.localeCompare(b.s) || a.g.localeCompare(b.g) || a.n.localeCompare(b.n))
  // How much the overlay disagrees with the community dataset's council column,
  // and which postcodes are a real split rather than a clean fit.
  const moved = [], split = []
  for (const pc of new Set(live.map((r) => r.postcode))) {
    const o = lgaOf[pc]; if (!o) continue
    const src = (live.find((r) => r.postcode === pc) || {}).lgaregion
    if (src && src !== o.name) moved.push(pc)
    if (o.share < 60) split.push(`${pc} ${o.name} ${o.share}%`)
  }
  console.log(`councils         ${moved.length} postcodes differ from the community dataset's council column; ${split.length} sit less than 60% in their council; ${borrowed} councils kept on borrowed postcodes`)
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
    attribution: 'Boundaries and region names: Australian Bureau of Statistics, ASGS Edition 3 and Local Government Areas 2022 (CC BY 4.0), council boundaries via geoBoundaries.',
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
