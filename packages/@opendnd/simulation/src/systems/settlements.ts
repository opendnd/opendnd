import {
  GeneratorContext,
  PROSPERITIES,
  childContext,
  industriesFor,
  livestockFor,
  stamp,
} from '@opendnd/generators';
import type { Economy, Place, Prosperity } from '@opendnd/types';
import {
  HISTORY_GENERATOR,
  makeEvent,
  makePopulation,
  ref,
  yearOf,
} from '../resources';
import { HistoryState } from '../state';
import type { HistoryInput, HistoryParams } from '../types';

/**
 * The aggregate life of every settlement for one year: each population grows
 * or shrinks with its own prosperity, prosperity itself drifts a step now and
 * then (with an event, so a chronicle can say hard times came to a town), and
 * on snapshot years a Population and an Economy record are emitted. The
 * economy is recomputed from the current count, prosperity and the place's
 * natural resources, so a town that grows gains businesses.
 */
export function settlements(
  state: HistoryState,
  input: HistoryInput,
  params: HistoryParams,
  ctx: GeneratorContext,
  initial: boolean,
): void {
  const year = initial ? state.year : state.year + 1;
  const yctx = childContext(ctx, `y${year}`);
  const elapsed = year - input.startYear;
  const last = year === input.startYear + input.years;
  const snapshot =
    initial || elapsed % params.populationSnapshotEvery === 0 || last;

  for (const [placeId, settlement] of state.settlements) {
    const place = state.places.get(placeId)!;
    const pctx = childContext(yctx, placeId);

    if (!initial) {
      drift(state, input, params, place, settlement, year, pctx);
      settlement.count *= 1 + params.populationGrowth[settlement.prosperity];
    }
    if (!snapshot) continue;

    const placeRef = ref('place', place);
    const count = Math.max(0, Math.round(settlement.count));
    state.populations.push(
      makePopulation(
        pctx,
        'population',
        input.calendar,
        placeRef,
        ref('species', input.species),
        ref('culture', input.culture),
        count,
        year,
      ),
    );
    const economy: Economy = {
      ...stamp(HISTORY_GENERATOR, childContext(pctx, 'economy')),
      name: `${place.name} economy, ${year}`,
      perspective: 'in-universe',
      place: placeRef,
      at: yearOf(input.calendar, year),
      prosperity: settlement.prosperity,
      industries: industriesFor(
        count,
        settlement.prosperity,
        place.resources ?? [],
        pctx.rng.child('industries'),
      ),
      livestock: livestockFor(count),
    };
    state.economies.push(economy);
  }
}

/** Move a settlement's prosperity one step, and say so in the record. */
function drift(
  state: HistoryState,
  input: HistoryInput,
  params: HistoryParams,
  place: Place,
  settlement: { prosperity: Prosperity },
  year: number,
  pctx: GeneratorContext,
): void {
  const rng = pctx.rng.child('drift');
  if (rng.next() >= params.prosperityDrift) return;
  const index = PROSPERITIES.indexOf(settlement.prosperity);
  const up = rng.chance();
  const next: Prosperity | undefined = up
    ? PROSPERITIES[index - 1]
    : PROSPERITIES[index + 1];
  if (next === undefined) return;
  settlement.prosperity = next;
  state.addEvent(
    makeEvent(pctx, 'prosperity', input.calendar, {
      type: 'other',
      year,
      name: up
        ? `Fortune returns to ${place.name}`
        : `Hard times come to ${place.name}`,
      description: `${place.name} is now ${next.replace('-', ' ')}.`,
      participants: [],
      locations: [ref('place', place)],
      outcome: next,
    }),
  );
}
