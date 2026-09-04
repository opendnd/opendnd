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

Without a Cognito pool configured the API is anonymous-only. `OPENDND_DEV_AUTH=on` accepts `Authorization: Bearer dev:<subject>` so the routes can be worked on without one.

## Routes

| Route | |
|---|---|
| `GET /v1/models` | The models this deployment serves, which is the ontology it was built from. |
| `GET`/`POST` `/v1/worlds` | The caller's worlds, and creating one. |
| `POST /v1/worlds/{world}/members` | Admit someone. Owners only. |
| `GET`/`POST` `/v1/worlds/{world}/{model}` | List and create. |
| `GET`/`PUT`/`PATCH`/`DELETE` `/v1/worlds/{world}/{model}/{id}` | One resource. |
| `POST /v1/{model}/$generate` | Generate without a world and without an account. |
| `POST /v1/worlds/{world}/{model}/$generate` | Generate from resources named by id. |
| `POST /v1/worlds/{world}/{model}/{id}/$simulate` | Run the history simulation over a world, a house or a place. |
| `GET /v1/worlds/{world}/$export/{format}` | Everything in the world, as a bundle or as prose. |
| `GET /v1/openapi.json` | This API, described from the ontology. |
| `GET /v1/vocabularies` | Every code list with its display text, for a form. |
| `GET /v1/me` | The caller and the worlds they may open. |
| `GET`/`DELETE` `/v1/worlds/{world}/members[/{subject}]` | Who belongs, and removing them. |
| `DELETE /v1/worlds/{world}` | Archive a world. |
| `POST /v1/worlds/{world}/$import` | Save many resources in one request. |
| `GET /v1/worlds/{world}/$search?q=` | One search box across every model. |
| `GET /v1/worlds/{world}/{model}/{id}/references` | Everything that points at a record. |
| `GET /v1/worlds/{world}/{model}/{id}/history` | Every version of a record. |
| `GET /v1/worlds/{world}/usage` | What has been spent on model calls. |

Adding a model to the ontology adds its route set. Nothing in the API names a model.

### Reads

`?at=` is in-world time, counted in years of the world's calendar: it returns the state that held then, filtering on each record's valid-time interval. `?asOf=` is transaction time: it returns each record as it was authored at that moment, from the append-only version table. The Atlas and the Codex are both views over those two parameters.

Also `?canonStatus=`, `?perspective=`, `?module=`, `?generatedBy=`, `?name=` (prefix), `?limit=` and `?cursor=`. A review queue for generated content is `?canonStatus=generated`, which is a query rather than a feature.

`?cell=` takes a quadtree cell token and returns everything at or inside it, at any depth. That is how a map asks for what is in view: a cell's descendants are a contiguous range of ids, so a bounding cell is two comparisons on an indexed column rather than a walk down the tree, at any zoom level.

### What a page is made of

`{id}/references` answers "what points at this". The ontology is a web of references — the events a person took part in, the titles they held, the claims pressed on them — so this is what an article about something is assembled from. Asking each model in turn and filtering would mean reading the world to draw one page.

`{id}/history` lists every version of a record with the time it was written, and each of those times is something to pass back as `?asOf=`.

`$search` matches names by substring across every model at once, narrowable with `?models=place,title`. A person looking for Itumeist does not know whether it is a place, a title or a house, and here it is likely to be all three.

### Writes

`$import` saves many resources in one request, validated individually and written in one transaction, so a batch lands whole or not at all. It exists because generating a realm produces upwards of a thousand resources and keeping what was just generated should not be a thousand requests.

The platform fields belong to the API. It sets `world` from the path, `id` when the client does not supply one, and `recorded` — created time, updated time and revision — from the request and the stored record, so a client cannot backdate a change or claim a revision it did not make. A resource created through the API is `proposed` unless it says otherwise, because content arriving over HTTP is not canon by default.

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

Cognito. Tokens are verified in-process against the pool's published key set: an RS256 signature check with `node:crypto`, then the issuer, the token use, the app client and the expiry. Both token kinds are accepted — an access token is what an API is normally given, and an id token carries the email worth having when a user is first seen. A user row appears the first time a subject is seen.
