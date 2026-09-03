// The one line that matters: a signed-out request is still a 401, and the
// warmer's token is the only thing that gets past it. Exercised against the
// real handler; anything downstream (Blobs, Windsor, GHL) is unreachable here
// and fails on its own, which is fine - we only need to see WHERE each stops.
process.env.AUTH_SECRET = 'test-secret'
process.env.WINDSOR_API_KEY = 'x'
const { default: handler } = await import('../netlify/functions/windsor.mjs')
const { warmToken } = await import('../netlify/lib/warm.mjs')
const call = async (qs, headers = {}) => { const r = await handler(new Request(`https://x/.netlify/functions/windsor?${qs}`, { headers })); return { status: r.status, body: await r.json().catch(() => null) } }
let bad = 0
const ok = (name, c, x) => { if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } else console.log('ok  ', name, '->', JSON.stringify(x).slice(0, 90)) }
const anon = await call('client=nexia-health&scope=health&from=2026-08-04&to=2026-09-02&wonBasis=closed')
ok('signed-out is 401', anon.status === 401, anon)
const badTok = await call('client=nexia-health&scope=health&from=2026-08-04&to=2026-09-02&wonBasis=closed', { 'x-warm-token': 'nope' })
ok('wrong token is 401', badTok.status === 401, badTok)
const warm = await call('client=nexia-health&scope=health&from=2026-08-04&to=2026-09-02&wonBasis=closed&_r=warm', { 'x-warm-token': warmToken() })
ok('warm token passes auth (fails later, downstream)', warm.status !== 401 && warm.status !== 403, warm)
process.exit(bad ? 1 : 0)
