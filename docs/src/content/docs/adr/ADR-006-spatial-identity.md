---
title: 'ADR-006: Spatial identity from planet to 5-foot square'
description: A cube-sphere quadtree gives every point on a world one nested id at every zoom level, down to a battle-map square; hexes are a derived view.
---

**Status:** Accepted, 2026-09-03. Implemented in `@opendnd/spatial`.

## Context

The Atlas needs Google-Maps-style zoom from a whole planet to a street, and the game needs a battle map wherever the party stops. In fifth edition a battle-map square is 5 feet. We want any point on any world, at any zoom level, to resolve to one unique square so a battle map can be generated on demand and regenerated identically, and so places at every scale nest inside each other. Worlds may be spheres, flat planes or discs. Hex grids are the tabletop convention for overland travel, but hexes do not subdivide into hexes exactly, so a hex hierarchy cannot give stable nested ids.

## Decision

- **A cube-sphere quadtree is the single spatial identity system**, after the design of S2. Six cube faces project onto the sphere; each cell subdivides into four children; a cell id encodes face and path, so ids nest and every level of detail is a prefix relationship. Level 0 is a face; on an Earth-sized world level 22 or 23 is about 5 feet across. The level that equals 5 feet is computed from the world's radius and recorded on the World.
- **Battle maps are tiles of the quadtree.** A battle-map tile is a cell at a fixed level (for example 64 by 64 squares, about 320 feet on a side) treated as locally flat. A square is addressed by tile cell id plus local x,y. With S2's quadratic face projection, cell edges at one level vary by at most about 1.8x and areas by about 2.1x over the whole sphere; that is accepted, since squares only need to be consistent and unique, not surveyed.
- **Flat and disc worlds** use the same quadtree over a single face without the sphere projection.
- **Hexes are a derived view**, rendered at regional levels for overland travel and combat, with each hex mapped to the cell containing its centroid. They never carry identity.
- **Places carry cells.** A `place` resource may carry the cell it occupies at its scale (a realm at level 8, a town at level 15, a building at level 20) in addition to GeoJSON geometry, so containment and proximity queries are prefix comparisons.
- **Generation on demand.** A request for a cell with no content at a point in time becomes a generation job seeded by `world/cell/<cellId>/<time>`, so the same empty place always fills in the same way until an author changes it. Battle-map art is rendered as SVG from the generated tile, so it stays vector, small, and stylable, including by offline LLM-driven asset generation in a consistent style.

## Consequences

- Vector tiles for the Atlas are cut from PostGIS geometry as planned; the quadtree adds ids and containment, it does not replace geometry.
- The 2019 icosahedron experiment is retired: geodesic grids are more uniform but do not nest, which matters more here.
- `@opendnd/spatial` implements cell ids, projection for a given world radius, containment, neighbours and battle-map tile addressing. Position bits use Z-order rather than S2's Hilbert curve; the layout and level semantics match S2, so the curve can be swapped without changing the API.

## Decided later, 2026-09-06

- **Generated places are placed.** The settlement and realm generators give every place a cell at the level whose cells are about the size of its land, and every child a cell inside its parent's, clear of its siblings' where there is room, from the same seeded source as everything else, so a realm lands in the same place each time it is generated. A place too large for its parent's cell takes the level just below the parent's: containment is what the quadtree promises, not exact area. A generator asked for a place `within` another puts it inside that place's cell; asked for nothing, it chooses a spot on the world.
- **Anything can be placed from the map.** A record without a cell is placed by choosing a square of a grid laid over the cell in view, at whatever level is wanted, and records that refer to the record in view can be scattered inside it in one go. Placement is a write to the record's cell field like any other, so it has a revision and an event.
- **The map is the cells.** The application draws a world from the cell tokens its records carry, on one face at a time, without a tile server: a cell's position inside the cell in view is arithmetic on the token. Tiles for terrain and imagery remain the plan for when there is something to render into them; the identity they will be addressed by is already on every generated place.

## Decided later, 2026-09-07: the map as a map

- **The map pans and zooms over picture tiles.** The world's own record may name a base map under `map`: a URL template for tiles in the web map projection, with the zooms it covers and who drew it. The application draws those tiles beneath the records the way every web map has worked, and draws the records on a blank globe when there are none. Tiles are pictures; what a record's place means is still its cell.
- **Cells are put on the map by the projection, in the application.** The cube-sphere projection is small enough that the application carries what it needs of it: a cell's centre and outline in latitude and longitude, and the cell under a point. The two copies are held to the same reference values by their tests.
- **A view is fetched by sampling.** The view is sampled on a grid; the distinct cells under the samples, at a level coarse enough that there are few, are asked for what is inside them down to the finest level worth drawing at the zoom, and their faces for anything coarser. The API gained `maxLevel` for the ceiling, one comparison on the cell id's lowest set bit. This keeps a zoomed-out view of a world with thousands of places to a few requests for its continents and kingdoms.
- **Placing is a click.** An editor comes to the map with a record and chooses its spot; the cell is as fine as the zoom, or as chosen. The grid laid over the view, and scattering a record's dependants inside it, went with the drawn-from-cells map; a whole world is placed by the generators' placement, as the seeds do.

## Decided later, 2026-09-08: a drawn world is read, not traced

A world that already exists usually exists as a drawing: a vector file of coastlines and borders. The plan had been to trace the pictures made from that drawing — classify the colours of a tile pyramid, and vectorise the result. Reading the drawing instead is better in every way that matters: every coast is an exact curve rather than a run of pixels to be guessed at, lakes are declared rather than inferred, and there is nothing to tune.

- **The drawing is the source; pictures made from it are a rendering.** What a coastline is comes from the vector file. A pyramid of pictures is then something to check the reading against, not something to read.
- **Colour says nothing.** A drawing reuses a small palette across many shapes, so a fill cannot identify a shape. Layer names can, and are what is read: which continent a shape belongs to, and whether it is water.
- **Where the drawing sits on the globe is stated, not assumed**, and so is which vertical it runs in. A drawing already in the square a web map is served in is chopped; one drawn pole to pole is projected. The difference puts a pole a hemisphere out.
- **A layer may be placed on its own.** A drawing is edited after it has been tiled, and a continent moves. Rather than choosing between the drawing and the pictures, each layer is placed where the pictures say it is, and the drawing becomes what the pictures were made from.
- **Elevation is generated, not recovered.** A political map holds no height. What is taken from it is the coastline, as the constraint a generated heightfield must satisfy — which is what makes a drawn world and a generated one the same kind of thing, and is the point of doing any of this.

## Decided later, 2026-09-08: the order water needs

A heightfield is easy and a heightfield with working rivers is not. The failures are well known and each has a fix that only works in a particular place in the sequence, so the sequence is the decision.

- **Ranges are lines, not noise.** A range is a spine with height falling away either side. Noise alone gives isolated peaks with no watershed between them, and without a watershed there is nothing for a river to be. A world that already says where its mountains are hands its spines in, and they are fixed points the rest is fitted around.
- **Every hollow is filled before any water moves.** This is the step that decides whether the rivers work. It also leaves flats behind, where nothing is lower than anything else, so the flood records the way it came in: that is by construction a path to an outlet, and it is what a river follows across a plain rather than stopping on it.
- **Weather is settled before water runs**, because rain is what a river carries, and a range's dry side should have small rivers rather than the same rivers as its wet side.
- **Rivers are found, not drawn.** They are the cells where enough water has gathered. Given drained ground and the sea as the only sink, such a cell must have high ground above it and a way to the sea below it — so "begins in the mountains and ends in the ocean" is a property of the method rather than something to enforce afterwards.
- **A world joins up east to west.** The map's side edges are not edges; only the poles are, and water reaching them has left what is modelled.
- **Elevation is invented, and says so.** A drawn map holds no height. What the drawing constrains is the coastline; everything above and below it is generated, and the same generator with no coastline handed to it makes a world from nothing. That is what makes a drawn world and a generated one the same kind of thing.

## Decided later, 2026-09-09: a place holds cells

A border is a curve, and a curve is a poor thing to own. You cannot ask it what it covers without measuring, two of them cannot be compared without arithmetic, and nothing about it survives being written into a record except as a picture.

- **A place has an `extent`: the quadtree cells it holds.** Coarse cells inland, fine ones along the edge. Whether a place holds somewhere is then a prefix test rather than a geometry problem, two places can be compared by set arithmetic, and **when a border moves, cells change hands — which is what a border moving is**. That makes conquest an ordinary edit rather than a redrawing.
- **`cell` stays what it was**: where a place *is*, one cell at its own scale. `extent` is what it *covers*. A town has the first and not the second; a kingdom has both.
- **A covering is built the way any quadtree covering is**: start at the faces, keep a cell wholly inside the shape, discard one wholly outside, split the ones on the edge, and stop at a given fineness or a given number of cells. The number matters more than the fineness — a country wants a hundred or two cells, not the ten thousand an exact border would take.
- **The drawing is still the drawing.** A covering approximates a border and is not it; a map is drawn from the curves. The extent is for the questions a record has to answer — who holds this ground, how much of it is there, what is next to what.
