import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOursDirectory } from '@opendnd/ours';
import Ajv2020 from 'ajv/dist/2020';
import { OURS_DIR } from 'src';

/**
 * The schemas are published for other people's validators, not only for the
 * code generator. A JSON Schema library that follows draft 2020-12 to the
 * letter has to accept what the generator accepts, or a module author working
 * from the published URLs is validating against a different ontology.
 */
describe('the published schemas under a conformant validator', () => {
  const bundle = loadOursDirectory(OURS_DIR);
  const ajv = new Ajv2020({
    strict: true,
    // A bare `required` inside `anyOf` is how draft 2020-12 says "one of
    // these"; the heuristic that wants the property redeclared beside it is
    // not part of the specification.
    strictRequired: false,
    allErrors: true,
    // Formats are asserted by the code generator; here they only need to be
    // known so strict mode does not refuse them.
    formats: { uuid: true, uri: true, 'date-time': true, date: true },
  });
  // The two OURS annotations: which vocabulary a generated vocabulary schema
  // came from, and which properties a record's valid time is read from.
  ajv.addKeyword({ keyword: 'x-ours-vocabulary' });
  ajv.addKeyword({ keyword: 'x-ours-valid-time' });
  for (const schema of bundle.schemas.values()) ajv.addSchema(schema as never);

  // Instances the generators' tests already keep valid.
  const fixtures = join(
    __dirname,
    '..',
    '..',
    'generators',
    'specs',
    'fixtures',
  );
  const instance = (file: string) =>
    JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as Record<
      string,
      unknown
    >;
  const validator = (model: string) =>
    ajv.getSchema(
      `https://docs.opendnd.org/ours/schemas/${model}.schema.json`,
    )!;

  it('compiles every model schema in strict mode', () => {
    for (const model of bundle.models.values()) {
      expect(ajv.getSchema(model.schema)).toBeDefined();
    }
  });

  it('accepts a record carrying the base fields every record has', () => {
    for (const [model, file] of [
      ['species', 'human.species.json'],
      ['culture', 'culture.json'],
    ] as const) {
      const validate = validator(model);
      const ok = validate(instance(file));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  it('enforces the vocabularies, because they are bound by $ref and not by a keyword', () => {
    const validate = validator('species');
    expect(
      validate({ ...instance('human.species.json'), size: 'colossal' }),
    ).toBe(false);
    expect(validate.errors?.[0]?.keyword).toBe('enum');
  });

  it('still refuses a property no schema declares', () => {
    const validate = validator('species');
    expect(validate({ ...instance('human.species.json'), wings: 2 })).toBe(
      false,
    );
    expect(validate.errors?.[0]?.keyword).toBe('unevaluatedProperties');
  });
});
