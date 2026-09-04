-- Tenancy and content storage.
--
-- A world is the tenant: every piece of content belongs to exactly one, and a
-- user may belong to many. Content is addressed by layer rather than by world
-- directly, because a world reads its own content plus the content of every
-- module it enables, nearest layer first. A world's own layer shares its id.
--
-- Isolation is enforced by the database, not by remembering to write a WHERE
-- clause: row-level security restricts every content row to the layers the
-- current world reads, so a query that forgets to scope itself returns
-- nothing instead of everything.

-- Everything lives in `public`, stated rather than assumed: Postgres resolves
-- unqualified names against `"$user", public`, so a schema named after the
-- connecting role would silently become the home of every table here.
set search_path = public;

create extension if not exists vector;

-- The world a request is acting on, set per transaction by the API.
create or replace function current_world() returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('app.world', true), '')::uuid $$;

-- A stack of content: a world's own, or a module's.
create table layer (
  id uuid primary key,
  kind text not null check (kind in ('world', 'module')),
  created_at timestamptz not null default now()
);

create table world (
  id uuid primary key references layer (id) on delete cascade,
  name text not null,
  slug text unique,
  visibility text not null default 'private'
    check (visibility in ('private', 'link', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- A published content package. The digest is a content address: the same
-- content always has the same digest, so a module version is immutable.
create table module (
  id uuid primary key references layer (id) on delete cascade,
  digest text not null unique,
  name text not null,
  version text not null,
  license text,
  created_at timestamptz not null default now()
);

-- The layers a world reads, nearest first. Position 0 is the world's own.
create table world_layer (
  world_id uuid not null references world (id) on delete cascade,
  layer_id uuid not null references layer (id) on delete cascade,
  position int not null,
  primary key (world_id, layer_id),
  unique (world_id, position)
);

create table app_user (
  id uuid primary key,
  subject text not null unique,
  email text,
  name text,
  created_at timestamptz not null default now()
);

create table world_member (
  world_id uuid not null references world (id) on delete cascade,
  user_id uuid not null references app_user (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

-- Content. The body is the resource as the ontology defines it, validated
-- against its generated Zod schema before it ever reaches here. The columns
-- beside it are projections of the platform fields every resource carries, so
-- the queries the API actually serves are indexable without opening the JSON.
create table resource (
  layer_id uuid not null references layer (id) on delete cascade,
  model text not null,
  id uuid not null,
  body jsonb not null,
  name text generated always as (body ->> 'name') stored,
  canon_status text generated always as (body ->> 'canonStatus') stored,
  perspective text generated always as (body ->> 'perspective') stored,
  module_digest text generated always as (body ->> 'module') stored,
  generated_by text
    generated always as (body -> 'provenance' ->> 'generatedBy') stored,
  derived_id uuid generated always as ((body ->> 'derivedId')::uuid) stored,
  -- Valid time is in-world time, counted in years of the world's calendar.
  valid_from int
    generated always as ((body -> 'validTime' -> 'begin' ->> 'year')::int)
    stored,
  valid_to int
    generated always as ((body -> 'validTime' -> 'end' ->> 'year')::int)
    stored,
  revision int generated always as ((body -> 'recorded' ->> 'revision')::int)
    stored,
  -- Transaction time. Set by the API rather than generated, because casting
  -- text to timestamptz depends on the session time zone and so is not
  -- immutable enough for a generated column.
  recorded_at timestamptz not null,
  deleted_at timestamptz,
  primary key (layer_id, model, id)
);

create index resource_model_idx on resource (layer_id, model)
  where deleted_at is null;
create index resource_canon_idx on resource (layer_id, model, canon_status);
create index resource_name_idx on resource (layer_id, model, lower(name));
create index resource_derived_idx on resource (layer_id, derived_id);
create index resource_valid_idx
  on resource (layer_id, model, valid_from, valid_to);
create index resource_generated_by_idx on resource (layer_id, generated_by);
create index resource_body_idx on resource using gin (body jsonb_path_ops);

-- Every version of every resource, appended on write. This is what `asOf`
-- reads: the authoring history, as against valid time, which is in-world.
create table resource_version (
  layer_id uuid not null,
  model text not null,
  id uuid not null,
  revision int not null,
  body jsonb not null,
  recorded_at timestamptz not null,
  deleted boolean not null default false,
  primary key (layer_id, model, id, revision)
);

create index resource_version_asof_idx
  on resource_version (layer_id, model, id, recorded_at desc);

-- Writes to publish on the platform bus. Named for what it is, because
-- `event` is an ontology model: something that happened in-world.
create table event_outbox (
  seq bigserial primary key,
  world_id uuid not null references world (id) on delete cascade,
  model text not null,
  resource_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  envelope jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz
);

create index event_outbox_pending_idx on event_outbox (seq)
  where published_at is null;
create index event_outbox_world_idx on event_outbox (world_id, seq desc);

-- What each model call cost and what it is charged at, per world and user.
create table model_usage (
  id bigserial primary key,
  world_id uuid references world (id) on delete set null,
  user_id uuid references app_user (id) on delete set null,
  task text not null,
  model text not null,
  provider text not null,
  input_tokens int not null,
  output_tokens int not null,
  cost_micros bigint not null,
  charge_micros bigint not null,
  cached boolean not null default false,
  estimated boolean not null default false,
  at timestamptz not null default now()
);

create index model_usage_world_idx on model_usage (world_id, at desc);
create index model_usage_user_idx on model_usage (user_id, at desc);

-- Row-level security on content.
--
-- FORCE is deliberate: it applies these policies to the table owner too, so a
-- local database where the API connects as the owner is protected exactly as a
-- deployed one is. Reads see every layer the world enables; writes only ever
-- touch the world's own layer, which is what makes module content immutable by
-- construction rather than by convention.
alter table resource enable row level security;
alter table resource force row level security;
alter table resource_version enable row level security;
alter table resource_version force row level security;
alter table event_outbox enable row level security;
alter table event_outbox force row level security;

create policy resource_read on resource for select using (
  layer_id in (
    select layer_id from world_layer
    where world_id = current_world()
  )
);

create policy resource_insert on resource for insert
  with check (layer_id = current_world());

create policy resource_update on resource for update
  using (layer_id = current_world())
  with check (layer_id = current_world());

create policy resource_delete on resource for delete
  using (layer_id = current_world());

create policy resource_version_read on resource_version for select using (
  layer_id in (
    select layer_id from world_layer
    where world_id = current_world()
  )
);

create policy resource_version_insert on resource_version for insert
  with check (layer_id = current_world());

create policy event_outbox_read on event_outbox for select
  using (world_id = current_world());

create policy event_outbox_insert on event_outbox for insert
  with check (world_id = current_world());
