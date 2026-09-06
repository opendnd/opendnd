---
title: "ADR-004: Generate types from the OURS bundle, drift-checked"
description: Zod-first code generation from JSON Schema, committed output, a test that fails on drift, and a generator that stays domain-agnostic.
---

**Status:** Accepted, 2026-09-03

## Context

Mature type generators for standards such as FHIR emit TypeScript and Zod from an intermediate representation, byte-deterministic and drift-checked in CI. We want the same discipline for OURS without adopting FHIR or depending on anyone else's generator, and we want the tooling to be usable by other OURS publishers.

## Decision

- `@opendnd/ours` is domain-agnostic. It defines the OURS resource shapes, loads a bundle from a directory, validates cross-resource integrity, and emits one TypeScript module of Zod schemas with inferred types. It supports a deliberate JSON Schema subset and refuses what it cannot represent faithfully, including recursive references.
- `@opendnd/types` commits the generated module. A Bun test regenerates in memory and compares byte-for-byte, so an ontology change that forgets to regenerate fails the build.
- Zod is the source of truth; types are `z.infer`. `allOf` extension is flattened so emitted types are flat objects. Vocabularies become shared `const` tuples and enums.
- Generated code carries a `~~ Generated` header and is never edited by hand.

## Consequences

- No intermediate representation yet. If a second emitter is needed (JSON-LD context, OpenAPI, SQL DDL), introduce an IR then rather than speculatively now.
- The generate script depends on the built `@opendnd/ours` and `@opendnd/ontology` packages; the root `generate` script runs through turbo so those build first.
- `@opendnd/ours` is a candidate to publish to npm once its API settles, ideally under an OURS-owned scope.

## Decided later, 2026-09-06

- **Relationships are written into the schemas.** A model manifest's `relationships` say which model each `Reference`-typed property points at, and until now that was a claim the validator checked against the schema and nothing else read. The emitter now writes it into the generated shape: the property's `model` is fixed to the target's id, or to one of several when relationships share a predicate, so a session whose campaign points at a place is refused, and a client reading the schema knows a field may only hold a campaign. Untyped references, those with no relationship, stay as they were. The manifest remains the one place a target is declared; the schema files carry a plain `Reference` as before.
