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
