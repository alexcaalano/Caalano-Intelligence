const ROOT = new URL('../', import.meta.url).pathname
// The pipeline lens: the Caalano360 payload re-cut to one pipeline in the browser.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const { lensCc, lrTimeStats } = new Function(['lrTimeStats', 'lensCc'].map(lift).join('\n') + '\nreturn { lensCc, lrTimeStats }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

const keys = ['pipeline', 'stage', 'campaign', 'adset', 'creative', 'keyword', 'source', 'channel']
const dict = { pipeline: ['Allied Health', 'ADHD'], stage: ['New', 'Booked', 'Won'], campaign: ['A'], adset: ['x'], creative: ['x'], keyword: ['x'], source: ['Paid Social', 'Google Ads', 'Referral'], channel: ['meta', 'google', 'other'] }
// [status, pipeline, stage, campaign, adset, creative, keyword, source, channel, stagePos, days]
const opp = [
  [1, 0, 2, 0, 0, 0, 0, 0, 0, 2, 4], [2, 0, 1, 0, 0, 0, 0, 0, 0, 1, 2], [2, 0, 0, 0, 0, 0, 0, 1, 1, 0, 6], [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, null],
  [1, 1, 2, 0, 0, 0, 0, 2, 2, 2, 30], [2, 1, 1, 0, 0, 0, 0, 2, 2, 1, 9], [0, 1, 0, 0, 0, 0, 0, 1, 1, 0, null],
]
const lost = [[0, 0, 1, 0, 0, 0, 0, 0, 0, 100, 'c1', 'Ann', 1], [0, 0, 0, 0, 0, 0, 0, 1, 1, 50, 'c2', 'Bob', 0], [1, 1, 1, 0, 0, 0, 0, 2, 2, 20, 'c3', 'Cy', 1]]
const cc = {
  spend: { meta: 1000, google: 500, total: 1500 },
  paid: { metaLeads: 4, googleLeads: 2, paidLeads: 6, paidCpl: 250 },
  totals: { leads: 7, won: 2, lost: 3, open: 2 },
  revenue: { total: 3000, count: 2, deals: [{ name: 'a', value: 1000, pipeline: 'Allied Health' }, { name: 'b', value: 2000, pipeline: 'ADHD' }] },
  open: { total: 2, value: 900, deals: [{ name: 'o1', value: 400, pipeline: 'Allied Health' }, { name: 'o2', value: 500, pipeline: 'ADHD' }] },
  pipelinesFunnel: [{ id: 'p1', name: 'Allied Health', stages: [{ id: 's1', name: 'New', pos: 0, count: 1 }, { id: 's2', name: 'Booked', pos: 1, count: 2 }, { id: 's3', name: 'Won', pos: 2, count: 1 }] }, { id: 'p2', name: 'ADHD', stages: [{ id: 't1', name: 'New', pos: 0, count: 1 }, { id: 't2', name: 'Booked', pos: 1, count: 1 }, { id: 't3', name: 'Won', pos: 2, count: 1 }] }],
  pipeContribution: [
    { id: 'p1', name: 'Allied Health', leads: 4, won: 1, lost: 2, open: 1, revenue: 1000, openValue: 400, chan: { meta: { leads: 3, won: 1, revenue: 1000 }, google: { leads: 1, won: 0, revenue: 0 }, other: { leads: 0, won: 0, revenue: 0 } } },
    { id: 'p2', name: 'ADHD', leads: 3, won: 1, lost: 1, open: 1, revenue: 2000, openValue: 500, chan: { meta: { leads: 1, won: 0, revenue: 0 }, google: { leads: 1, won: 0, revenue: 0 }, other: { leads: 1, won: 1, revenue: 2000 } } },
  ],
  closeByChannel: [{ channel: 'meta', won: 1, closed: 2, leads: 4, revenue: 1000, closeRate: 50 }],
  bookingByCalendar: [{ id: 'c', calendar: 'Cal', booked: 5, shown: 3 }],
  lostByReason: [{ reason: 'Budget', count: 2, value: 120, people: [{ name: 'Ann', pipeline: 'Allied Health' }, { name: 'Cy', pipeline: 'ADHD' }] }, { reason: 'Gone cold', count: 1, value: 50, people: [{ name: 'Bob', pipeline: 'Allied Health' }] }],
  lostBy: { pipeline: [{ key: 'Allied Health', count: 2, value: 150, reasons: [{ reason: 'Budget', count: 1, value: 100 }, { reason: 'Gone cold', count: 1, value: 50 }] }, { key: 'ADHD', count: 1, value: 20, reasons: [{ reason: 'Budget', count: 1, value: 20 }] }], source: [{ key: 'Paid Social', count: 2 }] },
  lostFacts: { keys: ['reason', ...keys], dict: { reason: ['Budget', 'Gone cold'], ...dict }, rows: lost, total: 3, capped: false },
  oppFacts: { keys, dict, rows: opp, total: 7, capped: false },
  oppsBySource: [{ source: 'Paid Social', count: 4 }],
}
ok('no pipeline = untouched payload', lensCc(cc, 'all') === cc && lensCc(cc, null) === cc && lensCc(null, 'p1') === null)
const L = lensCc(cc, 'p1')
ok('lens is flagged and named', L.lens && L.lens.pipeline === 'p1' && L.lens.name === 'Allied Health' && !L.lens.empty, L.lens)
ok('totals are the pipeline\'s own', L.totals.leads === 4 && L.totals.won === 1 && L.totals.lost === 2 && L.totals.open === 1, L.totals)
ok('revenue and open value follow', L.revenue.total === 1000 && L.open.value === 400, [L.revenue.total, L.open.value])
ok('deals narrowed by pipeline', L.revenue.deals.length === 1 && L.revenue.deals[0].name === 'a' && L.open.deals.length === 1 && L.open.deals[0].name === 'o1')
ok('only this pipeline\'s funnel and contribution remain', L.pipelinesFunnel.length === 1 && L.pipelinesFunnel[0].id === 'p1' && L.pipeContribution.length === 1)
// Spend: meta 3 of 4 leads -> 750; google 1 of 2 -> 250.
ok('spend allocated by lead share', L.spend.meta === 750 && L.spend.google === 250 && L.spend.total === 1000 && L.spend.allocated === true, L.spend)
ok('paid costs re-derived on the allocation', L.paid.metaLeads === 3 && L.paid.metaCpl === 250 && L.paid.googleCpl === 250 && L.paid.paidCpl === 250 && L.paid.paidWon === 1 && L.paid.paidCpa === 1000 && L.paid.metaCpa === 750 && L.paid.googleCpa === null, L.paid)
ok('facts rows cut to the pipeline', L.oppFacts.rows.length === 4 && L.oppFacts.rows.every((r) => r[1] === 0) && L.lostFacts.rows.length === 2 && L.lostFacts.rows.every((r) => r[1] === 0), [L.oppFacts.rows.length, L.lostFacts.rows.length])
ok('facts totals are the exact pipeline counts', L.oppFacts.total === 4 && L.lostFacts.total === 2)
const cbc = Object.fromEntries(L.closeByChannel.map((c) => [c.channel, c]))
ok('close by channel: leads/won/revenue exact, lost from rows', cbc.meta.leads === 3 && cbc.meta.won === 1 && cbc.meta.revenue === 1000 && cbc.meta.closed === 2 && cbc.meta.closeRate === 50 && cbc.google.leads === 1 && cbc.google.won === 0 && cbc.google.closed === 1 && cbc.google.closeRate === 0, cbc)
ok('channels with nothing are dropped', !cbc.other)
ok('lost reasons are the pipeline cut with people narrowed', L.lostByReason.length === 2 && L.lostByReason[0].reason === 'Budget' && L.lostByReason[0].count === 1 && L.lostByReason[0].people.length === 1 && L.lostByReason[0].people[0].name === 'Ann', L.lostByReason)
ok('lostBy.pipeline holds only this pipeline', L.lostBy.pipeline.length === 1 && L.lostBy.pipeline[0].key === 'Allied Health' && L.lostBy.source === cc.lostBy.source)
ok('time-to from the rows', L.timeToWon.median === 4 && L.timeToWon.n === 1 && L.timeToLost.median === 4 && L.timeToLost.n === 2, [L.timeToWon, L.timeToLost])
ok('calendars and sources stay account-wide, and say so', L.bookingByCalendar === cc.bookingByCalendar && L.oppsBySource === cc.oppsBySource && L.lens.calendarsAccountWide && L.lens.sourcesAccountWide)
ok('the original payload is not mutated', cc.totals.leads === 7 && cc.oppFacts.rows.length === 7 && cc.spend.meta === 1000 && cc.pipelinesFunnel.length === 2)
// Second pipeline: other-channel win, no paid wins.
const M = lensCc(cc, 'p2')
ok('second pipeline', M.totals.won === 1 && M.spend.meta === 250 && M.spend.google === 250 && M.paid.paidCpa === null && M.closeByChannel.find((c) => c.channel === 'other').won === 1, [M.spend, M.paid.paidCpa])
// Unknown pipeline: empty, not a throw.
const E = lensCc(cc, 'nope')
ok('unknown pipeline is empty and flagged', E.lens.empty && E.totals.leads === 0 && E.pipelinesFunnel.length === 0 && E.oppFacts.rows.length === 0 && E.spend.total === 0, E.lens)
// Payload without facts (older cache) still lenses the exact parts.
const P = lensCc({ ...cc, oppFacts: undefined, lostFacts: undefined }, 'p1')
ok('no facts: still totals / spend / channels', P.totals.leads === 4 && P.spend.total === 1000 && P.closeByChannel.find((c) => c.channel === 'meta').closed === 1 && P.timeToWon.n === 0, P.closeByChannel)
// lrTimeStats
const t = lrTimeStats([1, 2, 3, 4, 5, 6, 7, 8, null])
ok('time stats', t.median === 4.5 && t.n === 8 && t.skipped === 1 && t.p25 === 3 && t.p75 === 7, t)
ok('time stats empty', lrTimeStats([]).median === null && lrTimeStats([null]).skipped === 1)
console.log(`${n - bad}/${n} pipeline-lens checks passed`)
if (bad) process.exit(1)
