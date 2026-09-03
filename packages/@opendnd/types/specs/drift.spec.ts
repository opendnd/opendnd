import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OURS_DIR } from '@opendnd/ontology';
import { emitZodModule, loadOursDirectory } from '@opendnd/ours';

describe('generated types', () => {
  it('match the OURS bundle (run `bun run generate` if this fails)', () => {
    const onDisk = readFileSync(
      join(__dirname, '..', 'src', 'generated', 'index.ts'),
      'utf8',
    );
    expect(onDisk).toBe(emitZodModule(loadOursDirectory(OURS_DIR)));
  });
});
