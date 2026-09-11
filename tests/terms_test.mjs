// Terms: version compare, acceptance validity, and the built-in text.
import assert from 'node:assert/strict'
import { cmpTermsVersion, termsAcceptanceValid, DEFAULT_TERMS, TERMS_VERSION, TERMS_MIN_VERSION, termsPlainText } from '../netlify/lib/terms.mjs'

assert.equal(cmpTermsVersion('1.4', '1.3'), 1)
assert.equal(cmpTermsVersion('1.10', '1.9'), 1)
assert.equal(cmpTermsVersion('1.3', '1.3'), 0)
assert.equal(TERMS_VERSION, '1.5')
assert.equal(TERMS_MIN_VERSION, '1.3', 'v1.4 / v1.5 loosen or clarify only: no re-sign')
assert.ok(termsAcceptanceValid('1.3'), 'a 1.3 signature still stands')
assert.ok(!termsAcceptanceValid('1.2'))
assert.equal(DEFAULT_TERMS.sections.length, 13)
assert.match(DEFAULT_TERMS.sections[1].h, /do not restrict/)
const txt = termsPlainText()
assert.ok(/show rates/.test(txt) && /Your own figures are yours/.test(txt), 'clause 2 carve-out present')
assert.ok(!/anything learned from it/.test(txt), 'the over-broad copy wording is gone')
assert.ok((txt.match(/Caalano Digital Pty Ltd \(ABN 31 670 857 397\)/g) || []).length >= 4, 'the contracting entity is named in full')
console.log('terms_test ok')
