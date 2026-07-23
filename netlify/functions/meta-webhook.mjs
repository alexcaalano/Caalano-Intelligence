// Meta Ads webhook receiver — the endpoint Meta pushes ad-account events to
// (creative_fatigue, and optionally ad_recommendations / with_issues_ad_objects).
//
// GET  = Meta's subscription verification handshake: echo hub.challenge when the
//        verify token matches META_VERIFY_TOKEN.
// POST = an event batch. We verify the X-Hub-Signature-256 HMAC against
//        META_APP_SECRET, then store each ad's latest verdict in Netlify Blobs
//        keyed by ad account, so the dashboard can read Meta's own signal beside
//        our proxy. Meta only sends a level (+ ids), so we keep it raw and let
//        the dashboard join names/thumbnails from Windsor at read time.
//
// Env (set in Netlify → Site settings → Environment variables):
//   META_VERIFY_TOKEN  — any string you choose; paste the same value into Meta.
//   META_APP_SECRET    — the Meta App's secret (used to verify each POST).
import { getStore } from '@netlify/blobs'
import crypto from 'node:crypto'

const store = () => getStore({ name: 'meta-webhooks', consistency: 'strong' })
// Ad-account ids are numeric; normalise both sides (webhook may send "act_123").
const acctKey = (id) => 'acct:' + String(id ?? '').replace(/\D/g, '')
const EVENT_CAP = 300 // keep the most recent N events per account

// Timing-safe compare of Meta's signature header against our own HMAC.
function verifySignature(rawBody, header, secret) {
  if (!secret) return { ok: false, reason: 'no-secret' }
  if (!header || !header.startsWith('sha256=')) return { ok: false, reason: 'no-header' }
  const theirs = header.slice('sha256='.length)
  const ours = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(ours, 'hex'), b = Buffer.from(theirs, 'hex')
  if (a.length !== b.length) return { ok: false, reason: 'len' }
  return { ok: crypto.timingSafeEqual(a, b), reason: 'compared' }
}

// Pull the best-effort ad id + fatigue level out of a change value, whatever the
// exact shape Meta sends (kept forward-compatible; the raw value is stored too).
function parseChange(field, value, entryId) {
  const v = value && typeof value === 'object' ? value : {}
  const adId = v.ad_id || v.adgroup_id || v.id || null
  const level = v.fatigue_level || v.level || v.creative_fatigue || v.status || v.value || null
  return { field, adId: adId ? String(adId) : null, level: level ? String(level) : null, entryId: entryId ? String(entryId) : null, raw: v }
}

export default async (req) => {
  const url = new URL(req.url)

  // --- Verification handshake ---
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const expected = process.env.META_VERIFY_TOKEN
    if (mode === 'subscribe' && expected && token === expected) {
      return new Response(challenge || '', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // --- Event delivery ---
  const raw = await req.text()
  const secret = process.env.META_APP_SECRET
  const sig = req.headers.get('x-hub-signature-256')
  const check = verifySignature(raw, sig, secret)
  // If a secret is configured we require a valid signature. If none is set yet
  // (initial setup), accept but flag it, so nothing is silently trusted later.
  if (secret && !check.ok) return new Response('Bad signature', { status: 401 })

  let body = null
  try { body = JSON.parse(raw) } catch { return new Response('Bad JSON', { status: 400 }) }

  const now = new Date().toISOString()
  // Group parsed changes by ad account so each account's blob is written once.
  const byAcct = new Map()
  for (const entry of (body && body.entry) || []) {
    const acct = entry.id
    for (const ch of (entry.changes || [])) {
      const p = parseChange(ch.field, ch.value, acct)
      const k = acctKey(acct)
      const arr = byAcct.get(k) || []
      arr.push({ ...p, ts: entry.time ? new Date(entry.time * 1000).toISOString() : now })
      byAcct.set(k, arr)
    }
  }

  try {
    for (const [key, changes] of byAcct) {
      const cur = (await store().get(key, { type: 'json' }).catch(() => null)) || { ads: {}, events: [], verified: check.ok }
      for (const c of changes) {
        if (c.adId && c.level) cur.ads[c.adId] = { level: c.level, field: c.field, ts: c.ts }
        cur.events.unshift(c)
      }
      cur.events = cur.events.slice(0, EVENT_CAP)
      cur.verified = check.ok
      cur.updatedAt = now
      await store().setJSON(key, cur)
    }
  } catch (e) {
    // Never make Meta retry-storm us over a storage hiccup; log and 200.
    console.error('meta-webhook store error', e && e.message)
  }
  // Meta expects a fast 200 or it retries and eventually disables the callback.
  return new Response('EVENT_RECEIVED', { status: 200 })
}
