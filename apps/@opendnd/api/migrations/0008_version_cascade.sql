-- A version belongs to its layer, and goes when the layer goes.
--
-- `resource` has cascaded from `layer` since the beginning; `resource_version`
-- never had the foreign key at all. So dropping a world took its records and
-- left every version of every one of them behind, unreachable and unreadable:
-- the row is world-scoped, the world it names is gone, and row level security
-- would refuse it even if something asked. In this repository's own database
-- that had grown to 1,355 dead layers holding 83% of the table.
--
-- The orphans go first, because the constraint cannot be added while they are
-- there, and they are worth nothing: no world names them, so nothing can read
-- them.
set search_path = public;

delete from resource_version v
 where not exists (select 1 from layer l where l.id = v.layer_id);

alter table resource_version
  add constraint resource_version_layer_id_fkey
  foreign key (layer_id) references layer (id) on delete cascade;
