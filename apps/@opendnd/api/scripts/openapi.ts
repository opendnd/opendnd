/**
 * Write the OpenAPI description into the docs site, where a viewer renders
 * it and where it is served raw. Generated rather than committed, so the
 * document can only ever say what the routes actually accept.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openApiDocument } from '../src/openapi';

const out = join(__dirname, '..', '..', '..', '..', 'docs', 'public');
mkdirSync(out, { recursive: true });
const document = openApiDocument({ url: 'https://api.opendnd.org' });
writeFileSync(
  join(out, 'openapi.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
console.log(`Wrote OpenAPI: ${Object.keys(document.paths).length} paths`);
