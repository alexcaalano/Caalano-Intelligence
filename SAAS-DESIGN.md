# Caalano360 as a product - tenancy and connection design (not yet built)

Drafted 2026-09-12 for Alex to review before any SaaS code is written. It
turns the recommendations agreed in the SaaS conversation (organisation
tenancy, Postgres, direct provider connections, worker + queue, Stripe) into
the concrete shapes the code will be built from: the database schema, the
roles and the entitlement rule, the adapter interface every connector sits
behind, the sync model, the security model, and the migration path from what
runs today. Nothing here is implemented. `BACKUP.md` steps 1 to 4 were the
precondition and are done.

Reminder carried from the earlier conversation: **a data processing
agreement (DPA) and a public privacy policy are required before any outside
organisation connects an account.** See section 11.

---

## 1. What the product has to do

Today Caalano360 is a single-agency dashboard: one set of settings, one
user list, one Windsor key that reaches every client's Meta, Google, GA4 and
Caalano Systems (GoHighLevel) account, and Netlify Blobs as the only storage.
"Client" is a key in `SETTINGS.clients` with `{ meta, google, ghl, ga4,
name }`.

As a product it has to let:

- an **agency** sign up, create workspaces for each of its clients, connect
  its own ad accounts / CRM locations to each workspace, and invite its
  staff and its clients' staff with different levels of access;
- a **single business** sign up, get exactly one workspace, and connect its
  own accounts to it;
- **Caalano Digital** keep running as the first organisation, with every
  existing client, user, setting, snapshot and log carried across
  unchanged;
- a platform operator (Alex) see every organisation, its plan, its usage and
  its connection health, without being a member of it;
- billing meter the things that cost money to serve: workspaces,
  connections, and how often data is refreshed.

The reporting code (the `windsor.mjs` handlers, `ghl.mjs`, the React app)
is kept. What changes is *where it gets its inputs*: which accounts to read,
which credentials to read them with, which settings apply, and who is
allowed to look.

## 2. Decisions this document fixes

| Topic | Decision |
|---|---|
| Tenant unit | **Organisation**. `kind` is `agency` or `business`. A business is an organisation limited to one workspace. |
| Reporting unit | **Workspace** = today's "client". Every setting section, snapshot, connection and log row hangs off a workspace or an organisation. |
| Identity | One `users` table, global. A person can belong to several organisations with a different role in each. Email + password or magic link, **plus Sign in with Google** (agreed 2026-09-12: the same Google OAuth client used for Google Ads; the sign-in scopes are non-sensitive so they need no verification wait). The current `AUTH_SECRET` session cookie stays. |
| Database | Postgres (Supabase or Neon, Sydney region) with row level security keyed on the organisation. Netlify Blobs kept only for caches that can be rebuilt. |
| Credentials | Never stored in plain text. AES-256-GCM per connection, key encryption key in the environment, wrapped data key per row (section 8). |
| Data path | Provider adapters that call Meta, Google Ads, GA4 and GoHighLevel directly and return the same row shape `windsorFetch` returns today. Windsor stays as a third adapter for Caalano Digital's own workspaces during migration. |
| Background work | A worker (Railway or Fly, Sydney) pulling from a queue with per-organisation concurrency limits. Netlify Functions keep serving the UI and the short reads. |
| Billing | Stripe. Plan and entitlement live in our database; Stripe is the source of truth for whether the subscription is paid. |
| Hosting | GitHub + Netlify stay for the frontend and functions. Not Firebase. AWS deferred until a concrete need appears. |
| Pricing model (agreed 2026-09-12) | **Per workspace**, one rate (working figure US$97 a month), with volume steps for agencies. Two sign-up kinds: business (one or several workspaces, no agency panel) and agency (adds the agency overview and performance management). |
| White label | Not at launch. Schema leaves room (an `org_branding` row per organisation: logo, colours, custom domain) so it can be switched on later without a migration. |
| First outside tenant | **Finr Advisory** (agreed 2026-09-12). DPA and privacy policy must be live first (section 11). |
| Database host | **Neon** (agreed 2026-09-12). See section 13 for why, and why the database choice does not change function timeouts. |

## 3. Tenancy model

```
platform_admins           (Alex, and later support staff)
  |
organisation  --------< membership >-------- user
  | kind: agency|business, plan, stripe ids       | email, name, auth
  |
  +--< workspace  (= client)   --< connection (meta|google_ads|ga4|ghl)
  |     settings sections           --< sync_job
  |     snapshots, monthly, social  --< snapshot / cache rows
  |     audit + diag rows
  +--< invitation
  +--< audit_log
```

Rules that shape everything else:

1. A **workspace belongs to exactly one organisation**. An account (ad
   account, GA4 property, GHL location) can be connected to more than one
   workspace but each connection row is owned by one workspace.
2. A **business organisation has at most one workspace**, created at
   signup. Upgrading to an agency plan lifts the limit; nothing else changes.
3. **Every settings section is per workspace or per organisation.** Today's
   30 sections (`keyevents`, `kpis`, `campmap`, `enabled`, `restricted`,
   `insights`, `clients`, `formmeta`, `metaconv`, `health`, `creativemeta`,
   `creativetax`, `clientctx`, `fatigue`, `competitors`, `socialkpis`,
   `optlog`, `qualstage`, `aliases`, `logos`, `curator`, `profile`,
   `dailyperf`, `adnames`, `pdfdl`, `clinic`, `geo`, `forecasts`, `ui`,
   `dashboards`) are already keyed by client id inside each section, so the
   split is mechanical: the client-keyed part becomes a workspace row, the
   rest (for example `ui`, `profile`, `dashboards` at agency level) becomes
   an organisation row. `clients` itself becomes the `workspaces` and
   `connections` tables.
4. **Roles are per membership**, so the same person can be an owner of
   their own business organisation and a viewer in an agency's.
5. **Viewers are scoped to workspaces**, as `user.clients` and `user.tabs`
   are today. Members and above see every workspace in the organisation.
6. Nothing is ever deleted immediately. Organisations, workspaces and
   connections get `deleted_at`; a nightly job purges rows older than 30
   days and revokes tokens at the provider first.

## 4. Database schema

Postgres. Every tenant table carries `org_id` so one RLS policy pattern
covers all of them. Ids are `uuid` except where a provider's id is the
natural key. `jsonb` is used deliberately where the app already treats the
value as an opaque object (settings sections, snapshots), so the reporting
code does not need to change on day one.

```sql
-- identity ---------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  name          text not null default '',
  password_hash text,                       -- null when magic-link or Google only
  google_sub    text unique,                -- Google account id once they have signed in with Google
  terms_version text, terms_accepted_at timestamptz,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create type platform_role as enum ('saas_owner', 'saas_admin', 'saas_user');
create table platform_roles (                -- the SaaS side; nobody here is a tenant member by default
  user_id uuid primary key references users(id),
  role    platform_role not null,
  granted_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- tenancy ----------------------------------------------------------------
create type org_kind as enum ('agency', 'business');
create type org_role as enum ('superadmin', 'admin', 'user', 'viewer'); -- same names the app uses today

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,       -- 'caalano', used in URLs
  name          text not null,
  kind          org_kind not null,
  timezone      text not null default 'Australia/Sydney',
  currency      text not null default 'AUD',
  plan_id       text not null references plans(id),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  subscription_status    text not null default 'trialing', -- mirrors Stripe
  trial_ends_at  timestamptz,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table memberships (
  org_id     uuid not null references organisations(id),
  user_id    uuid not null references users(id),
  role       org_role not null,
  status     text not null default 'active',      -- active | pending | disabled
  workspace_ids uuid[] ,                          -- viewers and restricted users; null = all
  tabs       text[],                              -- viewers only; today's user.tabs
  reports    boolean not null default false,      -- today's viewer.reports
  invited_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invitations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id),
  email      citext not null,
  role       org_role not null,
  workspace_ids uuid[], tabs text[],
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references users(id)
);

-- workspaces (today's clients) ------------------------------------------
create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id),
  slug       text not null,                -- today's client key, e.g. 'norwest-mdc'
  name       text not null,
  timezone   text, currency text,          -- override the org default
  demo       boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, slug)
);

-- provider connections ---------------------------------------------------
create type provider as enum ('meta', 'google_ads', 'ga4', 'ghl', 'windsor');

create table connections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  provider     provider not null,
  external_id  text not null,             -- act_123 | 123-456-7890 | GA4 property id | GHL locationId
  external_name text,
  scopes       text[] not null default '{}',
  status       text not null default 'ok', -- ok | needs_reauth | revoked | error
  status_detail text,
  connected_by uuid references users(id),
  -- credential, encrypted (section 8); null for provider = windsor
  cred_ciphertext bytea, cred_iv bytea, cred_tag bytea, cred_wrapped_key bytea, cred_kek_id text,
  cred_expires_at timestamptz,            -- Meta 60-day token, Google refresh token n/a, GHL access token 24h
  last_ok_at    timestamptz, last_error_at timestamptz, last_error text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (workspace_id, provider, external_id)
);

-- settings ---------------------------------------------------------------
create table workspace_settings (
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  section      text not null,             -- one of today's SECTIONS
  value        jsonb not null default '{}',
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, section)
);

create table org_settings (                -- org-wide parts: ui, profile, dashboards, aliases...
  org_id     uuid not null references organisations(id),
  section    text not null,
  value      jsonb not null default '{}',
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, section)
);

-- data -------------------------------------------------------------------
create table snapshots (                   -- opp snapshot, appointments snapshot, pipecache, cfcache, warm
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  kind         text not null,             -- 'opps' | 'appts' | 'pipe' | 'customfields' | 'warm:<preset>'
  key          text not null default '',
  value        jsonb not null,
  built_at     timestamptz not null default now(),
  expires_at   timestamptz,
  primary key (workspace_id, kind, key)
);

create table monthly_reports (             -- today's caalano-monthly, keyed meta:<client>/<month>
  org_id uuid not null, workspace_id uuid not null references workspaces(id),
  month  text not null,                   -- '2026-08'
  value  jsonb not null, published_at timestamptz, saved_at timestamptz not null default now(),
  primary key (workspace_id, month)
);

create table social_cache (                -- today's caalano-social
  org_id uuid not null, workspace_id uuid not null references workspaces(id),
  key text not null, value jsonb not null, built_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table sync_jobs (
  id            bigserial primary key,
  org_id        uuid not null references organisations(id),
  workspace_id  uuid references workspaces(id),
  connection_id uuid references connections(id),
  kind          text not null,            -- 'warm' | 'snapshot:opps' | 'snapshot:appts' | 'speedscan' | 'monthly' | 'health'
  args          jsonb not null default '{}',
  status        text not null default 'queued', -- queued | running | done | failed
  attempts      int not null default 0,
  run_after     timestamptz not null default now(),
  started_at    timestamptz, finished_at timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);
create index on sync_jobs (status, run_after) where status in ('queued','failed');
create index on sync_jobs (org_id, status);

-- logs -------------------------------------------------------------------
create table audit_log (                   -- today's caalano-audit
  id bigserial primary key,
  org_id uuid not null, workspace_id uuid, user_id uuid,
  action text not null, detail jsonb, ip inet, at timestamptz not null default now()
);
create index on audit_log (org_id, at desc);

create table diag_log (                    -- today's caalano-diag (reliability rows with q, ghlBy)
  id bigserial primary key,
  org_id uuid not null, workspace_id uuid,
  route text, q text, ms int, status int, upstream jsonb, at timestamptz not null default now()
);
create index on diag_log (org_id, at desc);

-- billing ----------------------------------------------------------------
create table plans (
  id              text primary key,        -- 'business' | 'agency_starter' | 'agency_growth' | 'agency_scale'
  name            text not null,
  kind            org_kind not null,
  max_workspaces  int,                     -- null = unlimited
  max_connections int,                     -- per organisation
  max_members     int,
  refresh_minutes int not null,            -- fastest allowed warm cadence
  history_months  int not null,            -- how far back reads may go
  features        text[] not null default '{}', -- 'ai_insights','pdf','monthly_report','custom_dashboards','white_label','api'
  stripe_price_id text,
  monthly_aud     numeric(10,2)
);

create table usage_daily (                 -- metered counters, rolled up nightly
  org_id uuid not null references organisations(id),
  day    date not null,
  workspaces int, connections int, members int,
  api_calls int, worker_seconds int, ai_tokens int,
  primary key (org_id, day)
);
```

**Row level security.** Every tenant table has the same two policies:

```sql
alter table workspaces enable row level security;
create policy tenant_isolation on workspaces
  using (org_id = current_setting('app.org_id', true)::uuid);
create policy platform_admin on workspaces
  using (current_setting('app.platform_admin', true) = 'true');
```

The functions open a transaction, `set local app.org_id = '<uuid>'` from the
verified session, then run the query. A function that forgets to set it
gets zero rows, not everyone's rows. The worker connects as a separate role
that is allowed to set `app.org_id` per job.

## 5. Roles and permissions

Two ladders, agreed 2026-09-12, modelled on how GoHighLevel separates the
SaaS side from the agency side. Platform roles live in `platform_roles`;
organisation roles live on each `membership`. A person can hold one of each.

**Platform (SaaS) side**

| Role | Who | Can |
|---|---|---|
| `saas_owner` | Alex | Everything below, plus: grant and revoke platform roles, change plan definitions and prices, delete organisations, see revenue. Cannot be removed by anyone else; at least one must exist. |
| `saas_admin` | The SaaS operations team | See every organisation, workspace, connection health and usage; impersonate a tenant user with an audit row on entry and exit; change an organisation's plan; suspend or reinstate; resend invites; run a backup or a re-sync. No pricing changes, no deletions. |
| `saas_user` | Support and sales staff | Read-only across organisations: status, plan, usage, connection health, recent errors. No impersonation, no changes. |

Platform roles never touch tenant data through the normal app screens; they
use a separate platform console (`/platform`) and are not members of any
organisation unless explicitly invited, so Caalano Digital's own agency
organisation is administered through the same membership roles as any tenant.

**Organisation (agency or business) side** - the names the app uses today,
unchanged, so nothing in the current user list needs remapping:

| Role | Who | Can |
|---|---|---|
| `superadmin` | The person who signed up, at least one per organisation | Everything `admin` can, plus billing, plan changes, delete the organisation, transfer ownership. Last-superadmin guard, as today. |
| `admin` | Agency leads | Manage workspaces, connections, settings, invite and remove members below superadmin. |
| `user` | Agency staff, the client's marketing manager | See the workspaces they are allowed (all by default, or a restricted list as today's `allClients=false`), edit workspace settings the plan allows, run reports. No billing, no member management, no connections. |
| `viewer` | A client's staff, a stakeholder | Read only, limited to `workspace_ids` and `tabs`, `reports` flag for the monthly reports. |

Custom dashboard audiences (`super`, `admin`, `user`, `viewer`) and
`dashVisibleTo(role, d)` keep working unchanged.

**One function decides.** Every handler calls one thing and never reasons
about roles itself:

```js
// netlify/lib/entitle.mjs
// can(ctx, action, target) -> { ok: true } | { ok: false, reason }
//   ctx    = { user, org, membership, plan, platformRole?, impersonating? }
//   action = 'workspace.read' | 'workspace.write' | 'workspace.create'
//          | 'connection.create' | 'connection.delete' | 'settings.write'
//          | 'member.invite' | 'member.remove' | 'billing.manage'
//          | 'report.pdf' | 'insights.ai' | 'dashboard.custom' | 'module.<name>'
//          | platform: 'org.suspend' | 'org.plan' | 'org.delete' | 'platform.roles' | 'pricing.edit'
//   target = { workspaceId?, section?, tab?, feature? }
export function can(ctx, action, target = {}) {
  if (ctx.platformRole) {                     // SaaS side, acting on a tenant
    if (ctx.platformRole === 'saas_user') return action.endsWith('.read') ? ok() : deny('read-only')
    if (PLATFORM_ONLY.has(action)) return ctx.platformRole === 'saas_owner' || (ctx.platformRole === 'saas_admin' && !OWNER_ONLY.has(action)) ? ok() : deny('role')
    if (!ctx.impersonating) return action.endsWith('.read') ? ok() : deny('impersonate first (audited)')
  }
  if (!ctx.membership || ctx.membership.status !== 'active') return deny('not a member')
  if (ctx.org.subscription_status === 'past_due' && !READ_ACTIONS.has(action)) return deny('billing')
  const role = ctx.membership.role
  if (target.workspaceId && !workspaceVisible(ctx.membership, target.workspaceId)) return deny('workspace')
  if (target.tab && role === 'viewer' && !tabVisible(ctx.membership, target.tab)) return deny('tab')
  const need = ROLE_FOR[action]              // e.g. 'connection.create' -> 'admin'
  if (RANK[role] > RANK[need]) return deny('role')
  const feature = FEATURE_FOR[action]        // e.g. 'insights.ai' -> 'ai_insights'
  if (feature && !ctx.plan.features.includes(feature)) return deny('plan', feature)
  if (action === 'workspace.create' && ctx.plan.max_workspaces != null && ctx.usage.workspaces >= ctx.plan.max_workspaces) return deny('limit', 'workspaces')
  if (action === 'connection.create' && ctx.plan.max_connections != null && ctx.usage.connections >= ctx.plan.max_connections) return deny('limit', 'connections')
  return ok()
}
```

`deny('plan', feature)` and `deny('limit', ...)` are the two reasons the UI
turns into an upgrade prompt instead of an error. The frontend gets the
same table (`ROLE_FOR`, `FEATURE_FOR`, the plan) in the session payload so
it can hide what the server would refuse, but the server check is the one
that counts.

## 6. Plans and metering

Agreed 2026-09-12: pricing is **per workspace**, not per tier. The working
figure is US$97 per workspace per month; the final number and the volume
steps are still to be set (section 13 has the market comparison). What the
plan rows encode:

| Plan | Kind | Workspaces | Agency panel | Refresh | History | Features |
|---|---|---|---|---|---|---|
| Business | business | 1 or more, each billed | no | 15 min | 25 months | monthly_report, pdf, custom_dashboards, ai_insights |
| Agency | agency | 1 or more, each billed, volume steps | yes | 15 min | 25 months | + agency_overview, performance_management |
| Caalano (internal) | agency | unlimited | yes | 5 min | unlimited | everything, windsor_bridge |

Volume steps for agencies (to confirm): full rate for workspaces 1 to 10, a
lower rate for 11 to 25, lower again above 25. White label is not offered at
launch and is left as a future feature flag (`white_label`).

The schema fixes that limits and features are **rows in `plans`**, not
constants in code, so a custom deal is a new row. Stripe webhooks
(`customer.subscription.updated`, `invoice.payment_failed`) update
`organisations.subscription_status` and `plan_id`; Stripe's per-seat quantity
is the workspace count, updated when a workspace is created or deleted. The
worker refuses to schedule warm jobs faster than `plan.refresh_minutes`.
`usage_daily` is filled nightly so the billing page and the platform admin
view have real numbers, and because billing is per workspace an agency can
see exactly what each client costs and on-charge it.

Caalano Digital's own organisation is on the internal `caalano` plan row with
no limits and no Stripe subscription.

## 7. Connections and provider adapters

### 7.1 The adapter interface

Every provider implements the same five functions. The fetch signature is
deliberately identical to today's `windsorFetch(connector, fields, from,
to, preset, key, opts)` minus the key, and returns the same flat rows
(`account_id`, `date`, `campaign`, `spend`, ...) so `windsor.mjs` and
`ghl.mjs` keep their field lists and aggregation code.

```js
// netlify/lib/providers/<provider>.mjs
export default {
  provider: 'meta',
  // OAuth: build the redirect, then exchange the callback for a credential.
  authUrl({ orgId, workspaceId, returnTo }) -> string,
  exchange({ code, state }) -> { credential, expiresAt, scopes, identity },
  // What could be connected with this credential (ad accounts, properties, locations).
  listAccounts(credential) -> [{ externalId, name, currency, timezone }],
  // The one the reporting code calls. Same rows Windsor returns for this connector today.
  fetch(credential, { externalId, fields, from, to, preset, opts }) -> rows[],
  // Keep the credential alive; return the replacement or null if unchanged.
  refresh(credential) -> { credential, expiresAt } | null,
  // Called on disconnect and on org deletion. Best effort at the provider, always local.
  revoke(credential) -> void,
  // Cheap liveness check used by the health tile and the nightly job.
  health(credential, externalId) -> { ok, detail },
}
```

A registry picks the adapter from `connection.provider`, decrypts the
credential, calls `fetch`, and records `last_ok_at` / `last_error`.
`provider = 'windsor'` is an adapter whose credential is the org's Windsor
key and whose `fetch` is today's function, so Caalano Digital's workspaces
keep working on day one while each provider adapter is built and switched
over per workspace with a feature flag.

### 7.2 Per-provider notes

**Meta (Facebook + Instagram ads, Facebook organic, Instagram organic)**
- Facebook Login for Business with `ads_read`, `business_management`,
  `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`,
  `read_insights`. Needs **App Review** for `ads_read` and
  `business_management`; allow four to six weeks and a screencast.
- Tokens: exchange the short-lived user token for a 60-day long-lived token;
  refresh by re-exchanging while still valid; `cred_expires_at` drives a
  worker job that emails the connector 7 days before expiry and flips
  `status = needs_reauth` after.
- Rows: Marketing API `/{act}/insights` with `level`, `fields`,
  `time_range`, `breakdowns`; map field names once in the adapter to today's
  Windsor names (`spend`, `impressions`, `actions:lead`, ...).
- Required for review: a **Data Deletion Request URL** (we already have
  the meta-webhooks endpoint pattern) and the privacy policy URL.
- Rate limits are per ad account and per app; the worker keeps one
  in-flight call per ad account.

**Google Ads**
- OAuth scope `https://www.googleapis.com/auth/adwords`, refresh token is
  long-lived, no expiry job needed.
- A **developer token** on Caalano's manager account, starting at Basic
  access (test accounts only) and applying for **Standard** access before
  any external tenant connects. Also **OAuth verification** of the app,
  because `adwords` is a sensitive scope.
- Reads via GAQL through the REST endpoint `customers/{id}/googleAds:search`;
  the adapter maps `metrics.cost_micros` and friends to today's field names.
- `login-customer-id` header = the tenant's own manager account when they
  connect through one; store it in `connections.scopes` or a `meta` jsonb.

**GA4**
- Same Google OAuth app, scope `analytics.readonly` (sensitive, covered by
  the same verification). Data API `properties/{id}:runReport`.
- One Google connection can back both a Google Ads and a GA4 connection
  row; store the refresh token once per (workspace, google identity) and let
  both rows point at it through `cred_*` on each row (simplest) or a shared
  credential row (later, if it matters).

**GoHighLevel (Caalano Systems)**
- Keep the existing marketplace app and `caalano-connect.mjs`. Today it is
  installed at agency level and mints location tokens through
  `locations.readonly`. For an outside tenant the same app is installed as
  a **private install on their own location** (or agency) and lands on the
  same callback with `state` carrying `{orgId, workspaceId}`.
- Scopes are the current nine read scopes in `SCOPES` until the rep
  workspace (section 15, stage C) adds three write scopes. Adding a scope
  invalidates every install, so the list is versioned and changed once, on
  purpose.
- Access token lives ~24 hours, refresh token rotates on every refresh:
  `refresh()` must store the new refresh token atomically or the connection
  is lost. This is the one adapter where a lost write is fatal, so the
  update is a single `update ... where id = ? and cred_iv = ?` compare-and-set.
- `ghl.mjs` currently keys everything by `locationId`; it becomes
  `connection.external_id`, no other change.
- **How an install reaches the right customer account.** Two routes, both
  land on the same callback:
  1. *From inside the app* (the documented route). Account -> Connections ->
     Connect Caalano Systems. We send the person to GoHighLevel's
     choose-location screen with a signed `state` carrying
     `{orgId, workspaceId, userId}`. They pick their location (or, for an
     agency install, their agency and then the locations), approve the nine
     read scopes, and come back to the callback, which already knows which
     workspace the location belongs to. A green card, nothing to log in to
     again.
  2. *From GoHighLevel's side* (someone finds the private install link
     first). The callback arrives with no `state`. We hold the tokens in a
     short-lived "unclaimed install" row, show the sign-in / sign-up screen,
     and after sign-in ask "attach this location to which workspace?" with
     the option to create one. If nobody claims it within an hour the
     tokens are revoked and discarded.
  An agency-level install mints one location token per chosen location
  through `locations.readonly`, exactly as Caalano's own install does today,
  so an agency customer installs once and picks locations from a list. A
  "private" marketplace app is simply unlisted: it needs no GoHighLevel
  review and is installed only through our link.

**Sign in with Google.** The Google OAuth client registered for Google Ads
also offers "Continue with Google" on the login page (`openid email
profile`). A Google sign-in that matches a pending invitation or an existing
user's email signs that user in; any other Google account is offered
sign-up. Google then carries the person's 2FA, which is the security gain.
Email + password stays for anyone without Google. Microsoft sign-in can be
added the same way later.

**Windsor (transitional)**
- Adapter wraps today's `windsorFetch`. Only Caalano Digital's organisation
  can hold a Windsor connection (plan feature `windsor_bridge`). It is
  removed once every Caalano workspace is on direct adapters.

### 7.3 Connect flow in the UI

Settings -> Workspace -> Connections shows one card per provider with the
connected account name, status pill (ok / needs re-authorisation / error),
last successful read, and Connect / Reconnect / Disconnect. Connect opens
the provider's OAuth in a popup, the callback stores the credential and
lists accounts, the user picks one, and a `health` call runs before the row
is saved. Disconnect calls `revoke`, nulls the credential columns, sets
`deleted_at`, and queues a purge of that workspace's snapshots for the
provider. Only `admin` and above see the buttons.

## 8. Security

**Credential encryption.** Per connection: a random 256-bit data key
encrypts the credential JSON with AES-256-GCM (`cred_ciphertext`,
`cred_iv`, `cred_tag`). The data key is wrapped with the key encryption key
named by `cred_kek_id` (`KEK_V1` in the environment; a second variable lets
us rotate by re-wrapping without touching ciphertexts). Decryption happens
only in the function or worker process that is about to call the provider;
the credential never goes to the browser or into a log. `SECRET_STORES`
in `backup.mjs` becomes "columns beginning with `cred_`" and the backup
export keeps its `?secrets=1` gate.

**Isolation.** RLS as in section 4, `app.org_id` set from the verified
session, worker jobs carry `org_id` and set it the same way. Snapshot and
cache keys are (workspace, kind, key), never a bare client slug, so two
organisations that both name a workspace `acme` cannot collide.

**Sessions.** Keep the signed cookie from `auth.mjs`, add `org_id` and the
membership role to the payload, and an org switcher that re-signs. Sessions
are invalidated when a membership is disabled (check `memberships.status`
on each request, it is one indexed read).

**Secrets in the environment.** Everything in the current list stays
(`ANTHROPIC_API_KEY`, `AUTH_SECRET`, `GHL_CLIENT_ID/SECRET`, `META_APP_SECRET`,
`WARM_SECRET`, backup vars) and gains `DATABASE_URL`, `KEK_V1`,
`GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `META_APP_ID`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `QUEUE_URL`. All of them go in
the password manager as `BACKUP.md` step 2 requires.

**Deletion.** `DELETE /org` (owner only, typed confirmation) sets
`deleted_at`, revokes every connection at the provider, cancels the Stripe
subscription, and schedules the purge. The Meta data-deletion callback and
a GDPR/Privacy-Act request land on the same purge.

**Audit.** Every write to memberships, connections, plans and settings
writes an `audit_log` row with the acting user, org, workspace and a diff.
Platform-admin impersonation writes a row on entry and exit.

## 9. Sync, cache and the worker

Today: Netlify Functions do the reads on request, `warm.mjs` pre-builds a
handful of presets on a schedule, snapshots (`caalano-oppcache`,
`caalano-pipecache`, `caalano-cfcache`, `caalano-speedscan`) live in Blobs,
and slow live CRM builds for keys the warmer misses are the main
reliability complaint (the Finr Advisory rows in the diag export).

Target:

1. **The worker owns every provider read that is not a tiny lookup.**
   `sync_jobs` is the queue table (Postgres `select ... for update skip
   locked`; Upstash Redis only if the table ever becomes the bottleneck).
   Job kinds: `warm` (per workspace, per preset), `snapshot:opps`,
   `snapshot:appts` (the appointments snapshot decided as the next
   reliability fix), `speedscan`, `monthly`, `health`, `token_refresh`.
2. **Per-organisation concurrency** of 2 and per-connection concurrency of
   1, so one large agency cannot starve the others and no provider sees a
   burst from one account. Retries with exponential backoff, 429s honoured
   from the provider's `Retry-After`.
3. **Cadence comes from the plan.** The scheduler enqueues `warm` for each
   active workspace every `plan.refresh_minutes`, and `snapshot:*` nightly
   in the workspace timezone.
4. **Functions read snapshots first.** A request for a range the warmer
   covers is served from `snapshots`; anything else falls back to a live
   read with today's request budget, and enqueues a warm for that key so
   the second load is fast. This is the same shape as today's Blobs caches
   with the keys moved into Postgres.
5. **Reliability rows** (`diag_log`) keep `q`, `ms`, and the `ghlBy` family
   breakdown so the same export that drives today's fixes keeps working
   per organisation.

Netlify Functions stay for auth, settings, the UI reads, PDF, insights, and
the OAuth callbacks. The worker is a small Node service in the same
repository (`worker/`), deployed to Railway or Fly in Sydney, sharing
`netlify/lib/*` unchanged.

## 10. Migration from today

Each phase ships behind a flag, is reversible, and Caalano Digital's own
reporting must be identical before and after. The version numbering and
release workflow stay the same.

**Phase 0 - Foundations (no user-visible change).**
Postgres project, schema above, migrations with `node-pg-migrate` or plain
SQL files in `db/migrations/`, RLS policies, `entitle.mjs` with the current
roles mapped onto it, `providers/windsor.mjs` wrapping `windsorFetch`.
Tests: entitlement matrix, RLS isolation test with two organisations.

**Phase 1 - Move Caalano Digital in.**
A one-off `scripts/migrate-blobs-to-pg.mjs`: creates organisation
`caalano` (kind agency, plan `caalano`), one workspace per
`SETTINGS.clients` key, a `windsor` connection per workspace per provider
id it has, a membership per `caalano-auth` user with the same role name, Alex also
gets `saas_owner` in `platform_roles`, settings sections split into `workspace_settings` and
`org_settings`, snapshots, monthly, social, audit and diag rows copied.
Dual-write for one release (Blobs and Postgres), then read from Postgres,
then stop writing Blobs. Backups switch to `pg_dump` nightly to the private
backup repo, and `restore-backup.mjs` gets a Postgres mode.

**Phase 2 - GoHighLevel self-serve.**
The `ghl` adapter, private-install flow through `caalano-connect.mjs` with
`state = {orgId, workspaceId}`, the Connections card, `health`,
`token_refresh` jobs. First external tenant is an existing Caalano client
on a Business plan with a manual Stripe subscription. **DPA and privacy
policy must be live before this tenant connects.**

**Phase 3 - Meta and Google Ads, together.** Both are gated by outside
approvals (Meta App Review; the Google Ads developer token at Standard
access and OAuth verification), which take longer than the code, so the
applications are submitted at the start of phase 0, as soon as the new
domain carries a privacy policy and a data deletion page. The two adapters,
the Connections cards, the Meta token-expiry job and the Meta data-deletion
callback are built while the reviews run. Switch one Caalano workspace per
provider from Windsor to direct and compare a month of numbers before
switching the rest.

**Phase 3b - Google Analytics (GA4).** Same Google sign-in with one extra
scope, covered by the same verification; a later release once Meta and
Google Ads are stable.

**Phase 4 - Retire Windsor.** When every Caalano workspace is on direct
adapters, drop the Windsor adapter and the Windsor subscription.

**Phase 5 - Billing and self-signup.**
Stripe Checkout, customer portal, webhooks, plan rows, `usage_daily`, the
signup page (organisation kind, first workspace, first owner), trial,
past-due read-only mode, platform admin console.

Nothing in phases 2 to 5 needs the React app restructured. The client
picker becomes the workspace picker, the settings screens gain an
organisation level, and the sign-in gains an organisation switcher.

## 11. Compliance checklist (before phase 2)

- [ ] **Data processing agreement** template for tenants (Alex asked to be
      reminded of this). Covers what we store, sub-processors (Netlify,
      Supabase/Neon, Railway/Fly, Anthropic for insights, Stripe), retention
      (30 days after deletion), breach notice window, and the Australian
      Privacy Act 1988 / APPs; GDPR clauses if a tenant is in the EU.
- [ ] **Public privacy policy** at a stable URL (Meta and Google both
      require it during review).
- [ ] **Terms of Use v1.5** already names the entity; add a SaaS
      subscription schedule (plan, fees, cancellation, data on exit).
- [ ] **Data deletion endpoint** and a documented deletion path.
- [ ] **Sub-processor list** published and kept current.
- [ ] Security contact `alex@caalanodigital.com.au` on the site.
- [ ] Meta App Review and Google OAuth verification submissions prepared
      (screencast, test accounts, privacy URL, deletion URL).

## 12. Decisions taken on 2026-09-12

1. **Database: Neon.** Database only; we keep our own login system.
2. **Pricing: per workspace**, working figure US$97 a month, volume steps for
   agencies, exact numbers still to set. Business and agency sign-ups, the
   agency kind adds the overview panel and performance management.
3. **Per-workspace usage** comes free with per-workspace billing; agencies can
   on-charge clients from the bill itself.
4. **White label: not at launch**, designed for later.
5. **First outside tenant: Finr Advisory.** DPA and privacy policy first.

## 13. Hosting, speed and cost - the reasoning

**The ten-second timeout is Netlify's, not the database's.** Netlify
Functions must answer in 10 seconds (26 with a setting), background
functions get 15 minutes. No database choice changes that. What removes the
timeouts is moving the heavy work (CRM builds, snapshots, warming) into a
worker that has no time limit and serving every page from pre-built
snapshots, which is section 9. The database is where those snapshots live.
Both Neon and Supabase sit in Sydney on AWS underneath, so query latency to
a Sydney function or worker is a few milliseconds either way.

**Neon vs Supabase vs AWS**

| | Neon | Supabase | AWS (RDS) |
|---|---|---|---|
| What it is | Postgres only | Postgres + auth + storage + realtime + dashboard | Postgres, self-managed on AWS |
| Sydney region | yes | yes | yes |
| Idle cost | scales to zero | always on | always on |
| Branching (copy the DB for a test) | seconds, built in | no (manual dump) | manual snapshot/restore |
| Extras we would use | none needed | none (we have our own auth) | none |
| Setup and ops | minutes, none | minutes, none | hours, ongoing (patching, backups, networking) |
| Cost at launch | ~US$19/month | ~US$25/month | ~US$15-60/month plus time |

Neon because it is the plain thing we need, branching makes every migration
rehearsable, and it costs nothing while idle. Supabase would be fine and is a
day's work to switch to. AWS gives control we do not need yet at a cost in
attention; it stays deferred. Firebase remains rejected (not relational).

**The bundle for launch**

| Piece | Where | Why | Cost |
|---|---|---|---|
| Website + light API + OAuth callbacks | Netlify (as now) | already set up: CI, staging, backups, edge gate | current plan |
| Database | Neon, Sydney | above | ~US$19 |
| Worker (all heavy reads, snapshots, warming, backups) | Railway or Fly, Sydney, one small service in this repo (`worker/`) | no time limit, per-tenant concurrency, shares `netlify/lib` | ~US$10-20 |
| Queue | Postgres table (`sync_jobs`) | one less service; Upstash Redis only if it ever bottlenecks | 0 |
| Billing | Stripe | standard | % of revenue |
| Backups | Neon point-in-time restore + nightly `pg_dump` to the backups repo | replaces the Blobs job | 0 |

Roughly US$50-80 a month on top of what runs today, before Stripe fees.

**The alternative worth knowing about:** moving everything (site, API,
worker, database) onto Railway alone. One platform, no timeouts anywhere,
one bill. It costs about a week to re-host the functions as one Node
server, and gives up Netlify's CDN, edge gate and the staging/CI setup just
finished. Not for now. The worker is written as plain Node so that if the
Netlify side ever becomes the bottleneck, the move is mechanical.

**What actually makes it fast:** every page reads a snapshot the worker
built minutes ago, and a live read happens only for a range nobody has asked
for before, which then queues a warm. That is the same design as the current
Blobs caches, with the keys in Postgres and the work off the request path.
The database choice is a small part of the speed story; the worker is most
of it.

**Market comparison used for pricing (USD/month, September 2026)**

| Product | Model | Price |
|---|---|---|
| AgencyAnalytics | per client | $20 per client, plans from $59 for 5 |
| DashThis | per dashboard | from about $42 |
| Swydo | per data source | $49 for 10, $4.50 each after |
| Databox | per data source | $3 to $5.60 per extra source |
| Whatagraph | credits | $812 minimum |
| Hyros | per tracked revenue | $230 (annual) / $459 (monthly) to $5,249 |
| GoHighLevel AI Employee add-on | per sub-account | $50 to $97 |
| Streamlined Analytics (streamlined.so) | per sub-account with a ceiling, AI metered on top | $295 first sub-account, $50 each for the next four (max 5, $495); agencies $495 flat for unlimited sub-accounts; AI analysis $0.02 to $0.0025 per result, call transcription $0.0004 per second; 14-day trial |

Report builders sit at $20 to $45 per client; attribution and intelligence
tools (Hyros) sit at $230 to $5,000+. A $97 per-workspace price is only
defensible as the second kind, which is the positioning.

Streamlined is the closest comparable: same audience (GoHighLevel
agencies), same claim (intelligence, not reports), and it prices the way a
single-workspace buyer and an agency buyer actually behave: a high first
workspace, cheap additional ones, and a flat ceiling for agencies so a
20-client agency is not scared off by a per-client multiplier. Its AI is
metered separately, which keeps the base price honest against AI cost.

Suggested shape for Caalano360, to be priced by Alex (USD/month):

| | First workspace | Each additional | Ceiling |
|---|---|---|---|
| Business (1 to 5) | $147 to $197 | $47 to $67 | none needed |
| Agency (unlimited) | flat $497 to $697 | included | that flat fee |
| AI insights / briefings | metered per run on both, or included up to a cap | | |

This keeps the single business well under Streamlined's $295, keeps the
agency fee in the same band as theirs while including the agency overview
they do not have, and makes the Stripe setup simple: one seat price with
graduated tiers for business, one flat price for agency, one metered AI
item. The `plans` rows in section 6 already carry this without change.

## 14. Launch scope, domain and the account area (agreed 2026-09-12)

**Domain.** The product launches on a new domain (name to be chosen). The
root serves a marketing landing page; the app lives on `app.<domain>`.
`360.caalanodigital.com.au` redirects to the app and keeps working for
existing users through the changeover. Consequences to plan for:

- OAuth redirect URLs must be re-registered on the new domain before the
  switch: the GoHighLevel marketplace app (`caalano-connect`), and later the
  Meta app and the Google OAuth client. The old URLs stay registered until
  the redirect has been live for a week.
- The login cookie is per host, so everyone signs in once more after the move.
- The edge gate, `robots.txt` and the noindex header apply to `app.` only;
  the landing page is public and indexable.
- The landing page is a separate small site (Netlify, same account) so a
  copy change never redeploys the app.

**Launch scope: the client views only.** The first release to outside
tenants ships:

| Surface | At launch | Notes |
|---|---|---|
| Client workspace and all its tabs (overall, custom dashboards, users, meta, google, analytics, cohorts, forms, location, appointments, calendar performance, timing, calls, lost reasons) | yes | this is the product |
| Settings for a workspace (key events, KPI targets, campaign links, Meta conversions, forms, qualified stage, aliases, logos, timing, catchment, custom dashboards) | yes | |
| Agency Overview | agency plan only | |
| Account area (section below) | yes | new |
| Daily Performance, Weekly Traffic Light, Funnel Forecaster, Creative Cockpit, Meta Insights, Client Update, Organic Social Media | no | later releases, each behind its own feature flag |
| Monthly Report (build and publish) and Monthly Reports (viewer side) | yes | as it is today; see the note on customisable reports below |
| Clinic tab, optimisation log, curator, Meta creative-fatigue webhook, competitors | no | Caalano-internal for now |

Every module is a **feature flag in `plans.features`** (`module.trends`,
`module.weekly`, `module.forecast`, `module.cockpit`, `module.insights`,
`module.update`, `module.monthly`, `module.social`, `module.agency_overview`)
checked through `can(ctx, 'module.<name>')`, so a later release is a row
change, not a deploy. The internal `caalano` plan has all of them, so nothing
changes for Caalano Digital's own use. The sidebar renders only the modules
the plan grants; a module the plan lacks is not shown rather than shown
locked, except where an upgrade prompt is wanted (agency overview on a
business plan).

Settings sections at launch map as follows. Workspace: `keyevents`, `kpis`,
`campmap`, `metaconv`, `formmeta`, `qualstage`, `aliases`, `logos`,
`clientctx`, `geo`, `adnames`, `health`, `dashboards`. Organisation: `ui`,
`profile`. Not exposed to tenants at launch: `dailyperf`, `forecasts`,
`creativemeta`, `creativetax`, `fatigue`, `competitors`, `socialkpis`,
`optlog`, `curator`, `clinic`, `pdfdl`, `insights`. `enabled`/`restricted`
become workspace status and member scoping; `clients` becomes the
`workspaces` and `connections` tables.

**The account area.** One new place, "Account", visible to owners and
admins, with five screens:

1. **Workspaces** - list, add (name, timezone, currency), rename, archive.
   Adding one changes the Stripe quantity on business plans; the entitlement
   function refuses the add when the plan's limit is reached and shows the
   upgrade prompt instead.
2. **Members** - invite by email with a role and, for viewers, the
   workspaces and tabs they may see; change role; remove. The existing user
   management screen, scoped to the organisation.
3. **Connections** - per workspace, one card per provider (Caalano Systems,
   Meta, Google Ads, GA4): connected account, status, last read, Connect /
   Reconnect / Disconnect. Section 7.3.
4. **Billing** - current plan, workspace count, next invoice, card, invoice
   history, Upgrade / Downgrade / Cancel. Card, invoices and cancellation go
   through Stripe's hosted customer portal; plan changes go through our own
   page so the entitlement change and the Stripe change happen together.
   Downgrading below the workspace count asks which workspaces to archive
   first. Past-due puts the organisation into read-only until paid.
5. **Branding** - white label, hidden behind the `white_label` feature at
   launch. Logo, colours and custom domain per organisation, stored in
   `org_branding`. Designed now, built later.

Sign-up flow: email, organisation name, kind (business or agency), first
workspace name, card via Stripe Checkout with the 14-day trial, then straight
to Connections for that workspace. A business can add more workspaces at
any time; the agency kind is a plan change, not a new account.

**Customisable monthly reports (later).** At launch the monthly report is
the fixed layout it has today. Tenants replacing a reporting tool will want
to choose what a report contains, so the later design is: a report template
per organisation (ordered sections chosen from the existing report blocks,
each with its metric picks and a free-text block), workspace-level
overrides, organisation branding on the cover once white label exists, and
a schedule (build on the 1st, publish automatically or after review). The
data behind every block already exists; this is a layout and picker layer,
so it is a phase of its own after launch rather than a change to the
report engine now. Keep the report blocks as separate components so they
can be reordered later without rework.

**Phase plan adjustment.** The account area and module flags become
**phase 1b**, between moving Caalano Digital in (phase 1) and GoHighLevel
self-serve (phase 2), because Finr Advisory needs Workspaces, Members,
Connections and Billing to exist before they can be a tenant.

## 15. Data hygiene for CRM users (raised 2026-09-12)

The intelligence is only as good as what sales reps mark in the CRM: won
deals need a value (and later a product), lost deals need a lost reason,
appointments that have passed need a result (showed, no-show, cancelled),
and stages need advancing. Everything below is possible with data the app
already reads (`monetaryValue`, `lostReasonId`, appointment status and
start time, `assignedTo`, pipeline stage), so stage A needs no new
permissions.

**Stage A - built as the Deals & Actions tab (v3.564.0).** It went further
than read-only: it writes fixes back, and it has a Live deals screen. A
"Deals & Actions" tab per workspace, with an Action list and Live deals; a
viewer can hold this tab alone (the "CRM user preset" in Team) and, with
the CRM updates grant, fix their own records from a phone. The checks:

| Check | Rule | Fix asked for |
|---|---|---|
| Appointment not resulted | status still booked/confirmed and start time is in the past | mark showed / no-show / cancelled |
| Won without a value | status won and `monetaryValue` empty or 0 | enter the value (and the product once the register exists) |
| Lost without a reason | status lost/abandoned and no `lostReasonId` | pick a lost reason |
| Stale open deal | open, no activity for N days (per client setting) | follow up or mark lost |
| Unassigned | opportunity with no `assignedTo` | assign a rep |
| Messages with no reply | conversation whose last message came from the contact | reply in the CRM (deep link), or mark handled |

Each row: contact, rep, age, and an "Open in Caalano Systems" deep link to
the contact so the fix is one click away. Counts per rep and per check feed
a health line on the Agency Overview and a weekly digest e-mail to each
rep. Reps see it as a `hygiene` tab grant on a viewer or user membership,
so a rep can be invited with only that tab. Built from the existing
opportunity and appointment snapshots, so it costs no new API reads.

**Stage B - inside the CRM, no separate login.** GoHighLevel marketplace
apps can add a custom page to the location's sidebar with single sign-on:
the CRM tells us who is looking, we show that rep's own action list. Reps
never leave the CRM. Needs the app's custom-page setting and the SSO key,
no new scopes.

**Stage C - the rep workspace ("My deals").** Agreed 2026-09-12: more
than fixing rows, reps should be able to work their deals here, in a
friendlier way than the LeadConnector app, for everything except messaging
and conversations, which stay in the CRM.

| Screen | What a rep can do | CRM write needed |
|---|---|---|
| My deals | every opportunity assigned to them, grouped by pipeline and stage, with value, age, next appointment and the hygiene flags from stage A | none to view |
| Deal card | move stage; mark won with value (and product once the register exists); mark lost with a reason; change value; reassign | `opportunities.write` |
| Notes | read the contact's notes, add a note | `contacts.readonly` (have), `contacts.write` |
| Appointments | today's and overdue appointments, result each one (showed / no-show / cancelled), reschedule | `calendars/events.write` |
| Action list | stage A's rows, each fixable in place | the above |

Not in scope: sending messages, reading conversations, creating contacts,
editing custom fields other than value and product. If a rep needs those
they open the CRM (deep link on every card).

Every write goes through our API, is checked by `can(ctx, 'crm.write',
{workspaceId})`, is limited to opportunities assigned to the rep unless
they are `user` or above, and lands in the audit log with rep, field, old
and new value. Writes are sent straight to the CRM and the local snapshot
is patched at the same time, so the board updates immediately and the next
sync confirms it.

**The scope change.** The app had nine read scopes. v3.564.0 requests
`opportunities.write`, `contacts.write`, `calendars/events.write` and
`conversations.readonly` (the conversation list, for the no-reply check;
no message-sending scope). Changing the scope list invalidates every existing
install, so it is done once, at a planned point: update the marketplace
app, re-authorise Caalano's own agency install through Settings -> Connect,
and show a "Re-authorise to enable deal updates" prompt on every tenant's
Connections card. Read-only use keeps working on the old token until they
do. Stage C is therefore built behind a flag and switched on per workspace
when its connection carries the new scopes.

**Prevention** stays in the CRM: the conditional required fields on Won
(value, product) that clients are already testing, and a required lost
reason on Lost. The action list is the catch-up for what slips past.

## 16. Client-side role names, the rep scorecard, and single sub-account installs (2026-09-12)

**Names that match the CRM.** The client side of an organisation has two
levels, named as GoHighLevel names them so nobody has to translate:

| Name | What it is underneath | Sees |
|---|---|---|
| **Account Admin** | `viewer` with ticked tabs | the dashboards for their account, read-only |
| **Account User** | `viewer` with only the Deals & Actions tab and the CRM-updates grant | their own deals, action list and results; can update their own records |

Built in v3.565.0 as labels and a one-click preset ("Make this an Account
User") in Team; no new role underneath, so nothing in the current user list
changed. In the SaaS schema these become the two client-side `org_role`
values for a business organisation (`account_admin`, `account_user`) beside
the agency-side `superadmin`, `admin`, `user`; the entitlement table maps
`account_user` to `module.actions` only.

**My results (the rep scorecard).** Third screen on Deals & Actions, per
rep and per period: leads, appointments booked (by the rep vs by the
customer), show rate, win rate, won and revenue, lost with the top reason,
open now with value, stale count with average and oldest idle days, speed
to lead (median, within-5-minutes share, buckets, after-hours), how far
their leads got by stage, lost reasons, and rank among the team on leads,
bookings, win rate and revenue. Built from the same code as the Users tab
and Speed to Lead, so rep and manager read the same numbers. An Account
User sees only their own; staff pick any rep.

**Installing on one sub-account that belongs to another agency.** Yes: a
marketplace app installs at location level through the same choose-location
screen, whichever agency owns the location, as long as the person installing
has access to that location and the owning agency has not blocked
marketplace installs for its sub-accounts (a white-label agency can hide the
marketplace; the person can still use our direct install link). Two things
the code must handle, planned for phase 2:

1. **Location-level tokens.** Today the exchange asks for a Company token and
   mints location tokens from it. A sub-account install returns a Location
   token that is used directly and refreshed on its own; `connections.kind`
   records `agency` or `location`, and the token refresh path branches on it.
2. **No agency context.** A location-only install cannot list other
   locations, read agency users or use agency-level endpoints; the
   Connections card shows the single location and the Users list comes from
   the location's own `/users/` call, which is what the app reads already.

To be confirmed with a real test install on a friendly sub-account under a
white-label agency before Finr Advisory: that the standard marketplace
login works for a user who normally signs in through the white-label domain.

## 17. Five tiers, the compare view, and users attached to accounts (2026-09-12)

**Five real roles**, built in v3.566.0 and named as the CRM names them:

| Role key | Name | Who | Sees |
|---|---|---|---|
| `superadmin` | Super Admin | Alex | everything, owner control |
| `admin` | Agency Admin | agency leads | every client, every tab, all settings |
| `user` | Agency User | agency staff | dashboards for allowed accounts |
| `account_admin` | Account Admin | the client | ticked accounts and tabs, read-only dashboards; can compare reps |
| `account_user` | Account User | the client's employee, a rep | Deals & Actions only: own deals, action list, results; updates own records |

`viewer` is the old name for `account_admin` and is still read from older
records. An Account User's tabs are always exactly Deals & Actions and CRM
updates are implied. In the SaaS schema these are the five `org_role`
values; the entitlement function ranks them 4 to 0.

**Compare.** Agency staff and Account Admins get a fourth screen on Deals &
Actions: two reps side by side on every scorecard number, stage reach,
lost reasons and speed to lead (in-hours buckets, after-hours separately),
with the better side marked. Two reads of the same scorecard route.

**Speed to lead on the scorecard** follows the same rules as the Timing
tab: the client's business hours, first reply a person sent (or a staff-
booked appointment), in-hours leads drive the median and buckets, after-
hours leads are measured from the next opening and reported separately.
It measures every one of the rep's leads when the message export finishes
in time, otherwise as many as the budget allows, and says which.

**Attached to an account.** A person's allocation is the attachment: an
Account Admin or Account User is attached to the accounts ticked for them,
an Agency User to their allowed accounts (or all), admins to all. Team has
an "Attached to" filter and a role filter, so "who works on Poolhouse" is
one click. One person can be attached to several accounts. In the SaaS
schema this is `memberships.workspace_ids`.

**Linked CRM user.** Each person can be linked, per account, to the CRM user
they are (`crmUsers: { clientId: crmUserId }` on the user record; in the
SaaS schema a `crm_user_id` on the membership's workspace grant). The link
is optional: unlinked people match by e-mail. An Account User's Live deals
and Action list are always their own; My results keeps the leaderboard
because every deal is visible in the CRM anyway; Compare is Account Admin
and above.
