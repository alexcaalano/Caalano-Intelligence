const ROOT = new URL('../', import.meta.url).pathname
// Lost Reasons: the scorecards follow the filters, and a filter is a list.
// Lifted from App.jsx so the test runs the component's own functions.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const body = ['lrOppFacts', 'lrFacts', 'lrMatch', 'lrCohortStats', 'lrFoldDict', 'applyAliases'].map(lift).join('\n') + "\nconst unorm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')\nconst LR_FOLD_LEVEL = { campaign: 'campaign', adset: 'medium', creative: 'content', keyword: null }\nconst lrFoldVal = (fold, k, v) => (fold && fold[k] && fold[k][v]) || v"
const { lrOppFacts, lrFacts, lrMatch, lrCohortStats, lrFoldDict, applyAliases } = new Function(body + '\nreturn { lrOppFacts, lrFacts, lrMatch, lrCohortStats, lrFoldDict, applyAliases }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// --- decoding the payload rows, in the backend's layout -----------------------
// [status, ...one index per key, stagePos, decisionDays]
const keys = ['pipeline', 'stage', 'campaign', 'adset', 'creative', 'keyword', 'source', 'channel']
const dict = {
  pipeline: ['Allied Health', 'ADHD'], stage: ['New Lead', 'Called', 'Booked', 'Won'],
  campaign: ['CD_062', 'CD_063', 'Not tagged'], adset: ['Not tagged'], creative: ['vid_a', 'img_b'], keyword: ['Not tagged'],
  source: ['Paid Social', 'Google Ads', 'Referral'], channel: ['meta', 'google', 'other'],
}
// pipeline positions: Allied Health New=0 Called=1 Booked=2 Won=3; ADHD has Called at 0, Booked at 1
const stageOrder = { 'Allied Health': { 'New Lead': 0, Called: 1, Booked: 2, Won: 3 }, ADHD: { Called: 0, Booked: 1 } }
const posIn = (pipe, name) => { const o = stageOrder[pipe] || {}; return o[name] == null ? null : o[name] }
const rows = [
  //status pipe stage camp adset creat kw src chan pos days
  [1, 0, 3, 0, 0, 0, 0, 0, 0, 3, 4],       // won, Allied, CD_062, meta, 4 days
  [1, 0, 3, 1, 0, 1, 0, 0, 0, 3, 10],      // won, Allied, CD_063, meta, 10 days
  [2, 0, 1, 0, 0, 0, 0, 0, 0, 1, 2],       // lost at Called, CD_062, meta, 2 days
  [2, 0, 0, 1, 0, 1, 0, 1, 1, 0, 6],       // lost at New Lead, CD_063, google, 6 days
  [0, 0, 2, 0, 0, 0, 0, 0, 0, 2, null],    // open at Booked, CD_062, meta
  [0, 1, 1, 2, 0, 0, 0, 2, 2, 0, null],    // open ADHD at Called (pos 0), untagged, referral
  [2, 1, 2, 2, 0, 0, 0, 2, 2, 1, null],    // lost ADHD at Booked (pos 1), no usable dates
  [1, 1, 2, 2, 0, 1, 0, 2, 2, 1, 30],      // won ADHD at Booked, 30 days
]
const facts = lrOppFacts({ oppFacts: { keys, dict, rows, total: 8, capped: false } })
ok('one object per row', facts.length === 8)
ok('status decodes', facts.map((f) => f.status).join() === 'won,won,lost,lost,open,open,lost,won', facts.map((f) => f.status))
ok('dims decode through the dictionary', facts[0].pipeline === 'Allied Health' && facts[0].stage === 'Won' && facts[0].campaign === 'CD_062' && facts[3].channel === 'google' && facts[5].source === 'Referral', facts[0])
ok('stagePos and days sit after the dims', facts[0].stagePos === 3 && facts[0].days === 4 && facts[4].days === null && facts[7].days === 30, [facts[0].stagePos, facts[0].days, facts[4].days])
ok('unknown status index reads as open', lrOppFacts({ oppFacts: { keys, dict, rows: [[7, 0, 0, 0, 0, 0, 0, 0, 0, 0, null]] } })[0].status === 'open')
ok('missing payload is empty, not a throw', lrOppFacts(null).length === 0 && lrOppFacts({}).length === 0 && lrOppFacts({ oppFacts: {} }).length === 0)

// --- a filter is a list: any value matches -----------------------------------
const m = (r, d, v, sf) => lrMatch(r, d, v, sf || 'at', posIn)
ok('empty list matches everything', facts.every((r) => m(r, 'campaign', [])) && facts.every((r) => m(r, 'campaign', null)))
ok('single value', facts.filter((r) => m(r, 'campaign', ['CD_062'])).length === 3)
ok('two campaigns = union', facts.filter((r) => m(r, 'campaign', ['CD_062', 'CD_063'])).length === 5)
ok('a value nobody has matches nobody', facts.filter((r) => m(r, 'campaign', ['CD_999'])).length === 0)
ok('stage "at" is a name match', facts.filter((r) => m(r, 'stage', ['Booked'], 'at')).length === 3)
// beyond: at-or-after any chosen stage, judged in the row's own pipeline
const beyondBooked = facts.filter((r) => m(r, 'stage', ['Booked'], 'beyond'))
ok('stage "beyond" uses each pipeline\'s own positions', beyondBooked.length === 5, beyondBooked.map((r) => [r.pipeline, r.stage]))
ok('beyond with two stages = at-or-after the earlier of each', facts.filter((r) => m(r, 'stage', ['Booked', 'Called'], 'beyond')).length === 7)
ok('beyond a stage the pipeline lacks excludes that pipeline', facts.filter((r) => m(r, 'stage', ['New Lead'], 'beyond')).every((r) => r.pipeline === 'Allied Health'))

// --- the cohort behind the scorecards ----------------------------------------
const stats = (filters, lostFiltered = 0, sf = 'at') => lrCohortStats(facts, Object.entries(filters), (r, d, v) => lrMatch(r, d, v, sf, posIn), lostFiltered)
let s = stats({ campaign: ['CD_062'] })
ok('totals follow the campaign filter', s.totals.leads === 3 && s.totals.won === 1 && s.totals.lost === 1 && s.totals.open === 1, s.totals)
ok('time-to figures are over the cut rows only', s.timeToWon.median === 4 && s.timeToWon.n === 1 && s.timeToLost.median === 2, [s.timeToWon, s.timeToLost])
s = stats({ campaign: ['CD_062', 'CD_063'], channel: ['meta'] })
ok('filters combine with AND, values within one with OR', s.totals.leads === 4 && s.totals.won === 2 && s.totals.lost === 1 && s.totals.open === 1, s.totals)
ok('median of two wins is their midpoint', s.timeToWon.median === 7 && s.timeToWon.mean === 7, s.timeToWon)
// Reason is lost-only: it must not narrow open or won.
s = stats({ reason: ['Budget'], channel: ['meta'] }, 1)
ok('reason does not cut the cohort', s.totals.leads === 4 && s.totals.won === 2 && s.totals.open === 1 && s.reasonOn === true, s.totals)
ok('lost tile takes the reason-filtered count', s.totals.lost === 1)
s = stats({ channel: ['meta'] }, 99)
ok('without a reason filter the lost count is the cohort\'s own', s.totals.lost === 1 && s.reasonOn === false, s.totals)
// Skipped = decided but no usable days.
s = stats({ pipeline: ['ADHD'] })
ok('rows with no usable dates are counted as skipped', s.timeToLost.n === 0 && s.timeToLost.skipped === 1 && s.timeToLost.median === null && s.timeToWon.median === 30, [s.timeToLost, s.timeToWon])
// Quartiles only once there are eight decided rows.
const many = Array.from({ length: 12 }, (_, i) => ({ status: 'won', channel: 'meta', days: i + 1 }))
s = lrCohortStats(many, [['channel', ['meta']]], (r, d, v) => lrMatch(r, d, v, 'at', posIn), 0)
ok('quartiles appear at n>=8', s.timeToWon.p25 === 4 && s.timeToWon.p75 === 10 && s.timeToWon.median === 6.5, s.timeToWon)
ok('quartiles withheld under 8', stats({ campaign: ['CD_062', 'CD_063'] }).timeToWon.p25 === null)
// Empty cohort is all zeros and nulls, never NaN.
s = stats({ campaign: ['CD_999'] })
ok('empty cohort is clean', s.totals.leads === 0 && s.timeToWon.median === null && s.timeToWon.mean === null, s)


// --- spelling variants fold to one name -------------------------------------
const fdict = { ...dict, campaign: ['Cd_12_page_view_a_adhd', 'CD_12_Page_View_A_ADHD', 'CD 12 page view a adhd', 'CD_13_Other', 'Not tagged'], creative: ['vid_a', 'VID_A'] }
const frows = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null], [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, null], // 3 x lowercase
  [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 5],                                                                      // 1 x TitleCase
  [2, 0, 0, 2, 0, 1, 0, 0, 0, 0, 2],                                                                      // 1 x spaced
  [0, 0, 0, 3, 0, 0, 0, 0, 0, 0, null],                                                                   // CD_13
]
const fcc = { oppFacts: { keys, dict: fdict, rows: frows } }
let fold = lrFoldDict(fcc, { campaign: {}, medium: {}, content: {} })
ok('variants map to the most-common spelling', fold.campaign && fold.campaign['CD_12_Page_View_A_ADHD'] === 'Cd_12_page_view_a_adhd' && fold.campaign['CD 12 page view a adhd'] === 'Cd_12_page_view_a_adhd', fold.campaign)
ok('the chosen spelling is not mapped to itself, and lone names are untouched', fold.campaign && !('Cd_12_page_view_a_adhd' in fold.campaign) && !('CD_13_Other' in fold.campaign), fold.campaign)
ok('creative folds too', fold.creative && fold.creative['VID_A'] === 'vid_a', fold.creative)
ok('Not tagged never folds', !fold.campaign || !('Not tagged' in fold.campaign))
let fo = lrOppFacts(fcc, fold)
ok('decoded rows carry the folded name', new Set(fo.slice(0, 5).map((r) => r.campaign)).size === 1 && fo[5].campaign === 'CD_13_Other', fo.map((r) => r.campaign))
fold = lrFoldDict(fcc, { campaign: { 'cd_12_page_view_a_adhd': 'CD_12 Page View (2026)' }, medium: {}, content: {} })
ok('a manual alias wins over the count, matched case-insensitively', fold.campaign && ['Cd_12_page_view_a_adhd', 'CD_12_Page_View_A_ADHD', 'CD 12 page view a adhd'].every((v) => fold.campaign[v] === 'CD_12 Page View (2026)'), fold.campaign)
ok('no facts -> empty fold, not a throw', Object.keys(lrFoldDict(null, {})).length === 0 && Object.keys(lrFoldDict({}, {})).length === 0)
// Lost rows fold with the same dictionary.
const lcc = { lostFacts: { keys: ['reason', 'campaign'], dict: { reason: ['Budget'], campaign: ['cd_12_x', 'CD_12_X'] }, rows: [[0, 0, 0, null, 'A', 1], [0, 1, 0, null, 'B', 1], [0, 1, 0, null, 'C', 1]] } }
const lfold = lrFoldDict(lcc, {})
ok('lost-only payload folds by lost rows', lfold.campaign && lfold.campaign['cd_12_x'] === 'CD_12_X', lfold)
ok('lrFacts applies it', lrFacts(lcc, lfold).every((r) => r.campaign === 'CD_12_X'))
// Outcome lists fold even with no aliases at all.
const merged = applyAliases([{ name: 'CD_12_X', leads: 10, won: 1 }, { name: 'cd_12_x', leads: 3, won: 0 }, { name: 'CD_13', leads: 2, won: 0 }], {})
ok('applyAliases folds spelling variants with an empty map', merged.length === 2 && merged[0].name === 'CD_12_X' && merged[0].leads === 13 && merged[0].won === 1, merged)
ok('applyAliases with no map at all', applyAliases([{ name: 'a b', leads: 1 }, { name: 'A_B', leads: 1 }]).length === 1)

console.log(`${n - bad}/${n} lost-reason cohort checks passed`)
if (bad) process.exit(1)
