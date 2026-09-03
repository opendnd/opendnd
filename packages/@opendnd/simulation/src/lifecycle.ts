import type { Species } from '@opendnd/types';
import type { HistoryParams } from './types';

export interface Lifecycle {
  readonly maturity: number;
  readonly fertileFrom: number;
  readonly fertileTo: number;
  readonly lifeExpectancy: number;
  readonly maximumAge: number;
}

/**
 * The species' lifecycle, or one derived from its age ranges: adulthood at
 * the start of the "young" range, fertility through the "middle" range,
 * life expectancy at the start of "old", and the oldest age in any range.
 */
export function lifecycleOf(species: Species): Lifecycle {
  if (species.lifecycle) return species.lifecycle;
  const ranges = species.ageRanges ?? {};
  const young = ranges.young;
  const middle = ranges.middle;
  const old = ranges.old;
  const maximumAge = Math.max(0, ...Object.values(ranges).map((r) => r.max));
  if (!young || !old || maximumAge === 0) {
    throw new Error(
      `Species "${species.name}" has neither lifecycle nor usable ageRanges`,
    );
  }
  return {
    maturity: young.min,
    fertileFrom: young.min,
    fertileTo: middle
      ? middle.min + Math.floor((middle.max - middle.min) / 2)
      : young.max,
    lifeExpectancy: old.min,
    maximumAge,
  };
}

/**
 * Yearly probability of death at an age: a floor, an infancy bump, and a
 * steep climb around life expectancy, reaching certainty at the maximum age.
 */
export function mortality(
  age: number,
  lifecycle: Lifecycle,
  params: HistoryParams,
): number {
  if (age >= lifecycle.maximumAge) return 1;
  const climb = 0.15 * Math.exp((age - lifecycle.lifeExpectancy) / 7);
  const infancy = age < 5 ? params.infantMortality : 0;
  return Math.min(1, params.baseMortality + infancy + climb);
}

export function isAdult(age: number, lifecycle: Lifecycle): boolean {
  return age >= lifecycle.maturity;
}

export function isFertile(age: number, lifecycle: Lifecycle): boolean {
  return age >= lifecycle.fertileFrom && age <= lifecycle.fertileTo;
}
