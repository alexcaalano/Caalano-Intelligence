// The provider registry (SAAS-DESIGN.md section 7). Every adapter has the
// same shape; the reporting code asks the registry, never a provider
// directly. PROVIDER_ADAPTERS=1 routes today's Windsor reads through here
// (windsor.mjs keeps its direct path when the flag is off), so the plumbing
// runs in production without changing a number.
export const PROVIDERS = ['meta', 'google_ads', 'ga4', 'ghl', 'windsor']
const REQUIRED = ['authUrl', 'exchange', 'listAccounts', 'fetch', 'refresh', 'revoke', 'health']
const registry = new Map()

export function registerAdapter(adapter) {
  if (!adapter || !PROVIDERS.includes(adapter.provider)) throw new Error(`unknown provider ${adapter && adapter.provider}`)
  for (const k of REQUIRED) if (typeof adapter[k] !== 'function') throw new Error(`${adapter.provider} adapter lacks ${k}()`)
  registry.set(adapter.provider, adapter)
  return adapter
}
export const getAdapter = (provider) => registry.get(provider) || null
export const adaptersOn = () => process.env.PROVIDER_ADAPTERS === '1'

// One read through an adapter, with the outcome reported to whoever keeps
// connection health (phase 1 writes last_ok_at / last_error on the row).
const listeners = new Set()
export const onProviderResult = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export async function providerFetch(provider, credential, args) {
  const a = getAdapter(provider)
  if (!a) throw new Error(`no adapter for ${provider}`)
  const t0 = Date.now()
  try {
    const rows = await a.fetch(credential, args)
    for (const fn of listeners) { try { fn({ provider, ok: true, ms: Date.now() - t0, externalId: args && args.externalId }) } catch { /* listener errors never break a read */ } }
    return rows
  } catch (e) {
    for (const fn of listeners) { try { fn({ provider, ok: false, ms: Date.now() - t0, externalId: args && args.externalId, error: String((e && e.message) || e).slice(0, 200) }) } catch { /* ignore */ } }
    throw e
  }
}
