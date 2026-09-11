import {
  GeneratorContext,
  Genome,
  childContext,
  generate as generateGenome,
  generateChild,
  characterGenerator,
  toPersonFields,
} from '@opendnd/generators';
import type { Character, ReferenceTo, Sex } from '@opendnd/types';
import { Lifecycle, isAdult, isFertile, mortality } from '../lifecycle';
import { makeEvent, makeRelationship, ref, yearOf } from '../resources';
import { HistoryState } from '../state';
import type { HistoryInput, HistoryParams } from '../types';

/**
 * Births, marriages and deaths across every house for one year.
 *
 * A marriage is either dynastic, joining two houses through living figures,
 * or local, drawing a commoner from the seat's aggregate population and
 * instantiating them on demand. Children inherit a genome from both parents
 * and join their father's house. Deaths honour canon fixed points: a person
 * with an authored death year dies in that year and not before.
 */
export function demographics(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  params: HistoryParams,
  ctx: GeneratorContext,
): void {
  const year = state.year;
  const yctx = childContext(ctx, `y${year}`);

  deaths(state, input, lifecycle, params, yctx);

  // Only figures close to a seat of power carry a line forward; the rest live
  // out their lives and their descendants stay in the aggregate population.
  // Before any title is held (the founding year) everyone counts.
  const kinship = state.kinshipToHolders(params.lineageDepth);
  const notable = (person: Character) =>
    kinship.size === 0 || kinship.has(person.id);

  marriages(state, input, lifecycle, params, yctx, notable);
  births(state, input, lifecycle, params, yctx, notable);
}

function deaths(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  params: HistoryParams,
  yctx: GeneratorContext,
): void {
  const year = state.year;
  for (const person of state.living()) {
    const age = state.age(person);
    if (age === undefined) continue;
    const forced = state.forcedDeath.get(person.id);
    const dies =
      forced !== undefined
        ? forced === year
        : yctx.rng.child(`death/${person.id}`).next() <
          mortality(age, lifecycle, params);
    if (!dies) continue;

    const place = placeOf(state, person);
    const spouse = state.spouse(person.id);
    // An authored death event already records this; do not add a second one.
    const authored = state.events.some(
      (e) =>
        e.type === 'death' &&
        e.occurred.begin?.year === year &&
        e.participant?.some(
          (p) => p.actor.id === person.id && p.role === 'deceased',
        ),
    );
    if (!authored) {
      state.addEvent(
        makeEvent(yctx, `death/${person.id}`, input.calendar, {
          type: 'death',
          year,
          name: `Death of ${person.name}`,
          participant: [
            { actor: ref('character', person), role: 'deceased' },
            ...(spouse
              ? [{ actor: ref('character', spouse), role: 'widowed' as const }]
              : []),
          ],
          ...(place ? { location: [place] } : {}),
        }),
      );
    }
    update(state, person, {
      death: {
        time: yearOf(input.calendar, year),
        ...(place ? { place } : {}),
      },
      status: 'dead',
    });
    state.widow(person.id);
  }
}

function marriages(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  params: HistoryParams,
  yctx: GeneratorContext,
  notable: (p: Character) => boolean,
): void {
  const year = state.year;
  const eligible = state
    .living()
    .filter(
      (p) =>
        notable(p) &&
        isAdult(state.age(p) ?? -1, lifecycle) &&
        state.spouse(p.id) === undefined &&
        state.houseOf(p.id) !== undefined,
    );
  const wed = new Set<string>();

  for (const person of eligible) {
    if (wed.has(person.id)) continue;
    const houseId = state.houseOf(person.id)!;
    if (state.livingMembers(houseId).length >= params.maxFiguresPerHouse) {
      continue;
    }
    const prng = yctx.rng.child(`marry/${person.id}`);
    if (prng.next() >= params.marriageChance) continue;

    const wantSex: Sex = person.gender === 'female' ? 'male' : 'female';
    const match =
      prng.next() < params.dynasticMarriageChance
        ? eligible.find(
            (other) =>
              !wed.has(other.id) &&
              other.id !== person.id &&
              other.gender === wantSex &&
              state.houseOf(other.id) !== houseId,
          )
        : undefined;

    const spouse =
      match ?? commoner(state, input, lifecycle, params, person, prng, yctx);
    wed.add(person.id);
    wed.add(spouse.id);

    // Name both houses before anyone moves, or the match reads as a house
    // marrying itself.
    const joined = match
      ? `A match between ${houseName(state, state.houseOf(person.id))} and ${houseName(state, state.houseOf(spouse.id))}.`
      : undefined;

    // The partner from the lesser house joins the greater one, so a line and
    // its title stay together.
    const [keeper, mover] = seniority(state, person, spouse);
    state.movePersonToHouse(mover, state.houseOf(keeper.id)!);

    const place = placeOf(state, keeper);
    state.addEvent(
      makeEvent(yctx, `marriage/${person.id}`, input.calendar, {
        type: 'marriage',
        year,
        name: `Marriage of ${person.name} and ${spouse.name}`,
        ...(joined ? { description: joined } : {}),
        participant: [
          { actor: ref('character', person), role: 'spouse' },
          { actor: ref('character', spouse), role: 'spouse' },
        ],
        ...(place ? { location: [place] } : {}),
      }),
    );
    state.addRelationship(
      makeRelationship(yctx, `couple/${person.id}`, 'couple', person, spouse, {
        fact: [
          {
            type: 'marriage',
            time: yearOf(input.calendar, year),
            ...(place ? { place } : {}),
          },
        ],
        validTime: { begin: yearOf(input.calendar, year) },
      }),
    );
  }
}

function births(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  params: HistoryParams,
  yctx: GeneratorContext,
  notable: (p: Character) => boolean,
): void {
  const year = state.year;
  const seen = new Set<string>();
  for (const person of state.living()) {
    const spouse = state.spouse(person.id);
    if (!spouse || seen.has(person.id) || seen.has(spouse.id)) continue;
    seen.add(person.id);
    seen.add(spouse.id);
    const mother = person.gender === 'female' ? person : spouse;
    const father = mother === person ? spouse : person;
    if (mother.gender !== 'female' || father.gender !== 'male') continue;
    if (!notable(mother) && !notable(father)) continue;
    const motherAge = state.age(mother);
    if (motherAge === undefined || !isFertile(motherAge, lifecycle)) continue;

    const houseId = state.houseOf(father.id) ?? state.houseOf(mother.id);
    if (houseId === undefined) continue;
    if (state.livingMembers(houseId).length >= params.maxFiguresPerHouse) {
      continue;
    }
    const brng = yctx.rng.child(`birth/${mother.id}`);
    if (brng.next() >= params.birthChance) continue;

    const genome = childGenome(input, mother, father, brng);
    const cctx = childContext(yctx, `child/${mother.id}`);
    const base = characterGenerator.generate(
      { species: input.species, culture: input.culture, sex: genome.sex },
      cctx,
    );
    const house = state.houses.get(houseId);
    const place = house?.seat ?? placeOf(state, father);
    const child: Character = {
      ...base,
      ...toPersonFields(genome),
      name: `${base.name.split(' ')[0]} ${familyName(father) ?? familyName(mother) ?? ''}`.trim(),
      birth: {
        time: yearOf(input.calendar, year),
        ...(place ? { place } : {}),
      },
      ...(place ? { residence: place } : {}),
      memberOf: [ref('faction', { id: houseId, name: house?.name })],
    };
    state.addPerson(child, true);

    state.addEvent(
      makeEvent(yctx, `birth/${mother.id}`, input.calendar, {
        type: 'birth',
        year,
        name: `Birth of ${child.name}`,
        participant: [
          { actor: ref('character', child), role: 'child' },
          { actor: ref('character', mother), role: 'mother' },
          { actor: ref('character', father), role: 'father' },
        ],
        ...(place ? { location: [place] } : {}),
      }),
    );
    const order = state.children(father.id).length + 1;
    for (const parent of [father, mother]) {
      state.addRelationship(
        makeRelationship(
          yctx,
          `parent/${parent.id}/${child.id}`,
          'parent-child',
          parent,
          child,
          {
            legitimacy: 'legitimate',
            successionOrder: order,
            fact: [
              {
                type: 'birth',
                time: yearOf(input.calendar, year),
                ...(place ? { place } : {}),
              },
            ],
          },
        ),
      );
    }
  }
}

/** A spouse drawn from the seat's aggregate population and made real. */
function commoner(
  state: HistoryState,
  input: HistoryInput,
  lifecycle: Lifecycle,
  params: HistoryParams,
  match: Character,
  prng: GeneratorContext['rng'],
  yctx: GeneratorContext,
): Character {
  const houseId = state.houseOf(match.id)!;
  const house = state.houses.get(houseId);
  const place = house?.seat ?? placeOf(state, match);
  // Never below the age of majority: a spouse drawn from the crowd is an
  // adult, and a child bride would make the next birth impossible.
  const age = Math.max(
    lifecycle.maturity,
    (state.age(match) ?? lifecycle.maturity) +
      prng.int(-params.spouseAgeSpread, params.spouseAgeSpread),
  );
  const sctx = childContext(yctx, `spouse/${match.id}`);
  const spouse: Character = {
    ...characterGenerator.generate(
      {
        species: input.species,
        culture: input.culture,
        sex: match.gender === 'female' ? 'male' : 'female',
      },
      sctx,
    ),
    birth: {
      time: yearOf(input.calendar, state.year - age),
      ...(place ? { place } : {}),
    },
    ...(place ? { residence: place } : {}),
    memberOf: [ref('faction', { id: houseId, name: house?.name })],
  };
  state.addPerson(spouse, true);
  return spouse;
}

/** The couple ordered so the member of the senior house comes first. */
function seniority(
  state: HistoryState,
  a: Character,
  b: Character,
): [Character, Character] {
  const rank = (p: Character) => {
    const houseId = state.houseOf(p.id);
    const title = houseId ? state.titleOfHouse(houseId) : undefined;
    return title?.rank ?? Number.MAX_SAFE_INTEGER;
  };
  return rank(b) < rank(a) ? [b, a] : [a, b];
}

function childGenome(
  input: HistoryInput,
  mother: Character,
  father: Character,
  rng: GeneratorContext['rng'],
): Genome {
  const complete = (p: Character) =>
    Object.keys(p.genome?.chromosomes ?? {}).length ===
    Object.keys(input.species.chromosomes ?? {}).length;
  if (!complete(mother) || !complete(father)) {
    // A parent without a full genome (authored by hand) cannot pass alleles on.
    return generateGenome({ species: input.species, rng });
  }
  const toGenome = (p: Character, sex: Sex): Genome => ({
    species: ref('species', input.species),
    sex,
    chromosomes: p.genome?.chromosomes ?? {},
    phenotype: {},
    ...(input.species.size ? { size: input.species.size } : {}),
    height: p.genome?.height ?? 0,
    weight: p.genome?.weight ?? 0,
  });
  return generateChild({
    species: input.species,
    mother: toGenome(mother, 'female'),
    father: toGenome(father, 'male'),
    rng,
  });
}

/** Where a person is, by their house's seat or their own residence. */
function placeOf(
  state: HistoryState,
  person: Character,
): ReferenceTo<'place'> | undefined {
  const houseId = state.houseOf(person.id);
  return (houseId ? state.seatOf(houseId) : undefined) ?? person.residence;
}

function houseName(state: HistoryState, houseId: string | undefined): string {
  return (houseId ? state.houses.get(houseId)?.name : undefined) ?? 'a house';
}

/** Apply a patch, mutating generated people and replacing authored ones. */
function update(
  state: HistoryState,
  person: Character,
  patch: Partial<Character>,
): void {
  if (state.generated.has(person.id)) {
    Object.assign(person, patch);
  } else {
    state.people.set(person.id, { ...person, ...patch });
  }
}

function familyName(person: Character): string | undefined {
  const parts = person.name.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}
