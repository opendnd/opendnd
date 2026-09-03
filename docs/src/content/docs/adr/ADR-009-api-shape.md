---
title: "ADR-009: Shape of the headless API"
description: One route set per model, generation without saving, actions as sub-routes, anonymous reads and generation, world-scoped writes.
---

**Status:** Proposed, 2026-09-03. To be accepted with the first API implementation.

## Context

The original API specification (2018) settled several things well before any of it was built: every resource type had the same route set, generation was free and anonymous while saving required a login, and simulation, export, maps and avatars were sub-routes of the resource they belonged to. The rebuild has an ontology of models generated to Zod schemas, a generator contract, a simulation and a checker, and needs the API to expose them the same uniform way.

## Decision

- **One route set per model, derived from the ontology.** For every model `m`: `GET /v1/{m}`, `POST /v1/{m}`, `GET /v1/{m}/{id}`, `PUT /v1/{m}/{id}`, `PATCH /v1/{m}/{id}`, `DELETE /v1/{m}/{id}`. Request and response bodies validate against the model's Zod schema. Adding a model to the ontology adds its routes.
- **Generation without saving.** `POST /v1/{m}/$generate` runs the matching generator with the request as input and returns the resource stamped `generated` without persisting it. No login required. `POST /v1/{m}` with a generated body saves it. This keeps the original "generate first, save if you like it" flow and makes anonymous use a first-class path.
- **Actions as sub-routes.** `POST /v1/{m}/{id}/$simulate` runs the history simulation scoped to that resource (a world, a faction, a place, a person) for a span of years and returns or saves the events. `POST /v1/{m}/{id}/$export/{format}` renders markdown, JSON, or a module snapshot. `POST /v1/works/$check` runs the consistency checker. Sub-resources such as a place's map tile or a person's portrait are `GET /v1/{m}/{id}/map` and `/portrait`.
- **World scoping.** Every stored resource belongs to a world; the world comes from the path prefix `/v1/worlds/{world}/...` for stored data, never from the body alone. Anonymous generation needs no world. Authenticated users own worlds and grant roles on them.
- **Time as a query.** Reads accept `?at=<in-world time>` to return the state of a world at that time from valid-time intervals, and `?asOf=<transaction time>` for the authoring history. The Atlas and the Codex are both views over the same two parameters.
- **Provenance and canon are visible.** List and read endpoints filter by `canonStatus`, `provenance.generatedBy` and `module`, so a review queue of generated content is a query, not a feature.
- **Events out.** Every write emits an event on the platform bus with the versioned envelope; the same envelope is what a desktop client consumes locally.

## Consequences

- The API package is thin: route generation over the model registry, a command layer per model, adapters for Hono. The interesting code stays in generators, simulation and checker.
- Exports replace the old per-tool archive formats; a module snapshot is the interchange unit.
- OpenAPI is generated from the same Zod schemas so the documentation cannot drift from the routes.
