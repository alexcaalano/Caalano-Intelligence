import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { registerAdapter, getAdapter, providerFetch, onProviderResult, adaptersOn } from '../netlify/lib/providers/index.mjs'
import windsor, { setWindsorFetcher } from '../netlify/lib/providers/windsor.mjs'
import { sealCredential, openCredential, rewrapCredential } from '../netlify/lib/cred.mjs'

// Registry shape checks.
assert.throws(() => registerAdapter({ provider: 'nope' }), /unknown provider/)
assert.throws(() => registerAdapter({ provider: 'meta', fetch() {} }), /lacks/)
registerAdapter(windsor)
assert.equal(getAdapter('windsor'), windsor)
assert.equal(adaptersOn(), false, 'off unless PROVIDER_ADAPTERS=1')

// The Windsor adapter hands today's fetch exactly what it got, plus the key and the account.
const calls = []
setWindsorFetcher(async (connector, fields, from, to, preset, key, opts) => { calls.push({ connector, fields, from, to, preset, key, opts }); return [{ account_id: opts.accounts, spend: 1 }] })
const rows = await providerFetch('windsor', { apiKey: 'k1' }, { externalId: 'facebook:123', fields: ['spend'], from: '2026-09-01', to: '2026-09-13', opts: { extra: 1 } })
assert.deepEqual(rows, [{ account_id: '123', spend: 1 }])
assert.deepEqual(calls[0], { connector: 'facebook', fields: ['spend'], from: '2026-09-01', to: '2026-09-13', preset: null, key: 'k1', opts: { extra: 1, accounts: '123' } })
await providerFetch('windsor', { apiKey: 'k1' }, { connector: 'google_ads', externalId: '123-456', fields: ['clicks'], preset: 'last_30d' })
assert.equal(calls[1].connector, 'google_ads'); assert.equal(calls[1].opts.accounts, '123-456'); assert.equal(calls[1].preset, 'last_30d')
await assert.rejects(providerFetch('windsor', {}, { connector: 'facebook', fields: [] }), /no apiKey/)
await assert.rejects(providerFetch('windsor', { apiKey: 'k' }, { fields: [] }), /connector is required/)
// Health outcomes reach the listener, success and failure alike.
const seen = []; const off = onProviderResult((r) => seen.push(r))
await providerFetch('windsor', { apiKey: 'k1' }, { externalId: 'facebook:1', fields: ['spend'] })
setWindsorFetcher(async () => { throw new Error('Windsor facebook 401: bad key') })
await assert.rejects(providerFetch('windsor', { apiKey: 'k1' }, { externalId: 'facebook:1', fields: ['spend'] }), /401/)
off()
assert.deepEqual(seen.map((r) => [r.provider, r.ok, r.externalId]), [['windsor', true, 'facebook:1'], ['windsor', false, 'facebook:1']])
assert.match(seen[1].error, /401/)
assert.deepEqual(await windsor.health({}, 'facebook:1'), { ok: false, detail: 'no API key' })
assert.equal((await windsor.health({ apiKey: 'k' }, 'facebook:1')).ok, false, 'a failing read is an unhealthy connection')
setWindsorFetcher(async () => [])
assert.deepEqual(await windsor.health({ apiKey: 'k' }, 'facebook:1'), { ok: true, detail: 'read ok' })
assert.throws(() => windsor.authUrl({}), /API key/)
assert.equal(await windsor.refresh({ apiKey: 'k' }), null)

// Credentials: sealed per row, opened only with the named KEK, rotated without touching the ciphertext.
process.env.KEK_V1 = randomBytes(32).toString('base64')
process.env.KEK_V2 = randomBytes(32).toString('base64')
const row = sealCredential({ apiKey: 'secret-key', note: 'x' })
assert.equal(row.cred_kek_id, 'KEK_V1')
assert.ok(row.cred_ciphertext.length > 0 && row.cred_iv.length === 12 && row.cred_tag.length === 16 && row.cred_wrapped_key.length === 12 + 16 + 32)
assert.ok(!row.cred_ciphertext.toString('utf8').includes('secret-key'), 'ciphertext is not the plaintext')
assert.deepEqual(openCredential(row), { apiKey: 'secret-key', note: 'x' })
const tampered = { ...row, cred_ciphertext: Buffer.from(row.cred_ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))) }
assert.throws(() => openCredential(tampered), /auth|Unsupported state/i, 'a changed byte fails the tag')
const wrongKek = { ...row, cred_kek_id: 'KEK_V2' }
assert.throws(() => openCredential(wrongKek), /auth|Unsupported state/i, 'the wrong KEK cannot unwrap')
const rotated = rewrapCredential(row, 'KEK_V2')
assert.equal(rotated.cred_kek_id, 'KEK_V2')
assert.ok(Buffer.compare(rotated.cred_ciphertext, row.cred_ciphertext) === 0 && Buffer.compare(rotated.cred_iv, row.cred_iv) === 0, 'rotation leaves the ciphertext alone')
assert.deepEqual(openCredential(rotated), { apiKey: 'secret-key', note: 'x' })
delete process.env.KEK_V1
assert.throws(() => openCredential(row), /KEK_V1 is not set/)
assert.equal(openCredential(null), null)
console.log('providers_test ok')
