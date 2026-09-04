import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createContext,
  personGenerator,
  realmGenerator,
} from '@opendnd/generators';
import {
  calendarSchema,
  cultureSchema,
  economySchema,
  eventSchema,
  personSchema,
  populationSchema,
  relationshipSchema,
  speciesSchema,
  tenureSchema,
} from '@opendnd/types';
import { HistoryInput, checkHistory, historyGenerator } from 'src';

const FIXTURES = join(__dirname, '..', '..', 'generators', 'specs', 'fixtures');
const read = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
const now = '2026-09-03T12:00:00Z';
const species = speciesSchema.parse(read('human.species.json'));
const culture = cultureSchema.parse(read('culture.json'));
const calendar = calendarSchema.parse({
  id: 'c0000000-0000-4000-8000-000000000001',
  world,
  name: 'Common Reckoning',
  canonStatus: 'canon',
  recorded: { createdAt: now, updatedAt: now, revision: 1 },
  months: [{ name: 'Year', length: 360 }],
});

/** A duchy of counties, so the simulation has several houses to run. */
const realm = realmGenerator.generate(
  { tier: 'duchy', culture, species, calendar, year: 1000, population: 60000 },
  createContext({ world, seedPath: 'realm/thorne', now }),
);

const input: HistoryInput = {
  calendar,
  species,
  culture,
  places: realm.places,
  factions: realm.factions,
  titles: realm.titles,
  economies: realm.economies,
  startYear: 1000,
  years: 200,
};
const ctx = () => createContext({ world, seedPath: 'history/thorne', now });

describe('historyGenerator', () => {
  const out = historyGenerator.generate(input, ctx());

  it('is deterministic', () => {
    expect(historyGenerator.generate(input, ctx())).toEqual(out);
  });

  it('produces a consistent history', () => {
    expect(out.findings).toEqual([]);
    expect(checkHistory({ ...out, species })).toEqual([]);
  });

  it('emits resources the ontology accepts, all stamped generated', () => {
    for (const p of out.people) personSchema.parse(p);
    for (const e of out.events) eventSchema.parse(e);
    for (const r of out.relationships) relationshipSchema.parse(r);
    for (const t of out.tenures) tenureSchema.parse(t);
    for (const p of out.populations) populationSchema.parse(p);
    for (const e of out.economies) economySchema.parse(e);
    for (const p of out.people) {
      expect(p.canonStatus).toBe('generated');
      expect(p.provenance?.generatedBy).toMatch(/^(person|history)@/);
    }
    expect(out.events.map((e) => e.when.begin?.year ?? 0)).toEqual(
      [...out.events.map((e) => e.when.begin?.year ?? 0)].sort((a, b) => a - b),
    );
  });

  it('crowns every house and keeps each title held by one person at a time', () => {
    const titleIds = new Set(realm.titles.map((t) => t.id));
    expect(titleIds.size).toBeGreaterThan(1);
    const held = new Set(out.tenures.map((t) => t.title.id));
    expect(held).toEqual(titleIds);
    expect(
      out.events.filter(
        (e) => e.eventType === 'coronation' && e.when.begin?.year === 1000,
      ).length,
    ).toBe(realm.titles.length);
    for (const titleId of titleIds) {
      const tenures = out.tenures.filter((t) => t.title.id === titleId);
      for (let year = 1000; year < 1200; year++) {
        const active = tenures.filter(
          (t) =>
            (t.validTime?.begin?.year ?? 0) <= year &&
            (t.validTime?.end?.year === undefined ||
              t.validTime.end.year > year),
        );
        expect(active.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('links successions to the deaths that caused them', () => {
    const successions = out.events.filter((e) => e.eventType === 'succession');
    expect(successions.length).toBeGreaterThan(0);
    for (const s of successions) {
      expect(s.causedBy?.length).toBe(1);
      const cause = out.events.find((e) => e.id === s.causedBy![0].id);
      expect(cause?.eventType).toBe('death');
    }
  });

  it('ties vassals to their lieges, and only between living holders', () => {
    const homage = out.relationships.filter(
      (r) => r.relationshipType === 'liege-vassal',
    );
    expect(homage.length).toBeGreaterThan(0);
    const holders = new Set(out.tenures.map((t) => t.holder.id));
    for (const bond of homage) {
      expect(holders.has(bond.person1.id)).toBe(true);
      expect(holders.has(bond.person2.id)).toBe(true);
      expect(bond.person1.id).not.toBe(bond.person2.id);
    }
    // The duke's house is liege to the counts', so the duke appears as person1.
    const dukeTitle = realm.titles.find((t) => t.rank === 1)!;
    const dukes = new Set(
      out.tenures
        .filter((t) => t.title.id === dukeTitle.id)
        .map((t) => t.holder.id),
    );
    expect(homage.some((h) => dukes.has(h.person1.id))).toBe(true);
  });

  it('makes matches between houses as well as with commoners', () => {
    const marriages = out.events.filter((e) => e.eventType === 'marriage');
    expect(marriages.length).toBeGreaterThan(0);
    const dynastic = marriages.filter((e) => e.description?.includes('match'));
    expect(dynastic.length).toBeGreaterThan(0);
    expect(dynastic.length).toBeLessThan(marriages.length);
    // Both houses are named as they stood before either partner moved.
    for (const e of dynastic) {
      const [, a, b] = /A match between (.+) and (.+)\./.exec(e.description!)!;
      expect(a).not.toBe(b);
    }
  });

  it('tracks every settlement separately through the years', () => {
    const settlements = realm.places.filter((p) =>
      ['hamlet', 'village', 'town', 'city', 'metropolis'].includes(p.placeType),
    );
    expect(settlements.length).toBeGreaterThan(1);
    const counted = new Set(out.populations.map((p) => p.place.id));
    expect(counted).toEqual(new Set(settlements.map((p) => p.id)));
    expect(new Set(out.economies.map((e) => e.place.id))).toEqual(counted);
    const years = new Set(out.populations.map((p) => p.at.year));
    expect(years.has(1000)).toBe(true);
    expect(years.has(1200)).toBe(true);
    // Prosperity drifts independently, so not every town shares a fortune.
    const fortunes = new Set(
      out.economies.filter((e) => e.at.year === 1200).map((e) => e.prosperity),
    );
    expect(fortunes.size).toBeGreaterThan(1);
  });

  it('honours an authored death as a fixed point', () => {
    const house = realm.factions[0];
    const fctx = createContext({ world, seedPath: 'history/canon', now });
    const founder = (label: string, sex: 'male' | 'female', born: number) => ({
      ...personGenerator.generate(
        { species, culture, sex },
        createContext({ world, seedPath: `history/canon/${label}`, now }),
      ),
      canonStatus: 'canon' as const,
      birth: {
        time: { trs: calendar.id, year: born, precision: 'year' as const },
      },
      memberOf: [{ model: 'faction', id: house.id, name: house.name }],
    });
    const lord = founder('lord', 'male', 970);
    const lady = founder('lady', 'female', 975);
    const canonDeath = eventSchema.parse({
      id: 'c0000000-0000-4000-8000-000000000005',
      world,
      name: `Death of ${lord.name}`,
      canonStatus: 'canon',
      recorded: { createdAt: now, updatedAt: now, revision: 1 },
      eventType: 'death',
      when: { begin: { trs: calendar.id, year: 1012 } },
      participants: [
        { actor: { model: 'person', id: lord.id }, role: 'deceased' },
      ],
    });
    const result = historyGenerator.generate(
      {
        ...input,
        founders: [lord, lady],
        canonEvents: [canonDeath],
        years: 60,
      },
      fctx,
    );
    const deaths = result.events.filter(
      (e) =>
        e.eventType === 'death' &&
        e.participants?.some(
          (p) => p.actor.id === lord.id && p.role === 'deceased',
        ),
    );
    expect(deaths.map((d) => d.when.begin?.year)).toEqual([1012]);
    expect(result.people.find((p) => p.id === lord.id)?.death?.time?.year).toBe(
      1012,
    );
    expect(result.findings).toEqual([]);
  });
});
