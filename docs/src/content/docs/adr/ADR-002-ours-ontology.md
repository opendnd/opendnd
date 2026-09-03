---
title: "ADR-002: One ontology in OURS, three layers, aligned to published vocabularies"
description: OpenDnD owns the setting-and-history layer, aligns rules content to existing formats, and mints only what no vocabulary covers.
---

**Status:** Accepted, 2026-09-03

## Context

The [landscape research](/research/landscape/) found that rules content (classes, spells, monsters, items) has de facto standards, while no open, specified model exists for setting and history content (places, factions, events, eras, calendars). Formal RPG and narrative ontologies model play structure or story theory, not a game master's canonical world state. OURS, OpenHI's ontology format, has no non-healthcare consumer yet.

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
