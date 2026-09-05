---
title: Ontology coverage
description: Every concept the 2016 to 2020 repositories named, and where it lives now or why it does not yet.
---

The old code named 36 entity types in `core` and designed 13 of them; the other 23 were declared and left empty. Eighteen repositories carried the rest as tools. This page maps every one of those concepts onto the ontology as it stands, so that what is missing is missing on purpose.

Read the [legacy review](/research/legacy-review/) for what the old code actually did. This page is only about coverage.

## Summary

| | |
|---|---|
| Covered by a model | 25 |
| Folded into a field or a code, deliberately | 15 |
| Missing: still owed | 8 |

Nothing designed in the old code has been lost by accident. The rules layer now exists as shapes, aligned to the 5e SRD API; what remains is a handful of concepts named but never designed, which are a fresh start rather than a port.

## Designed in the old `core`

These thirteen had real fields behind them.

| Old | Now | |
|---|---|---|
| `Person` | `person` | model |
| `Culture` | `culture` | model |
| `Event` | `event` | model |
| `Race` | `species` | model, renamed |
| `SubRace` | `species.parent` | a species descends from a species |
| `DNA` | `person.genome`, `species.chromosomes` | field |
| `Date` | `TemporalPosition`, `TimeSpan` | platform shape, in a named calendar |
| `Background` | `background` | model |
| `Feature` | `feature` | model |
| `Item` | `item` | model |
| `Vehicle` | `item`, category `mount` | code |
| `Dialog` | — | **owed** |
| `Disease` | — | **owed** |

`Disease` was the most complete thing in the old code: type, condition, pathogen, transmission, an incubation period in seconds with a dice modifier, exhaustion, and immunity tied to a specific gene. That last part is the interesting one, because `species.chromosomes` and `person.genome` still exist to tie it to.

## Named in the old `core` but never designed

Twenty-three types were declared as `extends IResource {}` with no body. They are intent, not lost work.

| Old | Now | |
|---|---|---|
| `Calendar` | `calendar` | model |
| `Campaign` | `campaign` | model |
| `Encounter` | `encounter` | model |
| `Faction` | `faction` | model |
| `Quest` | `quest` | model |
| `Title` | `title` | model |
| `Language` | `language` | model |
| `Building` | `place`, type `building` | code |
| `Dungeon` | `place`, type `dungeon` | code |
| `Dynasty` | `faction`, type `dynasty` | code |
| `Religion` | `faction`, type `religion` | code, and see below |
| `Name` | `culture.names`, `name-type` | field |
| `Sigil` | `faction.sigil` | field, a string rather than heraldry |
| `Klass` | `class` | model, spelled properly now that the id is a string |
| `Spell` | `spell` | model |
| `Tool` | `item`, category `tool` | code, as the old `ItemTypes` already had it |
| `Trap` | `encounter`, kind `trap` | code |
| `Monster` | `statblock` | model, independent of `species` as the SRD treats it |
| `Familiar` | `relationship`, type `familiar` | code |
| `Artwork` | `person.portrait` | **owed** as a model |
| `Domain` | — | **owed**, a divine domain |
| `Saying` | — | **owed** |
| `Story` | — | **owed** |

## Elsewhere in the old code

| Old | Now | |
|---|---|---|
| Standing scores: power, honour, piety, reputation | `person.standing` | field |
| Trait dictionary and traits | `species.expressions`, `person.phenotype` | field, renamed: in the rules, a trait is a species feature |
| Age groups | `species.ageRanges` | field |
| Expanded alignment matrix | `alignment` | code list, now the SRD nine |
| `nomina`, name generation | `culture.names` and `@opendnd/generators` | package |
| `genetica`, d20 genetics | `species` and `@opendnd/generators` | package |
| `dominia`, medieval demographics | `place`, `population`, `economy` | models |
| `dynastia`, dynasty generation | `@opendnd/simulation` | package, now a full history |
| `similia`, simulation | `@opendnd/simulation` | package |
| `questae`, quest generation | `quest` | model |
| `aedificia`, buildings | `place`, types `building` and `room` | code |
| `cartae`, world map tiles | `place.feature`, `place.cell` | field, and [ADR-006](/adr/adr-006-spatial-identity/) |
| `avataria`, portraits | `person.portrait` | field |
| `charactersheet` | `character` | model, thin until the rules layer |
| `compendia`, world compendium | the module system | planned, [ADR-011](/adr/adr-011-world-as-tenant/) |
| `modules`, adventure modules | the module system | planned |
| 47 anatomical equipment slots on `Person` | — | **owed**; far finer than the SRD's, and its own decision |
| `ITreasury`: cp, sp, ep, gp, pp | — | **owed**, see below |
| Ideals keyed by alignment axis | — | dropped; the 2024 rules removed them from backgrounds |

## What is still owed, in three groups

### The rules layer, now shapes

`item`, `class`, `feature`, `background`, `feat`, `spell`, `statblock`, `condition`, `skill` and `proficiency` exist as schemas, aligned to the 5e SRD API's MIT-licensed shapes so content written for it converts mechanically. No content ships: a character today has a place for a sheet and nothing on it. The SRD 5.2.1 corpus, when it comes, arrives as a CC-BY-4.0 module built from the Markdown source, and third-party content as modules carrying their own licences. The equipment slots are the one piece of the old design deliberately left out; they need a decision of their own.

### The world layer

- **Money.** Nothing in the ontology represents wealth. `economy` counts industries and livestock; `place` has resources; no record holds a sum. The old `ITreasury` was five coin denominations with a stated ratio, which is a starting point for both a character's purse and a realm's treasury.
- **`disease`**, with immunity tied to a gene, as the old code had it.
- **`domain`**, a divine domain. A religion is currently a `faction` with type `religion`, which gives it members, a seat and a hierarchy, but says nothing about what it holds sacred, its pantheon, or which domains a cleric draws on.
- **`artwork`** as a record rather than `person.portrait` as a string, so a portrait, a sigil and a map can have an author, a style and a provenance.
- **Heraldry.** `faction.sigil` is a string. A sigil that a map or a character sheet can draw needs a shape.

### The narrative layer

- **`dialog`**: the response, prompt and choice graph with typed requirements and triggers. The last thing worked on in the old code and never finished.
- **`story`**: an arc above `quest`. The campaign layer models what a party is meant to do and what was prepared for them, but not the shape of a plot across sessions.
- **`saying`**: proverbs and flavour text. Possibly a `work` code rather than a model.

## Two structural gaps found while auditing

Neither is a missing concept. Both are worth an ADR.

**References are untyped.** A `Reference` is `{ model, id, name? }`, and nothing constrains `model` to name a real model, let alone the right one for that field. `person.residence` will accept `{ model: "dragon", id: … }` through the schema, the codegen and the API. Declaring the intended target on each reference property — a declared target on the property, validated in the bundle and enforced on write — would close it, and would make the graph walkable in both directions.

**The bundle validator has a matching blind spot.** It checks every declared `relationships[].target` against the known models, but a reference-shaped property with no declared relationship is never checked. That is how `culture.languages` came to point at a model that did not exist for several days: the schema said `Reference`, the model declared no relationship for it, and nothing objected. Adding the `language` model fixed the instance; the class of bug needs the check.
