---
title: "@opendnd/api"
description: One route set per ontology model, over a store in which a world is the tenant.
---

The API is thin on purpose. The route table is generated from the ontology's model registry, the bodies are validated by the schemas generated from the same ontology, and the interesting work stays in `@opendnd/generators`, `@opendnd/simulation` and `@opendnd/llm`. See [ADR-009](/adr/adr-009-api-shape/) for the shape and [ADR-011](/adr/adr-011-world-as-tenant/) for the tenancy.

## Running it

```bash
docker compose up --detach --wait postgres
cd apps/@opendnd/api && bunx projen migrate && bunx projen dev
```

`migrate` applies the SQL in `migrations/` as the database owner and then grants the serving role, `opendnd_app`, access to every table. The API itself connects as that role, which is neither a superuser nor an owner — both of those bypass row-level security, and the isolation between worlds depends on it not being bypassed.

Without a Cognito pool configured the API is anonymous-only. `OPENDND_DEV_AUTH=on` accepts `Authorization: Bearer dev:<subject>` so the routes can be worked on without one; `bunx projen dev` sets it, because that task exists only for local work. Started any other way, the API stays anonymous-only until the variable is set, and the application's sign-in will be refused with a 401.

## Routes

| Route | |
|---|---|
| `GET /v1/models` | The models this deployment serves, each with the name and description its manifest gives it, and, where something generates it, what that generator takes as JSON Schema. |
| `GET`/`POST` `/v1/worlds` | The caller's worlds, and creating one. |
| `PATCH /v1/worlds/{world}` | Change a world's name, visibility or summary. Owners only; the world's own record follows. |
| `POST /v1/worlds/{world}/members` | Admit someone by subject or by email, or change their role. Owners only. |
| `DELETE /v1/worlds/{world}/invitations/{email}` | Withdraw an invitation that has not been taken up. |
| `GET`/`POST` `/v1/worlds/{world}/{model}` | List and create. |
| `GET`/`PUT`/`PATCH`/`DELETE` `/v1/worlds/{world}/{model}/{id}` | One resource. |
| `POST /v1/{model}/$generate` | Generate without a world and without an account, sending the species, culture and calendar whole. |
| `POST /v1/worlds/{world}/{model}/$generate` | Generate from resources in the world, named by reference or id. Each resource that comes back carries its `model`, so the bundle can be imported as it is. |
| `POST /v1/worlds/{world}/{model}/{id}/$simulate` | Run the history simulation over a world, a house or a place. `/v1/models` describes the request as JSON Schema, with every rate's default; the calendar, species and culture may be named by reference or id, or left out when the world has exactly one. |
| `POST /v1/worlds/{world}/{model}/{id}/$author` | Ask a language model to write an article or chronicle about a record from the facts on file. The usage line is written in the same transaction; left unsaved, the work is returned to read and can be imported as it is. Editors and owners. |
| `GET /v1/llm` | The language models the configured endpoints actually hold, and the model the writing task is configured with, so a client offers the choice. |
| `GET /v1/worlds/{world}/$export/{format}` | Everything in the world, as a bundle or as prose. |
| `GET /v1/openapi.json` | This API, described from the ontology. |
| `GET /v1/vocabularies` | Every code list with its display text, for a form. |
| `GET /v1/me` | The caller and the worlds they may open. |
| `GET`/`DELETE` `/v1/worlds/{world}/members[/{subject}]` | Who belongs and who is invited, and removing someone. |
| `DELETE /v1/worlds/{world}` | Archive a world. `GET /v1/worlds?archived=true` lists the archived ones to their owners. |
| `POST /v1/worlds/{world}/$restore` | Bring an archived world back. |
| `GET /health` | Up, and able to reach the database. |
| `POST /v1/worlds/{world}/$import` | Save many resources in one transaction: `{ resources: [{ model, resource }] }`, or the Bundle `$export/json` produces, so a world exported from one place imports into another unchanged. |
| `GET /v1/worlds/{world}/$search?q=` | One search box across every model. |
| `GET /v1/worlds/{world}/{model}/{id}/references` | Everything that points at a record. |
| `GET /v1/worlds/{world}/{model}/{id}/history` | Every version of a record. |
| `GET /v1/worlds/{world}/usage` | What has been spent on model calls. Owners only. |

Adding a model to the ontology adds its route set. Nothing in the API names a model, and a test holds the route table and the OpenAPI description together: every mounted route is described.

### Errors

Every failure has one shape: `{ error, code, requestId }`, with `issues` on a validation failure. The `code` is one of `validation`, `no-generator`, `unauthorized`, `forbidden`, `not-found`, `conflict`, `stale` or `internal`, and the request id is also the `x-request-id` header on every response. A malformed parameter is a `400` with the field named, not a database error.

### Reads

`?at=` is in-world time, counted in years of the world's calendar: it returns the state that held then, filtering on each record's valid-time interval. `?asOf=` is transaction time: it returns each record as it was authored at that moment, from the append-only version table. The Atlas and the Codex are both views over those two parameters.

`validTime` is filled in by the store from the fields the Model manifest names for it (a person's birth and death, a faction's founding and dissolution, an event's span, a snapshot's moment), so a writer need not know about it; see [ADR-014](/adr/adr-014-valid-time/).

Also `?canonStatus=`, `?perspective=`, `?module=`, `?generatedBy=`, `?name=` (prefix), `?ids=` (a set of ids, for what a page refers to), `?sort=id|name|updatedAt`, `?limit=` and `?cursor=`. A cursor is opaque and bound to the sort it came from. A review queue for generated content is `?canonStatus=generated`, which is a query rather than a feature.

`?cell=` takes a quadtree cell token and returns everything at or inside it, at any depth. That is how a map asks for what is in view: a cell's descendants are a contiguous range of ids, so a bounding cell is two comparisons on an indexed column rather than a walk down the tree, at any zoom level.

### What a page is made of

`{id}/references` answers "what points at this". The ontology is a web of references — the events a person took part in, the titles they held, the claims pressed on them — so this is what an article about something is assembled from. Asking each model in turn and filtering would mean reading the world to draw one page.

`{id}/history` lists every version of a record with the time it was written, and each of those times is something to pass back as `?asOf=`.

`$search` matches names by substring across every model at once, narrowable with `?models=place,title`. A person looking for Itumeist does not know whether it is a place, a title or a house, and here it is likely to be all three.

### Writes

`$import` saves many resources in one request, validated individually and written in one transaction, so a batch lands whole or not at all. A record without an id or a canon status is given one, as a single create gives it, so a list typed by hand need not be stamped first. It exists because generating a realm produces upwards of a thousand resources and keeping what was just generated should not be a thousand requests.

The platform fields belong to the API. It sets `world` from the path, `model` from the route, `id` when the client does not supply one, and `recorded` — created time, updated time and revision — from the request and the stored record, so a client cannot backdate a change or claim a revision it did not make. Those fields are `readOnly` in the schemas and absent from the request-body shapes in the OpenAPI description. A resource created through the API is `proposed` unless it says otherwise, because content arriving over HTTP is not canon by default.

Every read of one resource carries its revision as an `ETag`. Send it back as `If-Match` on a `PUT` or `PATCH` and the write is refused with `412` if the record has changed since; leave it off and the write still cannot silently lose another's, because the store names the revision it replaces. `POST` with an id that already exists is a `409`; `PUT` replaces. `PATCH` is a JSON merge patch: `null` clears a field, objects merge, arrays replace. The revision continues across a delete, so a record created again under the same id keeps its whole history.

`DELETE` marks rather than removes. The authoring history has to stay readable through `asOf`, and a delete has to be able to hide a record that arrived from a module, which cannot itself be deleted.

Every write appends to the outbox in the same transaction, so an event cannot describe a change that was rolled back.

### Generation

`$generate` runs the matching generator and returns the resources without saving any of them: the caller decides what to keep and posts it back. It returns a list rather than one resource, because generating a place produces the place, its population and its economy, and generating a demesne produces a whole realm of them with the houses and titles that hold them.

Inside a world, a generator input that wants a whole resource — a species with its chromosomes, a culture with its name lists — may be given the id instead, and the API loads it from the world first.

## Simulating

`$simulate` reads the realm out of the world rather than being sent it: the places, the houses that hold them, the titles they carry and the economies that say how each settlement is faring. The scope is the resource in the path — a world is everything, a faction is that house and the houses beneath it, a place is that place and everything inside it — so simulating a duchy runs its counties and no one else's.

The species, culture and calendar may be named in the request. Unnamed, they are inferred, but only when the world holds exactly one of each: guessing between two calendars would date a whole history wrongly, so it asks instead.

Left alone, a run returns what it produced and writes nothing, which is the same "look before you keep it" flow as generation. With `save: true` the resources are written in one transaction, in bulk, preserving the provenance they arrived with rather than restamping it — and **one** event is emitted for the import, because a subscriber wants to hear that a history was written, not thirty thousand times that a person was.

Runs are capped at 1000 years, and they are synchronous: two centuries of a 250,000-person kingdom is about seven seconds of processor time and forty thousand resources. That belongs in a worker before it belongs in a request, and moving it there is a change to this route rather than to the simulation.

## Exporting

A world is exported whole rather than by model, because a resource is only meaningful with the things it refers to: a tenure without its title and its holder is three ids and no history. `json` produces the same collection Bundle shape OURS publishes in, so an export can be read back by the tooling that reads the ontology. `markdown` produces a digest: what the world holds, then its history in year order.

## The event outbox

Every write appends to the outbox in the same transaction as the write itself. A publisher claims a page with `for update skip locked`, hands it to a sink and marks it published inside one transaction, so several publishers can run at once without one waiting on another or two sending the same event.

The sink is called before the rows are marked, so a sink that throws leaves them to be picked up again. That means an event can be delivered twice and cannot be lost, which is the right way round: a subscriber that tolerates a duplicate is cheaper to build than one that recovers from a gap.

The publisher finds the worlds with events waiting through a database function, `pending_worlds`, because row-level security is forced on the outbox and a scan from outside any world would otherwise see nothing. The function returns ids and counts; the events are read inside each world.

## Storage

```
layer        a stack of content: a world's own, or a module's
world        the tenant; its own layer shares its id
module       a published package, addressed by a content digest
world_layer  the layers a world reads, nearest first
resource     (layer, model, id) with the validated body as jsonb
```

The body is the resource as the ontology defines it. Beside it sit generated columns projecting the platform fields that get queried — name, canon status, perspective, module, provenance, the valid-time bounds, the revision — so the queries the API serves are indexable without opening the JSON. One table means a new model needs no migration.

A world is also a `world` resource in its own layer, so its calendar, its coordinate system and its current in-world time are ontology content rather than platform settings.

## Identity

Cognito. Tokens are verified in-process against the pool's published key set: an RS256 signature check with `node:crypto`, then the issuer, the token use, the app client and the expiry. Both token kinds are accepted — an access token is what an API is normally given, and an id token carries the email worth having when a user is first seen. A user row appears the first time a subject is seen, and any invitation waiting on that email becomes a membership then. An unknown key id triggers a refresh of the key set at most once every thirty seconds, so forged tokens cannot turn the API into a client of the pool.
