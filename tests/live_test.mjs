import assert from 'node:assert/strict'
import { normLiveEvent, mergeLiveEvents, liveToken, isLiveToken, LIVE_CAP } from '../netlify/lib/live.mjs'

process.env.AUTH_SECRET = 'test-secret'
const t = liveToken()
assert.ok(t && t.length === 40, 'token derived from the site secret')
assert.ok(isLiveToken(t) && !isLiveToken(t + 'x') && !isLiveToken(''), 'token compare')

const won = normLiveEvent({ type: 'OpportunityStatusUpdate', locationId: 'L1', id: 'o1', status: 'won', monetaryValue: '2500', name: 'Jane Smith', assignedTo: 'u1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's3' }, 1000)
assert.equal(won.kind, 'won'); assert.equal(won.value, 2500); assert.equal(won.id, 'won:o1:won'); assert.equal(won.userId, 'u1')
const lost = normLiveEvent({ type: 'OpportunityStatusUpdate', locationId: 'L1', id: 'o2', status: 'lost' })
assert.equal(lost.kind, 'lost')
const lead = normLiveEvent({ type: 'OpportunityCreate', locationId: 'L1', id: 'o3', status: 'open' })
assert.equal(lead.kind, 'lead')
const appt = normLiveEvent({ type: 'AppointmentCreate', locationId: 'L1', appointment: { id: 'a1', calendarId: 'cal', contactId: 'c1', appointmentStatus: 'confirmed', assignedUserId: 'u2', startTime: '2026-09-14T01:00:00Z', createdBy: { userId: 'u9' } } })
assert.equal(appt.kind, 'booked'); assert.equal(appt.bookedBy, 'u9'); assert.equal(appt.userId, 'u2')
assert.equal(normLiveEvent({ type: 'ContactCreate', locationId: 'L1', id: 'x' }), null, 'unused types are dropped')
assert.equal(normLiveEvent({ type: 'OpportunityStatusUpdate', id: 'o1', status: 'won' }), null, 'no location, no event')

// Retries and flip-flops dedupe; the buffer is capped and aged.
let buf = mergeLiveEvents([], won, 1000)
buf = mergeLiveEvents(buf, { ...won }, 1500)
assert.equal(buf.length, 1, 'a retry of the same win is one event')
buf = mergeLiveEvents(buf, lost, 2000)
assert.equal(buf.length, 2)
const old = { id: 'won:old:won', kind: 'won', at: 0 }
buf = mergeLiveEvents([old, ...buf], lead, 49 * 3600000)
assert.ok(!buf.some((e) => e.id === 'won:old:won'), 'events older than the keep window drop out')
for (let i = 0; i < LIVE_CAP + 20; i++) buf = mergeLiveEvents(buf, { id: `lead:${i}:open`, kind: 'lead', at: 3000 + i }, 3000 + i)
assert.equal(buf.length, LIVE_CAP, 'capped')
console.log('live_test ok')
