---
title: "@opendnd/types"
description: Generated Zod schemas and TypeScript types for every OpenDnD model.
---

`@opendnd/types` is entirely generated. `src/generated/index.ts` is emitted by `@opendnd/ours` from the bundle in `@opendnd/ontology` and committed so consumers get plain TypeScript with no build-time dependency on the ontology.

```bash
bun run generate
```

Run from the repository root: turbo builds `@opendnd/ours` and `@opendnd/ontology` first, then regenerates.

A test compares the committed file against a fresh emission and fails on any difference, so an ontology change that forgets to regenerate cannot merge.

Zod is the source of truth and types are inferred from it, the same Zod-first approach OpenHI takes:

```ts
import { personSchema, type Person, models } from '@opendnd/types';

const person: Person = personSchema.parse(input);
models.place.parse(somePlace);
```

Every vocabulary is also exported as a `const` tuple, an enum schema and a type, for example `canonStatusCodes`, `canonStatusSchema` and `CanonStatus`.
