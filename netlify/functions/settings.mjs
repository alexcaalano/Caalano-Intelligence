// Server-side persistence for dashboard settings (key events, KPI targets,
// campaign->pipeline links, enabled clients) so they survive cache clears, work
// on every device, and are shared across the team - replacing the old
// localStorage-only storage. One JSON blob, four sections; POST merges a partial
// update per section (last-write-wins per client), GET returns the whole blob.
import { getStore } from '@netlify/blobs'
import { currentUser } from '../lib/auth.mjs'
import { CLIENT_PROFILE_SEEDS } from '../lib/profiles.mjs'

const store = () => getStore({ name: 'caalano-settings', consistency: 'strong' })
const KEY = 'all'
const SECTIONS = ['keyevents', 'kpis', 'campmap', 'enabled', 'restricted', 'insights', 'clients', 'formmeta', 'metaconv', 'health', 'creativemeta', 'creativetax', 'clientctx', 'fatigue', 'competitors', 'socialkpis', 'optlog', 'qualstage', 'aliases', 'logos', 'curator', 'profile', 'dailyperf', 'adnames', 'pdfdl', 'clinic', 'geo', 'forecasts', 'ui']
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const data = (await store().get(KEY, { type: 'json' }).catch(() => null)) || {}
      // A viewer (client) only gets the settings for their OWN allocated clients,
      // and never the agency-only / sensitive sections (which clients are hidden,
      // AI context, insights, optlog, competitors, etc.) - so the shared blob can't
      // leak other clients' key events, KPI targets or configuration.
      const secret = process.env.AUTH_SECRET
      if (secret) {
        const me = await currentUser(req, secret).catch(() => null)
        // No session, but the login system is on: the only way to be here is the
        // shared-password edge gate, which has no identity attached. It used to
        // fall through and return the whole unscoped blob.
        if (!me) return json({ ok: false, error: 'Not signed in.' }, 401)
        if (me.role === 'viewer') {
          const allow = new Set(me.clients || [])
          const pick = (obj) => { const o = {}; for (const k in (obj || {})) { if (allow.has(String(k).split(':')[0])) o[k] = obj[k] } return o }
          const scoped = {}
          // Client-keyed sections the viewer UI reads, filtered to their clients.
          for (const s of ['keyevents', 'kpis', 'enabled', 'clients', 'formmeta', 'qualstage', 'aliases', 'logos', 'metaconv', 'adnames', 'clinic', 'campmap', 'geo']) scoped[s] = pick(data[s])
          // campmap used to be passed through whole, on the belief that it was
          // campaign-name-keyed and so not per-client. It is actually keyed by
          // client id (SETTINGS.campmap[clientId]), and campaign names carry the
          // brand - so it went out as a list of every client's campaigns. It is
          // filtered like everything else now.
          // fatigue is genuinely global (shared thresholds, no client in it).
          scoped.fatigue = data.fatigue || {}
          return json({ ok: true, data: scoped })
        }
      }
      // Seed brand profiles are merged in here rather than shipped in the app
      // bundle - they name clients and carry our own notes on them, and the
      // bundle is served without a session. A saved profile beats its seed.
      // Viewers never receive the `profile` section at all (see above).
      const profile = { ...(data.profile || {}) }
      for (const id in CLIENT_PROFILE_SEEDS) profile[id] = { ...CLIENT_PROFILE_SEEDS[id], ...(profile[id] || {}) }
      return json({ ok: true, data: { ...data, profile } })
    }
    if (req.method === 'POST') {
      // When multi-user login is enabled, only admins may change shared settings,
      // and the `clients` section (adding / removing / relinking client accounts)
      // is Super-Admin-only. A null caller = Basic-Auth break-glass = full access.
      const secret = process.env.AUTH_SECRET
      const body = await req.json().catch(() => ({}))
      if (secret) {
        const me = await currentUser(req, secret).catch(() => null)
        // Same hole on the write path, and worse: `me && ...` meant an anonymous
        // caller passed BOTH checks and could rewrite shared settings, including
        // the Super-Admin-only `clients` section.
        if (!me) return json({ ok: false, error: 'Not signed in.' }, 401)
        if (me.role !== 'admin' && me.role !== 'superadmin') return json({ ok: false, error: 'Admins only.' }, 403)
        if (me.role !== 'superadmin' && body && body.clients) return json({ ok: false, error: 'Only a Super Admin can add, remove or relink client accounts.' }, 403)
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
