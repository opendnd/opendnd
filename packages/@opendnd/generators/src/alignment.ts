import type { Alignment } from '@opendnd/types';

/** Order axis: lawful -2 .. chaotic +2. */
export const ORDER_AXIS = {
  lawful: -2,
  social: -1,
  neutral: 0,
  rebel: 1,
  chaotic: 2,
} as const;

/** Goodness axis: evil -2 .. good +2. */
export const GOODNESS_AXIS = {
  good: 2,
  moral: 1,
  neutral: 0,
  impure: -1,
  evil: -2,
} as const;

export interface AlignmentAxes {
  /** -2 lawful .. +2 chaotic */
  readonly order: number;
  /** -2 evil .. +2 good */
  readonly goodness: number;
}

/** The numeric position of an alignment code on the 5 by 5 matrix. */
export function alignmentAxes(code: Alignment): AlignmentAxes {
  if (code === 'true-neutral') return { order: 0, goodness: 0 };
  const [x, y] = code.split('-') as [
    keyof typeof ORDER_AXIS,
    keyof typeof GOODNESS_AXIS,
  ];
  return { order: ORDER_AXIS[x], goodness: GOODNESS_AXIS[y] };
}

/** The alignment code at a matrix position; out-of-range values are clamped. */
export function alignmentAt(order: number, goodness: number): Alignment {
  const clamp = (v: number) => Math.max(-2, Math.min(2, Math.round(v)));
  const x = (Object.keys(ORDER_AXIS) as Array<keyof typeof ORDER_AXIS>).find(
    (k) => ORDER_AXIS[k] === clamp(order),
  )!;
  const y = (
    Object.keys(GOODNESS_AXIS) as Array<keyof typeof GOODNESS_AXIS>
  ).find((k) => GOODNESS_AXIS[k] === clamp(goodness))!;
  return (
    x === 'neutral' && y === 'neutral' ? 'true-neutral' : `${x}-${y}`
  ) as Alignment;
}

/** Manhattan distance between two alignments on the matrix, 0..8. */
export function alignmentDistance(a: Alignment, b: Alignment): number {
  const p = alignmentAxes(a);
  const q = alignmentAxes(b);
  return Math.abs(p.order - q.order) + Math.abs(p.goodness - q.goodness);
}
