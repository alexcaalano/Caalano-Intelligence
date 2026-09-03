const ROOT = new URL('../', import.meta.url).pathname
// The forecaster's arithmetic, lifted from App.jsx.
import fs from 'fs'
const src = fs.readFileSync(ROOT + 'src/App.jsx', 'utf8')
// Lift a top-level function by name, matching braces rather than guessing at
// its end with a regex.
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  // The body brace, not the `{}` of a default parameter: start after the param list closes.
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const body = ['fcForecast', 'fcStepsToRates', 'fcRatesToSteps', 'fcModelFromScenario', 'fcModelFromClient', 'fcScenarioFromModel'].map(lift).join('\n') + '\nconst FC_MIN_CHANNEL_LEADS = 15, FC_MIN_CPL_LEADS = 10'
const { fcForecast, fcStepsToRates, fcRatesToSteps, fcModelFromScenario, fcModelFromClient, fcScenarioFromModel } = new Function(body + '\nreturn { fcForecast, fcStepsToRates, fcRatesToSteps, fcModelFromScenario, fcModelFromClient, fcScenarioFromModel }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

// A clean model: Meta $40/lead, Google $80/lead, 50% then 50% of that, 10% of leads win, $1000 deals.
const model = {
  stages: [{ key: 'a', name: 'Booked' }, { key: 'b', name: 'Showed' }],
  channels: { meta: { cpl: 40, rates: [0.5, 0.25], winRate: 0.1 }, google: { cpl: 80, rates: [0.5, 0.25], winRate: 0.1 } },
  other: { leadsPerMonth: 20, rates: [0.5, 0.25], winRate: 0.1 }, baseSpend: { meta: 4000, google: 2000 }, avgDeal: 1000,
}
let f = fcForecast(model, { meta: 4000, google: 2000 })
ok('leads per channel = spend / cpl', near(f.leads.meta, 100) && near(f.leads.google, 25) && f.leads.other === 20, f.leads)
ok('stage reach = leads x cumulative rate', near(f.stages[0].total, 72.5) && near(f.stages[1].total, 36.25), f.stages.map((s) => s.total))
ok('step is share of the row above', near(f.stages[0].step, 0.5) && near(f.stages[1].step, 0.5), f.stages.map((s) => s.step))
ok('cost each = total spend / reached', near(f.stages[0].costEach, 6000 / 72.5), f.stages[0].costEach)
ok('won = leads x win rate, per channel', near(f.won.total, 14.5), f.won)
ok('revenue = won x avg deal', near(f.revenue, 14500), f.revenue)
ok('CAC = spend / PAID wins only', near(f.cac, 6000 / 12.5), f.cac)
ok('paid CPL blends the channels', near(f.paidCpl, 6000 / 125), f.paidCpl)
// Linear by default: double spend, double paid leads, non-paid untouched.
const f2 = fcForecast(model, { meta: 8000, google: 4000 })
ok('linear scaling', near(f2.leads.meta, 200) && near(f2.leads.google, 50) && f2.leads.other === 20, f2.leads)
// Diminishing returns: +50% spend at 20% rise -> CPL x1.2 on the increase.
const f3 = fcForecast(model, { meta: 6000, google: 2000 }, { cplRise: 0.2 })
ok('cpl rises above baseline', near(f3.cpl.meta, 48) && near(f3.cpl.google, 80), f3.cpl)
ok('below baseline cpl does not fall', near(fcForecast(model, { meta: 2000, google: 2000 }, { cplRise: 0.2 }).cpl.meta, 40))
// Excluding the baseline.
ok('non-paid can be excluded', fcForecast(model, { meta: 4000, google: 2000 }, { includeOther: false }).leads.other === 0)
// Channel with no CPL produces nothing, and does not throw.
ok('no cpl -> no leads', fcForecast({ ...model, channels: { ...model.channels, google: { cpl: null, rates: [0, 0], winRate: 0 } } }, { meta: 4000, google: 5000 }).leads.google === 0)
ok('zero spend -> zero everything paid', fcForecast(model, { meta: 0, google: 0 }).leads.meta === 0 && fcForecast(model, { meta: 0, google: 0 }).cac === null)
// Steps <-> cumulative rates round-trip.
const steps = [60, 70, 80]
const rates = fcStepsToRates(steps)
ok('steps compound', near(rates[0], .6) && near(rates[1], .42) && near(rates[2], .336), rates)
ok('round trip', JSON.stringify(fcRatesToSteps(rates)) === JSON.stringify(steps), fcRatesToSteps(rates))
ok('steps clamp to 0..100', fcStepsToRates([150, -5])[0] === 1 && fcStepsToRates([150, -5])[1] === 0)
// A scenario builds a model the same forecaster reads.
const sc = { name: 'S', metaSpend: 3000, googleSpend: 0, metaCpl: 30, googleCpl: '', otherLeads: 0, stages: [{ name: 'Call', step: 50 }, { name: 'Won', step: 40 }], avgDeal: 500 }
const sm = fcModelFromScenario(sc)
const sf = fcForecast(sm, { meta: 3000, google: 0 })
ok('scenario: 100 leads, 50 calls, 20 won (last stage), $10k', near(sf.leads.meta, 100) && near(sf.stages[0].total, 50) && near(sf.stages[1].total, 20) && near(sf.won.total, 20) && near(sf.revenue, 10000), [sf.leads.meta, sf.stages[0].total, sf.stages[1].total, sf.won.total, sf.revenue])
ok('scenario win rate is the last stage reach', near(sm.channels.meta.winRate, 0.2) && sm.wonIsLastStage === true)
// Economics. 60% margin, 2 purchases per customer.
const em = fcModelFromScenario({ ...sc, grossMargin: 60, purchases: 2 })
const ef = fcForecast(em, { meta: 3000, google: 0 })
ok('gross profit = revenue x margin', near(ef.econ.grossProfit, 6000), ef.econ)
ok('ltv = deal x purchases', near(ef.econ.ltv, 1000))
ok('cac = spend / paid wins', near(ef.cac, 150))
ok('ltv:cac', near(ef.econ.ltvCac, 1000 / 150))
ok('ltv-gp:cac', near(ef.econ.ltvGpCac, 600 / 150))
ok('net of spend = revenue - spend', near(ef.econ.netOfSpend, 7000))
ok('contribution = gross profit - spend', near(ef.econ.contribution, 3000))
ok('per customer contribution = deal x margin - cac', near(ef.econ.perCustomer.contribution, 300 - 150))
ok('typed LTV overrides deal x purchases', near(fcForecast(fcModelFromScenario({ ...sc, purchases: 2, ltv: 5000 }), { meta: 3000, google: 0 }).econ.ltv, 5000))
ok('no margin -> margin metrics are null, revenue ones still there', (() => { const z = fcForecast(fcModelFromScenario(sc), { meta: 3000, google: 0 }).econ; return z.grossProfit === null && z.contribution === null && z.ltvGpCac === null && near(z.netOfSpend, 7000) && near(z.ltvCac, 500 / 150) })())
// A client model opened as a scenario gains a Won stage that closes on the win.
const seeded = fcScenarioFromModel({ ...model, sample: { leads: { meta: 100, google: 0, other: 0 }, won: { meta: 10, google: 0, other: 0 } } }, { meta: 4000, google: 2000 })
ok('seeded scenario ends in Won', seeded.stages[seeded.stages.length - 1].name === 'Won', seeded.stages)
const seededF = fcForecast(fcModelFromScenario(seeded), { meta: 4000, google: 2000 })
ok('seeded scenario reproduces the 10% win', near(seededF.won.total / seededF.leads.total, 0.1, 0.002), seededF.won.total / seededF.leads.total)
ok('scenario google without cpl is off', sm.channels.google.cpl === null)
// Multi-pipeline client: the pipeline's starting spend is its lead share of the account's.
const mk = (id, m, g, o) => ({ id, chan: { meta: { leads: m, won: 0 }, google: { leads: g, won: 0 }, other: { leads: o, won: 0 } }, revenue: 0 })
const d90 = { pipelinesFunnel: [{ id: 'A', name: 'A', stages: [{ id: 's1', name: 'Booked', pos: 1, count: 30, meta: 20, google: 5, other: 5 }] }, { id: 'B', name: 'B', stages: [] }],
  pipeContribution: [mk('A', 40, 10, 10), mk('B', 20, 5, 5)], spend: { meta: 9000, google: 3000 }, paid: { metaLeads: 60, googleLeads: 15 } }
const d30 = { pipelinesFunnel: [], pipeContribution: [mk('A', 15, 5, 5), mk('B', 5, 5, 5)], spend: { meta: 3000, google: 1000 }, paid: { metaLeads: 20, googleLeads: 10 } }
const cm = fcModelFromClient(d90, d30, 'A', null)
ok('pipeline share of 30d leads = 25/40', near(cm.spendShare, 0.625), cm.spendShare)
ok('base spend is the account spend x share', near(cm.baseSpend.meta, 1875) && near(cm.baseSpend.google, 625), cm.baseSpend)
ok('cpl stays account-level', near(cm.channels.meta.cpl, 150) && near(cm.channels.google.cpl, 100), [cm.channels.meta.cpl, cm.channels.google.cpl])
ok('single-pipeline client keeps all the spend', near(fcModelFromClient({ ...d90, pipelinesFunnel: [d90.pipelinesFunnel[0]], pipeContribution: [d90.pipeContribution[0]] }, { ...d30, pipeContribution: [d30.pipeContribution[0]] }, 'A', null).baseSpend.meta, 3000))
console.log(bad ? `${bad} failed` : `${n}/${n} passed`)
process.exit(bad ? 1 : 0)
