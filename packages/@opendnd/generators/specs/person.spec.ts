import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivedId } from '@opendnd/random';
import { cultureSchema, personSchema, speciesSchema } from '@opendnd/types';
import { createContext, personGenerator } from 'src';

const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const species = speciesSchema.parse(read('human.species.json'));
const culture = cultureSchema.parse(read('culture.json'));
const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
const now = '2026-09-03T12:00:00Z';

describe('personGenerator', () => {
  const ctx = () => createContext({ world, seedPath: 'dynasty/thorne/3', now });

  it('produces a Person the ontology accepts, stamped as generated', () => {
    const person = personSchema.parse(
      personGenerator.generate({ species, culture }, ctx()),
    );
    expect(person.canonStatus).toBe('generated');
    expect(person.world).toBe(world);
    expect(person.derivedId).toBe(derivedId(world, 'dynasty/thorne/3'));
    expect(person.provenance?.generatedBy).toBe('person@1.0.0');
    expect(person.provenance?.seed).toBe('dynasty/thorne/3');
    expect(person.provenance?.derivedFrom?.map((r) => r.model)).toEqual([
      'species',
      'culture',
    ]);
    expect(person.recorded.createdAt).toBe(now);
    expect(person.species?.id).toBe(species.id);
    expect(person.culture?.id).toBe(culture.id);
    expect(person.genome?.chromosomes['23']).toMatch(/^X\d+=[XY]\d+$/);
    expect(person.name.split(' ').length).toBe(2);
  });

  it('is reproducible for a seed path and differs across seed paths', () => {
    const a = personGenerator.generate({ species, culture }, ctx());
    const b = personGenerator.generate({ species, culture }, ctx());
    const c = personGenerator.generate(
      { species, culture },
      createContext({ world, seedPath: 'dynasty/thorne/4', now }),
    );
    expect(b).toEqual(a);
    expect(c.id).not.toBe(a.id);
    expect(c.name).not.toBe(a.name);
  });

  it('honours a requested sex and name', () => {
    const p = personGenerator.generate(
      { species, culture, sex: 'female', name: 'Livia Honoria' },
      ctx(),
    );
    expect(p.sex).toBe('female');
    expect(p.name).toBe('Livia Honoria');
    expect(p.genome?.chromosomes['23']).toMatch(/^X\d+=X\d+$/);
  });
});
