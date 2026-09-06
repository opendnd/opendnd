---
title: "@opendnd/app"
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

## The map

Every world has a Map page, drawn from cells. A model whose schema has a cell field is drawn, which the application finds in the schemas rather than knowing; today that is places and encounters. With nothing chosen, the map shows the smallest cell that holds everything on the busiest face of the world, each record as a square where its cell is, coarser cells beneath finer ones. Choosing a square that has others inside it looks into it, choosing one that has nothing inside opens its record, and Out steps up a level. A record with a cell has an On the map button that opens the map on it. Records without a cell are listed beside the map; generated places arrive with one, and anything else can be given one on its record.

## Linked records

A record's page offers to make records linked to it, and the offers come from the schemas rather than from a list in the application. For every model, a reference field the schema fixes to the model on the page is a way in: the new record's field will point back. A reference field of the record on the page fixed to another model is a way out: the new record will be added to that field once it is made. One of each becomes one offer that does both; more than one becomes an offer per field, named for it. Fields that may point at anything make no offer, because they would put every model on every page. So a campaign's page offers a new session, character, quest or encounter with the campaign filled in; a session's page offers a new event that the session will list as produced; an encounter's page offers the event it was played as. The form opens with the link made and returns to the page it came from.

What links here says through which field each record refers, and when the referring record carries a date it says that too and lists in date order, so a campaign's sessions read as a chronology.

## Taking a world with you

A world's home page ends with export and import. Anyone who can read the world can export it, as the JSON bundle the API serves or as a prose digest; the file is saved by the browser. An editor can import a bundle: the file is read locally first and what it holds is counted by kind, and only then is it sent, whole, to `$import`, which writes it in one transaction. A bundle exported from one world imports into another; records with the same ids are updated rather than duplicated.

## A world's settings

An owner has a Settings page for each world: its name, visibility and summary, which the world's own record follows; who belongs, with their roles, and who is invited by email and has not yet signed in; what the world has spent on language model calls; and archiving. An archived world keeps everything and appears under "Put away" on the worlds page, where an owner can restore it. The API allows none of this to anyone but an owner, and the page says so to anyone else.

## Modules

A world's settings page has a Modules section for its owners. It lists the modules the world reads beneath its own content, nearest first, each with what it holds counted by kind, and lets an owner disable one. Below that, an owner can enable any module the API offers them, which is every public module and every module published from a world they belong to. Last, an owner can publish the world itself: its name, a version, a license, a summary, and whether the module is public or only for members of this world. Publishing does not change the world; it takes a snapshot, and publishing again without a change answers with the same module rather than a second one.

A record that came from a module says so in its record keeping, and a world that edits one keeps its own copy, which shadows the module's from then on.

## Configuration

Settings are read at build time from `VITE_` variables, in the environment or in a `.env.local` file in the site directory. With nothing set, the development server uses the local API and development sign-in; a production build uses `https://api.opendnd.org` and Cognito.

| Variable | |
|---|---|
| `VITE_API_URL` | Origin of the API. Default: the local API under the dev server, the public API otherwise. |
| `VITE_AUTH` | `dev` or `cognito`. Default: `dev` under the dev server, `cognito` otherwise. |
| `VITE_COGNITO_DOMAIN` | The hosted UI origin, e.g. `https://opendnd-dev.auth.us-east-1.amazoncognito.com`. |
| `VITE_COGNITO_CLIENT_ID` | The user pool client id. |

A build that asks for Cognito without both Cognito settings refuses to sign anyone in rather than falling back to development sign-in. Development sign-in works only against an API started with `OPENDND_DEV_AUTH=on`; the API decides, not the application.

## What is where

| Folder | |
|---|---|
| `src/config.ts` | The settings above, read from `import.meta.env`. |
| `src/auth/` | The session store, PKCE, and the Cognito hosted sign-in. |
| `src/api/` | One method per API route, and the shapes the API answers with. |
| `src/schema/` | The ontology as the API describes it, and the description of a schema as fields for a form or an article. |
| `src/components/` | The article, the schema-driven form and its controls, the reference picker, the sidebar and the page frame. |
| `src/components/ui/` | The component library's components, written by its CLI. Not edited by hand. |
| `src/pages/` | One component per route. |
| `specs/` | Vitest specs, run under jsdom against an invented model and a fake `fetch`. |

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
