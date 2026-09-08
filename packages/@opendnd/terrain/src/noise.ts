/* eslint-disable no-bitwise -- a permutation table wraps by masking, which is the technique */
import { Rng } from '@opendnd/random';

/**
 * Coherent noise: a value that varies smoothly across a field rather than
 * jumping about, so ground made from it has slopes instead of static.
 *
 * Value noise on a permuted lattice, which is enough for terrain and is a
 * dozen lines rather than a hundred. Everything is seeded from a string, so
 * the same world is the same world on every machine.
 */
export class Noise {
  private readonly permutation: Uint8Array;

  constructor(seed: string) {
    const rng = new Rng(`terrain:noise:${seed}`);
    const order = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) order[i] = i;
    // Shuffled by walking backwards, so the whole table depends on the seed.
    for (let i = 255; i > 0; i -= 1) {
      const j = rng.int(0, i);
      const held = order[i]!;
      order[i] = order[j]!;
      order[j] = held;
    }
    this.permutation = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) this.permutation[i] = order[i & 255]!;
  }

  /** One octave, in [-1, 1]. */
  at(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = smooth(xf);
    const v = smooth(yf);
    const a = this.corner(xi, yi);
    const b = this.corner(xi + 1, yi);
    const c = this.corner(xi, yi + 1);
    const d = this.corner(xi + 1, yi + 1);
    return mix(mix(a, b, u), mix(c, d, u), v);
  }

  /**
   * Several octaves, each finer and quieter than the last, which is what
   * gives a coastline detail at every scale instead of one.
   */
  fbm(x: number, y: number, octaves = 5, gain = 0.5, lacunarity = 2): number {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let i = 0; i < octaves; i += 1) {
      sum += amplitude * this.at(x * frequency, y * frequency);
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / total;
  }

  /**
   * Ridged noise, in [0, 1]: the same octaves folded about zero so their
   * peaks come to a line rather than a dome. This is what makes a mountain
   * range look like rock rather than like a pile of sand.
   */
  ridged(
    x: number,
    y: number,
    octaves = 5,
    gain = 0.5,
    lacunarity = 2,
  ): number {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let i = 0; i < octaves; i += 1) {
      const folded = 1 - Math.abs(this.at(x * frequency, y * frequency));
      sum += amplitude * folded * folded;
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / total;
  }

  private corner(xi: number, yi: number): number {
    const p = this.permutation;
    return (p[(p[xi & 255]! + (yi & 255)) & 255]! / 127.5 - 1) as number;
  }
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
