import { Rng, sidesOf } from '@opendnd/random';
import type { Reference, Sex, Species } from '@opendnd/types';
import { Chromosomes, Genome, Trait, alleleValue, alleles } from './genome';

const SEX = 'sex';
const HAIR_FACIAL = 'hairFacial';

export interface GenerateOptions {
  readonly species: Species;
  /** Defaults to a coin flip between male and female. */
  readonly sex?: Sex;
  readonly rng: Rng;
  /** Allele pairs to keep instead of rolling, keyed by chromosome number. */
  readonly chromosomes?: Chromosomes;
  /** A die; rolling a 1 on it discards a passed-in pair and rolls fresh. */
  readonly mutation?: string;
}

/** Roll a complete genome for a species. */
export function generate(options: GenerateOptions): Genome {
  const { species, rng } = options;
  const sex = options.sex ?? (rng.chance() ? 'male' : 'female');
  const chromosomes = generateChromosomes(species, sex, rng, options);
  const { height, weight } = generateHeightAndWeight(
    species,
    rng.child('body'),
  );
  return {
    species: speciesRef(species),
    sex,
    chromosomes,
    traits: generateTraits(species, sex, chromosomes),
    size: species.size,
    height,
    weight,
  };
}

/** Roll every chromosome pair, honouring passed-in pairs unless a mutation strikes. */
export function generateChromosomes(
  species: Species,
  sex: Sex,
  rng: Rng,
  options: Pick<GenerateOptions, 'chromosomes' | 'mutation'> = {},
): Chromosomes {
  const layout = species.chromosomes ?? {};
  const out: Record<string, string> = {};
  for (const key of chromosomeKeys(layout)) {
    const die = layout[key];
    const mutated =
      options.mutation !== undefined && rng.roll(options.mutation) === 1;
    const given = options.chromosomes?.[key];
    if (given !== undefined && !mutated) {
      out[key] = given;
      continue;
    }
    if (die === SEX) {
      out[key] = rollSexChromosome(species, sex, rng);
    } else {
      out[key] = `${rng.roll(die)}=${rng.roll(die)}`;
    }
  }
  return out;
}

/** Combine one allele from each parent. The father decides the child's sex chromosome. */
export function generateChild(options: {
  readonly species: Species;
  readonly mother: Genome;
  readonly father: Genome;
  readonly sex?: Sex;
  readonly rng: Rng;
  readonly mutation?: string;
}): Genome {
  const { species, mother, father, rng } = options;
  if (mother.species.id !== father.species.id) {
    throw new Error('Cross-species inheritance is not supported yet');
  }
  if (mother.species.id !== species.id) {
    throw new Error('Parents do not belong to the given species');
  }
  const sex = options.sex ?? (rng.chance() ? 'male' : 'female');
  const layout = species.chromosomes ?? {};
  const inherited: Record<string, string> = {};
  for (const key of chromosomeKeys(layout)) {
    const [mA, mB] = alleles(mother.chromosomes[key]);
    const [fA, fB] = alleles(father.chromosomes[key]);
    if (layout[key] === SEX) {
      const fromMother = rng.pick([mA, mB]);
      // Father passes his X (first allele) to daughters and his Y to sons.
      inherited[key] = `${fromMother}=${sex === 'male' ? fB : fA}`;
    } else {
      inherited[key] = `${rng.pick([mA, mB])}=${rng.pick([fA, fB])}`;
    }
  }
  return generate({
    species,
    sex,
    rng: rng.child('child'),
    chromosomes: inherited,
    mutation: options.mutation,
  });
}

/** Infer a plausible mother and father from a child: each child allele came from one of them. */
export function generateParents(options: {
  readonly species: Species;
  readonly child: Genome;
  readonly rng: Rng;
}): { mother: Genome; father: Genome } {
  const { species, child, rng } = options;
  const layout = species.chromosomes ?? {};
  const xDie = species.sexChromosomes?.x;
  const yDie = species.sexChromosomes?.y;
  const mother: Record<string, string> = {};
  const father: Record<string, string> = {};

  for (const key of chromosomeKeys(layout)) {
    const die = layout[key];
    const [a, b] = alleles(child.chromosomes[key]);
    if (die === SEX) {
      if (!xDie || !yDie) throw new Error('Species has no sex chromosome dice');
      const x = `X${rng.roll(xDie)}`;
      if (child.sex === 'male') {
        // a is the X from the mother, b the Y from the father.
        father[key] = `${x}=${b}`;
        mother[key] = rng.chance() ? `${a}=${x}` : `${x}=${a}`;
      } else {
        const [fatherX, motherX] = rng.chance() ? [a, b] : [b, a];
        father[key] = `${fatherX}=Y${rng.roll(yDie)}`;
        mother[key] = rng.chance() ? `${x}=${motherX}` : `${motherX}=${x}`;
      }
      continue;
    }
    const [toFather, toMother] = rng.chance() ? [a, b] : [b, a];
    const fatherNew = String(rng.roll(die));
    const motherNew = String(rng.roll(die));
    father[key] = rng.chance()
      ? `${fatherNew}=${toFather}`
      : `${toFather}=${fatherNew}`;
    mother[key] = rng.chance()
      ? `${motherNew}=${toMother}`
      : `${toMother}=${motherNew}`;
  }

  return {
    mother: generate({
      species,
      sex: 'female',
      rng: rng.child('mother'),
      chromosomes: mother,
    }),
    father: generate({
      species,
      sex: 'male',
      rng: rng.child('father'),
      chromosomes: father,
    }),
  };
}

/**
 * Resolve traits from chromosomes. For each category the species maps to a
 * chromosome, a rare gene (the exact allele pair, e.g. `eyeColor:C2:3=9`) wins
 * over a common gene (the dominant allele, e.g. `eyeColor:C2:9`).
 */
export function generateTraits(
  species: Species,
  sex: Sex,
  chromosomes: Chromosomes,
): Record<string, Trait> {
  const dictionary = species.traitDictionary;
  const categories = species.categories ?? {};
  const traits: Record<string, Trait> = {};
  if (!dictionary) return traits;

  for (const [category, chromosome] of Object.entries(categories)) {
    if (sex === 'female' && category === HAIR_FACIAL) continue;
    const pair = chromosomes[chromosome];
    if (pair === undefined) continue;
    const [a, b] = alleles(pair);
    // Ties go to the second allele, as in the original d20 rules.
    const dominant = alleleValue(a) > alleleValue(b) ? a : b;
    const prefix = `${category}:C${chromosome}:`;
    const rare = `${prefix}${pair}`;
    const common =
      sex === 'female' && category === SEX
        ? `${prefix}X${dominant}`
        : `${prefix}${dominant}`;
    const rareTrait = dictionary[rare];
    if (rareTrait !== undefined) {
      traits[category] = { gene: rare, trait: rareTrait };
      continue;
    }
    const commonTrait = dictionary[common];
    if (commonTrait !== undefined) {
      traits[category] = { gene: common, trait: commonTrait };
    }
  }
  return traits;
}

/**
 * Height and weight per the SRD tables: the height modifier roll is added to
 * base height in inches, and that same modifier times the weight dice (or a
 * fixed multiplier) is added to base weight in pounds.
 */
export function generateHeightAndWeight(
  species: Species,
  rng: Rng,
): { height: number; weight: number } {
  const h = species.height;
  const w = species.weight;
  if (!h) return { height: 0, weight: w?.base ?? 0 };
  const modifier = rng.rollAll(h.dice);
  const height = h.base + modifier;
  if (!w) return { height, weight: 0 };
  const factor =
    w.multiplier ?? (w.dice && w.dice.length > 0 ? rng.rollAll(w.dice) : 1);
  return { height, weight: w.base + modifier * factor };
}

/** Validate that every allele fits its die; throws naming the offending pair. */
export function validateChromosomes(
  species: Species,
  chromosomes: Chromosomes,
): void {
  const layout = species.chromosomes ?? {};
  for (const [key, pair] of Object.entries(chromosomes)) {
    const die = layout[key];
    if (die === undefined) throw new Error(`Unknown chromosome ${key}`);
    const [a, b] = alleles(pair);
    if (die === SEX) {
      const dice = species.sexChromosomes;
      if (!dice) throw new Error('Species has no sex chromosome dice');
      for (const allele of [a, b]) {
        const max = sidesOf(allele.startsWith('Y') ? dice.y : dice.x);
        if (!/^[XY]\d+$/.test(allele) || alleleValue(allele) > max) {
          throw new Error(
            `Sex allele "${allele}" is not valid for ${species.name}`,
          );
        }
      }
    } else {
      const max = sidesOf(die);
      for (const allele of [a, b]) {
        const value = Number(allele);
        if (!/^\d+$/.test(allele) || value > max || value < 1) {
          throw new Error(
            `Allele "${allele}" is outside ${die} on chromosome ${key}`,
          );
        }
      }
    }
  }
}

function rollSexChromosome(species: Species, sex: Sex, rng: Rng): string {
  const dice = species.sexChromosomes;
  if (!dice) {
    throw new Error(`Species ${species.name} has no sex chromosome dice`);
  }
  if (sex === 'male') return `X${rng.roll(dice.x)}=Y${rng.roll(dice.y)}`;
  return `X${rng.roll(dice.x)}=X${rng.roll(dice.x)}`;
}

/** Chromosome numbers in numeric order so output is stable. */
function chromosomeKeys(layout: Readonly<Record<string, string>>): string[] {
  return Object.keys(layout).sort((a, b) => Number(a) - Number(b));
}

function speciesRef(species: Species): Reference {
  return { model: 'species', id: species.id, name: species.name };
}
