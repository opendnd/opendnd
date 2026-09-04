-- What a front end needs to ask that the first schema could not answer:
-- "find this by name", "what is near here", and "what points at this".
set search_path = public;

-- Names are searched by substring, not by prefix, because a person looking
-- for the County of Itumeist types "itum". A trigram index makes that an
-- index scan rather than a scan of every row in the world.
create extension if not exists pg_trgm;

create index resource_name_trgm_idx on resource using gin (name gin_trgm_ops);

/*
 * The quadtree cell as a number.
 *
 * A cell token is the 64-bit id with its trailing zero nibbles removed, so a
 * descendant's token is not a prefix of its ancestor's and no text match can
 * find one. What is true is that the ids of a cell's descendants form a
 * contiguous range, which is why the identity is Z-ordered in the first
 * place. Padding the token back out to sixteen nibbles recovers the number,
 * and a bounding cell becomes `cell_id between min and max`: one index scan
 * for "every place inside this square", at any zoom level.
 */
alter table resource
  add column cell_id bigint generated always as (
    case
      when body ->> 'cell' is not null
        then ('x' || rpad(body ->> 'cell', 16, '0'))::bit(64)::bigint
    end
  ) stored;

create index resource_cell_idx on resource (layer_id, cell_id)
  where cell_id is not null;

-- "What points at this?" is a jsonpath match for a reference carrying an id,
-- anywhere in the body, which the existing jsonb_path_ops index serves.
comment on index resource_body_idx is
  'Serves reference lookups: body @? ''$.** ? (@.id == "...")''.';
