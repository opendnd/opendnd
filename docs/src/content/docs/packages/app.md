---
title: '@opendnd/app'
description: The application. Sign in, open a world, and read or author any resource through pages built from the ontology the API describes.
---

The application is a single-page React application under `sites/@opendnd/app`. It never names a model: on sign-in it reads `/v1/models`, `/v1/openapi.json` and `/v1/vocabularies` from the API and builds its pages from them, so a model added to the ontology appears here with no change. See [ADR-015](/adr/adr-015-the-application/) for the decisions.

## Running it

The application talks to an API, so start one first:

```bash
docker compose up --detach --wait postgres
cd apps/@opendnd/api && bunx projen migrate && bunx projen dev
```

Then, in another terminal:

```bash
cd sites/@opendnd/app && bun run dev
```

The development server listens on `http://localhost:4100` and expects the API at `http://localhost:4080`. `bun run dev` at the repository root starts both.

Sign in with any name. The API's `dev` task runs with development sign-in on, so it trusts the name and makes it your account; started any other way, the API needs `OPENDND_DEV_AUTH=on` or it answers 401, and the sign-in page says so.

## Generating

A model the API can generate has a Generate button on its list page. The form there is built from the generator's input as `/v1/models` describes it, in JSON Schema, the same way a resource's form is built from its schema: a reference input whose `model` the schema fixes gets a picker that searches only that model. Generating saves nothing. The results are listed by kind, and Keep all imports them in one transaction; one result of the model asked for opens its page, more than one opens the list.

## Simulating history

A world, a house or a place has a Simulate history button on its page for editors and owners. The form is built from the simulation's input as `/v1/models` describes it: how many years, from which, and the tunable rates with their defaults stated. A run is a rehearsal first: the page shows what would be produced, by kind, and the consistency findings over it, and nothing is saved. Keep runs the same request again with `save` set, which the API does deterministically, so what was looked at is what is kept. A viewer is told that a run is a write and cannot start one.

## Writing about a record

Every record has a Write about this button for editors and owners. The form comes from the request as the API describes it, except that the model is offered as a choice among what the deployment can actually serve, from `/v1/llm`, with the task's configured model named as what writes when nothing is chosen. The model is held to the facts on file: the record's fields and everything that refers to it, which the draft shows so they can be checked. A draft is read before it is kept, because a model does not say the same thing twice; keeping imports the very text that was read, and writing again is another call and another line on the world's spend.

## The timeline

Every world has a Timeline page: its dated records in the order they begin, grouped by year of the world's calendar, each a link to its record and each span shown with its end. Which models are dated comes from the ontology, through the API's description of each model, and the page starts with those whose records both begin and end, the things that happen and the things that last; snapshots, and any other model, can be added with a tick. A span of years narrows it, and a record with a date has an On the timeline button that opens the years around it. When the world's own record says where the world stands in its own time, that year is marked as now among the others, a button opens the years around it, and an editor can move now to another year from the same place.

## Reading time and lists

In-world time is recognised by its shape rather than by field name: a position in a named calendar reads as its year, with the month and day when they are given and "about" when the precision is coarser, and a span reads as its two years. Each is a link to the timeline at those years, so a session's covered years, an event's when and a person's birth all open the history around them.

A model's list shows, beside each name, the first few of its fields that fit in a cell: codes, numbers, dates and in-world times, in the order the schema gives them, so a list of sessions shows their numbers and dates and a list of events their kinds and years. A list can be ordered by name, by when it was last changed, or, for a model the ontology dates, by in-world time, which lists only the dated.

## The map

Every world has a Map page that pans and zooms the way web maps do. When the world's own record names a base map, a URL template for picture tiles under `map`, those tiles are drawn beneath; otherwise the records are drawn on a blank globe. Over them sits every record of a model with a cell field, which the application finds in the schemas rather than knowing; today that is places and encounters. What is fetched follows the view: the view is sampled, the few cells under the samples are asked for what is inside them down to a level worth drawing at the zoom, with `?maxLevel=`, and their faces for anything coarser, so a zoomed-out map shows continents and kingdoms and a zoomed-in one the towns. A cell near a tile's size or bigger is drawn as its outline, a finer one as a mark, and each is labelled while there is room. Choosing one opens a short account of its record beside the map, with a way to the whole of it; the list beside the map does the same, and a search box finds a record by name and flies to it. A record with a cell has an On the map button that opens the map on it, and an editor gives a record that has none its place from here: Place on the map on the record, or its name in the search, then the spot on the map, at a cell as fine as the zoom or as chosen. The address follows the view, so a view can be shared.

## Linked records

A record's page offers to make records linked to it, and the offers come from the schemas rather than from a list in the application. For every model, a reference field the schema fixes to the model on the page is a way in: the new record's field will point back. A reference field of the record on the page fixed to another model is a way out: the new record will be added to that field once it is made. One of each becomes one offer that does both; more than one becomes an offer per field, named for it. Fields that may point at anything make no offer, because they would put every model on every page. So a campaign's page offers a new session, character, quest or encounter with the campaign filled in; a session's page offers a new event that the session will list as produced; an encounter's page offers the event it was played as. The form opens with the link made and returns to the page it came from.

What links here says through which field each record refers, and when the referring record carries a date it says that too and lists in date order, so a campaign's sessions read as a chronology.

## Taking a world with you

The Data page ends with export and import. Anyone who can read the world can export it, as the JSON bundle the API serves or as a prose digest; the file is saved by the browser. An editor can import a bundle: the file is read locally first and what it holds is counted by kind, and only then is it sent, whole, to `$import`, which writes it in one transaction. A bundle exported from one world imports into another; records with the same ids are updated rather than duplicated.

## A world's settings

An owner has a Settings page for each world: its name, visibility and summary, which the world's own record follows; who belongs, with their roles, and who is invited by email and has not yet signed in; what the world has spent on language model calls; and archiving. An archived world keeps everything and appears under "Put away" on the worlds page, where an owner can restore it. The API allows none of this to anyone but an owner, and the page says so to anyone else.

## Modules

The Marketplace page lists the modules the world reads beneath its own content, nearest first, each with what it holds counted by kind, and lets an owner move one up or down the stack or disable it. Below that, an owner can enable any module the API offers them, which is every public module and every module published from a world they belong to. Last, an owner can publish the world itself: its name, a version, a license, a summary, and whether the module is public or only for members of this world. Publishing does not change the world; it takes a snapshot, and publishing again without a change answers with the same module rather than a second one.

A record that came from a module says so in its record keeping, and a world that edits one keeps its own copy, which shadows the module's from then on.

## Configuration

Settings are read at build time from `VITE_` variables, in the environment or in a `.env.local` file in the site directory. With nothing set, the development server uses the local API and development sign-in; a production build uses `https://api.opendnd.org` and Cognito.

| Variable                 |                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `VITE_API_URL`           | Origin of the API. Default: the local API under the dev server, the public API otherwise. |
| `VITE_AUTH`              | `dev` or `cognito`. Default: `dev` under the dev server, `cognito` otherwise.             |
| `VITE_COGNITO_DOMAIN`    | The hosted UI origin, e.g. `https://opendnd-dev.auth.us-east-1.amazoncognito.com`.        |
| `VITE_COGNITO_CLIENT_ID` | The user pool client id.                                                                  |

A build that asks for Cognito without both Cognito settings refuses to sign anyone in rather than falling back to development sign-in. Development sign-in works only against an API started with `OPENDND_DEV_AUTH=on`; the API decides, not the application.

## The shape of it

Outside a world, the worlds page shows each world as a card with a cover drawn from its own map. Inside a world, the world is the whole frame, with these surfaces down the side; a surface that stands on a model is offered only when the ontology has it.

| Surface               |                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Home                  | A question put to the world in plain words, with a few of its own to start from, then what it holds, the campaigns, and what changed last. |
| Campaigns, Characters | The campaign layer as cards, with a way to start a new one.                                                   |
| Maps                  | The world as a map that pans and zooms over its picture tiles, as of any year; a record opens beside the map. |
| Timeline              | Everything dated, in the order it began, with the world's now marked.                                         |
| Compendium            | One search across everything, and the written works to browse.                                                |
| Marketplace           | The modules the world reads, what it could enable, and publishing it.                                         |
| Data                  | Every kind of record as a table, with export and import.                                                      |
| Settings              | Name, members, spend and archiving. Owners only.                                                              |

One panel rides along on the right of every page, opened from the switch at the top right and shown beside the page on a wide window and over it on a narrow one, in two tabs: Ask, a conversation with the world answered from its records by a language model with the records it drew on linked beneath each answer, written by the model the deployment configures for the task or, failing that, the first it holds, with a choice offered when it holds more than one; and Inspect, the record in front of the reader as the API holds it, as a tree that folds, with its address and revision. The inspector follows the address, or a row chosen in a table under Data, the way a data browser shows the record beside the table. A question put from a page, from the home screen say, is answered here rather than where it was typed, so the conversation stays in one place; it waits for the deployment to say which models it holds before it is sent. A search of the whole world sits in the header on every page. How many records of each kind the world holds is asked once, for the whole world, and drawn beside every model in the navigation, on the cards under Data and on the home screen; a number in the thousands is written short. Under Data, models are grouped as the ontology's manifests place them — play, people, places, lore, rules, world, and platform for the models that describe the application rather than the world — each with the icon its manifest names, and each group led by the model it is really about before the rest by name: Person before the rest of People, Place before the rest of Places. Rules under World is the rules group on its own. A group the world's ontology has no model in is not shown, and the groups in the sidebar fold from their headings. Any record may carry an `image`, an address of a picture, which its cards and its article show; a person's `portrait` counts too, and a record with neither gets a tile in a colour of its own with its initial on it. Descriptions and long text render from Markdown.

## What is where

| Folder               |                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`      | The settings above, read from `import.meta.env`.                                                                                                        |
| `src/app/`           | The session store, the ontology, the world scope, and `surfaces.ts`, the one place the navigation names models.                                         |
| `src/api/`           | One method per API route, and the shapes the API answers with.                                                                                          |
| `src/schema/`        | The ontology as the API describes it, and the description of a schema as fields for a form or an article; cells, time and related records read from it. |
| `src/components/`    | The article, the schema-driven form and its controls, the reference picker, Markdown, the sidebar and the page frame.                                   |
| `src/components/ui/` | The component library's components, written by its CLI. Not edited by hand.                                                                             |
| `src/pages/`         | One component per route.                                                                                                                                |
| `specs/`             | Vitest specs, run under jsdom against invented models and a fake `fetch`.                                                                               |

## Adding a component

Components come from [shadcn/ui](https://ui.shadcn.com) on Base UI, and are copied into `src/components/ui` by its CLI:

```bash
cd sites/@opendnd/app && bunx shadcn add dialog
```

The files it writes are treated as generated code: the linters skip them, and they are updated by running the command again with `--overwrite`. If it installs a new dependency, move that dependency into `packages/@opendnd/projen/src/versions.ts` and `projenrc/sites.ts`, then run `bunx projen && bun install`, so the repository's one versions file stays the source of truth.

## Testing

```bash
cd sites/@opendnd/app && bun run test
```

The specs need no API and no browser: they render against an invented `pet` model with every kind of field the renderer knows, and answer requests from a fake `fetch`. `specs/setup.ts` polyfills what jsdom lacks for the component library's popups.
