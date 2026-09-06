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

## A world's settings

An owner has a Settings page for each world: its name, visibility and summary, which the world's own record follows; who belongs, with their roles, and who is invited by email and has not yet signed in; what the world has spent on language model calls; and archiving. An archived world keeps everything and appears under "Put away" on the worlds page, where an owner can restore it. The API allows none of this to anyone but an owner, and the page says so to anyone else.

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
