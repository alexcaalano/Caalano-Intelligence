-- Terms-of-use records (today's caalano-terms store). The wording is archived
-- once per version and hash so an acceptance can be shown against the exact
-- text that was on screen; acceptances keep the identity stated at signing and
-- the drawn or typed signature. Acceptances belong to a tenant and get the
-- same two policies as every other org_id table.
create table terms_docs (
  version     text not null,
  hash        text not null,
  archived_at timestamptz not null default now(),
  doc         jsonb not null,
  primary key (version, hash)
);

create table terms_acceptances (
  id          bigserial primary key,
  org_id      uuid not null references organisations(id),
  user_id     uuid references users(id),
  email       citext not null,
  name        text not null default '',
  role        text,
  first_name  text, last_name text, phone text,
  version     text not null,
  hash        text,
  accepted_at timestamptz not null,
  signature   text, typed_name text,
  ip          text, user_agent text,
  unique (org_id, email, version, accepted_at)
);
create index on terms_acceptances (org_id, email);

alter table terms_acceptances enable row level security;
alter table terms_acceptances force row level security;
create policy tenant_isolation on terms_acceptances using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy platform_admin on terms_acceptances using (current_setting('app.platform_admin', true) = 'true');
