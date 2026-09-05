---
title: "@opendnd/ontology"
description: The OpenDnD worldbuilding ontology, authored in OURS.
---

The bundle lives in `packages/@opendnd/ontology/ours/`. It is data, not code: JSON files that `@opendnd/ours` loads, validates and generates from. See [ADR-002](/adr/adr-002-ours-ontology/) for the reasoning.

## Models in the first slice

| Model | What it is | Aligned to |
|---|---|---|
| `world` | The fictional universe every other record belongs to | Wikidata fictional universe |
| `calendar` | A temporal reference system: months, weekdays, leap rules, moons, eras | OWL-Time TRS, Kanka calendars |
| `species` | A kind of creature and its biology: size, chromosomes, gene expressions, growth and age tables | schema.org Taxon, World Anvil Species |
| `culture` | A people's naming, languages and customs, separate from biology | World Anvil Ethnicity, Kanka |
| `person` | A person, real to the world or legendary | schema.org Person, Wikidata fictional human, CIDOC E21, GEDCOM X |
| `place` | A location at any scale, with optional geometry in the world's CRS | schema.org Place, CIDOC E53, GeoSPARQL Feature |
| `faction` | State, dynasty, faction, guild, religion | schema.org Organization, CIDOC E74, W3C ORG |
| `event` | Something that happened, with participants, roles and cause links | schema.org Event, CIDOC E5 |
| `relationship` | A tie between two parties (people, factions or places) with dated facts and succession fields | GEDCOM X Relationship |
| `work` | A creative work in-world or out-of-world | schema.org CreativeWork, CIDOC E73 |
| `language` | A language spoken or written in the world | schema.org Language, Wikidata language |

### The campaign layer

Records of play and preparation rather than of the world. All but `quest` are out-of-universe by default, stated in their own schemas so no client has to remember which is which. What happens at a table is still an `event`: an encounter that is played produces one, and a session references the events it produced. See [ADR-013](/adr/adr-013-campaign-layer/).

| Model | | Aligns to |
|---|---|---|
| `campaign` | A series of sessions a group plays in a world | schema.org EventSeries |
| `session` | One sitting, dated in real time | schema.org Event |
| `character` | A person as played, and by whom | schema.org Role |
| `quest` | Something a party is meant to do, and how far they have got | schema.org Action, CIDOC E7 |
| `encounter` | A confrontation prepared for a party | CIDOC E7 |

A dungeon is a `place` whose type is `dungeon` and a party is a `faction` whose type is `party`. Neither needed a model. A published adventure is a `module`, the content-addressed package, not a `work`: a `work` is something composed, and an adventure is a bundle of quests, encounters and places.

### The rules layer

Shapes only. No rules content ships in this repository; it arrives as modules that carry their own licence. The shapes follow the 5e SRD API's schemas, which are MIT-licensed code, so content written for that API converts to these records without reshaping. Its field names are `snake_case` and these are camelCase, which is a mechanical transform. See the [landscape](/research/landscape/) for why the data itself is not taken.

| Model | | Follows |
|---|---|---|
| `item` | Equipment, magic items and poisons, one model; a world's named sword points at the kind it is through `instanceOf` | 5e `equipment`, `magic-items` |
| `class` | A class and, through `subclassOf`, its subclasses; level progression is a table on the class | 5e `classes`, `subclasses`, `levels` |
| `feature` | Anything a character gains from a class, species, background, feat or item; `source` says which | 5e `features`, `traits` |
| `background` | Ability score increases, a feat and proficiencies, as the 2024 rules have it | 5e `backgrounds` |
| `feat` | A talent taken in place of or alongside an ability score increase | 5e `feats` |
| `spell` | Level, school, components, duration, what it does | 5e `spells` (2014 tree; the 2024 one is not yet published) |
| `statblock` | The rules view of a creature, independent of `species` as the SRD treats it; may name the species or person it stands for | 5e `monsters` |
| `condition` | A state that changes what a creature may do | 5e `conditions` |
| `skill` | A skill and the ability its checks use | 5e `skills` |
| `proficiency` | Being trained in a weapon, tool, skill or saving throw | 5e `proficiencies` |

`Choice` joins the platform shapes: "pick two from this list", which the rules use everywhere and which nests. It is the first recursive shape in the ontology, and the codegen emits it as a Zod getter so the reference resolves lazily.

A trap is an `encounter` whose `kind` is `trap`. A familiar is a `relationship` whose type is `familiar`. A vehicle is an `item` whose category is `mount`. A subspecies is a `species` with a `parent`. None of them needed a model.
| `belief` | A belief a holder has about a proposition, for contested history | CRMinf Belief |
| `title` | A seat of authority in a faction with a succession rule | W3C ORG Post |
| `tenure` | One person's time in an title, with the events that began and ended it | W3C ORG Membership |
| `population` | An aggregate head count at a place and time | schema.org Observation |
| `claim` | One person's asserted right to a title, and the seed of a war | schema.org Claim, CIDOC E30 Right |
| `economy` | A snapshot of a settlement's prosperity, businesses and livestock at a time | schema.org Observation |

## The base every model extends

`common.schema.json#/$defs/ResourceBase` gives every record: a random v4 `id` and a deterministic `derivedId`; the `model` it is an instance of; the `world` it belongs to; `canonStatus` and `perspective`; `validTime` for when the assertion holds in-world, derived by the store from the properties the schema names in `x-ours-valid-time` when a record does not state it ([ADR-014](/adr/adr-014-valid-time/)); `recorded` for when the record was written; `provenance` with generator, seed, derivation and the `source` document and licence of module content; `citations` into in-world works; and the `module` it shipped in. `id`, `model`, `world`, `recorded` and `module` are `readOnly`: the API sets them.

Shared definitions also cover `Reference`, `TemporalPosition` (a year, a named position, or both), `TimeSpan`, `Cell` for quadtree tokens, GeoJSON `Geometry` and `Feature` with an explicit CRS, `Provenance`, `Recorded`, `Citation` and the recursive `Choice`.

Every model schema extends the base through `allOf` and closes itself with `unevaluatedProperties: false`, which is how draft 2020-12 closes a schema that inherits properties. A test compiles every schema in Ajv's strict mode and validates the fixtures with it, so the published schemas mean the same thing to any validator as they do to the code generator.

## Vocabularies

Canon status, perspective, sex, person status, place type, faction type, event type, participant role, relationship type, relationship fact type, legitimacy, work type, belief value, temporal precision, creature size, name type, succession law, the nine SRD alignments on a three-by-three grid (order by goodness, each axis -1 to +1), terrain, prosperity, claim basis, campaign, character and quest status, encounter difficulty, feat type, sixty-one natural resources and ninety-one industries. Each is an OURS `Vocabulary` with inline codes, referenced from schemas through `x-ours-vocabulary`.
