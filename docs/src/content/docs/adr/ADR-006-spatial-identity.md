---
title: "ADR-006: Spatial identity from planet to 5-foot square"
description: A cube-sphere quadtree gives every point on a world one nested id at every zoom level, down to a battle-map square; hexes are a derived view.
---

**Status:** Proposed, 2026-09-03. Records the intended design ahead of the map and place generators.

## Context

The Atlas needs Google-Maps-style zoom from a whole planet to a street, and the game needs a battle map wherever the party stops. In fifth edition a battle-map square is 5 feet. We want any point on any world, at any zoom level, to resolve to one unique square so a battle map can be generated on demand and regenerated identically, and so places at every scale nest inside each other. Worlds may be spheres, flat planes or discs. Hex grids are the tabletop convention for overland travel, but hexes do not subdivide into hexes exactly, so a hex hierarchy cannot give stable nested ids.

## Decision

- **A cube-sphere quadtree is the single spatial identity system**, after the design of S2. Six cube faces project onto the sphere; each cell subdivides into four children; a cell id encodes face and path, so ids nest and every level of detail is a prefix relationship. Level 0 is a face; on an Earth-sized world level 22 or 23 is about 5 feet across. The level that equals 5 feet is computed from the world's radius and recorded on the World.
- **Battle maps are tiles of the quadtree.** A battle-map tile is a cell at a fixed level (for example 64 by 64 squares, about 320 feet on a side) treated as locally flat. A square is addressed by tile cell id plus local x,y. Distortion near cube edges is bounded to roughly 1.5x in area and is accepted.
- **Flat and disc worlds** use the same quadtree over a single face without the sphere projection.
- **Hexes are a derived view**, rendered at regional levels for overland travel and combat, with each hex mapped to the cell containing its centroid. They never carry identity.
- **Places carry cells.** A `place` resource may carry the cell it occupies at its scale (a realm at level 8, a town at level 15, a building at level 20) in addition to GeoJSON geometry, so containment and proximity queries are prefix comparisons.
- **Generation on demand.** A request for a cell with no content at a point in time becomes a generation job seeded by `world/cell/<cellId>/<time>`, so the same empty place always fills in the same way until an author changes it. Battle-map art is rendered as SVG from the generated tile, so it stays vector, small, and stylable, including by offline LLM-driven asset generation in a consistent style.

## Consequences

- Vector tiles for the Atlas are cut from PostGIS geometry as planned; the quadtree adds ids and containment, it does not replace geometry.
- The 2019 icosahedron experiment is retired: geodesic grids are more uniform but do not nest, which matters more here.
- A `@opendnd/spatial` package implementing cell ids, projection for a given world radius, containment and neighbour queries is the first step of the map slice.
