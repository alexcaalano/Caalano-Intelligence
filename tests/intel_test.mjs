const ROOT = new URL('../', import.meta.url).pathname
// The Caalano360 intelligence model: reach + bottleneck, channels, movers,
// indexing, banner lines. Lifted from App.jsx.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const consts = src.slice(src.indexOf('const INTEL_MIN_BASE'), src.indexOf('function intelReach('))
const body = consts + ['intelReach', 'intelChannels', 'intelMovers', 'intelIndex', 'intelLines'].map(lift).join('\n') + "\nconst fmtNumber = (v) => String(v)\n"
const { intelReach, intelChannels, intelMovers, intelIndex, intelLines } = new Function(body + 'return { intelReach, intelChannels, intelMovers, intelIndex, intelLines }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t
const money = (v) => `$${v}`

// --- reach + bottleneck --------------------------------------------------------
const rows = [{ label: 'Booked', kind: 'stage', count: 40, leadBase: 100, pipeline: 'p1' }, { label: 'Showed', kind: 'stage', count: 12, leadBase: 100, pipeline: 'p1' }, { label: 'Won', kind: 'won', count: 9, leadBase: 100, pipeline: 'p1' }]
const prev = [{ label: 'Booked', kind: 'stage', count: 30, leadBase: 80, pipeline: 'p1' }, { label: 'Showed', kind: 'stage', count: 15, leadBase: 80, pipeline: 'p1' }, { label: 'Won', kind: 'won', count: 6, leadBase: 80, pipeline: 'p1' }]
let R = intelReach(rows, 100, prev, 80)
ok('rates are shares of leads', near(R[0].rate, .4) && near(R[1].rate, .12) && near(R[2].rate, .09), R.map((r) => r.rate))
ok('steps are shares of the row before', near(R[0].step, .4) && near(R[1].step, .3) && near(R[2].step, .75), R.map((r) => r.step))
ok('previous period rates and steps', near(R[0].prevRate, .375) && near(R[1].prevStep, .5), [R[0].prevRate, R[1].prevStep])
ok('the bottleneck is the lowest step with a real base', R[1].bottleneck === true && !R[0].bottleneck && !R[2].bottleneck, R.map((r) => r.bottleneck))
ok('step base is carried', R[1].stepBase === 40 && R[2].stepBase === 12)
// A thin step is never the bottleneck.
R = intelReach([{ label: 'A', kind: 'stage', count: 50, leadBase: 100 }, { label: 'B', kind: 'stage', count: 5, leadBase: 100 }, { label: 'C', kind: 'stage', count: 1, leadBase: 100 }], 100, [], 0)
ok('a step whose base is under 10 is not judged', R[1].bottleneck === true && !R[2].bottleneck, R.map((r) => [r.stepBase, r.bottleneck]))
// Two pipelines are judged separately.
R = intelReach([{ label: 'A', kind: 'stage', count: 50, leadBase: 100, pipeline: 'x' }, { label: 'B', kind: 'stage', count: 40, leadBase: 100, pipeline: 'x' }, { label: 'A', kind: 'stage', count: 10, leadBase: 50, pipeline: 'y' }, { label: 'B', kind: 'stage', count: 9, leadBase: 50, pipeline: 'y' }], 150, [], 0)
ok('one bottleneck per pipeline', R.filter((r) => r.bottleneck).map((r) => r.pipelineId + r.label).join() === 'xA,yA', R.map((r) => [r.pipelineId, r.label, r.bottleneck]))
ok('no rows -> no throw', intelReach([], 0, [], 0).length === 0)
// Closed basis: more wins than leads. Clamped, flagged, not a mover.
R = intelReach([{ label: 'Call', kind: 'stage', count: 110, leadBase: 31 }, { label: 'Won', kind: 'won', count: 110, leadBase: 31 }], 31, [{ label: 'Call', kind: 'stage', count: 112, leadBase: 27 }, { label: 'Won', kind: 'won', count: 112, leadBase: 27 }], 27)
ok('reach over 100% is clamped and flagged', R[0].rate === 1 && R[0].over === true && R[0].prevRate === 1 && R[0].prevOver === true && R[1].step === 1, R)
ok('flagged rows never become reach movers', !intelMovers({ totals: { leads: 31, won: 110, lost: 0 } }, { totals: { leads: 27, won: 112, lost: 0 } }, R, intelReach([{ label: 'Call', kind: 'stage', count: 112, leadBase: 27 }], 27, [], 0)).some((m) => m.key.startsWith('reach')))

// --- channels ------------------------------------------------------------------
const cc = {
  totals: { leads: 100, won: 12, lost: 40, open: 48 },
  spend: { meta: 3000, google: 2000, total: 5000 },
  paid: { metaLeads: 60, googleLeads: 20, paidLeads: 80, paidCpl: 62.5, paidCpa: 500, metaCpl: 50, googleCpl: 100, metaWon: 8, googleWon: 2, paidWon: 10, metaCpa: 375, googleCpa: 1000 },
  revenue: { total: 24000 }, lostByReason: [{ reason: 'Budget', count: 20 }, { reason: 'Gone cold', count: 10 }],
  closeByChannel: [{ channel: 'meta', leads: 60, won: 8, closed: 30, revenue: 16000 }, { channel: 'google', leads: 20, won: 2, closed: 10, revenue: 4000 }, { channel: 'other', leads: 20, won: 2, closed: 8, revenue: 4000 }],
  timeToWon: { median: 4, n: 12 }, timeToLost: { median: 14, n: 40 },
}
const C = intelChannels(cc)
const cm = Object.fromEntries(C.map((c) => [c.key, c]))
ok('channel outcomes', cm.meta.spend === 3000 && cm.meta.cpl === 50 && cm.meta.cac === 375 && near(cm.meta.winRate, 8 / 60) && cm.meta.lost === 22 && cm.google.cac === 1000 && cm.other.cpl === null && cm.other.cac === null, cm)
ok('win rate index vs blended (12%)', cm.meta.idx.winRate === Math.round((8 / 60) / .12 * 100) && cm.google.idx.winRate === 83, [cm.meta.idx, cm.google.idx])
ok('ordered by leads', C[0].key === 'meta')
ok('thin channel is not indexed', intelChannels({ ...cc, closeByChannel: [{ channel: 'google', leads: 5, won: 1, closed: 2 }] })[0].idx.winRate === null)

// --- movers --------------------------------------------------------------------
const pcc = { ...cc, totals: { leads: 80, won: 12, lost: 20, open: 48 }, spend: { meta: 2000, google: 2000, total: 4000 }, paid: { ...cc.paid, paidCpl: 50, paidCpa: 400, metaCpl: 40, googleCpl: 100, metaLeads: 50, googleLeads: 20, metaWon: 6, googleWon: 4, paidWon: 10 }, revenue: { total: 30000 }, lostByReason: [{ reason: 'Budget', count: 6 }, { reason: 'Gone cold', count: 10 }] }
const prev2 = prev.map((r) => (r.label === 'Showed' ? { ...r, count: 25 } : r))
const reachNow = intelReach(rows, 100, prev2, 80), reachPrev = intelReach(prev2, 80, [], 0)
const M = intelMovers(cc, pcc, reachNow, reachPrev)
const mk = Object.fromEntries(M.map((m) => [m.key, m]))
ok('lost doubled is a bad mover', mk.lost && mk.lost.pct === 100 && mk.lost.good === false, mk.lost)
ok('leads up 25% is a good mover', mk.leads && mk.leads.pct === 25 && mk.leads.good === true, mk.leads)
ok('revenue down 20% is bad, with the won count as why', mk.revenue && mk.revenue.pct === -20 && !mk.revenue.good && /12 vs 12 won/.test(mk.revenue.why), mk.revenue)
ok('won unchanged is not a mover', !mk.won)
ok('cost per lead up 25% is bad, decomposed', mk.cpl && mk.cpl.pct === 25 && !mk.cpl.good && /leads/.test(mk.cpl.why), mk.cpl)
ok('result rate fell 14 pts', mk.result && Math.round(mk.result.pts) === -14 && !mk.result.good, mk.result)
ok('top lost reason share rose', mk['lost:Budget'] && mk['lost:Budget'].pts > 0 && !mk['lost:Budget'].good, mk['lost:Budget'])
ok('reach change in points', mk['reach:p1|Showed'] && Math.round(mk['reach:p1|Showed'].pts) === -19 && !mk['reach:p1|Showed'].good && !mk['reach:p1|Booked'], Object.keys(mk))
ok('ranked by size and capped at 10', M.length <= 10 && M.every((m, i) => !i || m.score <= M[i - 1].score), M.map((m) => [m.key, m.score]))
ok('no previous period -> no movers', intelMovers(cc, null, [], []).length === 0)
// A count under 5 on both sides is never a mover.
ok('thin counts are held back', !intelMovers({ ...cc, totals: { leads: 3, won: 1, lost: 1 } }, { ...pcc, totals: { leads: 1, won: 0, lost: 0 } }, [], []).some((m) => m.key === 'leads'))

// --- indexing ------------------------------------------------------------------
const keys = ['pipeline', 'stage', 'campaign', 'adset', 'creative', 'keyword', 'source', 'channel']
const dict = { pipeline: ['P1', 'P2'], stage: ['New', 'Booked', 'Won'], campaign: ['Camp A', 'Camp B', 'Not tagged'], adset: ['x'], creative: ['x'], keyword: ['x'], source: ['s'], channel: ['meta', 'google', 'other'] }
const mkRow = (status, pipe, camp, chan, pos) => [status, pipe, 0, camp, 0, 0, 0, 0, chan, pos, null]
const oppRows = []
// P1 / Camp A / meta: 20 leads, 8 won, 4 lost, 16 reached Booked (pos 1)
for (let i = 0; i < 20; i++) oppRows.push(mkRow(i < 8 ? 1 : i < 12 ? 2 : 0, 0, 0, 0, i < 16 ? 1 : 0))
// P1 / Camp B / google: 20 leads, 1 won, 10 lost, 5 reached
for (let i = 0; i < 20; i++) oppRows.push(mkRow(i < 1 ? 1 : i < 11 ? 2 : 0, 0, 1, 1, i < 5 ? 1 : 0))
// P2 / untagged / other: 10 leads, 2 won, 2 lost, 4 reached (P2 first key event at pos 2)
for (let i = 0; i < 10; i++) oppRows.push(mkRow(i < 2 ? 1 : i < 4 ? 2 : 0, 1, 2, 2, i < 4 ? 2 : 0))
const icc = { spend: { meta: 1000, google: 2000 }, oppFacts: { keys, dict, rows: oppRows, total: 50, capped: false } }
const I = intelIndex(icc, { P1: { pos: 1, label: 'Booked' }, P2: { pos: 2, label: 'Won' } })
ok('base is the blended figure', I.base.leads === 50 && I.base.won === 11 && near(I.base.winRate, .22) && near(I.base.keReach, 25 / 50) && near(I.base.cpl, 3000 / 40), I.base)
const ca = I.campaigns.find((c) => c.label === 'Camp A'), cb = I.campaigns.find((c) => c.label === 'Camp B')
ok('campaign A indexes above', ca.leads === 20 && ca.won === 8 && ca.idx.winRate === Math.round((.4 / .22) * 100) && ca.idx.keReach === 160, ca)
ok('campaign B indexes below', cb.idx.winRate === Math.round((.05 / .22) * 100) && cb.idx.keReach === 50, cb)
ok('untagged is not a campaign cut', !I.campaigns.some((c) => c.label === 'Not tagged'))
ok('pipelines cut when more than one', I.pipelines.length === 2 && I.pipelines[0].label === 'P1' && near(I.pipelines[0].share, .8), I.pipelines.map((p) => [p.label, p.share]))
const chM = I.channels.find((c) => c.label === 'Meta'), chG = I.channels.find((c) => c.label === 'Google'), chO = I.channels.find((c) => c.label === 'Non-paid')
ok('channel CPL indexes only where spend exists; lower is the better index', chM.cpl === 50 && chM.idx.cpl === Math.round(50 / 75 * 100) && chG.cpl === 100 && chG.idx.cpl === 133 && chO.cpl === null && chO.idx.cpl === null, [chM.idx, chG.idx, chO.idx])
ok('a won row counts as reached whatever its stage', I.pipelines.find((p) => p.label === 'P2').reach === 4)
ok('thin cut is shown but not indexed', (() => { const J = intelIndex({ ...icc, oppFacts: { keys, dict, rows: oppRows.slice(0, 5) } }, {}); return J.campaigns[0].thin && J.campaigns[0].idx.winRate == null })())
ok('no facts -> null', intelIndex({}, {}) === null)

// --- banner lines --------------------------------------------------------------
const model = { cc, pcc, reach: intelReach(rows, 100, prev, 80).map((r) => ({ ...r, pipelineName: 'Allied' })), channels: C, movers: M, index: I }
const L = intelLines(model, money)
ok('lines exist and are ranked high first', L.length >= 4 && L[0].sev === 'high' || L[0].sev === 'med', L.map((l) => l.sev))
ok('the bottleneck line names the step and both counts', L.some((l) => /Biggest leak in Allied: 30% .*Showed \(12 of 40\)/.test(l.text) && /down from 50%/.test(l.text)), L.map((l) => l.text))
ok('the channel line compares win rates and cost per win', L.some((l) => /Meta wins 13% of its 60 leads at \$375 each; Google 10% of 20 at \$1000\. Google costs 2\.7× more per win\./.test(l.text)), L.map((l) => l.text))
ok('the lost-reason concentration line', L.some((l) => /"Budget" accounts for 50% of lost deals \(20 of 40\)/.test(l.text)))
ok('the pace line', L.some((l) => /Losses take 14 days to be called against 4 days to win/.test(l.text)))
ok('mover lines carry tab tags', L.filter((l) => /vs the previous period/.test(l.text)).every((l) => l.tags.includes('overall')))
ok('an indexing outlier line, under-performer first', (() => { const i = L.findIndex((l) => /Campaign Camp B converts at 23% of the account average \(1 of 20 won\), and only 5 reached the first key event/.test(l.text)); const j = L.findIndex((l) => /Camp A converts at 182%/.test(l.text)); return i >= 0 && j > i })(), L.map((l) => l.text))
ok('thin period caveat appears under 30 leads', intelLines({ cc: { totals: { leads: 12, won: 1, lost: 2 } }, reach: [], channels: [], movers: [] }, money).some((l) => /Only 12 opportunities/.test(l.text)))
ok('empty model -> no lines, no throw', intelLines(null, money).length === 0 && intelLines({ cc: null, reach: [], channels: [], movers: [] }, money).length === 0)
console.log(`${n - bad}/${n} intelligence checks passed`)
if (bad) process.exit(1)
