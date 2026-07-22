// Server-side persistence for dashboard settings (key events, KPI targets,
// campaign->pipeline links, enabled clients) so they survive cache clears, work
// on every device, and are shared across the team - replacing the old
// localStorage-only storage. One JSON blob, four sections; POST merges a partial
// update per section (last-write-wins per client), GET returns the whole blob.
import { getStore } from '@netlify/blobs'
import { currentUser } from '../lib/auth.mjs'

const store = () => getStore({ name: 'caalano-settings', consistency: 'strong' })
const KEY = 'all'
const SECTIONS = ['keyevents', 'kpis', 'campmap', 'enabled', 'insights', 'clients', 'formmeta', 'metaconv']
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const data = await store().get(KEY, { type: 'json' }).catch(() => null)
      return json({ ok: true, data: data || {} })
    }
    if (req.method === 'POST') {
      // When multi-user login is enabled, only admins may change shared settings.
      // A null caller = Basic-Auth break-glass path, which keeps full access.
      const secret = process.env.AUTH_SECRET
      if (secret) {
        const me = await currentUser(req, secret).catch(() => null)
        if (me && me.role !== 'admin') return json({ ok: false, error: 'Admins only.' }, 403)
      }
      const body = await req.json().catch(() => ({}))
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
