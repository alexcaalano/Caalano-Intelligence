// Goals: one object for business, pipeline and rep targets. The level falls
// out of the scope (all pipelines and all reps = business; one pipeline =
// pipeline goal; one rep = rep goal) and a split says how the target is
// shared among the attached reps. Shared by the app and its tests.
//
// goal = { id, name, metric, target, period: 'month'|'quarter'|'range',
//          from, to (range only, YYYY-MM-DD), endsOn (recurring only, YYYY-MM or null),
//          byMonth: { 'YYYY-MM': n }, byQuarter: { 'YYYY-Qn': n } (targets that
//          differ from the default for particular months or quarters),
//          pipelines: null|[id], reps: null|[id],
//          split: 'shared'|'each'|'even'|'weighted'|'custom',
//          weights: { repId: pct }, shares: { repId: n } }
//
// Monthly and quarterly goals recur until endsOn; a range goal runs once.
//
// 'shared' is one team number nobody owns a slice of; 'each' gives every
// attached rep the full target (the old "default per rep"); 'even', 'weighted'
// and 'custom' divide the target among the attached reps.

// kind: money | count | pct | lower (lower is better). pipe: can be scoped to
// a pipeline (appointments, calls and speed are per rep, not per pipeline).
export const GOAL_METRICS = [
  ['revenue', 'Revenue', 'money', true], ['cash', 'Cash collected', 'money', true], ['won', 'Deals closed', 'count', true],
  ['leads', 'Leads', 'count', true], ['winRate', 'Win rate', 'pct', true], ['resultRate', 'Result rate', 'pct', true],
  ['booked', 'Meetings booked', 'count', false], ['userBooked', 'Appointments set', 'count', false], ['held', 'Meetings held', 'count', false],
  ['showRate', 'Show rate', 'pct', false], ['calls', 'Calls made', 'count', false], ['minutes', 'Minutes on the phone', 'count', false],
  ['speedMin', 'Speed to lead (median minutes)', 'lower', false],
]
export const goalMetric = (key) => GOAL_METRICS.find((m) => m[0] === key) || null
export const SPLITS = [['shared', 'Shared team number'], ['each', 'Each rep gets this target'], ['even', 'Split evenly'], ['weighted', 'Split by percentage'], ['custom', 'Custom amount per rep']]
const RATE = new Set(['winRate', 'resultRate', 'showRate', 'speedMin'])

export function normGoals(v) {
  const arr = Array.isArray(v) ? v : (v && Array.isArray(v.goals)) ? v.goals : []
  return arr.filter((g) => g && g.id && goalMetric(g.metric) && Number(g.target) > 0).map((g) => ({
    id: String(g.id), name: String(g.name || ''), metric: g.metric, target: Number(g.target), period: ['month', 'quarter', 'range'].includes(g.period) ? g.period : 'month',
    from: g.period === 'range' && /^\d{4}-\d{2}-\d{2}$/.test(g.from || '') ? g.from : null, to: g.period === 'range' && /^\d{4}-\d{2}-\d{2}$/.test(g.to || '') ? g.to : null,
    endsOn: g.period !== 'range' && /^\d{4}-\d{2}$/.test(g.endsOn || '') ? g.endsOn : null,
    byMonth: Object.fromEntries(Object.entries(g.byMonth || {}).filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)])),
    byQuarter: Object.fromEntries(Object.entries(g.byQuarter || {}).filter(([k, v]) => /^\d{4}-Q[1-4]$/.test(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)])),
    pipelines: Array.isArray(g.pipelines) && g.pipelines.length ? g.pipelines.map(String) : null,
    reps: Array.isArray(g.reps) && g.reps.length ? g.reps.map(String) : null,
    split: (Array.isArray(g.reps) && g.reps.length === 1) ? 'each' : ['shared', 'each', 'even', 'weighted', 'custom'].includes(g.split) ? g.split : (RATE.has(g.metric) ? 'each' : 'shared'),
    weights: g.weights && typeof g.weights === 'object' ? g.weights : {}, shares: g.shares && typeof g.shares === 'object' ? g.shares : {},
  }))
}
export const newGoalId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Which reps a goal is attached to, given the current rep list.
export const goalRepIds = (goal, allRepIds) => (goal.reps ? goal.reps.filter((id) => !allRepIds || allRepIds.includes(id)) : (allRepIds || []))

// Each attached rep's own target under the split, or null when the number is
// shared and nobody owns a slice. Rate goals are always per rep.
export function goalShares(goal, allRepIds) {
  const ids = goalRepIds(goal, allRepIds)
  const out = {}
  if (!ids.length) return out
  // A rate is always per rep, and a goal on one rep is that rep's own target.
  const split = (RATE.has(goal.metric) || ids.length === 1 && goal.reps) ? 'each' : goal.split
  if (split === 'shared') { for (const id of ids) out[id] = null; return out }
  if (split === 'each') { for (const id of ids) out[id] = goal.target; return out }
  if (split === 'even') { const s = goal.target / ids.length; for (const id of ids) out[id] = Math.round(s * 100) / 100; return out }
  if (split === 'weighted') { for (const id of ids) out[id] = Math.round((goal.target * (Number(goal.weights[id]) || 0)) / 100 * 100) / 100; return out }
  for (const id of ids) out[id] = Number(goal.shares[id]) || 0
  return out
}
// Problems that stop a goal saving; [] when it is fine.
export function validateGoal(goal, allRepIds) {
  const errs = []
  const m = goalMetric(goal.metric)
  if (!m) errs.push('Pick a metric.')
  if (!(Number(goal.target) > 0)) errs.push('Enter a target above zero.')
  if (m && goal.pipelines && !m[3]) errs.push(`${m[1]} cannot be set per pipeline: appointments, calls and speed are per rep.`)
  const ids = goalRepIds(goal, allRepIds)
  if (goal.split === 'weighted') { const sum = ids.reduce((a, id) => a + (Number(goal.weights[id]) || 0), 0); if (Math.round(sum) !== 100) errs.push(`Percentages add up to ${Math.round(sum)}%, not 100%.`) }
  if (goal.split === 'custom' && !RATE.has(goal.metric)) { const sum = ids.reduce((a, id) => a + (Number(goal.shares[id]) || 0), 0); if (Math.abs(sum - Number(goal.target)) > 0.5) errs.push(`Rep amounts add up to ${Math.round(sum)}, not the target of ${Math.round(goal.target)}.`) }
  if ((goal.split === 'even' || goal.split === 'weighted' || goal.split === 'custom') && !ids.length) errs.push('Attach at least one rep to split the target.')
  if (goal.period === 'range') { if (!/^\d{4}-\d{2}-\d{2}$/.test(goal.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(goal.to || '')) errs.push('Pick a start and an end date.'); else if (goal.to < goal.from) errs.push('The end date is before the start date.') }
  return errs
}
// The window a goal is measured in as of a day (YYYY-MM-DD): this month, this
// quarter, or its own dates. `elapsed` is the share of the window gone, for
// the pace mark; `active` is false once a recurring goal has passed endsOn or a
// range goal has ended.
const pad = (n) => String(n).padStart(2, '0')
const dimOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const dayN = (ymd) => Math.round(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000)
export function goalWindow(goal, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7), d = +today.slice(8, 10)
  if (goal.period === 'quarter') {
    const q = Math.floor((m - 1) / 3); const m1 = q * 3 + 1, m3 = q * 3 + 3
    const from = `${y}-${pad(m1)}-01`, to = `${y}-${pad(m3)}-${pad(dimOf(y, m3))}`
    const total = dayN(to) - dayN(from) + 1, gone = dayN(today) - dayN(from) + 1
    const key = `${y}-Q${q + 1}`
    return { key, label: `Q${q + 1} ${y}`, from, to, elapsed: Math.min(1, Math.max(0.03, gone / total)), active: !goal.endsOn || `${y}-${pad(m3)}` >= goal.endsOn ? !goal.endsOn || goal.endsOn >= `${y}-${pad(m1)}` : true }
  }
  if (goal.period === 'range' && goal.from && goal.to) {
    const total = dayN(goal.to) - dayN(goal.from) + 1, gone = dayN(today) - dayN(goal.from) + 1
    const fmt = (ymd) => `${+ymd.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+ymd.slice(5, 7) - 1]}`
    return { key: `${goal.from}..${goal.to}`, label: `${fmt(goal.from)} to ${fmt(goal.to)}`, from: goal.from, to: goal.to, elapsed: Math.min(1, Math.max(0, gone / total)), active: today >= goal.from && today <= goal.to, ended: today > goal.to, notYet: today < goal.from }
  }
  const key = `${y}-${pad(m)}`; const dim = dimOf(y, m)
  return { key, label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }), from: `${key}-01`, to: `${key}-${pad(dim)}`, elapsed: Math.min(1, Math.max(0.03, d / dim)), active: !goal.endsOn || goal.endsOn >= key }
}
// The target for a particular month or quarter: the plan's number for it,
// else the goal's default.
export const goalTargetFor = (goal, key) => (goal.byMonth && goal.byMonth[key]) || (goal.byQuarter && goal.byQuarter[key]) || goal.target
// The next N month keys from a day, for the month-by-month plan.
export function monthKeysFrom(today, n = 12) { const y = +today.slice(0, 4), m = +today.slice(5, 7); return Array.from({ length: n }, (_, i) => { const mm = m - 1 + i; return `${y + Math.floor(mm / 12)}-${pad((mm % 12) + 1)}` }) }
export function quarterKeysFrom(today, n = 4) { const y = +today.slice(0, 4), q = Math.floor((+today.slice(5, 7) - 1) / 3); return Array.from({ length: n }, (_, i) => { const qq = q + i; return `${y + Math.floor(qq / 4)}-Q${(qq % 4) + 1}` }) }
// The level a goal reads as, for grouping in the settings list.
export const goalLevel = (goal) => (goal.reps && goal.reps.length === 1 ? 'rep' : goal.pipelines ? 'pipeline' : 'business')

// One rep's actual for a metric, within the goal's pipelines when scoped.
// Server rep rows carry closedByPipeline {pid: {won, revenue, cash, lost}},
// openByPipeline {pid: n} and byPipeline [{id, leads}] for the scoped case.
export function repValue(rep, metric, pipelines) {
  if (!rep) return null
  if (!pipelines) {
    if (metric === 'held') return rep.showed || 0
    if (metric === 'userBooked') return rep.set || 0
    return rep[metric] == null ? null : rep[metric]
  }
  const sum = (f) => pipelines.reduce((a, pid) => a + f(pid), 0)
  const c = (pid) => (rep.closedByPipeline || {})[pid] || {}
  if (metric === 'revenue' || metric === 'cash' || metric === 'won' || metric === 'lost') return sum((pid) => c(pid)[metric] || 0)
  if (metric === 'leads') return sum((pid) => ((rep.byPipeline || []).find((b) => b.id === pid) || {}).leads || 0)
  if (metric === 'open') return sum((pid) => (rep.openByPipeline || {})[pid] || 0)
  if (metric === 'winRate') { const w = repValue(rep, 'won', pipelines), l = repValue(rep, 'lost', pipelines); return (w + l) ? Math.round((w / (w + l)) * 100) : null }
  if (metric === 'resultRate') { const w = repValue(rep, 'won', pipelines), l = repValue(rep, 'lost', pipelines), o = repValue(rep, 'open', pipelines); return (w + l + o) ? Math.round(((w + l) / (w + l + o)) * 100) : null }
  return null
}
// The team actual for a goal: the attached reps' values within scope, with
// rates rebuilt from their parts rather than averaged.
export function goalActual(goal, reps) {
  const ids = new Set(goalRepIds(goal, reps.map((r) => r.id)))
  const inScope = reps.filter((r) => ids.has(r.id))
  const P = goal.pipelines
  const sum = (metric) => inScope.reduce((a, r) => a + (repValue(r, metric, P) || 0), 0)
  if (goal.metric === 'winRate') { const w = sum('won'), l = sum('lost'); return (w + l) ? Math.round((w / (w + l)) * 100) : null }
  if (goal.metric === 'resultRate') { const w = sum('won'), l = sum('lost'), o = P ? sum('open') : inScope.reduce((a, r) => a + (r.open || 0), 0); return (w + l + o) ? Math.round(((w + l) / (w + l + o)) * 100) : null }
  if (goal.metric === 'showRate') { const s = inScope.reduce((a, r) => a + (r.showed || 0), 0), n = inScope.reduce((a, r) => a + (r.noShow || 0), 0); return (s + n) ? Math.round((s / (s + n)) * 100) : null }
  if (goal.metric === 'speedMin') { const v = inScope.map((r) => r.speedMin).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
  return sum(goal.metric)
}
// A rep's own targets from every goal that covers them: a standalone rep goal
// wins over a share of a wider goal for the same metric; shared team numbers
// give the rep nothing of their own.
// One rep's share of a goal, or null (shared number, not attached, or a split
// that needs the rep list when none was given).
export function goalShareFor(goal, repId, allRepIds) {
  if (goal.reps && !goal.reps.includes(repId)) return null
  const split = RATE.has(goal.metric) || (goal.reps && goal.reps.length === 1) ? 'each' : goal.split
  if (split === 'shared') return null
  if (split === 'each') return goal.target
  if (!allRepIds && !goal.reps) return null
  const shares = goalShares(goal, allRepIds || goal.reps)
  return shares[repId] == null ? null : shares[repId]
}
export function repTargetsFromGoals(goals, repId, allRepIds, today = null) {
  const out = {}, own = {}
  for (const g0 of goals) {
    if (g0.period && g0.period !== 'month') continue
    const g = today ? (() => { const w = goalWindow(g0, today); return w.active ? { ...g0, target: goalTargetFor(g0, w.key) } : null })() : g0
    if (!g) continue
    const shares = { [repId]: goalShareFor(g, repId, allRepIds) }
    if (shares[repId] == null || !(shares[repId] > 0)) continue
    const standalone = g.reps && g.reps.length === 1
    if (standalone) { own[g.metric] = shares[repId]; out[g.metric] = shares[repId] }
    else if (!(g.metric in own)) out[g.metric] = (out[g.metric] || 0) + shares[repId]
  }
  return out
}
// The old Rep KPIs ({ default: {metric: n}, byUser: {repId: {metric: n}} })
// become goals: a default is "each rep gets this" across every rep; a per-rep
// number is a standalone rep goal.
export function migrateRepKpis(repkpis) {
  const goals = []
  const def = (repkpis && repkpis.default) || {}
  for (const [metric, v] of Object.entries(def)) if (goalMetric(metric) && Number(v) > 0) goals.push({ id: 'm-' + metric, name: `${goalMetric(metric)[1]} per rep`, metric, target: Number(v), period: 'month', pipelines: null, reps: null, split: 'each', weights: {}, shares: {} })
  for (const [uid, t] of Object.entries((repkpis && repkpis.byUser) || {})) for (const [metric, v] of Object.entries(t || {})) if (goalMetric(metric) && Number(v) > 0) goals.push({ id: `m-${metric}-${uid}`, name: goalMetric(metric)[1], metric, target: Number(v), period: 'month', pipelines: null, reps: [uid], split: 'each', weights: {}, shares: {} })
  return normGoals(goals)
}
