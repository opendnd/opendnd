-- The OHIR envelope, and FHIR element names throughout.
--
-- Every model is published as a resource specializing a FHIR base, so a
-- record now says `resourceType` rather than `model`, keeps the metadata the
-- platform maintains under `meta`, and points at the definition it conforms
-- to in `meta.profile`. Element names follow the same house style: the
-- classifying code is `type`, containment is `partOf`, a repeating element is
-- singular, and a reference carries `type` and `display` where it carried
-- `model` and `name`.
--
-- Bodies are rewritten in place, in `resource` and in every version kept in
-- `resource_version`, so history reads under the new names too.
set search_path = public;

/** The resource type a model is published as: `place` is a `Place`. */
create or replace function ohir_type_of(model text) returns text
language sql immutable as $fn$
  select upper(left(model, 1)) || substr(model, 2);
$fn$;

/*
 * A reference is an object carrying `model` and `id`, and it can sit at any
 * depth: on the record, inside a nested structure, or in an array of them.
 * Renaming one therefore means walking the body rather than naming the
 * places it can appear. Most of a body holds no reference at all, and
 * looking for the word in the serialised subtree is far cheaper than walking
 * every key of it.
 *
 * Never call this on a whole record: a record carries `model` and `id` too,
 * and would be mistaken for a reference to itself. The pass below applies it
 * to each of a record's values instead.
 */
create or replace function ohir_refs(node jsonb) returns jsonb
language sql immutable as $fn$
  select case
    when strpos(node::text, '"model"') = 0 then node
    when jsonb_typeof(node) = 'array' then
      coalesce(
        (select jsonb_agg(ohir_refs(e) order by ord)
           from jsonb_array_elements(node) with ordinality as t(e, ord)),
        '[]'::jsonb)
    when jsonb_typeof(node) = 'object' then
      (select case
                when o ? 'model' and o ? 'id'
                     and jsonb_typeof(o -> 'model') = 'string'
                then (o - 'model' - 'name')
                     || jsonb_build_object('type', ohir_type_of(o ->> 'model'))
                     || case when o ? 'name'
                             then jsonb_build_object('display', o -> 'name')
                             else '{}'::jsonb end
                else o
              end
         from (select coalesce(jsonb_object_agg(k, ohir_refs(v)), '{}'::jsonb)
                 from jsonb_each(node) as e(k, v)) as m(o))
    else node
  end;
$fn$;

-- `revision` reads a field that is about to move, so it goes and comes back.
alter table resource drop column revision;


-- resource: references, then the envelope, then each model's elements.

update resource set body =
  (select jsonb_object_agg(key, ohir_refs(value)) from jsonb_each(body))
 where strpos(body::text, '"model"') > 0;

update resource set body =
  (body - 'model' - 'recorded' - 'tags' - 'alternateNames' - 'citations')
  || jsonb_build_object(
       'resourceType', ohir_type_of(model),
       'meta', jsonb_strip_nulls(
         jsonb_build_object(
           'versionId', coalesce(body -> 'recorded' ->> 'revision', '1'),
           'lastUpdated', coalesce(body -> 'recorded' ->> 'updatedAt',
                                   body -> 'recorded' ->> 'createdAt'),
           'profile', jsonb_build_array(
             'https://docs.opendnd.org/ours/models/' || model || '.json'))
         || case when body ? 'tags'
                 then jsonb_build_object(
                        'tag',
                        (select coalesce(
                                  jsonb_agg(jsonb_build_object('code', tag)),
                                  '[]'::jsonb)
                           from jsonb_array_elements_text(body -> 'tags')
                                  as tag))
                 else '{}'::jsonb end))
  || case when body ? 'alternateNames'
          then jsonb_build_object('alternateName', body -> 'alternateNames')
          else '{}'::jsonb end
  || case when body ? 'citations'
          then jsonb_build_object('citation', body -> 'citations')
          else '{}'::jsonb end
  || case when body ? 'provenance'
               or body -> 'recorded' ? 'createdAt'
               or body -> 'recorded' ? 'author'
          then jsonb_build_object(
                 'provenance',
                 jsonb_strip_nulls(
                   coalesce(body -> 'provenance', '{}'::jsonb)
                   || jsonb_build_object(
                        'recorded', body -> 'recorded' -> 'createdAt')
                   || case when body -> 'provenance' ? 'attributedTo'
                           then '{}'::jsonb
                           else jsonb_build_object(
                                  'attributedTo',
                                  body -> 'recorded' -> 'author')
                      end))
          else '{}'::jsonb end;

update resource set body = (body - 'abilityScores' - 'proficiencies' - 'proficiencyChoices' - 'startingEquipmentOptions')
  || case when body ? 'abilityScores'
          then jsonb_build_object('abilityScore', body -> 'abilityScores')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'startingEquipmentOptions'
          then jsonb_build_object('startingEquipmentOption', body -> 'startingEquipmentOptions')
          else '{}'::jsonb end
 where model = 'background' and body ?| array['abilityScores', 'proficiencies', 'proficiencyChoices', 'startingEquipmentOptions'];

update resource set body = (body - 'about')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
 where model = 'belief' and body ?| array['about'];

update resource set body = (body - 'eras' - 'months' - 'moons' - 'seasons' - 'weekdays')
  || case when body ? 'eras'
          then jsonb_build_object('era', body -> 'eras')
          else '{}'::jsonb end
  || case when body ? 'months'
          then jsonb_build_object('month', body -> 'months')
          else '{}'::jsonb end
  || case when body ? 'moons'
          then jsonb_build_object('moon', body -> 'moons')
          else '{}'::jsonb end
  || case when body ? 'seasons'
          then jsonb_build_object('season', body -> 'seasons')
          else '{}'::jsonb end
  || case when body ? 'weekdays'
          then jsonb_build_object('weekday', body -> 'weekdays')
          else '{}'::jsonb end
 where model = 'calendar' and body ?| array['eras', 'months', 'moons', 'seasons', 'weekdays'];

update resource set body = (body - 'characters' - 'players')
  || case when body ? 'characters'
          then jsonb_build_object('character', body -> 'characters')
          else '{}'::jsonb end
  || case when body ? 'players'
          then jsonb_build_object('player', body -> 'players')
          else '{}'::jsonb end
 where model = 'campaign' and body ?| array['characters', 'players'];

update resource set body = (body - 'choices' - 'classes' - 'conditions' - 'feats' - 'proficiencies' - 'spells')
  || case when body ? 'choices'
          then jsonb_build_object('choice', body -> 'choices')
          else '{}'::jsonb end
  || case when body ? 'classes'
          then jsonb_build_object('class', body -> 'classes')
          else '{}'::jsonb end
  || case when body ? 'conditions'
          then jsonb_build_object('condition', body -> 'conditions')
          else '{}'::jsonb end
  || case when body ? 'feats'
          then jsonb_build_object('feat', body -> 'feats')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spellcasting', body -> 'spells')
          else '{}'::jsonb end
 where model = 'character' and body ?| array['choices', 'classes', 'conditions', 'feats', 'proficiencies', 'spells'];

update resource set body = (body - 'levels' - 'primaryAbilityOptions' - 'proficiencies' - 'proficiencyChoices' - 'savingThrows' - 'spells' - 'startingEquipmentOptions')
  || case when body ? 'levels'
          then jsonb_build_object('level', body -> 'levels')
          else '{}'::jsonb end
  || case when body ? 'primaryAbilityOptions'
          then jsonb_build_object('primaryAbilityOption', body -> 'primaryAbilityOptions')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'savingThrows'
          then jsonb_build_object('savingThrow', body -> 'savingThrows')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spell', body -> 'spells')
          else '{}'::jsonb end
  || case when body ? 'startingEquipmentOptions'
          then jsonb_build_object('startingEquipmentOption', body -> 'startingEquipmentOptions')
          else '{}'::jsonb end
 where model = 'class' and body ?| array['levels', 'primaryAbilityOptions', 'proficiencies', 'proficiencyChoices', 'savingThrows', 'spells', 'startingEquipmentOptions'];

update resource set body = (body - 'languages')
  || case when body ? 'languages'
          then jsonb_build_object('language', body -> 'languages')
          else '{}'::jsonb end
 where model = 'culture' and body ?| array['languages'];

update resource set body = (body - 'at' - 'industries' - 'place')
  || case when body ? 'at'
          then jsonb_build_object('effective', body -> 'at')
          else '{}'::jsonb end
  || case when body ? 'industries'
          then jsonb_build_object('industry', body -> 'industries')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('subject', body -> 'place')
          else '{}'::jsonb end
 where model = 'economy' and body ?| array['at', 'industries', 'place'];

update resource set body = (body - 'adversaries' - 'kind' - 'place')
  || case when body ? 'adversaries'
          then jsonb_build_object('adversary', body -> 'adversaries')
          else '{}'::jsonb end
  || case when body ? 'kind'
          then jsonb_build_object('type', body -> 'kind')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('location', body -> 'place')
          else '{}'::jsonb end
 where model = 'encounter' and body ?| array['adversaries', 'kind', 'place'];

update resource set body = (body - 'eventType' - 'locations' - 'participants' - 'when')
  || case when body ? 'eventType'
          then jsonb_build_object('type', body -> 'eventType')
          else '{}'::jsonb end
  || case when body ? 'locations'
          then jsonb_build_object('location', body -> 'locations')
          else '{}'::jsonb end
  || case when body ? 'participants'
          then jsonb_build_object('participant', body -> 'participants')
          else '{}'::jsonb end
  || case when body ? 'when'
          then jsonb_build_object('occurred', body -> 'when')
          else '{}'::jsonb end
 where model = 'event' and body ?| array['eventType', 'locations', 'participants', 'when'];

update resource set body = (body - 'factionType' - 'parent')
  || case when body ? 'factionType'
          then jsonb_build_object('type', body -> 'factionType')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('partOf', body -> 'parent')
          else '{}'::jsonb end
 where model = 'faction' and body ?| array['factionType', 'parent'];

update resource set body = (body - 'featType' - 'prerequisiteOptions' - 'prerequisites')
  || case when body ? 'featType'
          then jsonb_build_object('type', body -> 'featType')
          else '{}'::jsonb end
  || case when body ? 'prerequisiteOptions'
          then jsonb_build_object('prerequisiteOption', body -> 'prerequisiteOptions')
          else '{}'::jsonb end
  || case when body ? 'prerequisites'
          then jsonb_build_object('prerequisite', body -> 'prerequisites')
          else '{}'::jsonb end
 where model = 'feat' and body ?| array['featType', 'prerequisiteOptions', 'prerequisites'];

update resource set body = (body - 'proficiencyChoices' - 'spells')
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spell', body -> 'spells')
          else '{}'::jsonb end
 where model = 'feature' and body ?| array['proficiencyChoices', 'spells'];

update resource set body = (body - 'itemCategory' - 'properties' - 'variants')
  || case when body ? 'itemCategory'
          then jsonb_build_object('type', body -> 'itemCategory')
          else '{}'::jsonb end
  || case when body ? 'properties'
          then jsonb_build_object('property', body -> 'properties')
          else '{}'::jsonb end
  || case when body ? 'variants'
          then jsonb_build_object('form', body -> 'variants')
          else '{}'::jsonb end
 where model = 'item' and body ?| array['itemCategory', 'properties', 'variants'];

update resource set body = (body - 'sex')
  || case when body ? 'sex'
          then jsonb_build_object('gender', body -> 'sex')
          else '{}'::jsonb end
 where model = 'person' and body ?| array['sex'];

update resource set body = (body - 'controlledBy' - 'parent' - 'placeType' - 'resources')
  || case when body ? 'controlledBy'
          then jsonb_build_object('managingOrganization', body -> 'controlledBy')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('partOf', body -> 'parent')
          else '{}'::jsonb end
  || case when body ? 'placeType'
          then jsonb_build_object('type', body -> 'placeType')
          else '{}'::jsonb end
  || case when body ? 'resources'
          then jsonb_build_object('resource', body -> 'resources')
          else '{}'::jsonb end
 where model = 'place' and body ?| array['controlledBy', 'parent', 'placeType', 'resources'];

update resource set body = (body - 'at' - 'place')
  || case when body ? 'at'
          then jsonb_build_object('effective', body -> 'at')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('subject', body -> 'place')
          else '{}'::jsonb end
 where model = 'population' and body ?| array['at', 'place'];

update resource set body = (body - 'proficiencyType')
  || case when body ? 'proficiencyType'
          then jsonb_build_object('type', body -> 'proficiencyType')
          else '{}'::jsonb end
 where model = 'proficiency' and body ?| array['proficiencyType'];

update resource set body = (body - 'pages')
  || case when body ? 'pages'
          then jsonb_build_object('page', body -> 'pages')
          else '{}'::jsonb end
 where model = 'project' and body ?| array['pages'];

update resource set body = (body - 'about' - 'objectives')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
  || case when body ? 'objectives'
          then jsonb_build_object('objective', body -> 'objectives')
          else '{}'::jsonb end
 where model = 'quest' and body ?| array['about', 'objectives'];

update resource set body = (body - 'facts' - 'relationshipType')
  || case when body ? 'facts'
          then jsonb_build_object('fact', body -> 'facts')
          else '{}'::jsonb end
  || case when body ? 'relationshipType'
          then jsonb_build_object('type', body -> 'relationshipType')
          else '{}'::jsonb end
 where model = 'relationship' and body ?| array['facts', 'relationshipType'];

update resource set body = (body - 'creatureType' - 'parent' - 'sizeOptions')
  || case when body ? 'creatureType'
          then jsonb_build_object('type', body -> 'creatureType')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('subclassOf', body -> 'parent')
          else '{}'::jsonb end
  || case when body ? 'sizeOptions'
          then jsonb_build_object('sizeOption', body -> 'sizeOptions')
          else '{}'::jsonb end
 where model = 'species' and body ?| array['creatureType', 'parent', 'sizeOptions'];

update resource set body = (body - 'classes' - 'components')
  || case when body ? 'classes'
          then jsonb_build_object('class', body -> 'classes')
          else '{}'::jsonb end
  || case when body ? 'components'
          then jsonb_build_object('component', body -> 'components')
          else '{}'::jsonb end
 where model = 'spell' and body ?| array['classes', 'components'];

update resource set body = (body - 'actions' - 'bonusActions' - 'conditionImmunities' - 'creatureType' - 'damageImmunities' - 'damageResistances' - 'damageVulnerabilities' - 'languages' - 'legendaryActions' - 'proficiencies' - 'reactions' - 'traits')
  || case when body ? 'actions'
          then jsonb_build_object('action', body -> 'actions')
          else '{}'::jsonb end
  || case when body ? 'bonusActions'
          then jsonb_build_object('bonusAction', body -> 'bonusActions')
          else '{}'::jsonb end
  || case when body ? 'conditionImmunities'
          then jsonb_build_object('conditionImmunity', body -> 'conditionImmunities')
          else '{}'::jsonb end
  || case when body ? 'creatureType'
          then jsonb_build_object('type', body -> 'creatureType')
          else '{}'::jsonb end
  || case when body ? 'damageImmunities'
          then jsonb_build_object('damageImmunity', body -> 'damageImmunities')
          else '{}'::jsonb end
  || case when body ? 'damageResistances'
          then jsonb_build_object('damageResistance', body -> 'damageResistances')
          else '{}'::jsonb end
  || case when body ? 'damageVulnerabilities'
          then jsonb_build_object('damageVulnerability', body -> 'damageVulnerabilities')
          else '{}'::jsonb end
  || case when body ? 'languages'
          then jsonb_build_object('language', body -> 'languages')
          else '{}'::jsonb end
  || case when body ? 'legendaryActions'
          then jsonb_build_object('legendaryAction', body -> 'legendaryActions')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'reactions'
          then jsonb_build_object('reaction', body -> 'reactions')
          else '{}'::jsonb end
  || case when body ? 'traits'
          then jsonb_build_object('trait', body -> 'traits')
          else '{}'::jsonb end
 where model = 'statblock' and body ?| array['actions', 'bonusActions', 'conditionImmunities', 'creatureType', 'damageImmunities', 'damageResistances', 'damageVulnerabilities', 'languages', 'legendaryActions', 'proficiencies', 'reactions', 'traits'];

update resource set body = (body - 'about' - 'workType')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
  || case when body ? 'workType'
          then jsonb_build_object('type', body -> 'workType')
          else '{}'::jsonb end
 where model = 'work' and body ?| array['about', 'workType'];



-- resource_version: references, then the envelope, then each model's elements.

update resource_version set body =
  (select jsonb_object_agg(key, ohir_refs(value)) from jsonb_each(body))
 where strpos(body::text, '"model"') > 0;

update resource_version set body =
  (body - 'model' - 'recorded' - 'tags' - 'alternateNames' - 'citations')
  || jsonb_build_object(
       'resourceType', ohir_type_of(model),
       'meta', jsonb_strip_nulls(
         jsonb_build_object(
           'versionId', coalesce(body -> 'recorded' ->> 'revision', '1'),
           'lastUpdated', coalesce(body -> 'recorded' ->> 'updatedAt',
                                   body -> 'recorded' ->> 'createdAt'),
           'profile', jsonb_build_array(
             'https://docs.opendnd.org/ours/models/' || model || '.json'))
         || case when body ? 'tags'
                 then jsonb_build_object(
                        'tag',
                        (select coalesce(
                                  jsonb_agg(jsonb_build_object('code', tag)),
                                  '[]'::jsonb)
                           from jsonb_array_elements_text(body -> 'tags')
                                  as tag))
                 else '{}'::jsonb end))
  || case when body ? 'alternateNames'
          then jsonb_build_object('alternateName', body -> 'alternateNames')
          else '{}'::jsonb end
  || case when body ? 'citations'
          then jsonb_build_object('citation', body -> 'citations')
          else '{}'::jsonb end
  || case when body ? 'provenance'
               or body -> 'recorded' ? 'createdAt'
               or body -> 'recorded' ? 'author'
          then jsonb_build_object(
                 'provenance',
                 jsonb_strip_nulls(
                   coalesce(body -> 'provenance', '{}'::jsonb)
                   || jsonb_build_object(
                        'recorded', body -> 'recorded' -> 'createdAt')
                   || case when body -> 'provenance' ? 'attributedTo'
                           then '{}'::jsonb
                           else jsonb_build_object(
                                  'attributedTo',
                                  body -> 'recorded' -> 'author')
                      end))
          else '{}'::jsonb end;

update resource_version set body = (body - 'abilityScores' - 'proficiencies' - 'proficiencyChoices' - 'startingEquipmentOptions')
  || case when body ? 'abilityScores'
          then jsonb_build_object('abilityScore', body -> 'abilityScores')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'startingEquipmentOptions'
          then jsonb_build_object('startingEquipmentOption', body -> 'startingEquipmentOptions')
          else '{}'::jsonb end
 where model = 'background' and body ?| array['abilityScores', 'proficiencies', 'proficiencyChoices', 'startingEquipmentOptions'];

update resource_version set body = (body - 'about')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
 where model = 'belief' and body ?| array['about'];

update resource_version set body = (body - 'eras' - 'months' - 'moons' - 'seasons' - 'weekdays')
  || case when body ? 'eras'
          then jsonb_build_object('era', body -> 'eras')
          else '{}'::jsonb end
  || case when body ? 'months'
          then jsonb_build_object('month', body -> 'months')
          else '{}'::jsonb end
  || case when body ? 'moons'
          then jsonb_build_object('moon', body -> 'moons')
          else '{}'::jsonb end
  || case when body ? 'seasons'
          then jsonb_build_object('season', body -> 'seasons')
          else '{}'::jsonb end
  || case when body ? 'weekdays'
          then jsonb_build_object('weekday', body -> 'weekdays')
          else '{}'::jsonb end
 where model = 'calendar' and body ?| array['eras', 'months', 'moons', 'seasons', 'weekdays'];

update resource_version set body = (body - 'characters' - 'players')
  || case when body ? 'characters'
          then jsonb_build_object('character', body -> 'characters')
          else '{}'::jsonb end
  || case when body ? 'players'
          then jsonb_build_object('player', body -> 'players')
          else '{}'::jsonb end
 where model = 'campaign' and body ?| array['characters', 'players'];

update resource_version set body = (body - 'choices' - 'classes' - 'conditions' - 'feats' - 'proficiencies' - 'spells')
  || case when body ? 'choices'
          then jsonb_build_object('choice', body -> 'choices')
          else '{}'::jsonb end
  || case when body ? 'classes'
          then jsonb_build_object('class', body -> 'classes')
          else '{}'::jsonb end
  || case when body ? 'conditions'
          then jsonb_build_object('condition', body -> 'conditions')
          else '{}'::jsonb end
  || case when body ? 'feats'
          then jsonb_build_object('feat', body -> 'feats')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spellcasting', body -> 'spells')
          else '{}'::jsonb end
 where model = 'character' and body ?| array['choices', 'classes', 'conditions', 'feats', 'proficiencies', 'spells'];

update resource_version set body = (body - 'levels' - 'primaryAbilityOptions' - 'proficiencies' - 'proficiencyChoices' - 'savingThrows' - 'spells' - 'startingEquipmentOptions')
  || case when body ? 'levels'
          then jsonb_build_object('level', body -> 'levels')
          else '{}'::jsonb end
  || case when body ? 'primaryAbilityOptions'
          then jsonb_build_object('primaryAbilityOption', body -> 'primaryAbilityOptions')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'savingThrows'
          then jsonb_build_object('savingThrow', body -> 'savingThrows')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spell', body -> 'spells')
          else '{}'::jsonb end
  || case when body ? 'startingEquipmentOptions'
          then jsonb_build_object('startingEquipmentOption', body -> 'startingEquipmentOptions')
          else '{}'::jsonb end
 where model = 'class' and body ?| array['levels', 'primaryAbilityOptions', 'proficiencies', 'proficiencyChoices', 'savingThrows', 'spells', 'startingEquipmentOptions'];

update resource_version set body = (body - 'languages')
  || case when body ? 'languages'
          then jsonb_build_object('language', body -> 'languages')
          else '{}'::jsonb end
 where model = 'culture' and body ?| array['languages'];

update resource_version set body = (body - 'at' - 'industries' - 'place')
  || case when body ? 'at'
          then jsonb_build_object('effective', body -> 'at')
          else '{}'::jsonb end
  || case when body ? 'industries'
          then jsonb_build_object('industry', body -> 'industries')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('subject', body -> 'place')
          else '{}'::jsonb end
 where model = 'economy' and body ?| array['at', 'industries', 'place'];

update resource_version set body = (body - 'adversaries' - 'kind' - 'place')
  || case when body ? 'adversaries'
          then jsonb_build_object('adversary', body -> 'adversaries')
          else '{}'::jsonb end
  || case when body ? 'kind'
          then jsonb_build_object('type', body -> 'kind')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('location', body -> 'place')
          else '{}'::jsonb end
 where model = 'encounter' and body ?| array['adversaries', 'kind', 'place'];

update resource_version set body = (body - 'eventType' - 'locations' - 'participants' - 'when')
  || case when body ? 'eventType'
          then jsonb_build_object('type', body -> 'eventType')
          else '{}'::jsonb end
  || case when body ? 'locations'
          then jsonb_build_object('location', body -> 'locations')
          else '{}'::jsonb end
  || case when body ? 'participants'
          then jsonb_build_object('participant', body -> 'participants')
          else '{}'::jsonb end
  || case when body ? 'when'
          then jsonb_build_object('occurred', body -> 'when')
          else '{}'::jsonb end
 where model = 'event' and body ?| array['eventType', 'locations', 'participants', 'when'];

update resource_version set body = (body - 'factionType' - 'parent')
  || case when body ? 'factionType'
          then jsonb_build_object('type', body -> 'factionType')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('partOf', body -> 'parent')
          else '{}'::jsonb end
 where model = 'faction' and body ?| array['factionType', 'parent'];

update resource_version set body = (body - 'featType' - 'prerequisiteOptions' - 'prerequisites')
  || case when body ? 'featType'
          then jsonb_build_object('type', body -> 'featType')
          else '{}'::jsonb end
  || case when body ? 'prerequisiteOptions'
          then jsonb_build_object('prerequisiteOption', body -> 'prerequisiteOptions')
          else '{}'::jsonb end
  || case when body ? 'prerequisites'
          then jsonb_build_object('prerequisite', body -> 'prerequisites')
          else '{}'::jsonb end
 where model = 'feat' and body ?| array['featType', 'prerequisiteOptions', 'prerequisites'];

update resource_version set body = (body - 'proficiencyChoices' - 'spells')
  || case when body ? 'proficiencyChoices'
          then jsonb_build_object('proficiencyChoice', body -> 'proficiencyChoices')
          else '{}'::jsonb end
  || case when body ? 'spells'
          then jsonb_build_object('spell', body -> 'spells')
          else '{}'::jsonb end
 where model = 'feature' and body ?| array['proficiencyChoices', 'spells'];

update resource_version set body = (body - 'itemCategory' - 'properties' - 'variants')
  || case when body ? 'itemCategory'
          then jsonb_build_object('type', body -> 'itemCategory')
          else '{}'::jsonb end
  || case when body ? 'properties'
          then jsonb_build_object('property', body -> 'properties')
          else '{}'::jsonb end
  || case when body ? 'variants'
          then jsonb_build_object('form', body -> 'variants')
          else '{}'::jsonb end
 where model = 'item' and body ?| array['itemCategory', 'properties', 'variants'];

update resource_version set body = (body - 'sex')
  || case when body ? 'sex'
          then jsonb_build_object('gender', body -> 'sex')
          else '{}'::jsonb end
 where model = 'person' and body ?| array['sex'];

update resource_version set body = (body - 'controlledBy' - 'parent' - 'placeType' - 'resources')
  || case when body ? 'controlledBy'
          then jsonb_build_object('managingOrganization', body -> 'controlledBy')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('partOf', body -> 'parent')
          else '{}'::jsonb end
  || case when body ? 'placeType'
          then jsonb_build_object('type', body -> 'placeType')
          else '{}'::jsonb end
  || case when body ? 'resources'
          then jsonb_build_object('resource', body -> 'resources')
          else '{}'::jsonb end
 where model = 'place' and body ?| array['controlledBy', 'parent', 'placeType', 'resources'];

update resource_version set body = (body - 'at' - 'place')
  || case when body ? 'at'
          then jsonb_build_object('effective', body -> 'at')
          else '{}'::jsonb end
  || case when body ? 'place'
          then jsonb_build_object('subject', body -> 'place')
          else '{}'::jsonb end
 where model = 'population' and body ?| array['at', 'place'];

update resource_version set body = (body - 'proficiencyType')
  || case when body ? 'proficiencyType'
          then jsonb_build_object('type', body -> 'proficiencyType')
          else '{}'::jsonb end
 where model = 'proficiency' and body ?| array['proficiencyType'];

update resource_version set body = (body - 'pages')
  || case when body ? 'pages'
          then jsonb_build_object('page', body -> 'pages')
          else '{}'::jsonb end
 where model = 'project' and body ?| array['pages'];

update resource_version set body = (body - 'about' - 'objectives')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
  || case when body ? 'objectives'
          then jsonb_build_object('objective', body -> 'objectives')
          else '{}'::jsonb end
 where model = 'quest' and body ?| array['about', 'objectives'];

update resource_version set body = (body - 'facts' - 'relationshipType')
  || case when body ? 'facts'
          then jsonb_build_object('fact', body -> 'facts')
          else '{}'::jsonb end
  || case when body ? 'relationshipType'
          then jsonb_build_object('type', body -> 'relationshipType')
          else '{}'::jsonb end
 where model = 'relationship' and body ?| array['facts', 'relationshipType'];

update resource_version set body = (body - 'creatureType' - 'parent' - 'sizeOptions')
  || case when body ? 'creatureType'
          then jsonb_build_object('type', body -> 'creatureType')
          else '{}'::jsonb end
  || case when body ? 'parent'
          then jsonb_build_object('subclassOf', body -> 'parent')
          else '{}'::jsonb end
  || case when body ? 'sizeOptions'
          then jsonb_build_object('sizeOption', body -> 'sizeOptions')
          else '{}'::jsonb end
 where model = 'species' and body ?| array['creatureType', 'parent', 'sizeOptions'];

update resource_version set body = (body - 'classes' - 'components')
  || case when body ? 'classes'
          then jsonb_build_object('class', body -> 'classes')
          else '{}'::jsonb end
  || case when body ? 'components'
          then jsonb_build_object('component', body -> 'components')
          else '{}'::jsonb end
 where model = 'spell' and body ?| array['classes', 'components'];

update resource_version set body = (body - 'actions' - 'bonusActions' - 'conditionImmunities' - 'creatureType' - 'damageImmunities' - 'damageResistances' - 'damageVulnerabilities' - 'languages' - 'legendaryActions' - 'proficiencies' - 'reactions' - 'traits')
  || case when body ? 'actions'
          then jsonb_build_object('action', body -> 'actions')
          else '{}'::jsonb end
  || case when body ? 'bonusActions'
          then jsonb_build_object('bonusAction', body -> 'bonusActions')
          else '{}'::jsonb end
  || case when body ? 'conditionImmunities'
          then jsonb_build_object('conditionImmunity', body -> 'conditionImmunities')
          else '{}'::jsonb end
  || case when body ? 'creatureType'
          then jsonb_build_object('type', body -> 'creatureType')
          else '{}'::jsonb end
  || case when body ? 'damageImmunities'
          then jsonb_build_object('damageImmunity', body -> 'damageImmunities')
          else '{}'::jsonb end
  || case when body ? 'damageResistances'
          then jsonb_build_object('damageResistance', body -> 'damageResistances')
          else '{}'::jsonb end
  || case when body ? 'damageVulnerabilities'
          then jsonb_build_object('damageVulnerability', body -> 'damageVulnerabilities')
          else '{}'::jsonb end
  || case when body ? 'languages'
          then jsonb_build_object('language', body -> 'languages')
          else '{}'::jsonb end
  || case when body ? 'legendaryActions'
          then jsonb_build_object('legendaryAction', body -> 'legendaryActions')
          else '{}'::jsonb end
  || case when body ? 'proficiencies'
          then jsonb_build_object('proficiency', body -> 'proficiencies')
          else '{}'::jsonb end
  || case when body ? 'reactions'
          then jsonb_build_object('reaction', body -> 'reactions')
          else '{}'::jsonb end
  || case when body ? 'traits'
          then jsonb_build_object('trait', body -> 'traits')
          else '{}'::jsonb end
 where model = 'statblock' and body ?| array['actions', 'bonusActions', 'conditionImmunities', 'creatureType', 'damageImmunities', 'damageResistances', 'damageVulnerabilities', 'languages', 'legendaryActions', 'proficiencies', 'reactions', 'traits'];

update resource_version set body = (body - 'about' - 'workType')
  || case when body ? 'about'
          then jsonb_build_object('subject', body -> 'about')
          else '{}'::jsonb end
  || case when body ? 'workType'
          then jsonb_build_object('type', body -> 'workType')
          else '{}'::jsonb end
 where model = 'work' and body ?| array['about', 'workType'];



alter table resource add column revision int
  generated always as ((body -> 'meta' ->> 'versionId')::int) stored;

drop function ohir_refs(jsonb);
drop function ohir_type_of(text);
