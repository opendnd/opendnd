import { CellId, faceUVToPoint, pointToLatLng, stToUV } from '@opendnd/spatial';
import { type LatLng, type MapFit, toLatLng } from './fit';
import type { Point, Ring } from './path-data';
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
 * It is built by descending the tree: start at the faces, keep any cell
 * wholly inside the shape, throw away any cell wholly outside it, and split
 * the ones the border runs through — until the cells are as fine as asked for
 * or there are as many as will be carried. What is still on the border then
 * is settled by which side holds the middle of it, so that neighbours divide
 * the ground between them rather than both claiming it.
 */

export interface CoveringOptions {
  /** How fine the cells may get. Higher is a closer fit and more of them. */
  readonly maxLevel?: number;
  /** How many cells to stop at. The border is left coarse once this is reached. */
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
  const fences = shape.rings.map((ring) => fenceOf(fit, ring));
  if (fences.length === 0) return [];

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
  let front = open.filter((cell) => touches(cell, fences));
  for (let level = minLevel; level <= maxLevel; level += 1) {
    const next: CellId[] = [];
    const straddling: CellId[] = [];
    for (const cell of front) {
      if (inside(cell, fences)) {
        kept.push(cell);
        continue;
      }
      if (level === maxLevel) {
        straddling.push(cell);
        continue;
      }
      for (const child of cell.children()) {
        if (touches(child, fences)) next.push(child);
      }
    }
    // Splitting stops at the finest level asked for, or once there are more
    // cells than will be carried. Either way what is left straddles the
    // border, and a cell that straddles goes to whichever side holds most of
    // it — its middle decides. Keeping every cell the border passes through
    // would be a covering, which is the right answer to "where might this
    // be" and the wrong one to "whose is this": two neighbours would hold
    // the same ground, and a point in either would come back as both.
    if (level === maxLevel || kept.length + next.length > most) {
      for (const cell of straddling.length > 0 ? straddling : next) {
        if (within(cell.centerLatLng(), fences)) kept.push(cell);
      }
      break;
    }
    front = next;
    if (front.length === 0) break;
  }

  // Nothing kept is inside anything else kept: a cell is either kept whole or
  // split, and only its children go on. So the tokens are the answer.
  return [...new Set(kept.map((cell) => cell.token()))].sort();
}

/**
 * How much of the globe a set of cells is, as a share of the whole.
 *
 * Cells of one level are of near enough equal area — that is what the
 * quadratic projection buys, against the eightfold spread a plain cube would
 * give — so the share is a count weighted by level, and a place's size can be
 * read off the ground it holds rather than measured again from a drawing.
 */
export function shareOfGlobe(cells: readonly string[]): number {
  let share = 0;
  for (const token of cells) {
    share += 1 / (6 * 4 ** CellId.fromToken(token).level());
  }
  return share;
}

interface Box {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

/**
 * A ring of the drawing, on the globe, indexed for asking about points.
 *
 * A country's outline is thousands of points long, and a covering asks about
 * it thousands of times, so walking the whole ring for every question is the
 * difference between a second and a minute. The ring is therefore sorted into
 * bands of latitude: a question at one latitude only concerns the edges that
 * reach it, which is a few dozen rather than all of them.
 */
interface Fence {
  readonly points: Point[];
  readonly box: Box;
  readonly bands: number[][];
  readonly bandHeight: number;
  /** Every point of the ring as a leaf cell, in order, for asking whether a
   * cell holds any of them. A cell is a range of leaf ids, so that is a
   * search in a sorted list — and it is exact, where a box of latitudes and
   * longitudes is not: a cell can span the meridian where the day changes,
   * and its corners then say west of here and east of there, which is
   * everywhere except where the cell actually is. */
  readonly at: bigint[];
}

function fenceOf(fit: MapFit, ring: Ring): Fence {
  const points = ring.map((point) => {
    const at = toLatLng(fit, point);
    return [at.lng, at.lat] as Point;
  });
  const box: Box = {
    north: Math.max(...points.map((point) => point[1])),
    south: Math.min(...points.map((point) => point[1])),
    east: Math.max(...points.map((point) => point[0])),
    west: Math.min(...points.map((point) => point[0])),
  };
  const count = Math.max(
    1,
    Math.min(1024, Math.ceil(Math.sqrt(points.length))),
  );
  const bandHeight = (box.north - box.south) / count || 1;
  const bands: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < points.length; i += 1) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;
    const first = bandOf(
      bands.length,
      box,
      bandHeight,
      Math.min(from[1], to[1]),
    );
    const last = bandOf(
      bands.length,
      box,
      bandHeight,
      Math.max(from[1], to[1]),
    );
    for (let band = first; band <= last; band += 1) bands[band]!.push(i);
  }
  const at = points
    .map((point) => CellId.fromLatLng({ lat: point[1], lng: point[0] }, 30).id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { points, box, bands, bandHeight, at };
}

function bandOf(count: number, box: Box, height: number, lat: number): number {
  const at = Math.floor((lat - box.south) / height);
  return at < 0 ? 0 : at > count - 1 ? count - 1 : at;
}

/** Whether a place on the globe is inside the shape, holes taken out. */
function within(at: LatLng, fences: Fence[]): boolean {
  let inside_ = false;
  for (const fence of fences) {
    if (insideFence(fence, at.lng, at.lat)) inside_ = !inside_;
  }
  return inside_;
}

/** Even-odd crossing count, over the edges that reach this latitude. */
function insideFence(fence: Fence, x: number, y: number): boolean {
  const { box } = fence;
  if (y < box.south || y > box.north || x < box.west || x > box.east) {
    return false;
  }
  let inside_ = false;
  for (const i of fence.bands[
    bandOf(fence.bands.length, box, fence.bandHeight, y)
  ]!) {
    const from = fence.points[i]!;
    const to = fence.points[(i + 1) % fence.points.length]!;
    if (from[1] > y !== to[1] > y) {
      const crossing =
        from[0] + ((y - from[1]) / (to[1] - from[1])) * (to[0] - from[0]);
      if (x < crossing) inside_ = !inside_;
    }
  }
  return inside_;
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

/** Whether the whole of a cell is inside the shape. */
function inside(cell: CellId, fences: Fence[]): boolean {
  if (!cornersOf(cell).every((corner) => within(corner, fences))) return false;
  // Corners are not enough. A bay can bite into a cell between two corners
  // that are both on land, and an island in a lake, or a smaller outline
  // drawn inside a larger one, can sit in the middle of a cell without
  // coming near its corners. If any outline passes through the cell at all,
  // some of the cell is not the shape's, and it has to be split.
  return !fences.some((fence) => holdsAPoint(fence, cell));
}

/** Whether any corner of a cell is inside the shape, or the shape is inside it. */
function touches(cell: CellId, fences: Fence[]): boolean {
  if (cornersOf(cell).some((corner) => within(corner, fences))) return true;
  // A cell far larger than the shape holds all of it and none of its corners
  // are in it, and so does a cell the coast merely pokes into. Either way the
  // shape has a point in the cell.
  return fences.some((fence) => holdsAPoint(fence, cell));
}

/** Whether the ring has a point in this cell: a search in a sorted list. */
function holdsAPoint(fence: Fence, cell: CellId): boolean {
  const from = cell.rangeMin();
  const to = cell.rangeMax();
  let low = 0;
  let high = fence.at.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fence.at[middle]! < from) low = middle + 1;
    else high = middle;
  }
  return low < fence.at.length && fence.at[low]! <= to;
}
