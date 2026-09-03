import {
  GeneratorContext,
  PROSPERITIES,
  childContext,
  industriesFor,
  livestockFor,
  stamp,
} from '@opendnd/generators';
import type { Economy, Prosperity } from '@opendnd/types';
import {
  HISTORY_GENERATOR,
  makeEvent,
  makePopulation,
  ref,
  yearOf,
} from 'src/resources';
import { HistoryState } from 'src/state';
import type { HistoryInput, HistoryParams } from 'src/types';

/**
 * The settlement's aggregate life for one year: the population grows or
 * shrinks with prosperity, prosperity itself drifts now and then (with an
 * event so the chronicle can say "hard times came to Thornehold"), and on
 * snapshot years a Population and an Economy record are emitted. The economy
 * is recomputed from the current count, prosperity and the place's natural
 * resources, so a town that grows gains businesses.
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
  const place = ref('place', input.settlement);

  if (!initial) {
    // Prosperity drift, one step at a time.
    const drift = yctx.rng.child('drift');
    if (drift.next() < params.prosperityDrift) {
      const index = PROSPERITIES.indexOf(state.prosperity);
      const up = drift.chance();
      const next: Prosperity | undefined = up
        ? PROSPERITIES[index - 1]
        : PROSPERITIES[index + 1];
      if (next !== undefined) {
        state.prosperity = next;
        state.addEvent(
          makeEvent(yctx, 'prosperity', input.calendar, {
            type: 'other',
            year,
            name: up
              ? `Fortune returns to ${input.settlement.name}`
              : `Hard times come to ${input.settlement.name}`,
            description: `${input.settlement.name} is now ${next.replace('-', ' ')}.`,
            participants: [],
            locations: [place],
            outcome: next,
          }),
        );
      }
    }
    state.populationCount *= 1 + params.populationGrowth[state.prosperity];
  }

  const elapsed = year - input.startYear;
  const last = year === input.startYear + input.years;
  if (initial || elapsed % params.populationSnapshotEvery === 0 || last) {
    const count = Math.round(state.populationCount);
    state.populations.push(
      makePopulation(
        yctx,
        'population',
        input.calendar,
        place,
        ref('species', input.species),
        ref('culture', input.culture),
        count,
        year,
      ),
    );
    const economy: Economy = {
      ...stamp(HISTORY_GENERATOR, childContext(yctx, 'economy')),
      name: `${input.settlement.name} economy, ${year}`,
      perspective: 'in-universe',
      place,
      at: yearOf(input.calendar, year),
      prosperity: state.prosperity,
      industries: industriesFor(
        count,
        state.prosperity,
        input.settlement.resources ?? [],
        yctx.rng.child('industries'),
      ),
      livestock: livestockFor(count),
    };
    state.economies.push(economy);
  }
}
