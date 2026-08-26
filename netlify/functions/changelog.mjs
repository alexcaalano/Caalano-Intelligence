// The release history, for the Super-Admin Logs panel.
//
// This used to be `import('../CHANGELOG.md?raw')` in the app, which bundled the
// whole file into a 343KB JS chunk under /assets/ - and /assets/* is served
// without a session so the login screen can load its own code. That put the
// full development history, naming nine clients and describing how every metric
// is calculated, on a URL anyone could fetch.
//
// It is read here instead, behind a superadmin check, and never reaches the
// browser bundle. netlify.toml lists CHANGELOG.md under `included_files` so it
// ships with the function.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentUser } from '../lib/auth.mjs'

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

// Netlify has moved where included files land more than once, so try the known
// spots rather than pinning one and breaking on a platform change. Resolved per
// call, not at module load - the working directory at import time is not
// guaranteed to be the one at invocation time.
async function readChangelog() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(process.cwd(), 'CHANGELOG.md'),
    path.join(here, 'CHANGELOG.md'),
    path.join(here, '..', '..', 'CHANGELOG.md'),
    path.join(here, '..', '..', '..', 'CHANGELOG.md'),
    path.join(process.cwd(), '..', 'CHANGELOG.md'),
  ]
  for (const p of candidates) {
    try {
      const txt = await readFile(p, 'utf8')
      if (txt && txt.trim()) return { text: txt, from: p }
    } catch { /* try the next */ }
  }
  return null
}

export default async (req) => {
  try {
    const secret = process.env.AUTH_SECRET
    // Legacy single-password mode: the only person past the edge gate is the owner.
    if (secret) {
      const me = await currentUser(req, secret).catch(() => null)
      if (!me) return json({ error: 'Not signed in.' }, 401)
      if (me.role !== 'superadmin') return json({ error: 'Super Admins only.' }, 403)
    }
    const found = await readChangelog()
    if (!found) return json({ error: 'The changelog isn’t available on this deploy.' }, 404)
    return new Response(found.text, {
      status: 200,
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (e) {
    return json({ error: String((e && e.message) || e).slice(0, 200) }, 500)
  }
}
