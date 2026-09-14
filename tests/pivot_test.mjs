// @needs-fake-blobs
// The Pivot report scope against the demo client: Meta, Google and the CRM
// summed into the chosen buckets, with the stage-reach maps the app resolves
// key events from. The demo client's ad rows come from the generator and its
// CRM from the demo location, so this runs offline.
import assert from 'node:assert/strict'
process.env.AUTH_SECRET = 'test-secret'
process.env.WINDSOR_API_KEY = 'x'
process.env.PG_MIRROR = '0'
const { default: handler } = await import('../netlify/functions/windsor.mjs')
const { warmToken } = await import('../netlify/lib/warm.mjs')
const call = async (qs) => { const r = await handler(new Request(`https://x/.netlify/functions/windsor?${qs}`, { headers: { 'x-warm-token': warmToken() } })); return { status: r.status, body: await r.json().catch(() => null) } }
const iso = (d) => d.toISOString().slice(0, 10)
const now = new Date(); const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
const m = await call(`scope=pivot&client=norwest-mdc&from=${iso(from)}&to=${iso(now)}&by=month`)
assert.equal(m.status, 200, JSON.stringify(m.body).slice(0, 200))
assert.equal(m.body.by, 'month')
assert.equal(m.body.buckets.length, 6, 'six months, first to current')
assert.ok(m.body.buckets.every((b) => /^\d{4}-\d{2}$/.test(b.key) && b.from <= b.to), 'month keys and bounds')
assert.ok(m.body.buckets.some((b) => b.meta.spend > 0), 'Meta spend lands in a month')
assert.ok(m.body.buckets.some((b) => b.google.cost > 0), 'Google spend lands in a month')
assert.ok(m.body.hasCrm && m.body.buckets.some((b) => b.crm && b.crm.leads.all > 0), 'CRM leads land in a month')
const lead = m.body.buckets.find((b) => b.crm && b.crm.leads.all > 0)
assert.ok(Object.keys(lead.crm.reach.all).length > 0, 'stages reached are counted')
assert.ok(Object.keys(m.body.stagePos).length > 0, 'stage positions ride along')
const chSum = lead.crm.leads.meta + lead.crm.leads.google + lead.crm.leads.other
assert.equal(chSum, lead.crm.leads.all, 'channel split adds up to all')
// Weeks start on Monday; days are one per day.
const w = await call(`scope=pivot&client=norwest-mdc&from=2026-08-03&to=2026-08-30&by=week`)
assert.equal(w.status, 200); assert.equal(w.body.buckets.length, 4); assert.ok(w.body.buckets.every((b) => new Date(b.key + 'T00:00:00Z').getUTCDay() === 1), 'weeks start Monday')
const d = await call(`scope=pivot&client=norwest-mdc&from=2026-09-01&to=2026-09-07&by=day`)
assert.equal(d.status, 200); assert.equal(d.body.buckets.length, 7)
const q = await call(`scope=pivot&client=norwest-mdc&from=2026-01-01&to=2026-09-14&by=quarter`)
assert.deepEqual(q.body.buckets.map((b) => b.key), ['2026-Q1', '2026-Q2', '2026-Q3'])
// Parts: the CRM alone, and the ad platforms alone for one month; their buckets add up.
const crm = await call(`scope=pivot&client=norwest-mdc&from=${iso(from)}&to=${iso(now)}&by=month&src=crm`)
assert.equal(crm.status, 200); assert.ok(crm.body.buckets.every((b) => b.meta.spend === 0 && b.google.cost === 0), 'crm part carries no ad figures'); assert.ok(crm.body.buckets.some((b) => b.crm && b.crm.leads.all > 0))
const ads = await call(`scope=pivot&client=norwest-mdc&from=${lead.from}&to=${lead.to}&by=month&src=ads`)
assert.equal(ads.status, 200); assert.equal(ads.body.buckets.length, 1); assert.ok(ads.body.buckets[0].crm == null, 'ads part carries no CRM'); assert.equal(ads.body.buckets[0].meta.spend, lead.meta.spend, 'one month of Meta alone equals that month in the full build')
// The skeleton call: every bucket, stage positions, wins by close date, no created-basis figures.
const sk = await call(`scope=pivot&client=norwest-mdc&from=${iso(from)}&to=${iso(now)}&by=month&src=closed`)
assert.equal(sk.status, 200); assert.equal(sk.body.buckets.length, 6); assert.ok(sk.body.buckets.every((b) => b.crm && b.crm.leads.all === 0), 'closed part carries no created-basis leads')
assert.ok(sk.body.buckets.some((b) => b.crm.wonClosed.all > 0), 'wins by close date come from the won snapshot')
assert.ok(Object.keys(sk.body.stagePos).length > 0)
// Cash collected rides along when the CRM records it (the demo does).
assert.ok(m.body.buckets.some((b) => b.crm && b.crm.cash.all > 0), 'cash collected by created date')
assert.ok(sk.body.buckets.some((b) => b.crm.cashClosed.all > 0), 'cash collected by closed date')
// Guard rails.
assert.equal((await call('scope=pivot&client=norwest-mdc&from=2020-01-01&to=2026-09-14&by=month')).status, 400, 'three years max')
assert.equal((await call('scope=pivot&client=nope&from=2026-01-01&to=2026-02-01&by=month')).status, 404)
console.log('pivot_test ok')
