import { describe, expect, it } from 'bun:test';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { emitZodModule, loadOursDirectory } from 'src';

const FIXTURE = join(__dirname, 'fixtures', 'minimal');

describe('emitZodModule', () => {
  const bundle = loadOursDirectory(FIXTURE);
  const code = emitZodModule(bundle);

  it('is deterministic', () => {
    expect(emitZodModule(loadOursDirectory(FIXTURE))).toBe(code);
  });

  it('emits vocabularies, $defs and models in dependency order', () => {
    const order = [
      'moodCodes',
      'baseSchema',
      'referenceSchema',
      'petSchema',
    ].map((n) => code.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('flattens allOf, applies vocabularies, formats and nullability', () => {
    expect(code).toContain('mood: moodSchema.default("happy")');
    expect(code).toContain('id: z.uuid()');
    expect(code).toContain('legs: z.int().min(0).max(8)');
    expect(code).toContain('born: z.iso.date().nullable().optional()');
    expect(code).toContain('owner: referenceSchema.optional()');
    expect(code).toContain('export const models = {');
  });

  it('produces a module that Bun can import and whose schema validates data', async () => {
    // Inside the package so `zod` resolves from its node_modules.
    const dir = mkdtempSync(join(__dirname, '.tmp-emit-'));
    const file = join(dir, 'generated.ts');
    writeFileSync(file, code);
    let mod: Record<string, any>;
    try {
      mod = await import(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const ok = mod.petSchema.safeParse({
      id: '5f7b1a1e-3c58-4f61-9c19-2d1f7a0d9e11',
      name: 'Rex',
      legs: 4,
      born: null,
    });
    expect(ok.success).toBe(true);
    expect(ok.data.mood).toBe('happy');
    const bad = mod.petSchema.safeParse({ id: 'nope', name: 'Rex', legs: 4 });
    expect(bad.success).toBe(false);
  });
  it('emits a self-referential schema as a getter, which Zod resolves lazily', async () => {
    // A copy of the fixture with one recursive shape added: kin who have kin.
    const dir = mkdtempSync(join(__dirname, '.tmp-emit-'));
    try {
      cpSync(FIXTURE, dir, { recursive: true });
      const commonPath = join(dir, 'schemas', 'common.schema.json');
      const common = JSON.parse(readFileSync(commonPath, 'utf8'));
      common.$defs.Kin = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kin: { type: 'array', items: { $ref: '#/$defs/Kin' } },
        },
        required: ['name'],
        additionalProperties: false,
      };
      writeFileSync(commonPath, JSON.stringify(common));
      const petPath = join(dir, 'schemas', 'pet.schema.json');
      const pet = JSON.parse(readFileSync(petPath, 'utf8'));
      pet.properties.family = {
        $ref: 'https://example.test/ours/schemas/common.schema.json#/$defs/Kin',
      };
      writeFileSync(petPath, JSON.stringify(pet));

      const emitted = emitZodModule(loadOursDirectory(dir));
      // The back-reference is deferred; the forward one is not.
      expect(emitted).toContain('get kin() {');
      expect(emitted).toContain('family: kinSchema.optional()');

      const file = join(dir, 'generated.ts');
      writeFileSync(file, emitted);
      const mod: Record<string, any> = await import(file);
      const deep = mod.kinSchema.safeParse({
        name: 'Ociaman',
        kin: [{ name: 'Apiustu', kin: [{ name: 'Sesti' }] }],
      });
      expect(deep.success).toBe(true);
      const bad = mod.kinSchema.safeParse({
        name: 'Ociaman',
        kin: [{ kin: [] }],
      });
      expect(bad.success).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
