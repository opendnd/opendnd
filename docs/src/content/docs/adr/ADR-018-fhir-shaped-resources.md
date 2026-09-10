---
title: 'ADR-018: Records take the shape of FHIR resources'
description: Every record says `resourceType`, keeps its platform metadata under `meta` and names the definition it conforms to in `meta.profile`; element names follow FHIR's conventions, so the ontology can be published as StructureDefinitions rather than translated into them.
---

**Status:** Accepted, 2026-09-10

## Context

The ontology already declared, on each model, which standards it lines up
with: schema.org, CIDOC-CRM, GeoSPARQL, Wikidata, and for three models a FHIR
resource. Those declarations were honest and inert. Nothing read them but the
documentation generator, which turned each into an "Aligns to …" sentence.
The mappings bundle published empty, because there were no element-level
rules to put in it.

That is enough if the ambition is to be *compatible* with a standard. It is
not enough to be *part of* one. A resource submitted to a standard is
published as a definition other people validate against, and a definition
whose records call the classifying code `placeType`, containment `parent` and
the record's own type `model` is a definition that reads as foreign
everywhere it appears next to its neighbours. Translation at the boundary was
the alternative, and translation is a second shape to keep correct forever.

A resource may also need fields no base resource has. FHIR resources are
closed: a new top-level element is not allowed, only an `extension` with a
canonical URL. Under that rule `place.extent`, `place.biome` and
`place.terrain` become extension entries, every model loses its readable
shape, `body -> 'extent'` becomes an array search, and the generated columns
the store depends on cannot be expressed at all.

## Decision

**A record is a FHIR-shaped resource specializing a base.** FHIR's own
resources are defined that way — `derivation: "specialization"` on a
StructureDefinition declares a new resource type rather than a narrowing of
an existing one — and a specialization may add top-level elements. So the
freedom to have `extent` and `canonStatus` at the top of a record is not an
exception to the standard; it is the mechanism the standard uses on itself.
Three models specialize a real base — `place` a Location, `faction` an
Organization, `person` a Person — and the other thirty specialize
DomainResource.

**The envelope is FHIR's.** `model` becomes `resourceType`, carrying the type
name rather than the model id: a `place` is published as a `Place`. Transaction
time moves from `recorded` to `meta`, as `meta.versionId` and
`meta.lastUpdated`. The two fields Meta has no room for move to where they
belong: when a record was first written is `provenance.recorded`, and who
wrote it is `provenance.attributedTo`, which already existed. `tags` becomes
`meta.tag`, an array of Codings rather than of bare strings.

**A record says which definition it conforms to.** `meta.profile` carries the
canonical URL of its model. This is the gain that pays for the rest: until
now a record said `model: "place"`, a bare id meaningful only to something
that already had this ontology. It now points at a document.

**Element names follow the house style, everywhere it fits.** The classifying
code is `type`, so `placeType`, `factionType`, `itemCategory`, `eventType`,
`workType`, `featType`, `proficiencyType`, `relationshipType`, `creatureType`
and `encounter.kind` are all `type`. Mereological containment is `partOf`;
taxonomic specialization stays `subclassOf`, because a subspecies is not part
of a species and the two relations should not share a name. What a record is
about is `subject`. Where something happens is `location`. When an event
happened is `occurred`. A `place` a Location manages is its
`managingOrganization`, and a person's `sex` is their `gender`, because that
is what the resources they specialize call those elements.

**A repeating element is singular.** `quest.objectives` is `objective`,
`statblock.actions` is `action`, `calendar.months` is `month`. This is FHIR's
convention and the most visible thing about a definition; fifty properties
follow it. It reads oddly in TypeScript, where `character.class` holds an
array, and that is the price.

**A reference carries `type` and `display`.** `Reference` was
`{ model, id, name }` and is now `{ type, id, display }` — the same three
fields under the names FHIR gives them. `type` holds the resource type, so a
reference and the record it points at agree about what that record is.

## Consequences

The ontology can be published as StructureDefinitions and CodeSystems rather
than translated into them. That publishing is not built here; what is built
is the shape that makes it a serialization rather than a conversion.

Two things are deliberately not adopted. FHIR's **datatypes**, beyond the
four that already matched: `HumanName` in place of a plain `name` would be a
large regression paid for in interoperability nobody has asked for, when most
beings in a fictional world have one name. And **in-world time stays as it
is**: `validTime` holds positions in a world's own calendar, which no FHIR
datatype can express, and it is the single most load-bearing thing in the
schema.

Every stored body was rewritten in place, in `resource` and in every version
in `resource_version`, so history reads under the new names too. One
collision came out of the rename and is worth recording: `place.resources`
became `place.resource`, and the import endpoint recognised its own envelope
by the presence of a `resource` key — so importing a place would have
unwrapped its list of natural resources and tried to store that instead. The
envelope is now recognised by its `model`, which only an envelope has.

A model id and a resource type are the same word in different cases. Routes,
tables and the ontology's own files stay keyed by the lower-case id, because
that is what a URL and a table name want; records and references carry the
type. Anything crossing between them says so.
