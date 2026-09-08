---
title: 'ADR-015: One application, built from what the API describes'
description: A single-page application that learns the models, their shapes and their code lists from the API at run time, signs in through Cognito or a development mode, and renders every resource through pages generated from its schema.
---

**Status:** Accepted, 2026-09-05

## Context

The API is generated from the ontology: a model added to the ontology has its routes, its validation and its place in the OpenAPI description with no change to the API ([ADR-009](/adr/adr-009-api-shape/)). The campaign layer was the first test of that property, and it held ([ADR-013](/adr/adr-013-campaign-layer/)). An application built on top now has to decide whether to keep it. An application that knows the models by name loses it at once: every new model becomes application work, and the ontology stops being the one place a change is made.

Two further things are settled before any page is drawn. Working on the application needs a way to sign in without a user pool, because the pool is a deployment and the application should run against a database on the same machine. And the application needs a component library, because building accessible menus, popovers, dialogs and comboboxes is a project of its own and not this one.

## Decision

- **One application, in `sites/@opendnd/app`.** A single-page React application bundled by Vite into static files. The map, the wiki, characters and campaigns are features of it rather than separate sites, because they are views of one ontology and an edit in any of them is an edit to the same record.
- **It learns the ontology from the API at run time.** On sign-in it reads `/v1/models`, `/v1/openapi.json` and `/v1/vocabularies` once and builds every page from them. It has no dependency on the ontology package, the generated types or the schema files: the API's own description is its contract. A test holds the application to this with an invented model, and no model of the ontology is named anywhere in it.
- **Pages are generated from schemas.** A resource's article and its form come from the same schema. The renderer understands strings and their formats, numbers, booleans, code lists, references, lists and objects; every shape it understands gets a control, and anything else gets an editor for the raw value, so that nothing the ontology can express is something the application cannot author. Fields the server sets are shown and never edited. Fields about the record rather than the thing are folded away beneath the fields an author came for. Generation is built the same way: the API describes each generator's input as JSON Schema in `/v1/models`, and the application renders that form with the same renderer, so a new generator needs no application work either. A reference whose `model` the schema fixes to a constant gets a picker for that model alone, which is JSON Schema saying it rather than an extension keyword.
- **Code lists get their display text from the vocabularies, by their codes.** A schema binds a property to a vocabulary with a plain `$ref`, and the OpenAPI description inlines that as an enumeration. The application finds the vocabulary again by the set of codes: exactly one vocabulary with exactly those codes labels the field, and when two share a set neither does. No extension keyword is needed on either side.
- **Two ways to sign in, chosen by build configuration.** `dev` sends `Bearer dev:<name>`, which the API accepts only when started with `OPENDND_DEV_AUTH=on`; it is the default under the development server and nowhere else, and a production build that asks for Cognito without naming a pool refuses to sign anyone in rather than falling back. `cognito` is the hosted sign-in with the authorization code grant and PKCE, written against the platform's `crypto` and `fetch` because it is two hashes and two requests. The id token is what goes to the API: both token kinds verify there, and the id token carries the email address that a membership invitation is matched on. Tokens are refreshed before they expire, and signing out ends the hosted session too.
- **Components come from shadcn/ui on Base UI.** Its command-line tool copies each component into the repository, where it is owned like any other source and styled through Tailwind's tokens. Those files are treated as generated code: never edited by hand, excused from the linters, and updated by running the tool again. The dependencies it installs are pinned in the repository's one versions file like everything else.
- **Writes carry `If-Match`.** The form keeps the `ETag` the resource came with and sends it back on save, so a change made by someone else in the meantime is refused by the API and shown as such rather than overwritten.
- **In-world time and revisions are addresses.** A record page takes `?at=<year>` and `?asOf=<time>`, so a state of the world or an earlier revision can be linked to, and the page reads the same API parameters the ontology defined them with ([ADR-014](/adr/adr-014-valid-time/)).
- **Hosting is static files behind a CDN.** The application will be served from an S3 bucket behind CloudFront at `app.opendnd.org`, beside `docs.opendnd.org` and `api.opendnd.org`. The development stage's user pool client lists the development server's callback and sign-out addresses so a local build can sign in against a real pool.

## Consequences

- The application is smaller than it looks. Its pages are a record list, a record, a form, a world list and search; the models give them their variety.
- The OpenAPI description is the largest thing the application downloads: every model twice, once as stored and once as sent, inlined. It is read once per session. A description per model would cut the first load and is a change to the API, not to the application.
- Generic controls are plain. A point in in-world time is a group of fields, a quadtree cell is a hexadecimal string, and geometry is edited as JSON. Purpose-built controls arrive with the features that need them: the map for cells and geometry, the calendar for time.
- A reference is picked by searching names across every model, because the schema does not say which models a `Reference` may point at. Constraining that is an ontology decision.
- Tests run in jsdom with a few polyfills for what it lacks, and the component library's popups have been exercised there, so the reference picker is tested end to end without a browser.
- The infrastructure for the application's bucket and distribution is not yet written; the stage configuration carries the sign-in addresses it will need. Managing members, enabling modules, generating and simulating from the application, exporting a world, and the map itself are all owed.

## Decided later, 2026-09-06

- **Links are made from the schemas, not from a list.** A record's page offers to make records linked to it: a new record whose schema fixes a reference field to this model, with that field filled in; a new record of a model this record's own reference fields are fixed to, added to that field once made; or both at once when the models point at each other. Fields that may point at anything offer nothing. This is what makes the campaign layer usable without the application knowing it exists: a session's page offers the event it produced because `session.produced` is fixed to `event`, and a campaign's page offers a session because `session.campaign` is fixed to `campaign`. A new model with a fixed reference joins in with no change here.
- **What links here reads through the schemas too.** Each referring record says which of its fields carries the reference, and when it carries a date it is listed in date order, so sessions read as a chronology and holders as a roll.

## Decided later, 2026-09-07

- **In-world time is read by shape.** A position in a calendar and a span of two are recognised by their fields, not by which property holds them, and read as years that link to the timeline. This is what lets a session's covered years, an event's when and a population's moment all read alike with nothing in the application naming any of them.
- **A list shows what fits.** Beside each name, a model's list shows the first few of its fields that fit in a cell, in schema order, and can be ordered by name, by last change, or by in-world time for a model the ontology dates. The columns are the schema's, so a new model lists sensibly the day it is added.

## Decided later, 2026-09-07: the shape of the application

- **A world is the frame.** Outside a world the application is a list of worlds, each shown as a large card with a cover drawn from its own map. Inside one, the world is the whole shell: its name at the top, its surfaces down the side, and one door out. Nothing of any other world shows while inside one, the way a tenant sees only its tenancy.
- **Surfaces are named in one place.** The generic pages still learn every model from the API, but the navigation has a shape a person expects: Campaigns beside Characters, Maps beside the Timeline, a Compendium, a Marketplace, the Data, the Settings. Each surface that stands on a model names it in one table, `src/app/surfaces.ts`, and a surface whose model the ontology lacks is not offered. This is the one deliberate exception to the rule that the application names no model, and it is kept to that file.
- **One theme, taken whole.** The application's theme is DM Sans for text, DM Serif Display for headings, warm zinc neutrals, forest green as the brand, and sage, amber and clay as accents. It is copied token for token from a sibling product so the two read as one suite, and it is not tuned here.
- **Prose is Markdown.** A record's description and its long text fields render from Markdown. A link to the web opens in a new tab; a link to nowhere stays as its words; an image that is not an address is left out rather than shown broken.
- **The map has a year and a preview.** The map is drawn as of a year, the way a map service offers older imagery, and choosing a record that holds nothing opens it beside the map with the way to its page, rather than leaving the map.
- **Every record can be inspected.** A record's page opens the record as the API holds it, with its address and revision, for the person who wants to see the data behind the article.
- **Ask and Inspect ride along.** A panel on the right of every page, opened from the top right, either asks the world a question, answered by a language model from the records that match the names in it and linking those records, or shows the record on the page as the API holds it. Both follow the address, so they concern what is in front of the reader.
- **Models are grouped as the ontology says.** A model's manifest names its category, and the Data section and the Rules surface list models by it; the icons and the words are the application's, the membership is the ontology's.
- **Most people will not use Data.** The surfaces, and in time interfaces built on this data in a studio, do the work; a form built from a schema is the way in when nothing better exists yet, not the way the application is meant to be used.

## Decided later, 2026-09-07: one panel, and what the manifests say

- **One panel, two tabs.** Ask and Inspect share one panel on the right, opened from one switch in the header, beside the page on a wide window and over it on a narrow one, so neither is ever out of reach. The inspector follows the address or a row chosen in a table, which is how a data browser is used: the table on the left, the record on the right.
- **Icons come from the manifests.** Each model's manifest names its icon from the set the application draws with, and the application loads that icon by name; a manifest that names none gets its group's. The application still names no model.
- **Cards are small.** A campaign or character is a row with a small picture, and a record without a picture gets a tile in a colour of its own with its initial on it, so lists read as lists of distinct things and a picture is an improvement rather than a requirement.
