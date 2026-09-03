// The warmer. A Netlify BACKGROUND function - the `-background` suffix is what
// gives it a 15-minute ceiling instead of ~26s, and makes the platform answer
// the caller with a 202 at once while this keeps running.
//
// Two jobs, chosen by the POST body:
//   { plan: 'full' }        walk the roster and rebuild every default view for
//                           every client, stalest client first. Fired by the
//                           scheduled `meta-warm` every ten minutes.
//   { plan: 'opps' }        refresh each CRM client's opportunity snapshot, the
//                           shared page every CRM scope reads from. Fired by
//                           the scheduled `opp-warm` every five minutes.
//   { urls: [ '?...' ] }    rebuild these exact requests. Fired by the request
//                           handler when it has just served a stale copy.
//
// A build goes through the real request handler with the warm token, so it is
// the same code path, the same cache key and the same write-through as when a
// person opens the view. Nothing here knows how a payload is built.
import handler from './windsor.mjs'
import { runOppWarm, warmRoster } from './windsor.mjs'
import { isWarmRequest, readWarmState, writeWarmState, readWarmLock, writeWarmLock, writeWarmLast, planForClient, planForAgency, currentRanges, warmToken, WARM_LOCK_MS, WARM_DEADLINE_MS } from '../lib/warm.mjs'

// One request through the handler, as the warmer. `_r=warm` forces a rebuild
// past the fresh window (cacheKeyFrom strips it, so the key is unchanged).
async function rebuild(qs) {
  const t0 = Date.now()
  const url = `https://warm.internal/.netlify/functions/windsor?${qs}&_r=warm`
  try {
    const r = await handler(new Request(url, { headers: { 'x-warm-token': warmToken() } }))
    const j = await r.json().catch(() => null)
    return { qs, ms: Date.now() - t0, ok: r.ok && !(j && j.error), error: j && j.error ? String(j.error).slice(0, 120) : (r.ok ? null : `HTTP ${r.status}`) }
  } catch (e) {
    return { qs, ms: Date.now() - t0, ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

async function runFull(started) {
  const ranges = currentRanges()
  const state = await readWarmState()
  const roster = await warmRoster()
  // Stalest first, so a run that is cut short still moves the roster along
  // rather than re-warming the same leaders every time.
  const order = Object.entries(roster).sort(([a], [b]) => ((state.clients[a] || 0) - (state.clients[b] || 0)) || a.localeCompare(b))
  const results = []
  let cut = false
  for (const [id, cc] of order) {
    if (Date.now() - started > WARM_DEADLINE_MS) { cut = true; break }
    const urls = planForClient(id, cc, ranges)
    if (!urls.length) continue
    const built = []
    for (const qs of urls) {
      if (Date.now() - started > WARM_DEADLINE_MS) { cut = true; break }
      built.push(await rebuild(qs))
    }
    state.clients[id] = Date.now()
    await writeWarmState(state)   // after every client, so a kill mid-run loses nothing
    results.push({ client: id, warmed: built.filter((b) => b.ok).length, ms: built.reduce((s, b) => s + b.ms, 0), errors: built.filter((b) => !b.ok).map((b) => `${b.qs.slice(0, 40)}: ${b.error}`) })
    if (cut) break
  }
  if (!cut) for (const qs of planForAgency(ranges)) results.push({ client: '(agency)', ...(await rebuild(qs)) })
  return { plan: 'full', cut, clients: results.length, warmed: results.reduce((s, r) => s + (r.warmed || (r.ok ? 1 : 0)), 0), results }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!isWarmRequest(req)) return new Response('Forbidden', { status: 403 })
  let body = {}
  try { body = await req.json() } catch { /* empty body = nothing to do */ }
  const started = Date.now()

  // Ad-hoc revalidations run regardless of the roster lock: they are one or two
  // builds, and waiting on a full pass would defeat the point.
  if (Array.isArray(body.urls) && body.urls.length) {
    const results = []
    for (const qs of body.urls.slice(0, 8)) results.push(await rebuild(String(qs).replace(/^\?/, '')))
    return Response.json({ plan: 'urls', results })
  }

  // Roster passes take the lock, so two schedules cannot both walk the roster at
  // once. A lock older than the ceiling belongs to a run that is already dead.
  const lock = await readWarmLock()
  if (lock && Date.now() - lock.at < WARM_LOCK_MS) return Response.json({ skipped: true, reason: `a run started ${Math.round((Date.now() - lock.at) / 1000)}s ago is still going` })
  await writeWarmLock({ at: started, plan: body.plan || 'full' })
  let out
  try {
    out = body.plan === 'opps' ? await runOppWarm() : await runFull(started)
  } catch (e) {
    out = { ok: false, error: String((e && e.message) || e).slice(0, 300) }
  } finally {
    await writeWarmLock(null)
  }
  const summary = { ...out, plan: body.plan || 'full', startedAt: new Date(started).toISOString(), ms: Date.now() - started }
  await writeWarmLast(summary)
  return Response.json(summary)
}
