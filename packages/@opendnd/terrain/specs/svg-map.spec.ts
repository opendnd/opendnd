import { describe, expect, it } from 'bun:test';
import { CellId } from '@opendnd/spatial';
import {
  IDENTITY,
  coveringOf,
  drawTile,
  flatten,
  outlinesOf,
  pathDataOf,
  boundsOf,
  boxToWhole,
  matrixOf,
  placeGroups,
  inRing,
  isLand,
  landFraction,
  latOf,
  readDrawnMap,
  ringsOf,
  shapesAt,
  signedArea,
  tileAt,
  tileBounds,
  tileInDrawing,
  toDrawing,
  toLatLng,
  vOf,
  wholeDrawing,
} from 'src';

/**
 * An invented drawing in the shape a vector tool exports: a background for the
 * sea, a group per continent, a group of water inside one of them, and paths
 * written the way a tool writes them — absolute cubics, no whitespace to
 * spare, a small palette reused across shapes.
 */
const DRAWING = `<svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
<g id="Elsewhere">
<rect width="1000" height="1000" fill="#B6D1DB"/>
<g id="Great Vale">
<path id="Path" d="M100 100L400 100L400 400L100 400Z" fill="#628975"/>
<g id="Water">
<path id="Water_1" d="M200 200L300 200L300 300L200 300Z" fill="#B6D1DB"/>
</g>
</g>
<g id="Little Vale">
<path id="Path" d="M600 600C700 600 700 700 600 700C500 700 500 600 600 600Z" fill="#CE7A7A"/>
<path id="Path" d="M900 900L950 900L950 950L900 950Z" fill="#CE7A7A"/>
</g>
</g>
</svg>`;

describe('reading a drawn map', () => {
  const map = readDrawnMap(DRAWING);

  it('takes its extent from the viewBox and its groups from the layers', () => {
    expect(map.width).toBe(1000);
    expect(map.height).toBe(1000);
    expect(map.groups).toEqual([
      'Elsewhere',
      'Great Vale',
      'Water',
      'Little Vale',
    ]);
  });

  it('reads every path, and lets a shape belong to the continent it is drawn in', () => {
    // Four paths; the rect is a background, not a shape, and is not read.
    expect(map.shapes).toHaveLength(4);
    expect(map.shapes.map((s) => s.group)).toEqual([
      'Great Vale',
      // The lake belongs to the continent, not to the layer called Water.
      'Great Vale',
      'Little Vale',
      'Little Vale',
    ]);
    expect(map.shapes.map((s) => s.kind)).toEqual([
      'land',
      'water',
      'land',
      'land',
    ]);
  });

  it('measures each shape, so a continent can be told from an island', () => {
    expect(map.shapes[0]!.area).toBe(300 * 300);
    expect(map.shapes[0]!.bounds).toEqual([100, 100, 400, 400]);
    expect(map.shapes[3]!.area).toBe(50 * 50);
    // The curved one is a lens a hundred tall bulging fifty either side, so
    // rather more than the ten thousand its bounding box would suggest at a
    // glance and rather less than the box itself.
    expect(map.shapes[2]!.area).toBeGreaterThan(11000);
    expect(map.shapes[2]!.area).toBeLessThan(13000);
  });

  it('says what is under a point, letting later shapes cover earlier ones', () => {
    expect(isLand(map, [150, 150])).toBe(true);
    // Inside the lake, which is drawn over the land it sits in.
    expect(isLand(map, [250, 250])).toBe(false);
    expect(isLand(map, [500, 500])).toBe(false);
    expect(isLand(map, [600, 650])).toBe(true);
    expect(shapesAt(map, [250, 250]).map((s) => s.kind)).toEqual([
      'land',
      'water',
    ]);
  });

  it('measures how much of a square is land', () => {
    const all = { left: 100, top: 100, right: 400, bottom: 400 };
    // The square less the lake: a ninth of it is water.
    expect(landFraction(map, all, 30)).toBeCloseTo(8 / 9, 2);
    expect(landFraction(map, { left: 0, top: 0, right: 50, bottom: 50 })).toBe(
      0,
    );
  });

  it('reads a drawing that says its size but no viewBox, and refuses one that says neither', () => {
    expect(
      readDrawnMap('<svg width="12" height="8"><path d="M0 0L1 0L1 1Z"/></svg>')
        .width,
    ).toBe(12);
    expect(() => readDrawnMap('<svg><path d="M0 0L1 0L1 1Z"/></svg>')).toThrow(
      /viewBox/,
    );
  });
});

describe('reading path data', () => {
  it('closes a subpath that was left open, because a shape is an area', () => {
    expect(ringsOf('M0 0L10 0L10 10')).toHaveLength(1);
  });

  it('reads several subpaths from one path, which is an island off a coast', () => {
    const rings = ringsOf('M0 0L10 0L10 10ZM20 20L30 20L30 30Z');
    expect(rings).toHaveLength(2);
    expect(rings[1]![0]).toEqual([20, 20]);
  });

  it('reads relative commands and repeated arguments', () => {
    // `l` twice over in one command, from a start of (5, 5).
    const [ring] = ringsOf('M5 5l5 0 0 5z');
    expect(ring).toEqual([
      [5, 5],
      [10, 5],
      [10, 10],
    ]);
  });

  it('reads numbers written without separators, the way a tool writes them', () => {
    const [ring] = ringsOf('M0 0L10-20L.5.5Z');
    expect(ring).toEqual([
      [0, 0],
      [10, -20],
      [0.5, 0.5],
    ]);
  });

  it('turns a curve into as many points as its shape needs', () => {
    const gentle = ringsOf('M0 0C1 0 2 0 3 0Z')[0]!;
    const sweeping = ringsOf('M0 0C300 0 600 0 900 0Z')[0]!;
    expect(sweeping.length).toBeGreaterThan(gentle.length);
    // Both end where the curve ends.
    expect(sweeping[sweeping.length - 1]).toEqual([900, 0]);
  });

  it('continues a smooth curve from the last one, mirrored', () => {
    const [ring] = ringsOf('M0 0C0 10 10 10 10 0S20 -10 20 0Z');
    expect(ring![ring!.length - 1]).toEqual([20, 0]);
  });

  it('knows which way round a ring goes, and what box holds it', () => {
    const clockwise = ringsOf('M0 0L10 0L10 10L0 10Z')[0]!;
    const other = [...clockwise].reverse();
    expect(Math.sign(signedArea(clockwise))).toBe(
      -Math.sign(signedArea(other)),
    );
    expect(boundsOf([clockwise])).toEqual([0, 0, 10, 10]);
  });

  it('tells inside from outside', () => {
    const [ring] = ringsOf('M0 0L10 0L10 10L0 10Z');
    expect(inRing(ring!, [5, 5])).toBe(true);
    expect(inRing(ring!, [15, 5])).toBe(false);
  });
});

describe('keeping the curves', () => {
  it('keeps a curve as a curve, and flattens it only when asked', () => {
    const [outline] = outlinesOf('M0 0C10 0 20 0 30 0L30 10Z');
    expect(outline!.from).toEqual([0, 0]);
    expect(outline!.segments).toHaveLength(2);
    expect(outline!.segments[0]!.via).toEqual([
      [10, 0],
      [20, 0],
    ]);
    expect(outline!.segments[1]!.via).toBeUndefined();
    // Flattening is a separate step, and how fine it is is the caller's.
    expect(flatten(outline!, 0.1).length).toBeGreaterThan(
      flatten(outline!, 10).length,
    );
  });

  it('gives the curves back as path data, so a coast is drawn as it was drawn', () => {
    const outlines = outlinesOf('M0 0C10 0 20 0 30 0Z');
    expect(pathDataOf(outlines)).toBe('M0 0C10 0 20 0 30 0Z');
    // With somewhere to put it: control points move with the rest.
    expect(pathDataOf(outlines, ([x, y]) => [x * 2, y + 5])).toBe(
      'M0 5C20 5 40 5 60 5Z',
    );
  });

  it('carries the curves onto every shape it reads', () => {
    const map = readDrawnMap(DRAWING);
    const lens = map.shapes[2]!;
    expect(lens.outlines).toHaveLength(1);
    expect(lens.outlines[0]!.segments.some((s) => s.via)).toBe(true);
    // The points and the curves describe the same shape.
    expect(lens.rings[0]!.length).toBeGreaterThan(
      lens.outlines[0]!.segments.length,
    );
  });
});

describe('drawing a tile', () => {
  const map = readDrawnMap(DRAWING);

  it('draws the shapes that reach the tile, as curves, over the sea', () => {
    const svg = drawTile(map, {
      box: { left: 0, top: 0, right: 500, bottom: 500 },
      size: 256,
    });
    expect(svg).toContain('width="256"');
    // The square continent and the lake in it are here; the far island is not.
    expect(svg.match(/<path /g)).toHaveLength(2);
    // Drawn as curves where the shape curved, and clipped to the tile.
    expect(svg).toContain('clip-path');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it('places the drawing into the tile, so the same coast lands in each', () => {
    const whole = drawTile(map, {
      box: { left: 100, top: 100, right: 400, bottom: 400 },
      size: 300,
    });
    // The continent fills this tile corner to corner: 100 in the drawing is 0.
    expect(whole).toContain('M0 0');
  });

  it('draws a curve as a curve in the tile it lands in', () => {
    const svg = drawTile(map, {
      box: { left: 500, top: 500, right: 800, bottom: 800 },
      size: 256,
    });
    expect(svg).toContain('C');
  });
});

describe('moving a layer of a drawing', () => {
  it('puts a named group where it is said to be, and leaves the rest alone', () => {
    const map = readDrawnMap(DRAWING);
    // The whole of a quarter of the drawing, stretched to be the drawing.
    const matrix = boxToWhole(
      { left: 500, top: 500, width: 500, height: 500 },
      1000,
      1000,
    );
    const moved = placeGroups(map, { 'Little Vale': matrix });
    const [, , lens, island] = moved.shapes;
    // The far island was at 900..950 in a 500-wide box from 500: now 800..900.
    expect(island!.bounds).toEqual([800, 800, 900, 900]);
    expect(island!.area).toBe(100 * 100);
    // Its neighbour in the same group moved with it: the lens reaches x 525,
    // which the same doubling puts at 50.
    expect(lens!.bounds[0]).toBeCloseTo(50, 6);
    // A group nobody mentioned is where it always was.
    expect(moved.shapes[0]!.bounds).toEqual([100, 100, 400, 400]);
  });

  it('reads a transform on a group and on a shape, and multiplies them', () => {
    const nested = readDrawnMap(
      `<svg viewBox="0 0 100 100"><g id="A" transform="translate(10 20)">` +
        `<path d="M0 0L10 0L10 10Z"/>` +
        `<path transform="scale(2)" d="M0 0L10 0L10 10Z"/></g></svg>`,
    );
    expect(nested.shapes[0]!.bounds).toEqual([10, 20, 20, 30]);
    expect(nested.shapes[1]!.bounds).toEqual([10, 20, 30, 40]);
  });

  it('reads the transforms a drawing tool writes', () => {
    expect(matrixOf(undefined)).toEqual(IDENTITY);
    expect(matrixOf('translate(3.5, -2)')).toEqual([1, 0, 0, 1, 3.5, -2]);
    expect(matrixOf('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(matrixOf('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
    // A quarter turn about the origin takes the x axis onto the y axis.
    const [a, b] = matrixOf('rotate(90)');
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(1, 9);
    // And about a point, that point does not move.
    const spin = matrixOf('rotate(90 10 10)');
    expect(spin[4] + 10 * spin[0] + 10 * spin[2]).toBeCloseTo(10, 9);
  });
});

describe('putting a drawing on a globe', () => {
  const fit = wholeDrawing(1000, 1000);

  it('puts the middle of a square drawing where the meridians cross', () => {
    const middle = toLatLng(fit, [500, 500]);
    expect(middle.lng).toBeCloseTo(0, 9);
    expect(middle.lat).toBeCloseTo(0, 9);
  });

  it('reaches as far north and south as the web map projection does', () => {
    expect(toLatLng(fit, [0, 0]).lat).toBeCloseTo(85.0511, 3);
    expect(toLatLng(fit, [0, 0]).lng).toBe(-180);
    expect(toLatLng(fit, [1000, 1000]).lat).toBeCloseTo(-85.0511, 3);
    expect(toLatLng(fit, [1000, 1000]).lng).toBe(180);
  });

  it('goes back the way it came', () => {
    for (const point of [
      [123, 456],
      [900, 100],
      [500, 999],
    ] as const) {
      const [x, y] = toDrawing(fit, toLatLng(fit, point));
      expect(x).toBeCloseTo(point[0], 6);
      expect(y).toBeCloseTo(point[1], 6);
    }
  });

  it('is the mercator projection, held to its own arithmetic', () => {
    // Half way to the pole in projected space is not half way in latitude.
    expect(latOf(0.25)).toBeCloseTo(66.5133, 3);
    expect(vOf(66.51326044311186)).toBeCloseTo(0.25, 6);
    expect(vOf(0)).toBeCloseTo(0.5, 9);
  });

  it('finds the tile a place falls in, and what that tile covers', () => {
    // At zoom one the world is four tiles; the north-west one is the first.
    expect(tileAt({ lat: 45, lng: -90 }, 1)).toMatchObject({ x: 0, y: 0 });
    expect(tileAt({ lat: -45, lng: 90 }, 1)).toMatchObject({ x: 1, y: 1 });
    const box = tileBounds(1, 0, 0);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(0);
    expect(box.north).toBeCloseTo(85.0511, 3);
    expect(box.south).toBeCloseTo(0, 9);
  });

  it('says which part of the drawing a tile was made from', () => {
    // A drawing already in the tile square is chopped, not projected: the
    // north-east tile of four is its north-east quarter.
    const box = tileInDrawing(fit, 1, 1, 0);
    expect(box.left).toBe(500);
    expect(box.right).toBe(1000);
    expect(box.top).toBeCloseTo(0, 6);
    expect(box.bottom).toBeCloseTo(500, 6);
  });

  it('chops a drawing already in the tile square, and projects one that is not', () => {
    const flat = wholeDrawing(1000, 1000, 'equirectangular');
    // Half way down an equirectangular drawing is the equator either way, but
    // the tile at the top covers only as far as a web map reaches, so its
    // share of a pole-to-pole drawing stops short of the top.
    expect(tileInDrawing(flat, 1, 0, 0).top).toBeCloseTo(27.494, 2);
    expect(tileInDrawing(flat, 1, 0, 0).bottom).toBeCloseTo(500, 6);
  });
});

describe('the ground a place holds', () => {
  /** A square of the drawing, which on the globe is a patch near the equator. */
  const patch = readDrawnMap(
    `<svg viewBox="0 0 1000 1000"><g id="Somewhere">` +
      `<path d="M480 480L520 480L520 520L480 520Z"/></g></svg>`,
  );
  const fit = wholeDrawing(1000, 1000);
  const shape = patch.shapes[0]!;

  it('covers a shape with cells, finer where it is asked to be', () => {
    const coarse = coveringOf(shape, fit, { maxLevel: 6, most: 64 });
    const fine = coveringOf(shape, fit, { maxLevel: 9, most: 400 });
    expect(coarse.length).toBeGreaterThan(0);
    expect(fine.length).toBeGreaterThan(coarse.length);
    // Every cell is a token: hex, with the trailing zeroes struck off.
    for (const token of fine) expect(token).toMatch(/^[0-9a-f]{1,16}$/);
  });

  it('covers the middle of the shape and nothing far from it', () => {
    const cells = coveringOf(shape, fit, { maxLevel: 8, most: 200 }).map(
      CellId.fromToken,
    );
    const middle = CellId.fromLatLng(toLatLng(fit, [500, 500]), 20);
    expect(cells.some((cell) => cell.contains(middle))).toBe(true);
    // The far side of the world is not part of a patch on this side of it.
    const elsewhere = CellId.fromLatLng({ lat: -60, lng: 170 }, 20);
    expect(cells.some((cell) => cell.contains(elsewhere))).toBe(false);
  });

  it('keeps no cell inside another, so nothing is held twice', () => {
    const cells = coveringOf(shape, fit, { maxLevel: 9, most: 300 }).map(
      CellId.fromToken,
    );
    for (const cell of cells) {
      for (const other of cells) {
        if (cell.equals(other)) continue;
        expect(other.contains(cell)).toBe(false);
      }
    }
  });

  it('stops at the number of cells it was told to carry', () => {
    expect(
      coveringOf(shape, fit, { maxLevel: 14, most: 40 }).length,
    ).toBeLessThan(160);
  });
});
