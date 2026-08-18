// Multi-user authentication for Caalano360.
//
// A small, dependency-free auth layer built on Netlify Blobs + Web Crypto:
//   - users live in the `caalano-auth` blob store, keyed by lower-cased email
//   - passwords are PBKDF2-SHA256 hashed (never stored in the clear)
//   - sessions are stateless signed tokens (HMAC-SHA256) carried in an
//     httpOnly cookie, so the edge gate can verify them without a DB read
//   - invites are one-time tokens; the recipient sets their own password
//
// The whole system only "switches on" once the AUTH_SECRET env var is set, so
// it can be shipped dark and enabled deliberately (and disabled instantly by
// unsetting the var, which falls the site back to the legacy shared password).
import { getStore } from '@netlify/blobs'

export const COOKIE = 'c360_session'
const SESSION_DAYS = 14
const PBKDF2_ITER = 150000
const enc = new TextEncoder()

const store = () => getStore({ name: 'caalano-auth', consistency: 'strong' })
const uKey = (email) => 'user:' + String(email || '').trim().toLowerCase()
const iKey = (token) => 'invite:' + token
export const normEmail = (e) => String(e || '').trim().toLowerCase()
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

// ---- base64url helpers (work identically in Node & Deno runtimes) ----
function b64urlFromBytes(bytes) {
  let s = ''
  const b = new Uint8Array(bytes)
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytesFromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const b64urlFromStr = (str) => b64urlFromBytes(enc.encode(str))
const strFromB64url = (str) => new TextDecoder().decode(bytesFromB64url(str))

// ---- password hashing (PBKDF2-SHA256) ----
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? bytesFromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, keyMaterial, 256)
  return { hash: b64urlFromBytes(bits), salt: b64urlFromBytes(salt) }
}
export async function verifyPassword(password, rec) {
  if (!rec || !rec.passwordHash || !rec.passwordSalt) return false
  const { hash } = await hashPassword(password, rec.passwordSalt)
  return timingSafeEqual(hash, rec.passwordHash)
}
function timingSafeEqual(a, b) {
  a = String(a); b = String(b)
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

// ---- session tokens (shared scheme with the edge gate) ----
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}
export async function signSession(payload, secret) {
  const body = b64urlFromStr(JSON.stringify(payload))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return body + '.' + b64urlFromBytes(sig)
}
export async function verifySession(token, secret) {
  if (!token || !secret || typeof token !== 'string' || token.indexOf('.') < 0) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  if (!timingSafeEqual(sig, b64urlFromBytes(expected))) return null
  let payload
  try { payload = JSON.parse(strFromB64url(body)) } catch { return null }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  return payload
}
export function sessionCookie(token, maxAgeSec = SESSION_DAYS * 86400) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}
export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
export function readCookie(req, name = COOKIE) {
  const raw = req.headers.get('cookie') || ''
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? m[1] : null
}

// ---- token generation ----
export function randomToken(bytes = 24) {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(bytes)))
}

// ---- roles & permissions ----
// superadmin - everything admin has PLUS: manage admins, add/remove/relink
//              client accounts, system panel. Can only be managed by a superadmin.
// admin      - full day-to-day control (all clients, all tabs, settings, manage
//              users/viewers, diagnostics) but NOT the superadmin-only areas.
// user       - agency staff; dashboards for allowed accounts, no settings/invites
// viewer     - client; only assigned clients + only allowed sub-tabs
export const ROLES = ['superadmin', 'admin', 'user', 'viewer']
const normRole = (r) => (ROLES.includes(r) ? r : 'viewer')
export const ALL_TABS = ['overall', 'users', 'meta', 'google', 'cohorts', 'forms', 'appts', 'timing']
const RANK = { superadmin: 3, admin: 2, user: 1, viewer: 0 }
export const rankOf = (r) => (RANK[r] != null ? RANK[r] : 0)
export const isAdminish = (r) => r === 'admin' || r === 'superadmin'
// Can an actor with actorRole administer a target with targetRole? Admins can
// manage users/viewers only; managing (or granting) admin/superadmin needs a
// superadmin.
export function canManageRole(actorRole, targetRole) {
  if (actorRole === 'superadmin') return true
  if (actorRole === 'admin') return rankOf(targetRole) < RANK.admin
  return false
}

// Can this user open a given client account?
export function canSeeClient(user, clientId) {
  if (!user) return false
  if (isAdminish(user.role)) return true
  if (user.role === 'user') return user.allClients !== false || (user.clients || []).includes(clientId)
  return (user.clients || []).includes(clientId) // viewer: explicit allocation only
}
// Which of the offered sub-tabs may this user see? (admins/users: all.)
export function allowedTabs(user, offered) {
  if (!user || user.role !== 'viewer' || !Array.isArray(user.tabs)) return offered
  return offered.filter((t) => user.tabs.includes(t))
}

// ---- user store ----
const publicUser = (u) => u && ({
  email: u.email, name: u.name || '', role: normRole(u.role), status: u.status || 'active',
  createdAt: u.createdAt || null, invitedBy: u.invitedBy || null, lastLogin: u.lastLogin || null,
  clients: Array.isArray(u.clients) ? u.clients : [], allClients: u.allClients !== false,
  tabs: Array.isArray(u.tabs) ? u.tabs : null, reports: u.reports === true, requestedAt: u.requestedAt || null, note: u.note || '',
})
export { publicUser }

export async function getUser(email) {
  return store().get(uKey(email), { type: 'json' }).catch(() => null)
}
export async function listUsers() {
  const { blobs } = await store().list({ prefix: 'user:' }).catch(() => ({ blobs: [] }))
  const out = []
  for (const b of blobs || []) {
    const u = await store().get(b.key, { type: 'json' }).catch(() => null)
    if (u) out.push(publicUser(u))
  }
  return out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
}
export async function countUsers() {
  const { blobs } = await store().list({ prefix: 'user:' }).catch(() => ({ blobs: [] }))
  return (blobs || []).length
}
async function saveUser(u) { await store().setJSON(uKey(u.email), u); return u }
// How many ACTIVE users hold a given role (for the last-superadmin guard).
async function countActiveRole(role) { return (await listUsers()).filter((u) => u.role === role && u.status === 'active').length }
// One-time migration: if no superadmin exists yet, promote the earliest-created
// active admin (the account that bootstrapped the system) to superadmin.
export async function ensureSuperadmin() {
  const us = await listUsers()
  if (us.some((u) => u.role === 'superadmin')) return
  const admins = us.filter((u) => u.role === 'admin' && u.status === 'active').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  if (admins.length) { const u = await getUser(admins[0].email); if (u) { u.role = 'superadmin'; await saveUser(u) } }
}

// ---- operations ----
// Create the very first account - a SUPER ADMIN (the owner). Only succeeds when
// no users exist yet.
export async function bootstrapAdmin({ email, name, password }) {
  if (!isEmail(email)) return { error: 'A valid email is required.' }
  if (!password || String(password).length < 8) return { error: 'Password must be at least 8 characters.' }
  if (await countUsers() > 0) return { error: 'Setup already complete - sign in instead.' }
  const { hash, salt } = await hashPassword(password)
  const u = await saveUser({
    email: normEmail(email), name: String(name || '').trim(), role: 'superadmin', status: 'active',
    passwordHash: hash, passwordSalt: salt, createdAt: new Date().toISOString(), invitedBy: null, lastLogin: null,
    clients: [], allClients: true, tabs: null,
  })
  return { user: publicUser(u) }
}

// Sanitise incoming allocation fields to a clean, stored shape.
function normAlloc(patch = {}) {
  const out = {}
  if (patch.role && ROLES.includes(patch.role)) out.role = patch.role
  if (Array.isArray(patch.clients)) out.clients = [...new Set(patch.clients.map(String))]
  if (typeof patch.allClients === 'boolean') out.allClients = patch.allClients
  if (patch.tabs === null) out.tabs = null
  else if (Array.isArray(patch.tabs)) out.tabs = patch.tabs.filter((t) => ALL_TABS.includes(t))
  // Monthly Reports capability - a separate grant (mainly for viewers/clients) that
  // lets them see PUBLISHED monthly reports for their allocated clients. Admins and
  // agency users always have it implicitly (canSeeReports), so it's stored only as
  // an explicit viewer grant.
  if (typeof patch.reports === 'boolean') out.reports = patch.reports
  return out
}
// Can this user access Monthly Reports at all? Admins + agency users always can;
// a viewer only if explicitly granted. (Client-visibility is further limited to
// PUBLISHED reports for their allocated clients - enforced at the data layer.)
export function canSeeReports(user) {
  if (!user) return false
  if (isAdminish(user.role) || user.role === 'user') return true
  return user.role === 'viewer' && user.reports === true
}

// A client requests access. Creates a PENDING account (with their chosen
// password) that grants nothing until an admin approves + allocates it.
export async function signupRequest({ email, name, password, note }) {
  if (!isEmail(email)) return { error: 'Please enter a valid email.' }
  if (!password || String(password).length < 8) return { error: 'Password must be at least 8 characters.' }
  const em = normEmail(email)
  const existing = await getUser(em)
  if (existing && (existing.status === 'active' || existing.status === 'invited')) return { error: 'An account for that email already exists. Try signing in.' }
  const { hash, salt } = await hashPassword(password)
  await saveUser({
    email: em, name: String(name || '').trim(), role: 'viewer', status: 'pending',
    passwordHash: hash, passwordSalt: salt, createdAt: existing ? existing.createdAt : new Date().toISOString(),
    invitedBy: null, lastLogin: null, clients: [], allClients: false, tabs: null,
    requestedAt: new Date().toISOString(), note: String(note || '').trim().slice(0, 300),
  })
  return { ok: true }
}

// Admin approves a pending signup, setting role + allocations and activating it.
export async function approveUser(email, patch, actor) {
  const u = await getUser(email)
  if (!u) return { error: 'No such request.' }
  const actorRole = (actor && actor.role) || 'admin'
  if (patch.role && !canManageRole(actorRole, patch.role)) return { error: 'Only a Super Admin can grant Admin access.' }
  Object.assign(u, normAlloc(patch))
  if (!u.role) u.role = 'viewer'
  u.status = 'active'
  u.approvedBy = (actor && actor.email) || null
  u.requestedAt = u.requestedAt || null
  await saveUser(u)
  return { user: publicUser(u) }
}

export async function authenticate(email, password) {
  const u = await getUser(email)
  if (!u || u.status === 'disabled') return null
  if (u.status !== 'active') return null // invited-but-not-accepted can't log in
  if (!(await verifyPassword(password, u))) return null
  u.lastLogin = new Date().toISOString()
  await saveUser(u)
  return publicUser(u)
}

// Admin creates an invite. Returns the token + the pending user record.
export async function createInvite({ email, name, role, clients, allClients, tabs, reports, invitedBy, actor }) {
  if (!isEmail(email)) return { error: 'A valid email is required.' }
  const actorRole = (actor && actor.role) || 'admin'
  if (role && !canManageRole(actorRole, role)) return { error: 'Only a Super Admin can invite an Admin.' }
  const em = normEmail(email)
  const existing = await getUser(em)
  if (existing && existing.status === 'active') return { error: 'That person already has an active account.' }
  const token = randomToken()
  const now = new Date().toISOString()
  const expires = Date.now() + 7 * 86400 * 1000
  const alloc = normAlloc({ role, clients, allClients, tabs, reports })
  const u = {
    email: em, name: String(name || '').trim(), role: normRole(role),
    status: 'invited', passwordHash: null, passwordSalt: null, createdAt: existing ? existing.createdAt : now,
    invitedBy: (actor && actor.email) || invitedBy || null, lastLogin: null, inviteToken: token, inviteExpires: expires,
    clients: [], allClients: isAdminish(role) || role === 'user', tabs: null, ...alloc,
  }
  await saveUser(u)
  await store().setJSON(iKey(token), { email: em, expires })
  return { token, expires, user: publicUser(u) }
}

export async function inviteInfo(token) {
  const rec = await store().get(iKey(token), { type: 'json' }).catch(() => null)
  if (!rec) return { valid: false }
  if (rec.expires && rec.expires < Date.now()) return { valid: false, expired: true }
  const u = await getUser(rec.email)
  if (!u || u.status !== 'invited' || u.inviteToken !== token) return { valid: false }
  return { valid: true, email: u.email, name: u.name || '', role: u.role }
}

// Recipient accepts an invite by setting their password. Activates the account.
export async function acceptInvite({ token, password, name }) {
  const info = await inviteInfo(token)
  if (!info.valid) return { error: info.expired ? 'This invite has expired. Ask an admin to resend it.' : 'This invite link is invalid or has already been used.' }
  if (!password || String(password).length < 8) return { error: 'Password must be at least 8 characters.' }
  const u = await getUser(info.email)
  const { hash, salt } = await hashPassword(password)
  u.passwordHash = hash; u.passwordSalt = salt; u.status = 'active'
  if (name && String(name).trim()) u.name = String(name).trim()
  u.inviteToken = null; u.inviteExpires = null; u.lastLogin = new Date().toISOString()
  await saveUser(u)
  await store().delete(iKey(token)).catch(() => {})
  return { user: publicUser(u) }
}

export async function updateUser(email, patch, actor) {
  const u = await getUser(email)
  if (!u) return { error: 'No such user.' }
  const em = normEmail(email)
  const actorRole = (actor && actor.role) || 'admin'
  const self = em === normEmail((actor && actor.email) || '')
  // An admin can't touch an admin or super admin - only a super admin can.
  if (!canManageRole(actorRole, u.role)) return { error: u.role === 'superadmin' ? 'Only a Super Admin can manage a Super Admin.' : 'Only a Super Admin can manage an Admin.' }
  if (patch.role && ROLES.includes(patch.role)) {
    if (!canManageRole(actorRole, patch.role)) return { error: 'Only a Super Admin can grant Admin / Super Admin access.' }
    if (self && patch.role !== u.role) return { error: 'You can’t change your own role.' }
    if (u.role === 'superadmin' && patch.role !== 'superadmin' && (await countActiveRole('superadmin')) <= 1) return { error: 'You can’t remove the last Super Admin.' }
    u.role = patch.role
  }
  Object.assign(u, normAlloc({ clients: patch.clients, allClients: patch.allClients, tabs: patch.tabs, reports: patch.reports }))
  if (patch.status && (patch.status === 'active' || patch.status === 'disabled')) {
    if (self && patch.status === 'disabled') return { error: 'You can’t disable your own account.' }
    if (patch.status === 'disabled' && u.role === 'superadmin' && (await countActiveRole('superadmin')) <= 1) return { error: 'You can’t disable the last Super Admin.' }
    if (u.status !== 'invited' && u.status !== 'pending') u.status = patch.status
  }
  if (typeof patch.name === 'string') u.name = patch.name.trim()
  await saveUser(u)
  return { user: publicUser(u) }
}

export async function deleteUser(email, actor) {
  const em = normEmail(email)
  if (em === normEmail((actor && actor.email) || '')) return { error: 'You can’t remove your own account.' }
  const u = await getUser(em)
  const actorRole = (actor && actor.role) || 'admin'
  if (u && !canManageRole(actorRole, u.role)) return { error: u.role === 'superadmin' ? 'Only a Super Admin can remove a Super Admin.' : 'Only a Super Admin can remove an Admin.' }
  if (u && u.role === 'superadmin' && (await countActiveRole('superadmin')) <= 1) return { error: 'You can’t remove the last Super Admin.' }
  if (u && u.inviteToken) await store().delete(iKey(u.inviteToken)).catch(() => {})
  await store().delete(uKey(em)).catch(() => {})
  return { ok: true }
}

export async function changePassword(email, current, next) {
  const u = await getUser(email)
  if (!u) return { error: 'No such user.' }
  if (!(await verifyPassword(current, u))) return { error: 'Your current password is incorrect.' }
  if (!next || String(next).length < 8) return { error: 'New password must be at least 8 characters.' }
  const { hash, salt } = await hashPassword(next)
  u.passwordHash = hash; u.passwordSalt = salt
  await saveUser(u)
  return { ok: true }
}

// Resolve the caller's session from the request cookie. Returns the public user
// record (re-read from the store so role/status changes take effect) or null.
export async function currentUser(req, secret) {
  const token = readCookie(req)
  const payload = await verifySession(token, secret)
  if (!payload || !payload.e) return null
  const u = await getUser(payload.e)
  if (!u || u.status !== 'active') return null
  return publicUser(u)
}
