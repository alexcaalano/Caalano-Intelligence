const ROOT = new URL('../', import.meta.url).pathname
// Overview layout V2 scaffolding: the day list behind the daily series, the
// layout resolution rule, and the lens carrying daily series per pipeline.
import fs from 'fs'
import os from 'os'
import path from 'path'
const ghl = fs.readFileSync(ROOT + 'netlify/lib/ghl.mjs', 'utf8')
const app = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const liftFrom = (src) => (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const lg = liftFrom(ghl), la = liftFrom(app)
const mod = path.join(os.tmpdir(), `uiv2_test_${process.pid}.mjs`)
fs.writeFileSync(mod, lg('dayListBetween') + '\nexport { dayListBetween }\n')
const { dayListBetween } = await import(mod)
fs.unlinkSync(mod)
const { lensCc } = new Function(['lrTimeStats', 'lensCc'].map(la).join('\n') + '\nreturn { lensCc }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// Day list: inclusive, in order, across a month end and a DST change (AEDT starts first Sunday of October).
const d = dayListBetween('2026-08-30', '2026-09-02')
ok('inclusive span', d.length === 4 && d[0] === '2026-08-30' && d[3] === '2026-09-02', d)
ok('single day', dayListBetween('2026-09-04', '2026-09-04').length === 1)
ok('dst span keeps every day', dayListBetween('2026-10-02', '2026-10-06').length === 5, dayListBetween('2026-10-02', '2026-10-06'))
ok('reversed is empty', dayListBetween('2026-09-05', '2026-09-01').length === 0)
ok('missing is empty', dayListBetween(null, '2026-09-01').length === 0 && dayListBetween('2026-09-01', undefined).length === 0)
ok('garbage is empty', dayListBetween('nope', '2026-09-01').length === 0)
ok('over a year is empty', dayListBetween('2025-01-01', '2026-09-01').length === 0)
ok('a full year fits', dayListBetween('2025-09-05', '2026-09-04').length === 365)

// The lens carries the pipeline's own daily series against the shared day list.
const days = ['2026-09-01', '2026-09-02', '2026-09-03']
const cc = {
  daily: { days, leads: [5, 6, 7], won: [1, 0, 2], revenue: [1000, 0, 2000] },
  totals: { leads: 18, won: 3, lost: 0, open: 15 }, revenue: { total: 3000, count: 3, deals: [] }, open: { total: 15, value: 0, deals: [] },
  pipelinesFunnel: [{ id: 'p1', name: 'A', stages: [] }, { id: 'p2', name: 'B', stages: [] }],
  pipeContribution: [
    { id: 'p1', name: 'A', leads: 10, won: 2, lost: 0, open: 8, revenue: 2000, openValue: 0, daily: { leads: [3, 3, 4], won: [1, 0, 1], revenue: [1000, 0, 1000] }, chan: { meta: { leads: 10, won: 2, revenue: 2000 }, google: { leads: 0, won: 0, revenue: 0 }, other: { leads: 0, won: 0, revenue: 0 } } },
    { id: 'p2', name: 'B', leads: 8, won: 1, lost: 0, open: 7, revenue: 1000, openValue: 0, daily: { leads: [2, 3, 3], won: [0, 0, 1], revenue: [0, 0, 1000] }, chan: { meta: { leads: 8, won: 1, revenue: 1000 }, google: { leads: 0, won: 0, revenue: 0 }, other: { leads: 0, won: 0, revenue: 0 } } },
  ],
  closeByChannel: [], lostByReason: [], lostBy: { pipeline: [] }, lostFacts: null, oppFacts: null, oppsBySource: [], spend: { meta: 100, google: 0, total: 100 },
}
const l1 = lensCc(cc, 'p1'), l2 = lensCc(cc, 'p2'), lx = lensCc(cc, 'zzz')
ok('lens daily days shared', l1.daily && l1.daily.days === days)
ok('lens daily p1', JSON.stringify(l1.daily.leads) === '[3,3,4]' && JSON.stringify(l1.daily.won) === '[1,0,1]' && JSON.stringify(l1.daily.revenue) === '[1000,0,1000]', l1.daily)
ok('lens daily p2', JSON.stringify(l2.daily.won) === '[0,0,1]', l2.daily)
ok('pipelines sum to account', l1.daily.leads.map((v, i) => v + l2.daily.leads[i]).join() === cc.daily.leads.join())
ok('unknown pipe empty series', lx.daily && lx.daily.leads.length === 0 && lx.daily.days === days, lx.daily)
ok('all passthrough', lensCc(cc, 'all').daily === cc.daily)
ok('no daily stays null', lensCc({ ...cc, daily: null }, 'p1').daily === null)

console.log(`uiv2_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
