---
title: "ADR-016: A module is a world, published"
description: A module is a snapshot of a world's own content in a layer of its own, addressed by a digest of that content, that another world enables by adding the layer to its stack; the API resolves nearest layer first and never writes to a module.
---

**Status:** Accepted, 2026-09-06

## Context

[ADR-011](/adr/adr-011-world-as-tenant/) laid the tables for modules and wrote the layered read: a world reads its own layer over the layers of the modules it enables, nearest first, and row-level security lets a world write only to its own layer. It left publishing, digests and resolution order to build. Three product ideas were waiting on them and are meant to be one mechanism: content someone pays for, content someone brings, and content a model generated.

The question this decision settles is what a module *is*. The candidates were a file format that is uploaded, a package registry with its own authoring flow, or the world itself. A file format would need a second validation path and a second notion of identity. A registry would need authoring tools the application already has, for worlds.

## Decision

- **A module is a world's content, published.** `$publish` on a world copies every live record in the world's own layer, except the world's own record, into a new layer of kind `module`. The world is the authoring tool: build it, generate into it, simulate it, edit it, and publish when it is right. There is no second way to make one.
- **The digest is the identity.** It is a hash of every record's model, id and body, in a fixed order, with the fields that say where a record is rather than what it is left out: the world it belongs to, the module it came from, and when it was recorded. The same content has the same digest, so publishing an unchanged world answers with the module that already exists, and two worlds that arrive at the same content have published the same module.
- **A module is immutable and its records say where they came from.** No request can address a module's layer for writing; that was already true by construction and stays so. Each copied record carries the module's digest in its `module` field, so a client can say a record came from a module and `?module=` can list what a module contributed. A corrected module is a new digest.
- **Enabling is adding a layer to the stack.** A module goes after everything the world already reads, so a world's own records and the modules it enabled earlier win over it. Disabling removes the layer and leaves the world's own overrides where they are.
- **Overriding is writing.** Editing a module's record in a world writes the world's own copy, which shadows the module's from then on and no longer says it came from the module, because it did not. Deleting it in a world hides it, as [ADR-011](/adr/adr-011-world-as-tenant/) said a delete had to be able to. A write that names the revision it replaces is checked against the record the world reads, wherever it was read from, so an application that edits what it was shown can edit a module's record.
- **The catalogue is a table, and visibility is the world's owner's to set.** A module records where it came from, who published it, what it holds counted by model, and whether it is public. A public module is offered to everyone who is signed in; a private one only to members of the world it came from. Owners publish, enable and disable.

## Consequences

- Paid, brought and generated content are the same thing: a world someone made, published. A marketplace is a catalogue with money in front of it, not a different content path.
- Publishing a large world copies its rows. That is a database-side copy in one transaction and fast at the sizes seen so far; a module is read many times and written once, so the copy is the right place to spend.
- Because a module's records keep their ids, a world that enables two modules with a record in common reads the nearer one, and a world that once enabled a module and then imported its content has its own copies of everything. Both are what the layering says, and neither needs a rule.
- A module has no events of its own yet: publishing writes no outbox entry, and enabling one does not announce the records it brought. A subscriber that needs to hear about module content will need that.
- Reordering the stack, a license check at enabling, and money are not here. The positions are stored, so ordering is a change to one route when it is wanted.
