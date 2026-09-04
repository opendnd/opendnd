import { describe, expect, it } from 'bun:test';
import * as z from 'zod';
import {
  Models,
  StructuredError,
  extractJson,
  jsonSchemaOf,
  structured,
} from 'src';
import { FakeProvider, localModel } from './fakes';

const settlement = z.object({
  name: z.string().min(1),
  population: z.number().int().positive(),
  terrain: z.enum(['hills', 'forest', 'plains']),
});

function modelsFor(script: string[]): {
  models: Models;
  provider: FakeProvider;
} {
  const provider = new FakeProvider('local', script);
  return {
    provider,
    models: new Models({
      providers: [provider],
      models: [localModel],
      tasks: { author: 'test-local' },
    }),
  };
}

describe('structured', () => {
  it('sends the schema to the provider and returns a validated value', async () => {
    const { models, provider } = modelsFor([
      '{"name":"Thornehold","population":120,"terrain":"hills"}',
    ]);
    const result = await structured(models, 'author', {
      schema: settlement,
      name: 'settlement',
      messages: [{ role: 'user', content: 'A hamlet in the hills.' }],
    });

    expect(result.value).toEqual({
      name: 'Thornehold',
      population: 120,
      terrain: 'hills',
    });
    const sent = provider.calls[0].request.schema!;
    expect(sent.name).toBe('settlement');
    expect((sent.schema as any).required).toEqual([
      'name',
      'population',
      'terrain',
    ]);
    expect((sent.schema as any).additionalProperties).toBe(false);
  });

  it('digs the value out of prose and code fences', async () => {
    const { models } = modelsFor([
      'Certainly! Here is the record:\n\n```json\n' +
        '{"name":"Thornehold","population":120,"terrain":"hills"}\n```\n' +
        'Let me know if you need more.',
    ]);
    const result = await structured(models, 'author', {
      schema: settlement,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.value.name).toBe('Thornehold');
  });

  it('hands the validation errors back and accepts the corrected reply', async () => {
    const { models, provider } = modelsFor([
      '{"name":"Thornehold","population":-4,"terrain":"swamp"}',
      '{"name":"Thornehold","population":120,"terrain":"hills"}',
    ]);
    const result = await structured(models, 'author', {
      schema: settlement,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(result.value.population).toBe(120);
    expect(result.responses.length).toBe(2);
    // The second turn quotes the failure so the model can see what to fix.
    const repair = provider.calls[1].request.messages;
    expect(repair.length).toBe(3);
    expect(repair[1].role).toBe('assistant');
    expect(repair[2].content).toContain('population');
    expect(repair[2].content).toContain('terrain');
  });

  it('gives up after the repairs are spent, with every reply it saw', async () => {
    const { models } = modelsFor(['not json', 'still not json']);
    const error = await structured(models, 'author', {
      schema: settlement,
      messages: [{ role: 'user', content: 'x' }],
      repairAttempts: 1,
    }).catch((e: unknown) => e as StructuredError);

    expect(error).toBeInstanceOf(StructuredError);
    expect((error as StructuredError).responses.length).toBe(2);
    expect((error as StructuredError).message).toContain('no JSON value');
  });

  it('does not answer a repair from the cache that just failed', async () => {
    const { models, provider } = modelsFor([
      '{"name":"Thornehold","population":-4,"terrain":"hills"}',
      '{"name":"Thornehold","population":120,"terrain":"hills"}',
    ]);
    const result = await structured(models, 'author', {
      schema: settlement,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result.value.population).toBe(120);
    expect(provider.calls.length).toBe(2);
  });

  it('drops $schema, which some providers reject', () => {
    const json = jsonSchemaOf(settlement);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe('object');
  });
});

describe('extractJson', () => {
  it('finds an object, an array, or nothing', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('prose [1,2] more')).toBe('[1,2]');
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
  });

  it('is not fooled by braces and quotes inside strings', () => {
    const value = '{"name":"Cur\\"ly } Brace","of":{"deep":true}}';
    expect(extractJson(`here: ${value} done`)).toBe(value);
    expect(JSON.parse(extractJson(`x ${value}`)!)).toEqual({
      name: 'Cur"ly } Brace',
      of: { deep: true },
    });
  });

  it('stops at the end of the first value', () => {
    expect(extractJson('{"a":1} {"b":2}')).toBe('{"a":1}');
  });

  it('returns nothing for a value that was cut off', () => {
    expect(extractJson('{"a":1')).toBeUndefined();
  });
});
