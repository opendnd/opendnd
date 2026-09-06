import { describe, expect, it } from 'vitest';
import { loadOntology } from 'src/schema/openapi';
import {
  petDocument,
  petModels,
  petOntology,
  petVocabularies,
} from './fixtures/ontology';

describe('the ontology as the API describes it', () => {
  it('has a stored shape and an input shape per model', () => {
    const ontology = petOntology();
    expect(ontology.schema('pet')?.properties).toHaveProperty('id');
    expect(ontology.schema('pet', 'input')?.properties).not.toHaveProperty(
      'id',
    );
    expect(ontology.schema('dragon')).toBeUndefined();
    expect(ontology.model('pet')).toMatchObject({ id: 'pet', name: 'Pet' });
  });

  it('calls a model by the name its manifest gives it, or a readable id', () => {
    const ontology = petOntology();
    expect(ontology.label('pet')).toBe('Pet');
    expect(ontology.label('hitDice')).toBe('Hit dice');
  });

  it('follows a reference into the components and keeps the referring words', () => {
    const ontology = petOntology();
    const resolved = ontology.resolve({
      $ref: '#/components/schemas/pet___schema0',
      description: 'A nested choice.',
    });
    expect(resolved.type).toBe('object');
    expect(resolved.properties).toHaveProperty('choose');
    expect(resolved.description).toBe('A nested choice.');
  });

  it('leaves a reference it cannot follow as what was written beside it', () => {
    expect(petOntology().resolve({ $ref: '#/elsewhere', title: 'X' })).toEqual({
      title: 'X',
    });
  });

  it('labels a code list by the one vocabulary with exactly those codes', () => {
    const ontology = petOntology();
    expect(ontology.labels(['sad', 'happy'])?.get('happy')).toBe('Happy');
    expect(ontology.vocabularyFor(['happy', 'sad'])?.id).toBe('mood');
    // A subset or a superset is a different list.
    expect(ontology.labels(['happy'])).toBeUndefined();
    expect(ontology.labels(['happy', 'sad', 'cross'])).toBeUndefined();
  });

  it('declines to label codes two vocabularies share', () => {
    expect(petOntology().labels(['canon', 'proposed'])).toBeUndefined();
  });

  it('loads from the three requests an API answers', async () => {
    const ontology = await loadOntology({
      models: async () => petModels,
      vocabularies: async () =>
        Object.fromEntries(petVocabularies.map((v) => [v.id, v])),
      openapi: async () => petDocument,
    });
    expect(ontology.models).toEqual(petModels);
    expect(ontology.schema('pet')).toBeDefined();
    expect(ontology.labels(['happy', 'sad'])?.get('sad')).toBe('Sad');
  });
});
