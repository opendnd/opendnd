-- The publisher runs outside any world and asks which worlds have events
-- waiting. Row-level security is forced on the outbox, for the owner as much
-- as for the application role, so the question is answered by a function that
-- switches on a setting for the length of its own call and by a policy that
-- honours that setting. The function returns world ids and counts, never an
-- event; reading the events still means entering the world.
create or replace function pending_worlds(max_worlds int)
returns table (world_id uuid, pending bigint)
language sql
stable
set search_path = public
set app.publisher = 'on'
as $$
  select world_id, count(*) as pending
  from event_outbox
  where published_at is null
  group by world_id
  order by min(seq)
  limit max_worlds
$$;

create policy event_outbox_scan on event_outbox for select
  using (current_setting('app.publisher', true) = 'on');

-- An owner admits someone by email address. Until that person has signed in
-- there is no user to attach the membership to, so the invitation waits here
-- and becomes a membership the first time they are seen.
create table world_invitation (
  world_id uuid not null references world (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (world_id, email)
);

create index app_user_email_idx on app_user (lower(email));

-- `link` visibility was accepted and behaved exactly as `private`. Until a
-- share token exists there are two visibilities, and the constraint says so.
update world set visibility = 'private' where visibility = 'link';
alter table world drop constraint world_visibility_check;
alter table world add constraint world_visibility_check
  check (visibility in ('private', 'public'));
