import {
  Generator,
  GeneratorContext,
  LOCALITY_TIERS,
  childContext,
  personGenerator,
} from '@opendnd/generators';
import type { Faction, Person, Prosperity } from '@opendnd/types';
import { checkHistory } from './checker';
import { lifecycleOf } from './lifecycle';
import {
  HISTORY_GENERATOR,
  makeEvent,
  makeRelationship,
  ref,
  yearOf,
} from './resources';
import { HistoryState } from './state';
import { conflict } from './systems/conflict';
import { demographics } from './systems/demographics';
import { settlements } from './systems/settlements';
import { succession } from './systems/succession';
import { DEFAULT_PARAMS, HistoryInput, HistoryOutput } from './types';

const LOCALITIES = new Set<string>(LOCALITY_TIERS);

/**
 * The history simulation: a yearly clock over a realm of settlements, houses
 * and titles. Each year the systems run in a fixed order (deaths, marriages,
 * births, then succession, conflict and settlements) with their own child seeds,
 * appending events and resources. Authored people and events are fixed
 * points; everything else is generated.
 */
export const historyGenerator: Generator<HistoryInput, HistoryOutput> = {
  ...HISTORY_GENERATOR,
  description:
    'Simulates years of births, marriages, deaths, successions, wars and settlement fortunes across a realm, emitting events and resources.',

  generate(input: HistoryInput, ctx: GeneratorContext): HistoryOutput {
    const params = { ...DEFAULT_PARAMS, ...(input.params ?? {}) };
    const lifecycle = lifecycleOf(input.species);
    const state = new HistoryState(input.startYear);

    for (const place of input.places) {
      state.places.set(place.id, place);
      const house = place.controlledBy?.id;
      if (house !== undefined) {
        const held = state.holdings.get(house) ?? [];
        held.push(place.id);
        state.holdings.set(house, held);
      }
    }
    for (const house of input.factions) state.houses.set(house.id, house);
    for (const title of input.titles) state.titlesById.set(title.id, title);

    const seeded = new Map<string, Prosperity>();
    for (const economy of input.economies ?? []) {
      seeded.set(economy.place.id, economy.prosperity);
    }
    for (const place of input.places) {
      if (!LOCALITIES.has(place.placeType)) continue;
      state.settlements.set(place.id, {
        count: place.population ?? 0,
        prosperity: seeded.get(place.id) ?? 'prosperous',
      });
    }

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
    for (const founder of input.founders ?? []) state.addPerson(founder, false);

    // Any house nobody authored a member for gets a founding couple, so every
    // title has someone to crown in the first year.
    for (const house of input.factions) {
      if (state.livingMembers(house.id).length === 0) {
        foundHouse(state, input, house, ctx, lifecycle.maturity);
      }
    }

    settlements(state, input, params, childContext(ctx, 'settlements'), true);

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
      conflict(state, input, params, childContext(ctx, 'conflict'));
      settlements(
        state,
        input,
        params,
        childContext(ctx, 'settlements'),
        false,
      );
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
      claims: state.claims,
      populations: state.populations,
      economies: state.economies,
      endYear,
    };
    return {
      ...output,
      findings: checkHistory({ ...output, species: input.species }),
    };
  },
};

/** A founding couple for a house, married at its seat in the first year. */
function foundHouse(
  state: HistoryState,
  input: HistoryInput,
  house: Faction,
  ctx: GeneratorContext,
  maturity: number,
): void {
  const year = state.year;
  const place = house.seat;
  const houseRef = ref('faction', house);
  const fctx = childContext(ctx, `founders/${house.id}`);
  const founder = (label: string, sex: Person['sex'], age: number): Person => ({
    ...personGenerator.generate(
      { species: input.species, culture: input.culture, sex },
      childContext(fctx, label),
    ),
    birth: {
      time: yearOf(input.calendar, year - age),
      ...(place ? { place } : {}),
    },
    ...(place ? { residence: place } : {}),
    memberOf: [houseRef],
  });
  const lord = founder('lord', 'male', maturity + fctx.rng.int(6, 14));
  const lady = founder('lady', 'female', maturity + fctx.rng.int(2, 10));
  state.addPerson(lord, true);
  state.addPerson(lady, true);
  state.addRelationship(
    makeRelationship(fctx, 'couple', 'couple', lord, lady, {
      facts: [
        {
          type: 'marriage',
          time: yearOf(input.calendar, year),
          ...(place ? { place } : {}),
        },
      ],
      validTime: { begin: yearOf(input.calendar, year) },
    }),
  );
  state.addEvent(
    makeEvent(fctx, 'founding', input.calendar, {
      type: 'founding',
      year,
      name: `Founding of ${house.name}`,
      participants: [
        { actor: ref('person', lord), role: 'founder' },
        { actor: ref('person', lady), role: 'founder' },
      ],
      ...(place ? { locations: [place] } : {}),
    }),
  );
  // succession() seats the first holder this same year, because every title
  // starts vacant and a missing predecessor reads as a coronation.
}
