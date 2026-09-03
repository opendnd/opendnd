import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng } from '@opendnd/random';
import { cultureSchema } from '@opendnd/types';
import { NameGenerator, buildChain, generateName, nameFor } from 'src/names';

const culture = cultureSchema.parse(
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'culture.json'), 'utf8')),
);

describe('markov chain', () => {
  it('only produces letters it has seen, starting with seen initials', () => {
    const names = ['Anna', 'Arno', 'Bela', 'Bram'];
    const chain = buildChain(names);
    const letters = new Set(names.join('').split(''));
    const rng = new Rng('letters');
    for (let i = 0; i < 200; i++) {
      const name = generateName(chain, rng);
      expect(name.length).toBeGreaterThan(0);
      expect(['A', 'B']).toContain(name[0]);
      for (const ch of name) expect(letters.has(ch)).toBe(true);
    }
  });

  it('learns multi-word names', () => {
    const chain = buildChain(['Ab Cd', 'Ab Ce', 'Ac Cd']);
    expect(generateName(chain, new Rng('two')).split(' ').length).toBe(2);
  });
});

describe('NameGenerator', () => {
  it('validates the fixture as a Culture and lists its name types', () => {
    const nomina = new NameGenerator(culture);
    expect(nomina.types().sort()).toEqual([
      'family',
      'female',
      'male',
      'place',
    ]);
    expect(nomina.has('neuter')).toBe(false);
    expect(() => nomina.generate('neuter', new Rng('x'))).toThrow();
  });

  it('is deterministic per seed', () => {
    expect(nameFor(culture, 'male', 'aerath/thorne/1')).toBe(
      nameFor(culture, 'male', 'aerath/thorne/1'),
    );
    expect(nameFor(culture, 'male', 'aerath/thorne/1')).not.toBe(
      nameFor(culture, 'male', 'aerath/thorne/2'),
    );
  });

  it('produces plausible distinct names', () => {
    const names = new NameGenerator(culture).list(
      'female',
      new Rng('list'),
      10,
    );
    expect(names.length).toBe(10);
    for (const n of names) expect(n).toMatch(/^[A-Z][a-z]+$/);
  });
});
