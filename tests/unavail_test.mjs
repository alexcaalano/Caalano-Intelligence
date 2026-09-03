const ROOT = new URL('../', import.meta.url).pathname
// The branch that turns "this account is not in the Windsor connection" into an
// empty result instead of a thrown error. Pulled out of windsor.mjs verbatim so
// the test cannot drift from the shipped condition.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'netlify/functions/windsor.mjs', 'utf8')
const m = /if \(opts\.accounts && (\/.*?\/i)\.test\(body\)\)/.exec(src)
if (!m) { console.log('FAIL: could not find the guard in windsor.mjs'); process.exit(1) }
const RE = new RegExp(m[1].slice(1, -2), 'i')
console.log('guard regex:', m[1])

// Real error bodies, captured from the live API this session.
const REAL_UNAVAILABLE = [
  'Account 999999999999999 is not available. The configured accounts are: 562656435170426, 1893184807550187, 538799668712983. Grant access to your accounts at https://onboard.windsor.ai?datasource=facebook',
  'Account 000-000-0000 is not available. The configured accounts are: 709-021-2791, 774-276-3045. Grant access to your accounts at https://onboard.windsor.ai?datasource=google_ads',
  'Account 17841468241791448 is not available. The configured accounts are: 17841459789234916. Grant access to your accounts at https://onboard.windsor.ai?datasource=instagram',
]
// Failures that MUST still throw - a swallowed one of these is the silent-zero
// bug all over again.
const REAL_FAILURES = [
  '{"error":"Invalid api key"}',
  '{"error":"Unknown field: actions_bogus_field"}',
  'Internal Server Error',
  '{"message":"Rate limit exceeded"}',
  'Gateway Timeout',
  '{"error":"date_from must be before date_to"}',
]
let bad = 0
for (const b of REAL_UNAVAILABLE) { if (!RE.test(b)) { bad++; console.log('FAIL should be treated as empty:', b.slice(0, 60)) } }
for (const b of REAL_FAILURES) { if (RE.test(b)) { bad++; console.log('FAIL should still throw:', b.slice(0, 60)) } }

// And it must only apply when the call was scoped: an agency-wide read that
// somehow returns this text is a real fault and must not be swallowed.
const guarded = (body, accounts) => Boolean(accounts) && RE.test(body)
if (guarded(REAL_UNAVAILABLE[0], null)) { bad++; console.log('FAIL: swallowed on an unscoped call') }
if (!guarded(REAL_UNAVAILABLE[0], '123')) { bad++; console.log('FAIL: not swallowed on a scoped call') }

console.log(bad ? `${bad} failed` : `${REAL_UNAVAILABLE.length + REAL_FAILURES.length + 2}/${REAL_UNAVAILABLE.length + REAL_FAILURES.length + 2} passed`)
process.exit(bad ? 1 : 0)
