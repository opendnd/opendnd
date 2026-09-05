---
title: "@opendnd/ours"
description: Domain-agnostic tooling for the OURS ontology format.
---

`@opendnd/ours` is the reusable half of the ontology work. Nothing in it knows about fantasy worlds; it knows about [OURS](https://ours.dev) and JSON Schema. The intent is for other OpenHI projects, and anyone else publishing an OURS ontology, to use it.

## What it provides

- **Resource shapes** as Zod schemas and TypeScript types: `Ontology`, `Model`, `Vocabulary`, `Bundle`, `MapsTo`, `Relationship`.
- **A directory loader**, `loadOursDirectory(dir)`, that reads `ontology.json`, `models/`, `vocabularies/` and `schemas/` into an in-memory bundle keyed by URL, and `toPublishedBundles()` to render the FHIR-style collection Bundles OURS publishes.
- **A validator**, `validateBundle()`, for the checks Zod cannot do alone: every model's schema resolves, every relationship target is a model and every relationship predicate is a `Reference`-typed property of the schema, every `$ref` resolves (relative ones against the document's `$id`, vocabulary schemas included), every `x-ours-valid-time` path leads to a `TemporalPosition`, ids and codes are unique.
- **A code generator**, `emitZodModule()`, that turns the bundle into one TypeScript module of Zod schemas and inferred types. Output is deterministic and topologically ordered.

## The JSON Schema subset

Models may use: `object` with `properties`, `required`, `additionalProperties` and `unevaluatedProperties`; `string` with `enum`, `const`, `format` (`uuid`, `uri`, `date-time`, `date`), `pattern`, `minLength`, `maxLength`; `integer` and `number` with bounds; `boolean`; `null` via type arrays; `array` with `items` and bounds; `$ref` to `#/$defs/X` or to another document's `$defs`; `allOf` for extension (flattened); `oneOf` and `anyOf` as unions, except that an `anyOf` made only of `required` lists is emitted as a refinement on one object ("one of these fields is present"); `readOnly` as an annotation; `default`.

Three conventions are OURS-specific, and none of them is a keyword:

- **A vocabulary is also a JSON Schema.** The loader derives `<vocabulary url with .schema.json>` from every vocabulary: a string whose `enum` is the codes, annotated with the vocabulary it came from. A model binds a property to it with an ordinary reference, `{ "$ref": "../vocabularies/sex.schema.json" }`, so any validator enforces the codes and the generator emits the shared enum. A `default` beside the `$ref` is honoured.
- **References are relative.** `common.schema.json#/$defs/Reference` resolves against the referring document's `$id`, as JSON Schema says it should. The published files sit at their `$id`s, so the same references resolve on the wire.
- `allOf: [{ $ref: "common.schema.json#/$defs/ResourceBase" }]` is how a model extends a base. The generator flattens it into one object so the emitted type is flat, and the model closes itself with `unevaluatedProperties: false`.

A schema may refer to itself. The reference is emitted as a Zod getter, which is Zod's idiom for recursion; when such a schema also carries a refinement, the object is declared first and the refinement layered on the exported name, because a refinement on a self-referential declaration defeats TypeScript's inference. The generated module also exports `readOnlyFields`, the fields the server sets, and `validTimeFields`, the `x-ours-valid-time` declarations by model.
