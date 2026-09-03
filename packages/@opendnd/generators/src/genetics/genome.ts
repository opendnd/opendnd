import type { Person, Reference, Sex, Size } from '@opendnd/types';

/** One expressed trait: the gene key that produced it and the trait text. */
export interface Trait {
  readonly gene: string;
  readonly trait: string;
}

/** Chromosome number -> allele pair, e.g. `"3=9"` or `"X1=Y3"`. */
export type Chromosomes = Readonly<Record<string, string>>;

/** The genetic record of one creature. */
export interface Genome {
  readonly species: Reference;
  readonly sex: Sex;
  readonly chromosomes: Chromosomes;
  readonly traits: Readonly<Record<string, Trait>>;
  readonly size: Size;
  /** Inches. */
  readonly height: number;
  /** Pounds. */
  readonly weight: number;
}

/** Split `"X1=Y3"` into its two alleles. */
export function alleles(pair: string): [string, string] {
  const parts = pair.split('=');
  if (parts.length !== 2) throw new SyntaxError(`Bad allele pair "${pair}"`);
  return [parts[0], parts[1]];
}

/** The numeric roll of an allele, ignoring an X or Y prefix. */
export function alleleValue(allele: string): number {
  return Number(allele.replace(/^[XY]/, ''));
}

/** The fields of a Person that a genome fills in. */
export function toPersonFields(
  genome: Genome,
): Pick<Person, 'species' | 'sex' | 'genome' | 'traits'> {
  return {
    species: genome.species,
    sex: genome.sex,
    genome: {
      chromosomes: { ...genome.chromosomes },
      height: genome.height,
      weight: genome.weight,
    },
    traits: Object.values(genome.traits).map((t) => ({ ...t })),
  };
}
