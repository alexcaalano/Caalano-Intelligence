// Catches references to names that do not exist anywhere in scope - the
// "callCadence is not defined" / "paidOpen is not defined" class of crash, which
// ships clean through a build and takes out the whole view at runtime.
//
// This has to be a real scope analyser. Two earlier attempts at it were
// line-based and both were deleted: the first drowned in false positives from
// prose inside JSX, the second misattributed lines to the wrong function. So this
// one walks the AST from @babel/parser (which handles JSX natively) and resolves
// each reference against a proper scope chain.
//
// It answers only "does this name exist?". Declaration ORDER is check-tdz's job
// and nesting is check-toplevel's, so all three run together in the build.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const FILES = ['src/App.jsx']
const require = createRequire(import.meta.url)

let parse
try {
  ({ parse } = require('@babel/parser'))
} catch {
  // The parser arrives with @vitejs/plugin-react rather than as a direct
  // dependency. If an install ever leaves it out, skip the check loudly rather
  // than failing a build over a missing dev tool.
  console.warn('check-undef: @babel/parser not installed - skipping (run npm install to enable)')
  process.exit(0)
}

// Anything the browser, the language, or the bundler provides. A name here is
// never reported; the list is deliberately generous, since a false positive costs
// far more trust than a missed global.
const GLOBALS = new Set([
  'globalThis', 'window', 'document', 'navigator', 'location', 'history', 'screen', 'console',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'structuredClone',
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'crypto', 'performance', 'alert', 'confirm', 'prompt',
  'Image', 'Audio', 'Video', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver',
  'IntersectionObserver', 'MessageChannel', 'BroadcastChannel', 'Worker', 'Notification',
  'getComputedStyle', 'matchMedia', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'DOMParser', 'XMLHttpRequest', 'HTMLElement', 'Element', 'Node',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise', 'Proxy', 'Reflect', 'Intl',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
  'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'TextEncoder', 'TextDecoder', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'undefined', 'NaN', 'Infinity', 'process', 'module', 'require', 'exports', 'arguments', 'import',
])
// Substituted at build time by Vite's `define`, so they exist in the bundle but
// not in the source. Read from vite.config.js rather than listed here, or the two
// drift apart and the checker starts lying about one of them.
try {
  const cfg = readFileSync('vite.config.js', 'utf8')
  const block = /define\s*:\s*\{([\s\S]*?)\}/.exec(cfg)
  if (block) for (const m of block[1].matchAll(/(^|[\s,{])([A-Za-z_$][\w$]*)\s*:/g)) GLOBALS.add(m[2])
} catch { /* no config, no extra globals */ }

// --- scope chain -------------------------------------------------------------
const newScope = (parent, kind) => ({ parent, kind, names: new Set() })
const declare = (scope, name) => { if (name) scope.names.add(name) }
const resolves = (scope, name) => {
  for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true
  return GLOBALS.has(name)
}

// Every name a binding pattern introduces: plain, {a, b: c}, [x, ...y], defaults.
function patternNames(node, out) {
  if (!node) return out
  switch (node.type) {
    case 'Identifier': out.push(node.name); break
    case 'ObjectPattern': for (const p of node.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out); break
    case 'ArrayPattern': for (const e of node.elements) patternNames(e, out); break
    case 'AssignmentPattern': patternNames(node.left, out); break
    case 'RestElement': patternNames(node.argument, out); break
    default: break
  }
  return out
}

// Child nodes, in a form that works for every node type without a visitor table.
function* children(node) {
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') yield c }
    else if (v && typeof v.type === 'string') yield v
  }
}

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])
const isBlock = (t) => t === 'BlockStatement' || t === 'Program' || t === 'ForStatement' || t === 'ForInStatement' || t === 'ForOfStatement' || t === 'SwitchStatement'

// Everything declared directly in this scope, gathered BEFORE any reference in it
// is checked - so a function called above its own declaration still resolves.
// Recurses into nested blocks only for `var` and function declarations, which
// hoist out of them.
function hoist(node, scope, top) {
  for (const c of children(node)) {
    switch (c.type) {
      case 'VariableDeclaration':
        // let/const belong to this block; var climbs to the function scope, which
        // is what `top` is when this walk started there.
        for (const d of c.declarations) for (const n of patternNames(d.id, [])) declare(c.kind === 'var' ? top : scope, n)
        if (c.kind === 'var') hoist(c, scope, top)
        continue
      case 'FunctionDeclaration':
        if (c.id) declare(scope, c.id.name)
        continue      // its body is its own scope
      case 'ClassDeclaration':
        if (c.id) declare(scope, c.id.name)
        continue
      case 'ImportDeclaration':
        for (const sp of c.specifiers) declare(scope, sp.local.name)
        continue
      default: break
    }
    if (FN.has(c.type)) continue                    // a nested function's body is not this scope
    if (c.type === 'BlockStatement') { hoist(c, newScope(scope, 'block'), top); continue }  // only var/function escape, handled above
    hoist(c, scope, top)
  }
}

function checkFile(file) {
  const src = readFileSync(file, 'utf8')
  const ast = parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
    errorRecovery: true,
  })
  const lineOf = (node) => (node.loc ? node.loc.start.line : 0)
  const problems = []
  const seen = new Set()

  const walk = (node, scope) => {
    if (!node || typeof node.type !== 'string') return

    // --- nodes that introduce a scope ---------------------------------------
    if (FN.has(node.type)) {
      const s = newScope(scope, 'fn')
      if (node.type === 'FunctionExpression' && node.id) declare(s, node.id.name)
      for (const p of (node.params || [])) for (const n of patternNames(p, [])) declare(s, n)
      // Default values are evaluated in the function's own scope.
      for (const p of (node.params || [])) if (p.type === 'AssignmentPattern') walk(p.right, s)
      if (node.computed && node.key) walk(node.key, scope)
      if (node.body) {
        if (node.body.type === 'BlockStatement') { hoist(node.body, s, s); for (const c of node.body.body) walk(c, s) }
        else walk(node.body, s)   // concise arrow body
      }
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const s = newScope(scope, 'class')
      if (node.id) declare(s, node.id.name)
      if (node.superClass) walk(node.superClass, scope)
      if (node.body) for (const c of node.body.body) walk(c, s)
      return
    }
    if (node.type === 'CatchClause') {
      const s = newScope(scope, 'block')
      for (const n of patternNames(node.param, [])) declare(s, n)
      hoist(node.body, s, s)
      for (const c of node.body.body) walk(c, s)
      return
    }
    if (node.type === 'BlockStatement') {
      const s = newScope(scope, 'block')
      hoist(node, s, s)
      for (const c of node.body) walk(c, s)
      return
    }
    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const s = newScope(scope, 'block')
      const init = node.init || node.left
      if (init && init.type === 'VariableDeclaration') { for (const d of init.declarations) for (const n of patternNames(d.id, [])) declare(s, n) }
      for (const c of children(node)) walk(c, s)
      return
    }

    // --- declarations inside the current scope ------------------------------
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        for (const n of patternNames(d.id, [])) declare(scope, n)
        // Defaults inside a destructuring pattern are real references.
        walkPatternDefaults(d.id, scope)
        if (d.init) walk(d.init, scope)
      }
      return
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return
    if (node.type === 'ExportNamedDeclaration' && !node.declaration) return   // `export { x }` re-exports

    // --- references ----------------------------------------------------------
    if (node.type === 'Identifier') {
      if (!resolves(scope, node.name)) {
        const key = `${node.name}:${lineOf(node)}`
        if (!seen.has(key)) { seen.add(key); problems.push({ name: node.name, line: lineOf(node) }) }
      }
      return
    }
    // A capitalised JSX tag is a component reference; a lowercase one is an HTML
    // element and belongs to nobody.
    if (node.type === 'JSXIdentifier') {
      if (/^[A-Z]/.test(node.name) && !resolves(scope, node.name)) {
        const key = `${node.name}:${lineOf(node)}`
        if (!seen.has(key)) { seen.add(key); problems.push({ name: node.name, line: lineOf(node) }) }
      }
      return
    }

    // --- positions where an Identifier is a label, not a value ---------------
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      walk(node.object, scope)
      if (node.computed) walk(node.property, scope)
      return
    }
    if (node.type === 'ObjectProperty' || node.type === 'Property') {
      if (node.computed) walk(node.key, scope)
      walk(node.value, scope)
      return
    }
    if (node.type === 'JSXAttribute') { if (node.value) walk(node.value, scope); return }
    if (node.type === 'JSXMemberExpression') { walk(node.object, scope); return }
    if (node.type === 'JSXText' || node.type === 'JSXEmptyExpression') return
    if (node.type === 'LabeledStatement') { walk(node.body, scope); return }
    if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') return
    if (node.type === 'ExportSpecifier' || node.type === 'ImportSpecifier'
      || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') return
    if (node.type === 'MetaProperty') return

    for (const c of children(node)) walk(c, scope)
  }

  // Defaults inside a binding pattern (`const { a = b } = x`) reference names.
  function walkPatternDefaults(pat, scope) {
    if (!pat) return
    if (pat.type === 'AssignmentPattern') { walk(pat.right, scope); walkPatternDefaults(pat.left, scope); return }
    if (pat.type === 'ObjectPattern') { for (const p of pat.properties) walkPatternDefaults(p.type === 'RestElement' ? p.argument : p.value, scope); return }
    if (pat.type === 'ArrayPattern') { for (const e of pat.elements) walkPatternDefaults(e, scope); return }
    if (pat.type === 'RestElement') walkPatternDefaults(pat.argument, scope)
  }

  const top = newScope(null, 'module')
  hoist(ast.program, top, top)
  for (const n of ast.program.body) walk(n, top)
  return problems
}

let bad = 0
for (const file of FILES) {
  let problems
  try { problems = checkFile(file) } catch (e) {
    console.error(`check-undef: could not parse ${file}: ${e.message}`)
    process.exit(1)
  }
  if (problems.length) {
    bad += problems.length
    console.error(`\n${file}: ${problems.length} reference(s) to names that are not defined anywhere in scope:\n`)
    for (const p of problems) console.error(`  ${file}:${p.line}  ${p.name}`)
    console.error('\nEach of these throws at runtime the moment that code path renders.')
  } else {
    console.log(`${file}: every referenced name resolves`)
  }
}
process.exit(bad ? 1 : 0)
