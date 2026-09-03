import {
  GeneratorContext,
  Genome,
  childContext,
  generate as generateGenome,
  generateChild,
  personGenerator,
  toPersonFields,
} from '@opendnd/generators';
import type { Person, Reference, Sex } from '@opendnd/types';
import { Lifecycle, isAdult, isFertile, mortality } from 'src/lifecycle';
import { makeEvent, makeRelationship, ref, yearOf } from 'src/resources';
import { HistoryState } from 'src/state';
import type { HistoryInput, HistoryParams } from 'src/types';

/**
 * Births, marriages and deaths among the house's figures for one year.
 *
 * Spouses are drawn from the settlement's aggregate population and
 * instantiated on demand as generated people; children inherit a genome from
 * both parents. Deaths honour canon fixed points: a person with an authored
 * death year dies in that year and not before.
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
  const place = ref('place', input.settlement);
  const house = ref('faction', input.house);

  // Deaths first, so nobody marries or reproduces in the year they die.
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
    const spouse = state.spouse(person.id);
    // An authored death event already records this; do not add a second one.
    const authored = state.events.some(
      (e) =>
        e.eventType === 'death' &&
        e.when.begin?.year === year &&
        e.participants?.some(
          (p) => p.actor.id === person.id && p.role === 'deceased',
        ),
    );
    if (!authored) {
      state.addEvent(
        makeEvent(yctx, `death/${person.id}`, input.calendar, {
          type: 'death',
          year,
          name: `Death of ${person.name}`,
          participants: [
            { actor: ref('person', person), role: 'deceased' },
            ...(spouse
              ? [{ actor: ref('person', spouse), role: 'widowed' }]
              : []),
          ],
          locations: [place],
        }),
      );
    }
    if (state.generated.has(person.id)) {
      const mutable = person as {
        death?: Person['death'];
        status?: Person['status'];
      };
      mutable.death = { time: yearOf(input.calendar, year), place };
      mutable.status = 'dead';
    } else {
      // Authored people are not rewritten; the event carries the fact.
      state.people.set(person.id, {
        ...person,
        death: { time: yearOf(input.calendar, year), place },
        status: 'dead',
      });
    }
    state.widow(person.id);
  }

  // Only figures close to a seat of power carry the line forward; the rest
  // live out their lives and their descendants stay in the aggregate. Before
  // any title is held (the founding year) everyone counts.
  const kinship = state.kinshipToHolders(params.lineageDepth);
  const notable = (person: Person) =>
    kinship.size === 0 || kinship.has(person.id);
  const roomFor = (n: number) =>
    state.living().length + n <= params.maxLivingFigures;

  // Marriages: unmarried notable adults find a spouse in the population.
  for (const person of state.living()) {
    const age = state.age(person);
    if (age === undefined || !isAdult(age, lifecycle)) continue;
    if (state.spouse(person.id) !== undefined) continue;
    if (!isMember(person, input.house.id) || !notable(person)) continue;
    if (!roomFor(1)) break;
    const prng = yctx.rng.child(`marry/${person.id}`);
    if (prng.next() >= params.marriageChance) continue;

    const spouseSex: Sex = person.sex === 'female' ? 'male' : 'female';
    const spouseAge = Math.max(
      lifecycle.maturity,
      age + prng.int(-params.spouseAgeSpread, params.spouseAgeSpread),
    );
    const sctx = childContext(yctx, `spouse/${person.id}`);
    const spouse: Person = {
      ...personGenerator.generate(
        { species: input.species, culture: input.culture, sex: spouseSex },
        sctx,
      ),
      birth: { time: yearOf(input.calendar, year - spouseAge), place },
      residence: place,
      memberOf: [house],
    };
    state.addPerson(spouse, true);

    const wedding = makeEvent(yctx, `marriage/${person.id}`, input.calendar, {
      type: 'marriage',
      year,
      name: `Marriage of ${person.name} and ${spouse.name}`,
      participants: [
        { actor: ref('person', person), role: 'spouse' },
        { actor: ref('person', spouse), role: 'spouse' },
      ],
      locations: [place],
    });
    state.addEvent(wedding);
    state.addRelationship(
      makeRelationship(yctx, `couple/${person.id}`, 'couple', person, spouse, {
        facts: [
          { type: 'marriage', time: yearOf(input.calendar, year), place },
        ],
        validTime: { begin: yearOf(input.calendar, year) },
      }),
    );
  }

  // Births: each couple with a fertile mother may have a child.
  const seen = new Set<string>();
  for (const person of state.living()) {
    const spouse = state.spouse(person.id);
    if (!spouse || seen.has(person.id) || seen.has(spouse.id)) continue;
    seen.add(person.id);
    seen.add(spouse.id);
    const mother = person.sex === 'female' ? person : spouse;
    const father = mother === person ? spouse : person;
    if (mother.sex !== 'female' || father.sex !== 'male') continue;
    if (!notable(mother) && !notable(father)) continue;
    if (!roomFor(1)) break;
    const motherAge = state.age(mother);
    if (motherAge === undefined || !isFertile(motherAge, lifecycle)) continue;
    const brng = yctx.rng.child(`birth/${mother.id}`);
    if (brng.next() >= params.birthChance) continue;

    const genome = childGenome(input, mother, father, brng);
    const cctx = childContext(yctx, `child/${mother.id}`);
    const base = personGenerator.generate(
      { species: input.species, culture: input.culture, sex: genome.sex },
      cctx,
    );
    const child: Person = {
      ...base,
      ...toPersonFields(genome),
      name: `${base.name.split(' ')[0]} ${familyName(father) ?? familyName(mother) ?? ''}`.trim(),
      birth: { time: yearOf(input.calendar, year), place },
      residence: place,
      memberOf: [house],
    };
    state.addPerson(child, true);

    const birth = makeEvent(yctx, `birth/${mother.id}`, input.calendar, {
      type: 'birth',
      year,
      name: `Birth of ${child.name}`,
      participants: [
        { actor: ref('person', child), role: 'child' },
        { actor: ref('person', mother), role: 'mother' },
        { actor: ref('person', father), role: 'father' },
      ],
      locations: [place],
    });
    state.addEvent(birth);
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
            facts: [
              { type: 'birth', time: yearOf(input.calendar, year), place },
            ],
          },
        ),
      );
    }
  }
}

function childGenome(
  input: HistoryInput,
  mother: Person,
  father: Person,
  rng: GeneratorContext['rng'],
): Genome {
  const complete = (p: Person) =>
    Object.keys(p.genome?.chromosomes ?? {}).length ===
    Object.keys(input.species.chromosomes ?? {}).length;
  if (!complete(mother) || !complete(father)) {
    // A parent without a full genome (authored by hand) cannot pass alleles on.
    return generateGenome({ species: input.species, rng });
  }
  const toGenome = (p: Person, sex: Sex): Genome => ({
    species: ref('species', input.species),
    sex,
    chromosomes: p.genome?.chromosomes ?? {},
    traits: {},
    size: input.species.size,
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

function isMember(person: Person, houseId: string): boolean {
  return (person.memberOf ?? []).some((m: Reference) => m.id === houseId);
}

function familyName(person: Person): string | undefined {
  const parts = person.name.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}
