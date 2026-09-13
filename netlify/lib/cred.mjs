// Credential envelope encryption (SAAS-DESIGN.md section 8). Each credential
// gets its own random data key; the data key is wrapped with the key
// encryption key named by cred_kek_id (an environment variable holding 32
// random bytes, base64). Rotating the KEK re-wraps data keys and never
// touches a ciphertext. Nothing here logs or returns key material.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'

const ALG = 'aes-256-gcm'
export const DEFAULT_KEK_ID = 'KEK_V1'

function kekBytes(kekId) {
  const raw = process.env[kekId]
  if (!raw) throw new Error(`${kekId} is not set`)
  const b = Buffer.from(raw, 'base64')
  if (b.length !== 32) throw new Error(`${kekId} must be 32 bytes, base64`)
  return b
}
function gcmEncrypt(key, plain) {
  const iv = randomBytes(12)
  const c = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([c.update(plain), c.final()])
  return { iv, ct, tag: c.getAuthTag() }
}
function gcmDecrypt(key, iv, ct, tag) {
  const d = createDecipheriv(ALG, key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}
// { cred_ciphertext, cred_iv, cred_tag, cred_wrapped_key, cred_kek_id }: the
// columns on connections, as Buffers ready for bytea.
export function sealCredential(credential, { kekId = DEFAULT_KEK_ID } = {}) {
  const kek = kekBytes(kekId)
  const dataKey = randomBytes(32)
  const body = gcmEncrypt(dataKey, Buffer.from(JSON.stringify(credential), 'utf8'))
  const wrap = gcmEncrypt(kek, dataKey)
  return { cred_ciphertext: body.ct, cred_iv: body.iv, cred_tag: body.tag, cred_wrapped_key: Buffer.concat([wrap.iv, wrap.tag, wrap.ct]), cred_kek_id: kekId }
}
function unwrapDataKey(row) {
  const kek = kekBytes(row.cred_kek_id)
  const w = Buffer.from(row.cred_wrapped_key)
  return gcmDecrypt(kek, w.subarray(0, 12), w.subarray(28), w.subarray(12, 28))
}
export function openCredential(row) {
  if (!row || !row.cred_ciphertext) return null
  const dataKey = unwrapDataKey(row)
  const plain = gcmDecrypt(dataKey, Buffer.from(row.cred_iv), Buffer.from(row.cred_ciphertext), Buffer.from(row.cred_tag))
  return JSON.parse(plain.toString('utf8'))
}
// Re-wrap under another KEK: the ciphertext, iv and tag are returned unchanged.
export function rewrapCredential(row, newKekId) {
  const dataKey = unwrapDataKey(row)
  const wrap = gcmEncrypt(kekBytes(newKekId), dataKey)
  return { ...row, cred_wrapped_key: Buffer.concat([wrap.iv, wrap.tag, wrap.ct]), cred_kek_id: newKekId }
}
