// Server-side persistence for dashboard settings (key events, KPI targets,
// campaign->pipeline links, enabled clients) so they survive cache clears, work
// on every device, and are shared across the team - replacing the old
// localStorage-only storage. One JSON blob, four sections; POST merges a partial
// update per section (last-write-wins per client), GET returns the whole blob.
import { getStore } from '@netlify/blobs'
import { currentUser } from '../lib/auth.mjs'

const store = () => getStore({ name: 'caalano-settings', consistency: 'strong' })
const KEY = 'all'
const SECTIONS = ['keyevents', 'kpis', 'campmap', 'enabled', 'restricted', 'insights', 'clients', 'formmeta', 'metaconv', 'health', 'creativemeta', 'creativetax', 'clientctx', 'fatigue', 'competitors', 'socialkpis', 'optlog', 'qualstage', 'aliases', 'logos', 'curator', 'profile', 'dailyperf', 'adnames']
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const data = (await store().get(KEY, { type: 'json' }).catch(() => null)) || {}
      // A viewer (client) only gets the settings for their OWN allocated clients,
      // and never the agency-only / sensitive sections (which clients are hidden,
      // AI context, insights, optlog, competitors, etc.) — so the shared blob can't
      // leak other clients' key events, KPI targets or configuration.
      const secret = process.env.AUTH_SECRET
      if (secret) {
        const me = await currentUser(req, secret).catch(() => null)
        if (me && me.role === 'viewer') {
          const allow = new Set(me.clients || [])
          const pick = (obj) => { const o = {}; for (const k in (obj || {})) { if (allow.has(String(k).split(':')[0])) o[k] = obj[k] } return o }
          const scoped = {}
          // Client-keyed sections the viewer UI reads, filtered to their clients.
          for (const s of ['keyevents', 'kpis', 'enabled', 'clients', 'formmeta', 'qualstage', 'aliases', 'logos', 'metaconv', 'adnames']) scoped[s] = pick(data[s])
          // campmap is campaign-name-keyed (needed for spend attribution) and fatigue
          // is global thresholds — neither is per-client-sensitive; pass as-is.
          scoped.campmap = data.campmap || {}
          scoped.fatigue = data.fatigue || {}
          return json({ ok: true, data: scoped })
        }
      }
      return json({ ok: true, data })
    }
    if (req.method === 'POST') {
      // When multi-user login is enabled, only admins may change shared settings,
      // and the `clients` section (adding / removing / relinking client accounts)
      // is Super-Admin-only. A null caller = Basic-Auth break-glass = full access.
      const secret = process.env.AUTH_SECRET
      const body = await req.json().catch(() => ({}))
      if (secret) {
        const me = await currentUser(req, secret).catch(() => null)
        if (me && me.role !== 'admin' && me.role !== 'superadmin') return json({ ok: false, error: 'Admins only.' }, 403)
        if (me && me.role !== 'superadmin' && body && body.clients) return json({ ok: false, error: 'Only a Super Admin can add, remove or relink client accounts.' }, 403)
      }
      const cur = (await store().get(KEY, { type: 'json' }).catch(() => null)) || {}
      const next = { ...cur }
      for (const s of SECTIONS) {
        if (body[s] && typeof body[s] === 'object') next[s] = { ...(cur[s] || {}), ...body[s] }
      }
      next.updatedAt = new Date().toISOString()
      await store().setJSON(KEY, next)
      return json({ ok: true, data: next })
    }
    return json({ ok: false, error: 'method not allowed' }, 405)
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500)
  }
}
