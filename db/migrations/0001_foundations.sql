-- Caalano360 SaaS foundations (SAAS-DESIGN.md section 4), phase 0.
-- Every tenant table carries org_id and the same two row level security
-- policies: a row is visible when app.org_id (set per transaction from the
-- verified session) matches, or when app.platform_admin is 'true'. RLS is
-- FORCED so the table owner (the role the functions connect as) is bound by
-- the policies too: a function that forgets to set app.org_id gets no rows.
create extension if not exists citext;

-- identity ---------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  name          text not null default '',
  password_hash text,
  google_sub    text unique,
  terms_version text, terms_accepted_at timestamptz,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create type platform_role as enum ('saas_owner', 'saas_admin', 'saas_user');
create table platform_roles (
  user_id    uuid primary key references users(id),
  role       platform_role not null,
  granted_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- billing (before organisations, which reference a plan) ------------------
create type org_kind as enum ('agency', 'business');
create table plans (
  id              text primary key,
  name            text not null,
  kind            org_kind not null,
  max_workspaces  int,
  max_connections int,
  max_members     int,
  refresh_minutes int not null,
  history_months  int not null,
  features        text[] not null default '{}',
  stripe_price_id text,
  monthly_aud     numeric(10,2)
);

-- tenancy ----------------------------------------------------------------
-- The agency-side roles the app uses today plus the two client-side names
-- from section 16 (account_admin = a viewer with ticked tabs, account_user =
-- Deals & Actions only). 'viewer' stays for compatibility with old data.
create type org_role as enum ('superadmin', 'admin', 'user', 'viewer', 'account_admin', 'account_user');

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  kind          org_kind not null,
  timezone      text not null default 'Australia/Sydney',
  currency      text not null default 'AUD',
  plan_id       text not null references plans(id),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  subscription_status    text not null default 'trialing',
  trial_ends_at  timestamptz,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table memberships (
  org_id     uuid not null references organisations(id),
  user_id    uuid not null references users(id),
  role       org_role not null,
  status     text not null default 'active',
  workspace_ids uuid[],
  tabs       text[],
  reports    boolean not null default false,
  crm_user_id text,
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
  slug       text not null,
  name       text not null,
  timezone   text, currency text,
  demo       boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, slug)
);

-- provider connections ---------------------------------------------------
create type provider as enum ('meta', 'google_ads', 'ga4', 'ghl', 'windsor');
create type connection_kind as enum ('agency', 'location');

create table connections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  provider     provider not null,
  kind         connection_kind not null default 'agency',
  external_id  text not null,
  external_name text,
  scopes       text[] not null default '{}',
  status       text not null default 'ok',
  status_detail text,
  connected_by uuid references users(id),
  cred_ciphertext bytea, cred_iv bytea, cred_tag bytea, cred_wrapped_key bytea, cred_kek_id text,
  cred_expires_at timestamptz,
  last_ok_at    timestamptz, last_error_at timestamptz, last_error text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (workspace_id, provider, external_id)
);

-- settings ---------------------------------------------------------------
-- version increments on every write so two admins editing the same section
-- cannot silently overwrite each other (the write carries the version it read).
create table workspace_settings (
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  section      text not null,
  value        jsonb not null default '{}',
  version      int not null default 1,
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, section)
);

create table org_settings (
  org_id     uuid not null references organisations(id),
  section    text not null,
  value      jsonb not null default '{}',
  version    int not null default 1,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, section)
);

-- data -------------------------------------------------------------------
create table snapshots (
  org_id       uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  kind         text not null,
  key          text not null default '',
  value        jsonb not null,
  built_at     timestamptz not null default now(),
  expires_at   timestamptz,
  primary key (workspace_id, kind, key)
);

create table monthly_reports (
  org_id uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  month  text not null,
  value  jsonb not null, published_at timestamptz, saved_at timestamptz not null default now(),
  primary key (workspace_id, month)
);

create table social_cache (
  org_id uuid not null references organisations(id),
  workspace_id uuid not null references workspaces(id),
  key text not null, value jsonb not null, built_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

-- live CRM events (today's caalano-live ring buffer): a row per event, so
-- two deliveries in the same second never overwrite each other.
create table live_events (
  id            bigserial primary key,
  org_id        uuid not null references organisations(id),
  workspace_id  uuid not null references workspaces(id),
  event_id      text not null,
  kind          text not null,
  at            timestamptz not null,
  payload       jsonb not null,
  unique (workspace_id, event_id)
);
create index on live_events (workspace_id, at desc);

create table sync_jobs (
  id            bigserial primary key,
  org_id        uuid not null references organisations(id),
  workspace_id  uuid references workspaces(id),
  connection_id uuid references connections(id),
  kind          text not null,
  args          jsonb not null default '{}',
  status        text not null default 'queued',
  attempts      int not null default 0,
  run_after     timestamptz not null default now(),
  started_at    timestamptz, finished_at timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);
create index on sync_jobs (status, run_after) where status in ('queued','failed');
create index on sync_jobs (org_id, status);

-- logs -------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  org_id uuid not null, workspace_id uuid, user_id uuid,
  action text not null, detail jsonb, ip inet, at timestamptz not null default now()
);
create index on audit_log (org_id, at desc);

create table diag_log (
  id bigserial primary key,
  org_id uuid not null, workspace_id uuid,
  route text, q text, ms int, status int, upstream jsonb, at timestamptz not null default now()
);
create index on diag_log (org_id, at desc);

create table usage_daily (
  org_id uuid not null references organisations(id),
  day    date not null,
  workspaces int, connections int, members int,
  api_calls int, worker_seconds int, ai_tokens int,
  primary key (org_id, day)
);

-- row level security -----------------------------------------------------
-- Every table with an org_id column gets the same pair of policies. The
-- USING expression doubles as WITH CHECK, so a write with another
-- organisation's org_id is refused, not just hidden.
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'org_id'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', t);
    execute format('create policy platform_admin on %I using (current_setting(''app.platform_admin'', true) = ''true'')', t);
  end loop;
end $$;

-- users and plans have no org_id: users are reached through memberships (a
-- tenant sees the members of its own organisation via that join), plans are
-- public reference data.
