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
| `person` | A person, real to the world or legendary | schema.org Person, Wikidata fictional human, CIDOC E21, GEDCOM X |
| `place` | A location at any scale, with optional geometry in the world's CRS | schema.org Place, CIDOC E53, GeoSPARQL Feature |
| `organization` | State, dynasty, faction, guild, religion | schema.org Organization, CIDOC E74, W3C ORG |
| `event` | Something that happened, with participants, roles and cause links | schema.org Event, CIDOC E5 |
| `relationship` | A tie between two people with dated facts and succession fields | GEDCOM X Relationship |
| `work` | A creative work in-world or out-of-world | schema.org CreativeWork, CIDOC E73 |
| `claim` | A belief a holder has about a proposition, for contested history | CRMinf Belief |

## The base every model extends

`common.schema.json#/$defs/ResourceBase` gives every record: a random v4 `id` and a deterministic `derivedId`; the `world` it belongs to; `canonStatus` and `perspective`; `validTime` for when the assertion holds in-world; `recorded` for when the record was written; `provenance` with generator, seed and derivation; `citations` into in-world works; and the `module` it shipped in.

Shared definitions also cover `Reference`, `TemporalPosition`, `TimeSpan`, GeoJSON `Geometry` and `Feature` with an explicit CRS, `Provenance`, `Recorded` and `Citation`.

## Vocabularies

Canon status, perspective, sex, person status, place type, organization type, event type, relationship type, legitimacy, work type, belief value and temporal precision. Each is an OURS `Vocabulary` with inline codes, referenced from schemas through `x-ours-vocabulary`.
