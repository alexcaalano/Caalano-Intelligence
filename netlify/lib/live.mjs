// Live CRM events: the marketplace app's webhooks land in ghl-webhook.mjs and
// are kept here as a short per-location ring buffer in Netlify Blobs, so the
// Sales Hub can ring the gong within seconds of a deal being marked won instead
// of waiting for the five-minute snapshot. Nothing here feeds a KPI: the
// numbers still come from the snapshot read, so a webhook can never double
// count; it only drives the celebration and the "latest wins" feed.
import { createHash, createVerify, timingSafeEqual } from 'node:crypto'
import { getStore } from '@netlify/blobs'

export const LIVE_CAP = 300                 // events kept per location
export const LIVE_KEEP_MS = 48 * 3600000    // and for how long
export const liveStore = () => getStore({ name: 'caalano-live', consistency: 'strong' })
export const liveKey = (locationId) => `live:${locationId}`

// The URL token the CRM must present: derived from the site's secret, so the
// webhook URL is unguessable without being a raw secret in a settings screen.
export function liveToken() {
  const seed = process.env.LIVE_SECRET || process.env.AUTH_SECRET || process.env.WARM_SECRET
  if (!seed) return null
  return createHash('sha256').update('caalano-live:' + seed).digest('hex').slice(0, 40)
}
export function isLiveToken(t) {
  const want = liveToken(); if (!want || !t) return false
  const a = Buffer.from(String(t)), b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}
// The CRM signs each delivery (RSA-SHA256 over the raw body, base64 in
// x-wh-signature) with a public key published in its developer docs. When that
// key is set in the environment every delivery must verify.
export function verifyLiveSignature(raw, header, pem) {
  if (!pem) return { ok: true, checked: false }
  if (!header) return { ok: false, checked: true }
  try { const v = createVerify('RSA-SHA256'); v.update(raw, 'utf8'); v.end(); return { ok: v.verify(pem, Buffer.from(String(header), 'base64')), checked: true } } catch { return { ok: false, checked: true } }
}

const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
// One normalised event from whatever the CRM posted, or null for types the
// dashboard does not use. `id` is what dedupes retries and flip-flops.
export function normLiveEvent(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null
  const type = String(body.type || body.event || '')
  const locationId = body.locationId || body.location_id || (body.appointment && body.appointment.locationId) || null
  if (!locationId) return null
  const at = ms(body.timestamp) || now
  if (/^Opportunity(StatusUpdate|Create|StageUpdate|Update|Delete|AssignedToUpdate|MonetaryValueUpdate)$/.test(type)) {
    const oppId = body.id || body.opportunityId || (body.opportunity && body.opportunity.id) || null
    if (!oppId) return null
    const status = String(body.status || '').toLowerCase()
    // A deal created already marked won (a walk-in recorded after the fact) is
    // a win as well as a lead; its id matches the status-change form so a later
    // OpportunityStatusUpdate for the same deal dedupes rather than ringing twice.
    const kind = type === 'OpportunityStatusUpdate' ? (status === 'won' ? 'won' : status === 'lost' || status === 'abandoned' ? 'lost' : 'status') : type === 'OpportunityCreate' ? (status === 'won' ? 'won' : 'lead') : type === 'OpportunityStageUpdate' ? 'stage' : type === 'OpportunityDelete' ? 'deleted' : 'opp'
    return {
      id: `${kind}:${oppId}:${kind === 'stage' ? (body.pipelineStageId || '') : status}`, kind, type, at, locationId,
      oppId, contactId: body.contactId || null, name: body.name || body.title || null, value: num(body.monetaryValue),
      userId: body.assignedTo || body.assignedUserId || null, pipelineId: body.pipelineId || null, stageId: body.pipelineStageId || null, status: status || null, source: body.source || null,
    }
  }
  if (/^Appointment(Create|Update|Delete)$/.test(type)) {
    const a = body.appointment || body
    const apptId = a.id || a.appointmentId || null; if (!apptId) return null
    const st = String(a.appointmentStatus || a.status || '').toLowerCase()
    return { id: `appt:${apptId}:${type}:${st}`, kind: type === 'AppointmentCreate' ? 'booked' : type === 'AppointmentDelete' ? 'appt-deleted' : 'appt', type, at, locationId, apptId, contactId: a.contactId || null, calendarId: a.calendarId || null, title: a.title || null, status: st || null, userId: a.assignedUserId || (Array.isArray(a.users) && a.users[0]) || null, startMs: ms(a.startTime), bookedBy: (a.createdBy && (a.createdBy.userId || a.createdBy.user_id)) || null }
  }
  if (type === 'InboundMessage' || type === 'OutboundMessage') {
    return { id: `msg:${body.messageId || body.id || `${body.conversationId || ''}:${at}`}`, kind: type === 'InboundMessage' ? 'inbound' : 'outbound', type, at, locationId, contactId: body.contactId || null, conversationId: body.conversationId || null, channel: body.messageType || null, userId: body.userId || null }
  }
  if (type === 'INSTALL' || type === 'UNINSTALL') return { id: `${type}:${locationId}:${at}`, kind: type.toLowerCase(), type, at, locationId, companyId: body.companyId || null }
  return null
}
// Add one event to a buffer: retries and repeats (same id) are dropped, the
// buffer is trimmed to the cap and to the keep window, newest last.
export function mergeLiveEvents(existing, ev, now = Date.now()) {
  const keep = (existing || []).filter((e) => e && e.id !== ev.id && now - (e.at || 0) < LIVE_KEEP_MS)
  keep.push(ev)
  return keep.slice(-LIVE_CAP)
}
export async function readLiveEvents(locationId, { sinceMs = 0 } = {}) {
  try { const hit = await liveStore().get(liveKey(locationId), { type: 'json' }); return ((hit && hit.events) || []).filter((e) => (e.at || 0) >= sinceMs) } catch { return [] }
}
export async function appendLiveEvent(ev) {
  const st = liveStore(); const key = liveKey(ev.locationId)
  const hit = await st.get(key, { type: 'json' }).catch(() => null)
  const events = mergeLiveEvents((hit && hit.events) || [], ev)
  await st.setJSON(key, { at: Date.now(), events })
  return events.length
}
