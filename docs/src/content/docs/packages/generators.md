---
title: "@opendnd/generators"
description: Deterministic content generators behind one contract.
---

Every generator, procedural today and AI-assisted later, implements the same contract:

```ts
interface Generator<Input, Output> {
  id: string;        // goes into provenance.generatedBy as id@version
  version: string;
  description: string;
  generate(input: Input, ctx: GeneratorContext): Output;
}
```

`GeneratorContext` carries the `world`, a `seedPath` such as `dynasty/thorne/3`, an `Rng` seeded from `world/seedPath`, and optionally `now` and `requestedBy`. `createContext()` builds one. `stamp(generator, ctx)` supplies the platform fields on any resource a generator emits: a reproducible `id`, `derivedId = uuidV5(world, seedPath)`, `canonStatus: generated`, `recorded`, and `provenance` with generator, seed and derivation. See [ADR-005](/adr/adr-005-deterministic-generation/).

## names

Character-level Markov chains learned from a `Culture` resource's `names` lists (male, female, neuter, family, place). `new NameGenerator(culture)` builds a chain per type on first use; `generate(type, rng)`, `list(type, rng, count)`, and the one-call `nameFor(culture, type, seed)`.

The chain learns word count, word length, initial letters and letter transitions, with counts weighted by `count ** 1.3`. The algorithm is drow's public-domain (CC0) generator. One fix over the 2019 port: token selection now returns the first token whose cumulative weight passes the draw, as drow intended, instead of the last.

## genetics

The d20 genetic system, driven by a `Species` resource. A species declares up to 32 chromosomes, each with the die rolled for its two alleles, plus a sex chromosome with separate X and Y dice; a genome stores each pair as `"3=9"` or `"X1=Y3"`. Trait categories map to chromosomes and a trait dictionary is keyed by gene: a common gene is the dominant (higher) allele, `eyeColor:C2:9`; a rare gene is the exact pair, `eyeColor:C2:3=9`, and wins. Height and weight follow the SRD tables: base height plus a modifier roll, and base weight plus that same modifier times the weight dice. One fix over the 2019 code: weight used total height instead of the modifier.

- `generate({ species, sex?, rng, chromosomes?, mutation? })`
- `generateChild({ species, mother, father, sex?, rng, mutation? })`: one allele from each parent; the father's X or Y sets the child's sex chromosome.
- `generateParents({ species, child, rng })`: a mother and father who could have produced the child.
- `generateTraits`, `generateHeightAndWeight`, `validateChromosomes`, `toPersonFields(genome)`.

## person

The first resource-producing generator and the template for the rest. `personGenerator.generate({ species, culture, sex?, name? }, ctx)` returns a complete `Person`: genome and traits from the species, a given and family name from the culture, references to both, and the stamped platform fields. Every later generator (dynasties, settlements) composes smaller ones the same way and emits ontology resources rather than free-standing data.

## alignment

Helpers over the 25-code alignment vocabulary: `alignmentAxes(code)` gives the numeric order and goodness position, `alignmentAt(order, goodness)` the code at a position, and `alignmentDistance(a, b)` the grid distance, so generators can drift a person's alignment or pick ideals that cohere with it.

## Species and culture data

Trait dictionaries and name lists are world content on `species` and `culture` resources, not code. The test fixtures are one human species and one culture converted from the 2019 SRD data. The plan is to author the full set with LLM assistance and hold it to tests: schema validity, every category resolving to a trait for every possible roll, and distribution checks over many generated genomes.
