---
title: "@opendnd/simulation"
description: The history simulation and the consistency checker.
---

`@opendnd/simulation` implements [ADR-007](/adr/adr-007-history-simulation/) and layer one of [ADR-008](/adr/adr-008-consistency-checking/).

## historyGenerator

A `Generator<HistoryInput, HistoryOutput>` with id `history`. Input: a calendar, a species, a culture, and the realm itself as places, factions and titles, plus optional economy snapshots to seed prosperity, authored founders, canon events and parameter overrides. Output: people, relationships, events, tenures, populations, economies and the consistency findings over them. The realm generator's output feeds it directly.

```ts
const realm = realmGenerator.generate({ tier: 'duchy', culture, species, calendar, year: 1000, population: 60000 }, ctx);
const history = historyGenerator.generate(
  { calendar, species, culture, ...realm, startYear: 1000, years: 200 },
  createContext({ world, seedPath: 'history/thorne' }),
);
```

Each year runs, in order:

- **Deaths**, by species mortality, or on the authored year for a canon death.
- **Marriages**. A match is either dynastic, joining two houses through living figures, or local, drawing a commoner from the seat's population and instantiating them. The partner from the lesser house joins the greater one, so a line and its title stay together.
- **Births**. Couples with a fertile mother; the child inherits a genome from both parents, takes a name from the culture and joins its father's house.
- **Succession**. Every vacant title passes to an heir from its own house under its succession law, with a succession event caused by the death. A house with no one left does not end the title: the liege seats one of their junior kin, who moves in and founds a cadet branch. Only when there is no liege or no candidate does the title fall vacant, and the record says so once. Whenever a title changes hands, the bonds of homage between the new holder and their liege, and between them and their own vassals, are recorded afresh, because homage is between people and does not outlive them.
- **Settlements**. Each population grows or shrinks with its own prosperity, prosperity drifts a step now and then with an event, and on snapshot years a Population and an Economy record are emitted per settlement, the economy recomputed from the current count, prosperity and the place's natural resources.

Everything is deterministic for a seed path. Every emitted resource is stamped `generated` with provenance `history@<version>`; authored inputs are never rewritten.

## Parameters

`HistoryParams`: `marriageChance`, `dynasticMarriageChance`, `birthChance`, `infantMortality`, `baseMortality`, `spouseAgeSpread`, `populationGrowth` (by prosperity), `prosperityDrift`, `populationSnapshotEvery`, `lineageDepth` and `maxFiguresPerHouse`. Only figures within `lineageDepth` kinship steps of a current title holder marry and have children in the record; everyone else ages and dies and their descendants remain in the aggregate population. This is what keeps a long history to hundreds of figures rather than millions. Mortality is a floor plus an infancy bump plus a steep climb around the species' life expectancy, reaching certainty at its maximum age.

## checkHistory

`checkHistory({ people, relationships, events, tenures, species? })` returns `Finding[]`, each with `rule`, `severity`, `message` and the `resources` involved. The simulation calls it on its own output; the API will call it on authored content. See ADR-008 for the rules and for the planned LLM layer.
