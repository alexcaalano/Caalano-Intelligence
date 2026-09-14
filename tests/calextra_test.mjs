const ROOT = new URL('../', import.meta.url).pathname
// Calendar key events: people who booked this period but are not among this
// period's new leads are attributed through their own lead (server attr) and
// join the row's channel split; the row's share of leads is measured on the
// new leads only, with the older bookings carried as `older`. Lifted from App.jsx.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const line = (start) => { const a = src.indexOf(start); if (a < 0) throw new Error('missing ' + start); return src.slice(a, src.indexOf('\n', a) + 1) }
const consts = src.slice(src.indexOf('const INTEL_MIN_BASE'), src.indexOf('function intelReach('))
const subConsts = src.slice(src.indexOf('const SUB_CHANNEL_KEYS = ['), src.indexOf('\n', src.indexOf('const SUB_LAST')) + 1)
const body = line('export const WON_RE') + consts + subConsts + line('const stageChanCount =') + line('const ccKeyEventsOf =')
  + line('const stripPipeTag =') + line('const nzStage =') + ['pipeOfKeyEvent', 'orderKeyEvents', 'mergeCalKeyEvents', 'reachedByStage', 'normKeyEvents', 'stageReachOf', 'stagePosMap', 'resolveKeyEvents', 'keyEventRows', 'keyEventsForPipe', 'intelReach', 'calExtraByLabel', 'addCalExtra', 'subCountsFor', 'channelKeyEvents', 'channelKeyEventsByPipe', 'v2ReachSplit', 'v2SubRows'].map(lift).join('\n')
  + '\nconst loadKeyEvents = () => KE\n'
const KE = [{ cal: 'c1', label: '15 Minute Call', stage: '15 Minute Call', pipeline: 'p1' }, { stage: 'Qualified', pipeline: 'p1', label: 'Qualified' }, { stage: 'Won', label: 'Won', pipeline: 'p1' }]
const M = new Function('KE', body.replace(/export (function|const) /g, '$1 ') + '\nreturn { keyEventRows, reachedByStage, stagePosMap, intelReach, channelKeyEvents, channelKeyEventsByPipe, v2ReachSplit, normKeyEvents }')(KE)
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// One pipeline, 100 new leads: 40 at New Lead, 50 at 15 Minute Call, 10 Qualified.
// Meta 60 / Google 30 / organic 10 of the leads, spread the same at each stage.
const stages = [
  { id: 's1', name: 'New Lead', pos: 0, count: 40, meta: 24, google: 12, other: 4, sub: { direct: 4 } },
  { id: 's2', name: '15 Minute Call', pos: 1, count: 50, meta: 30, google: 15, other: 5, sub: { organic: 3, referral: 2 } },
  { id: 's3', name: 'Qualified', pos: 2, count: 10, meta: 6, google: 3, other: 1, sub: { direct: 1 } },
]
const pipes = [{ id: 'p1', name: 'Pipeline', stages }]
// 60 people reached the 15 Minute Call stage or later (50 + 10). The calendar
// saw 90 bookings: 55 of those 60, plus 35 others - 5 of them new leads still
// at New Lead, and 30 bookings by older leads: 18 Meta, 8 Google, 3 referral,
// 1 no lead record. Union = 60 + 35 = 95; cohort = 60 + 5 = 65.
const cal = { id: 'c1', calendar: '15 Min Call', booked: 90, occurred: 70, shown: 50, noShow: 10, cancelled: 5,
  union: { 'p1::15 Minute Call': 95, '15 Minute Call': 95 },
  attr: { 'p1::15 Minute Call': { meta: 18 + 3, google: 8 + 1, sub: { referral: 3, direct: 1 }, noLead: 1 }, '15 Minute Call': { meta: 21, google: 9, sub: { referral: 3, direct: 1 }, noLead: 1 } },
  cohort: { 'p1::15 Minute Call': 65, '15 Minute Call': 65 } }
const cc = { pipelinesFunnel: pipes, bookingByCalendar: [cal], closeByChannel: [{ channel: 'meta', won: 5 }, { channel: 'google', won: 2 }], pipeContribution: [{ id: 'p1', leads: 100, won: 8, chan: { meta: { leads: 60, won: 5 }, google: { leads: 30, won: 2 }, other: { leads: 10, won: 1, sub: { direct: { leads: 5, won: 1 }, organic: { leads: 3, won: 0 }, referral: { leads: 2, won: 0 } } } } }] }

// keyEventRows: the calendar row carries the union count, the cohort and the extras
const calMap = new Map([[cal.id, { name: cal.calendar, count: cal.booked, occurred: cal.occurred, upcoming: 0, shown: cal.shown, noShow: cal.noShow, cancelled: cal.cancelled, union: cal.union, attr: cal.attr, cohort: cal.cohort }]])
const rows = M.keyEventRows(KE, M.reachedByStage(pipes), calMap, M.stagePosMap(pipes), 8)
const cr = rows.find((r) => r.kind === 'calendar')
ok('calendar row count is the union', cr && cr.count === 95, cr)
ok('calendar row cohort', cr && cr.cohort === 65, cr && cr.cohort)
ok('calendar row extras attributed', cr && cr.extra && cr.extra.meta === 21 && cr.extra.google === 9 && cr.extra.sub.referral === 3 && cr.extra.sub.nolead === 1, cr && cr.extra)
ok('stage rows untouched', rows.find((r) => r.label === 'Qualified').count === 10 && rows.find((r) => r.label === 'Qualified').cohort === undefined)

// intelReach: the calendar row's rate and step are on the 65 new leads; the
// 30 older bookings ride along; the step after it divides by 65, not 95.
for (const r of rows) r.leadBase = 100
const R = M.intelReach(rows, 100, null, 0, true)
const rc = R.find((r) => r.kind === 'calendar')
ok('reach: calendar count is the cohort', rc.count === 65 && rc.older === 30 && rc.total === 95, [rc.count, rc.older, rc.total])
ok('reach: rate on new leads', Math.abs(rc.rate - .65) < 1e-9, rc.rate)
ok('reach: next step divides by the cohort', R.find((r) => r.label === 'Qualified').stepBase === 65, R.find((r) => r.label === 'Qualified').stepBase)
// Without the cohort figure (older payload) nothing changes.
const rows0 = M.keyEventRows(KE, M.reachedByStage(pipes), new Map([[cal.id, { name: cal.calendar, count: cal.booked, shown: cal.shown, union: cal.union }]]), M.stagePosMap(pipes), 8)
for (const r of rows0) r.leadBase = 100
const R0 = M.intelReach(rows0, 100, null, 0, true)
ok('older payload: count stays the union, no older', R0.find((r) => r.kind === 'calendar').count === 95 && !R0.find((r) => r.kind === 'calendar').older)

// channelKeyEvents: the calendar row's per-channel counts include the extras,
// so Meta on that row is the 36 who reached the stage plus the 21 who booked.
const ck = M.channelKeyEvents(cc, 'client')
const ci = ck.labels.findIndex((l) => l.label === '15 Minute Call')
ok('channel: meta on the calendar row', ck.meta[ci] === 36 + 21, ck.meta)
ok('channel: google on the calendar row', ck.google[ci] === 18 + 9, ck.google)
ok('channel: sub referral incl. booked', ck.sub.referral[ci] === 2 + 3, ck.sub)
ok('channel: no-lead bookings as their own bucket', ck.sub.nolead[ci] === 1, ck.sub.nolead)
ok('channel: stage rows unchanged', ck.meta[ck.labels.findIndex((l) => l.label === 'Qualified')] === 6)
const bp = M.channelKeyEventsByPipe(cc, 'client')[0]
ok('by pipe: same extras', bp.meta[bp.labels.findIndex((l) => l.label === '15 Minute Call')] === 57 && bp.sub.nolead[bp.labels.findIndex((l) => l.label === '15 Minute Call')] === 1, bp)
// The split over the full row adds up with no "not tagged" remainder.
const sp = M.v2ReachSplit(95, 57, 27, { organic: 3, referral: 5, direct: 2, nolead: 1 })
ok('split covers the whole row', sp.meta + sp.google + sp.other === 95 && !sp.sub.find((r) => r.key === 'unknown') && sp.sub[sp.sub.length - 1].key === 'nolead', sp)

console.log(`calextra_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
