-- Publishing.
--
-- A module is a world's content, snapshotted into a layer of its own and
-- addressed by a digest of that content. The rows of the layer are the
-- module; what is added here is what a catalogue needs to say about it: where
-- it came from, who published it, what it holds, and who may see it.
set search_path = public;

alter table module
  add column source_world uuid references world (id) on delete set null,
  add column published_by uuid references app_user (id) on delete set null,
  add column summary text,
  add column visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  -- Resource counts by model, fixed at publication, so a catalogue can say
  -- what a module holds without reading a layer it has no world to read from.
  add column contents jsonb not null default '{}'::jsonb;

create index module_source_world_idx on module (source_world);
