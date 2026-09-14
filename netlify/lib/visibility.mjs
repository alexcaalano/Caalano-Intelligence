// Who sees what. A Super Admin can hide sidebar views and client-workspace tabs
// per role (the default everyone of that role gets) and override that for one
// person. Only what is switched OFF is stored, so a new view or tab is visible
// to everyone until it is deliberately hidden - and hiding it is how a feature
// stays out of sight until it is ready to launch. Super Admins see everything,
// always; the View-as control is how they check what others get.
//
// Shape of the settings section (`visibility`):
//   { roles: { admin: { views: { forecast: false }, tabs: { saleshub: false } }, user: {...}, account_admin: {...}, account_user: {...} },
//     users: { 'person@example.com': { views: {...}, tabs: {...} } } }
// A user entry REPLACES the role default for that person (it is a full
// statement of what is off for them); deleting it returns them to the default.

// Sidebar views. Agency roles get the agency views; client roles get the two
// things their sidebar can hold - published reports and their client
// workspaces. Settings is never hidden.
export const VIS_VIEWS = [
  { id: 'overview', label: 'Agency Overview', roles: ['superadmin', 'admin', 'user'] },
  { id: 'trends', label: 'Daily Performance', roles: ['superadmin', 'admin', 'user'] },
  { id: 'weekly', label: 'Weekly Traffic Light', roles: ['superadmin', 'admin', 'user'] },
  { id: 'forecast', label: 'Funnel Forecaster', roles: ['superadmin', 'admin', 'user'] },
  { id: 'cockpit', label: 'Creative Cockpit', roles: ['superadmin', 'admin', 'user'] },
  { id: 'insights', label: 'Meta Insights', roles: ['superadmin', 'admin', 'user'] },
  { id: 'update', label: 'Client Update', roles: ['superadmin', 'admin', 'user'] },
  { id: 'monthly', label: 'Monthly Report', roles: ['superadmin', 'admin', 'user'] },
  { id: 'social', label: 'Organic Social Media', roles: ['superadmin', 'admin', 'user'] },
  { id: 'reports', label: 'Monthly Reports', roles: ['account_admin', 'account_user'] },
  { id: 'dashboards', label: 'Client workspaces (My dashboards)', roles: ['account_admin', 'account_user'] },
]
// Client-workspace tabs. An Account User holds Deals & Actions and nothing
// else by design, so the only tab that can be hidden from them is that one.
export const VIS_TABS = [
  { id: 'overall', label: 'Caalano360' },
  { id: 'custom', label: 'Custom dashboard' },
  { id: 'clinic', label: 'Clinic' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'google', label: 'Google Ads' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'saleshub', label: 'Sales Hub' },
  { id: 'actions', label: 'Deals & Actions' },
  { id: 'cohorts', label: 'Cohorts' },
  { id: 'users', label: 'Users' },
  { id: 'calls', label: 'Call Reporting' },
  { id: 'forms', label: 'Forms' },
  { id: 'location', label: 'Location' },
  { id: 'appts', label: 'Appointments' },
  { id: 'calperf', label: 'Calendars' },
  { id: 'timing', label: 'Timing' },
  { id: 'lostreasons', label: 'Lost Reasons' },
  { id: 'optlog', label: 'Change Log' },
]
// Settings sections. Only the agency-level ones: Your account and Appearance
// are for everyone, and the three Super Admin sections (Visibility, Terms of
// use, Logs) stay outside the list - Visibility is the way back.
export const VIS_SETTINGS = [
  { id: 'clients', label: 'Clients', roles: ['superadmin', 'admin'] },
  { id: 'crm', label: 'CRM connection', roles: ['superadmin', 'admin'] },
  { id: 'fatigue', label: 'Creative fatigue', roles: ['superadmin', 'admin'] },
  { id: 'socialkpis', label: 'Organic KPIs', roles: ['superadmin', 'admin'] },
  { id: 'dailyperf', label: 'Daily performance', roles: ['superadmin', 'admin'] },
  { id: 'team', label: 'Team & access', roles: ['superadmin', 'admin'] },
]
export const VIS_ROLES = ['superadmin', 'admin', 'user', 'account_admin', 'account_user']
export const VIS_ROLE_LABELS = { superadmin: 'Super Admin', admin: 'Agency Admin', user: 'Agency User', account_admin: 'Account Admin', account_user: 'Account User' }
const normRole = (r) => (r === 'viewer' ? 'account_admin' : r)
export const viewsForRole = (role) => VIS_VIEWS.filter((v) => v.roles.includes(normRole(role)))
export const tabsForRole = (role) => (normRole(role) === 'account_user' ? VIS_TABS.filter((t) => t.id === 'actions') : VIS_TABS)
export const settingsForRole = (role) => VIS_SETTINGS.filter((v) => v.roles.includes(normRole(role)))

const offMap = (m) => { const o = {}; for (const k in (m || {})) if (m[k] === false) o[k] = false; return o }
const normEntry = (e) => ({ views: offMap(e && e.views), tabs: offMap(e && e.tabs), settings: offMap(e && e.settings) })
// A tidy copy of the section: only known roles, only "off" entries, users keyed
// by lower-cased email.
export function normVisibility(v) {
  const roles = {}, users = {}
  for (const r of VIS_ROLES) roles[r] = normEntry(v && v.roles && v.roles[r])
  for (const [email, e] of Object.entries((v && v.users) || {})) { const k = String(email || '').trim().toLowerCase(); if (k && e && typeof e === 'object') users[k] = normEntry(e) }
  return { roles, users }
}
export const hasOverride = (v, email) => !!normVisibility(v).users[String(email || '').trim().toLowerCase()]
// The entry that applies to a person: their own override if one exists, else
// their role's default.
export function entryFor(user, v) {
  if (!user || !user.role) return null
  const vis = normVisibility(v)
  const own = vis.users[String(user.email || '').trim().toLowerCase()]
  return own || vis.roles[normRole(user.role)] || null
}
// What is hidden from this person: { views: [ids], tabs: [ids], settings: [ids] }.
// Only ids that can apply to their role count, so a stale entry cannot hide
// anything odd.
export function hiddenFor(user, v) {
  const e = entryFor(user, v)
  if (!e) return { views: [], tabs: [], settings: [] }
  const okViews = new Set(viewsForRole(user.role).map((x) => x.id)), okTabs = new Set(tabsForRole(user.role).map((x) => x.id)), okSettings = new Set(settingsForRole(user.role).map((x) => x.id))
  return {
    views: Object.keys(e.views).filter((id) => okViews.has(id)),
    tabs: Object.keys(e.tabs).filter((id) => okTabs.has(id)),
    settings: Object.keys(e.settings || {}).filter((id) => okSettings.has(id)),
  }
}
export const isHiddenView = (hidden, id) => !!(hidden && Array.isArray(hidden.views) && hidden.views.includes(id))
export const isHiddenTab = (hidden, id) => !!(hidden && Array.isArray(hidden.tabs) && hidden.tabs.includes(id))
export const isHiddenSetting = (hidden, id) => !!(hidden && Array.isArray(hidden.settings) && hidden.settings.includes(id))
