import { describe, expect, it } from 'bun:test';
import { Rng, derivedId, parseDice, uuidV5 } from 'src';

describe('Rng', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = new Rng('aerath/thorne/1');
    const b = new Rng('aerath/thorne/1');
    const c = new Rng('aerath/thorne/2');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it('stays in range and covers every face', () => {
    const rng = new Rng('dice');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.roll('d6');
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('parses dice notation', () => {
    expect(parseDice('d8')).toEqual({ count: 1, sides: 8, modifier: 0 });
    expect(parseDice('2d6+1')).toEqual({ count: 2, sides: 6, modifier: 1 });
    expect(() => parseDice('banana')).toThrow(SyntaxError);
    expect(new Rng('x').rollEach('2d6').length).toBe(2);
  });

  it('respects weights', () => {
    const rng = new Rng('weights');
    let heavy = 0;
    for (let i = 0; i < 1000; i++) {
      if (
        rng.weighted([
          { value: 'a', weight: 9 },
          { value: 'b', weight: 1 },
        ]) === 'a'
      )
        heavy++;
    }
    expect(heavy).toBeGreaterThan(800);
  });

  it('draws reproducible v4-shaped uuids', () => {
    const id = new Rng('ids').uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Rng('ids').uuid()).toBe(id);
  });

  it('draws roughly normal values', () => {
    const rng = new Rng('normal');
    const xs = Array.from({ length: 4000 }, () => rng.normal(100, 15));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(
      xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length,
    );
    expect(Math.abs(mean - 100)).toBeLessThan(1.5);
    expect(Math.abs(sd - 15)).toBeLessThan(1.5);
  });

  it('derives independent child streams', () => {
    const root = new Rng('world');
    const x = root.child('names').next();
    expect(new Rng('world/names').next()).toBe(x);
  });
});

describe('uuidV5', () => {
  it('matches the RFC 4122 example for the DNS namespace', () => {
    expect(
      uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'),
    ).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('derives stable ids from a world and a seed path', () => {
    const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
    expect(derivedId(world, 'thorne/3')).toBe(derivedId(world, 'thorne/3'));
    expect(derivedId(world, 'thorne/3')).not.toBe(derivedId(world, 'thorne/4'));
  });
});
