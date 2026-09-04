const ROOT = new URL('../', import.meta.url).pathname
// Cash collected: the field lookup, the per-opportunity value read, and how the
// pipeline lens carries the cash figures.
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
const mod = path.join(os.tmpdir(), `cash_test_${process.pid}.mjs`)
fs.writeFileSync(mod, [lg('cashFieldOf'), lg('oppCashValue')].join('\n') + '\nexport { cashFieldOf, oppCashValue }\n')
const { cashFieldOf, oppCashValue } = await import(mod)
fs.unlinkSync(mod)
const { lensCc } = new Function(['lrTimeStats', 'lensCc'].map(la).join('\n') + '\nreturn { lensCc }')()
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x)) } }

// Field lookup - by name, by key, case-insensitive, and none.
const fields = [
  { id: 'f1', key: 'opportunity.deposit', name: 'Deposit', dataType: 'MONETORY' },
  { id: 'ZJZ', key: 'opportunity.cash_collected', name: 'Cash Collected', dataType: 'MONETORY' },
]
const f = cashFieldOf(fields)
ok('field by name', f && f.id === 'ZJZ' && f.key === 'opportunity.cash_collected' && f.name === 'Cash Collected', f)
ok('field by key only', (cashFieldOf([{ id: 'k', key: 'opportunity.cashcollected', name: 'Money in' }]) || {}).id === 'k')
ok('field lower case name', (cashFieldOf([{ id: 'x', name: 'cash collected to date' }]) || {}).id === 'x')
ok('no field', cashFieldOf(fields.slice(0, 1)) === null)
ok('no field on empty', cashFieldOf([]) === null && cashFieldOf(null) === null)

// Value read - number, string, formatted string, empty, missing, other field.
ok('number', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueNumber: 1500, type: 'MONETORY' }] }, f) === 1500)
ok('string', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueString: '1500', type: 'MONETORY' }] }, f) === 1500)
ok('formatted', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValue: '$1,500.50' }] }, f) === 1500.5)
ok('by key', oppCashValue({ customFields: [{ key: 'opportunity.cash_collected', value: 200 }] }, f) === 200)
ok('empty is unknown', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueString: '' }] }, f) === null)
ok('zero is zero', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueNumber: 0 }] }, f) === 0)
ok('other field only', oppCashValue({ customFields: [{ id: 'f1', fieldValueNumber: 300 }] }, f) === null)
ok('no custom fields', oppCashValue({}, f) === null)
ok('no field def', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueNumber: 5 }] }, null) === null)
ok('garbage', oppCashValue({ customFields: [{ id: 'ZJZ', fieldValueString: 'tbc' }] }, f) === null)

// Paid in full rule: cash at or above the deal value, on a deal with a value.
const pif = (cash, val) => cash != null && val > 0 && cash >= val
ok('pif equal', pif(1000, 1000) === true)
ok('pif over', pif(1200, 1000) === true)
ok('pif under', pif(999, 1000) === false)
ok('pif no value', pif(500, 0) === false)
ok('pif unknown', pif(null, 1000) === false)

// The lens carries cash per pipeline and per channel.
const cc = {
  spend: { meta: 1000, google: 500, total: 1500 },
  totals: { leads: 7, won: 3, lost: 3, open: 1 },
  revenue: { total: 5000, count: 3, deals: [{ name: 'a', value: 1000, pipeline: 'Allied Health', cash: 1000, paidInFull: true }, { name: 'b', value: 4000, pipeline: 'ADHD', cash: 1500, paidInFull: false }] },
  cash: { field: f, collected: 2500, entered: 2, paidInFull: 1, won: 3, outstanding: 2500 },
  open: { total: 1, value: 100, deals: [] },
  pipelinesFunnel: [{ id: 'p1', name: 'Allied Health', stages: [] }, { id: 'p2', name: 'ADHD', stages: [] }],
  pipeContribution: [
    { id: 'p1', name: 'Allied Health', leads: 4, won: 1, lost: 2, open: 1, revenue: 1000, openValue: 100, cash: 1000, cashEntered: 1, paidInFull: 1, chan: { meta: { leads: 3, won: 1, revenue: 1000, cash: 1000 }, google: { leads: 1, won: 0, revenue: 0, cash: 0 }, other: { leads: 0, won: 0, revenue: 0, cash: 0 } } },
    { id: 'p2', name: 'ADHD', leads: 3, won: 2, lost: 1, open: 0, revenue: 4000, openValue: 0, cash: 1500, cashEntered: 1, paidInFull: 0, chan: { meta: { leads: 1, won: 2, revenue: 4000, cash: 1500 }, google: { leads: 1, won: 0, revenue: 0, cash: 0 }, other: { leads: 1, won: 0, revenue: 0, cash: 0 } } },
  ],
  closeByChannel: [{ channel: 'meta', won: 3, closed: 5, leads: 4, revenue: 5000, cash: 2500, closeRate: 60 }],
  lostByReason: [], lostBy: { pipeline: [] }, lostFacts: null, oppFacts: null, oppsBySource: [],
}
const l1 = lensCc(cc, 'p1'), l2 = lensCc(cc, 'p2'), lx = lensCc(cc, 'nope')
ok('lens p1 cash', l1.cash && l1.cash.collected === 1000 && l1.cash.paidInFull === 1 && l1.cash.entered === 1 && l1.cash.won === 1 && l1.cash.outstanding === 0, l1.cash)
ok('lens p2 cash', l2.cash && l2.cash.collected === 1500 && l2.cash.paidInFull === 0 && l2.cash.won === 2 && l2.cash.outstanding === 2500, l2.cash)
ok('lens keeps field', l1.cash.field && l1.cash.field.id === 'ZJZ')
ok('lens chan cash', (l2.closeByChannel.find((c) => c.channel === 'meta') || {}).cash === 1500, l2.closeByChannel)
ok('lens unknown pipe', lx.cash && lx.cash.collected === 0 && lx.cash.won === 0, lx.cash)
ok('lens all passthrough', lensCc(cc, 'all').cash === cc.cash)
ok('lens no field stays null', lensCc({ ...cc, cash: null }, 'p1').cash === null)
ok('deal cash in drill list', l2.revenue.deals.length === 1 && l2.revenue.deals[0].cash === 1500 && l2.revenue.deals[0].paidInFull === false)

console.log(`cash_test: ${n - bad}/${n} passed`)
if (bad) process.exit(1)
