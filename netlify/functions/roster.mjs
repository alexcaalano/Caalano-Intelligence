// The client roster and the baked snapshot, scoped to whoever is asking.
//
// These used to be static files under public/data/, which meant they were
// published to the site and served whole to anyone holding a valid session. A
// client viewer's own browser downloaded the entire agency roster - every other
// client's name, ad-account ids, spend, impressions, clicks and leads, plus
// Caalano Digital's own pipeline. The UI filtered it; the file did not.
//
// They now live outside public/ (so nothing is published) and are served from
// here, filtered server-side. Same rules the windsor function already applies:
// a viewer sees only their allocated clients, restricted staff see only theirs,
// and Super-Admin-only clients are dropped for everyone below superadmin.
import { getStore } from '@netlify/blobs'
import { currentUser, canSeeClient } from '../lib/auth.mjs'
import CONFIG from '../../data/config.json'
import SNAPSHOT from '../../data/snapshot.json'
// Baked per-client fallbacks, used when a live pull fails. Imported explicitly
// rather than read from disk so the bundler inlines them - add a line here when
// a new client's snapshot is baked.
import NEXIA_HEALTH from '../../data/clients/nexia-health.json'

const BAKED = { 'nexia-health': NEXIA_HEALTH }

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

// Clients flagged Super-Admin-only in Settings, hidden from everyone else.
async function restrictedIds(me) {
  if (!me || me.role === 'superadmin') return new Set()
  try {
    const s = await getStore({ name: 'caalano-settings', consistency: 'strong' }).get('all', { type: 'json' })
    const out = new Set()
    if (s && s.restricted) for (const id in s.restricted) if (s.restricted[id]) out.add(id)
    return out
  } catch { return new Set() } // fail closed on the per-client check below, not here
}

export default async (req) => {
  try {
    const url = new URL(req.url)
    const secret = process.env.AUTH_SECRET
    // No login system configured = legacy single-password mode, where the only
    // person past the edge gate is the owner. Serve everything, as before.
    const me = secret ? await currentUser(req, secret).catch(() => null) : null
    if (secret && !me) return json({ error: 'Not signed in.' }, 401)

    const restricted = await restrictedIds(me)
    const allowed = (id) => {
      if (restricted.has(id)) return false
      if (!me) return true
      return canSeeClient(me, id)
    }

    // A single baked client file, for the snapshot fallback on a client tab.
    const one = url.searchParams.get('client')
    if (one) {
      if (!allowed(one)) return json({ error: 'You don’t have access to this account.' }, 403)
      const doc = BAKED[one]
      return doc ? json(doc) : json({ error: 'No baked snapshot for this account.' }, 404)
    }

    const isViewer = !!(me && me.role === 'viewer')
    const config = {
      ...CONFIG,
      clients: (CONFIG.clients || []).filter((c) => allowed(c.id)),
      // The agency's Windsor account inventory. Staff tooling only - a client has
      // no use for it and it counts accounts they can't see.
      availableAccounts: isViewer ? undefined : CONFIG.availableAccounts,
    }
    const snapshot = {
      ...SNAPSHOT,
      clients: (SNAPSHOT.clients || []).filter((c) => allowed(c.id)),
      rows: (SNAPSHOT.rows || []).filter((r) => !r || !r.id || allowed(r.id)),
      // Caalano Digital's OWN pipeline - our revenue, not the client's.
      ghl: isViewer ? undefined : SNAPSHOT.ghl,
    }
    return json({ ok: true, config, snapshot })
  } catch (e) {
    return json({ error: String((e && e.message) || e).slice(0, 200) }, 500)
  }
}
