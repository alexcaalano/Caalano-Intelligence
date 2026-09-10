// Speed to lead: in-hours leads measured raw, after-hours leads measured from
// the next opening and kept out of the headline numbers.
import assert from 'node:assert/strict'
import { nextOpenMs, speedStats, afterHoursCount } from '../netlify/lib/ghl.mjs'

const tz = 'Australia/Sydney'
const hours = { days: [1, 2, 3, 4, 5], startMin: 9 * 60, endMin: 17 * 60 }
const syd = (iso) => Date.parse(iso) // ISO strings carry the +10:00 offset explicitly
const MIN = 60000

// 2026-09-11 is a Friday (AEST, +10:00).
const friEvening = syd('2026-09-11T20:00:00+10:00')
const monOpen = syd('2026-09-14T09:00:00+10:00')
assert.equal(nextOpenMs(friEvening, hours, tz), monOpen, 'Friday 8pm opens Monday 9am')
const tueNoon = syd('2026-09-15T12:00:00+10:00')
assert.equal(nextOpenMs(tueNoon, hours, tz), tueNoon, 'inside hours returns itself')
assert.equal(nextOpenMs(syd('2026-09-15T07:30:00+10:00'), hours, tz), syd('2026-09-15T09:00:00+10:00'), 'early morning opens same day')
assert.equal(nextOpenMs(tueNoon, null, tz), tueNoon, 'no hours = always open')

const rows = [
  // in-hours, answered in 3 min
  { leadIn: tueNoon, manual: tueNoon + 3 * MIN, via: 'message', booked: true },
  // in-hours 4:58pm, answered 9:01 next morning: raw 16h03m, NOT 3 minutes
  { leadIn: syd('2026-09-15T16:58:00+10:00'), manual: syd('2026-09-16T09:01:00+10:00'), via: 'message' },
  // after-hours Friday 8pm, answered Monday 9:02 -> 2 min after opening
  { leadIn: friEvening, manual: monOpen + 2 * MIN, via: 'appt' },
  // after-hours, answered the same evening (before opening) -> 0
  { leadIn: friEvening, manual: friEvening + 10 * MIN, via: 'message' },
  // no manual reply - ignored here
  { leadIn: tueNoon, manual: null },
]
const st = speedStats(rows, hours, tz)
assert.equal(st.measured, 2)
assert.equal(st.measuredAll, 4)
assert.equal(st.after.measured, 2)
assert.equal(st.after.viaAppt, 1)
assert.equal(st.viaApptAll, 1)
assert.equal(st.medianMin, 3, 'lower-middle of [3, 963]')
assert.equal(st.avgMin, Math.round((3 + 963) / 2))
assert.equal(st.within5Pct, 50, 'the 4:58pm lead is a 16h wait, not a 3-minute one')
assert.equal(st.after.within5Pct, 100)
assert.equal(st.after.medianMin, 0)
assert.equal(st.buckets.reduce((a, b) => a + b.count, 0), 2, 'buckets are in-hours only')
assert.equal(st.buckets[0].count, 1); assert.equal(st.buckets[0].booked, 1)
assert.equal(st.buckets[4].count, 1, '16h lands in 4-24 hrs')

assert.equal(afterHoursCount(rows.map((r) => r.leadIn), hours, tz), 2)
assert.equal(afterHoursCount(rows.map((r) => r.leadIn), null, tz), 0)

// No hours configured: everything is in-hours and raw.
const raw = speedStats(rows, null, tz)
assert.equal(raw.measured, 4); assert.equal(raw.after.measured, 0)
assert.equal(raw.buckets[0].count, 1, 'Friday 8pm lead answered Monday is "over 24 hrs" raw')
assert.equal(raw.buckets[5].count, 1)
console.log('speedhours_test ok')
