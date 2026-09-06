import type { Rng } from '@opendnd/random';
import { CellId, EARTH_RADIUS_METERS, levelForEdge } from '@opendnd/spatial';

/** Square metres in a square mile. */
const SQUARE_MILE = 2_589_988;

/** How many spots to try before accepting a crowded one. */
const ATTEMPTS = 48;

export interface PlacementOptions {
  /** The world's radius, which fixes how big a cell at each level is. Earth when left out. */
  readonly radiusMeters?: number;
}

/**
 * The quadtree level whose cells are about the size of a place, from the
 * land it covers: a kingdom is a coarse cell, a hamlet a fine one.
 */
export function levelForArea(
  squareMiles: number,
  options: PlacementOptions = {},
): number {
  const edge = Math.sqrt(Math.max(squareMiles, 1e-6) * SQUARE_MILE);
  return levelForEdge(options.radiusMeters ?? EARTH_RADIUS_METERS, edge);
}

/**
 * A cell for a place of `squareMiles`, inside `within` when one is given and
 * anywhere on the world when none is, keeping clear of the cells already
 * `taken` by its neighbours where it can. The choice comes from the seeded
 * random source, so the same realm lands in the same place every time.
 *
 * A child too large for its parent's cell takes the level just below the
 * parent's: containment is what the quadtree promises, not exact area.
 */
export function placeCell(
  squareMiles: number,
  within: string | undefined,
  rng: Rng,
  taken: readonly string[] = [],
  options: PlacementOptions = {},
): string {
  const parent = within ? CellId.fromToken(within) : undefined;
  let level = levelForArea(squareMiles, options);
  if (parent && level <= parent.level()) level = parent.level() + 1;
  const occupied = taken.map((token) => CellId.fromToken(token));

  let candidate: CellId | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    candidate = parent ? inside(parent, level, rng) : anywhere(level, rng);
    if (!occupied.some((cell) => cell.intersects(candidate!))) break;
  }
  return candidate!.token();
}

/** A random cell at `level` inside `parent`. */
function inside(parent: CellId, level: number, rng: Rng): CellId {
  const span = 2 ** (level - parent.level());
  const [pi, pj] = parent.ij();
  return CellId.fromFaceIJ(
    parent.face(),
    pi * span + rng.int(0, span - 1),
    pj * span + rng.int(0, span - 1),
    level,
  );
}

/** A random cell at `level` somewhere on the cube. */
function anywhere(level: number, rng: Rng): CellId {
  const n = 2 ** level;
  return CellId.fromFaceIJ(
    rng.int(0, 5),
    rng.int(0, n - 1),
    rng.int(0, n - 1),
    level,
  );
}
