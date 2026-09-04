// The warming plan and the machinery that runs it.
//
// The warmers used to build payloads in-process inside SCHEDULED functions. A
// scheduled function has the same ~26s ceiling as any other, so a run that
// walked every client sequentially - three builds of ~8s each, per client - was
// killed after the second or third client, every ten minutes, forever. The
// clients that happened to sort first were always warm; everyone after them
// never was. Nexia sat fourth and was 36% of every slow build in the log.
//
// Now the scheduled functions only TRIGGER. The work runs in `warm-background`,
// a Netlify background function with a 15-minute ceiling, and it warms clients
// in order of who has waited longest, recording each as it goes - so a run that
// is cut off still leaves the next one starting where it should.
//
// It warms by replaying the exact URLs the browser requests through the real
// request handler, rather than hand-building cache keys. A warmed key that
// differs from the requested one by a single parameter is a warmer that does
// nothing, and there is no way to notice except by reading the reliability log.
import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'

// --- the shared secret ------------------------------------------------------
// The background function is reachable over HTTP, so it needs to know a call
// came from us. Derived from a secret the site already has rather than adding
// one to set up: same input on both sides, same token.
export function warmToken() {
  const seed = process.env.WARM_SECRET || process.env.AUTH_SECRET || process.env.WINDSOR_API_KEY
  if (!seed) return null
  return createHash('sha256').update('caalano-warm:' + seed).digest('hex')
}
export function isWarmRequest(req) {
  const t = warmToken()
  if (!t) return false
  const got = req.headers.get('x-warm-token') || ''
  // Constant-time compare, so the token cannot be recovered by timing.
  if (got.length !== t.length) return false
  let diff = 0
  for (let i = 0; i < t.length; i++) diff |= got.charCodeAt(i) ^ t.charCodeAt(i)
  return diff === 0
}

// --- where things are recorded ---------------------------------------------
const store = () => getStore({ name: 'caalano-warm', consistency: 'strong' })
export const WARM_LOCK_MS = 14 * 60 * 1000     // a run older than this is presumed dead
export const WARM_DEADLINE_MS = 13 * 60 * 1000 // stop starting new builds after this
export const REVAL_DEDUPE_MS = 90 * 1000       // one revalidation per key per this long

export async function readWarmState() {
  try { return (await store().get('state', { type: 'json' })) || { clients: {} } } catch { return { clients: {} } }
}
export async function writeWarmState(s) { try { await store().setJSON('state', s) } catch { /* non-fatal */ } }
export async function readWarmLock() { try { return await store().get('lock', { type: 'json' }) } catch { return null } }
export async function writeWarmLock(v) { try { if (v) await store().setJSON('lock', v); else await store().delete('lock') } catch { /* non-fatal */ } }
export async function readWarmLast() { try { return await store().get('last', { type: 'json' }) } catch { return null } }
export async function writeWarmLast(v) { try { await store().setJSON('last', v) } catch { /* non-fatal */ } }

// Revalidation dedupe: many people opening the same stale view within a minute
// must not each start a rebuild. One small blob per key, checked only on the
// stale path (never on a fresh hit).
export async function claimRevalidate(ck) {
  const k = 'reval:' + ck
  try {
    const hit = await store().get(k, { type: 'json' })
    if (hit && Date.now() - hit.at < REVAL_DEDUPE_MS) return false
    await store().setJSON(k, { at: Date.now() })
    return true
  } catch { return true }   // if the store is unreachable, revalidating is still right
}

// --- rolling ranges, computed the way the browser computes them -------------
// presetRange in the app anchors at local noon and ends YESTERDAY for the
// rolling presets. Staff browsers are in Sydney, so the same calendar date is
// produced here from Australia/Sydney, at noon UTC, with UTC date arithmetic -
// which sidesteps DST. A warmed key that is one day off is a warmed key nobody
// ever reads.
export function sydneyToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t) => +parts.find((p) => p.type === t).value
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day'), 12, 0, 0))
}
const iso = (d) => d.toISOString().slice(0, 10)
export function rollingRange(days, today = sydneyToday()) {
  const shift = (n) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - n); return iso(x) }
  return { from: shift(days), to: shift(1) }
}
// The equal-length window immediately before - what the app's prevRangeOf gives.
export function prevRangeOf(r) {
  const a = Date.parse(r.from), b = Date.parse(r.to)
  const days = Math.round((b - a) / 86400000) + 1
  const pb = new Date(a - 86400000)
  const pa = new Date(pb.getTime() - (days - 1) * 86400000)
  return { from: iso(pa), to: iso(pb) }
}

// --- the plan ---------------------------------------------------------------
// What to keep warm, per client, as the exact query strings the browser sends.
// Every entry here is a view someone opens by default, with its default
// parameters: last 30 days ending yesterday, all channels, won-basis "closed"
// (the app's default unless a person has switched it and the browser remembered).
//
//   Caalano360 (the default tab)    health + ccdrill + users - the three reads
//                                   that fire the moment a client opens, and the
//                                   three slowest scopes in the log.
//   Meta / Google / Caalano360 deep  the channel tabs, as before.
//   Home                             the whole-roster agency read, once, not per
//                                   client.
//
// Per-client Home rows (ovrow) are NOT here: their key carries each client's
// calendar and stage configuration, which lives in browser-side settings the
// server cannot see. They stay on the stale-while-revalidate path.
export function planForClient(id, cc, ranges) {
  const q = (params) => new URLSearchParams(params).toString()
  const urls = []
  const r30 = ranges.r30, r7 = ranges.r7
  if (cc.ghl) {
    urls.push(q({ client: id, scope: 'health', from: r30.from, to: r30.to, wonBasis: 'closed' }))
    urls.push(q({ scope: 'ccdrill', client: id, channel: 'all', from: r30.from, to: r30.to, wonBasis: 'closed' }))
    urls.push(q({ scope: 'users', client: id, channel: 'all', from: r30.from, to: r30.to }))
    urls.push(q({ client: id, channel: 'blend', from: r30.from, to: r30.to }))
  }
  if (cc.meta) for (const r of [r30, r7]) urls.push(q({ client: id, channel: 'meta', from: r.from, to: r.to }))
  if (cc.google) urls.push(q({ client: id, channel: 'google', from: r30.from, to: r30.to }))
  return urls
}
export function planForAgency(ranges) {
  const r30 = ranges.r30
  return [new URLSearchParams({ scope: 'agency', from: r30.from, to: r30.to, wonBasis: 'closed' }).toString()]
}
export function currentRanges() {
  const today = sydneyToday()
  return { r30: rollingRange(30, today), r7: rollingRange(7, today) }
}

// --- triggering -------------------------------------------------------------
// Calls the background function and returns as soon as Netlify has accepted the
// job (a 202, typically well under a second). Awaited on purpose: a fetch that
// is not awaited may never leave a Lambda that is about to be frozen.
export async function triggerWarm(body) {
  const base = process.env.URL
  const t = warmToken()
  if (!base || !t) return { triggered: false, reason: !base ? 'no site URL (local dev?)' : 'no secret to derive a token from' }
  try {
    const r = await fetch(`${base}/.netlify/functions/warm-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-warm-token': t },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    })
    return { triggered: r.status === 202 || r.ok, status: r.status }
  } catch (e) {
    return { triggered: false, reason: String((e && e.message) || e).slice(0, 120) }
  }
}
