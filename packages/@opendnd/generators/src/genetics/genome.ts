import type { Person, Reference, Sex, Size } from '@opendnd/types';

/** One expressed gene: the gene key and what it expresses as. */
export interface Expression {
  readonly gene: string;
  readonly expression: string;
}

/** Chromosome number -> allele pair, e.g. `"3=9"` or `"X1=Y3"`. */
export type Chromosomes = Readonly<Record<string, string>>;

/** The genetic record of one creature. */
export interface Genome {
  readonly species: Reference;
  readonly sex: Sex;
  readonly chromosomes: Chromosomes;
  /** The phenotype, by category: what each expressed gene shows as. */
  readonly phenotype: Readonly<Record<string, Expression>>;
  /** The species' size category, when it declares one. */
  readonly size?: Size;
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
): Pick<Person, 'species' | 'sex' | 'genome' | 'phenotype'> {
  return {
    species: genome.species,
    sex: genome.sex,
    genome: {
      chromosomes: { ...genome.chromosomes },
      height: genome.height,
      weight: genome.weight,
    },
    phenotype: Object.values(genome.phenotype).map((e) => ({ ...e })),
  };
}
