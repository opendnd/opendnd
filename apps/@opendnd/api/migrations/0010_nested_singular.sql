-- The singular rule, applied to elements that are not at the top.
--
-- A repeating element is named singular, and the pass that did that reached
-- only a record's own properties. Four elements nested inside another were
-- missed, and one of them mattered: a project is pages of `blocks`, so the
-- application went on writing a key the schema no longer had and creating a
-- project stopped working.
--
--   project.page[].blocks             -> block
--   class.multiclassing.prerequisites -> prerequisite
--   class.multiclassing.proficiencies -> proficiency
--   class.level[].features            -> feature
set search_path = public;

/* One renamed key inside every element of an array of objects. */
create or replace function ohir_in_array(node jsonb, old text, new text)
returns jsonb language sql immutable as $fn$
  select case when jsonb_typeof(node) <> 'array' then node else
    coalesce(
      (select jsonb_agg(
                case when e ? old
                     then (e - old) || jsonb_build_object(new, e -> old)
                     else e end
                order by ord)
         from jsonb_array_elements(node) with ordinality as t(e, ord)),
      '[]'::jsonb)
  end;
$fn$;

update resource set body =
  jsonb_set(body, '{page}', ohir_in_array(body -> 'page', 'blocks', 'block'))
 where model = 'project' and jsonb_typeof(body -> 'page') = 'array';
update resource_version set body =
  jsonb_set(body, '{page}', ohir_in_array(body -> 'page', 'blocks', 'block'))
 where model = 'project' and jsonb_typeof(body -> 'page') = 'array';

update resource set body =
  jsonb_set(body, '{level}', ohir_in_array(body -> 'level', 'features', 'feature'))
 where model = 'class' and jsonb_typeof(body -> 'level') = 'array';
update resource_version set body =
  jsonb_set(body, '{level}', ohir_in_array(body -> 'level', 'features', 'feature'))
 where model = 'class' and jsonb_typeof(body -> 'level') = 'array';

update resource set body = jsonb_set(
    body, '{multiclassing}',
    (body -> 'multiclassing') - 'prerequisites' - 'proficiencies'
    || case when body -> 'multiclassing' ? 'prerequisites'
            then jsonb_build_object(
                   'prerequisite', body -> 'multiclassing' -> 'prerequisites')
            else '{}'::jsonb end
    || case when body -> 'multiclassing' ? 'proficiencies'
            then jsonb_build_object(
                   'proficiency', body -> 'multiclassing' -> 'proficiencies')
            else '{}'::jsonb end)
 where model = 'class' and jsonb_typeof(body -> 'multiclassing') = 'object';
update resource_version set body = jsonb_set(
    body, '{multiclassing}',
    (body -> 'multiclassing') - 'prerequisites' - 'proficiencies'
    || case when body -> 'multiclassing' ? 'prerequisites'
            then jsonb_build_object(
                   'prerequisite', body -> 'multiclassing' -> 'prerequisites')
            else '{}'::jsonb end
    || case when body -> 'multiclassing' ? 'proficiencies'
            then jsonb_build_object(
                   'proficiency', body -> 'multiclassing' -> 'proficiencies')
            else '{}'::jsonb end)
 where model = 'class' and jsonb_typeof(body -> 'multiclassing') = 'object';

drop function ohir_in_array(jsonb, text, text);
