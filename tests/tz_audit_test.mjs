// One clock everywhere: server day labels, client presets and the demo
// generator all sit on the business timezone, never UTC or the viewer's own.
// Runs with a far-away process TZ so any accidental use of local time shows.
process.env.TZ = 'Pacific/Honolulu'
import fs from 'node:fs'
import { zonedDateStr, tzOffsetMs } from '../netlify/lib/ghl.mjs'
import { demoData, demoWindsor } from '../netlify/lib/demo.mjs'
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const SYD = 'Australia/Sydney'
const sydDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit' })
const sydHour = (ms) => +new Intl.DateTimeFormat('en-US', { timeZone: SYD, hour: 'numeric', hour12: false }).format(new Date(ms)).replace(/^24$/, '0')
const sydDow = (ms) => new Date(ms + tzOffsetMs(SYD, ms)).getUTCDay()

// Server helper: an evening-UTC instant is already tomorrow in Sydney.
ok(zonedDateStr(Date.UTC(2026, 8, 8, 22, 30), SYD) === '2026-09-09', 'AEST: 22:30Z on the 8th is the 9th in Sydney')
ok(zonedDateStr(Date.UTC(2026, 0, 8, 14, 30), SYD) === '2026-01-09', 'AEDT: 14:30Z on the 8th is the 9th in Sydney')
ok(zonedDateStr(Date.UTC(2026, 8, 8, 12, 0), SYD) === '2026-09-08', 'midday UTC stays on the same Sydney day')
ok(zonedDateStr(NaN, SYD) === null, 'unparseable instant labels as null')

// Client: presets anchor on Sydney's today, whatever the viewer's clock says.
const src = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const lift = (name) => {
  const a = src.indexOf(`function ${name}(`); if (a < 0) throw new Error('missing ' + name)
  let i = src.indexOf('{', src.indexOf(')', a)), depth = 0
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break } }
  return src.slice(a, i + 1)
}
const line = (re) => { const m = src.match(re); if (!m) throw new Error('missing ' + re); return m[0] }
const presetRange = new Function([
  line(/^const APP_TZ = .*$/m), line(/^const tzDateStr = .*$/m), line(/^const tzTodayStr = .*$/m), line(/^const iso = .*$/m),
  "const PRESETS = [{ id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'last_month', label: 'Last month' }]",
  lift('presetRange'), 'return presetRange',
].join('\n'))()
const today = sydDate(Date.now())
ok(presetRange('today').from === today && presetRange('today').to === today, `today preset is Sydney's today (${presetRange('today').from} vs ${today})`)
const y = presetRange('yesterday')
ok(y.from === y.to && Date.parse(today + 'T00:00:00Z') - Date.parse(y.from + 'T00:00:00Z') === 86400000, 'yesterday is exactly one day before Sydney today')
const lm = presetRange('last_month')
const [ty, tm] = today.split('-').map(Number)
const expFrom = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, '0')}-01`
ok(lm.from === expFrom && /-(28|29|30|31)$/.test(lm.to), `last month runs from ${expFrom} (${lm.from} → ${lm.to})`)
ok(/const now = .*tzTodayStr\(\)/.test(lift('presetRange')), 'presetRange reads the business date, not new Date() locally')
ok(/timeZone: APP_TZ/.test(lift('fmtDMY')), 'fmtDMY shows datetimes on the business day')

// Demo generator: everything happens in the practice's own clock.
const d = demoData()
const created = d.opportunities.map((o) => Date.parse(o.createdAt))
ok(created.every((ms) => sydHour(ms) >= 8 && sydHour(ms) <= 19), 'enquiries land 8am-7pm Sydney')
ok(created.every((ms) => sydDow(ms) !== 0), 'no enquiries on a Sydney Sunday')
const starts = d.events.map((e) => Date.parse(e.startTime))
ok(starts.every((ms) => sydHour(ms) >= 8 && sydHour(ms) <= 16), 'appointments sit in clinic hours, Sydney time')
ok(starts.every((ms) => sydDow(ms) !== 0), 'no appointments on a Sydney Sunday')
// Ad-platform rows are keyed on the account's local day: every spend day is a
// day some lead actually arrived on, Sydney time.
const leadDays = new Set(created.map(sydDate))
const meta = demoWindsor('facebook', ['date', 'spend'])
ok(meta.length > 0 && meta.every((r) => leadDays.has(r.date)), 'Meta spend days line up with Sydney lead days')
// Contact visit dates carry the Sydney date of the visit.
const visitDates = d.contacts.map((c) => c._clinic && c._clinic.first_visit_date).filter(Boolean)
ok(visitDates.length > 0 && visitDates.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)), 'contacts carry a first-visit date as a plain local date')

console.log(f ? `${f}/${n} FAILED` : `${n} assertions passed`)
process.exit(f ? 1 : 0)
