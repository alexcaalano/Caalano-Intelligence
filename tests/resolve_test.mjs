const ROOT = new URL('../', import.meta.url).pathname
// Exercise resolveLostAttribution on a payload shaped exactly like buildCcDrill's,
// with the collapse cases that matter: an id and its name both present, two ad
// ids sharing one ad group, an unresolvable id, and a name that merely looks
// numeric-adjacent.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'netlify/functions/windsor.mjs', 'utf8')
const start = src.indexOf('const LOST_ID_DIMS =')
const end = src.indexOf('// Rewrite each Forms person')
const mod = src.slice(start, end) + '\nexport { resolveLostAttribution, LOST_ID_DIMS }\n'
fs.writeFileSync('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_rla.mjs', mod)
const { resolveLostAttribution } = await import('/tmp/claude-0/-home-user-Dashboard/279073be-812c-5059-944a-7feaa35710ad/scratchpad/_rla.mjs')

const maps = {
  campaign: { '22314183244': 'ADHD Assessments - Search', '23302211694': 'Allied Health - Broad' },
  medium: { '120213683170520253': 'ADHD | Melbourne | 25-45', '987654321012': 'ADHD | Melbourne | 25-45' },
  content: { '120215551110000001': 'Vid_Arcads_Speech_F13' },
}
const keys = ['reason', 'pipeline', 'stage', 'campaign', 'adset', 'creative', 'keyword', 'source', 'channel']
const dict = {
  reason: ['Budget', 'Gone cold'], pipeline: ['ADHD'], stage: ['Called #1'],
  // 0: id that resolves to a name that ALSO appears raw at 1 -> must merge
  campaign: ['22314183244', 'ADHD Assessments - Search', '99999999999', 'Not tagged'],
  // two different ids that resolve to the SAME ad set -> must merge
  adset: ['120213683170520253', '987654321012', 'cpc'],
  creative: ['120215551110000001', 'Not tagged'],
  keyword: ['Not tagged'], source: ['Paid Social'], channel: ['meta'],
}
const rows = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 'c1', 'A'],
  [1, 0, 0, 1, 1, 1, 0, 0, 0, 200, 'c2', 'B'],
  [0, 0, 0, 2, 2, 0, 0, 0, 0, 300, 'c3', 'C'],
  [1, 0, 0, 3, 0, 1, 0, 0, 0, 400, 'c4', 'D'],
]
const drill = {
  lostFacts: { keys, dict, rows: rows.map((r) => r.slice()), total: 4, capped: false },
  lostBy: {
    campaign: [
      { key: '22314183244', count: 2, value: 100, reasons: [{ reason: 'Budget', count: 2, value: 100 }] },
      { key: 'ADHD Assessments - Search', count: 1, value: 200, reasons: [{ reason: 'Budget', count: 1, value: 200 }, { reason: 'Gone cold', count: 0, value: 0 }] },
      { key: 'Not tagged', count: 1, value: 400, reasons: [{ reason: 'Gone cold', count: 1, value: 400 }] },
    ],
  },
}
const before = drill.lostFacts.rows.map((r) => r.slice())
resolveLostAttribution(drill, maps)

let fails = 0
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m) } else console.log('ok  ', m) }
const D = drill.lostFacts.dict, R = drill.lostFacts.rows
const col = (k) => keys.indexOf(k)
const val = (r, k) => D[k][r[col(k)]]

ok(D.campaign.length === 3, `campaign dict merged the id into its name (${JSON.stringify(D.campaign)})`)
ok(R.every((r, i) => val(r, 'campaign') === ['ADHD Assessments - Search', 'ADHD Assessments - Search', '99999999999', 'Not tagged'][i]), 'every row points at the right campaign after re-indexing')
ok(D.adset.length === 2 && D.adset[0] === 'ADHD | Melbourne | 25-45', `two ad ids collapsed to one ad set (${JSON.stringify(D.adset)})`)
ok(val(R[1], 'adset') === 'ADHD | Melbourne | 25-45' && val(R[0], 'adset') === 'ADHD | Melbourne | 25-45', 'both ad-set ids resolve to the same label')
ok(val(R[2], 'adset') === 'cpc', 'a non-numeric medium is left alone')
ok(val(R[0], 'creative') === 'Vid_Arcads_Speech_F13', 'creative id resolved via the content map')
ok(R.every((r, i) => r[9] === before[i][9] && r[10] === before[i][10] && r[11] === before[i][11]), 'value / contact / name columns are untouched by re-indexing')
ok(R.every((r, i) => val(r, 'reason') === ['Budget', 'Gone cold', 'Budget', 'Gone cold'][i]), 'untouched dimensions still decode correctly')

const lb = drill.lostBy.campaign
const merged = lb.find((x) => x.key === 'ADHD Assessments - Search')
ok(lb.length === 2, `lostBy merged the id row into its named row (${lb.map((x) => x.key).join(' | ')})`)
ok(merged && merged.count === 3 && merged.value === 300, `merged rollup sums count and value (${merged && merged.count}/${merged && merged.value})`)
ok(merged && merged.reasons.find((r) => r.reason === 'Budget').count === 3, 'merged rollup sums each reason across the merged rows')
ok(lb.reduce((a, x) => a + x.count, 0) === 4, 'lostBy still totals every lost deal')
// Idempotence: running twice must not shuffle anything.
const snap = JSON.stringify(drill)
resolveLostAttribution(drill, maps)
ok(JSON.stringify(drill) === snap, 'resolving twice is a no-op')
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
