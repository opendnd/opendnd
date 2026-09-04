import { Rng } from '@opendnd/random';
import type {
  Calendar,
  Culture,
  Economy,
  Place,
  PlaceType,
  Population,
  Prosperity,
  Reference,
  Resource,
  Species,
  Terrain,
} from '@opendnd/types';
import {
  ACRES_PER_SQUARE_MILE,
  INDUSTRIES,
  LIVESTOCK,
  PROSPERITIES,
  PROSPERITY_FACTOR,
  SettlementTier,
  TERRAIN_RESOURCES,
  TIERS,
} from './data';
import { Generator, GeneratorContext, childContext, stamp } from '../generator';
import { NameGenerator } from '../names';

export interface SettlementInput {
  /** hamlet, village, town, city or metropolis. */
  readonly tier: Exclude<SettlementTier, 'county' | 'duchy' | 'kingdom'>;
  readonly culture: Culture;
  readonly species: Species;
  readonly calendar: Calendar;
  /** In-world year of the snapshot. */
  readonly year: number;
  readonly name?: string;
  readonly terrain?: Terrain;
  readonly prosperity?: Prosperity;
  /** Head count. Drawn from the tier's range when absent. */
  readonly population?: number;
  /** People per square mile. Drawn around the tier's typical density when absent. */
  readonly density?: number;
  readonly resources?: Resource[];
  readonly parent?: Reference;
  readonly controlledBy?: Reference;
  /** Upper bound on population, used when carving localities out of a demesne. */
  readonly maxPopulation?: number;
}

export interface SettlementOutput {
  readonly place: Place;
  readonly population: Population;
  readonly economy: Economy;
}

/**
 * One settlement: a place with terrain, natural resources and land area; a
 * population count; and an economy snapshot of the businesses that
 * population supports. Everything is derived from the tier, terrain and
 * prosperity, so a hamlet in the mountains and a city on the coast differ in
 * the ways a player would expect.
 */
export const settlementGenerator: Generator<SettlementInput, SettlementOutput> =
  {
    id: 'settlement',
    version: '1.0.0',
    description:
      'Generates a settlement: place with terrain, resources and area, its population, and an economy snapshot.',

    generate(input: SettlementInput, ctx: GeneratorContext): SettlementOutput {
      const rng = ctx.rng;
      const tier = TIERS[input.tier];
      const name = input.name ?? placeName(input.culture, rng.child('name'));
      const terrain =
        input.terrain ??
        rng.child('terrain').pick(Object.keys(TERRAIN_RESOURCES) as Terrain[]);
      const prosperity =
        input.prosperity ?? rng.child('prosperity').pick(PROSPERITIES);
      const count =
        input.population ??
        drawPopulation(
          tier.min,
          Math.min(tier.max, input.maxPopulation ?? tier.max),
          rng.child('population'),
        );
      const density =
        input.density ??
        Math.max(
          1,
          Math.round(
            rng.child('density').normal(tier.density, tier.density * 0.3),
          ),
        );
      const resources =
        input.resources ?? rollResources(terrain, rng.child('resources'));
      const area = landArea(count, density, rng.child('area'));
      const at = {
        trs: input.calendar.id,
        year: input.year,
        precision: 'year' as const,
      };

      const place: Place = {
        ...stamp(settlementGenerator, ctx),
        name,
        perspective: 'in-universe',
        placeType: input.tier as PlaceType,
        terrain,
        resources,
        area,
        population: count,
        ...(input.parent ? { parent: input.parent } : {}),
        ...(input.controlledBy ? { controlledBy: input.controlledBy } : {}),
      };
      const placeRef: Reference = { model: 'place', id: place.id, name };

      const population: Population = {
        ...stamp(settlementGenerator, childContext(ctx, 'population')),
        name: `${name} population, ${input.year}`,
        perspective: 'in-universe',
        place: placeRef,
        species: {
          model: 'species',
          id: input.species.id,
          name: input.species.name,
        },
        culture: {
          model: 'culture',
          id: input.culture.id,
          name: input.culture.name,
        },
        count,
        at,
      };

      const economy: Economy = {
        ...stamp(settlementGenerator, childContext(ctx, 'economy')),
        name: `${name} economy, ${input.year}`,
        perspective: 'in-universe',
        place: placeRef,
        at,
        prosperity,
        industries: industriesFor(
          count,
          prosperity,
          resources,
          rng.child('industries'),
        ),
        livestock: livestockFor(count),
      };

      return { place, population, economy };
    },
  };

/** A place name from the culture's place list, or a family name, or a given name. */
export function placeName(culture: Culture, rng: Rng): string {
  const names = new NameGenerator(culture);
  const type = (['place', 'family', 'male', 'female'] as const).find((t) =>
    names.has(t),
  );
  if (!type) {
    throw new Error(`Culture "${culture.name}" has no names to learn from`);
  }
  return names.generate(type, rng);
}

/** Population drawn from a normal centred in the tier, clamped to its bounds. */
export function drawPopulation(min: number, max: number, rng: Rng): number {
  const lo = Math.ceil(min);
  const hi = Math.max(lo, Math.floor(max));
  const diff = hi - lo;
  const draw = Math.floor(rng.normal(lo + diff / 2, diff / 5));
  return Math.min(hi, Math.max(lo, draw));
}

/**
 * Roll the terrain's die for the number of picks; each pick takes a random
 * remaining resource and keeps it on a d20 of 5 or better.
 */
export function rollResources(terrain: Terrain, rng: Rng): Resource[] {
  const table = TERRAIN_RESOURCES[terrain];
  const remaining = [...table.resources];
  const picks = rng.roll(table.dice);
  const out: Resource[] = [];
  for (let i = 0; i < picks && remaining.length > 0; i++) {
    const index = rng.int(0, remaining.length - 1);
    if (rng.roll('d20') >= 5) out.push(...remaining.splice(index, 1));
  }
  return out.sort();
}

/** Total land from count and density; about 40% arable, the rest wilderness. */
export function landArea(count: number, density: number, rng: Rng) {
  const squareMiles = Math.max(1 / ACRES_PER_SQUARE_MILE, count / density);
  const arableShare = Math.min(0.9, Math.max(0.05, rng.normal(0.4, 0.1)));
  const arable = squareMiles * arableShare;
  return {
    squareMiles: round(squareMiles),
    arableSquareMiles: round(arable),
    wildernessSquareMiles: round(squareMiles - arable),
  };
}

/**
 * How many of each business the population supports: people divided by the
 * industry's support value, scaled by prosperity and halved when the place
 * has a resource the industry thrives on. The fractional remainder is the
 * chance of one more.
 */
export function industriesFor(
  count: number,
  prosperity: Prosperity,
  resources: readonly Resource[],
  rng: Rng,
): NonNullable<Economy['industries']> {
  const factor = PROSPERITY_FACTOR[prosperity];
  const have = new Set(resources);
  const out: NonNullable<Economy['industries']> = [];
  for (const [industry, spec] of Object.entries(INDUSTRIES) as Array<
    [keyof typeof INDUSTRIES, (typeof INDUSTRIES)[keyof typeof INDUSTRIES]]
  >) {
    const advantaged = spec.advantages.some((r) => have.has(r));
    const needed = (spec.supportValue * factor) / (advantaged ? 2 : 1);
    const expected = count / needed;
    let n = Math.floor(expected);
    if (rng.next() < expected - n) n += 1;
    if (n > 0) out.push({ industry, count: n });
  }
  return out;
}

/** Livestock head counts as a multiple of the population, by animal. */
export function livestockFor(count: number): NonNullable<Economy['livestock']> {
  const total = Math.floor(count * LIVESTOCK.multiplier);
  return (Object.entries(LIVESTOCK.ratios) as Array<[string, number]>).map(
    ([animal, ratio]) => ({
      animal,
      count: Math.floor(ratio * total),
    }),
  );
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
