---
title: Legacy repository review
description: What the eighteen 2015 to 2020 OpenDnD repositories contain, which ideas the rebuild has already carried forward, and which it still owes.
---

Reviewed on 2026-09-03 across every repository in the original GitHub organization: `api`, `avataria`, `cartae`, `charactersheet`, `compendia`, `core`, `desktop`, `dominia`, `dynastia`, `genetica`, `modules`, `nomina`, `personae`, `questae`, `similia`, `ue4`, `aedificia`, and the `tmp` globe experiment. Algorithms already ported (Markov names, d20 genetics) are covered on the package pages; this page is about ideas.

## The API repository

A route specification for a hosted `api.opendnd.org/v1`, with a dashboard app and one working microservice (names). Its design decisions are the most reusable thing in the old organization:

- **Generate without saving.** Every `POST /v1/<resource>` generates a resource; `save=true` persists it. Generation needs no login; saving does. Anonymous use is a product principle, not an afterthought.
- **Actions as sub-routes.** `POST .../:id/simulate` on domains, dynasties, factions and persons "simulates a range of time that generates stories". `POST .../:id/export/:format` on everything, with markdown, yaml, text and a per-tool archive. `GET/POST .../:id/map` on domains and buildings; `GET/POST .../:id/avatar` on persons. `POST /v1/import` for the CLI archives.
- **Group scoping.** Data belongs to a group chosen by a header, with system defaults layered under group defaults. The names service stored user-owned name "themes" per group and merged them into the generator's defaults on every change.
- **Permissions per resource** (`read:names`, `write:names`) with optional authentication middleware, so the same route serves anonymous and authenticated callers.
- **Thirty-five resource types** on the roadmap, listed below against the current ontology.

## Ideas by repository

**avataria.** Genotype to phenotype rendering: a person's genetic traits (skin, hair, eye colour, scales) fill `{placeholder}` tokens in hand-drawn SVG templates per species and sex, so a portrait is derived from data and reproducible from the seed. Named colour vocabularies per species. Nine species by three sexes of templates exist.

**cartae.** A Go tile cutter producing a `{z}/{x}/{y}` raster pyramid from a 32k-pixel world image, resumable across zoom levels. The Atlas idea in its earliest form.

**compendia.** A markdown wiki wired to the generators. Auto-linking: an empty link `[Name]()` becomes a page on save, so mentioning something creates it. A "dynasty walk" produced one article per ruler with predecessor and successor links and a life-stage backstory (early life, career, personal life, death). Lunr search with tag and title boosts. Peer-to-peer sync between two wikis over a shared key. Drag-and-drop import of generator archives. Vendored a GPL wiki under an MIT root, which the rebuild must not repeat.

**core.** Thirty-five entity types, seven fleshed out. The `IResource` base declared `abstract`, `abstractProperties` and `derivation` for template-to-instance generation but nothing ever consumed them. A 5 by 5 expanded alignment matrix (Lawful, Social, Neutral, Rebel, Chaotic by Good, Moral, Neutral, Impure, Evil) with numeric axes, used by Person and Item, with Background ideals keyed by axis word. Person carried 47 anatomical equipment slots, four standing scores (power, honour, piety, reputation), factions as member/ally/enemy, and birth, death and marriages as event links. Dialog was the last thing worked on: NPC responses and player prompts cross-linked by index, with `triggers`, voice-over, emotion and ambience fields, and an untyped `requirement` that was never finished. Disease tied immunity to a specific gene. A seven-tier date ladder from epoch to second. The only written intent for the 21 stub types is a one-sentence description map inside the schema generator script. No license file.

**desktop.** An Electron app whose only real feature is a generic JSON-Schema-driven editor: one form engine plus a `ui-schema` per entity, with `@link:` annotations in property descriptions resolved at render time into pickers of existing records. Storage was a user-chosen folder with one JSON file per record and a per-entity `uuid` to `name` index. Thirty-three routes, one screen.

**dominia.** Medieval demographics as a pipeline: fifteen terrains each with a resource table (a die for count and a DC 5 check per pick), sixty-one resources, about a hundred industries with support values (people per business) halved by resource advantages, an industry to background mapping so a settlement can emit populated NPCs, livestock ratios, prosperity tiers, size tiers from hamlet to kingdom with densities, nested scales rendered recursively, and the land, population, density triangle where any two derive the third. Tables were edited in a spreadsheet and built to JSON.

**dynastia.** Inheritance rules (patrilineal, matrilineal, ambilineal), per-species fertility, conception and fertile-age dice, age-group weights by sex, 63 epithets ("the Bold"), year formats including custom eras, an interactive tree browser that exports any ancestor as a playable character, and year re-basing to graft a generated dynasty onto an existing character.

**genetica, nomina.** Ported. See the generators package.

**modules.** A complete adventure, Doom of Bahamut, as DM guide and player handout from Homebrewery markdown to PDF: parts and scenes, goal tiers, hook and climax, encounter tables with total challenge rating, NPCs as perception, insight and secret with a Charisma DC, a player-role taxonomy for the DM, layered maps, version and play-time estimate.

**personae.** Wizard and library in one, every prompt optional. Random-table oracles for personality, ideals keyed by alignment axis, bonds, flaws, mannerisms, talents, traits and characteristics. A full character sheet field set. Markdown and first-person prose rendering. Five SVG sheet templates composited to a multi-page PDF with an avataria portrait.

**questae, aedificia, charactersheet.** Names and intent only: quest generation, building generation, a live character sheet.

**similia.** Territorial expansion on a grid: domains founded by a d20 roll claim frontier cells from a capital, tick by tick.

**tmp.** A three.js globe viewer over a subdivided icosahedron at eight levels of detail with click-to-paint land and ocean, and a pipeline demo chaining name to genome to person to dynasty to town. The icosahedron is superseded by the quadtree; the pipeline is the generator contract.

**ue4.** A third-person exploration slice that loads the desktop app's JSON files verbatim into engine structs: place an actor, point it at a uuid. Dialog as a response, prompt and choice graph with named triggers such as `AddQuest`. Interaction framed through a cinematic camera. Inventory widgets.

## Coverage of the 35 original resource types

| Original type | Now | Layer |
|---|---|---|
| persons, races, cultures, dynasties, factions, domains, calendars, events, titles, dna, names | person, species, culture, faction, place, calendar, event, title and tenure, genome on person, culture names | setting |
| buildings | place of type building; generation not started | setting |
| religions, languages, sigils, sayings, artwork | not yet modelled | setting |
| items, tools, features, familiars, backgrounds, klasses, spells, monsters, traps, diseases, vehicles | not yet modelled; align to the 5e-database 2024 shapes | rules |
| campaigns, quests, encounters, dungeons, dialogs, stories | not yet modelled | campaign |

## Ideas the rebuild has already carried forward

Seeded, reproducible generation; genotype separate from phenotype; culture-owned name lists as the successor to name themes; the generator pipeline as a typed contract; the wiki as the Codex; the tile pyramid as the Atlas; simulation as the source of history; one data contract shared by editor, simulator and renderer.

## Ideas the rebuild still owes

1. Generate-without-saving and anonymous generation as API principles, with `$simulate`, `$export` and sub-resource routes.
2. A dialog model as a response, prompt and choice graph with typed requirements and triggers, shared by the Studio and any game client.
3. The campaign layer: campaign, quest, encounter, dungeon, story, with the module structure from Doom of Bahamut as the reference shape.
4. The rules layer aligned to 5e-database, including items with equipment slots as a relation rather than 47 fields.
5. Dominia's economy as a settlement system in the simulation, with the industry to background mapping producing NPCs on demand.
6. Portraits and character sheets as SVG rendered from data, then PDF.
7. The expanded 5 by 5 alignment with numeric axes, epithets, and the four standing scores on Person.
8. Mention-creates-page auto-linking and full-text search in the Codex.
9. Template resources: an archetype a generator instantiates from, which the old `abstract` and `derivation` fields gestured at.
10. A file-per-record export of a world that other tools and game engines can read directly, which the module snapshot format should satisfy.
11. Similia's territorial growth as a system in the simulation.
12. Disease with genetic immunity, once diseases exist.
