// The sort comparator, which has to behave for names, numbers and missing values.
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} · got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
const sortRows = (rows, valOf, sort) => {
  const out = rows.slice()
  out.sort((a, b) => {
    const va = valOf(a, sort.key), vb = valOf(b, sort.key)
    if (typeof va === 'string' || typeof vb === 'string') return String(va || '').localeCompare(String(vb || '')) * -sort.dir
    const na = va == null ? -Infinity : va, nb = vb == null ? -Infinity : vb
    return (na - nb) * sort.dir || 0
  })
  return out
}
const R = [
  { name: 'Blacktown', leads: 2, won: 0, winPct: 0 },
  { name: 'Parramatta', leads: 4, won: 1, winPct: 25 },
  { name: 'Alpha', leads: 1, won: 0, winPct: null },
  { name: 'Wollondilly', leads: 4, won: 0, winPct: 0 },
]
const v = (r, k) => (k === 'name' ? r.name : r[k])
const names = (rows) => rows.map((r) => r.name)

eq(names(sortRows(R, v, { key: 'leads', dir: -1 })).slice(0, 1), ['Parramatta'], 'descending leads puts the biggest first')
eq(names(sortRows(R, v, { key: 'leads', dir: 1 })).slice(0, 1), ['Alpha'], 'ascending leads puts the smallest first')
eq(names(sortRows(R, v, { key: 'name', dir: -1 })), ['Alpha', 'Blacktown', 'Parramatta', 'Wollondilly'], 'names sort A-Z on the first click')
eq(names(sortRows(R, v, { key: 'name', dir: 1 })), ['Wollondilly', 'Parramatta', 'Blacktown', 'Alpha'], 'and Z-A on the second')
// A missing value must sort LAST descending, not first - otherwise the rows with
// no data claim the top of the table.
{
  const d = sortRows(R, v, { key: 'winPct', dir: -1 })
  eq(d[d.length - 1].name, 'Alpha', 'a row with no value sorts last on a descending sort')
  ok(d[0].winPct === 25, 'and the real maximum leads')
}
// Ties keep a stable order rather than shuffling between renders.
{
  const a = names(sortRows(R, v, { key: 'leads', dir: -1 }))
  const b = names(sortRows(R, v, { key: 'leads', dir: -1 }))
  eq(a, b, 'sorting twice gives the same order')
  const tie = sortRows(R, v, { key: 'leads', dir: -1 }).filter((r) => r.leads === 4).map((r) => r.name)
  eq(tie, ['Parramatta', 'Wollondilly'], 'tied rows keep their incoming order')
}
// Toggling direction is an exact reversal for distinct values.
{
  const distinct = [{ name: 'a', leads: 1 }, { name: 'b', leads: 2 }, { name: 'c', leads: 3 }]
  const dn = names(sortRows(distinct, v, { key: 'leads', dir: -1 }))
  const up = names(sortRows(distinct, v, { key: 'leads', dir: 1 }))
  eq(dn, up.slice().reverse(), 'the two directions are exact reverses')
}
// Sorting never adds or loses a row.
for (const key of ['name', 'leads', 'won', 'winPct']) for (const dir of [-1, 1]) {
  const out = sortRows(R, v, { key, dir })
  eq(out.length, R.length, `${key}/${dir}: row count is preserved`)
  eq(names(out).slice().sort(), names(R).slice().sort(), `${key}/${dir}: the same rows come back`)
}
// A key-event reach rate is leads-relative, so zero leads must not divide.
{
  const rows = [{ name: 'x', leads: 0, ke: 0 }, { name: 'y', leads: 4, ke: 1 }]
  const rate = (r) => (r.leads ? r.ke / r.leads : null)
  const out = sortRows(rows, (r, k) => (k === 'rate' ? rate(r) : r[k]), { key: 'rate', dir: -1 })
  eq(out[0].name, 'y', 'the row with a real rate leads')
  eq(out[1].name, 'x', 'and the one with no leads sorts last rather than dividing by zero')
}
console.log(`\n${n} assertions, ${f} failed`)
process.exit(f ? 1 : 0)
