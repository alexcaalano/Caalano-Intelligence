// Invariant test for the Lost Reasons pivot maths, using the same expressions
// as the component. Synthetic facts, deliberately lumpy.
const DIMS = ['reason', 'channel', 'source', 'pipeline', 'stage', 'campaign', 'creative', 'keyword']
const pick = (a, i) => a[i % a.length]
const facts = Array.from({ length: 400 }, (_, i) => ({
  reason: pick(['Budget', 'Could Not Contact/No response', 'Gone cold', 'Not right now', 'Unspecified', 'Spam'], i * 7),
  channel: pick(['meta', 'google', 'other'], i * 3),
  source: pick(['Paid Social', 'Google Ads', 'Direct', 'Referral'], i * 5),
  pipeline: pick(['Allied Health', 'ADHD'], i),
  stage: pick(['15 Minute Call', 'Called #1', 'Booking Made', 'New Meta Lead', 'Not tagged'], i * 11),
  campaign: pick(['CD_062', 'CD_063', 'Not tagged'], i * 2),
  creative: pick(['vid_a', 'img_b', 'Not tagged'], i * 13),
  keyword: 'Not tagged',
  value: (i % 9) * 100,
}))

const LR_COLS_MAX = 6
let checks = 0, fails = 0
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL:', msg) } }

const run = (filters, groupBy, colBy) => {
  const active = Object.entries(filters)
  const passes = (r, skip) => active.every(([d, v]) => d === skip || r[d] === v)
  const rows = facts.filter((r) => passes(r, null))
  const optionsFor = (dim) => {
    const m = new Map()
    for (const r of facts) if (passes(r, dim)) m.set(r[dim], (m.get(r[dim]) || 0) + 1)
    if (filters[dim] && !m.has(filters[dim])) m.set(filters[dim], 0)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  }
  const colDim = colBy === groupBy ? (groupBy === 'reason' ? 'source' : 'reason') : colBy
  const m = new Map()
  for (const r of rows) {
    let g = m.get(r[groupBy]); if (!g) { g = { key: r[groupBy], count: 0, value: 0, cols: new Map(), rows: [] }; m.set(r[groupBy], g) }
    g.count++; g.value += r.value; g.rows.push(r); g.cols.set(r[colDim], (g.cols.get(r[colDim]) || 0) + 1)
  }
  const groups = [...m.values()].sort((a, b) => b.count - a.count)
  const cm = new Map(); for (const r of rows) cm.set(r[colDim], (cm.get(r[colDim]) || 0) + 1)
  const colKeys = [...cm.entries()].sort((a, b) => b[1] - a[1]).slice(0, LR_COLS_MAX).map(([k]) => k)
  const otherOf = (g) => g.count - colKeys.reduce((a, k) => a + (g.cols.get(k) || 0), 0)
  const tag = `filters=${JSON.stringify(filters)} rows=${groupBy} cols=${colDim}`

  ok(colDim !== groupBy, `columns never equal rows · ${tag}`)
  ok(groups.reduce((a, g) => a + g.count, 0) === rows.length, `group counts sum to the filtered total · ${tag}`)
  ok(groups.every((g) => g.rows.length === g.count), `每 group's lead list matches its count · ${tag}`)
  ok(groups.every((g) => otherOf(g) >= 0), `Other is never negative · ${tag}`)
  ok(groups.every((g) => colKeys.reduce((a, k) => a + (g.cols.get(k) || 0), 0) + otherOf(g) === g.count), `columns + Other reconcile per row · ${tag}`)
  ok(groups.reduce((a, g) => a + g.value, 0) === rows.reduce((a, r) => a + r.value, 0), `values sum · ${tag}`)

  // --- the three cell readings ------------------------------------------------
  const colTotals = cm
  const otherTot = rows.length - colKeys.reduce((a, k) => a + (colTotals.get(k) || 0), 0)
  const cellStat = (g, n, colTot) => {
    const colShare = colTot ? (n / colTot) * 100 : null
    const allShare = rows.length ? (g.count / rows.length) * 100 : null
    const pp = colShare == null || allShare == null ? null : Math.round(colShare - allShare)
    return { n, colTot, colShare, allShare, pp }
  }
  // The denominators are the point: every cell percentage divides by its column's
  // own total, and those totals must account for every filtered deal exactly once.
  ok(colKeys.reduce((a, k) => a + (colTotals.get(k) || 0), 0) + otherTot === rows.length, `column totals + Other = filtered total · ${tag}`)
  ok(otherTot >= 0, `Other column total is never negative · ${tag}`)
  for (const k of colKeys) {
    const down = groups.reduce((a, g) => a + (g.cols.get(k) || 0), 0)
    ok(down === colTotals.get(k), `column ${k} sums down to its own total · ${tag}`)
  }
  for (const g of groups) {
    for (const k of [...colKeys, null]) {
      const n = k === null ? otherOf(g) : (g.cols.get(k) || 0)
      const t = k === null ? otherTot : (colTotals.get(k) || 0)
      const st = cellStat(g, n, t)
      ok(n <= t, `a cell never exceeds its column total (${g.key} × ${k || 'Other'}) · ${tag}`)
      if (t) ok(st.colShare >= 0 && st.colShare <= 100, `share of column stays in 0-100 · ${tag}`)
      if (t) ok(st.pp === Math.round(st.colShare - st.allShare), `pp is share-of-column minus share-of-all · ${tag}`)
    }
    // The whole point of the pp reading: it is centred on zero. A row's cells,
    // weighted by their column sizes, average back to that row's overall share -
    // so a positive pp genuinely means "more concentrated here than elsewhere"
    // and cannot be an artefact of the denominators.
    const wsum = [...colKeys, null].reduce((a, k) => {
      const n = k === null ? otherOf(g) : (g.cols.get(k) || 0)
      const t = k === null ? otherTot : (colTotals.get(k) || 0)
      return a + (t ? (n / t) * 100 * t : 0)
    }, 0)
    const allShare = (g.count / rows.length) * 100
    ok(Math.abs(wsum / rows.length - allShare) < 1e-9, `cell shares weighted by column size return the row's overall share (${g.key}) · ${tag}`)
  }
  // Each picker's own options are counted with its own filter lifted, so the
  // currently-selected value never hides the alternatives you could switch to.
  for (const d of DIMS) {
    const opts = optionsFor(d)
    const expect = facts.filter((r) => active.every(([k, v]) => k === d || r[k] === v)).length
    ok(opts.reduce((a, o) => a + o[1], 0) === expect, `${d} option counts sum to rows passing the other filters · ${tag}`)
    if (filters[d]) ok(opts.some((o) => o[0] === filters[d]), `${d}'s selected value stays in its own list · ${tag}`)
  }
  return { rows: rows.length, groups: groups.length }
}

const cases = [
  [{}, 'reason', 'source'],
  [{ source: 'Paid Social' }, 'stage', 'reason'],
  [{ source: 'Paid Social', stage: '15 Minute Call' }, 'reason', 'campaign'],
  [{ channel: 'meta', pipeline: 'ADHD', campaign: 'CD_062' }, 'reason', 'creative'],
  [{ reason: 'Budget' }, 'reason', 'source'],          // rows dim also filtered
  [{ keyword: 'Not tagged' }, 'keyword', 'keyword'],   // single-value dim, cols == rows
  [{ source: 'Paid Social', reason: 'Spam', stage: 'Booking Made' }, 'campaign', 'reason'],
]
for (const [f, g, c] of cases) { const r = run(f, g, c); console.log(`${String(r.rows).padStart(4)} rows → ${String(r.groups).padStart(2)} groups   ${JSON.stringify(f)}`) }
console.log(`\n${checks} assertions, ${fails} failed`)
process.exit(fails ? 1 : 0)
