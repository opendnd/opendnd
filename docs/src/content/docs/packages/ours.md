---
title: "@opendnd/ours"
description: Domain-agnostic tooling for the OURS ontology format.
---

`@opendnd/ours` is the reusable half of the ontology work. Nothing in it knows about fantasy worlds; it knows about [OURS](https://ours.dev) and JSON Schema. The intent is for other OpenHI projects, and anyone else publishing an OURS ontology, to use it.

## What it provides

- **Resource shapes** as Zod schemas and TypeScript types: `Ontology`, `Model`, `Vocabulary`, `Bundle`, `MapsTo`, `Relationship`.
- **A directory loader**, `loadOursDirectory(dir)`, that reads `ontology.json`, `models/`, `vocabularies/` and `schemas/` into an in-memory bundle keyed by URL, and `toPublishedBundles()` to render the FHIR-style collection Bundles OURS publishes.
- **A validator**, `validateBundle()`, for the checks Zod cannot do alone: every model's schema resolves, every relationship target is a model, every `$ref` and `x-ours-vocabulary` resolves, ids and codes are unique.
- **A code generator**, `emitZodModule()`, that turns the bundle into one TypeScript module of Zod schemas and inferred types. Output is deterministic and topologically ordered.

## The JSON Schema subset

Models may use: `object` with `properties`, `required` and `additionalProperties`; `string` with `enum`, `const`, `format` (`uuid`, `uri`, `date-time`, `date`), `pattern`, `minLength`, `maxLength`; `integer` and `number` with bounds; `boolean`; `null` via type arrays; `array` with `items` and bounds; `$ref` to `#/$defs/X` or to another document's `$defs`; `allOf` for extension (flattened); `oneOf` and `anyOf` as unions; `default`.

Two conventions are OURS-specific:

- `x-ours-vocabulary: <Vocabulary url>` on a string constrains it to that vocabulary's codes and emits a shared enum.
- `allOf: [{ $ref: ...ResourceBase }]` is how a model extends a base. The generator flattens it into one object so the emitted type is flat.

Recursive references are not supported and fail generation with the cycle named.
