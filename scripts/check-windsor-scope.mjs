// Every per-client Meta / Google read must be scoped to that client's ad account
// at the API, not pulled agency-wide and filtered in JavaScript afterwards.
//
// This is not a style rule. An unscoped Facebook pull spans every ad account on
// the agency key; measured against Windsor it took over 60 seconds, while the
// same query scoped to one account came back immediately. windsorFetch allows
// 7.5s inside Netlify's 10s ceiling, so the unscoped version failed on every
// single request - and the caller's `.catch(() => [])` turned that into $0.00 of
// Meta spend on the Overview, sitting next to a live lead count. The filter that
// ran afterwards was doing the right job in the wrong place.
//
// So: a windsorFetch for `facebook` or `google_ads` must either pass
// `{ accounts: ... }`, or say on the line why it legitimately spans every account
// with an `// agency-wide:` marker - portfolio rows, trends, account discovery.
import fs from 'fs'

const file = process.argv[2] || 'netlify/functions/windsor.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const CALL = /windsorFetch\(\s*'(facebook|google_ads)'/g

const bad = []
let scoped = 0, agency = 0
lines.forEach((l, i) => {
  for (const m of l.matchAll(CALL)) {
    // The tail of this call - up to the next windsorFetch on the same line, so a
    // line holding two calls is judged one at a time rather than as a whole.
    const rest = l.slice(m.index + 1)
    const next = rest.search(CALL)
    const call = next === -1 ? rest : rest.slice(0, next)
    if (/accounts:/.test(call)) { scoped++; continue }
    if (/\/\/ agency-wide:/.test(l)) { agency++; continue }
    bad.push({ line: i + 1, connector: m[1], text: l.trim().slice(0, 110) })
  }
})

if (bad.length) {
  console.error(`${file}: ${bad.length} unscoped ad read(s) - each pulls every account on the agency key:\n`)
  for (const b of bad) console.error(`  line ${b.line} (${b.connector})\n    ${b.text}\n`)
  console.error('Pass { accounts: <the client\'s account id> } as windsorFetch\'s 7th argument,')
  console.error('or append "// agency-wide: <why>" if it really must span every account.')
  process.exit(1)
}
console.log(`${file}: ${scoped} ad reads scoped to one account, ${agency} deliberately agency-wide`)
