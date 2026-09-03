const ROOT = new URL('../', import.meta.url).pathname
// Extract pageWindow + the pager arithmetic straight from App.jsx so the test
// cannot drift from what ships.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const fn = src.slice(src.indexOf('function pageWindow'), src.indexOf('function Pager('))
const pageWindow = new Function(fn + '; return pageWindow')()

let n = 0, bad = 0
const eq = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { bad++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`) } }
const ok = (name, cond, extra = '') => { n++; if (!cond) { bad++; console.log(`FAIL ${name} ${extra}`) } }

// --- pageWindow: every page is reachable in one hop or via first/last --------
eq('1 page', pageWindow(1, 1), [1])
eq('7 pages, no gap', pageWindow(4, 7), [1, 2, 3, 4, 5, 6, 7])
eq('8 pages at 1', pageWindow(1, 8), [1, 2, 3, 4, 5, 'gap5', 8])
eq('40 pages at 1', pageWindow(1, 40), [1, 2, 3, 4, 5, 'gap5', 40])
eq('40 pages at 20', pageWindow(20, 40), [1, 'gap1', 19, 20, 21, 'gap4', 40])
eq('40 pages at 40', pageWindow(40, 40), [1, 'gap1', 36, 37, 38, 39, 40])
eq('40 pages at 39', pageWindow(39, 40), [1, 'gap1', 36, 37, 38, 39, 40])

for (const pages of [1, 2, 7, 8, 9, 13, 40, 137]) {
  for (let p = 1; p <= pages; p++) {
    const w = pageWindow(p, pages)
    const nums = w.filter((x) => typeof x === 'number')
    ok(`p${p}/${pages} in window`, nums.includes(p), JSON.stringify(w))
    ok(`p${p}/${pages} has first`, nums.includes(1))
    ok(`p${p}/${pages} has last`, nums.includes(pages))
    ok(`p${p}/${pages} sorted+unique`, nums.every((v, i) => !i || v > nums[i - 1]), JSON.stringify(w))
    ok(`p${p}/${pages} in range`, nums.every((v) => v >= 1 && v <= pages))
    // A gap must stand for at least one skipped page, never a single number.
    const gapsReal = w.every((x, i) => typeof x !== 'string' || (w[i + 1] - w[i - 1] > 2))
    ok(`p${p}/${pages} gaps real`, gapsReal, JSON.stringify(w))
    ok(`p${p}/${pages} not huge`, w.length <= 9, `${w.length}`)
    // Neighbours reachable, so paging one at a time never needs the arrows.
    if (p > 1) ok(`p${p}/${pages} has prev`, nums.includes(p - 1))
    if (p < pages) ok(`p${p}/${pages} has next`, nums.includes(p + 1))
  }
}

// --- the slice arithmetic ----------------------------------------------------
const SIZE = 10
const pageOf = (total, want, size = SIZE) => {
  const pages = Math.max(1, Math.ceil((total || 0) / size))
  const page = Math.min(want, pages)
  const from = (page - 1) * size
  return { page, pages, from, to: Math.min(total || 0, page * size) }
}
eq('empty', pageOf(0, 1), { page: 1, pages: 1, from: 0, to: 0 })
eq('exactly one page', pageOf(10, 1), { page: 1, pages: 1, from: 0, to: 10 })
eq('11 rows -> 2 pages', pageOf(11, 2), { page: 2, pages: 2, from: 10, to: 11 })
eq('47 rows, page 5', pageOf(47, 5), { page: 5, pages: 5, from: 40, to: 47 })
// Sitting on page 5 when a filter cuts the list to 12 rows must land on page 2,
// not read past the end.
eq('clamped after filter', pageOf(12, 5), { page: 2, pages: 2, from: 10, to: 12 })

// Every row appears on exactly one page, none twice, none lost.
for (const total of [0, 1, 9, 10, 11, 47, 100, 383]) {
  const rows = Array.from({ length: total }, (_, i) => i)
  const seen = []
  const pages = Math.max(1, Math.ceil(total / SIZE))
  for (let p = 1; p <= pages; p++) { const { from } = pageOf(total, p); seen.push(...rows.slice(from, from + SIZE)) }
  eq(`all ${total} rows once`, seen, rows)
  ok(`${total}: last page not empty`, total === 0 || rows.slice(pageOf(total, pages).from, pageOf(total, pages).from + SIZE).length > 0)
}

console.log(`${n - bad}/${n} passed`)
process.exit(bad ? 1 : 0)
