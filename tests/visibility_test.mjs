// @needs-fake-blobs
// Who sees what: a role default hides views and tabs for everyone of that
// role; a person's own entry replaces the default and deleting it returns
// them to it; only ids that apply to the role count; Super Admins are never
// hidden anything; the session (auth?action=me) carries the result.
process.env.AUTH_SECRET = 'test-secret'
import assert from 'node:assert/strict'
const V = await import('../netlify/lib/visibility.mjs')
const { getStore } = await import('@netlify/blobs')

const vis = {
  roles: { admin: { views: { forecast: false, reports: false }, tabs: { saleshub: false, nonsense: false } }, user: { views: { social: false } }, account_admin: { views: { reports: false }, tabs: { optlog: false } }, account_user: { tabs: { actions: false, meta: false } } },
  users: { 'Sam@Example.com': { views: {}, tabs: { cohorts: false } } },
}
const n = V.normVisibility(vis)
assert.deepEqual(Object.keys(n.roles).sort(), ['account_admin', 'account_user', 'admin', 'superadmin', 'user'])
assert.deepEqual(Object.keys(n.users), ['sam@example.com'], 'users keyed by lower-cased email')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, vis), { views: ['forecast'], tabs: ['saleshub'], settings: [] }, 'only ids that apply to the role')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, { roles: { admin: { settings: { team: false, visibility: false, account: false } } } }), { views: [], tabs: [], settings: ['team'] }, 'settings: only the agency sections can be hidden; never Visibility or Your account')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'user' }, { roles: { user: { settings: { team: false } } } }).settings, [], 'an Agency User has no settings sections to hide')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'user' }, vis), { views: ['social'], tabs: [], settings: [] })
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'viewer' }, vis), { views: ['reports'], tabs: ['optlog'], settings: [] }, 'viewer reads as account_admin')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'account_user' }, vis), { views: [], tabs: ['actions'], settings: [] }, 'an account user only has the one tab to hide')
assert.deepEqual(V.hiddenFor({ email: 'SAM@example.com', role: 'admin' }, vis), { views: [], tabs: ['cohorts'], settings: [] }, 'a person\'s entry replaces the role default')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'superadmin' }, vis), { views: [], tabs: [], settings: [] }, 'no Super Admin entry: nothing hidden')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'superadmin' }, { roles: { superadmin: { views: { forecast: false }, tabs: { clinic: false } } } }), { views: ['forecast'], tabs: ['clinic'], settings: [] }, 'a Super Admin can hide things from themselves')
assert.ok(!V.VIS_VIEWS.some((x) => x.id === 'settings'), 'Settings is never in the list')
assert.deepEqual(V.hiddenFor({ email: 'a@x', role: 'admin' }, null), { views: [], tabs: [], settings: [] }, 'nothing set: nothing hidden')
assert.ok(V.hasOverride(vis, 'sam@example.com') && !V.hasOverride(vis, 'a@x'))
// Return to default = the entry is gone.
const back = V.normVisibility({ ...vis, users: {} })
assert.deepEqual(V.hiddenFor({ email: 'sam@example.com', role: 'admin' }, back), { views: ['forecast'], tabs: ['saleshub'], settings: [] })
assert.ok(V.isHiddenView({ views: ['forecast'], tabs: [] }, 'forecast') && !V.isHiddenTab({ views: ['forecast'], tabs: [] }, 'forecast'))
assert.equal(V.tabsForRole('account_user').length, 1)
assert.ok(V.viewsForRole('account_admin').every((v) => v.roles.includes('account_admin')))

// The session carries it: an admin signs in after the Super Admin hid Forecaster.
await getStore({ name: 'caalano-settings' }).setJSON('all', { visibility: vis })
await getStore({ name: 'caalano-auth' }).setJSON('user:adm@example.com', { email: 'adm@example.com', role: 'admin', status: 'active', firstName: 'Ad', lastName: 'Min', phone: '+61400000001', termsVersion: 99 })
const { signSession } = await import('../netlify/lib/auth.mjs')
const { default: auth } = await import('../netlify/functions/auth.mjs')
const tok = await signSession({ e: 'adm@example.com', exp: Date.now() + 60000, v: 0 }, 'test-secret')
const me = await auth(new Request('https://x/.netlify/functions/auth?action=me', { headers: { cookie: 'c360_session=' + tok } })).then((r) => r.json())
assert.ok(me.ok && me.user, JSON.stringify(me).slice(0, 200))
assert.deepEqual(me.user.hidden, { views: ['forecast'], tabs: ['saleshub'], settings: [] }, 'me carries hidden')
console.log('visibility_test ok')
