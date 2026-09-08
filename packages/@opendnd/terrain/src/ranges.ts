import { Rng } from '@opendnd/random';
import type { Grid } from './hydrology';
import type { Noise } from './noise';

/**
 * Mountains, as ranges rather than lumps.
 *
 * Loud noise over a continent gives isolated peaks with no watershed between
 * them, and a world with no watershed has no rivers worth the name. A range
 * is a line: a spine struck across the ground, with height falling away
 * either side of it and ridged noise along it so that it has peaks and passes
 * rather than being a wall.
 *
 * A spine comes from one of two places. Struck inland of a coast and roughly
 * parallel to it, which is where ranges sit on a real world, for a world
 * nobody has written about. Or written down, for a world that already says
 * where its mountains are — those are fixed points the rest is fitted around,
 * the same way an authored death is a fixed point a history is fitted around.
 */

export interface Spine {
  /** The line the range follows, in cells. */
  readonly along: readonly (readonly [x: number, y: number])[];
  /** How high the range stands where it is highest, 0 to 1. */
  readonly height: number;
  /** How far its foothills reach, in cells. */
  readonly reach: number;
  readonly name?: string;
}

export interface RangeOptions {
  /** Ranges to place, however the world came by them. */
  readonly spines?: readonly Spine[];
  /** How many to strike from the coastline, when the world says none. */
  readonly count?: number;
  /** How far a struck range runs, as a share of the map. */
  readonly inland?: number;
  /** How far the foothills of a struck range reach, in cells. */
  readonly reach?: number;
}

/**
 * Ranges struck from the shape of the land.
 *
 * Picks places well inside the land, walks a line from each in a direction
 * that keeps it inland, and calls that a range. Crude beside plate tectonics
 * and enough to put mountains where mountains go: away from the coast, in
 * lines, with room for rivers to run off them.
 */
export function spinesFromLand(
  grid: Grid,
  inland: Float32Array,
  land: Uint8Array,
  seed: string,
  options: RangeOptions = {},
): Spine[] {
  const { width, height } = grid;
  const across = Math.max(width, height);
  // A bigger map is not a bigger world, but it does hold more ranges before
  // they run into each other.
  const count = options.count ?? Math.max(4, Math.round(across / 90));
  const rng = new Rng(`terrain:ranges:${seed}`);

  // Anywhere well away from the sea will do to start; the further in, the
  // likelier. Weighting by depth rather than taking only the deepest keeps a
  // narrow continent from being passed over for a broad one.
  const candidates: number[] = [];
  const weights: number[] = [];
  let deepest = 0;
  for (let i = 0; i < inland.length; i += 1) {
    if (land[i] === 1 && inland[i]! > deepest) deepest = inland[i]!;
  }
  const enough = Math.max(3, deepest * 0.18);
  let total = 0;
  for (let i = 0; i < inland.length; i += 1) {
    if (land[i] !== 1 || inland[i]! < enough) continue;
    const weight = inland[i]! * inland[i]!;
    candidates.push(i);
    total += weight;
    weights.push(total);
  }
  if (candidates.length === 0) return [];

  const reach = options.reach ?? Math.max(5, across / 42);
  const steps = Math.round((options.inland ?? 0.1) * across);
  const spines: Spine[] = [];
  const starts: [number, number][] = [];

  // More tries than ranges, because a start too near one already placed is
  // thrown away rather than made into a range on top of it.
  for (
    let attempt = 0;
    attempt < count * 12 && spines.length < count;
    attempt += 1
  ) {
    const pick = rng.next() * total;
    let at = weights.findIndex((w) => w >= pick);
    if (at < 0) at = weights.length - 1;
    const from = candidates[at]!;
    let x = from % width;
    let y = Math.floor(from / width);
    const apart = starts.every(
      ([sx, sy]) => Math.hypot(x - sx, y - sy) > reach * 2.5,
    );
    if (!apart) continue;

    // A direction, wandered a little as it goes, so a range bends.
    let angle = rng.next() * Math.PI * 2;
    const along: [number, number][] = [[x, y]];
    for (let step = 0; step < steps; step += 1) {
      angle += (rng.next() - 0.5) * 0.3;
      const nx = Math.round(x + Math.cos(angle) * 2);
      const ny = Math.round(y + Math.sin(angle) * 2);
      if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) break;
      // A range stops at the sea rather than swimming.
      if (land[ny * width + nx] !== 1) break;
      x = nx;
      y = ny;
      along.push([x, y]);
    }
    if (along.length < Math.max(4, steps / 4)) continue;
    starts.push(along[0]!);
    spines.push({
      along,
      height: 0.6 + rng.next() * 0.4,
      reach: reach * (0.7 + rng.next() * 0.6),
    });
  }
  return spines;
}

/**
 * Height added by the ranges: for each cell, how near it is to a spine, made
 * rough along its length so a range has summits and saddles.
 */
export function reliefFrom(
  grid: Grid,
  spines: readonly Spine[],
  noise: Noise,
  scale = 90,
): Float32Array {
  const { width, height } = grid;
  const relief = new Float32Array(width * height);
  for (const spine of spines) {
    const reach = spine.reach;
    for (const [sx, sy] of spine.along) {
      const from = Math.max(0, Math.floor(sy - reach));
      const to = Math.min(height - 1, Math.ceil(sy + reach));
      const left = Math.max(0, Math.floor(sx - reach));
      const right = Math.min(width - 1, Math.ceil(sx + reach));
      for (let y = from; y <= to; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const away = Math.hypot(x - sx, y - sy);
          if (away > reach) continue;
          // Falls off smoothly, so foothills rather than a cliff.
          const near = 1 - away / reach;
          const rough = noise.ridged(x / scale, y / scale, 4);
          const added = spine.height * near * near * (0.45 + 0.55 * rough);
          const i = y * width + x;
          if (added > relief[i]!) relief[i] = added;
        }
      }
    }
  }
  return relief;
}
