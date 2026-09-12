// @needs-fake-blobs
// Deals & Actions: the to-do list is built from the demo CRM, every section
// carries the fields the rows render, "mine" narrows to one rep, fixed rows
// disappear until the snapshot catches up, and every write is validated.
import assert from 'node:assert/strict'
import { buildActions, applyAction, ghlUserIdForEmail } from '../netlify/lib/ghl.mjs'
import { DEMO_LOCATION, demoData } from '../netlify/lib/demo.mjs'
import { ALL_TABS } from '../netlify/lib/auth.mjs'

const d = demoData()
const a = await buildActions(DEMO_LOCATION, {})
assert.equal(a.locationId, DEMO_LOCATION)
assert.ok(a.users.length > 0 && a.users.every((u) => u.id && u.name), 'CRM users listed')
assert.ok(a.pipelines.length > 0 && a.pipelines[0].stages.length > 0, 'pipelines with stages')
assert.ok(a.lostReasons.length > 0, 'lost reasons for the picker')
assert.ok(Array.isArray(a.calendars), 'calendars for the filter')
for (const k of ['appts', 'wonNoValue', 'lostNoReason', 'staleOpen', 'unassigned', 'inbound', 'open']) assert.ok(Array.isArray(a[k]), `${k} is a list`)
assert.equal(a.counts.todo, a.counts.appts + a.counts.wonNoValue + a.counts.lostNoReason + a.counts.staleOpen + a.counts.unassigned + a.counts.inbound)
assert.ok(a.open.length > 0, 'the demo has open deals')
for (const r of a.open) { assert.ok(r.id && r.name && r.stage && r.pipelineId, 'open deal rows carry id, name, stage, pipeline'); assert.equal(r.status, 'open') }
for (const r of a.staleOpen) assert.ok(r.idleDays >= 30, 'stale means idle for the threshold')
for (const r of a.wonNoValue) assert.ok(r.status === 'won' && !(r.value > 0))
for (const r of a.lostNoReason) assert.ok(['lost', 'abandoned'].includes(r.status) && !r.lostReasonId)
for (const r of a.unassigned) assert.ok(r.status === 'open' && !r.userId)
const now = Date.now()
for (const r of a.appts) { assert.ok(r.startMs < now, 'appointment has passed'); assert.ok(!/show|cancel|invalid/i.test(r.status), 'and is not resulted') }
// The stale threshold is a parameter.
const a7 = await buildActions(DEMO_LOCATION, { staleDays: 7 })
assert.ok(a7.staleOpen.length >= a.staleOpen.length, 'a shorter threshold finds at least as many stale deals')
// "Mine" narrows to the rep whose e-mail matches.
const rep = d.users.find((u) => d.opportunities.some((o) => o.assignedTo === u.id && o.status === 'open'))
assert.ok(rep, 'a demo user owns open deals')
assert.equal(await ghlUserIdForEmail(DEMO_LOCATION, rep.email.toUpperCase()), rep.id, 'e-mail match is case-insensitive')
const mine = await buildActions(DEMO_LOCATION, { email: rep.email, mine: true })
assert.equal(mine.meId, rep.id); assert.equal(mine.mine, true)
assert.ok(mine.open.length > 0 && mine.open.every((r) => r.userId === rep.id), 'mine shows only that rep\'s deals')
assert.equal(mine.unassigned.length, 0, 'unassigned is not a personal list')
const stranger = await buildActions(DEMO_LOCATION, { email: 'nobody@example.com', mine: true })
assert.equal(stranger.meMatched, false); assert.equal(stranger.mine, false, 'no match falls back to everyone')
// Writes: validated, and a fixed row leaves the list.
await assert.rejects(() => applyAction(DEMO_LOCATION, { op: 'appt', eventId: 'x', status: 'maybe' }), /status/)
await assert.rejects(() => applyAction(DEMO_LOCATION, { op: 'opp', oppId: 'x', patch: {} }), /nothing to change/)
await assert.rejects(() => applyAction(DEMO_LOCATION, { op: 'opp', oppId: 'x', patch: { monetaryValue: -5 } }), /number/)
await assert.rejects(() => applyAction(DEMO_LOCATION, { op: 'note', contactId: 'c', body: '' }), /body/)
await assert.rejects(() => applyAction(DEMO_LOCATION, { op: 'nope' }), /unknown op/)
const target = a.open[0]
const w = await applyAction(DEMO_LOCATION, { op: 'opp', oppId: target.id, patch: { monetaryValue: 1234, pipelineStageId: a.pipelines[0].stages[0].id } })
assert.equal(w.ok, true); assert.deepEqual(w.patch, { monetaryValue: 1234, pipelineStageId: a.pipelines[0].stages[0].id })
const after = await buildActions(DEMO_LOCATION, {})
assert.ok(!after.open.some((r) => r.id === target.id), 'a written row is hidden until the snapshot catches up')
if (a.inbound.length) { await applyAction(DEMO_LOCATION, { op: 'dismiss', id: a.inbound[0].id }) }
// The tab exists for permissions.
assert.ok(ALL_TABS.includes('actions'), 'actions is a grantable tab')
console.log('actions_test ok')
