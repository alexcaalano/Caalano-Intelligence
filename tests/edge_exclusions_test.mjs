// The edge gate must let the site's own background jobs through: they are
// called over HTTP with no cookie and guard themselves with the warm token.
// Everything else under /.netlify/functions/ stays gated.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../netlify/edge-functions/auth.js', import.meta.url), 'utf8')
const m = src.match(/excludedPath:\s*\[([\s\S]*?)\]/)
assert.ok(m, 'excludedPath present')
const paths = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
for (const p of ['/.netlify/functions/warm-background', '/.netlify/functions/settings-backup-background', '/.netlify/functions/auth', '/.netlify/functions/caalano-connect', '/.netlify/functions/meta-webhook']) assert.ok(paths.includes(p), `${p} excluded from the gate`)
for (const p of ['/.netlify/functions/windsor', '/.netlify/functions/settings', '/.netlify/functions/backup-export', '/.netlify/functions/settings-backup-now']) assert.ok(!paths.includes(p), `${p} stays gated`)
// Both background functions refuse a call without the token.
const bg = readFileSync(new URL('../netlify/functions/settings-backup-background.mjs', import.meta.url), 'utf8')
assert.match(bg, /isWarmRequest\(req\)/)
const wb = readFileSync(new URL('../netlify/functions/warm-background.mjs', import.meta.url), 'utf8')
assert.match(wb, /isWarmRequest\(req\)/)
console.log('edge_exclusions_test ok')
