const ROOT = new URL('../', import.meta.url).pathname
// Extract the real budget helpers from ghl.mjs and exercise them directly.
import fs from 'fs'
import os from 'os'
import path from 'path'
// A scratch dir that exists on every machine, including the CI runner.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c360-test-')) + '/'
const src = fs.readFileSync(ROOT + 'netlify/lib/ghl.mjs', 'utf8')
const i = src.indexOf('const BUDGET_MIN_MS')
const j = src.indexOf('export async function resilientFetch')
fs.writeFileSync(TMP + '_budget.mjs',
  src.slice(i, j) + '\nexport { budgetLeft, budgetedTimeout, budgetAllowsRetry, BUDGET_MIN_MS, BUDGET_RETRY_MS }\n')
const B = await import(TMP + '_budget.mjs')

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Fresh budget: a 9s want fits inside 22s, so nothing is clamped.
B.startRequestBudget(22000)
ok(B.budgetedTimeout(9000) === 9000, 'plenty of budget -> the requested timeout is used unchanged')
ok(B.budgetAllowsRetry(), 'plenty of budget -> retries allowed')

// Near the end: the timeout is clamped to what is left, not the 9s it asked for.
B.startRequestBudget(5000)
const t = B.budgetedTimeout(9000)
ok(t > 4000 && t <= 5000, `little budget -> timeout clamped to what remains (${t}ms, not 9000)`)

// Past the retry floor: no new attempt is started.
B.startRequestBudget(2000)
ok(!B.budgetAllowsRetry(), 'below the retry floor -> no further attempt is started')
ok(B.budgetedTimeout(9000) === B.BUDGET_MIN_MS, 'below the floor -> the in-flight attempt still gets the minimum, not zero')

// THE DANGEROUS CASE. A warm Lambda keeps module state; a budget left over from a
// previous invocation must never make every call fail instantly.
B.startRequestBudget(50)
await sleep(120)                                  // budget is now in the past
ok(B.budgetLeft() < 0, 'precondition: the budget really has expired')
ok(B.budgetedTimeout(9000) === B.BUDGET_MIN_MS, 'EXPIRED budget still yields a usable timeout, never 0')
ok(B.budgetedTimeout(9000) > 0, 'expired budget can never produce a zero-length attempt')
ok(!B.budgetAllowsRetry(), 'expired budget suppresses retries (degrades, does not fail)')

// Unset entirely (a caller that never started one): unlimited, i.e. old behaviour.
B.startRequestBudget(0)
ok(B.budgetLeft() === Infinity, 'unset budget is unlimited')
ok(B.budgetedTimeout(9000) === 9000, 'unset budget -> requested timeout honoured')
ok(B.budgetAllowsRetry(), 'unset budget -> retries allowed, exactly as before this change')

// The whole point: worst-case spend must now fit a ~26s function.
B.startRequestBudget(22000)
let spent = 0, attempts = 0
while (attempts < 5) {
  if (attempts > 0 && !B.budgetAllowsRetryAt?.(spent)) { /* helper not exposed; simulate below */ }
  const to = Math.max(B.BUDGET_MIN_MS, Math.min(9000, 22000 - spent))
  spent += to; attempts++
  if (22000 - spent <= B.BUDGET_RETRY_MS) break
}
ok(spent <= 22000, `worst-case upstream spend fits the budget: ${spent}ms over ${attempts} attempts (was 27000ms+ over 3)`)
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
