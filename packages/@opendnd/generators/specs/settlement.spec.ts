import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng } from '@opendnd/random';
import { CellId } from '@opendnd/spatial';
import {
  calendarSchema,
  cultureSchema,
  economySchema,
  factionSchema,
  placeSchema,
  populationSchema,
  speciesSchema,
  titleSchema,
} from '@opendnd/types';
import {
  INDUSTRIES,
  TERRAIN_RESOURCES,
  TIERS,
  createContext,
  industriesFor,
  levelForArea,
  realmGenerator,
  rollResources,
  settlementGenerator,
} from 'src';

const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const species = speciesSchema.parse(read('human.species.json'));
const culture = cultureSchema.parse(read('culture.json'));
const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
const now = '2026-09-03T12:00:00Z';
const calendar = calendarSchema.parse({
  id: 'c0000000-0000-4000-8000-000000000001',
  world,
  name: 'Common Reckoning',
  canonStatus: 'canon',
  recorded: { createdAt: now, updatedAt: now, revision: 1 },
  months: [{ name: 'Year', length: 360 }],
});
const ctx = (seed: string) => createContext({ world, seedPath: seed, now });

describe('settlementGenerator', () => {
  const base = { culture, species, calendar, year: 1000 } as const;
  const town = settlementGenerator.generate(
    { ...base, tier: 'town' },
    ctx('settlement/town'),
  );

  it('is deterministic and validates', () => {
    expect(
      settlementGenerator.generate(
        { ...base, tier: 'town' },
        ctx('settlement/town'),
      ),
    ).toEqual(town);
    placeSchema.parse(town.place);
    populationSchema.parse(town.population);
    economySchema.parse(town.economy);
  });

  it('sizes the town within its tier and derives land from density', () => {
    const p = town.place;
    expect(p.placeType).toBe('town');
    expect(p.population).toBeGreaterThanOrEqual(TIERS.town.min);
    expect(p.population).toBeLessThanOrEqual(TIERS.town.max);
    expect(p.area!.squareMiles).toBeGreaterThan(0);
    expect(
      p.area!.arableSquareMiles! + p.area!.wildernessSquareMiles!,
    ).toBeCloseTo(p.area!.squareMiles, 2);
    expect(town.population.count).toBe(p.population!);
  });

  it('draws resources only from its terrain table', () => {
    const table = new Set(TERRAIN_RESOURCES[town.place.terrain!].resources);
    for (const r of town.place.resources ?? []) expect(table.has(r)).toBe(true);
    for (let i = 0; i < 50; i++) {
      const rs = rollResources('desert', new Rng(`r${i}`));
      expect(rs.length).toBeLessThanOrEqual(2);
      expect(new Set(rs).size).toBe(rs.length);
    }
  });

  it('supports more businesses in a larger, richer, better-resourced place', () => {
    const rng = () => new Rng('industries');
    const total = (xs: ReturnType<typeof industriesFor>) =>
      xs.reduce((s, x) => s + x.count, 0);
    const small = total(industriesFor(500, 'prosperous', [], rng()));
    const big = total(industriesFor(50000, 'prosperous', [], rng()));
    const poor = total(industriesFor(50000, 'very-poor', [], rng()));
    expect(big).toBeGreaterThan(small);
    expect(poor).toBeLessThan(big);
    const without = industriesFor(100000, 'booming', [], rng()).find(
      (i) => i.industry === 'miners',
    )!.count;
    const withIron = industriesFor(100000, 'booming', ['iron'], rng()).find(
      (i) => i.industry === 'miners',
    )!.count;
    expect(withIron).toBeGreaterThanOrEqual(without * 2 - 1);
    expect(INDUSTRIES.miners.advantages).toContain('iron');
    for (const i of town.economy.industries ?? [])
      expect(i.count).toBeGreaterThanOrEqual(1);
  });

  it('honours explicit inputs', () => {
    const s = settlementGenerator.generate(
      {
        ...base,
        tier: 'hamlet',
        name: 'Thornehold',
        terrain: 'hills',
        prosperity: 'poor',
        population: 120,
        density: 3000,
        resources: ['iron', 'stone'],
      },
      ctx('settlement/explicit'),
    );
    expect(s.place.name).toBe('Thornehold');
    expect(s.place.terrain).toBe('hills');
    expect(s.place.population).toBe(120);
    expect(s.place.area!.squareMiles).toBeCloseTo(120 / 3000, 3);
    expect(s.economy.prosperity).toBe('poor');
    expect(s.place.resources).toEqual(['iron', 'stone']);
  });
});

describe('realmGenerator', () => {
  const realm = realmGenerator.generate(
    {
      tier: 'kingdom',
      culture,
      species,
      calendar,
      year: 1000,
      population: 400000,
    },
    ctx('realm/aerath'),
  );

  it('is deterministic and every resource validates', () => {
    expect(
      realmGenerator.generate(
        {
          tier: 'kingdom',
          culture,
          species,
          calendar,
          year: 1000,
          population: 400000,
        },
        ctx('realm/aerath'),
      ),
    ).toEqual(realm);
    for (const p of realm.places) placeSchema.parse(p);
    for (const f of realm.factions) factionSchema.parse(f);
    for (const t of realm.titles) titleSchema.parse(t);
    for (const p of realm.populations) populationSchema.parse(p);
    for (const e of realm.economies) economySchema.parse(e);
  });

  it('nests demesnes and localities under the kingdom with populations that add up', () => {
    const byId = new Map(realm.places.map((p) => [p.id, p]));
    const root = realm.places[0];
    expect(root.placeType).toBe('kingdom');
    expect(root.name.startsWith('Kingdom of ')).toBe(true);
    const types = new Set(realm.places.map((p) => p.placeType));
    expect(types.has('duchy')).toBe(true);
    expect(types.has('county')).toBe(true);
    expect(
      [...types].some((t) =>
        ['hamlet', 'village', 'town', 'city', 'metropolis'].includes(t),
      ),
    ).toBe(true);
    for (const p of realm.places) {
      if (p === root) continue;
      expect(byId.has(p.parent!.id)).toBe(true);
    }
    const childrenSum = new Map<string, number>();
    for (const p of realm.places) {
      if (p.parent)
        childrenSum.set(
          p.parent.id,
          (childrenSum.get(p.parent.id) ?? 0) + (p.population ?? 0),
        );
    }
    for (const [parentId, sum] of childrenSum)
      expect(sum).toBeLessThanOrEqual(byId.get(parentId)!.population! + 1);
  });

  it('places every demesne and locality on the map, each inside its parent', () => {
    const byId = new Map(realm.places.map((p) => [p.id, p]));
    for (const place of realm.places) {
      expect(place.cell).toMatch(/^[0-9a-f]{1,16}$/);
      const parent = place.parent ? byId.get(place.parent.id) : undefined;
      if (parent) {
        const outer = CellId.fromToken(parent.cell!);
        const inner = CellId.fromToken(place.cell!);
        expect(outer.contains(inner)).toBe(true);
        expect(inner.level()).toBeGreaterThan(outer.level());
      }
    }
    // Siblings keep clear of one another where there is room.
    const kingdom = realm.places.find((p) => p.placeType === 'kingdom')!;
    const duchies = realm.places
      .filter((p) => p.parent?.id === kingdom.id)
      .map((p) => CellId.fromToken(p.cell!));
    expect(duchies.length).toBeGreaterThan(1);
    for (let a = 0; a < duchies.length; a++) {
      for (let b = a + 1; b < duchies.length; b++) {
        expect(duchies[a]!.intersects(duchies[b]!)).toBe(false);
      }
    }
  });

  it('lands inside the cell it is asked to, at a level fit for its land', () => {
    const within = CellId.fromFaceIJ(2, 5, 9, 6).token();
    const county = realmGenerator.generate(
      { tier: 'county', culture, species, calendar, year: 1000, within },
      ctx('realm/placed'),
    );
    const top = county.places.find((p) => p.placeType === 'county')!;
    expect(CellId.fromToken(within).contains(CellId.fromToken(top.cell!))).toBe(
      true,
    );
    // Eight hundred square miles is a cell about forty-five kilometres across.
    expect(CellId.fromToken(top.cell!).level()).toBe(levelForArea(800));
    expect(levelForArea(800)).toBeGreaterThan(6);
  });

  it('gives every demesne a ruling house and a ranked title', () => {
    const demesnes = realm.places.filter((p) =>
      ['kingdom', 'duchy', 'county'].includes(p.placeType),
    );
    expect(realm.factions.length).toBe(demesnes.length);
    expect(realm.titles.length).toBe(demesnes.length);
    const king = realm.titles.find((t) => t.rank === 0)!;
    expect(king.styleMale).toBe('King');
    expect(king.styleFemale).toBe('Queen');
    expect(realm.titles.filter((t) => t.rank === 1).length).toBe(
      realm.places.filter((p) => p.placeType === 'duchy').length,
    );
    for (const f of realm.factions) expect(f.factionType).toBe('dynasty');
    const dukes = realm.factions.filter((f) => f.parent);
    expect(dukes.length).toBe(realm.factions.length - 1);
  });
});
