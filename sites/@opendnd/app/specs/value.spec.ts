import { describe, expect, it } from 'vitest';
import { describe as describeSchema } from 'src/schema/fields';
import {
  editable,
  initialValue,
  isEmpty,
  parseNumber,
  pathLabel,
  prune,
} from 'src/schema/value';
import { petOntology, storedPet } from './fixtures/ontology';

const ontology = petOntology();
const input = describeSchema(ontology.schema('pet', 'input')!, ontology, {
  name: 'pet',
});
const output = describeSchema(ontology.schema('pet')!, ontology, {
  name: 'pet',
});

describe('values for a form', () => {
  it('starts a new resource with its defaults and nothing else', () => {
    expect(initialValue(input)).toEqual({ perspective: 'in-universe' });
  });

  it('creates an optional object with its own defaults when asked', () => {
    const born = input.fields!.find((f) => f.name === 'born')!;
    expect(initialValue(born)).toEqual({ precision: 'year' });
  });

  it('starts a list empty', () => {
    expect(
      initialValue(input.fields!.find((f) => f.name === 'friends')!),
    ).toEqual([]);
  });

  it('prunes what an untouched form leaves behind and keeps real values', () => {
    expect(
      prune({
        name: 'Biscuit',
        description: '',
        legs: 0,
        friendly: false,
        tricks: [],
        born: { trs: '', precision: 'year' },
        home: {},
        friends: [{ model: 'pet', id: 'x' }, undefined],
        nothing: undefined,
      }),
    ).toEqual({
      name: 'Biscuit',
      legs: 0,
      friendly: false,
      born: { precision: 'year' },
      friends: [{ model: 'pet', id: 'x' }],
    });
    expect(prune({ a: '', b: {} })).toBeUndefined();
  });

  it('strips the fields the server sets before a resource is edited', () => {
    const edited = editable(storedPet, output);
    expect(edited).not.toHaveProperty('id');
    expect(edited).not.toHaveProperty('model');
    expect(edited).not.toHaveProperty('world');
    expect(edited).not.toHaveProperty('recorded');
    expect(edited.name).toBe('Biscuit');
    // Fields the schema does not know are kept, so an edit never loses them.
    expect(edited.unknownField).toEqual({ deep: [1, 2] });
  });

  it('parses numbers from text controls', () => {
    expect(parseNumber('4', true)).toBe(4);
    expect(parseNumber('4.7', true)).toBe(4);
    expect(parseNumber('4.7', false)).toBe(4.7);
    expect(parseNumber('', true)).toBeUndefined();
    expect(parseNumber('four', true)).toBeUndefined();
  });

  it('knows an empty value from a falsy one', () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
    expect(isEmpty('')).toBe(true);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty({})).toBe(true);
    expect(isEmpty(null)).toBe(true);
  });

  it('labels a path for people', () => {
    expect(pathLabel('friends[].name')).toBe('friends item › name');
  });
});
