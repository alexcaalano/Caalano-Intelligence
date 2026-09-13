// The Windsor adapter: the credential is the organisation's Windsor API key
// and fetch() is today's windsorFetch, handed in by windsor.mjs at start-up
// (that function lives with the result cache, the warm flags and the demo
// dataset, so it stays where it is). externalId is '<connector>:<account>'
// (facebook:123, google_ads:123-456-7890, ga4:properties/1) or just an
// account id when args.connector says the table.
let fetcher = null
export const setWindsorFetcher = (fn) => { fetcher = fn }
const split = (externalId) => { const s = String(externalId || ''); const i = s.indexOf(':'); return i > 0 ? { connector: s.slice(0, i), account: s.slice(i + 1) } : { connector: null, account: s || null } }

export default {
  provider: 'windsor',
  authUrl() { throw new Error('Windsor uses an API key, not OAuth: enter the key on the Connections card') },
  exchange() { throw new Error('Windsor uses an API key, not OAuth') },
  // Windsor does not list the accounts behind a key in a shape the app uses;
  // accounts are typed on the workspace, as today.
  async listAccounts() { return [] },
  async fetch(credential, { connector = null, externalId = null, fields = [], from = null, to = null, preset = null, opts = {} } = {}) {
    if (!fetcher) throw new Error('windsor adapter: no fetcher registered')
    const key = credential && (credential.apiKey || credential.key)
    if (!key) throw new Error('windsor adapter: credential has no apiKey')
    const ext = split(externalId)
    const table = connector || ext.connector
    if (!table) throw new Error('windsor adapter: connector is required')
    const accounts = opts.accounts != null ? opts.accounts : ext.account
    return fetcher(table, fields, from, to, preset, key, { ...opts, ...(accounts != null ? { accounts } : {}) })
  },
  async refresh() { return null },
  async revoke() { /* nothing to revoke at Windsor; the key row is deleted locally */ },
  async health(credential, externalId) {
    const ext = split(externalId)
    if (!(credential && (credential.apiKey || credential.key))) return { ok: false, detail: 'no API key' }
    if (!ext.connector || !fetcher) return { ok: true, detail: 'API key present' }
    try { await fetcher(ext.connector, ['account_id'], null, null, 'last_7d', credential.apiKey || credential.key, { accounts: ext.account }); return { ok: true, detail: 'read ok' } } catch (e) { return { ok: false, detail: String((e && e.message) || e).slice(0, 160) } }
  },
}
