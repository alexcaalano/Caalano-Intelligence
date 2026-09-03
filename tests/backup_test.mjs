// @needs-fake-blobs
import { collectBackup, BACKUP_STORES, SECRET_STORES } from '../netlify/lib/backup.mjs'
let n = 0, bad = 0
const ok = (name, c, x) => { n++; if (!c) { bad++; console.log('FAIL', name, JSON.stringify(x).slice(0, 120)) } }
const b = await collectBackup()
ok('every listed store is present', BACKUP_STORES.every((s) => b.stores[s.name]), Object.keys(b.stores))
ok('settings round-trip as JSON', b.stores['caalano-settings'].data.all.kpis.nexia.monthlySpend === 6000)
ok('users are included', b.stores['caalano-auth'].data['user:alex'].role === 'superadmin')
ok('history is included', b.stores['caalano-health'].data['nexia:2026-08'].score === 71)
ok('non-JSON values are kept as text, not dropped', b.stores['meta-webhooks'].data['acct:1']._text === 'not json at all')
ok('the reliability log is capped and says so', b.stores['caalano-diag'].keys === 4000 && b.stores['caalano-diag'].truncated === true, [b.stores['caalano-diag'].keys, b.stores['caalano-diag'].truncated])
ok('pagination walks past the first page (audit + diag both read)', b.stores['caalano-audit'].keys === 1)
ok('secrets are NOT included by default', !b.stores['ghl-auth'] && b.includesSecrets === false)
ok('caches are listed as not backed up', b.notBackedUp.includes('caalano-cache') && b.notBackedUp.includes('caalano-oppcache'))
const s = await collectBackup({ includeSecrets: true })
ok('secrets included only when asked', s.stores['ghl-auth'] && s.stores['ghl-auth'].data.tokens.access_token === 'SECRET' && s.includesSecrets === true)
ok('format + date stamped', b.format === 'caalano360-backup/2' && /^\d{4}-\d{2}-\d{2}T/.test(b.at))
console.log(bad ? `${bad} failed` : `${n}/${n} passed`)
process.exit(bad ? 1 : 0)
