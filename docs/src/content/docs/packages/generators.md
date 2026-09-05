---
title: "@opendnd/generators"
description: Content generators behind two contracts, one deterministic and one that calls a model.
---

There are two contracts here, and the line between them matters. A **generator** is synchronous and reproducible. An **author** calls a language model, so it is asynchronous, costs money, and will not return the same words twice.

Every generator implements:

```ts
interface Generator<Input, Output> {
  id: string;        // goes into provenance.generatedBy as id@version
  version: string;
  description: string;
  generate(input: Input, ctx: GeneratorContext): Output;
}
```

`GeneratorContext` carries the `world`, a `seedPath` such as `dynasty/thorne/3`, an `Rng` seeded from `world/seedPath`, and optionally `now` and `requestedBy`. `createContext()` builds one. `stamp(generator, ctx)` supplies the platform fields on any resource a generator emits: a reproducible `id`, `derivedId = uuidV5(world, seedPath)`, `canonStatus: generated`, `recorded`, and `provenance` with generator, seed and derivation. See [ADR-005](/adr/adr-005-deterministic-generation/).

## The Author contract

```ts
interface Author<Input, Output> {
  id: string;
  version: string;
  description: string;
  task: string; // a task in @opendnd/llm: 'chronicle', 'author', ...
  author(input: Input, ctx: AuthorContext): Promise<Output>;
}
```

`AuthorContext` is a `GeneratorContext` with a `Models` on it, and optionally the `model` the person asking chose. An author names a task and passes that choice through; it never picks a model itself, so the same author runs against a model on the user's own machine or a hosted one depending only on configuration and what was asked for. `stampAuthored(author, ctx, response)` supplies the platform fields plus the hash of the prompt and, in `provenance.parameters.model`, the model that answered; `derivedFrom` names the records it was written from.

An author is deliberately not a `Generator`. A `Generator` promises that the same seed gives the same output for ever, which is what lets a region be filled on demand and refilled identically; an author cannot promise that and should not pretend to. What it does promise is the same as any other generator: output stamped `generated`, traceable to the code and the model that made it, and reviewable before it becomes canon. The record's *identity* is still stable, because `id` and `derivedId` come from the seed path — re-authoring an article replaces it rather than adding a second one. See [ADR-010](/adr/adr-010-language-models/).

## article

`articleAuthor.author({ subject, title, facts, sources, workType, words }, ctx)` returns a `work` about one record, for the Codex. Everything the model is allowed to say arrives in `facts`, so the article is a rendering of the record rather than a new source of truth, and the events behind it are named in `provenance.derivedFrom`. A `chronicle` is written as if from inside the world and marked in-universe; an `article` is written about the world and marked out-of-universe.

## names

Character-level Markov chains learned from a `Culture` resource's `names` lists (male, female, neuter, family, place). `new NameGenerator(culture)` builds a chain per type on first use; `generate(type, rng)`, `list(type, rng, count)`, and the one-call `nameFor(culture, type, seed)`.

The chain learns word count, word length, initial letters and letter transitions, with counts weighted by `count ** 1.3`. The algorithm is drow's public-domain (CC0) generator. One fix over the 2019 port: token selection now returns the first token whose cumulative weight passes the draw, as drow intended, instead of the last.

## genetics

The d20 genetic system, driven by a `Species` resource. A species declares up to 32 chromosomes, each with the die rolled for its two alleles, plus a sex chromosome with separate X and Y dice; a genome stores each pair as `"3=9"` or `"X1=Y3"`. Categories map to chromosomes, and the species' `expressions` map each gene to what it shows as — a common gene is the dominant (higher) allele, `eyeColor:C2:9`; a rare gene is the exact pair, `eyeColor:C2:3=9`, and wins. The result is the person's phenotype. Height and weight are rolled from the species' own tables: base height plus a modifier roll, and base weight plus that same modifier times the weight dice. One fix over the 2019 code: weight used total height instead of the modifier.

- `generate({ species, sex?, rng, chromosomes?, mutation? })`
- `generateChild({ species, mother, father, sex?, rng, mutation? })`: one allele from each parent; the father's X or Y sets the child's sex chromosome.
- `generateParents({ species, child, rng })`: a mother and father who could have produced the child.
- `generatePhenotype`, `generateHeightAndWeight`, `validateChromosomes`, `toPersonFields(genome)`.

## person

The first resource-producing generator and the template for the rest. `personGenerator.generate({ species, culture, sex?, name? }, ctx)` returns a complete `Person`: genome and phenotype from the species, a given and family name from the culture, references to both, and the stamped platform fields. Every later generator (dynasties, settlements) composes smaller ones the same way and emits ontology resources rather than free-standing data.

## settlement and realm

`settlementGenerator.generate({ tier, culture, species, calendar, year, ... }, ctx)` returns a `place` with terrain, natural resources and land area, a `population` count and an `economy` snapshot. Tiers are hamlet, village, town, city and metropolis, each with a population range and a typical density; land is head count over density, about forty percent of it arable. Resources come from the terrain's table: roll the terrain's die for picks, keep each pick on a d20 of five or better. The economy divides the population by each industry's support value (people per business), scaled by prosperity and halved when the place has a resource that industry thrives on; the fractional remainder is the chance of one more. Livestock is a multiple of the population by animal.

`realmGenerator.generate({ tier: 'kingdom' | 'duchy' | 'county', ... }, ctx)` builds nested demesnes down to localities. Populations split top-down, each child taking at most seventy percent of what remains, so a kingdom has a few large duchies and a tail of small ones. Every demesne gets a ruling house (a dynasty faction with the demesne as its seat, its liege's house as parent) and a ranked title with King and Queen, Duke and Duchess, Count and Countess styles, ready for the history simulation to run succession over.

The tables are ported from the 2018 dominia generator, which drew on S. John Ross's "Medieval Demographics Made Easy". Two fixes over the original: the resource advantage now checks the settlement's own resources rather than the industry's list against itself, and a misspelled poultry resource is corrected.

## alignment

Helpers over the 25-code alignment vocabulary: `alignmentAxes(code)` gives the numeric order and goodness position, `alignmentAt(order, goodness)` the code at a position, and `alignmentDistance(a, b)` the grid distance, so generators can drift a person's alignment or pick ideals that cohere with it.

## Species and culture data

Trait dictionaries and name lists are world content on `species` and `culture` resources, not code. The test fixtures are one invented human species and one culture of Roman-style names; neither reproduces published game content. The plan is to author the full set with LLM assistance and hold it to tests: schema validity, every category resolving to a trait for every possible roll, and distribution checks over many generated genomes.
