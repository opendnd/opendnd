---
title: "ADR-011: A world is the tenant, and content is layered"
description: Content belongs to a world and a user belongs to many; a world reads its own content over the modules it enables; isolation is enforced by the database rather than by the request path.
---

**Status:** Accepted, 2026-09-04

## Context

A person building a fictional world will build several, and will want to share some of them and not others. Content therefore has to be scoped, and the natural unit is the world: every resource in the ontology already carries a `world`, so the scope is in the data model before it is in the database.

Two things complicate the obvious implementation. The first is modules. Paid content, bring-your-own content and AI-generated content are all meant to be the same mechanism: an immutable package a world enables. That content is shared by every world that enables it, so it cannot be stored per world, and a world that overrides one of its records must not modify it for everyone else. The second is that a multi-tenant store leaks by omission. A missing `where world_id = ...` in one query is enough to show one customer another's world, and that is not a class of bug to defend against by being careful.

## Decision

- **A world is the tenant.** Every piece of content belongs to exactly one. `app_user` and `world_member` give a user many worlds with a role in each: `owner`, `editor`, `viewer`, ordered so an owner may do anything an editor may.
- **Content is addressed by layer, not by world.** A `layer` is a stack of content: a world's own, or a module's. A world's own layer shares its id. `world_layer` lists the layers a world reads, nearest first, with the world's own at position zero.
- **A read resolves the layers; a write only ever touches the world's own.** Reading a model returns the nearest layer's version of each resource, so a world can override a module's record without touching the module. Because no request can address a module's layer for writing, module content is immutable by construction rather than by convention.
- **The database enforces the isolation.** Row-level security on `resource`, `resource_version` and `event_outbox` restricts every row to the layers the current world reads, and the world is a transaction-local setting the API sets per request. A query that forgets to scope itself returns nothing rather than everything, and the setting cannot outlive its transaction and leak to the next request on a pooled connection.
- **The API serves as a role that cannot bypass those policies.** A superuser ignores row-level security unconditionally and a table owner ignores it unless the table forces it, so the API connects as a role that is neither. Migrations use the owner; serving does not.
- **The tenancy tables are guarded by the API, not by policies.** Worlds, users and memberships are not world-scoped, so authorization for them is explicit in the request path. Only content is covered by row-level security.
- **A public world is readable by anyone.** That is what lets an atlas or a codex be shared without an account. Writing always needs a membership.
- **Identity is Cognito, verified in-process.** A user row appears the first time a subject is seen rather than through a separate registration step. Tokens are checked against the pool's published key set: a signature check and four claim checks, needing no AWS credentials, which means the verification is tested against locally minted keys with no network and no account. With no pool configured the API is anonymous-only, which fails closed.
- **Both time axes are queries.** `?at=` filters on in-world valid time, counted in years of the world's calendar; `?asOf=` reads the append-only `resource_version` table for the record as it was authored at a moment. Deletes are marks, not removals, so that history stays readable and so that a world can hide a record that arrived in a module.
- **Writes and their events commit together.** Every change appends to `event_outbox` in the same transaction, so an event cannot describe a change that was rolled back, nor a change happen without an event.

## Consequences

- Adding a model to the ontology adds its routes and needs no migration: content is one table with the platform fields projected out as generated columns for indexing.
- The module system is now a data change rather than a schema change. The tables exist and the layered read is written; publishing, digests and resolution order are still to build.
- Filtering happens after layer resolution, because a world that overrides a record decides that record's name and canon status. That costs an index on the resolved set, which is acceptable at the page sizes the API serves and can be revisited with a materialised resolution if it stops being.
- Row-level security is checked on every content row, which adds a subquery per read. The alternative was trusting every query ever written against this database.
- A deployment that connects as the database owner silently loses the isolation. The specs assert that the serving role is neither a superuser nor able to bypass the policies, so this cannot regress quietly.

## Hardened, decided 2026-09-05

An adversarial review of the API before the first application is built against it. What it found, and what changed:

- **Writes are revision-checked.** Every read of one resource answers with its revision as an `ETag`; a `PUT` or `PATCH` that sends it back as `If-Match` is refused with `412` if the record has moved on. Without the header a write still cannot lose an update silently: the update names the revision it replaces and the version insert is a plain insert, so two writers who both read revision 3 cannot both produce revision 4. The revision continues from the last one ever written under an id, deleted or not, so a record created again after a delete carries its whole history.
- **`POST` with an id that exists is a conflict**, `409`, not a quiet replacement. `PUT` is the verb that replaces.
- **`PATCH` is a JSON merge patch** (RFC 7396): objects merge member by member, `null` removes a field, anything else replaces. A form can now clear a field.
- **An import continues each record's history too.** Generated content arrives with its own ids; the store assigns the next revision under each id in the same statement that writes it, so importing over an edited record does not rewind it.
- **The world record is written through the store**, so creating a world produces a version and an event like every other write.
- **The publisher reads the outbox through a function.** Row-level security is forced on the outbox for the owner as much as for the serving role, so the scan that asked "which worlds have events waiting" from outside any world returned nothing, and a deployment would never have published. The scan is now a database function that switches a setting on for the length of its own call, with a policy that honours it; it returns world ids and counts, and the events are still read inside their world. A test drives the whole publisher as the serving role.
- **Members are invited by email.** An application rarely knows another person's Cognito subject. Someone named by email who has signed in becomes a member at once; someone who has not is invited, and the invitation becomes a membership the first time they are seen. The last owner can no longer demote themself, for the reason they could not remove themself.
- **Two visibilities.** `link` was accepted and behaved as `private`; until a share token exists it is gone rather than stored meaning nothing.
- **Owners see what a world has spent.** Usage was readable by anyone who could read a public world.
- **An archived world can be listed and restored** by its owners. Archiving was reversible only in SQL.
- **Every parameter is checked at the edge.** A zero limit, a non-uuid id, an unparseable date or a bad cell token is a `400` with a machine-readable `code` and the request id, where before it reached the database and came back as a `500`. Every error has the same shape, and every response carries `x-request-id`.
- **Anonymous generation is bounded** to settlements and counties. A kingdom is seconds of processor time, which is more than a request with no account should command.
- **Lists sort and fetch by id.** `?sort=name|updatedAt`, with a cursor bound to its sort, and `?ids=` for the references a page needs in one request. Search terms are made literal before they reach `like`.
