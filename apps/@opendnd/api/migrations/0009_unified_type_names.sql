-- Four resource types renamed, so the ontology can be published beside
-- others without two definitions claiming one name.
--
-- A resource type is a flat, global token: a reader dispatches on it, and a
-- canonical URL disambiguates the definition but not the value on the wire.
-- Four of these were already taken by resources that mean something else —
-- an Encounter is a clinical interaction, a Claim is an insurance claim, a
-- Condition is a diagnosis a patient has, and a Person is a person.
--
--   encounter  -> scene            a staged unit of action, in any medium
--   claim      -> title-claim      a claim to a seat, not to a car
--   person     -> character        the being in the fiction
--   character  -> character-sheet  that being as played, by someone
--
-- The last two are a swap and are done in that order. The person at the
-- table keeps the name Person, which is what they always were: a reference
-- to one now points outside this ontology, and that is the point.
set search_path = public;

-- The order matters: `character` is vacated before it is taken.
create temp table ohir_rename (old text primary key, new text, old_type text, new_type text, step int);
insert into ohir_rename values
  ('character', 'character-sheet', 'Character', 'CharacterSheet', 1),
  ('person',    'character',       'Person',    'Character',      2),
  ('encounter', 'scene',           'Encounter', 'Scene',          3),
  ('claim',     'title-claim',     'Claim',     'TitleClaim',     4);

do $$
declare r record;
begin
  for r in select * from ohir_rename order by step loop
    update resource set model = r.new where model = r.old;
    update resource_version set model = r.new where model = r.old;
  end loop;
end;
$$;

/*
 * A record says what it is, and so does every reference to one, at any
 * depth. Both carry the type rather than the model id, so both move.
 */
create or replace function ohir_retype(node jsonb) returns jsonb
language sql immutable as $fn$
  select case
    -- Nothing to do in a subtree that names none of the four.
    when strpos(node::text, '"Person"') = 0
     and strpos(node::text, '"Character"') = 0
     and strpos(node::text, '"Encounter"') = 0
     and strpos(node::text, '"Claim"') = 0 then node
    when jsonb_typeof(node) = 'array' then
      coalesce(
        (select jsonb_agg(ohir_retype(e) order by ord)
           from jsonb_array_elements(node) with ordinality as t(e, ord)),
        '[]'::jsonb)
    when jsonb_typeof(node) = 'object' then
      (select case
                when o ? 'type' and o ? 'id'
                     and jsonb_typeof(o -> 'type') = 'string'
                then o || jsonb_build_object(
                       'type',
                       coalesce(
                         (select n.new_type from ohir_rename n
                           where n.old_type = o ->> 'type'),
                         o ->> 'type'))
                else o
              end
         from (select coalesce(jsonb_object_agg(k, ohir_retype(v)), '{}'::jsonb)
                 from jsonb_each(node) as e(k, v)) as m(o))
    else node
  end;
$fn$;

-- References first, applied to a record's values rather than to the record,
-- which carries a `type`-shaped pair of its own.
update resource set body =
  (select jsonb_object_agg(key, ohir_retype(value)) from jsonb_each(body))
 where strpos(body::text, '"type"') > 0;
update resource_version set body =
  (select jsonb_object_agg(key, ohir_retype(value)) from jsonb_each(body))
 where strpos(body::text, '"type"') > 0;

-- Then the record's own type and the profile it names.
update resource r set body = r.body || jsonb_build_object(
    'resourceType', n.new_type,
    'meta', coalesce(r.body -> 'meta', '{}'::jsonb) || jsonb_build_object(
      'profile', jsonb_build_array(
        'https://docs.opendnd.org/ours/models/' || n.new || '.json')))
  from ohir_rename n where r.body ->> 'resourceType' = n.old_type;
update resource_version v set body = v.body || jsonb_build_object(
    'resourceType', n.new_type,
    'meta', coalesce(v.body -> 'meta', '{}'::jsonb) || jsonb_build_object(
      'profile', jsonb_build_array(
        'https://docs.opendnd.org/ours/models/' || n.new || '.json')))
  from ohir_rename n where v.body ->> 'resourceType' = n.old_type;

/*
 * Elements the swap made ambiguous. A sheet points at the character it is a
 * sheet for; a stat block stands for a character rather than for anyone at
 * the table; and a campaign's roster is sheets, which `character` would now
 * read as the beings themselves.
 */
update resource set body = (body - 'person')
  || jsonb_build_object('character', body -> 'person')
 where model = 'character-sheet' and body ? 'person';
update resource_version set body = (body - 'person')
  || jsonb_build_object('character', body -> 'person')
 where model = 'character-sheet' and body ? 'person';

update resource set body = (body - 'person')
  || jsonb_build_object('character', body -> 'person')
 where model = 'statblock' and body ? 'person';
update resource_version set body = (body - 'person')
  || jsonb_build_object('character', body -> 'person')
 where model = 'statblock' and body ? 'person';

update resource set body = (body - 'character')
  || jsonb_build_object('sheet', body -> 'character')
 where model = 'campaign' and body ? 'character';
update resource_version set body = (body - 'character')
  || jsonb_build_object('sheet', body -> 'character')
 where model = 'campaign' and body ? 'character';

/*
 * A sheet's `player` was a user id in a string; it is a reference to the
 * person at the table, who lives in another ontology. A value that is not
 * an id cannot be made into one, so it is dropped rather than guessed at.
 */
update resource set body = (body - 'player')
  || case when body ->> 'player' ~ '^[0-9a-f-]{36}$'
          then jsonb_build_object(
                 'player',
                 jsonb_build_object('type', 'Person', 'id', body ->> 'player'))
          else '{}'::jsonb end
 where model = 'character-sheet' and jsonb_typeof(body -> 'player') = 'string';
update resource_version set body = (body - 'player')
  || case when body ->> 'player' ~ '^[0-9a-f-]{36}$'
          then jsonb_build_object(
                 'player',
                 jsonb_build_object('type', 'Person', 'id', body ->> 'player'))
          else '{}'::jsonb end
 where model = 'character-sheet' and jsonb_typeof(body -> 'player') = 'string';

drop function ohir_retype(jsonb);
drop table ohir_rename;
