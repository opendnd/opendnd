import { describe, expect, it } from 'bun:test';
import { canonStatusCodes, models, personSchema, worldSchema } from 'src';

const recorded = {
  createdAt: '2026-09-03T12:00:00Z',
  updatedAt: '2026-09-03T12:00:00Z',
  revision: 1,
};
const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';

describe('@opendnd/types', () => {
  it('exposes every model in the registry', () => {
    expect(Object.keys(models).sort()).toEqual([
      'belief',
      'calendar',
      'claim',
      'culture',
      'economy',
      'event',
      'faction',
      'person',
      'place',
      'population',
      'relationship',
      'species',
      'tenure',
      'title',
      'work',
      'world',
    ]);
  });

  it('applies platform defaults from the base', () => {
    const w = worldSchema.parse({
      id: world,
      world,
      name: 'Aerath',
      canonStatus: 'canon',
      recorded,
    });
    expect(w.perspective).toBe('in-universe');
    expect(canonStatusCodes).toContain('generated');
  });

  it('rejects unknown properties and bad references', () => {
    const bad = personSchema.safeParse({
      id: world,
      world,
      name: 'Nobody',
      canonStatus: 'canon',
      recorded,
      residence: { model: 'place', id: 'not-a-uuid' },
      hairColour: 'red',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a person with birth in a calendar and a generated provenance', () => {
    const p = personSchema.parse({
      id: '0d8b9e0a-1f9a-4d70-9c0b-1f2a3b4c5d6e',
      world,
      name: 'Maelis of Thorne',
      canonStatus: 'generated',
      recorded,
      birth: { time: { trs: world, year: 1203, month: 4, precision: 'month' } },
      provenance: { generatedBy: 'person@1.0.0', seed: 'aerath/thorne/3' },
    });
    expect(p.status).toBe('alive');
    expect(p.birth?.time?.precision).toBe('month');
  });
});
