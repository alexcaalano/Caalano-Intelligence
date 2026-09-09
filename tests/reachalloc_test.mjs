// Key event reach charges each pipeline its lead-share of spend - the same
// rule Pipeline performance uses - never the whole account's spend twice.
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const reachSpendAlloc = new Function(lift('reachSpendAlloc') + '\nreturn reachSpendAlloc')()
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const two = [{ pid: 'ba', base: 108 }, { pid: 'fin', base: 89 }]
const at = reachSpendAlloc(two, 11368)
ok(Math.round(at('ba')) === 6232 && Math.round(at('fin')) === 5136, 'two pipelines split the spend by lead share')
ok(Math.round(at('ba') + at('fin')) === 11368, 'the shares add back to the account spend')
ok(reachSpendAlloc([{ pid: 'ba', base: 108 }], 11368)('ba') === 11368, 'one pipeline carries the full spend')
ok(reachSpendAlloc([{ pid: '__all__', base: 197 }], 11368)('__all__') === 11368, 'the account-wide chain carries the full spend')
ok(reachSpendAlloc([...two, { pid: '__all__', base: 197 }], 11368)('__all__') === 11368, 'an all-pipelines chain beside the others is still the full spend')
ok(reachSpendAlloc(two, 0)('ba') === 0 && reachSpendAlloc(two, null)('fin') === 0, 'no spend allocates nothing')
ok(reachSpendAlloc([{ pid: 'a', base: 0 }, { pid: 'b', base: 0 }], 100)('a') === 100, 'no leads at all falls back to the full spend rather than dividing by zero')
console.log(f ? `${f}/${n} FAILED` : `${n} assertions passed`)
process.exit(f ? 1 : 0)
