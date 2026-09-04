---
title: "ADR-013: The campaign layer records play, not the world"
description: Campaign, session, character, quest and encounter are out-of-universe records of preparation and play; what happens in a session is still an event in the world.
---

**Status:** Accepted, 2026-09-04

## Context

The world layer describes a fiction: people, places, factions, events, in-world time, canon status. Running a game is a different kind of fact. A session happened on a Tuesday in February, in the world where the players live, and lasted three and a half hours. A character belongs to a player. An encounter was prepared and may never be played. None of that is true *in* the world, and recording it as though it were would make the fiction untrustworthy: a wiki of the world should not contain the fact that Sam could not make it last week.

The pull in the other direction is that these things are made of world content. A quest is about places and people; an encounter happens somewhere; a character *is* a person. So the layer cannot be a separate system, only a separate set of models over the same ontology.

## Decision

- **Five models: campaign, session, character, quest, encounter.** No more, because the world layer already covers the rest.
- **Reuse rather than invent.** A dungeon is a `place` whose type is `dungeon`, with rooms beneath it, sitting in the same quadtree as everywhere else, so a battle map for it needs nothing new. An adventuring party is a `faction` whose type is `party`, with the membership and hierarchy factions already have. Both codes were already in the vocabularies. A published adventure is a `module`, the content-addressed package, rather than a `work`.
- **Play and preparation are out-of-universe, and the ontology says so.** `campaign`, `session`, `character` and `encounter` default `perspective` to `out-of-universe` in their own schemas, so no client has to remember which is which and no query has to special-case them. A `quest` keeps the in-universe default, because a quest is as often the world's own errand as a thread a gamemaster is holding; its perspective says which it is.
- **What happened is still an `event`.** An encounter is the thing that was set up; playing it produces an event, dated in the world's calendar, and the encounter keeps a reference to it. A session references the events it produced rather than describing them again. This is the line that keeps the world's record whole: the history of the world is one set of records whether it was written by an author, produced by the simulation, or played at a table.
- **A character is not a person.** The being in the world is a `person`; the character is the record of playing them, and points at it. That is what lets a non-player character become a player character without the world changing, and what keeps a player's name out of the fiction.
- **A session is dated in real time.** That is why it is a model rather than an `event` with a type: `event.when` is in-world time, expressed in one of the world's calendars, and a Tuesday in February is not.
- **Nothing rules-shaped.** A character carries a level and an experience total, which are true of a character in most systems, and nothing else. Classes, abilities, items and spells belong to the rules layer, and inventing a shape for them here would be a shape to break later.

## Consequences

- The API needed no changes at all. The route table is generated from the model registry, so the five models arrived with their six routes each, their schemas, their entries in the OpenAPI description, and their place in cross-model search and reference lookup. That is the property the codegen was built for, and this is the first time it has been tested by adding a layer rather than a model.
- A campaign's page is assembled the same way a person's is: by asking what points at it.
- An encounter carries a quadtree cell, so the map can show where a party is about to be ambushed at the same zoom that shows the county.
- A world can be exported and read without the play records if a reader filters on perspective, which is what a public wiki of a world would do.
- The rules layer is still owed, and a character sheet is thin without it.
