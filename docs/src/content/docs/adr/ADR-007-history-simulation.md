---
title: "ADR-007: History as a simulation over events"
description: A yearly clock and rule systems generate a world's history as an event log, fitted around authored canon, with populations as aggregates and only notable figures as people.
---

**Status:** Accepted, 2026-09-03

## Context

The original project generated dynasties with a year-stepping loop that mutated person objects and produced a family tree. That gives lineage but not history: no record of what happened, when, or why, and nothing for a wiki or timeline to show. Worldgen in the best procedural games works differently: a simulation runs the world forward for hundreds of years, every system it runs emits typed historical events with participants and links, and the browsable history is that log. We want that, and we want it to respect what an author has already written.

## Decision

- **Events are the record.** The simulation emits `event` resources with a type, a year on the world's calendar, participants in roles, locations and `causedBy` links, plus the resources those events imply (`person`, `relationship`, `tenure`, `population`). Wars will contain battles and battles duels through `partOf`. Nothing is derived that cannot be traced to events.
- **A yearly clock with systems.** `@opendnd/simulation` runs a `HistoryState` forward one year at a time. Each system is a rule module that receives the state, the inputs and its own child seed, and appends events and resources. Order within a year is fixed: deaths, marriages, births, then succession. First systems: demographics and lineage, succession over titles, and settlements (population by prosperity, economy snapshots). Next: settlement founding, conflict, migration, beasts and heroes, religion, artifacts, disasters, eras derived from state.
- **Populations are aggregates, figures are people.** A settlement carries `population` counts by species over time. Only the figures a system needs become `person` resources, instantiated on demand from the seed (a spouse drawn from the population, a child born to figures). Notability bounds the record: only figures within a few kinship steps of a seat of power carry a line forward; a house that tracked every descendant would grow exponentially and stop being a history. The same on-demand rule will apply when a map zoom or a story needs a named inhabitant.
- **Canon is a fixed point.** Authored people and events are inputs the simulation fits around. An authored death year is honoured exactly; authored people are never rewritten, the events carry the facts. More constraint types (an authored marriage, an authored succession) follow the same pattern.
- **Separate seeds per system.** Each system and each year derives a child seed, so adding a system does not reshuffle the others and the same seed gives the same history.
- **Titles and tenures.** A `title` is a seat in a faction with a `successionLaw`; a `tenure` is one holder's time in it, with `validTime` and links to the events that began and ended it. Succession rules implemented: primogeniture, male-preference, agnatic, seniority, elective, appointed.
- **Species lifecycle drives demography.** `species.lifecycle` (maturity, fertile years, life expectancy, maximum age) feeds mortality and fertility; when absent it is derived from `ageRanges`.

## Consequences

- The dynasty generator is one system among several, not a package. Requests such as "three hundred years of House Thorne" run the simulation with one settlement and one house.
- The event log is what an LLM narrates into chronicles and legends as `work` resources citing events, so prose consistency comes from structure (ADR-008).
- Simulations can be resumed to add years, since state is rebuilt from events and resources.
- Every run is checked by the consistency rules before it returns; a run that produces findings is a bug in a system.
