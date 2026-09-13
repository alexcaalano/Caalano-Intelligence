// One function decides what a person may do (SAAS-DESIGN.md section 5).
// Every handler calls can(ctx, action, target) and never reasons about roles
// itself. Pure: no I/O, so the same table runs in the browser to hide what the
// server would refuse, while the server check is the one that counts.
//
//   ctx    = { user, org, membership, plan, usage?, platformRole?, impersonating? }
//   action = see ROLE_FOR below, plus 'module.<tab>' for a workspace tab
//   target = { workspaceId?, tab?, section?, role?, ownerId? }
//   ->       { ok: true } | { ok: false, reason, detail? }
//
// reason 'plan' and 'limit' are the two the UI turns into an upgrade prompt.

// Rank: lower is more powerful. account_admin is a viewer with ticked tabs and
// account_user a viewer with only Deals & Actions (section 16); both sit on
// the client side of the organisation.
export const RANK = { superadmin: 0, admin: 1, user: 2, viewer: 3, account_admin: 3, account_user: 4 }
export const CLIENT_ROLES = new Set(['viewer', 'account_admin', 'account_user'])

// The least role an action needs. 'module.*' and anything not listed is
// viewer-level (readable by every active member subject to tabs and
// workspaces); MANAGER_MODULES need agency staff.
export const ROLE_FOR = {
  'workspace.read': 'account_user', 'workspace.write': 'admin', 'workspace.create': 'admin', 'workspace.delete': 'admin',
  'settings.read': 'viewer', 'settings.write': 'admin',
  'connection.create': 'admin', 'connection.delete': 'admin',
  'member.invite': 'admin', 'member.remove': 'admin', 'member.read': 'user',
  'billing.manage': 'superadmin', 'org.delete': 'superadmin', 'ownership.transfer': 'superadmin',
  'report.pdf': 'viewer', 'insights.ai': 'user', 'dashboard.custom': 'viewer', 'dashboard.edit': 'admin',
  'crm.write': 'account_user',
}
// Modules (workspace tabs) that only agency staff and account admins see, as
// VIEWER_REQ_TABS does today: the Sales Hub is for managers.
export const MANAGER_MODULES = new Set(['saleshub'])
// The one module an Account User has.
export const ACCOUNT_USER_MODULES = new Set(['actions'])
// Plan features an action needs (plans.features).
export const FEATURE_FOR = { 'report.pdf': 'pdf', 'insights.ai': 'ai_insights', 'dashboard.custom': 'custom_dashboards', 'dashboard.edit': 'custom_dashboards' }
// Actions a past-due organisation may still do: reading, nothing else.
const isRead = (a) => a.endsWith('.read') || a.startsWith('module.') || a === 'dashboard.custom' || a === 'report.pdf'
// Platform (SaaS) side.
export const PLATFORM_ONLY = new Set(['org.suspend', 'org.plan', 'platform.roles', 'pricing.edit', 'platform.read'])
export const OWNER_ONLY = new Set(['platform.roles', 'pricing.edit', 'org.delete'])

const ok = () => ({ ok: true })
const deny = (reason, detail) => (detail ? { ok: false, reason, detail } : { ok: false, reason })

export const workspaceVisible = (m, wid) => !m.workspace_ids || m.workspace_ids.includes(wid)
export const tabVisible = (m, tab) => {
  if (m.role === 'account_user') return ACCOUNT_USER_MODULES.has(tab)
  if (!CLIENT_ROLES.has(m.role)) return !m.tabs || m.tabs.includes(tab)
  return Array.isArray(m.tabs) && m.tabs.includes(tab)
}

export function can(ctx, action, target = {}) {
  if (!action) return deny('action')
  if (ctx.platformRole) {
    if (ctx.platformRole === 'saas_user') return isRead(action) || action === 'platform.read' ? ok() : deny('read-only')
    if (PLATFORM_ONLY.has(action) || OWNER_ONLY.has(action)) {
      if (ctx.platformRole === 'saas_owner') return ok()
      return OWNER_ONLY.has(action) ? deny('role', 'saas_owner') : ok()
    }
    if (!ctx.impersonating) return isRead(action) ? ok() : deny('impersonate first (audited)')
    // impersonating: fall through and act as the tenant member they hold
  }
  if (PLATFORM_ONLY.has(action)) return deny('platform')
  const m = ctx.membership
  if (!m || m.status !== 'active') return deny('not a member')
  const org = ctx.org || {}
  if (org.deleted_at) return deny('deleted')
  if ((org.subscription_status === 'past_due' || org.subscription_status === 'canceled') && !isRead(action)) return deny('billing')
  const role = m.role
  if (!(role in RANK)) return deny('role')
  if (target.workspaceId && !workspaceVisible(m, target.workspaceId)) return deny('workspace')
  if (action.startsWith('module.')) {
    const tab = action.slice(7)
    if (MANAGER_MODULES.has(tab) && (role === 'viewer' || role === 'account_user')) return deny('tab')
    if (CLIENT_ROLES.has(role) && !tabVisible(m, tab)) return deny('tab')
    return ok()
  }
  if (target.tab && CLIENT_ROLES.has(role) && !tabVisible(m, target.tab)) return deny('tab')
  const need = ROLE_FOR[action] || 'viewer'
  if (RANK[role] > RANK[need]) return deny('role', need)
  if (action === 'report.pdf' && CLIENT_ROLES.has(role) && !m.reports) return deny('reports')
  if (action === 'crm.write' && role === 'account_user' && target.ownerId && target.ownerId !== m.crm_user_id) return deny('own records')
  if ((action === 'member.invite' || action === 'member.remove') && target.role && RANK[target.role] <= RANK[role] && role !== 'superadmin') return deny('role', target.role)
  const feature = FEATURE_FOR[action]
  const plan = ctx.plan || { features: [] }
  if (feature && !(plan.features || []).includes(feature)) return deny('plan', feature)
  const usage = ctx.usage || {}
  if (action === 'workspace.create' && plan.max_workspaces != null && (usage.workspaces || 0) >= plan.max_workspaces) return deny('limit', 'workspaces')
  if (action === 'connection.create' && plan.max_connections != null && (usage.connections || 0) >= plan.max_connections) return deny('limit', 'connections')
  if (action === 'member.invite' && plan.max_members != null && (usage.members || 0) >= plan.max_members) return deny('limit', 'members')
  return ok()
}

// Today's auth.mjs user record as a membership, so the existing roles map
// onto the new table without touching the user list: role names are the
// same; allClients=false + clients[] becomes workspace_ids; a client-side
// user's tabs and reports carry over; the CRM user link becomes crm_user_id.
export function membershipFromLegacy(user, workspaceIdOf = (slug) => slug) {
  if (!user) return null
  const role = user.role === 'viewer' ? 'account_admin' : user.role
  const restricted = user.allClients === false || (Array.isArray(user.clients) && user.clients.length && !user.allClients)
  return {
    role, status: user.disabled ? 'disabled' : 'active',
    workspace_ids: restricted ? (user.clients || []).map(workspaceIdOf) : null,
    tabs: CLIENT_ROLES.has(role) ? (Array.isArray(user.tabs) ? user.tabs : []) : null,
    reports: !!user.reports, crm_user_id: user.crmUserId || user.crm_user_id || null,
  }
}
