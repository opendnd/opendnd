---
title: "@opendnd/random"
description: Seeded, deterministic randomness and derived ids.
---

Every generator in OpenDnD must be reproducible: the same seed in the same world yields the same result, so a region can be regenerated, a bug can be replayed, and a module can ship a seed instead of megabytes of output. `@opendnd/random` is the small package that makes that possible.

## Rng

`new Rng(seed)` builds a xoshiro128** generator whose entire state is the SHA-256 of the seed string. It offers `next()`, `int(min, max)`, `chance(p)`, `pick(items)`, `weighted(items)`, `shuffle(items)`, dice notation through `roll('2d6+1')`, `rollEach`, and `rollAll(['d10', 'd10'])`.

`rng.uuid()` draws a UUID in version 4 layout from the stream, reproducible from the seed yet unrelated to any record's content, which is what generated resources use as their `id`. `rng.child('label')` derives a generator for `seed/label`. Generators should give each sub-task its own child so adding a step in one place does not reshuffle everything after it. That is the seed path convention: `world/dynasty/thorne/3/body`.

## Derived ids

`uuidV5(namespace, name)` is RFC 4122 version 5. `derivedId(worldId, seedPath)` uses the world as the namespace and the seed path as the name, which is what fills a resource's `derivedId` field. The record's own `id` stays a random v4 so references survive edits; `derivedId` is what makes regeneration idempotent. See [ADR-005](/adr/adr-005-deterministic-generation/).
