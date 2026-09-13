import assert from 'node:assert/strict'
import { can, RANK, membershipFromLegacy, tabVisible } from '../netlify/lib/entitle.mjs'

const plan = { features: ['pdf', 'monthly_report', 'custom_dashboards'], max_workspaces: 5, max_connections: 20, max_members: 10 }
const org = { subscription_status: 'active' }
const ctx = (role, extra = {}, m = {}) => ({ org, plan, usage: { workspaces: 1, connections: 2, members: 3 }, membership: { role, status: 'active', workspace_ids: null, tabs: null, reports: false, ...m }, ...extra })
const okFor = (role, action, target) => can(ctx(role), action, target).ok

// The role ladder: each action's least role, and nothing below it.
const ladder = [['workspace.read', 'account_user'], ['settings.write', 'admin'], ['connection.create', 'admin'], ['member.invite', 'admin'], ['billing.manage', 'superadmin'], ['org.delete', 'superadmin'], ['insights.ai', 'user']]
for (const [action, least] of ladder) {
  for (const role of Object.keys(RANK)) {
    const want = RANK[role] <= RANK[least]
    const got = can(ctx(role), action, {}).ok
    if (action === 'insights.ai') continue // needs a plan feature, tested below
    assert.equal(got, want, `${role} ${action} -> ${want}`)
  }
}
// Not a member, disabled, past due, deleted.
assert.equal(can({ org, plan }, 'workspace.read').reason, 'not a member')
assert.equal(can(ctx('admin', {}, { status: 'disabled' }), 'workspace.read').reason, 'not a member')
assert.equal(can({ ...ctx('admin'), org: { subscription_status: 'past_due' } }, 'settings.write').reason, 'billing')
assert.ok(can({ ...ctx('admin'), org: { subscription_status: 'past_due' } }, 'workspace.read').ok, 'past due still reads')
assert.equal(can({ ...ctx('superadmin'), org: { deleted_at: '2026-09-01' } }, 'workspace.read').reason, 'deleted')
// Workspaces: a restricted list is enforced, null means all.
assert.ok(can(ctx('user', {}, { workspace_ids: ['w1'] }), 'workspace.read', { workspaceId: 'w1' }).ok)
assert.equal(can(ctx('user', {}, { workspace_ids: ['w1'] }), 'workspace.read', { workspaceId: 'w2' }).reason, 'workspace')
assert.ok(can(ctx('user'), 'workspace.read', { workspaceId: 'w2' }).ok)
// Tabs: an account admin sees ticked tabs only; staff see every tab; an
// account user has Deals & Actions and nothing else; the Sales Hub is managers only.
assert.ok(can(ctx('account_admin', {}, { tabs: ['overall', 'users'] }), 'module.users').ok)
assert.equal(can(ctx('account_admin', {}, { tabs: ['overall'] }), 'module.users').reason, 'tab')
assert.equal(can(ctx('account_admin', {}, { tabs: ['overall', 'saleshub'] }), 'module.saleshub').ok, true, 'an account admin can be given the hub')
assert.equal(can(ctx('account_user', {}, { tabs: ['overall', 'actions'] }), 'module.overall').reason, 'tab')
assert.ok(can(ctx('account_user'), 'module.actions').ok)
assert.equal(can(ctx('account_user', {}, { tabs: ['saleshub'] }), 'module.saleshub').reason, 'tab')
assert.ok(can(ctx('user'), 'module.saleshub').ok)
assert.ok(can(ctx('user'), 'module.anything').ok, 'staff see every tab')
assert.equal(tabVisible({ role: 'viewer', tabs: null }, 'overall'), false, 'a viewer with no tabs sees nothing')
// Deals & Actions writes: an account user only on their own records.
assert.ok(can(ctx('account_user', {}, { crm_user_id: 'u1' }), 'crm.write', { ownerId: 'u1' }).ok)
assert.equal(can(ctx('account_user', {}, { crm_user_id: 'u1' }), 'crm.write', { ownerId: 'u2' }).reason, 'own records')
assert.ok(can(ctx('user'), 'crm.write', { ownerId: 'u2' }).ok, 'staff may update any record')
// Reports: a client-side member needs the reports flag; staff do not.
assert.equal(can(ctx('account_admin', {}, { tabs: ['overall'] }), 'report.pdf').reason, 'reports')
assert.ok(can(ctx('account_admin', {}, { tabs: ['overall'], reports: true }), 'report.pdf').ok)
assert.ok(can(ctx('user'), 'report.pdf').ok)
// Plan features and limits are the two upgrade prompts.
const r1 = can(ctx('admin'), 'insights.ai'); assert.deepEqual([r1.reason, r1.detail], ['plan', 'ai_insights'])
assert.ok(can({ ...ctx('admin'), plan: { ...plan, features: [...plan.features, 'ai_insights'] } }, 'insights.ai').ok)
assert.equal(can(ctx('user'), 'insights.ai').ok, false, 'a client-side user never gets AI insights')
const r2 = can({ ...ctx('admin'), usage: { workspaces: 5 } }, 'workspace.create'); assert.deepEqual([r2.reason, r2.detail], ['limit', 'workspaces'])
assert.ok(can({ ...ctx('admin'), plan: { ...plan, max_workspaces: null }, usage: { workspaces: 500 } }, 'workspace.create').ok, 'null means unlimited')
const r3 = can({ ...ctx('admin'), usage: { members: 10 } }, 'member.invite'); assert.deepEqual([r3.reason, r3.detail], ['limit', 'members'])
// An admin cannot invite or remove at or above their own rank; a superadmin can.
assert.equal(can(ctx('admin'), 'member.invite', { role: 'admin' }).reason, 'role')
assert.ok(can(ctx('admin'), 'member.invite', { role: 'user' }).ok)
assert.ok(can(ctx('superadmin'), 'member.remove', { role: 'superadmin' }).ok, 'the last-superadmin guard is the handler\'s job')
// Platform side: read-only support, admins act only while impersonating, owner-only actions.
const p = (platformRole, extra = {}) => ({ org, plan, platformRole, ...extra })
assert.ok(can(p('saas_user'), 'workspace.read').ok)
assert.equal(can(p('saas_user'), 'settings.write').reason, 'read-only')
assert.equal(can(p('saas_admin'), 'settings.write').reason, 'impersonate first (audited)')
assert.ok(can(p('saas_admin', { impersonating: true, membership: { role: 'admin', status: 'active' } }), 'settings.write').ok)
assert.ok(can(p('saas_admin'), 'org.plan').ok)
assert.equal(can(p('saas_admin'), 'pricing.edit').detail, 'saas_owner')
assert.ok(can(p('saas_owner'), 'pricing.edit').ok)
assert.equal(can(ctx('superadmin'), 'org.plan').reason, 'platform', 'a tenant cannot change plans from inside the app')
// Today's users map onto memberships without renaming anything.
const m1 = membershipFromLegacy({ role: 'user', allClients: false, clients: ['norwest-mdc', 'finr-advisory'] }, (s) => 'ws:' + s)
assert.deepEqual([m1.role, m1.workspace_ids, m1.tabs], ['user', ['ws:norwest-mdc', 'ws:finr-advisory'], null])
const m2 = membershipFromLegacy({ role: 'account_user', clients: ['norwest-mdc'], allClients: false, tabs: ['actions'], crmUserId: 'demoUser02' })
assert.deepEqual([m2.role, m2.tabs, m2.crm_user_id], ['account_user', ['actions'], 'demoUser02'])
assert.equal(membershipFromLegacy({ role: 'viewer', tabs: ['overall'] }).role, 'account_admin', 'an old viewer is an account admin')
assert.equal(membershipFromLegacy({ role: 'admin', disabled: true }).status, 'disabled')
console.log('entitle_test ok')
