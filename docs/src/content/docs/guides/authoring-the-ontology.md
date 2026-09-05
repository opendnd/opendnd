---
title: Authoring the ontology
description: How to add or change a model, vocabulary or shared definition.
---

All ontology changes happen in `packages/@opendnd/ontology/ours/`. Nothing else is edited by hand.

## Add a model

1. Write `schemas/<id>.schema.json`. Start from an existing one: it declares `$id`, `type: object`, extends `ResourceBase` through `allOf`, lists `properties` and `required`, and closes itself with `unevaluatedProperties: false` (not `additionalProperties`, which in draft 2020-12 would refuse the base's own fields). If the record has an in-world span that lives in its own fields, name them in `x-ours-valid-time` so the store can fill `validTime` in.
2. Write `models/<id>.json`: the OURS `Model` with `name`, `description`, `schema` pointing at the `$id` above, `relationships` whose predicates are `Reference`-typed properties of the schema (dotted for nested ones, `participants.actor`), and at least one `mapsTo` alignment. The validator refuses a predicate the schema does not have. Prefer schema.org names for properties where they exist.
3. Regenerate and test:

```bash
bun run generate && bunx projen test
```

## Add a vocabulary

Write `vocabularies/<id>.json` with inline `codes`, then reference it from a string property with `"x-ours-vocabulary": "<its url>"`. The generator emits a shared enum.

## Add a shared definition

Add it under `$defs` in `schemas/common.schema.json` and reference it with `"$ref": "https://docs.opendnd.org/ours/schemas/common.schema.json#/$defs/Name"`.

## Rules of thumb

- Every record is an assertion. A fact that changes over in-world time is a record with a `validTime` (a `tenure`, a `relationship`), not a field that is silently overwritten. When a model's span lives in its own fields, declare them in `x-ours-valid-time` rather than asking writers to repeat them.
- Fields the server sets are `readOnly`. Never add one a client is expected to fill.
- Link, don't embed. Point at another resource with a `Reference`; never nest a full person inside an event.
- Names come from published vocabularies first (schema.org, GEDCOM X, CIDOC-CRM). Mint a new name only when the [landscape research](/research/landscape/) found no existing one.
- Keep to the JSON Schema subset `@opendnd/ours` supports. If you need more, extend the generator first and add a test.
