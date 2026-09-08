---
title: '@opendnd/terrain'
description: Reading the shapes out of a map somebody drew, so a drawn world and a generated one are the same kind of thing.
---

A world arrives one of two ways: somebody drew it, or nobody has yet. `@opendnd/terrain` is where the first becomes the second's equal. The shapes are read out of the drawing and become the same coastline a generated world would have produced, so everything downstream — the height under the land, the climate over it, the tiles drawn from both — stops caring which it was.

Today the package reads drawings. Generating a world from nothing is the next piece, and it will produce the same shapes.

## Reading a drawing

Plenty of worlds already exist as an SVG: a coastline and a set of borders in a vector tool. That drawing holds more than a picture of it ever can — every coast is an exact curve rather than a run of pixels to be guessed at — so it is read as data rather than traced.

```ts
import { readDrawnMap, rasterize, landAt } from '@opendnd/terrain';

const map = readDrawnMap(await Bun.file('world.svg').text());
// { width, height, groups: ['Wyveria', 'Symeria', …], shapes: [ … ] }
```

Each shape carries the layer it was drawn on, whether it is land or water, its rings in the drawing's own units, its bounding box and its area. What is read is deliberately little. In particular **colours are ignored**: a drawing reuses a small palette across many shapes, so a colour says nothing about which shape it is.

Water is told from land by the name of the shape or of any layer above it — `Water`, `Lake`, `Sea`, and so on, or whatever pattern you pass. A drawing that says which layer is water is telling you where its lakes and inland seas are, and that is worth having: a lake is a hole in the land, not a hole in the world, and the two behave differently once there is height under them.

`transform` is honoured on both groups and shapes, which matters more than it sounds: a drawing tool places its layers rather than moving their coordinates, so a shape's numbers mean nothing until everything above it has had its say.

## Putting it on a globe

A drawing has no idea where on a world it is; it is a rectangle of made-up units. What turns it into geography is one decision — which part of the drawing is the whole world — written down as a `MapFit` rather than assumed:

```ts
import { wholeDrawing, toLatLng } from '@opendnd/terrain';

const fit = wholeDrawing(map.width, map.height);
toLatLng(fit, [5120, 5120]); // { lat: 0, lng: 0 }
```

The one thing that must be said is which vertical the drawing runs in. `mercator`, the default, means the drawing is already in the square a web map is served in — which is what a drawing that has been tiled is, and its top edge is then as far north as a web map goes rather than the pole. `equirectangular` is what somebody drawing a world by hand without tiling it usually means: latitude straight down the page, pole to pole. Read a drawing as the wrong one and its poles land a hemisphere's worth out of place.

## Moving a layer

A drawing gets edited after it has been published: a continent is nudged, or redrawn at a different size, and the pictures already made from it stay as they were. Rather than choose between the drawing and the pictures, place each layer where the pictures say it is:

```ts
import { boxToWhole, placeGroups } from '@opendnd/terrain';

const placed = placeGroups(map, {
  Wyveria: boxToWhole({ left: 300, top: -310, width: 9930, height: 9940 }, 10240, 10240),
});
```

## Drawing a tile

The point of reading a drawing rather than tracing pictures of it is that the coast stays a curve, so a tile is SVG: the same béziers the coast was drawn with, placed into the tile's own coordinates.

```ts
import { drawTile } from '@opendnd/terrain';

drawTile(map, { box: { left: 0, top: 0, right: 160, bottom: 160 }, size: 256 });
```

A bay is then as smooth at the zoom of a bay as at the zoom of a continent, which a grid of samples can never be — a coast sampled once at the wrong scale has corners in it forever. Shapes that cross the tile's edge are drawn whole and clipped, because a coast cut at a tile edge and a coast that ends at one look different and only one of them is right.

Curves survive the whole way: `outlinesOf` keeps them, `flatten` turns one into points when geometry is being asked rather than drawn, and `pathDataOf` hands them back as an SVG `d`. A shape carries both — `rings` for what is inside it, `outlines` for what it looks like.

## Filling a grid

Asking a shape whether it holds a point is fine for one point and hopeless for a million: a coastline is thousands of segments and a world is thousands of coastlines. `rasterize` draws the shapes into a grid once, by scanlines, and every later question becomes a lookup. Shapes are drawn in the order the drawing gives, so a lake over a continent is water and an island in the lake is land again.

```ts
const raster = rasterize(map, { width: 8192 });
landAt(raster, x, y); // true or false, immediately
```

`landFraction` measures how much of a square is land, which is the one measurement that can be taken of both a drawing and a picture made from it — and so the way to check that a drawing has been put on the globe correctly.

## Testing

```bash
cd packages/@opendnd/terrain && bun run test
```

The specs read an invented drawing in the shape a vector tool exports — a background for the sea, a group per continent, a water group inside one of them, and paths written the way a tool writes them.
