const DATA = {
  'caalano-settings': { all: JSON.stringify({ kpis: { nexia: { monthlySpend: 6000 } }, keyevents: {} }) },
  'caalano-auth': { 'user:alex': JSON.stringify({ email: 'alex@caalanodigital.com.au', role: 'superadmin' }) },
  'caalano-terms': {}, 'caalano-health': { 'nexia:2026-08': JSON.stringify({ score: 71 }) }, 'caalano-monthly': {}, 'caalano-social': {}, 'caalano-clinic': {},
  'caalano-audit': { 'audit:2026-09-03': JSON.stringify([{ t: 1, user: 'alex' }]) },
  'caalano-diag': Object.fromEntries(Array.from({ length: 4500 }, (_, i) => [`diag:2026-09-03:${String(i).padStart(6, '0')}`, JSON.stringify({ sev: 'slow', ms: 8000 + i })])),
  'meta-webhooks': { 'acct:1': 'not json at all' }, 'caalano-speedscan': {},
  'ghl-auth': { tokens: JSON.stringify({ access_token: 'SECRET', refresh_token: 'SECRET2' }) },
}
export function getStore({ name }) {
  const s = DATA[name] || {}
  return {
    async list({ cursor } = {}) { const keys = Object.keys(s).sort(); const start = cursor ? Number(cursor) : 0; const page = keys.slice(start, start + 1000); return { blobs: page.map((key) => ({ key })), cursor: start + 1000 < keys.length ? String(start + 1000) : undefined } },
    async get(key, { type } = {}) { const v = s[key]; if (v == null) return null; return type === 'json' ? JSON.parse(v) : v },
  }
}
