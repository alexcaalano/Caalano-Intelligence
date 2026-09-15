// @needs-fake-blobs
import fs from 'node:fs'
// Who sees what: a role default hides views and tabs for everyone of that
// role; a person's own entry replaces the default and deleting it returns
// them to it; only ids that apply to the role count; Super Admins are never
// hidden anything; the session (auth?action=me) carries the result.
process.env.AUTH_SECRET = 'test-secret'
import assert from 'node:assert/strict'
const V = await import('../netlify/lib/visibility.mjs')
const { getStore } = await import('@netlify/blobs')

const vis = {
  roles: { admin: { views: { forecast: false, reports: false }, tabs: { clinic: false, nonsense: false } }, user: { views: { social: false } }, account_admin: { views: { reports: false }, tabs: { optlog: false } }, account_user: { tabs: { actions: false, meta: false } } },
  users: { 'Sam@Example.com': { views: {}, tabs: { cohorts: false } } },
}
const n = V.normVisibility(vis)
assert.deepEqual(Object.keys(n.roles).sort(), ['account_admin', 'account_user', 'admin', 'superadmin', 'user'])
assert.deepEqual(Object.keys(n.users), ['sam@example.com'], 'users keyed by lower-cased email')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, vis), { views: ['forecast'], tabs: ['clinic'], settings: [] }, 'only ids that apply to the role')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, { roles: { admin: { settings: { team: false, visibility: false, account: false } } } }), { views: [], tabs: [], settings: ['team'] }, 'settings: only the agency sections can be hidden; never Visibility or Your account')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'user' }, { roles: { user: { settings: { team: false } } } }).settings, [], 'an Agency User has no settings sections to hide')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'user' }, vis), { views: ['social'], tabs: [], settings: [] })
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'viewer' }, vis), { views: ['reports'], tabs: ['optlog', 'set_account', 'set_tracking', 'set_targets', 'set_operations'], settings: [] }, 'viewer reads as account_admin (and starts without the settings pages)')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'account_user' }, vis), { views: [], tabs: [], settings: [] }, 'an account user has no client tabs to hide')
assert.deepEqual(V.hiddenFor({ email: 'SAM@example.com', role: 'admin' }, vis), { views: [], tabs: ['cohorts'], settings: [] }, 'a person\'s entry replaces the role default')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'superadmin' }, vis), { views: [], tabs: [], settings: [] }, 'no Super Admin entry: nothing hidden')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'superadmin' }, { roles: { superadmin: { views: { forecast: false }, tabs: { clinic: false } } } }), { views: ['forecast'], tabs: ['clinic'], settings: [] }, 'a Super Admin can hide things from themselves')
assert.ok(!V.VIS_VIEWS.some((x) => x.id === 'settings'), 'Settings is never in the list')
// The account's settings pages start off for Account Admins, and an explicit
// true (what the Visibility switch stores) turns one on - per role or per person.
assert.ok(V.hiddenFor({ email: 'a@x', role: 'account_admin' }, {}).tabs.includes('set_account'), 'account admin: settings pages off by default')
assert.ok(V.hiddenFor({ email: 'a@x', role: 'account_admin' }, { roles: { account_admin: { views: {}, tabs: {} } } }).tabs.includes('set_tracking'), 'still off once the role has been saved without them')
assert.ok(!V.hiddenFor({ email: 'a@x', role: 'account_admin' }, { roles: { account_admin: { tabs: { set_account: true } } } }).tabs.includes('set_account'), 'switched on for the role')
assert.ok(!V.hiddenFor({ email: 'a@x', role: 'account_admin' }, { users: { 'a@x': { tabs: { set_targets: true } } } }).tabs.includes('set_targets'), 'switched on for one person')
assert.ok(V.hiddenFor({ email: 'a@x', role: 'account_admin' }, { users: { 'a@x': { tabs: { set_targets: true } } } }).tabs.includes('set_account'), 'the rest stay off for that person')
assert.ok(!V.hiddenFor({ email: 'a@x', role: 'admin' }, {}).tabs.includes('set_account'), 'agency roles see the settings pages')
assert.ok(V.isDefaultOff('viewer', 'tabs', 'set_account') && !V.isDefaultOff('admin', 'tabs', 'set_account'), 'isDefaultOff reads viewer as account admin')
// A role default is a SEED for new people, not a live rule. roleSeed hands out
// that starting set (with the default-off pages already off), and sameEntry is
// how the chart decides whether a person still matches it.
{
  const seed = V.roleSeed('account_admin', { roles: { account_admin: { views: { social: false } } } })
  assert.equal(seed.views.social, false, 'the seed carries what the default hides')
  assert.equal(seed.tabs.set_tracking, false, 'and the pages that start off for that role')
  assert.ok(V.sameEntry(seed, V.roleSeed('viewer', { roles: { account_admin: { views: { social: false } } } })), 'viewer and account_admin are the same role')
  assert.ok(!V.sameEntry(seed, V.roleSeed('admin', {})), 'a different role is a different seed')
  const mine = { views: { social: false }, tabs: { set_tracking: false, set_account: false, set_targets: false, set_operations: false }, settings: {} }
  assert.ok(V.sameEntry(seed, mine), 'a person holding that exact set matches the default')
  assert.ok(!V.sameEntry(seed, { ...mine, views: {} }), 'and differs once they are given something back')
}
// The Account view's groups: Visibility lays its rows out by the same list the
// app builds the account sidebar from, and every group member is a known page.
{
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const gs = app.indexOf('const V2_TAB_GROUPS = ['); const src = app.slice(gs + 'const V2_TAB_GROUPS = '.length, app.indexOf('\n]\n', gs) + 2)
  assert.deepEqual(V.VIS_ACCOUNT_GROUPS, new Function('return ' + src)(), 'VIS_ACCOUNT_GROUPS mirrors V2_TAB_GROUPS')
  const known = new Set([...V.VIS_VIEWS, ...V.VIS_TABS].map((x) => x.id))
  for (const [, ids] of V.VIS_ACCOUNT_GROUPS) for (const id of ids) assert.ok(known.has(id), id + ' is a page Visibility knows')
}
// Settings is grouped into sections with tabs; every tab is its own switch.
assert.deepEqual(V.VIS_SETTINGS.map((x) => x.id), ['clients', 'crm', 'meta', 'google', 'dailyperf', 'fatigue', 'socialkpis', 'team'], 'every Settings tab can be hidden')
assert.equal(V.visSettingLabel(V.VIS_SETTINGS.find((x) => x.id === 'crm')), 'Integrations · CRM')
assert.equal(V.visSettingLabel(V.VIS_SETTINGS.find((x) => x.id === 'team')), 'Access', 'a section with one tab of the same name reads once')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, { roles: { admin: { settings: { meta: false, google: false, crm: false } } } }).settings.sort(), ['crm', 'google', 'meta'], 'hiding every Integrations tab hides them all (the section follows)')
// Tabs moved from Team & access to Visibility. Old ticks still apply until the
// person is saved in Visibility; an Account Admin starts without Sales Hub only
// while the role has never been saved; the server reads tabs as a plain list.
const legacy = { email: 'kim@x', role: 'account_admin', tabs: ['overall', 'meta'] }
assert.deepEqual(V.hiddenFor(legacy, {}).tabs.sort(), V.tabsForRole('account_admin').map((t) => t.id).filter((id) => id !== 'overall' && id !== 'meta').sort(), 'old ticks: everything not ticked is hidden')
assert.deepEqual(V.effectiveTabs(legacy, {}).sort(), ['meta', 'overall'], 'effective tabs from old ticks')
assert.deepEqual(V.effectiveTabs(legacy, { users: { 'kim@x': { tabs: { cohorts: false } } } }).includes('cohorts'), false, 'a saved set replaces the ticks')
assert.ok(V.effectiveTabs(legacy, { users: { 'kim@x': { tabs: { cohorts: false } } } }).includes('users'), 'and un-hides what the ticks left off')
assert.ok(V.hasLegacyTicks(legacy, {}) && !V.hasLegacyTicks(legacy, { users: { 'kim@x': {} } }) && !V.hasLegacyTicks({ email: 'a@x', role: 'admin', tabs: ['meta'] }, {}))
assert.deepEqual(V.hiddenFor({ email: 'n@x', role: 'account_admin' }, {}).views, ['saleshub'], 'a never-saved Account Admin default leaves Sales Hub off')
assert.deepEqual(V.hiddenFor({ email: 'n@x', role: 'account_admin' }, { roles: { account_admin: {} } }).views, [], 'once saved, the stored entry is the truth')
assert.deepEqual(V.effectiveTabs({ email: 'r@x', role: 'account_user' }, {}), [], 'an account user works from the Action Centre, not client tabs')
assert.deepEqual(V.effectiveTabs({ email: 'r@x', role: 'account_user' }, { roles: { account_user: { tabs: { actions: false } } } }), [])
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, null), { views: [], tabs: [], settings: [] }, 'nothing set: nothing hidden')
assert.ok(V.hasOverride(vis, 'sam@example.com') && !V.hasOverride(vis, 'a@x'))
// Return to default = the entry is gone.
const back = V.normVisibility({ ...vis, users: {} })
assert.deepEqual(V.hiddenFor({ email: 'sam@example.com', role: 'admin' }, back), { views: ['forecast'], tabs: ['clinic'], settings: [] })
assert.ok(V.isHiddenView({ views: ['forecast'], tabs: [] }, 'forecast') && !V.isHiddenTab({ views: ['forecast'], tabs: [] }, 'forecast'))
assert.equal(V.tabsForRole('account_user').length, 0)
assert.ok(V.viewsForRole('account_admin').every((v) => v.roles.includes('account_admin')))

// The session carries it: an admin signs in after the Super Admin hid Forecaster.
await getStore({ name: 'caalano-settings' }).setJSON('all', { visibility: vis })
await getStore({ name: 'caalano-auth' }).setJSON('user:adm@example.com', { email: 'adm@example.com', role: 'admin', status: 'active', firstName: 'Ad', lastName: 'Min', phone: '+61400000001', termsVersion: 99 })
const { signSession } = await import('../netlify/lib/auth.mjs')
const { default: auth } = await import('../netlify/functions/auth.mjs')
const tok = await signSession({ e: 'adm@example.com', exp: Date.now() + 60000, v: 0 }, 'test-secret')
const me = await auth(new Request('https://x/.netlify/functions/auth?action=me', { headers: { cookie: 'c360_session=' + tok } })).then((r) => r.json())
assert.ok(me.ok && me.user, JSON.stringify(me).slice(0, 200))
assert.deepEqual(me.user.hidden, { views: ['forecast'], tabs: ['clinic'], settings: [] }, 'me carries hidden')
console.log('visibility_test ok')
