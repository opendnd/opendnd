import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ONTOLOGY_URL, OURS_DIR } from 'src';
import { loadOursDirectory, validateBundle } from '@opendnd/ours';

describe('@opendnd/ontology', () => {
  it('points at a bundle directory with a root file', () => {
    expect(existsSync(join(OURS_DIR, 'ontology.json'))).toBe(true);
  });

  it('loads and its root url matches the exported constant', () => {
    const bundle = loadOursDirectory(OURS_DIR);
    expect(bundle.ontology.url).toBe(ONTOLOGY_URL);
    expect(bundle.models.size).toBeGreaterThanOrEqual(9);
  });

  it('has no validation errors and every model has an alignment', () => {
    const issues = validateBundle(loadOursDirectory(OURS_DIR));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.filter((i) => i.message.includes('no mapsTo'))).toEqual([]);
  });

  it('every model schema extends ResourceBase', () => {
    const bundle = loadOursDirectory(OURS_DIR);
    for (const model of bundle.models.values()) {
      const schema = bundle.schemas.get(model.schema)!;
      // Relative to the schema's own $id, as JSON Schema resolves it.
      const refs = (schema.allOf ?? []).map((s) => s.$ref);
      expect(refs).toContain('common.schema.json#/$defs/ResourceBase');
    }
  });
});
