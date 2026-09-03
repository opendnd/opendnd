import {
  Generator,
  GeneratorContext,
  childContext,
  personGenerator,
} from '@opendnd/generators';
import type { Person } from '@opendnd/types';
import { checkHistory } from './checker';
import { lifecycleOf } from './lifecycle';
import {
  HISTORY_GENERATOR,
  makeEvent,
  makePopulation,
  makeRelationship,
  ref,
  yearOf,
} from './resources';
import { HistoryState } from './state';
import { demographics } from './systems/demographics';
import { succession } from './systems/succession';
import { DEFAULT_PARAMS, HistoryInput, HistoryOutput } from './types';

/**
 * The history simulation: a yearly clock over one settlement and one house.
 * Each year the systems run in a fixed order (deaths, marriages, births, then
 * succession) with their own child seeds, appending events and resources.
 * Authored people and events are fixed points; everything else is generated.
 */
export const historyGenerator: Generator<HistoryInput, HistoryOutput> = {
  ...HISTORY_GENERATOR,
  description:
    'Simulates years of births, marriages, deaths and successions for a house in a settlement, emitting events and resources.',

  generate(input: HistoryInput, ctx: GeneratorContext): HistoryOutput {
    const params = { ...DEFAULT_PARAMS, ...(input.params ?? {}) };
    const lifecycle = lifecycleOf(input.species);
    const state = new HistoryState(input.startYear);
    const place = ref('place', input.settlement);

    for (const e of input.canonEvents ?? []) {
      state.addEvent(e);
      if (e.eventType !== 'death') continue;
      const y = e.when.begin?.year;
      for (const p of e.participants ?? []) {
        if (p.role === 'deceased' && y !== undefined) {
          state.forcedDeath.set(p.actor.id, y);
        }
      }
    }

    if (input.founders && input.founders.length > 0) {
      for (const founder of input.founders) state.addPerson(founder, false);
    } else {
      foundHouse(state, input, ctx, lifecycle.maturity);
    }

    let population = input.initialPopulation;
    state.populations.push(
      makePopulation(
        ctx,
        `population/${state.year}`,
        input.calendar,
        place,
        ref('species', input.species),
        ref('culture', input.culture),
        population,
        state.year,
      ),
    );

    const endYear = input.startYear + input.years;
    for (; state.year < endYear; state.year++) {
      demographics(
        state,
        input,
        lifecycle,
        params,
        childContext(ctx, 'demographics'),
      );
      succession(state, input, lifecycle, childContext(ctx, 'succession'));
      population *= 1 + params.populationGrowth;
      const elapsed = state.year + 1 - input.startYear;
      if (
        elapsed % params.populationSnapshotEvery === 0 ||
        state.year + 1 === endYear
      ) {
        state.populations.push(
          makePopulation(
            ctx,
            `population/${state.year + 1}`,
            input.calendar,
            place,
            ref('species', input.species),
            ref('culture', input.culture),
            population,
            state.year + 1,
          ),
        );
      }
    }

    const people = [...state.people.values()];
    const events = [...state.events].sort(
      (a, b) => (a.when.begin?.year ?? 0) - (b.when.begin?.year ?? 0),
    );
    const output = {
      people,
      relationships: state.relationships,
      events,
      tenures: state.tenures,
      populations: state.populations,
      endYear,
    };
    return {
      ...output,
      findings: checkHistory({ ...output, species: input.species }),
    };
  },
};

/** A founding couple, a founding event, and the first holder of each office. */
function foundHouse(
  state: HistoryState,
  input: HistoryInput,
  ctx: GeneratorContext,
  maturity: number,
): void {
  const year = state.year;
  const place = ref('place', input.settlement);
  const house = ref('organization', input.house);
  const fctx = childContext(ctx, 'founders');
  const founder = (label: string, sex: Person['sex'], age: number): Person => ({
    ...personGenerator.generate(
      { species: input.species, culture: input.culture, sex },
      childContext(fctx, label),
    ),
    birth: { time: yearOf(input.calendar, year - age), place },
    residence: place,
    memberOf: [house],
  });
  const lord = founder('lord', 'male', maturity + fctx.rng.int(6, 14));
  const lady = founder('lady', 'female', maturity + fctx.rng.int(2, 10));
  state.addPerson(lord, true);
  state.addPerson(lady, true);
  state.addRelationship(
    makeRelationship(fctx, 'couple', 'couple', lord, lady, {
      facts: [{ type: 'marriage', time: yearOf(input.calendar, year), place }],
      validTime: { begin: yearOf(input.calendar, year) },
    }),
  );
  const founding = makeEvent(fctx, 'founding', input.calendar, {
    type: 'founding',
    year,
    name: `Founding of ${input.house.name}`,
    participants: [
      { actor: ref('person', lord), role: 'founder' },
      { actor: ref('person', lady), role: 'founder' },
    ],
    locations: [place],
  });
  state.addEvent(founding);
  // succession() will seat the first holders this same year because every
  // office starts vacant; it treats a missing predecessor as a coronation.
}
