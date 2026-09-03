---
title: "@opendnd/simulation"
description: The history simulation and the consistency checker.
---

`@opendnd/simulation` implements [ADR-007](/adr/adr-007-history-simulation/) and layer one of [ADR-008](/adr/adr-008-consistency-checking/).

## historyGenerator

A `Generator<HistoryInput, HistoryOutput>` with id `history`. Input: a calendar, a species, a culture, the settlement, the house, its offices, an initial aggregate population, a start year and a number of years, plus optional authored founders, canon events and parameter overrides. Output: people, relationships, events, tenures, populations and the consistency findings over them.

```ts
const out = historyGenerator.generate(
  { calendar, species, culture, settlement, house, offices: [lordship], initialPopulation: 400, startYear: 1000, years: 300 },
  createContext({ world, seedPath: 'history/thorne' }),
);
```

Each year runs, in order: deaths (by species mortality, or on the authored year for a canon death), marriages (unmarried adults of the house draw a spouse from the population, who is instantiated as a generated person), births (couples with a fertile mother; the child inherits a genome from both parents and a name from the culture), then succession (a vacant office passes to the heir under its succession rule, with a succession event caused by the death). Population snapshots are emitted on an interval and at the end.

Everything is deterministic for a seed path. Every emitted resource is stamped `generated` with provenance `history@<version>`; authored inputs are never rewritten.

## Parameters

`HistoryParams`: `marriageChance`, `birthChance`, `infantMortality`, `baseMortality`, `spouseAgeSpread`, `populationGrowth`, `populationSnapshotEvery`, `lineageDepth` and `maxLivingFigures`. Only figures within `lineageDepth` kinship steps of a current office holder marry and have children in the record; everyone else ages and dies and their descendants remain in the aggregate population. This is what keeps a thousand-year history to hundreds of figures rather than millions. Mortality is a floor plus an infancy bump plus a steep climb around the species' life expectancy, reaching certainty at its maximum age.

## checkHistory

`checkHistory({ people, relationships, events, tenures, species? })` returns `Finding[]`, each with `rule`, `severity`, `message` and the `resources` involved. The simulation calls it on its own output; the API will call it on authored content. See ADR-008 for the rules and for the planned LLM layer.
