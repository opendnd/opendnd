---
title: Authoring the ontology
description: How to add or change a model, vocabulary or shared definition.
---

All ontology changes happen in `packages/@opendnd/ontology/ours/`. Nothing else is edited by hand.

## Add a model

1. Write `schemas/<id>.schema.json`. Start from an existing one: it declares `$id`, extends `ResourceBase` through `allOf`, lists `properties`, `required` and sets `additionalProperties: false`.
2. Write `models/<id>.json`: the OURS `Model` with `name`, `description`, `schema` pointing at the `$id` above, `relationships` naming other models, and at least one `mapsTo` alignment. Prefer schema.org names for properties where they exist.
3. Regenerate and test:

```bash
bun run generate && bunx projen test
```

## Add a vocabulary

Write `vocabularies/<id>.json` with inline `codes`, then reference it from a string property with `"x-ours-vocabulary": "<its url>"`. The generator emits a shared enum.

## Add a shared definition

Add it under `$defs` in `schemas/common.schema.json` and reference it with `"$ref": "https://opendnd.org/ours/schemas/common.schema.json#/$defs/Name"`.

## Rules of thumb

- Every record is an assertion: put facts that change over time in `validTime`, not in new fields.
- Link, don't embed. Point at another resource with a `Reference`; never nest a full person inside an event.
- Names come from published vocabularies first (schema.org, GEDCOM X, CIDOC-CRM). Mint a new name only when the [landscape research](/research/landscape/) found no existing one.
- Keep to the JSON Schema subset `@opendnd/ours` supports. If you need more, extend the generator first and add a test.
