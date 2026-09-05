---
title: "ADR-005: Deterministic generation from seed paths"
description: Every generator takes a seeded Rng, every generated record carries its seed and a derived id, and generators read ontology resources rather than baked data.
---

**Status:** Accepted, 2026-09-03

## Context

The original generators used `Math.random`, read their reference data from JSON bundled with the code, and produced free-standing output. The rebuild needs regeneration to be idempotent (so an empty region can be filled on demand and refilled identically), needs generated content to be reviewable and promotable to canon, and needs the reference data (species biology, culture names) to be world content that authors and modules can change.

## Decision

- **Seeded randomness only.** Generators never call `Math.random`. They take an `Rng` from `@opendnd/random`, seeded by a string, and derive child generators per labelled sub-task. The seed path convention is `world/<generator>/<path>`.
- **Provenance on every record.** Generated resources carry `canonStatus: generated`, `provenance.generatedBy` (generator id and version), `provenance.seed` (the seed path), and `derivedId = uuidV5(worldId, seedPath)`. The random `id` remains free to survive edits.
- **One contract, one package.** Every generator implements `Generator<Input, Output>` with an `id`, a `version` and `generate(input, ctx)`, and lives in `@opendnd/generators` under a descriptive folder (`names`, `genetics`, `person`). The old one-package-per-generator layout and its Latin names (nomina, genetica) are retired; `stamp(generator, ctx)` supplies the platform fields on anything a generator emits.
- **Generators read the ontology.** Species biology (chromosomes, expressions, growth tables) lives on the `species` model; name lists live on the `culture` model. Generators consume those resources and emit ontology resources or their fields. Rules-layer content (abilities, features) is not on `species`.
- **Reproducible ids.** A generated resource's `id` is drawn from the seeded Rng in v4 layout, so a run is repeatable end to end, while `derivedId` stays version-independent. Both rules from the id design still hold: `id` is never derived from mutable content.
- **Faithful ports, bugs fixed.** The algorithms are the 2019 ones; two defects were corrected and documented on the package page.

## Consequences

- Species data is content, delivered as a module rather than code. A single invented human species and one culture ship as test fixtures; the full set is to be authored with LLM assistance and held to tests (schema validity, full trait coverage per category, distribution checks).
- Any change to a generator's algorithm changes its output for existing seeds; generators are versioned in `generatedBy` so old output can be traced.
