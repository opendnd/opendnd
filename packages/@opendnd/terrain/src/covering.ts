import { CellId, faceUVToPoint, pointToLatLng, stToUV } from '@opendnd/spatial';
import { type LatLng, type MapFit, toLatLng } from './fit';
import { type Point, type Ring, inRing } from './path-data';
import type { MapShape } from './svg-map';

/**
 * The ground a place holds, as cells.
 *
 * A border is a curve, and a curve is a poor thing to own: you cannot ask it
 * what it covers without measuring, and two of them cannot be compared
 * without arithmetic. A set of quadtree cells can be owned. It says exactly
 * what ground belongs to whom, at whatever grain matters; asking whether a
 * place holds somewhere is a prefix test; and when a border moves, cells
 * change hands, which is what a border moving *is*.
 *
 * The covering is built the way any quadtree covering is: start at the faces,
 * keep any cell wholly inside the shape, throw away any cell wholly outside
 * it, and split the ones on the edge — until the cells are as fine as asked
 * for or there are as many as will be carried.
 */

export interface CoveringOptions {
  /** How fine the cells may get. Higher is a closer fit and more of them. */
  readonly maxLevel?: number;
  /** How many cells to stop at. The edge is left coarse once this is reached. */
  readonly most?: number;
  /** How coarse a cell may be kept. Guards against swallowing a hemisphere. */
  readonly minLevel?: number;
}

/** The cells covering a shape of the drawing, as tokens. */
export function coveringOf(
  shape: MapShape,
  fit: MapFit,
  options: CoveringOptions = {},
): string[] {
  const maxLevel = options.maxLevel ?? 10;
  const minLevel = options.minLevel ?? 2;
  const most = options.most ?? 64;
  const rings = shape.rings.map((ring) => onTheGlobe(fit, ring));
  if (rings.length === 0) return [];

  // Every face of the cube, split down to the coarsest level allowed, is
  // where the search starts; below that a shape the size of a country would
  // have to climb out of a sixth of the world.
  let open: CellId[] = [];
  for (let face = 0; face < 6; face += 1) {
    open.push(CellId.fromFaceIJ(face, 0, 0, 0));
  }
  for (let level = 0; level < minLevel; level += 1) {
    open = open.flatMap((cell) => cell.children());
  }

  const kept: CellId[] = [];
  const edge: CellId[] = [];
  let front = open.filter((cell) => touches(cell, rings));
  for (let level = minLevel; level <= maxLevel; level += 1) {
    const next: CellId[] = [];
    for (const cell of front) {
      if (inside(cell, rings)) {
        kept.push(cell);
        continue;
      }
      if (level === maxLevel) {
        edge.push(cell);
        continue;
      }
      for (const child of cell.children()) {
        if (touches(child, rings)) next.push(child);
      }
    }
    // Once there are more cells than will be carried, whatever is left on the
    // edge is kept as it stands rather than split further.
    if (kept.length + next.length > most) {
      edge.push(...next);
      break;
    }
    front = next;
    if (front.length === 0) break;
  }

  const all = [...kept, ...edge];
  // A cell inside a cell already kept adds nothing.
  const tokens = all
    .filter(
      (cell) => !all.some((other) => other !== cell && other.contains(cell)),
    )
    .map((cell) => cell.token());
  return [...new Set(tokens)].sort();
}

/** A ring of the drawing, on the globe. */
function onTheGlobe(fit: MapFit, ring: Ring): LatLng[] {
  return ring.map((point) => toLatLng(fit, point));
}

/**
 * The four corners of a cell, as places on the globe.
 *
 * A cell spans one unit of (i, j) at its level, which is one over two to the
 * level in the square coordinates of its face; the corners are those bounds
 * put through the projection, not the centres of the cells beside it.
 */
function cornersOf(cell: CellId): LatLng[] {
  const [i, j] = cell.ij();
  const across = 2 ** cell.level();
  const face = cell.face();
  return (
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const
  ).map(([di, dj]) =>
    pointToLatLng(
      faceUVToPoint(face, stToUV((i + di) / across), stToUV((j + dj) / across)),
    ),
  );
}

/** Whether every corner of a cell is inside the shape. */
function inside(cell: CellId, rings: LatLng[][]): boolean {
  return cornersOf(cell).every((corner) => within(corner, rings));
}

/** Whether any corner of a cell is inside the shape, or the shape is inside it. */
function touches(cell: CellId, rings: LatLng[][]): boolean {
  const corners = cornersOf(cell);
  if (corners.some((corner) => within(corner, rings))) return true;
  // A cell far larger than the shape holds all of it and none of its corners
  // are in it, so the shape's own points are asked about too.
  const box = boxOf(corners);
  return rings.some((ring) =>
    ring.some(
      (point) =>
        point.lat >= box.south &&
        point.lat <= box.north &&
        point.lng >= box.west &&
        point.lng <= box.east,
    ),
  );
}

function boxOf(corners: LatLng[]): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  return {
    north: Math.max(...corners.map((c) => c.lat)),
    south: Math.min(...corners.map((c) => c.lat)),
    east: Math.max(...corners.map((c) => c.lng)),
    west: Math.min(...corners.map((c) => c.lng)),
  };
}

/** Whether a place on the globe is inside the shape, holes taken out. */
function within(at: LatLng, rings: LatLng[][]): boolean {
  let inside_ = false;
  for (const ring of rings) {
    const flat: Point[] = ring.map((point) => [point.lng, point.lat]);
    if (inRing(flat, [at.lng, at.lat])) inside_ = !inside_;
  }
  return inside_;
}
