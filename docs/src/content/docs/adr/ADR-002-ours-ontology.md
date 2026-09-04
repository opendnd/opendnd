---
title: "ADR-002: One ontology in OURS, three layers, aligned to published vocabularies"
description: OpenDnD owns the setting-and-history layer, aligns rules content to existing formats, and mints only what no vocabulary covers.
---

**Status:** Accepted, 2026-09-03

## Context

The [landscape research](/research/landscape/) found that rules content (classes, spells, monsters, items) has de facto standards, while no open, specified model exists for setting and history content (places, factions, events, eras, calendars). Formal RPG and narrative ontologies model play structure or story theory, not a game master's canonical world state. OURS is a published format for describing an ontology and its alignments to other standards; nothing in worldbuilding uses it yet.

## Decision

The ontology is authored in OURS (Ontology, Model, Vocabulary resources; each Model points at a JSON Schema and carries `relationships` and `mapsTo`). It has three layers.

1. **Rules layer.** Shapes round-trip with the 5e-database 2024 tree. Provenance follows Open5e's `document` / `license` / `publisher` / `gamesystem` model. Battlemaps use Universal VTT verbatim. Stat blocks are linked to setting entities by id, never embedded.
2. **Setting and history layer.** Owned by OpenDnD. Class and property names align to schema.org (`Person`, `Place`, `Organization`, `Event`, `CreativeWork`). Fiction linkage follows Wikidata (`narrativeUniverse`, `presentInWork`, `fictionalAnalogOf`, per-statement in-universe / out-of-universe perspective). Events and periods follow CIDOC-CRM shapes with fuzzy time-span bounds; contested facts and canon status use CRMinf's reified Belief. In-world dates use OWL-Time temporal positions with a per-world temporal reference system and Allen relations; calendar definitions follow Kanka's schema. Kinship uses GEDCOM X relationships extended for succession. Geometry is GeoJSON with an out-of-band CRS per world. Provenance is PROV-O.
3. **Platform layer.** Concepts no vocabulary covers, minted by OpenDnD: canon status tiers (canon, non-canon, proposed, generated, player-authored); three-way time (in-world, authoring, transaction); calendar definitions; procedural seed and generator lineage; a non-Earth CRS registry; species and culture as distinct axes; faction game-stat side-cars; event collections with cause links.

Every record is an assertion carrying a valid-time interval, a transaction time, a provenance record, a canon status and, when generated, a seed. Entity ids are random v4; deterministic v5 ids live in a derived field so regeneration is idempotent and renames never break references.

## Consequences

- OpenDnD becomes the proof that OURS is domain-agnostic, and the OURS npm/bun tooling we build is meant for other domains too.
- Generated TypeScript types and Zod schemas are emitted from the OURS bundle and drift-checked in CI.
- Old `core` types are source material, not the schema. Its 35 entity types, semantic UUIDs and one-line definitions are ported into OURS Models where they fit.

## Naming, reviewed 2026-09-04

Every model, field and code was read through once before the ontology was treated as settled. The decisions, and the reasons, so that reopening any of them starts from an argument rather than from scratch:

## The rules layer, decided 2026-09-04

- **Shapes only, no content.** The ontology ships the schemas for rules content and none of the content. Rules text is licensed material; the shapes are not, and keeping them apart means the repository carries no licence obligation beyond MIT and the platform stays forkable. Content arrives as modules, each carrying its own licence — CC-BY-4.0 for the SRD, and whatever a publisher chooses for theirs.
- **Aligned to the 5e SRD API's schemas**, which are MIT-licensed code even though the data they describe is OGL 1.0a. Structure is interoperability; the licensed expression is the data, and none of it is taken. The 2024 tree is the reference; `spell` follows the 2014 tree because the 2024 one has not been published, and the 2024 rules keep its structure.
- **Field names are camelCase**, per the convention above, where the API's are `snake_case`. That is a mechanical transform an importer performs in one line, and it keeps the ontology consistent with itself.
- **`statblock` is not `species`.** The SRD treats a monster as an independent stat block with no species reference, and a stat block is often a variant — a goblin boss — with no species of its own. It may name the species or the person it stands for.
- **One `item` for equipment, magic items and poisons**, because the rules treat them alike and only the applicable fields are filled. A world's own named object points at the kind it is an instance of; the kind ships in a module.
- **One `feature` for class features and species traits**, distinguished by `source`. **A trap is an `encounter`, a familiar is a `relationship`, a vehicle is an `item`.**
- **`Choice` is a platform shape**, recursive, because "pick two from this list" is everywhere in the rules and nests. It is the first recursive shape in the ontology, and the codegen emits recursion as a Zod getter.

## Naming conventions

Verified against the ontology as it stands rather than asserted, because all three had been consistently true without being written down, which is how the next model breaks them by accident.

- **A model id is a single lowercase word.** All 22 match `^[a-z]+$`. This is not cosmetic: the id is the URL path segment verbatim, so `/v1/worlds/{world}/{model}`, and a camelCase or hyphenated id would be the only route of its kind in the API.
- **A vocabulary id is kebab-case** when it needs more than one word: `canon-status`, `place-type`, `succession-law`. Kebab means "code list" here, so a model must not use it.
- **A field is camelCase**: `canonStatus`, `validTime`, `successionLaw`, `inWorldTime`.
- **Model ids are plain; the domain vocabulary carries the register.** A model id appears in every route, every schema and every generated client, so it should be the plainest word available. That is what frees the world's own words to be the world's own: `liege`, `vassal`, `demesne`, `homage`, `seat`, `sigil`, `epithet`, `agnatic`, `primogeniture`, `usurpation`. The flavour belongs where it is read, not in the contract.
- **Needing an adjective to make a model name work is a signal**, not a solution. Either the model is too broad and should split, or the adjective belongs on a field or a code.

- **`work` is kept**, over `text`, `document`, `account`, `lore` and `source`. The model spans a chronicle, a song and a map, so any name naming a medium excludes two of them. `source` was the strongest alternative — it names the model's job, which is to be what a `Citation` cites, and reads well in scholarly register — but the same model holds an out-of-universe article *about* the world, which is derived from the record rather than attesting it. Calling that a source would be a lie. `work` is the only candidate that spans both perspectives, and `perspective` carries the distinction.

  The model spans three media (text, music, graphic) and two perspectives, so any name specific enough to feel flavourful excludes one of those cells: `text`, `writing` and `document` lose the song and the map; `account` loses the map; `lore` names a body of knowledge rather than one item; `record` collides with the platform sense in which every resource is a record; `codex` and `manuscript` name one physical form. `opus` was rejected for register — it means a *significant* composed work, and the common case here is a letter or a report. `act` was rejected for collision: it is the natural English word for a thing done, which is an `event`, and `actor` already means a participant in one. `sourceWork` was rejected for convention and for inheriting `source`'s scope mismatch.

  The blandness is the set's fault, not the word's, and that is the correct trade for a contract name.
- **`belief` is kept**, over `assertion` and `testimony`. The concern was that a menu item reading *Beliefs* would be taken for religions, which are `faction` with type `religion`. But the model has a `holder` and a value of true, false or **unknown**, and holding something as unknown is a belief, not an assertion: you cannot assert "unknown". The name is the more accurate of the two, and the collision is a labelling problem for a front end rather than an ontology problem.
- **Alignment follows SRD 5.2.1**: nine codes on a three-by-three grid, each axis −1 to +1, with the centre spelled `neutral` as the SRD spells it. The 2019 five-by-five (order: lawful, social, neutral, rebel, chaotic; goodness: good, moral, neutral, impure, evil) is retired. It was inherited rather than chosen, four of its words are not terms a player would recognise, and it would not have lined up with any SRD content reaching the rules layer.
- **Creature size follows SRD 5.2.1**: tiny through gargantuan. `fine`, `diminutive` and `colossal` were third-edition rungs from the same port.
- **`work-type` loses `adventure` and `rulebook`.** Neither is composed inside a world; both are publications about one, and a publication is a `module`, the content-addressed package. An adventure is a bundle of quests, encounters and places, which the campaign layer now models directly.
- **`place-type` loses `world` and `realm`.** A place that claims to be the world gives a second answer to a question the `world` model already answers, and a realm is a polity, which is `faction` with type `state`, not a patch of ground. `kingdom` remains for the ground.
- **`faction-type` loses `faction`.** A code that repeats its own vocabulary's name says nothing about the group it labels.
