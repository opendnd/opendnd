import {
  type BiomeOptions,
  TERRAIN_CODES,
  type TerrainCode,
  biomeOf,
} from './biome';
import { type ClimateOptions, climateOver } from './climate';
import {
  type Flow,
  type Grid,
  fillPits,
  flowOver,
  riversIn,
} from './hydrology';
import { Noise } from './noise';
import {
  type RangeOptions,
  type Spine,
  reliefFrom,
  spinesFromLand,
} from './ranges';
import { distanceFromShore } from './shore';

/**
 * A world's ground, made.
 *
 * The order here is the whole thing, and it is not the obvious order. Height
 * before weather, because how cold a place is depends on how high it stands.
 * **Pits filled before any water moves**, because a river running into a hole
 * that noise left behind is a river that stops in a field, and that is the
 * commonest fault in a generated world. Weather before rivers, because rain
 * is what a river carries and a mountain's dry side should have small ones.
 * Rivers before ground cover, because a valley floor is not the same country
 * as the hill above it.
 *
 * What comes out is the same shape whether the coastline was read off a
 * drawing somebody made or invented here, which is the point: a world that
 * exists and a world that does not are then the same kind of thing.
 */
export interface World extends Grid {
  /** −1 at the deepest sea, 0 at the shore, 1 at the highest ground. */
  readonly elevation: Float32Array;
  /** The same, with every pit raised until water can leave it. */
  readonly drained: Float32Array;
  readonly land: Uint8Array;
  /** Standing fresh water: what the drawing called a lake, plus the sea. */
  readonly sink: Uint8Array;
  readonly temperature: Float32Array;
  readonly moisture: Float32Array;
  readonly flow: Flow;
  readonly river: Uint8Array;
  /** One of the ontology's terrain codes per cell. */
  readonly terrain: Uint8Array;
  readonly spines: readonly Spine[];
  /** How far each land cell is from salt water, in cells. */
  readonly fromShore: Float32Array;
}

export interface GrowOptions {
  readonly width: number;
  readonly height: number;
  /** 1 where there is ground. The constraint everything else is fitted to. */
  readonly land: Uint8Array;
  /** 1 where the world says there is standing fresh water. */
  readonly lake?: Uint8Array;
  readonly seed: string;
  /** The latitude of a row, so weather knows where it is. */
  readonly latOfRow: (row: number) => number;
  /** How high the highest ground stands above the sea, for the lapse rate. */
  readonly relief?: number;
  /** How rough the ground is between the ranges. */
  readonly roughness?: number;
  readonly ranges?: RangeOptions;
  readonly climate?: ClimateOptions;
  readonly biome?: BiomeOptions;
  /**
   * How much water has to gather before it counts as a river, as a share of
   * all the rain that falls on the world. Lower it and the world has more,
   * smaller rivers; a coast cut about with inlets has short ones whatever it
   * is set to, because there is never much ground above any one river mouth.
   */
  readonly riverAt?: number;
}

export function growWorld(options: GrowOptions): World {
  const { width, height, land, seed, latOfRow } = options;
  const grid: Grid = { width, height };
  const count = width * height;
  const noise = new Noise(seed);
  const roughness = options.roughness ?? 0.22;

  // 1. The coast is the constraint: everything is measured from it.
  const { inland, offshore } = distanceFromShore(grid, land);
  let deepestInland = 1;
  let furthestOut = 1;
  for (let i = 0; i < count; i += 1) {
    if (land[i] === 1 && inland[i]! > deepestInland) deepestInland = inland[i]!;
    if (land[i] !== 1 && offshore[i]! > furthestOut) furthestOut = offshore[i]!;
  }

  // 2. Ranges as lines, roughened; the rest of the land merely undulates.
  const spines =
    options.ranges?.spines ??
    spinesFromLand(grid, inland, land, seed, options.ranges);
  const relief = reliefFrom(grid, spines, noise);

  const elevation = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    if (land[i] === 1) {
      // Rises away from the coast, quickly at first: a coastal plain, then
      // the interior, then whatever range is standing on it.
      // A coastal plain that gives way to an interior, and only then to
      // whatever range is standing on it. Ranges make the mountains; the
      // ground between them is not supposed to be half a mountain already.
      const away = Math.min(1, inland[i]! / deepestInland);
      const base = 0.04 + 0.16 * Math.sqrt(away);
      const rough = noise.fbm(x / 140, y / 140, 5) * roughness * away;
      elevation[i] = Math.max(
        0.005,
        Math.min(1, base + rough * 0.5 + relief[i]! * 0.8),
      );
    } else {
      // The shelf falls away from the shore and then levels off.
      const out = Math.min(1, offshore[i]! / furthestOut);
      elevation[i] = -0.05 - 0.95 * Math.sqrt(out);
    }
  }

  // 3. Fill the pits, before a drop of water moves. The sea takes water and
  // keeps it; so does anything the world has told us is a lake.
  const sink = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if (land[i] !== 1 || options.lake?.[i] === 1) sink[i] = 1;
  }
  // The map ends at the poles. Water reaching the top or bottom row has left
  // what is being modelled, which is an ending as final as the sea.
  for (let x = 0; x < width; x += 1) {
    sink[x] = 1;
    sink[(height - 1) * width + x] = 1;
  }
  const drained = fillPits(grid, elevation, sink);

  // 4. Weather, on the drained ground, before any of it runs anywhere.
  const { temperature, moisture } = climateOver(
    grid,
    drained.elevation,
    land,
    latOfRow,
    options.climate,
  );

  // 5. Where the water goes, carrying what fell on it.
  const rain = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    rain[i] = land[i] === 1 ? 0.05 + moisture[i]! : 0;
  }
  const flow = flowOver(grid, drained.elevation, rain, sink, drained.towards);

  // 6. A river is where enough has gathered, not a line anyone drew.
  let fell = 0;
  for (const value of rain) fell += value;
  const river = riversIn(
    flow,
    land,
    Math.max(1, fell * (options.riverAt ?? 0.00022)),
  );

  // 7. Ground cover last, with the water already in place.
  const terrain = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if (land[i] !== 1) continue;
    const code = biomeOf(
      {
        temperature: temperature[i]!,
        moisture: moisture[i]!,
        elevation: elevation[i]!,
        fromShore: inland[i]!,
        river: river[i] === 1,
        lake: options.lake?.[i] === 1,
      },
      options.biome,
    );
    terrain[i] = codeIndex(code);
  }

  return {
    width,
    height,
    elevation,
    drained: drained.elevation,
    land,
    sink,
    temperature,
    moisture,
    flow,
    river,
    terrain,
    spines,
    fromShore: inland,
  };
}

/** Terrain codes are stored as their place in the vocabulary, one byte a cell. */
export function codeIndex(code: TerrainCode): number {
  return TERRAIN_CODES.indexOf(code) + 1;
}

export function codeAt(world: World, i: number): TerrainCode | undefined {
  const index = world.terrain[i]!;
  return index === 0 ? undefined : TERRAIN_CODES[index - 1];
}
