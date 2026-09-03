const ROOT = new URL('../', import.meta.url).pathname
// The two reducers that make the KPI columns dynamic, lifted from App.jsx so
// the test runs the shipped arithmetic, driven as a person would drive them.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
const lift = (startRe, endRe) => { const a = src.search(startRe); const b = src.slice(a).search(endRe); return src.slice(a, a + b + endRe.source.length - 2) }
const setTargetSrc = lift(/const setTarget = \(key, side, raw\) => setK\(/, /\n  \}\)\n/)
// The budget path is a plain helper now: rederive(set, spend) -> set.
const rederiveSrc = lift(/const rederive = \(p, sp\) => \{/, /\n  \}\n/)
let k = {}
const saved = []
const env = { saveKpis: (cid, nx) => saved.push(nx), clientId: 'c', pid: '' }
const run = (fnSrc, extra) => new Function('setK', 'saveKpis', 'clientId', 'pid', 'spend', 'raw', 'key', 'side', fnSrc.replace(/^const \w+ = \([^)]*\) => /, 'return (') + ')')(
  (f) => { k = f(k) }, env.saveKpis, env.clientId, env.pid, Number(k.monthlySpend) > 0 ? Number(k.monthlySpend) : null, extra.raw, extra.key, extra.side)
const setTarget = (key, side, raw) => run(setTargetSrc, { key, side, raw })
const rederive = new Function('p', 'sp', rederiveSrc.replace(/^const rederive = \(p, sp\) => \{/, '') .replace(/\}\s*$/, ''))
const setSpend = (raw) => { const sp = raw === '' ? undefined : Number(raw); k = { ...rederive(k, sp), monthlySpend: sp }; saved.push(k) }

let n = 0, bad = 0
const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) } }

// No budget yet: a volume target stands alone, no cost can be derived.
setTarget('Booked', 'volume', '40')
eq('volume without budget', [k.stages.Booked, k.stageCost.Booked, k.stageBasis.Booked], [40, undefined, 'volume'])
// Budget arrives: the cost side fills in from the typed volume.
setSpend('6000')
eq('budget derives cost', [k.monthlySpend, k.stages.Booked, k.stageCost.Booked], [6000, 40, 150])
// Type a cost on another stage: volume derives.
setTarget('Won', 'cost', '600')
eq('cost derives volume', [k.stages.Won, k.stageCost.Won, k.stageBasis.Won], [10, 600, 'cost'])
// Raise the budget: volume-typed stage gets cheaper, cost-typed stage buys more.
setSpend('9000')
eq('bigger budget: volume-typed stays, its cost drops', [k.stages.Booked, k.stageCost.Booked], [40, 225])
eq('bigger budget: cost-typed stays, its volume rises', [k.stages.Won, k.stageCost.Won], [15, 600])
// Overwrite a derived side by typing into it: that side becomes the intent.
setTarget('Booked', 'cost', '300')
eq('retyping flips the basis', [k.stages.Booked, k.stageCost.Booked, k.stageBasis.Booked], [30, 300, 'cost'])
// Clear a target: both sides and the basis go.
setTarget('Won', 'volume', '')
eq('clearing removes all three', [k.stages.Won, k.stageCost.Won, k.stageBasis.Won], [undefined, undefined, undefined])
// Clear the budget: the derived side of what remains disappears, the typed side stays.
setSpend('')
eq('no budget: derived volume gone, typed cost kept', [k.monthlySpend, k.stages.Booked, k.stageCost.Booked], [undefined, undefined, 300])
// Zero is not a divisor.
setSpend('5000'); setTarget('Booked', 'volume', '0')
eq('zero volume derives nothing', [k.stages.Booked, k.stageCost.Booked], [0, undefined])
// Leads row uses its reserved key and behaves the same.
setTarget('*leads', 'volume', '200')
eq('leads row', [k.stages['*leads'], k.stageCost['*leads']], [200, 25])
// Every edit was persisted.
eq('every edit saved', saved.length, 10)
console.log(bad ? `${bad} failed` : `${n}/${n} passed`)
process.exit(bad ? 1 : 0)
