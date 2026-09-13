import { boundsOf, inRing, signedArea, type Point } from './path-data';
import type { MapShape } from './svg-map';

/**
 * Who holds which painted region.
 *
 * A political drawing reuses a small palette, so a fill is a class of
 * neighbours rather than a country's name. The name comes from a seat — the
 * cell a place already has — dropped into the region that contains it.
 * Regions of the same fill with no seat of their own go to the nearest
 * same-fill seat, so two purple countries stay two countries.
 *
 * A region is a ring, not a path. Nobody draws a political map a country at
 * a time: every piece of one colour is drawn as a single path, so a path is
 * a colour scattered across a continent and claiming one would hand a seat
 * every purple country there is.
 */

/** Fills that are water, ice, or unpainted ground, not a polity. */
const SKIP = new Set(['white', '#fff', '#ffffff', '#ebebeb', '#b6d1db']);

export function isPoliticalFill(fill: string | undefined): boolean {
  if (fill === undefined) return false;
  return !SKIP.has(fill.toLowerCase());
}

/** Whether a point sits inside a shape, holes taken out. */
export function inShape(
  shape: Pick<MapShape, 'rings' | 'bounds'>,
  point: Point,
): boolean {
  const [minX, minY, maxX, maxY] = shape.bounds;
  if (
    point[0] < minX ||
    point[0] > maxX ||
    point[1] < minY ||
    point[1] > maxY
  ) {
    return false;
  }
  let inside = false;
  for (const ring of shape.rings) {
    if (inRing(ring, point)) inside = !inside;
  }
  return inside;
}

/**
 * One shape per painted region: a path's rings taken apart.
 *
 * Which ring is land and which is a lake is what even-odd fill already says
 * — a ring inside one other ring is a hole, a ring inside two is an island
 * in a lake — so depth decides, and a hole belongs to the ring that holds it
 * most closely.
 */
export function piecesOf(shapes: readonly MapShape[]): MapShape[] {
  const out: MapShape[] = [];
  for (const shape of shapes) {
    if (shape.rings.length < 2) {
      out.push(shape);
      continue;
    }
    const count = shape.rings.length;
    const boxes = shape.rings.map((ring) => boundsOf([ring]));
    const holders: number[][] = [];
    for (let inner = 0; inner < count; inner += 1) {
      const point = shape.rings[inner]?.[0];
      const found: number[] = [];
      for (let outer = 0; outer < count; outer += 1) {
        if (outer === inner || point === undefined) continue;
        const box = boxes[outer]!;
        if (
          point[0] < box[0] ||
          point[0] > box[2] ||
          point[1] < box[1] ||
          point[1] > box[3]
        ) {
          continue;
        }
        if (inRing(shape.rings[outer]!, point)) found.push(outer);
      }
      holders.push(found);
    }
    const depth = holders.map((found) => found.length);
    const parent = holders.map((found) =>
      found.reduce(
        (best, at) => (best < 0 || depth[at]! > depth[best]! ? at : best),
        -1,
      ),
    );
    for (let at = 0; at < count; at += 1) {
      if (depth[at]! % 2 === 1) continue;
      const holes: number[] = [];
      for (let hole = 0; hole < count; hole += 1) {
        if (depth[hole]! % 2 === 1 && parent[hole] === at) holes.push(hole);
      }
      const rings = [shape.rings[at]!, ...holes.map((j) => shape.rings[j]!)];
      const outlines = [at, ...holes]
        .map((j) => shape.outlines[j])
        .filter((outline) => outline !== undefined);
      const area = rings.reduce(
        (sum, ring, ringAt) =>
          sum + (ringAt === 0 ? 1 : -1) * (Math.abs(signedArea(ring)) / 2),
        0,
      );
      out.push({
        ...shape,
        rings,
        outlines,
        bounds: boundsOf(rings),
        area: Math.max(area, 0),
      });
    }
  }
  return out;
}

/** The painted regions of a drawing: land, a political colour, one per ring. */
function politicalPieces(shapes: readonly MapShape[]): MapShape[] {
  return piecesOf(
    shapes.filter(
      (shape) => shape.kind === 'land' && isPoliticalFill(shape.fill),
    ),
  );
}

export interface FillSeat {
  readonly key: string;
  readonly at: Point;
}

export interface Skip {
  readonly key: string;
  readonly reason: string;
}

export interface Contest {
  readonly shape: MapShape;
  readonly keys: readonly string[];
}

export interface ClaimResult {
  readonly claimed: ReadonlyMap<string, MapShape[]>;
  readonly skipped: readonly Skip[];
  readonly unclaimed: number;
  readonly contested: readonly Contest[];
}

/** Share painted land paths among seats. */
export function claimByFill(
  shapes: readonly MapShape[],
  seats: readonly FillSeat[],
): ClaimResult {
  const political = politicalPieces(shapes);
  const skipped: Skip[] = [];
  const home = new Map<string, MapShape>();
  const ownersOf = new Map<MapShape, string[]>();

  for (const seat of seats) {
    const hits = political.filter((shape) => inShape(shape, seat.at));
    if (hits.length === 0) {
      skipped.push({
        key: seat.key,
        reason: 'seat is not in a political fill',
      });
      continue;
    }
    // A country painted over a continent's own colour leaves a seat inside
    // both. The smaller region is the one drawn later and the one meant: a
    // seat in Wyveria and in a kingdom of Wyveria is in the kingdom.
    const shape = hits.reduce((best, hit) =>
      hit.area < best.area ? hit : best,
    );
    const others = ownersOf.get(shape) ?? [];
    others.push(seat.key);
    ownersOf.set(shape, others);
    home.set(seat.key, shape);
  }

  const contested: Contest[] = [];
  const contestedShapes = new Set<MapShape>();
  for (const [shape, keys] of ownersOf) {
    if (keys.length < 2) continue;
    contested.push({ shape, keys: [...keys] });
    contestedShapes.add(shape);
    for (const key of keys) home.delete(key);
  }

  const fillOf = new Map<string, string>();
  for (const [shape, keys] of ownersOf) {
    if (shape.fill === undefined) continue;
    for (const key of keys) fillOf.set(key, shape.fill);
  }
  const byFill = new Map<string, FillSeat[]>();
  for (const seat of seats) {
    const fill = fillOf.get(seat.key) ?? home.get(seat.key)?.fill;
    if (fill === undefined) continue;
    const group = byFill.get(fill) ?? [];
    group.push(seat);
    byFill.set(fill, group);
  }

  const claimed = new Map<string, MapShape[]>();
  let unclaimed = 0;
  for (const shape of political) {
    if (contestedShapes.has(shape)) continue;
    const seated = [...home.entries()].find(
      ([, homeShape]) => homeShape === shape,
    );
    if (seated) {
      const held = claimed.get(seated[0]) ?? [];
      held.push(shape);
      claimed.set(seated[0], held);
      continue;
    }
    const neighbours = shape.fill ? (byFill.get(shape.fill) ?? []) : [];
    if (neighbours.length === 0) {
      unclaimed += 1;
      continue;
    }
    const at = middleOf(shape);
    let nearest: FillSeat | undefined;
    let closest = Infinity;
    for (const seat of neighbours) {
      // Nothing joins a country by being larger than it. An unseated region
      // of a seat's own colour is an island of it, or a piece of it across a
      // strait — not the continent it was painted on.
      const own = home.get(seat.key)?.area;
      if (own !== undefined && shape.area > own) continue;
      const dx = seat.at[0] - at[0];
      const dy = seat.at[1] - at[1];
      const d = dx * dx + dy * dy;
      if (d < closest) {
        closest = d;
        nearest = seat;
      }
    }
    if (!nearest) {
      unclaimed += 1;
      continue;
    }
    const held = claimed.get(nearest.key) ?? [];
    held.push(shape);
    claimed.set(nearest.key, held);
  }

  const onContest = new Set(contested.flatMap((item) => item.keys));
  for (const seat of seats) {
    if (skipped.some((skip) => skip.key === seat.key)) continue;
    if (onContest.has(seat.key)) continue;
    if ((claimed.get(seat.key) ?? []).length === 0) {
      skipped.push({ key: seat.key, reason: 'no paths claimed' });
    }
  }

  return { claimed, skipped, unclaimed, contested };
}

/** A painted region that contains `at`, or the nearest centroid if none does. */
export function nearestPolitical(
  shapes: readonly MapShape[],
  at: Point,
): MapShape | undefined {
  const political = politicalPieces(shapes);
  const holding = political.filter((shape) => inShape(shape, at));
  if (holding.length > 0) {
    return holding.reduce((best, hit) => (hit.area < best.area ? hit : best));
  }
  let best: MapShape | undefined;
  let closest = Infinity;
  for (const shape of political) {
    const mid = middleOf(shape);
    const dx = mid[0] - at[0];
    const dy = mid[1] - at[1];
    const d = dx * dx + dy * dy;
    if (d < closest) {
      closest = d;
      best = shape;
    }
  }
  return best;
}

/** A point of the drawing that sits on this path, for seating a neighbour. */
export function aPointOf(shape: MapShape): Point {
  const ring = shape.rings[0] ?? [];
  for (const point of ring) {
    if (inShape(shape, point)) return point;
  }
  return middleOf(shape);
}

/** One shape covering of every path a seat holds, for `coveringOf`. */
export function unionOf(shapes: readonly MapShape[]): MapShape | undefined {
  if (shapes.length === 0) return undefined;
  if (shapes.length === 1) return shapes[0];
  const rings = shapes.flatMap((shape) => shape.rings);
  return {
    group: shapes[0]!.group,
    kind: 'land',
    fill: shapes[0]!.fill,
    rings,
    outlines: shapes.flatMap((shape) => shape.outlines),
    bounds: boundsOf(rings),
    area: shapes.reduce((sum, shape) => sum + shape.area, 0),
  };
}

function middleOf(shape: MapShape): Point {
  const ring = shape.rings[0] ?? [];
  if (ring.length === 0) {
    return [
      (shape.bounds[0] + shape.bounds[2]) / 2,
      (shape.bounds[1] + shape.bounds[3]) / 2,
    ];
  }
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}
