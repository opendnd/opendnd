import { describe, expect, it } from 'bun:test';
import {
  type Grid,
  Noise,
  biomeOf,
  chamfer,
  climateOver,
  codeAt,
  fillPits,
  flowOver,
  growWorld,
  headwaters,
  measure,
  traceRiver,
  windAt,
  within,
} from 'src';

/** An invented world: one round island in the middle of an ocean. */
function island(size = 96, radius = 0.34): Uint8Array {
  const land = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const away = Math.hypot(x / size - 0.5, y / size - 0.5);
      if (away < radius) land[y * size + x] = 1;
    }
  }
  return land;
}

/** Rows run from the far north to the far south, as a map's do. */
const latOfRow = (size: number) => (row: number) =>
  80 - (row / (size - 1)) * 160;

describe('measuring from the shore', () => {
  it('counts outwards from the edge of the land', () => {
    const grid: Grid = { width: 5, height: 1 };
    // Land in the middle three, sea either side.
    const land = Uint8Array.from([0, 1, 1, 1, 0]);
    const inland = chamfer(grid, land, 1);
    expect([...inland]).toEqual([0, 1, 2, 1, 0]);
    const offshore = chamfer(grid, land, 0);
    expect([...offshore]).toEqual([1, 0, 0, 0, 1]);
  });
});

describe('filling the pits', () => {
  const grid: Grid = { width: 5, height: 5 };

  it('raises a hollow until water can get out of it', () => {
    const elevation = new Float32Array(25).fill(1);
    // A hole in the middle of a plain, with no way out.
    elevation[12] = 0.1;
    const sink = new Uint8Array(25);
    const { elevation: filled, towards } = fillPits(grid, elevation, sink);
    // Raised to its rim, near enough, rather than left as a trap.
    expect(filled[12]!).toBeGreaterThan(0.99);
    expect(filled[12]!).toBeLessThan(1.01);
    // And it remembers the way the flood came in, which is the way out.
    expect(towards[12]!).toBeGreaterThanOrEqual(0);
  });

  it('leaves a hollow alone when the world says it is a lake', () => {
    const elevation = new Float32Array(25).fill(1);
    elevation[12] = 0.1;
    const sink = new Uint8Array(25);
    sink[12] = 1;
    expect(fillPits(grid, elevation, sink).elevation[12]).toBeCloseTo(0.1, 6);
  });

  it('leaves ground that already drains where it was', () => {
    const elevation = new Float32Array(25);
    for (let i = 0; i < 25; i += 1) elevation[i] = 1 - (i % 5) * 0.2;
    const { elevation: filled } = fillPits(grid, elevation, new Uint8Array(25));
    for (let i = 0; i < 25; i += 1) {
      expect(filled[i]!).toBeCloseTo(elevation[i]!, 3);
    }
  });
});

describe('where the water goes', () => {
  it('sends every cell downhill and gathers what is above it', () => {
    const grid: Grid = { width: 4, height: 1 };
    // A slope down to the right, with the sea at the end.
    const elevation = Float32Array.from([3, 2, 1, 0]);
    const rain = Float32Array.from([1, 1, 1, 0]);
    const sink = Uint8Array.from([0, 0, 0, 1]);
    const flow = flowOver(grid, elevation, rain, sink);
    expect([...flow.to]).toEqual([1, 2, 3, -1]);
    // The bottom of the slope carries everything that fell above it.
    expect(flow.accumulated[2]).toBeCloseTo(3, 6);
    expect(flow.accumulated[3]).toBeCloseTo(3, 6);
  });

  it('follows a river to where it ends, and stops there', () => {
    const grid: Grid = { width: 4, height: 1 };
    const flow = flowOver(
      grid,
      Float32Array.from([3, 2, 1, 0]),
      Float32Array.from([1, 1, 1, 0]),
      Uint8Array.from([0, 0, 0, 1]),
    );
    expect(traceRiver(flow, 0, Uint8Array.from([0, 0, 0, 1]))).toEqual([
      0, 1, 2, 3,
    ]);
  });
});

describe('the weather', () => {
  it('blows one way in the tropics and the other in the middle latitudes', () => {
    expect(windAt(10)).toBe(-1);
    expect(windAt(45)).toBe(1);
    expect(windAt(-45)).toBe(1);
    expect(windAt(75)).toBe(-1);
  });

  it('is colder at the poles and colder up a mountain', () => {
    const grid: Grid = { width: 8, height: 8 };
    const flat = new Float32Array(64);
    const land = new Uint8Array(64).fill(1);
    const { temperature } = climateOver(grid, flat, land, latOfRow(8));
    // The middle rows are the tropics; the first and last are the poles.
    expect(temperature[4 * 8]!).toBeGreaterThan(temperature[0]!);

    const hill = new Float32Array(64);
    hill[4 * 8 + 1] = 1;
    const up = climateOver(grid, hill, land, latOfRow(8));
    expect(up.temperature[4 * 8 + 1]!).toBeLessThan(up.temperature[4 * 8]!);
  });
});

describe('what grows there', () => {
  it('lets height and water decide before the weather does', () => {
    const warm = { temperature: 25, moisture: 0.9, fromShore: 40 };
    expect(biomeOf({ ...warm, elevation: 0.9 })).toBe('mountains');
    expect(biomeOf({ ...warm, elevation: 0.2, river: true })).toBe('river');
    expect(biomeOf({ ...warm, elevation: 0.2, lake: true })).toBe('lakes');
    expect(biomeOf({ ...warm, elevation: 0.2, fromShore: 1 })).toBe('coastal');
  });

  it('puts jungle where it is warm and wet, and desert where it is not', () => {
    const high = { elevation: 0.2, fromShore: 40 };
    expect(biomeOf({ ...high, temperature: 27, moisture: 0.9 })).toBe('jungle');
    expect(biomeOf({ ...high, temperature: 27, moisture: 0.02 })).toBe(
      'desert',
    );
    expect(biomeOf({ ...high, temperature: -20, moisture: 0.5 })).toBe('snow');
    expect(biomeOf({ ...high, temperature: -3, moisture: 0.5 })).toBe('tundra');
  });
});

describe('growing a world from a coastline', () => {
  const size = 96;
  const land = island(size);
  const world = growWorld({
    width: size,
    height: size,
    land,
    seed: 'a-round-island',
    latOfRow: latOfRow(size),
  });

  it('puts the sea below the shore and the land above it', () => {
    for (let i = 0; i < land.length; i += 1) {
      if (land[i] === 1) expect(world.elevation[i]!).toBeGreaterThan(0);
      else expect(world.elevation[i]!).toBeLessThan(0);
    }
  });

  it('rises away from the coast, so the middle is the high ground', () => {
    const middle = world.elevation[(size / 2) * size + size / 2]!;
    const nearShore =
      world.elevation[(size / 2) * size + Math.round(size * 0.19)]!;
    expect(middle).toBeGreaterThan(nearShore);
  });

  it('strikes its mountains as ranges rather than scattering peaks', () => {
    expect(world.spines.length).toBeGreaterThan(0);
    for (const spine of world.spines) {
      // A range is a line of some length, not a dot.
      expect(spine.along.length).toBeGreaterThan(3);
    }
  });

  it('leaves no hollow for a river to stop in', () => {
    // Every land cell can get downhill to somewhere that takes water.
    for (let i = 0; i < land.length; i += 1) {
      if (land[i] !== 1) continue;
      expect(world.flow.to[i]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves no river stranded on the plain a filled pit made', () => {
    // Every land cell drains somewhere, flats included.
    let stuck = 0;
    for (let i = 0; i < land.length; i += 1) {
      if (land[i] === 1 && world.flow.to[i]! < 0) stuck += 1;
    }
    expect(stuck).toBe(0);
  });

  it('finds rivers, and every one of them reaches the sea', () => {
    const heads = headwaters(world);
    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) {
      const path = traceRiver(world.flow, head, world.sink);
      const end = path[path.length - 1]!;
      expect(world.sink[end]).toBe(1);
    }
  });

  it('starts its rivers above where they end', () => {
    for (const head of headwaters(world)) {
      const path = traceRiver(world.flow, head, world.sink);
      const mouth = path[path.length - 1]!;
      expect(world.drained[head]!).toBeGreaterThan(world.drained[mouth]!);
    }
  });

  it('covers the ground with the ontology’s own words', () => {
    const seen = new Set<string>();
    for (let i = 0; i < land.length; i += 1) {
      const code = codeAt(world, i);
      if (code) seen.add(code);
      // Nothing is named on the sea floor.
      if (land[i] !== 1) expect(code).toBeUndefined();
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(seen.has('coastal')).toBe(true);
  });

  it('makes the same world twice from the same seed, and a different one otherwise', () => {
    const again = growWorld({
      width: size,
      height: size,
      land,
      seed: 'a-round-island',
      latOfRow: latOfRow(size),
    });
    expect([...again.elevation]).toEqual([...world.elevation]);
    const other = growWorld({
      width: size,
      height: size,
      land,
      seed: 'a different island',
      latOfRow: latOfRow(size),
    });
    expect([...other.elevation]).not.toEqual([...world.elevation]);
  });
});

describe('measuring a world against another', () => {
  const size = 96;
  const world = growWorld({
    width: size,
    height: size,
    land: island(size),
    seed: 'the-bar',
    latOfRow: latOfRow(size),
  });

  it('says what it is made of', () => {
    const found = measure(world);
    // A disc of that radius covers about a third of the square.
    expect(found.landFraction).toBeGreaterThan(0.3);
    expect(found.landFraction).toBeLessThan(0.4);
    expect(found.masses).toHaveLength(1);
    expect(found.largestMass).toBe(1);
    expect(found.riversThatArrive).toBe(1);
    expect(found.highest).toBeGreaterThan(found.meanElevation);
  });

  it('holds one world to the shape of another, and says what is off', () => {
    const bar = measure(world);
    const alike = measure(
      growWorld({
        width: size,
        height: size,
        land: island(size),
        seed: 'another-of-the-same',
        latOfRow: latOfRow(size),
      }),
    );
    // The same coastline under a different seed is the same kind of world.
    expect(within(alike, bar)).toEqual([]);

    const smaller = measure(
      growWorld({
        width: size,
        height: size,
        land: island(size, 0.12),
        seed: 'a-smaller-island',
        latOfRow: latOfRow(size),
      }),
    );
    // A world a tenth the size of the bar is not within reach of it.
    expect(within(smaller, bar).join(' ')).toContain('land fraction');
  });
});

describe('noise', () => {
  it('is smooth, bounded, and the same for the same seed', () => {
    const noise = new Noise('a seed');
    expect(noise.at(1.5, 2.5)).toBe(new Noise('a seed').at(1.5, 2.5));
    expect(noise.at(1.5, 2.5)).not.toBe(new Noise('another').at(1.5, 2.5));
    for (const [x, y] of [
      [0.1, 0.2],
      [12.7, 3.3],
      [-5.5, 9.9],
    ] as const) {
      expect(Math.abs(noise.fbm(x, y))).toBeLessThanOrEqual(1);
      expect(noise.ridged(x, y)).toBeGreaterThanOrEqual(0);
      expect(noise.ridged(x, y)).toBeLessThanOrEqual(1);
    }
    // Neighbouring places are alike, which is what makes it terrain.
    expect(Math.abs(noise.at(4, 4) - noise.at(4.01, 4))).toBeLessThan(0.05);
  });
});
