import type {
  Calendar,
  Culture,
  Economy,
  Faction,
  Place,
  PlaceType,
  Population,
  ReferenceTo,
  Species,
  Terrain,
  Title,
} from '@opendnd/types';
import {
  LOCALITY_TIERS,
  SCALE_SQUARE_MILES,
  SettlementTier,
  TIERS,
} from './data';
import { drawPopulation, placeName, settlementGenerator } from './settlement';
import { Generator, GeneratorContext, childContext, stamp } from '../generator';
import { NameGenerator } from '../names';

export type DemesneTier = 'county' | 'duchy' | 'kingdom';

export interface RealmInput {
  readonly tier: DemesneTier;
  readonly culture: Culture;
  readonly species: Species;
  readonly calendar: Calendar;
  readonly year: number;
  readonly name?: string;
  readonly population?: number;
  readonly terrain?: Terrain;
  /** Cap on population, used when carving a demesne out of a larger one. */
  readonly maxPopulation?: number;
  readonly parent?: ReferenceTo<'place'>;
  readonly liege?: ReferenceTo<'faction'>;
}

export interface RealmOutput {
  readonly places: Place[];
  readonly populations: Population[];
  readonly economies: Economy[];
  readonly factions: Faction[];
  readonly titles: Title[];
}

const RANK: Record<DemesneTier, number> = { kingdom: 0, duchy: 1, county: 2 };
const STYLES: Record<
  DemesneTier,
  { male: string; female: string; neuter: string }
> = {
  kingdom: { male: 'King', female: 'Queen', neuter: 'Sovereign' },
  duchy: { male: 'Duke', female: 'Duchess', neuter: 'Duke' },
  county: { male: 'Count', female: 'Countess', neuter: 'Count' },
};

/**
 * A realm as nested demesnes: a kingdom of duchies of counties of localities,
 * each demesne with its own ruling house (a dynasty faction) and a ranked
 * title whose succession the history simulation can run. Populations split
 * top-down: each child takes at most seventy percent of what remains and
 * must reach its own tier's threshold, which is how a kingdom ends up with a
 * few large duchies and a tail of small ones.
 */
export const realmGenerator: Generator<RealmInput, RealmOutput> = {
  id: 'realm',
  version: '1.0.0',
  description:
    'Generates a realm: nested demesnes down to localities, with a ruling house and a ranked title for each demesne.',

  generate(input: RealmInput, ctx: GeneratorContext): RealmOutput {
    const out: RealmOutput = {
      places: [],
      populations: [],
      economies: [],
      factions: [],
      titles: [],
    };
    generateDemesne(input, ctx, out);
    return out;
  },
};

function generateDemesne(
  input: RealmInput,
  ctx: GeneratorContext,
  out: RealmOutput,
): Place {
  const rng = ctx.rng;
  const tier = TIERS[input.tier];
  const count =
    input.population ??
    drawPopulation(
      tier.min,
      Math.min(tier.max, input.maxPopulation ?? tier.max),
      rng.child('population'),
    );
  const name = input.name ?? placeName(input.culture, rng.child('name'));
  const squareMiles =
    SCALE_SQUARE_MILES[tier.scale as keyof typeof SCALE_SQUARE_MILES];

  const place: Place = {
    ...stamp(realmGenerator, ctx),
    name: `${demesneWord(input.tier)} of ${name}`,
    perspective: 'in-universe',
    placeType: input.tier as PlaceType,
    ...(input.terrain ? { terrain: input.terrain } : {}),
    area: { squareMiles },
    population: count,
    ...(input.parent ? { parent: input.parent } : {}),
  };
  const placeRef: ReferenceTo<'place'> = {
    model: 'place',
    id: place.id,
    name: place.name,
  };

  // The ruling house and its seat of power.
  const houseName = new NameGenerator(input.culture).has('family')
    ? new NameGenerator(input.culture).generate('family', rng.child('house'))
    : name;
  const house: Faction = {
    ...stamp(realmGenerator, childContext(ctx, 'house')),
    name: `House ${houseName}`,
    perspective: 'in-universe',
    factionType: 'dynasty',
    seat: placeRef,
    founded: { trs: input.calendar.id, year: input.year, precision: 'year' },
    ...(input.liege ? { parent: input.liege } : {}),
  };
  const houseRef: ReferenceTo<'faction'> = {
    model: 'faction',
    id: house.id,
    name: house.name,
  };
  const styles = STYLES[input.tier];
  const title: Title = {
    ...stamp(realmGenerator, childContext(ctx, 'title')),
    name: `${styles.male} of ${name}`,
    perspective: 'in-universe',
    faction: houseRef,
    rank: RANK[input.tier],
    successionLaw: 'male-preference',
    styleMale: styles.male,
    styleFemale: styles.female,
    styleNeuter: styles.neuter,
  };
  (place as { controlledBy?: ReferenceTo<'faction'> }).controlledBy = houseRef;

  out.places.push(place);
  out.factions.push(house);
  out.titles.push(title);
  out.populations.push({
    ...stamp(realmGenerator, childContext(ctx, 'population')),
    name: `${place.name} population, ${input.year}`,
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
    at: { trs: input.calendar.id, year: input.year, precision: 'year' },
  });

  // Carve the population into children until what remains is too small.
  let remaining = count;
  let index = 0;
  const childTier =
    input.tier === 'kingdom'
      ? 'duchy'
      : input.tier === 'duchy'
        ? 'county'
        : undefined;
  while (remaining > 0) {
    const cap = Math.floor(remaining * 0.7);
    if (childTier) {
      const pick = fitDemesne(remaining, childTier);
      if (!pick) break;
      const child = generateDemesne(
        {
          ...input,
          tier: pick,
          name: undefined,
          population: undefined,
          maxPopulation: Math.min(cap, TIERS[pick].max),
          parent: placeRef,
          liege: houseRef,
        },
        childContext(ctx, `${pick}/${index}`),
        out,
      );
      remaining -= child.population ?? 0;
    } else {
      const pick = fitLocality(remaining);
      if (!pick) break;
      const settlement = settlementGenerator.generate(
        {
          tier: pick,
          culture: input.culture,
          species: input.species,
          calendar: input.calendar,
          year: input.year,
          terrain: input.terrain,
          maxPopulation: Math.min(cap, TIERS[pick].max),
          parent: placeRef,
          controlledBy: houseRef,
        },
        childContext(ctx, `${pick}/${index}`),
      );
      out.places.push(settlement.place);
      out.populations.push(settlement.population);
      out.economies.push(settlement.economy);
      remaining -= settlement.place.population ?? 0;
    }
    index++;
  }
  return place;
}

/**
 * The largest child tier whose minimum the remaining population can still
 * fill with room to spare. A kingdom of a few hundred thousand therefore gets
 * duchies, then counties from what is left, rather than only counties.
 */
function fitDemesne(
  remaining: number,
  upTo: 'duchy' | 'county',
): 'duchy' | 'county' | undefined {
  const order: Array<'duchy' | 'county'> =
    upTo === 'duchy' ? ['duchy', 'county'] : ['county'];
  return order.find((t) => remaining >= TIERS[t].min * 1.3);
}

/** The largest locality tier whose minimum the remaining population can fill. */
function fitLocality(
  remaining: number,
): Exclude<SettlementTier, 'county' | 'duchy' | 'kingdom'> | undefined {
  const tiers = [...LOCALITY_TIERS].reverse() as Array<
    Exclude<SettlementTier, 'county' | 'duchy' | 'kingdom'>
  >;
  return tiers.find((t) => remaining >= TIERS[t].min * 1.3);
}

function demesneWord(tier: DemesneTier): string {
  return tier[0].toUpperCase() + tier.slice(1);
}
