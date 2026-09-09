// @needs-fake-blobs
// The warmer must build the views people open: both won bases, the previous
// period's drill, the daily spend and the heavy scans - or every one of those
// opens is a live build, which is what the reliability log showed.
import { planForClient, currentRanges } from '../netlify/lib/warm.mjs'
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const ranges = currentRanges()
ok(ranges.p30 && ranges.p30.to < ranges.r30.from, 'a previous 30-day window sits before the current one')
const urls = planForClient('acme', { ghl: 'loc1', meta: '123', google: '456' }, ranges)
const has = (re) => urls.some((u) => re.test(u))
ok(has(/scope=health.*wonBasis=closed/) && has(/scope=health.*wonBasis=created/), 'health on both won bases')
ok(has(/scope=ccdrill.*wonBasis=created/), 'the drill on the created basis')
ok(urls.filter((u) => /scope=ccdrill/.test(u) && u.includes(`from=${ranges.p30.from}`)).length === 2, 'the previous-period drill on both bases')
ok(has(/scope=spenddaily/), 'the daily spend read')
for (const sc of ['usercalls', 'forms', 'speed', 'appts', 'cohorts']) ok(has(new RegExp(`scope=${sc}`)), `the ${sc} scan`)
ok(has(/scope=usercalls.*callsonly=1/), 'user calls in the calls-only shape the tab requests')
ok(urls[0].includes('wonBasis=closed') && /scope=health/.test(urls[0]), 'the most-opened view comes first')
const adsOnly = planForClient('ads', { meta: '123' }, ranges)
ok(adsOnly.some((u) => /scope=spenddaily/.test(u)) && !adsOnly.some((u) => /scope=ccdrill/.test(u)), 'an ads-only client gets spend but no CRM views')
console.log(f ? `${f}/${n} FAILED` : `${n} assertions passed`)
process.exit(f ? 1 : 0)
