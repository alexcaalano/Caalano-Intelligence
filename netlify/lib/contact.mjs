// Phone numbers and email addresses, shared by the app, the sign-in page and
// the server (src/lib/contact.js re-exports this file for the bundle).
//
// A phone is stored in international form (+61400000000). People type it the
// way they know it: pick the country, type the local number. Countries carry
// the length of the national number and how it is grouped for display, so a
// number is checked before it is stored and shown the way people read it.
// Anything outside the list still works with the generic E.164 rule.

// iso, name, dial code, national number length(s), trunk prefix to strip,
// display grouping of the number as written locally, trunk prefix included.
export const PHONE_COUNTRIES = [
  { iso: 'AU', name: 'Australia', dial: '61', len: [9], trunk: '0', groups: [4, 3, 3], flag: '🇦🇺' },
  { iso: 'NZ', name: 'New Zealand', dial: '64', len: [8, 9, 10], trunk: '0', groups: [3, 3, 4], flag: '🇳🇿' },
  { iso: 'US', name: 'United States', dial: '1', len: [10], trunk: '', groups: [3, 3, 4], flag: '🇺🇸' },
  { iso: 'CA', name: 'Canada', dial: '1', len: [10], trunk: '', groups: [3, 3, 4], flag: '🇨🇦' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', len: [10], trunk: '0', groups: [5, 6], flag: '🇬🇧' },
  { iso: 'IE', name: 'Ireland', dial: '353', len: [9], trunk: '0', groups: [3, 3, 4], flag: '🇮🇪' },
  { iso: 'SG', name: 'Singapore', dial: '65', len: [8], trunk: '', groups: [4, 4], flag: '🇸🇬' },
  { iso: 'HK', name: 'Hong Kong', dial: '852', len: [8], trunk: '', groups: [4, 4], flag: '🇭🇰' },
  { iso: 'MY', name: 'Malaysia', dial: '60', len: [9, 10], trunk: '0', groups: [3, 3, 4], flag: '🇲🇾' },
  { iso: 'ID', name: 'Indonesia', dial: '62', len: [9, 10, 11, 12], trunk: '0', groups: [3, 4, 4], flag: '🇮🇩' },
  { iso: 'PH', name: 'Philippines', dial: '63', len: [10], trunk: '0', groups: [3, 3, 4], flag: '🇵🇭' },
  { iso: 'IN', name: 'India', dial: '91', len: [10], trunk: '0', groups: [5, 5], flag: '🇮🇳' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', len: [9], trunk: '0', groups: [2, 3, 4], flag: '🇦🇪' },
  { iso: 'ZA', name: 'South Africa', dial: '27', len: [9], trunk: '0', groups: [2, 3, 4], flag: '🇿🇦' },
  { iso: 'DE', name: 'Germany', dial: '49', len: [10, 11], trunk: '0', groups: [4, 3, 4], flag: '🇩🇪' },
  { iso: 'FR', name: 'France', dial: '33', len: [9], trunk: '0', groups: [1, 2, 2, 2, 2], flag: '🇫🇷' },
  { iso: 'NL', name: 'Netherlands', dial: '31', len: [9], trunk: '0', groups: [1, 2, 3, 3], flag: '🇳🇱' },
  { iso: 'ES', name: 'Spain', dial: '34', len: [9], trunk: '', groups: [3, 3, 3], flag: '🇪🇸' },
  { iso: 'IT', name: 'Italy', dial: '39', len: [9, 10], trunk: '', groups: [3, 3, 4], flag: '🇮🇹' },
  { iso: 'JP', name: 'Japan', dial: '81', len: [9, 10], trunk: '0', groups: [2, 4, 4], flag: '🇯🇵' },
  { iso: 'BR', name: 'Brazil', dial: '55', len: [10, 11], trunk: '0', groups: [2, 5, 4], flag: '🇧🇷' },
]
export const DEFAULT_PHONE_COUNTRY = 'AU'
export const countryByIso = (iso) => PHONE_COUNTRIES.find((c) => c.iso === String(iso || '').toUpperCase()) || null
// Longest dial-code match for an international number; US before CA on a tie.
export function countryByDial(digits) {
  let best = null
  for (const c of PHONE_COUNTRIES) if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c
  return best
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '')

// Parse what a person typed. `iso` is the country they picked; a number typed
// with + or 00 is taken as international whatever the pick. Returns
// { e164, iso, dial, national } or null when it cannot be a real number.
export function parsePhone(raw, iso = DEFAULT_PHONE_COUNTRY) {
  let s = String(raw || '').trim().replace(/[\s().-]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (s.startsWith('+')) {
    const d = digitsOf(s)
    if (!/^[1-9]\d{6,13}$/.test(d)) return null
    const c = countryByDial(d)
    if (c) {
      const national = d.slice(c.dial.length)
      if (!c.len.includes(national.length)) return null
      return { e164: '+' + d, iso: c.iso, dial: c.dial, national }
    }
    return { e164: '+' + d, iso: null, dial: null, national: d }
  }
  const c = countryByIso(iso)
  let d = digitsOf(s)
  if (!d) return null
  if (!c) return /^[1-9]\d{6,13}$/.test(d) ? { e164: '+' + d, iso: null, dial: null, national: d } : null
  if (c.trunk && d.startsWith(c.trunk)) d = d.slice(c.trunk.length)
  // Typed the dial code without a plus (61400000000): accept it.
  if (d.startsWith(c.dial) && c.len.includes(d.length - c.dial.length) && !c.len.includes(d.length)) d = d.slice(c.dial.length)
  if (!c.len.includes(d.length) || d.startsWith('0')) return null
  return { e164: '+' + c.dial + d, iso: c.iso, dial: c.dial, national: d }
}
// The stored form, or null. What auth.mjs uses.
export const normPhone = (raw, iso) => { const p = parsePhone(raw, iso); return p ? p.e164 : null }

// A national number grouped the way its country writes it, with the trunk
// prefix back on. Used while typing and when showing a stored number.
export function formatNational(digits, iso = DEFAULT_PHONE_COUNTRY) {
  const c = countryByIso(iso)
  let d = digitsOf(digits)
  if (!d) return ''
  if (!c) return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim()
  if (c.trunk && d.startsWith(c.trunk)) d = d.slice(1)
  // `groups` describe the number as written locally, trunk prefix included.
  const shown = (c.trunk || '') + d
  const groups = c.groups
  const out = []
  let i = 0
  for (const g of groups) { if (i >= shown.length) break; out.push(shown.slice(i, i + g)); i += g }
  if (i < shown.length) out.push(shown.slice(i))
  return out.join(' ')
}
// A stored +E.164 number shown for reading: "+61 400 000 000".
export function formatPhone(e164) {
  const d = digitsOf(e164)
  if (!d) return ''
  const c = countryByDial(d)
  if (!c) return '+' + d
  const national = d.slice(c.dial.length)
  return `+${c.dial} ${formatNational(c.trunk + national, c.iso).replace(new RegExp('^' + c.trunk), '')}`.replace(/\s+/g, ' ').trim()
}

// An address that can actually receive mail: one @, a domain with a dot and a
// letters-only top level of two or more, no spaces, nothing absurdly long.
export function isEmail(s) {
  const e = String(s || '').trim()
  if (!e || e.length > 254 || /\s/.test(e)) return false
  const m = /^([^@]+)@([^@]+)$/.exec(e)
  if (!m) return false
  const [, local, domain] = m
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(domain)) return false
  return true
}
