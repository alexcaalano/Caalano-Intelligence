// The custom dashboard registry must name only blocks that exist: every `sec:`
// module a section the Caalano360 tab declares, every `tab:` module a tab the
// workspace renders, every preset type a module, and no duplicate types.
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const lift = (re, endRe) => { const a = src.search(re); if (a < 0) throw new Error('missing ' + re); const b = src.slice(a).search(endRe); return src.slice(a, a + b) }
const DASH_MODULES = new Function(lift(/const DASH_MODULES = \[/, /\n\]\n/) + '\n]; return DASH_MODULES')()
const DASH_PRESETS = new Function('DASH_MODULES', lift(/const DASH_PRESETS = \[/, /\n\]\n/) + '\n]; return DASH_PRESETS')(DASH_MODULES)
let n = 0, f = 0
const ok = (c, m) => { n++; if (!c) { f++; console.log('FAIL:', m) } }
const types = DASH_MODULES.map((m) => m.type)
ok(new Set(types).size === types.length, 'module types are unique')
const secIds = new Set([...src.matchAll(/\bsec\('([a-z]+)', '/g)].map((m) => m[1]))
for (const t of types.filter((x) => x.startsWith('sec:'))) ok(secIds.has(t.slice(4)), `section module ${t} matches a declared section`)
const blkIds = new Set([...src.matchAll(/\bblk\('([a-z]+)', '/g)].map((m) => m[1]))
for (const t of types.filter((x) => !x.includes(':') && x !== 'heading')) ok(blkIds.has(t), `block module ${t} is registered by the tab`)
ok(types.includes('heading') && DASH_MODULES.find((m) => m.type === 'heading').multi === true, 'section headings are a repeatable layout module')
const tabIds = new Set([...src.matchAll(/curTab === '([a-z]+)' &&/g)].map((m) => m[1]))
for (const t of types.filter((x) => x.startsWith('tab:'))) ok(tabIds.has(t.slice(4)), `tab module ${t} is a workspace tab`)
const rendered = new Set([...src.matchAll(/case '([a-z]+)': return </g)].map((m) => m[1]))
for (const t of types.filter((x) => x.startsWith('tab:'))) ok(rendered.has(t.slice(4)), `tab module ${t} is rendered by the layout`)
// Card modules: the tab exists, and the card is wrapped as a pickable block.
const cardBlkIds = new Set([...src.matchAll(/<Blk id="([a-z]+:[a-z]+)">/g)].map((m) => m[1]))
const cards = types.filter((x) => x.includes(':') && !x.startsWith('sec:') && !x.startsWith('tab:'))
ok(cards.length >= 70, `card modules registered (${cards.length})`)
for (const t of cards) { ok(tabIds.has(t.split(':')[0]) && rendered.has(t.split(':')[0]), `card module ${t} belongs to a rendered tab`); ok(cardBlkIds.has(t), `card module ${t} is wrapped as a block`) }
for (const id of cardBlkIds) ok(types.includes(id), `block ${id} is offered as a module`)
for (const p of DASH_PRESETS) { ok(p.types.length > 0, `preset ${p.key} has modules`); for (const t of p.types) ok(types.includes(t), `preset ${p.key} uses a known module (${t})`) }
ok(/'dashboards'\]/.test(fs.readFileSync(new URL('../netlify/functions/settings.mjs', import.meta.url), 'utf8')), 'the server accepts the dashboards section')
ok(/id: 'custom'/.test(src) && /\['overall', 'custom', 'clinic'\]/.test(src), 'the custom tab is offered and grouped under Overview')
// Permissions parity: every tab the app lets you tick must survive the server's
// save filter, and the custom dashboard must be one of them.
const TAB_OPTIONS = new Function(lift(/const TAB_OPTIONS = \[/, /\n\]\n/) + '\n]; return TAB_OPTIONS')()
const auth = fs.readFileSync(new URL('../netlify/lib/auth.mjs', import.meta.url), 'utf8')
const ALL_TABS = new Function(auth.match(/export const ALL_TABS = (\[[^\]]*\])/)[1].replace(/^/, 'return ') )()
for (const t of TAB_OPTIONS) ok(ALL_TABS.includes(t.id), `tab ${t.id} can be granted and saved`)
ok(TAB_OPTIONS.some((t) => t.id === 'custom'), 'the custom dashboard is a tickable tab')
ok(DASH_MODULES.filter((m) => m.internal).map((m) => m.type).sort().join() === ['story', 'eff', 'sec:channels', 'sec:movers', 'sec:findings', 'sec:actions'].sort().join(), 'the agency-internal modules are exactly the six guarded ones')
console.log(f ? `${f}/${n} FAILED` : `${n} assertions passed`)
process.exit(f ? 1 : 0)
