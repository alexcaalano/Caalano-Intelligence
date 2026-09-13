// Caalano Systems (CRM) webhook receiver. The marketplace app posts an event
// the moment something changes in a connected sub-account: a deal marked won
// or lost, a new lead, a stage move, an appointment booked or resulted, an
// inbound message. Each is normalised and kept in a short per-location buffer
// (netlify/lib/live.mjs) that the Sales Hub polls, so the gong rings within
// seconds instead of minutes.
//
// Guarded twice: the URL must carry the site's live token (?t=...), and when
// GHL_WEBHOOK_PUBLIC_KEY is set (the CRM's published webhook public key, PEM)
// every delivery's x-wh-signature must verify. Unknown or malformed events are
// answered 200 and dropped, so the CRM never retries junk.
import { isLiveToken, verifyLiveSignature, normLiveEvent, appendLiveEvent } from '../lib/live.mjs'

export default async (req) => {
  const url = new URL(req.url)
  if (!isLiveToken(url.searchParams.get('t'))) return new Response('Not found', { status: 404 })
  if (req.method === 'GET') return new Response('Caalano360 CRM webhook: ready', { status: 200, headers: { 'content-type': 'text/plain' } })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  const sig = verifyLiveSignature(raw, req.headers.get('x-wh-signature'), process.env.GHL_WEBHOOK_PUBLIC_KEY)
  if (!sig.ok) return new Response('Bad signature', { status: 401 })
  let body = null
  try { body = JSON.parse(raw) } catch { return new Response('ok', { status: 200 }) }
  const ev = normLiveEvent(body)
  if (!ev) return new Response('ok', { status: 200 })
  try { await appendLiveEvent(ev) } catch (e) { console.error('ghl-webhook store', String((e && e.message) || e).slice(0, 200)) }
  return new Response('ok', { status: 200 })
}
