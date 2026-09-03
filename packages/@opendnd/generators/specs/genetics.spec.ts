import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng, sidesOf } from '@opendnd/random';
import { personSchema, speciesSchema } from '@opendnd/types';
import {
  alleles,
  generate,
  generateChild,
  generateParents,
  generateTraits,
  toPersonFields,
  validateChromosomes,
} from 'src/genetics';

const human = speciesSchema.parse(
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'human.species.json'), 'utf8'),
  ),
);

describe('generate', () => {
  it('is deterministic per seed and validates against its own species', () => {
    const a = generate({ species: human, rng: new Rng('aerath/p/1') });
    const b = generate({ species: human, rng: new Rng('aerath/p/1') });
    expect(b).toEqual(a);
    expect(Object.keys(a.chromosomes).length).toBe(
      Object.keys(human.chromosomes!).length,
    );
    validateChromosomes(human, a.chromosomes);
  });

  it('rolls XX for females and XY for males on the sex chromosome', () => {
    const f = generate({ species: human, sex: 'female', rng: new Rng('f') });
    const m = generate({ species: human, sex: 'male', rng: new Rng('m') });
    expect(f.chromosomes['23']).toMatch(/^X\d+=X\d+$/);
    expect(m.chromosomes['23']).toMatch(/^X\d+=Y\d+$/);
    expect(f.traits.hairFacial).toBeUndefined();
  });

  it('gives SRD-consistent height and weight', () => {
    const g = generate({ species: human, rng: new Rng('body') });
    const h = human.height!;
    const maxMod = h.dice.reduce((s, d) => s + sidesOf(d), 0);
    expect(g.height).toBeGreaterThanOrEqual(h.base + h.dice.length);
    expect(g.height).toBeLessThanOrEqual(h.base + maxMod);
    expect(g.weight).toBeGreaterThan(human.weight!.base);
  });

  it('resolves traits from the dictionary, rare over common', () => {
    const chromosomes = {
      ...generate({ species: human, sex: 'male', rng: new Rng('t') })
        .chromosomes,
      '1': '20=3',
    };
    const traits = generateTraits(human, 'male', chromosomes);
    const dictionary = human.traitDictionary!;
    const expected =
      dictionary['general:C1:20=3'] ?? dictionary['general:C1:20'];
    expect(traits.general?.trait).toBe(expected);
  });

  it('fills a Person that the ontology accepts', () => {
    const g = generate({ species: human, rng: new Rng('person') });
    const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
    const person = personSchema.parse({
      id: '0d8b9e0a-1f9a-4d70-9c0b-1f2a3b4c5d6e',
      world,
      name: 'Test',
      canonStatus: 'generated',
      recorded: {
        createdAt: '2026-09-03T12:00:00Z',
        updatedAt: '2026-09-03T12:00:00Z',
        revision: 1,
      },
      ...toPersonFields(g),
    });
    expect(person.genome?.chromosomes['23']).toBe(g.chromosomes['23']);
  });
});

describe('inheritance', () => {
  const mother = generate({
    species: human,
    sex: 'female',
    rng: new Rng('mum'),
  });
  const father = generate({ species: human, sex: 'male', rng: new Rng('dad') });

  it('a child takes one allele from each parent', () => {
    const child = generateChild({
      species: human,
      mother,
      father,
      rng: new Rng('kid'),
    });
    for (const [key, pair] of Object.entries(child.chromosomes)) {
      const [a, b] = alleles(pair);
      expect(alleles(mother.chromosomes[key])).toContain(a);
      expect(alleles(father.chromosomes[key])).toContain(b);
    }
  });

  it('sons get the father Y, daughters the father X', () => {
    const son = generateChild({
      species: human,
      mother,
      father,
      sex: 'male',
      rng: new Rng('s'),
    });
    const daughter = generateChild({
      species: human,
      mother,
      father,
      sex: 'female',
      rng: new Rng('d'),
    });
    const [fatherX, fatherY] = alleles(father.chromosomes['23']);
    expect(alleles(son.chromosomes['23'])[1]).toBe(fatherY);
    expect(alleles(daughter.chromosomes['23'])[1]).toBe(fatherX);
  });

  it('inferred parents could have produced the child', () => {
    const child = generate({ species: human, rng: new Rng('orphan') });
    const parents = generateParents({
      species: human,
      child,
      rng: new Rng('lineage'),
    });
    expect(parents.mother.sex).toBe('female');
    expect(parents.father.sex).toBe('male');
    for (const [key, pair] of Object.entries(child.chromosomes)) {
      const [a, b] = alleles(pair);
      const pool = [
        ...alleles(parents.mother.chromosomes[key]),
        ...alleles(parents.father.chromosomes[key]),
      ];
      expect(pool).toContain(a);
      expect(pool).toContain(b);
    }
    validateChromosomes(human, parents.mother.chromosomes);
    validateChromosomes(human, parents.father.chromosomes);
  });

  it('a mutation die can override inheritance', () => {
    const child = generateChild({
      species: human,
      mother,
      father,
      rng: new Rng('mut'),
      mutation: 'd1',
    });
    let inheritedAll = true;
    for (const [key, pair] of Object.entries(child.chromosomes)) {
      const [a] = alleles(pair);
      if (!alleles(mother.chromosomes[key]).includes(a)) inheritedAll = false;
    }
    expect(inheritedAll).toBe(false);
  });
});
