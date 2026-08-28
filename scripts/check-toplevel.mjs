#!/usr/bin/env node
// Catches a function that LOOKS top level in the source - declared at column 0 -
// but is actually nested inside another function's body.
//
// This is legal JavaScript and builds cleanly, so nothing complains: a
// declaration after a `return` is simply unreachable, and the name is scoped to
// the enclosing function. It only fails at runtime, as "X is not defined", and
// only on the screen that renders it. That is exactly how EnquiryTimesSection
// shipped broken (v3.394.0) - inserted a few lines above its intended home, but
// on the wrong side of a closing brace.
//
// Method: strip JSX with esbuild, then compare which names the parser puts at
// column 0 against which ones the source does. Anything in the source list and
// not the output list is nested.
import { transformSync } from '../node_modules/esbuild/lib/main.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = ['src/App.jsx']
let bad = 0
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  const out = transformSync(src, { loader: 'jsx', format: 'esm' }).code
  const declared = [...src.matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1])
  const topLevel = new Set([...out.matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]))
  const nested = declared.filter((n) => !topLevel.has(n))
  if (nested.length) {
    bad += nested.length
    console.error(`\n${rel}: ${nested.length} declaration(s) look top level but are nested:`)
    for (const n of nested) {
      const line = src.split('\n').findIndex((l) => l.startsWith(`function ${n}(`)) + 1
      console.error(`  ${rel}:${line}  function ${n}()`)
    }
  } else {
    console.log(`${rel}: ${declared.length} top-level function declarations, none nested`)
  }
}
if (bad) { console.error('\nMove them out of the enclosing function body.'); process.exit(1) }
