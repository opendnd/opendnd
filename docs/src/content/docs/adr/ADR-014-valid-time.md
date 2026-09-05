---
title: "ADR-014: Valid time is one interval, derived from the fields that carry it"
description: Every record's in-world interval lives in validTime; the schema names the properties it is read from; the store fills it in; a dated link is a record of its own.
---

**Status:** Accepted, 2026-09-05

## Context

The API answers "what held in year Y" with `?at=`, which filters on one interval per record, `validTime`. The world layer, meanwhile, dates things where the domain puts the date: a person has a `birth` and a `death`, a faction a `founded` and a `dissolved`, an event a `when`, a population a snapshot `at`. The history simulation set `validTime` on tenures and relationships and nowhere else, so a query for the people alive in a year returned the dead and the unborn, and the same for factions, places, events and snapshots.

Two remedies were open. Remove the domain fields and make `validTime` the only place a date can live, or keep them and make `validTime` follow from them. The domain fields carry more than an interval: a birth has a place, a death has a cause, an event's span has fuzzy bounds and a precision. Deleting them to fix a query would have thrown that away.

A second, related gap: some links change over in-world time and had no time at all. Which house controls a place, which faction a person belongs to, where they live, who owns an item. Held as a single reference on the record, each can only ever mean "now".

## Decision

- **`validTime` is the one interval the platform reads.** `?at=`, the export at a year, and any index on in-world time read `validTime` and nothing else.
- **A model schema names the properties `validTime` is read from**, in an `x-ours-valid-time` extension: `{ "begin": "birth.time", "end": "death.time" }` on a person, `founded`/`dissolved` on a faction, `founded` on a place, `when.begin`/`when.end` on an event, `at` on a population or economy snapshot. The paths are dotted, must lead to a `TemporalPosition`, and the bundle validator refuses a path that does not.
- **The store fills `validTime` in on every write that does not state one**, from those properties. A record that states its own `validTime` is left alone, which is how a record can hold for a different span than its dates would suggest.
- **The domain fields stay.** They are the truth as the domain tells it; `validTime` is the platform's projection of it.
- **A snapshot holds from its moment on.** A population or economy record has a `begin` and no `end`, so a read at a year returns every snapshot up to that year and the client takes the latest. Closing each snapshot when the next arrives would make a write to one record depend on another, and the client-side choice is one comparison.
- **A link that changes over time is a record with a `validTime`, not a field.** `tenure` already did this for titles. `relationship` now does it for everything else: its parties may be people, factions or places, and the vocabulary gains `member-of` and `resident-of` beside `liege-vassal`, `ally` and the rest. The single-valued fields (`person.memberOf`, `person.residence`, `place.controlledBy`, `item.owner`) remain as the present state, which is what a page shows by default; the dated history behind them is relationships and events.
- **`faction.leader` and `person.titles` are removed.** Both restated what `tenure` already records, and two statements of one fact is how the consistency checker acquired a rule to reconcile them.

## Consequences

- In-world reads are correct for people, factions, places, events and snapshots without any writer having to know about `validTime`. The simulation's own tests exercise it.
- `event.when` and `event.validTime` hold the same span on every event the API writes. That is duplication by design: `when` is the event's statement, `validTime` is the platform's index of it.
- `?at=` is a year in the world's calendar and assumes one calendar per world. A world with two calendars needs an epoch offset between them before its years can be compared, which is a change to `calendar` and to the filter rather than to this decision.
- Nothing yet derives a record's `validTime` from the records that link to it. A person's `memberOf` does not end when a `member-of` relationship ends; the relationship is the record to read for that.
