const ROOT = new URL('../', import.meta.url).pathname
// Campaign → pipeline links and the ad-set level rules beside them: an ad set
// with its own rule goes there, "all" shares it, the rest follow the campaign.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const saved = []
const pre = "const SETTINGS = { campmap: {} }\nconst suggestPipeline = (n, pipes) => (n.includes('ADHD') ? 'p-adhd' : '')\nconst writeLS = () => {}\nconst saveSettingsRemote = (x) => saved.push(x)\nconst bumpSettings = () => {}\nconst CMAP_KEY = 'k'\n"
const body = ['loadCampMap', 'saveCampMap', 'pipeOfCampaign', 'loadAdsetRules', 'saveAdsetRules', 'campIsSplit', 'pipeOfAdset'].map(lift).join('\n').replace(/export (const|function) /g, '$1 ')
const M = new Function('saved', pre + body + '\nreturn { SETTINGS, loadCampMap, saveCampMap, pipeOfCampaign, loadAdsetRules, saveAdsetRules, campIsSplit, pipeOfAdset }')(saved)
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }
const pipes = [{ id: 'p-adhd', name: 'ADHD' }, { id: 'p-allied', name: 'Allied Health' }]
M.saveCampMap('c1', { 'Services | Leads': 'all', 'SIL | Leads': 'p-allied' })
ok('campaign link wins', M.pipeOfCampaign('c1', 'SIL | Leads', pipes) === 'p-allied')
ok('all shares (null)', M.pipeOfCampaign('c1', 'Services | Leads', pipes) === null)
ok('auto by name', M.pipeOfCampaign('c1', 'ADHD Broad', pipes) === 'p-adhd')
ok('not split yet', M.campIsSplit('c1', 'Services | Leads') === false && M.pipeOfAdset('c1', 'Services | Leads', 'Any set', pipes) === null)
M.saveAdsetRules('c1', 'Services | Leads', { 'Allied set': 'p-allied', 'ADHD set': 'p-adhd', 'Shared set': 'all' })
ok('split', M.campIsSplit('c1', 'Services | Leads') === true)
ok('ad set rule wins', M.pipeOfAdset('c1', 'Services | Leads', 'Allied set', pipes) === 'p-allied' && M.pipeOfAdset('c1', 'Services | Leads', 'ADHD set', pipes) === 'p-adhd')
ok('all → shared', M.pipeOfAdset('c1', 'Services | Leads', 'Shared set', pipes) === null)
ok('no rule → campaign', M.pipeOfAdset('c1', 'Services | Leads', 'Other set', pipes) === null && M.pipeOfAdset('c1', 'SIL | Leads', 'Other set', pipes) === 'p-allied')
ok('rules kept beside links', M.loadCampMap('c1')['SIL | Leads'] === 'p-allied' && Object.keys(M.loadAdsetRules('c1', 'Services | Leads')).length === 3)
ok('saved per client', saved.at(-1).campmap.c1.__adsets['Services | Leads']['ADHD set'] === 'p-adhd')
M.saveAdsetRules('c1', 'Services | Leads', {})
ok('cleared', M.campIsSplit('c1', 'Services | Leads') === false && M.loadCampMap('c1').__adsets === undefined)
ok('other clients untouched', M.pipeOfAdset('c2', 'X', 'Y', pipes) === null)
if (bad) { console.log(`campmap_test: ${bad} of ${n} failed`); process.exit(1) }
console.log(`campmap_test ok (${n})`)
