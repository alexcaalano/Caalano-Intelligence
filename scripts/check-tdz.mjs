// Catch temporal-dead-zone reads inside a component body.
//
// `const scanKey = `...${hq}`` placed above `const hq = ...` is legal JavaScript,
// compiles without complaint, and throws "Cannot access 'hq' before
// initialization" the moment the component renders - taking the whole view down
// behind the error boundary. The build cannot see it because it is only wrong at
// runtime, which is exactly the class of bug worth a cheap static guard.
//
// Only immediately-evaluated initialisers count. A function or arrow body runs
// later, by which time every binding exists, so those are skipped - as are hook
// callbacks (useMemo / useEffect / useCallback) for the same reason.
import fs from 'fs'

const file = process.argv[2] || 'src/App.jsx'
const lines = fs.readFileSync(file, 'utf8').split('\n')

// Blank out anything that is not a live identifier reference: string and template
// contents, comments, property accesses after a dot, and object literal keys.
// Without this the checker reports `c.prev` as a reference to a local `prev`.
const scrub = (s) => s
  .replace(/\/\/.*$/, '')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/`(?:\\.|[^`\\$]|\$(?!\{))*`/g, '``')
  .replace(/\.\s*[A-Za-z_$][\w$]*/g, '.')
  .replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:/g, '$1')

const starts = []
lines.forEach((l, i) => { const m = /^function ([A-Za-z_$][\w$]*)\(/.exec(l); if (m) starts.push([i, m[1]]) })

const problems = []
for (const [start, name] of starts) {
  let end = lines.length
  for (let j = start + 1; j < lines.length; j++) if (lines[j] === '}') { end = j; break }
  const body = lines.slice(start, end + 1)

  const declaredAt = new Map()
  body.forEach((l, off) => {
    const m = /^ {2}(?:const|let) (?:\[([^\]]+)\]|([A-Za-z_$][\w$]*))\s*=/.exec(l)
    if (!m) return
    for (const raw of (m[1] || m[2]).split(',')) {
      const n = raw.split(':').pop().trim().replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(n) && !declaredAt.has(n)) declaredAt.set(n, off)
    }
  })

  // A hook's DEPENDENCY ARRAY is not part of the callback - it is evaluated on
  // every render, right where it is written. So `useEffect(() => ..., [zones])`
  // above `const zones = ...` throws, even though the callback itself would have
  // been fine. Worth its own pass because the statement is usually not an
  // assignment at all, and the pass below only looks at initialisers.
  body.forEach((l, off) => {
    const m = /,\s*\[([^\]]*)\]\s*\)\s*;?\s*$/.exec(l)
    if (!m) return
    if (!/^ {2}(?:\}|use[A-Z])/.test(l)) return          // a hook call, or the line closing one
    for (const ref of new Set(scrub(m[1]).match(/[A-Za-z_$][\w$]*/g) || [])) {
      const at = declaredAt.get(ref)
      if (at !== undefined && at > off) problems.push({ name, line: start + off + 1, ref, at: start + at + 1, text: l.trim().slice(0, 100) })
    }
  })

  body.forEach((l, off) => {
    const m = /^ {2}(?:const|let) (?:\[[^\]]+\]|[A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(l)
    if (!m) return
    const rhs = m[1].trim()
    if (/^(\(|async\b|function\b)/.test(rhs)) return                    // a function body runs later
    if (/^[A-Za-z_$][\w$]*\s*=>/.test(rhs)) return                      // ditto, single-param arrow
    if (/^(useMemo|useEffect|useCallback|useRef)\s*\(/.test(rhs)) return // hook callbacks run later
    for (const ref of new Set(scrub(rhs).match(/[A-Za-z_$][\w$]*/g) || [])) {
      const at = declaredAt.get(ref)
      if (at !== undefined && at > off) problems.push({ name, line: start + off + 1, ref, at: start + at + 1, text: l.trim().slice(0, 100) })
    }
  })
}

if (problems.length) {
  console.error(`${file}: ${problems.length} value read before its declaration (would throw at render):\n`)
  for (const p of problems) console.error(`  ${p.name} line ${p.line}: reads \`${p.ref}\`, declared at line ${p.at}\n    ${p.text}\n`)
  process.exit(1)
}
console.log(`${file}: no dead-zone reads in component bodies`)
