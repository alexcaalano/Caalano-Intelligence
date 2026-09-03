const ROOT = new URL('../', import.meta.url).pathname
// Does the warmer write the keys the browser reads? Everything else about it is
// moot if not. Keys are compared through the real cacheKeyFrom, lifted from
// windsor.mjs, against the real URL builders lifted from App.jsx.
import fs from 'fs'
import { planForClient, planForAgency, rollingRange, prevRangeOf, warmToken, isWarmRequest } from '../netlify/lib/warm.mjs'
const w = fs.readFileSync(ROOT + 'netlify/functions/windsor.mjs', 'utf8')
const app = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (src, startRe, endRe) => { const a = src.search(startRe); const b = src.slice(a).search(endRe); return src.slice(a, a + b) }
const cacheKeyFrom = new Function(lift(w, /function cacheKeyFrom\(url\)/, /\n}\n/) + '\n}; return cacheKeyFrom')()
// Frontend builders. rangeQuery + the two consts are real; health / deep / agency
// are the template literals from useHealth, the deep tab and useAgencyLive.
const rangeQuery = (r) => `from=${r.from}&to=${r.to}`
const ccDrillUrl = new Function('rangeQuery', lift(app, /const ccDrillUrl = /, /\n/) + '; return ccDrillUrl')(rangeQuery)
const crmAggUrl = new Function('rangeQuery', lift(app, /const crmAggUrl = /, /\n/) + '; return crmAggUrl')(rangeQuery)
const healthUrl = (clientId, r, wonBasis) => `/.netlify/functions/windsor?client=${clientId}&scope=health&${rangeQuery(r)}&wonBasis=${wonBasis}`
const deepUrl = (clientId, channel, r) => `/.netlify/functions/windsor?client=${clientId}&channel=${channel}&${rangeQuery(r)}`
const agencyUrl = (r, wonBasis) => `/.netlify/functions/windsor?scope=agency&${rangeQuery(r)}&wonBasis=${wonBasis}`
const key = (u) => cacheKeyFrom(new URL(u, 'https://x'))

let n = 0, bad = 0
const ok = (name, c, extra = '') => { n++; if (!c) { bad++; console.log('FAIL', name, extra) } }

// --- keys ------------------------------------------------------------------
const fixed = new Date(Date.UTC(2026, 8, 3, 12))          // 3 Sep 2026, Sydney noon
const r30 = rollingRange(30, fixed), r7 = rollingRange(7, fixed)
ok('last_30d ends yesterday', r30.to === '2026-09-02' && r30.from === '2026-08-04', JSON.stringify(r30))
ok('last_7d ends yesterday', r7.to === '2026-09-02' && r7.from === '2026-08-27', JSON.stringify(r7))
const ranges = { r30, r7 }
const cc = { meta: '538799668712983', google: '774-276-3045', ghl: 'rQJAY6L6qt1JJfj16fZ8' }
const warmKeys = new Set(planForClient('nexia-health', cc, ranges).map((qs) => key('/.netlify/functions/windsor?' + qs)))
const want = {
  health: key(healthUrl('nexia-health', r30, 'closed')),
  ccdrill: key(ccDrillUrl('nexia-health', r30, 0, 'all')),
  users: key(crmAggUrl('nexia-health', r30, 0, 'all')),
  blend: key(deepUrl('nexia-health', 'blend', r30)),
  meta30: key(deepUrl('nexia-health', 'meta', r30)),
  meta7: key(deepUrl('nexia-health', 'meta', r7)),
  google30: key(deepUrl('nexia-health', 'google', r30)),
}
for (const [k, v] of Object.entries(want)) ok(`warms the browser's ${k} key`, warmKeys.has(v), v)
ok('warms nothing extra', warmKeys.size === Object.keys(want).length, [...warmKeys].join('\n'))
ok('agency key matches', key('/.netlify/functions/windsor?' + planForAgency(ranges)[0]) === key(agencyUrl(r30, 'closed')))
// A retry counter / refresh nonce on the browser side must not fragment the key.
ok('_a and nonce stripped', key(ccDrillUrl('nexia-health', r30, 0, 'all') + '&_a=2&nonce=9') === want.ccdrill)
ok('_r=warm stripped', key(deepUrl('nexia-health', 'meta', r30) + '&_r=warm') === want.meta30)
// A client with no CRM must get no CRM views; no Meta, no Meta views.
ok('no ghl -> no crm views', planForClient('x', { meta: '1' }, ranges).every((q) => !/scope=|channel=blend/.test(q)))
ok('no meta -> no meta views', planForClient('x', { ghl: '1' }, ranges).every((q) => !/channel=meta/.test(q)))
// prevRangeOf parity with the app's.
const appPrev = new Function(lift(app, /function prevRangeOf\(range\)/, /\n}\n/) + '\n}; return prevRangeOf')()
ok('prevRangeOf parity', JSON.stringify(prevRangeOf(r30)) === JSON.stringify(appPrev(r30)))

// --- token -------------------------------------------------------------------
process.env.AUTH_SECRET = 'test-secret'
const t = warmToken()
ok('token is a sha256 hex', /^[0-9a-f]{64}$/.test(t))
const req = (h) => new Request('https://x/', { headers: h ? { 'x-warm-token': h } : {} })
ok('right token accepted', isWarmRequest(req(t)))
ok('missing token rejected', !isWarmRequest(req(null)))
ok('wrong token rejected', !isWarmRequest(req('0'.repeat(64))))
ok('near-miss rejected', !isWarmRequest(req(t.slice(0, 63) + (t[63] === 'a' ? 'b' : 'a'))))
ok('short token rejected', !isWarmRequest(req(t.slice(0, 10))))
delete process.env.AUTH_SECRET; delete process.env.WINDSOR_API_KEY; delete process.env.WARM_SECRET
ok('no seed -> no token, nothing accepted', warmToken() === null && !isWarmRequest(req('')))

console.log(bad ? `${bad} failed` : `${n}/${n} passed`)
process.exit(bad ? 1 : 0)
