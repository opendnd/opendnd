---
title: "@opendnd/app"
description: The application. Sign in, open a world, and read or author any resource through pages built from the ontology the API describes.
---

The application is a single-page React application under `sites/@opendnd/app`. It never names a model: on sign-in it reads `/v1/models`, `/v1/openapi.json` and `/v1/vocabularies` from the API and builds its pages from them, so a model added to the ontology appears here with no change. See [ADR-015](/adr/adr-015-the-application/) for the decisions.

## Running it

The application talks to an API, so start one first, with development sign-in on:

```bash
docker compose up --detach --wait postgres
cd apps/@opendnd/api && bunx projen migrate && OPENDND_DEV_AUTH=on bunx projen dev
```

Then, in another terminal:

```bash
cd sites/@opendnd/app && bun run dev
```

The development server listens on `http://localhost:4100`, expects the API at `http://localhost:4080`, and signs in with a name the API trusts. `bun run dev` at the repository root starts both.

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
