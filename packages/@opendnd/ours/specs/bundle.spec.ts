import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadOursDirectory, toPublishedBundles, validateBundle } from 'src';

const FIXTURE = join(__dirname, 'fixtures', 'minimal');

describe('loadOursDirectory', () => {
  it('loads the ontology root, models, vocabularies and schemas', () => {
    const bundle = loadOursDirectory(FIXTURE);
    expect(bundle.ontology.id).toBe('fixture');
    expect([...bundle.models.keys()]).toEqual([
      'https://example.test/ours/models/pet.json',
    ]);
    expect(bundle.vocabularies.size).toBe(1);
    // The two authored schemas, and the one derived from the vocabulary.
    expect(bundle.schemas.size).toBe(3);
    expect(
      bundle.schemas.get(
        'https://example.test/ours/vocabularies/mood.schema.json',
      ),
    ).toMatchObject({ type: 'string', enum: ['happy', 'sad'] });
  });

  it('publishes FHIR-style collection bundles', () => {
    const published = toPublishedBundles(loadOursDirectory(FIXTURE));
    expect(published.models.resourceType).toBe('Bundle');
    expect(published.models.entry[0].fullUrl).toBe(
      'https://example.test/ours/models/pet.json',
    );
  });
});

describe('validateBundle', () => {
  it('passes the fixture', () => {
    const issues = validateBundle(loadOursDirectory(FIXTURE));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('reports a model whose schema is missing', () => {
    const bundle = loadOursDirectory(FIXTURE);
    const models = new Map(bundle.models);
    const pet = models.get('https://example.test/ours/models/pet.json')!;
    models.set(pet.url, { ...pet, schema: 'https://example.test/nope.json' });
    const issues = validateBundle({ ...bundle, models });
    expect(issues.some((i) => i.message.includes('not in the bundle'))).toBe(
      true,
    );
  });

  it('reports a dangling $ref inside a schema', () => {
    const bundle = loadOursDirectory(FIXTURE);
    const schemas = new Map(bundle.schemas);
    schemas.set('https://example.test/ours/schemas/broken.schema.json', {
      $id: 'https://example.test/ours/schemas/broken.schema.json',
      type: 'object',
      properties: { x: { $ref: '#/$defs/Missing' } },
    });
    const issues = validateBundle({ ...bundle, schemas });
    expect(issues.some((i) => i.message.includes('does not resolve'))).toBe(
      true,
    );
  });

  it('reports a relationship whose predicate is not a Reference-typed property', () => {
    const bundle = loadOursDirectory(FIXTURE);
    const models = new Map(bundle.models);
    const pet = models.get('https://example.test/ours/models/pet.json')!;
    models.set(pet.url, {
      ...pet,
      relationships: [{ predicate: 'legs', target: 'Pet' }],
    });
    const issues = validateBundle({ ...bundle, models });
    expect(
      issues.some((i) =>
        i.message.includes('is not a Reference-typed property'),
      ),
    ).toBe(true);
  });

  it('reports a valid-time path that does not lead to a TemporalPosition', () => {
    const bundle = loadOursDirectory(FIXTURE);
    const schemas = new Map(bundle.schemas);
    const url = 'https://example.test/ours/schemas/pet.schema.json';
    schemas.set(url, {
      ...schemas.get(url)!,
      'x-ours-valid-time': { begin: 'legs' },
    });
    const issues = validateBundle({ ...bundle, schemas });
    expect(
      issues.some((i) => i.message.includes('not a TemporalPosition property')),
    ).toBe(true);
  });
});
