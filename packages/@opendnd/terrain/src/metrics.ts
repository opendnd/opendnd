import { traceRiver } from './hydrology';
import type { World } from './world';

/**
 * Measuring a world, so that "as good as the one we already have" means
 * something.
 *
 * A world somebody drew is the bar a generated one has to clear. That is only
 * a claim until it is a number, so these are the numbers: how much of the
 * world is land, how it is arranged, how crinkly its coast is, how its rivers
 * behave. A generator is right when a world it makes from nothing lands in
 * the same envelope as one read off a drawing.
 */

export interface Measurements {
  readonly landFraction: number;
  /** Separate landmasses, largest first, as a share of all land. */
  readonly masses: readonly number[];
  readonly largestMass: number;
  /** How much coast there is per unit of land: high means fjords. */
  readonly coastRoughness: number;
  readonly meanElevation: number;
  readonly highest: number;
  readonly riverCells: number;
  /** Of the rivers found, the share that reach the sea or a lake. */
  readonly riversThatArrive: number;
  /** How much of the land each terrain code covers. */
  readonly terrainShares: Readonly<Record<number, number>>;
}

export function measure(world: World): Measurements {
  const { width, height, land, elevation, river, terrain, sink } = world;
  const count = width * height;

  let landCells = 0;
  let elevationSum = 0;
  let highest = 0;
  for (let i = 0; i < count; i += 1) {
    if (land[i] !== 1) continue;
    landCells += 1;
    elevationSum += elevation[i]!;
    if (elevation[i]! > highest) highest = elevation[i]!;
  }

  return {
    landFraction: landCells / count,
    ...massesOf(world, landCells),
    coastRoughness: coastOf(world) / Math.max(1, Math.sqrt(landCells)),
    meanElevation: landCells === 0 ? 0 : elevationSum / landCells,
    highest,
    riverCells: river.reduce((sum: number, value) => sum + value, 0),
    riversThatArrive: arrivals(world, sink),
    terrainShares: sharesOf(terrain, landCells),
  };
}

/** Connected runs of land, as shares of all of it. */
function massesOf(
  world: World,
  landCells: number,
): { masses: number[]; largestMass: number } {
  const { width, height, land } = world;
  const seen = new Uint8Array(width * height);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < land.length; start += 1) {
    if (land[start] !== 1 || seen[start] === 1) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      size += 1;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (land[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  const masses = sizes.map((size) => size / Math.max(1, landCells));
  return { masses, largestMass: masses[0] ?? 0 };
}

/** Cells of land with sea beside them: the length of the coast. */
function coastOf(world: World): number {
  const { width, height, land } = world;
  let coast = 0;
  for (let i = 0; i < land.length; i += 1) {
    if (land[i] !== 1) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const beside =
      (x > 0 && land[i - 1] !== 1) ||
      (x < width - 1 && land[i + 1] !== 1) ||
      (y > 0 && land[i - width] !== 1) ||
      (y < height - 1 && land[i + width] !== 1);
    if (beside) coast += 1;
  }
  return coast;
}

/**
 * The share of rivers that get somewhere.
 *
 * The one measurement that says whether the pits were filled. A river that
 * ends anywhere but the sea or a lake is a river that stopped in a field, and
 * on a properly drained world there are none of them.
 */
function arrivals(world: World, sink: Uint8Array): number {
  const heads = headwaters(world);
  if (heads.length === 0) return 1;
  let arrived = 0;
  for (const head of heads) {
    const path = traceRiver(world.flow, head, sink);
    const end = path[path.length - 1];
    if (end !== undefined && sink[end] === 1) arrived += 1;
  }
  return arrived / heads.length;
}

/** Cells where a river begins: it is a river, and nothing above it is. */
export function headwaters(world: World): number[] {
  const { width, height, river, flow } = world;
  const feeds = new Uint8Array(width * height);
  for (let i = 0; i < river.length; i += 1) {
    if (river[i] === 1 && flow.to[i]! >= 0) feeds[flow.to[i]!] = 1;
  }
  const heads: number[] = [];
  for (let i = 0; i < river.length; i += 1) {
    if (river[i] === 1 && feeds[i] !== 1) heads.push(i);
  }
  return heads;
}

function sharesOf(
  terrain: Uint8Array,
  landCells: number,
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const code of terrain) {
    if (code === 0) continue;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  const shares: Record<number, number> = {};
  for (const [code, n] of Object.entries(counts)) {
    shares[Number(code)] = n / Math.max(1, landCells);
  }
  return shares;
}

/**
 * Whether one world is within reach of another on every measurement that has
 * a tolerance. What "as good as the world we already have" is checked with.
 */
export function within(
  made: Measurements,
  bar: Measurements,
  tolerance = 0.35,
): string[] {
  const off: string[] = [];
  const check = (name: string, a: number, b: number): void => {
    const room = Math.max(Math.abs(b) * tolerance, 0.02);
    if (Math.abs(a - b) > room) {
      off.push(`${name}: ${a.toFixed(3)} against ${b.toFixed(3)}`);
    }
  };
  check('land fraction', made.landFraction, bar.landFraction);
  check('largest landmass', made.largestMass, bar.largestMass);
  check('coast roughness', made.coastRoughness, bar.coastRoughness);
  check('mean elevation', made.meanElevation, bar.meanElevation);
  return off;
}
