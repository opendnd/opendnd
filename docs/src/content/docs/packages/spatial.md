---
title: "@opendnd/spatial"
description: One spatial identity from a planet down to a 5-foot square.
---

`@opendnd/spatial` implements the design in [ADR-006](/adr/adr-006-spatial-identity/): a cube-sphere quadtree in which every point on a world has exactly one cell at every level, ids nest, and the finest levels are battle-map squares.

## Cells

A `CellId` is a 64-bit id laid out as S2 does: 3 face bits, 60 position bits (two per level, i and j interleaved) and a trailing 1 that marks the level. Descendants of a cell occupy a contiguous id range, so `contains` and `intersects` are range checks and sorting groups nearby cells. Position bits use plain Z-order rather than S2's Hilbert curve, so tokens are not byte-identical to S2's for the same location, but the arithmetic and level semantics are the same and swapping the curve later would not change the API.

- Construct with `CellId.fromLatLng(ll, level)`, `fromPoint`, `fromFaceUV` (flat worlds use one face), `fromFaceIJ`, or `fromToken`.
- Navigate with `parent(level?)`, `children()`, `neighbors()` (four edge neighbours, wrapping across cube faces), `contains`, `intersects`.
- Locate with `center()`, `centerLatLng()`, `centerUV()`, `ij()`, `face()`, `level()`, `token()`.

Level 30 is the finest: under a centimetre on an Earth-sized world. The face projection is S2's quadratic curve, under which cell edges at one level vary by at most about 1.8x and areas by about 2.1x over the whole sphere.

## WorldGrid

`new WorldGrid({ radiusMeters, squareFeet = 5, tileSquares = 64 })` binds the quadtree to a world. It computes `squareLevel`, the level whose average edge is closest to one square (22 or 23 for Earth's radius), and `tileLevel`, six levels coarser for a 64 by 64 tile. `squareAt(ll)`, `tileAt(ll)`, `tileOf(square)`, `squareInTile(square)` giving local x,y, and `squareOf(tile, x, y)` address battle maps. `edgeMeters(level)` and `levelForEdge(radius, metres)` expose the scale ladder for the Atlas.

## What this is not

It is not the geometry store. Places keep GeoJSON geometry for rendering and PostGIS queries; the quadtree adds identity, containment and on-demand generation addresses. A `place` may carry its `cell` token at its own scale.
