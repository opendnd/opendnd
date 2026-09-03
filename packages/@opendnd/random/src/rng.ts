/* eslint-disable no-bitwise -- bit operations are the point of a PRNG and of UUID layout */
import { createHash } from 'node:crypto';

/**
 * A seeded pseudo-random number generator (xoshiro128**) whose whole state
 * comes from a seed string. The same seed always yields the same sequence, so
 * every generator built on it is reproducible, and `child()` derives a
 * sub-generator for a labelled part of the work so that adding a step in one
 * place does not reshuffle everything after it.
 */
export class Rng {
  private readonly s: Uint32Array;

  constructor(readonly seed: string) {
    const h = createHash('sha256').update(seed, 'utf8').digest();
    this.s = new Uint32Array([
      h.readUInt32LE(0),
      h.readUInt32LE(4),
      h.readUInt32LE(8),
      h.readUInt32LE(12),
    ]);
    // xoshiro must not start from all zeros.
    if (this.s.every((x) => x === 0)) this.s[0] = 1;
  }

  /** A float in [0, 1). */
  next(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result / 4294967296;
  }

  /** An integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(): max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p` (default one half). */
  chance(p = 0.5): boolean {
    return this.next() < p;
  }

  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick(): empty array');
    return items[this.int(0, items.length - 1)];
  }

  /** One element, chosen in proportion to its weight. */
  weighted<T>(items: ReadonlyArray<{ value: T; weight: number }>): T {
    const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
    if (total <= 0) throw new RangeError('weighted(): total weight is zero');
    let x = this.next() * total;
    for (const item of items) {
      x -= Math.max(0, item.weight);
      if (x < 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  /** A normally distributed draw (Box-Muller). */
  normal(mean = 0, stdev = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return (
      mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    );
  }

  /** A new array in random order (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Roll dice in standard notation: `d8`, `2d6`, `1d20+3`, `4d6-1`.
   * Returns the total.
   */
  roll(notation: string): number {
    return this.rollEach(notation).reduce((a, b) => a + b, 0);
  }

  /** Roll dice in standard notation and return each die separately (modifier applied to the total only if present, as a final element). */
  rollEach(notation: string): number[] {
    const { count, sides, modifier } = parseDice(notation);
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) rolls.push(this.int(1, sides));
    if (modifier !== 0) rolls.push(modifier);
    return rolls;
  }

  /** Roll one of each die in a list (e.g. a species' `["d10", "d10"]` height dice) and return the total. */
  rollAll(dice: readonly string[]): number {
    return dice.reduce((sum, d) => sum + this.roll(d), 0);
  }

  /**
   * A UUID in version 4 layout drawn from this generator. It is random with
   * respect to the record's content, so it is safe as a resource `id`, while
   * still being reproducible from the seed so generation runs are repeatable.
   */
  uuid(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 4) {
      const word = Math.floor(this.next() * 4294967296);
      bytes[i] = word & 0xff;
      bytes[i + 1] = (word >>> 8) & 0xff;
      bytes[i + 2] = (word >>> 16) & 0xff;
      bytes[i + 3] = (word >>> 24) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Buffer.from(bytes).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  /** A generator for a labelled sub-task: `seed/label`. */
  child(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}

export interface DiceNotation {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
}

const DICE = /^(\d*)d(\d+)([+-]\d+)?$/i;

/** Parse `2d6+1` into its parts. `d8` means one die. */
export function parseDice(notation: string): DiceNotation {
  const m = DICE.exec(notation.trim());
  if (!m) throw new SyntaxError(`Bad dice notation "${notation}"`);
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || sides < 1) {
    throw new SyntaxError(`Bad dice notation "${notation}"`);
  }
  return { count, sides, modifier: m[3] ? Number(m[3]) : 0 };
}

/** The number of faces on a die such as `d20`. */
export function sidesOf(die: string): number {
  return parseDice(die).sides;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
