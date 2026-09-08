import type { Grid } from './hydrology';

/**
 * What the weather does, which has to be settled before the water is, because
 * rain is what rivers carry.
 *
 * Temperature is latitude and height: warm at the equator, cold at the poles,
 * and colder the higher you stand, at about six and a half degrees a
 * kilometre, which is the rate the real atmosphere cools at.
 *
 * Moisture is wind. Air picks water up over the sea and drops it when it is
 * pushed up over ground, so the side of a range the wind reaches first is wet
 * and the side behind it is dry. Doing this rather than sprinkling rain about
 * at random is what gives a world deserts in the places deserts belong, and
 * gives its rivers a reason to be large on one side of a mountain and small
 * on the other.
 */

export interface ClimateOptions {
  /** Degrees at the equator at sea level. */
  readonly equator?: number;
  /** Degrees at the poles at sea level. */
  readonly pole?: number;
  /**
   * Degrees lost between the shore and the highest ground. Six and a half a
   * kilometre is what the real atmosphere does, so this is that times how
   * high the world's mountains stand.
   */
  readonly lapse?: number;
  /** How far moisture carries inland before it is spent, in cells. */
  readonly carry?: number;
  /** How much being pushed uphill wrings out of the air. */
  readonly orographic?: number;
}

export interface Climate {
  /** Degrees, roughly Celsius. */
  readonly temperature: Float32Array;
  /** 0 for desert, 1 for as wet as the world gets. */
  readonly moisture: Float32Array;
}

/**
 * Which way the wind blows at a latitude.
 *
 * Three bands each side of the equator, as on a turning world: easterlies in
 * the tropics, westerlies in the middle, easterlies again at the poles. A
 * world with one prevailing wind everywhere has its deserts in a stripe.
 */
export function windAt(lat: number): -1 | 1 {
  const away = Math.abs(lat);
  if (away < 30) return -1;
  if (away < 60) return 1;
  return -1;
}

export function climateOver(
  grid: Grid,
  elevation: Float32Array,
  land: Uint8Array,
  latOfRow: (row: number) => number,
  options: ClimateOptions = {},
): Climate {
  const { width, height } = grid;
  const equator = options.equator ?? 30;
  const pole = options.pole ?? -22;
  const lapse = options.lapse ?? 32;
  const carry = options.carry ?? 150;
  const orographic = options.orographic ?? 4;

  const temperature = new Float32Array(width * height);
  const moisture = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const lat = latOfRow(y);
    // Warm at the equator, cold at the poles, by the sine of the latitude,
    // which flattens the tropics and steepens the middle latitudes the way a
    // real one does.
    const bySea =
      pole + (equator - pole) * Math.cos((lat * Math.PI) / 180) ** 1.5;
    const wind = windAt(lat);

    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const up = Math.max(0, elevation[i]!);
      temperature[i] = bySea - up * lapse;
    }

    // Walk the row the way the wind does, carrying water and dropping it.
    let carried = 1;
    const first = wind === 1 ? 0 : width - 1;
    const last = wind === 1 ? width : -1;
    for (let x = first; x !== last; x += wind) {
      const i = y * width + x;
      const before = x - wind;
      const rise =
        before >= 0 && before < width
          ? Math.max(0, elevation[i]! - elevation[y * width + before]!)
          : 0;
      if (land[i] !== 1) {
        // Over water the air fills up again, faster where it is warm.
        const warmth = Math.max(0, Math.min(1, (temperature[i]! + 10) / 40));
        carried = Math.min(1, carried + 0.05 + 0.1 * warmth);
      } else {
        // Pushed uphill it rains hard; on the flat it dries out slowly.
        const wrung = Math.min(carried, rise * orographic + carried / carry);
        carried -= wrung;
        moisture[i] = wrung * carry * 0.5;
      }
    }
  }

  // Scaled so that "1" means as wet as the world generally gets, not as wet
  // as its single wettest cell. One mountainside catching everything the wind
  // had would otherwise leave every other place reading as desert.
  const onLand: number[] = [];
  for (let i = 0; i < moisture.length; i += 1) {
    if (land[i] === 1) onLand.push(moisture[i]!);
  }
  if (onLand.length > 0) {
    onLand.sort((a, b) => a - b);
    const wet = onLand[Math.floor(onLand.length * 0.95)] ?? 1;
    if (wet > 0) {
      for (let i = 0; i < moisture.length; i += 1) {
        moisture[i] = Math.min(1, moisture[i]! / wet);
      }
    }
  }
  return { temperature, moisture };
}
