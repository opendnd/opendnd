import { describe, expect, it } from 'vitest';
import type { JsonSchema } from 'src/schema/openapi';
import {
  type Field,
  describe as describeSchema,
  humanize,
  isReferenceSchema,
} from 'src/schema/fields';
import { petOntology } from './fixtures/ontology';

function root(variant: 'input' | 'output' = 'output'): Field {
  const ontology = petOntology();
  return describeSchema(ontology.schema('pet', variant)!, ontology, {
    name: 'pet',
  });
}

function field(name: string, variant: 'input' | 'output' = 'output'): Field {
  const found = root(variant).fields?.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
}

describe('describing a schema as fields', () => {
  it('describes the root as an object with its properties in schema order', () => {
    const pet = root();
    expect(pet.kind).toBe('object');
    expect(pet.label).toBe('Pet');
    expect(pet.description).toBe('A companion animal.');
    expect(pet.fields?.slice(0, 5).map((f) => f.name)).toEqual([
      'id',
      'model',
      'world',
      'recorded',
      'name',
    ]);
  });

  it('marks what the server sets and what the schema requires', () => {
    expect(field('id')).toMatchObject({
      kind: 'uuid',
      readOnly: true,
      required: true,
    });
    expect(field('recorded').readOnly).toBe(true);
    expect(field('name')).toMatchObject({
      kind: 'text',
      required: true,
      readOnly: false,
    });
    expect(field('legs').required).toBe(false);
    expect(field('description').kind).toBe('textarea');
  });

  it('turns a code list into a choice with the vocabulary’s display text', () => {
    expect(field('mood')).toMatchObject({
      kind: 'select',
      required: true,
      description: 'How the pet feels.',
      options: [
        { value: 'happy', label: 'Happy' },
        { value: 'sad', label: 'Sad' },
      ],
    });
  });

  it('humanizes codes when no vocabulary can label them', () => {
    expect(field('colour').options).toEqual([
      { value: 'red-brown', label: 'Red brown' },
      { value: 'grey', label: 'Grey' },
    ]);
    // Shared by two vocabularies, so neither is trusted.
    expect(field('canonStatus').options?.[0]).toEqual({
      value: 'canon',
      label: 'Canon',
    });
  });

  it('recognises a reference and a list of them', () => {
    expect(field('owner').kind).toBe('reference');
    const friends = field('friends');
    expect(friends.kind).toBe('list');
    expect(friends.item).toMatchObject({
      kind: 'reference',
      label: 'Friend',
      path: 'friends[]',
    });
    expect(
      isReferenceSchema({
        type: 'object',
        properties: { model: {}, id: {}, extra: {} },
        required: ['model', 'id'],
      }),
    ).toBe(false);
  });

  it('describes numbers with their real bounds only', () => {
    expect(field('legs')).toMatchObject({ kind: 'integer', minimum: 0 });
    expect(field('legs').maximum).toBeUndefined();
    expect(field('weight').kind).toBe('number');
    expect(field('friendly').kind).toBe('boolean');
    expect(field('seen').kind).toBe('datetime');
  });

  it('describes a nested object and carries its defaults', () => {
    const born = field('born');
    expect(born.kind).toBe('object');
    expect(born.fields?.map((f) => f.name)).toEqual([
      'trs',
      'year',
      'precision',
    ]);
    expect(born.fields?.find((f) => f.name === 'precision')).toMatchObject({
      kind: 'select',
      required: true,
      default: 'year',
    });
    expect(field('perspective').default).toBe('in-universe');
  });

  it('singularises list item labels', () => {
    expect(field('tricks').item?.label).toBe('Trick');
    expect(field('tricks').item?.kind).toBe('text');
  });

  it('falls back to JSON for shapes it has no control for', () => {
    expect(field('extras').kind).toBe('json');
    expect(field('shape').kind).toBe('json');
  });

  it('follows a hoisted definition and stops recursing at a depth', () => {
    const choice = field('choice');
    expect(choice.kind).toBe('object');
    expect(choice.description).toBe('A nested choice.');
    let cursor: Field | undefined = choice;
    let depth = 0;
    while (cursor && cursor.kind === 'object') {
      cursor = cursor.fields?.find((f) => f.name === 'options')?.item;
      depth++;
    }
    expect(cursor?.kind).toBe('json');
    expect(depth).toBeGreaterThan(2);
    expect(depth).toBeLessThan(12);
  });

  it('describes the input variant without the server-set fields', () => {
    const names = root('input').fields?.map((f) => f.name) ?? [];
    expect(names).not.toContain('id');
    expect(names).toContain('name');
  });

  it('treats a nullable type as its non-null half', () => {
    const ontology = petOntology();
    const schema: JsonSchema = { type: ['string', 'null'] };
    expect(describeSchema(schema, ontology, { name: 'nickname' }).kind).toBe(
      'text',
    );
  });

  it('humanizes names', () => {
    expect(humanize('abilityScores')).toBe('Ability scores');
    expect(humanize('lawful-good')).toBe('Lawful good');
    expect(humanize('hitDiceSpent')).toBe('Hit dice spent');
    expect(humanize('')).toBe('');
  });
});

describe('references that name their models', () => {
  it('reads which models a reference may point at from the schema', () => {
    const ontology = petOntology();
    const input = describeSchema(
      ontology.model('pet')!.generate!.input,
      ontology,
      { name: 'generate' },
    );
    const owner = input.fields!.find((f) => f.name === 'owner')!;
    expect(owner.kind).toBe('reference');
    expect(owner.referenceModels).toEqual(['person']);
    // A plain Reference fixes nothing and may point anywhere.
    expect(field('owner').referenceModels).toBeUndefined();
  });
});
