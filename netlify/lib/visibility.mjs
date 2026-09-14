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
  { id: 'monthly', label: 'Reporting', roles: ['superadmin', 'admin', 'user'] },
  // Reporting's tabs; the sidebar entry stays while either is on.
  { id: 'reporting_monthly', label: 'Reporting · Monthly Report', roles: ['superadmin', 'admin', 'user'] },
  { id: 'reporting_trend', label: 'Reporting · Trend Report', roles: ['superadmin', 'admin', 'user'] },
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
// Settings tabs. Only the agency-level ones: My Profile (My Account,
// Appearance) is for everyone, and the Super Admin pages (Visibility, Terms of
// Use, Logs) stay outside the list - Visibility is the way back. Settings is
// grouped into sections with tabs; `sec` names the section a tab sits in, and
// a section shows only while at least one of its tabs is on, so hiding every
// tab hides the section.
const AGENCY_ADMINS = ['superadmin', 'admin']
export const VIS_SETTINGS = [
  { id: 'clients', label: 'Clients', roles: AGENCY_ADMINS },
  { id: 'crm', label: 'CRM', sec: 'Integrations', roles: AGENCY_ADMINS },
  { id: 'meta', label: 'Meta', sec: 'Integrations', roles: AGENCY_ADMINS },
  { id: 'google', label: 'Google', sec: 'Integrations', roles: AGENCY_ADMINS },
  { id: 'dailyperf', label: 'Daily Performance', sec: 'Performance & KPIs', roles: AGENCY_ADMINS },
  { id: 'fatigue', label: 'Creative Fatigue', sec: 'Performance & KPIs', roles: AGENCY_ADMINS },
  { id: 'socialkpis', label: 'Organic KPIs', sec: 'Performance & KPIs', roles: AGENCY_ADMINS },
  { id: 'team', label: 'Access', sec: 'Access', roles: AGENCY_ADMINS },
]
// "Integrations · CRM" - the tab with its section, for the Visibility chart.
export const visSettingLabel = (t) => (t.sec && t.sec !== t.label ? `${t.sec} · ${t.label}` : t.label)
export const VIS_ROLES = ['superadmin', 'admin', 'user', 'account_admin', 'account_user']
export const VIS_ROLE_LABELS = { superadmin: 'Super Admin', admin: 'Agency Admin', user: 'Agency User', account_admin: 'Account Admin', account_user: 'Account User' }
const normRole = (r) => (r === 'viewer' ? 'account_admin' : r)
export const viewsForRole = (role) => VIS_VIEWS.filter((v) => v.roles.includes(normRole(role)))
export const tabsForRole = (role) => (normRole(role) === 'account_user' ? VIS_TABS.filter((t) => t.id === 'actions') : VIS_TABS)
export const settingsForRole = (role) => VIS_SETTINGS.filter((v) => v.roles.includes(normRole(role)))

const offMap = (m) => { const o = {}; for (const k in (m || {})) if (m[k] === false) o[k] = false; return o }
// What a role gets before a Super Admin has ever touched its column: an
// Account Admin starts without Sales Hub (the manager view), as the old tab
// ticks defaulted. Applies only while the role has no stored entry at all -
// once saved, the stored entry (even an empty one) is the whole truth.
export const DEFAULT_ROLE_OFF = { account_admin: { tabs: { saleshub: false } } }
const normEntry = (e) => ({ views: offMap(e && e.views), tabs: offMap(e && e.tabs), settings: offMap(e && e.settings) })
// A tidy copy of the section: only known roles, only "off" entries, users keyed
// by lower-cased email.
export function normVisibility(v) {
  const roles = {}, users = {}
  for (const r of VIS_ROLES) roles[r] = normEntry(v && v.roles && (r in v.roles) ? v.roles[r] : DEFAULT_ROLE_OFF[r])
  for (const [email, e] of Object.entries((v && v.users) || {})) { const k = String(email || '').trim().toLowerCase(); if (k && e && typeof e === 'object') users[k] = normEntry(e) }
  return { roles, users }
}
export const hasOverride = (v, email) => !!normVisibility(v).users[String(email || '').trim().toLowerCase()]
// Team & access used to carry a per-person list of ticked tabs for Account
// Admins. Until that person is saved in Visibility (which clears the ticks),
// the ticks still decide their tabs, so nobody gains or loses a tab on the day
// the switches moved.
export const hasLegacyTicks = (user, v) => !!(user && normRole(user.role) === 'account_admin' && Array.isArray(user.tabs) && !hasOverride(v, user.email))
// The entry that applies to a person: their own override if one exists, else
// their old tab ticks (tabs only, the role default for the rest), else their
// role's default.
export function entryFor(user, v) {
  if (!user || !user.role) return null
  const vis = normVisibility(v)
  const own = vis.users[String(user.email || '').trim().toLowerCase()]
  if (own) return own
  const role = vis.roles[normRole(user.role)] || { views: {}, tabs: {}, settings: {} }
  if (hasLegacyTicks(user, v)) { const tabs = {}; for (const t of tabsForRole(user.role)) if (!user.tabs.includes(t.id)) tabs[t.id] = false; return { ...role, tabs } }
  return role
}
// The client-workspace tabs a person may open, as ids - what the server checks
// every read against for Account roles.
export function effectiveTabs(user, v) {
  const hidden = new Set(hiddenFor(user, v).tabs)
  return tabsForRole(user ? user.role : null).map((t) => t.id).filter((id) => !hidden.has(id))
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
