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

// ---- user store ----
const publicUser = (u) => u && ({
  email: u.email, name: u.name || '', role: u.role || 'viewer', status: u.status || 'active',
  createdAt: u.createdAt || null, invitedBy: u.invitedBy || null, lastLogin: u.lastLogin || null,
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

// ---- operations ----
// Create the very first admin. Only succeeds when no users exist yet.
export async function bootstrapAdmin({ email, name, password }) {
  if (!isEmail(email)) return { error: 'A valid email is required.' }
  if (!password || String(password).length < 8) return { error: 'Password must be at least 8 characters.' }
  if (await countUsers() > 0) return { error: 'Setup already complete — sign in instead.' }
  const { hash, salt } = await hashPassword(password)
  const u = await saveUser({
    email: normEmail(email), name: String(name || '').trim(), role: 'admin', status: 'active',
    passwordHash: hash, passwordSalt: salt, createdAt: new Date().toISOString(), invitedBy: null, lastLogin: null,
  })
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
export async function createInvite({ email, name, role, invitedBy }) {
  if (!isEmail(email)) return { error: 'A valid email is required.' }
  const em = normEmail(email)
  const existing = await getUser(em)
  if (existing && existing.status === 'active') return { error: 'That person already has an active account.' }
  const token = randomToken()
  const now = new Date().toISOString()
  const expires = Date.now() + 7 * 86400 * 1000
  await saveUser({
    email: em, name: String(name || '').trim(), role: role === 'admin' ? 'admin' : 'viewer',
    status: 'invited', passwordHash: null, passwordSalt: null, createdAt: existing ? existing.createdAt : now,
    invitedBy: invitedBy || null, lastLogin: null, inviteToken: token, inviteExpires: expires,
  })
  await store().setJSON(iKey(token), { email: em, expires })
  return { token, expires, user: publicUser({ email: em, name, role, status: 'invited', createdAt: now, invitedBy }) }
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

export async function updateUser(email, patch, actorEmail) {
  const u = await getUser(email)
  if (!u) return { error: 'No such user.' }
  const em = normEmail(email)
  if (patch.role && (patch.role === 'admin' || patch.role === 'viewer')) u.role = patch.role
  if (patch.status && (patch.status === 'active' || patch.status === 'disabled')) {
    if (em === normEmail(actorEmail) && patch.status === 'disabled') return { error: 'You can’t disable your own account.' }
    if (u.status !== 'invited') u.status = patch.status
  }
  if (typeof patch.name === 'string') u.name = patch.name.trim()
  await saveUser(u)
  return { user: publicUser(u) }
}

export async function deleteUser(email, actorEmail) {
  const em = normEmail(email)
  if (em === normEmail(actorEmail)) return { error: 'You can’t remove your own account.' }
  const u = await getUser(em)
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
