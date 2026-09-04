import type { Alignment } from '@opendnd/types';

/** Order axis: lawful -1 .. chaotic +1. */
export const ORDER_AXIS = {
  lawful: -1,
  neutral: 0,
  chaotic: 1,
} as const;

/** Goodness axis: evil -1 .. good +1. */
export const GOODNESS_AXIS = {
  good: 1,
  neutral: 0,
  evil: -1,
} as const;

export interface AlignmentAxes {
  /** -1 lawful .. +1 chaotic */
  readonly order: number;
  /** -1 evil .. +1 good */
  readonly goodness: number;
}

/**
 * The numeric position of an alignment on the three-by-three grid.
 *
 * The centre is the one code the SRD does not spell as a pair: plain
 * `neutral` rather than `neutral-neutral`.
 */
export function alignmentAxes(code: Alignment): AlignmentAxes {
  if (code === 'neutral') return { order: 0, goodness: 0 };
  const [x, y] = code.split('-') as [
    keyof typeof ORDER_AXIS,
    keyof typeof GOODNESS_AXIS,
  ];
  return { order: ORDER_AXIS[x], goodness: GOODNESS_AXIS[y] };
}

/** The alignment at a grid position; out-of-range values are clamped. */
export function alignmentAt(order: number, goodness: number): Alignment {
  const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v)));
  const x = (Object.keys(ORDER_AXIS) as Array<keyof typeof ORDER_AXIS>).find(
    (k) => ORDER_AXIS[k] === clamp(order),
  )!;
  const y = (
    Object.keys(GOODNESS_AXIS) as Array<keyof typeof GOODNESS_AXIS>
  ).find((k) => GOODNESS_AXIS[k] === clamp(goodness))!;
  return (
    x === 'neutral' && y === 'neutral' ? 'neutral' : `${x}-${y}`
  ) as Alignment;
}

/** Manhattan distance between two alignments on the grid, 0..4. */
export function alignmentDistance(a: Alignment, b: Alignment): number {
  const p = alignmentAxes(a);
  const q = alignmentAxes(b);
  return Math.abs(p.order - q.order) + Math.abs(p.goodness - q.goodness);
}
