---
title: 'ADR-017: A world holds its files, addressed by their content'
description: Pictures and map tiles are stored under the world that holds them and addressed by the digest of their bytes, served by the API from a bucket in a deployment and a folder on a development machine, read without authentication and cached forever.
---

**Status:** Accepted, 2026-09-08

## Context

Records could already carry a picture: `image` on every record and `portrait` on a person, each an address of something somewhere. Nothing said where that somewhere was, so in practice it was wherever the person seeding a world happened to be serving files from. A world map was worse: the map draws from a template naming a host that has to serve tens of thousands of small pictures, and the only thing serving them was a shell script running a development web server on a spare port.

Two things were wrong with that. Nothing deployed: a world whose pictures live on a laptop shows nothing to anybody else. And nothing travelled: a world exported from one deployment and imported into another kept addresses pointing at the first one, so a module carrying a campaign carried a dead link to its cover.

The deployment already provisions a bucket and hands the API its name. What was missing was the part in between.

## Decision

**A world holds files, and the API is the way in and out.** `POST /v1/worlds/{world}/assets` takes the file as the body with its type in the header, and the file is stored under the world that holds it. Nothing can reach across worlds, because the world is the first thing in the key.

**A file is addressed by the digest of its content.** Storing the same picture twice stores it once and answers with the same address, and an address can never come to mean something else. That is what makes the answer cacheable for a year, which is what makes a map of twenty thousand tiles tolerable to draw.

**A read is not authenticated.** A browser asking for a picture in an `img` tag sends nothing with it, so a rule that reads require a token would mean no world could show a picture at all. What protects a file instead is that its address is a 256-bit digest that cannot be guessed and is only found on a record in a world the reader may already read. This is a deliberate trade and should be read as one: anybody given an address can fetch that file, forever, whatever happens to the world afterwards. Writing and removing stay a world's editors' business.

**Only a short list of types may be stored.** Pictures, fonts and documents. The store hands a file back with the type it was told, so a world able to store a web page under the deployment's own address could serve one.

**A record may point at a path as well as a URL.** `image` and `portrait` are address references, not absolute addresses: a path beginning `/v1/` names a file the world itself holds and is resolved against whichever deployment is reading, so a world exported and imported elsewhere finds its own pictures. Anything else on the web still works as before.

**A map is drawn from the world's own tiles unless it says otherwise.** `GET /v1/worlds/{world}/tiles/{z}/{x}/{y}.png` is the address web maps have used for a tile since the first one, answered from what the world holds. The world record's `map` gains a `source`: `tiles` for pictures somebody made, `terrain` for a world drawn from its own terrain at any depth, which is what [ADR-006](/adr/adr-006-spatial-identity/) is heading towards. Its `tiles` template is now optional, and naming one is for a world whose pictures live somewhere else.

**One store, two backings.** A bucket where the deployment gave the API one, and a folder where it did not. A development machine gets the same addresses, the same behaviour and the same code path as a deployment; the difference is one setting.

## Consequences

A world's pictures and its map now work anywhere the API runs, with nothing else running beside it. The two shell scripts that used to serve them are gone.

Deleting a world does not yet delete its files. Nothing points at them once the records are gone, and archiving keeps everything by design, but a world removed for good leaves bytes behind. That wants a sweep, and it is not written yet.

Pictures somebody drew are still handed back unchanged for `source: tiles`.

## Decided later, 2026-09-14: terrain textures are derived and cached

A globe renderer needs raster textures, even when the source of the map is a vector drawing. For `source: terrain`, the PNG endpoint therefore draws the same live coastline as the SVG endpoint, rasterizes it, and keeps the result under a key containing the digest of `terrain.json`. Replacing that file selects a new cache namespace immediately; a tile from an older coastline can never satisfy a render for the new one.

The low globe levels, zero through four, are rendered in the background when the deployment's asset bucket observes a new `terrain.json`. They are only 341 tiles and are the pictures every first view needs. Deeper levels are rendered and cached when first viewed; pre-rendering every level would grow as four to the depth and create billions of files nobody asks for. A development folder has the same lazy path, and its importer may invoke the prewarmer deliberately.

The cache contains natural terrain only: sea, land, inland water and coastlines. Political fill, borders and names remain live layers made from current place extents in the application. Moving a held cell therefore moves a border without regenerating any texture. Only changing the underlying coastline starts a new terrain render.

Content-addressed asset URLs remain immutable for a year. The stable terrain tile URL is not content-addressed, so it has a short public lifetime and revalidates after a coastline change; the revisioned object behind it is immutable.
