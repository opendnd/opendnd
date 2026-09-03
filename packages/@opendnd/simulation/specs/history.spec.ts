import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, personGenerator } from '@opendnd/generators';
import {
  calendarSchema,
  cultureSchema,
  eventSchema,
  titleSchema,
  factionSchema,
  personSchema,
  placeSchema,
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
const recorded = { createdAt: now, updatedAt: now, revision: 1 };
const base = (id: string, name: string) => ({
  id,
  world,
  name,
  canonStatus: 'canon' as const,
  recorded,
});

const species = speciesSchema.parse(read('human.species.json'));
const culture = cultureSchema.parse(read('culture.json'));
const calendar = calendarSchema.parse({
  ...base('c0000000-0000-4000-8000-000000000001', 'Common Reckoning'),
  months: [{ name: 'Year', length: 360 }],
});
const settlement = placeSchema.parse({
  ...base('c0000000-0000-4000-8000-000000000002', 'Thornehold'),
  placeType: 'town',
});
const house = factionSchema.parse({
  ...base('c0000000-0000-4000-8000-000000000003', 'House Thorne'),
  factionType: 'dynasty',
  seat: { model: 'place', id: settlement.id },
});
const title = titleSchema.parse({
  ...base('c0000000-0000-4000-8000-000000000004', 'Lord of Thorne'),
  faction: { model: 'faction', id: house.id, name: house.name },
  successionLaw: 'male-preference',
  rank: 0,
});

const input: HistoryInput = {
  calendar,
  species,
  culture,
  settlement,
  house,
  titles: [title],
  initialPopulation: 400,
  startYear: 1000,
  years: 300,
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

  it('emits resources the ontology accepts', () => {
    for (const p of out.people) personSchema.parse(p);
    for (const e of out.events) eventSchema.parse(e);
    for (const r of out.relationships) relationshipSchema.parse(r);
    for (const t of out.tenures) tenureSchema.parse(t);
    for (const pop of out.populations) populationSchema.parse(pop);
    for (const p of out.people) {
      expect(p.canonStatus).toBe('generated');
      expect(p.provenance?.generatedBy).toMatch(/^(person|history)@/);
    }
  });

  it('spans generations and keeps the title continuously held', () => {
    expect(out.people.length).toBeGreaterThan(20);
    expect(out.events[0].eventType).toBe('founding');
    expect(out.events[0].when.begin?.year).toBe(1000);
    expect(
      out.events.some(
        (e) => e.eventType === 'coronation' && e.when.begin?.year === 1000,
      ),
    ).toBe(true);
    expect(out.tenures.length).toBeGreaterThanOrEqual(3);
    for (let year = 1000; year < 1300; year++) {
      const active = out.tenures.filter(
        (t) =>
          (t.validTime?.begin?.year ?? 0) <= year &&
          (t.validTime?.end?.year === undefined || t.validTime.end.year > year),
      );
      expect(active.length).toBeLessThanOrEqual(1);
    }
    const years = out.events.map((e) => e.when.begin?.year ?? 0);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    expect(out.populations[0].count).toBe(400);
    expect(out.populations[out.populations.length - 1].at.year).toBe(1300);
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

  it('honours an authored death as a fixed point', () => {
    const fctx = createContext({ world, seedPath: 'history/canon', now });
    const lord = {
      ...personGenerator.generate({ species, culture, sex: 'male' }, fctx),
      canonStatus: 'canon' as const,
      birth: { time: { trs: calendar.id, year: 970 } },
      memberOf: [{ model: 'faction', id: house.id }],
    };
    const lady = {
      ...personGenerator.generate(
        { species, culture, sex: 'female' },
        createContext({ world, seedPath: 'history/canon/lady', now }),
      ),
      canonStatus: 'canon' as const,
      birth: { time: { trs: calendar.id, year: 975 } },
      memberOf: [{ model: 'faction', id: house.id }],
    };
    const canonDeath = eventSchema.parse({
      ...base('c0000000-0000-4000-8000-000000000005', `Death of ${lord.name}`),
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
