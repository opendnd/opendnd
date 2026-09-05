import type { Culture, NameType, Person, Sex, Species } from '@opendnd/types';
import { Generator, GeneratorContext, stamp } from '../generator';
import { generate as generateGenome, toPersonFields } from '../genetics';
import { NameGenerator } from '../names';

export interface PersonInput {
  readonly species: Species;
  readonly culture: Culture;
  /** Defaults to a coin flip between male and female. */
  readonly sex?: Sex;
  /** Use this name instead of generating one. */
  readonly name?: string;
}

/**
 * A whole person: a genome from the species and a name from the culture,
 * stamped with provenance. This is the shape every resource-producing
 * generator follows: compose the smaller generators and stamp the result.
 */
export const personGenerator: Generator<PersonInput, Person> = {
  id: 'person',
  version: '1.0.0',
  description:
    'Generates a Person with a genome and phenotype from a Species and a name from a Culture.',

  generate(input: PersonInput, ctx: GeneratorContext): Person {
    const { species, culture } = input;
    const rng = ctx.rng;
    const sex = input.sex ?? (rng.child('sex').chance() ? 'male' : 'female');
    const genome = generateGenome({ species, sex, rng: rng.child('genome') });
    const name = input.name ?? generateFullName(culture, sex, ctx);

    return {
      ...stamp(personGenerator, ctx, {
        derivedFrom: [
          { model: 'species', id: species.id, name: species.name },
          { model: 'culture', id: culture.id, name: culture.name },
        ],
      }),
      name,
      perspective: 'in-universe',
      status: 'alive',
      culture: { model: 'culture', id: culture.id, name: culture.name },
      ...toPersonFields(genome),
    };
  },
};

/** Given name from the sex's list (or any available list), plus a family name when the culture has them. */
function generateFullName(
  culture: Culture,
  sex: Sex,
  ctx: GeneratorContext,
): string {
  const names = new NameGenerator(culture);
  const preferred: NameType[] =
    sex === 'male'
      ? ['male', 'neuter', 'female']
      : sex === 'female'
        ? ['female', 'neuter', 'male']
        : ['neuter', 'male', 'female'];
  const givenType = preferred.find((t) => names.has(t));
  if (!givenType) {
    throw new Error(
      `Culture "${culture.name}" has no given names to learn from`,
    );
  }
  const given = names.generate(givenType, ctx.rng.child('given'));
  if (!names.has('family')) return given;
  return `${given} ${names.generate('family', ctx.rng.child('family'))}`;
}
