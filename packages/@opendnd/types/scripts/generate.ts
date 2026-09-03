/**
 * Regenerate src/generated/index.ts from the OURS bundle in @opendnd/ontology.
 *
 * Depends on the built @opendnd/ours and @opendnd/ontology packages; run
 * `bun run generate` at the repo root so turbo builds them first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OURS_DIR } from '@opendnd/ontology';
import {
  emitZodModule,
  loadOursDirectory,
  validateBundle,
} from '@opendnd/ours';

const bundle = loadOursDirectory(OURS_DIR);
const errors = validateBundle(bundle).filter((i) => i.level === 'error');
if (errors.length > 0) {
  for (const e of errors) console.error(`${e.resource}: ${e.message}`);
  process.exit(1);
}

const outDir = join(__dirname, '..', 'src', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.ts'), emitZodModule(bundle));
console.log(`Generated ${bundle.models.size} models into ${outDir}`);
