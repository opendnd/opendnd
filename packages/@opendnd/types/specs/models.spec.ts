import { describe, expect, it } from 'bun:test';
import { canonStatusCodes, models, characterSchema, worldSchema } from 'src';

const meta = { versionId: '1', lastUpdated: '2026-09-03T12:00:00Z' };
const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';

describe('@opendnd/types', () => {
  it('exposes every model in the registry', () => {
    expect(Object.keys(models).sort()).toEqual([
      'background',
      'belief',
      'calendar',
      'campaign',
      'character',
      'character-sheet',
      'class',
      'condition',
      'culture',
      'economy',
      'event',
      'faction',
      'feat',
      'feature',
      'item',
      'language',
      'place',
      'population',
      'proficiency',
      'project',
      'quest',
      'relationship',
      'scene',
      'session',
      'skill',
      'species',
      'spell',
      'statblock',
      'tenure',
      'title',
      'title-claim',
      'work',
      'world',
    ]);
  });

  it('marks play and preparation as out-of-universe, and the world as in it', () => {
    const base = {
      id: world,
      world,
      name: 'x',
      canonStatus: 'canon' as const,
      meta: { versionId: '1', lastUpdated: '2026-09-04T00:00:00Z' },
    };
    // A campaign, a session, a sheet and a scene are records about the world
    // rather than parts of it, and the ontology says so rather than leaving
    // every client to remember it.
    expect(
      models.campaign.parse({ ...base, status: 'running' }).perspective,
    ).toBe('out-of-universe');
    expect(
      models['character-sheet'].parse({
        ...base,
        character: { type: 'Character', id: world },
      }).perspective,
    ).toBe('out-of-universe');
    expect(
      models.scene.parse({
        ...base,
        location: { type: 'Place', id: world },
      }).perspective,
    ).toBe('out-of-universe');
    // A quest can be the world's own errand, so it keeps the base default.
    expect(models.quest.parse({ ...base, status: 'active' }).perspective).toBe(
      'in-universe',
    );
    expect(models.place.parse({ ...base, type: 'town' }).perspective).toBe(
      'in-universe',
    );
  });

  it('applies platform defaults from the base', () => {
    const w = worldSchema.parse({
      id: world,
      world,
      name: 'Aerath',
      canonStatus: 'canon',
      meta,
    });
    expect(w.perspective).toBe('in-universe');
    expect(canonStatusCodes).toContain('generated');
  });

  it('rejects unknown properties and bad references', () => {
    const bad = characterSchema.safeParse({
      id: world,
      world,
      name: 'Nobody',
      canonStatus: 'canon',
      meta,
      residence: { type: 'Place', id: 'not-a-uuid' },
      hairColour: 'red',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a person with birth in a calendar and a generated provenance', () => {
    const p = characterSchema.parse({
      id: '0d8b9e0a-1f9a-4d70-9c0b-1f2a3b4c5d6e',
      world,
      name: 'Maelis of Thorne',
      canonStatus: 'generated',
      meta,
      birth: { time: { trs: world, year: 1203, month: 4, precision: 'month' } },
      provenance: { generatedBy: 'person@1.0.0', seed: 'aerath/thorne/3' },
    });
    expect(p.status).toBe('alive');
    expect(p.birth?.time?.precision).toBe('month');
  });
});
