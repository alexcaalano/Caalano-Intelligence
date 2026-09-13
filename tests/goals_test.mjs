import assert from 'node:assert/strict'
import { goalWindow, goalTargetFor, monthKeysFrom, quarterKeysFrom, normGoals, goalShares, goalShareFor, validateGoal, goalLevel, repValue, goalActual, repTargetsFromGoals, migrateRepKpis } from '../netlify/lib/goals.mjs'

const reps = [
  { id: 'a', revenue: 6000, won: 3, lost: 1, open: 4, showed: 8, noShow: 2, speedMin: 20, set: 5, closedByPipeline: { p1: { revenue: 6000, won: 3, lost: 1, cash: 0 } }, openByPipeline: { p1: 4 }, byPipeline: [{ id: 'p1', leads: 10 }] },
  { id: 'b', revenue: 2000, won: 1, lost: 3, open: 6, showed: 4, noShow: 4, speedMin: 60, set: 2, closedByPipeline: { p1: { revenue: 500, won: 1, lost: 1, cash: 0 }, p2: { revenue: 1500, won: 0, lost: 2, cash: 0 } }, openByPipeline: { p1: 2, p2: 4 }, byPipeline: [{ id: 'p1', leads: 3 }, { id: 'p2', leads: 6 }] },
  { id: 'c', revenue: 0, won: 0, lost: 0, open: 0, showed: 0, noShow: 0, speedMin: null, set: 0 },
]
const ids = reps.map((r) => r.id)

// Splits
const biz = normGoals([{ id: 'g1', metric: 'revenue', target: 12000, split: 'even' }])[0]
assert.equal(goalLevel(biz), 'business')
assert.deepEqual(goalShares(biz, ids), { a: 4000, b: 4000, c: 4000 })
const w = normGoals([{ id: 'g2', metric: 'won', target: 10, reps: ['a', 'b'], split: 'weighted', weights: { a: 70, b: 30 } }])[0]
assert.deepEqual(goalShares(w, ids), { a: 7, b: 3 })
assert.deepEqual(validateGoal(w, ids), [])
assert.ok(validateGoal({ ...w, weights: { a: 50, b: 30 } }, ids)[0].includes('80%'), 'weights must sum to 100')
const cu = normGoals([{ id: 'g3', metric: 'revenue', target: 9000, reps: ['a', 'b'], split: 'custom', shares: { a: 6000, b: 3000 } }])[0]
assert.deepEqual(goalShares(cu, ids), { a: 6000, b: 3000 })
assert.ok(validateGoal({ ...cu, shares: { a: 6000, b: 2000 } }, ids)[0].includes('8000'), 'custom must add up')
const sh = normGoals([{ id: 'g4', metric: 'revenue', target: 5000, split: 'shared' }])[0]
assert.deepEqual(goalShares(sh, ids), { a: null, b: null, c: null }, 'shared gives nobody a slice')
assert.ok(validateGoal({ id: 'x', metric: 'booked', target: 5, pipelines: ['p1'], split: 'shared' }, ids)[0].includes('per pipeline'), 'appointments cannot be pipeline-scoped')

// Values within a pipeline
assert.equal(repValue(reps[1], 'revenue', null), 2000)
assert.equal(repValue(reps[1], 'revenue', ['p1']), 500)
assert.equal(repValue(reps[1], 'leads', ['p1', 'p2']), 9)
assert.equal(repValue(reps[1], 'winRate', ['p2']), 0)
assert.equal(repValue(reps[1], 'resultRate', ['p1']), 50, '1 won + 1 lost over those plus 2 open')

// Team actual by scope
assert.equal(goalActual(biz, reps), 8000)
const pipe = normGoals([{ id: 'g5', metric: 'revenue', target: 7000, pipelines: ['p1'], split: 'shared' }])[0]
assert.equal(goalLevel(pipe), 'pipeline')
assert.equal(goalActual(pipe, reps), 6500)
const wr = normGoals([{ id: 'g6', metric: 'winRate', target: 50 }])[0]
assert.equal(goalActual(wr, reps), 50, 'rates rebuilt from parts: 4 won of 8 decided')
const sr = normGoals([{ id: 'g7', metric: 'showRate', target: 80, reps: ['a', 'b'] }])[0]
assert.equal(goalActual(sr, reps), 67)
const sp = normGoals([{ id: 'g8', metric: 'speedMin', target: 30 }])[0]
assert.equal(goalActual(sp, reps), 60, 'median of the reps measured')

// A rep's own targets: standalone beats a share; shared gives nothing
const own = normGoals([{ id: 'g9', metric: 'revenue', target: 9999, reps: ['a'] }])[0]
const t = repTargetsFromGoals([biz, own, sh, w], 'a', ids)
assert.deepEqual(t, { revenue: 9999, won: 7 })
assert.deepEqual(repTargetsFromGoals([biz, sh], 'b', ids), { revenue: 4000 })

// Migration from Rep KPIs
const mig = migrateRepKpis({ default: { revenue: 1500, booked: 20 }, byUser: { a: { revenue: 3000 } } })
assert.equal(mig.length, 3)
assert.equal(mig[0].split, 'each'); assert.equal(mig[0].reps, null)
assert.deepEqual(mig[2].reps, ['a']); assert.equal(goalLevel(mig[2]), 'rep')
assert.deepEqual(repTargetsFromGoals(mig, 'a', ids), { revenue: 3000, booked: 20 })
assert.deepEqual(repTargetsFromGoals(mig, 'b', ids), { revenue: 1500, booked: 20 })
assert.equal(goalShareFor(mig[0], 'zz', null), 1500, 'an each goal needs no rep list')
assert.equal(goalShareFor(biz, 'a', null), null, 'an even split needs the rep list')
assert.equal(goalShareFor(biz, 'a', ids), 4000)

// Windows and plans
const mg = normGoals([{ id: 'w1', metric: 'revenue', target: 10000, period: 'month', split: 'each', byMonth: { '2026-10': 12000 }, endsOn: '2026-11' }])[0]
let gw = goalWindow(mg, '2026-09-13')
assert.equal(gw.key, '2026-09'); assert.equal(gw.from, '2026-09-01'); assert.equal(gw.to, '2026-09-30'); assert.equal(Math.round(gw.elapsed * 100), 43); assert.equal(gw.active, true)
assert.equal(goalTargetFor(mg, '2026-09'), 10000); assert.equal(goalTargetFor(mg, '2026-10'), 12000, 'the plan overrides October')
assert.equal(goalWindow(mg, '2026-12-01').active, false, 'stops after endsOn')
const qg = normGoals([{ id: 'w2', metric: 'won', target: 60, period: 'quarter', byQuarter: { '2026-Q4': 80 } }])[0]
gw = goalWindow(qg, '2026-09-13')
assert.equal(gw.key, '2026-Q3'); assert.equal(gw.from, '2026-07-01'); assert.equal(gw.to, '2026-09-30'); assert.equal(gw.label, 'Q3 2026'); assert.equal(Math.round(gw.elapsed * 100), 82)
assert.equal(goalTargetFor(qg, '2026-Q4'), 80)
const rg = normGoals([{ id: 'w3', metric: 'leads', target: 50, period: 'range', from: '2026-09-10', to: '2026-09-19' }])[0]
gw = goalWindow(rg, '2026-09-13')
assert.equal(gw.active, true); assert.equal(gw.elapsed, 0.4); assert.equal(goalWindow(rg, '2026-09-25').ended, true); assert.equal(goalWindow(rg, '2026-09-01').notYet, true)
assert.ok(validateGoal({ ...rg, to: '2026-09-01' }, ids)[0].includes('before'), 'range end must follow start')
assert.deepEqual(monthKeysFrom('2026-11-05', 3), ['2026-11', '2026-12', '2027-01'])
assert.deepEqual(quarterKeysFrom('2026-09-13', 2), ['2026-Q3', '2026-Q4'])
// Rep targets follow the month's plan and skip quarter goals
assert.deepEqual(repTargetsFromGoals([mg, qg], 'a', ids, '2026-10-02'), { revenue: 12000 })
assert.deepEqual(repTargetsFromGoals([mg], 'a', ids, '2026-12-02'), {}, 'nothing once the goal has ended')
// Average deal value: rebuilt from revenue and wins, never averaged or split
const ad = normGoals([{ id: 'ad1', metric: 'avgDeal', target: 2500, split: 'even' }])[0]
assert.equal(ad.split, 'each', 'an average is every rep\'s own target')
assert.equal(goalActual(ad, reps), 2000, '8000 over 4 wins, not the mean of the reps\' averages')
assert.equal(goalShareFor(ad, 'b', ids), 2500)
assert.equal(repValue(reps[0], 'avgDeal', ['p1']), 2000)
assert.equal(repValue(reps[2], 'avgDeal', ['p1']), null, 'no wins, no average')
assert.equal(goalActual(normGoals([{ id: 'ad2', metric: 'avgDeal', target: 900, pipelines: ['p1'] }])[0], reps), 1625, '6500 over 4 wins in p1')
assert.deepEqual(validateGoal({ ...ad, split: 'custom', shares: {} }, ids), [], 'no share sums to check on an average')
console.log('goals_test ok')
