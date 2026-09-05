/**
 * Publish the ontology into the docs site.
 *
 * OURS discovery starts from one well-known file, the ontology, and follows
 * its pointers to the models, vocabularies and mappings bundles. Those files
 * are written here at the paths their own `url` fields name, so fetching an
 * `$id` or a `url` from anywhere in the bundle resolves against the live site.
 * The reference pages are generated from the same bundle, so the human view
 * and the machine view cannot disagree.
 */
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type JsonSchema,
  loadOursDirectory,
  toPublishedBundles,
  validateBundle,
} from '@opendnd/ours';
import { OURS_DIR } from '../src';

const bundle = loadOursDirectory(OURS_DIR);
const errors = validateBundle(bundle).filter((i) => i.level === 'error');
if (errors.length > 0) {
  for (const e of errors) console.error(`${e.resource}: ${e.message}`);
  process.exit(1);
}

const docs = join(__dirname, '..', '..', '..', '..', 'docs');
const site = new URL(bundle.ontology.url).origin;
const oursDir = join(docs, 'public', 'ours');
mkdirSync(join(oursDir, 'schemas'), { recursive: true });
mkdirSync(join(docs, 'public', '.well-known'), { recursive: true });
const refDir = join(docs, 'src', 'content', 'docs', 'reference');
mkdirSync(refDir, { recursive: true });

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const published = toPublishedBundles(bundle);
writeFileSync(join(oursDir, 'ontology.json'), json(published.ontology));
writeFileSync(join(oursDir, 'models.json'), json(published.models));
writeFileSync(join(oursDir, 'vocabularies.json'), json(published.vocabularies));
// Mappings are FHIR StructureMaps with element-level rules. The ontology
// carries class-level alignment on each model's `mapsTo` and no element rules
// yet, so the mappings bundle is published empty rather than filled with
// hollow maps.
writeFileSync(
  join(oursDir, 'mappings.json'),
  json({ resourceType: 'Bundle', type: 'collection', total: 0, entry: [] }),
);
for (const file of readdirSync(join(OURS_DIR, 'schemas'))) {
  cpSync(join(OURS_DIR, 'schemas', file), join(oursDir, 'schemas', file));
}
// Discovery starts from the Ontology resource, so the well-known location
// serves that resource itself: a client that fetches it has the document
// OURS prescribes, with the URLs of the models, vocabularies and mappings
// bundles, and the resource's own `url` names the canonical copy.
writeFileSync(
  join(docs, 'public', '.well-known', 'ours.json'),
  json(published.ontology),
);

/*
 * Reference pages. Layers are a way of reading the ontology rather than a
 * property of it, so they live here; a model missing from this map fails the
 * publish rather than silently landing nowhere.
 */
const LAYERS: Record<
  string,
  { title: string; note: string; models: string[] }
> = {
  foundation: {
    title: 'Foundation',
    note: 'The frame: which universe a record belongs to, and how its time is counted.',
    models: ['world', 'calendar'],
  },
  world: {
    title: 'The world',
    note: 'In-universe by default. What the fiction contains, and the record of what happened in it.',
    models: [
      'species',
      'culture',
      'language',
      'person',
      'place',
      'faction',
      'title',
      'tenure',
      'relationship',
      'event',
      'population',
      'economy',
      'claim',
      'belief',
      'work',
    ],
  },
  play: {
    title: 'Play',
    note: 'Out-of-universe by default, except `quest`. What happens at a table is still an `event`.',
    models: ['campaign', 'session', 'character', 'quest', 'encounter'],
  },
  rules: {
    title: 'Rules',
    note: 'Shapes only; no content ships. Aligned to the 5e SRD API so content written for it converts mechanically.',
    models: [
      'item',
      'class',
      'feature',
      'background',
      'feat',
      'spell',
      'statblock',
      'condition',
      'skill',
      'proficiency',
    ],
  },
};
// The bundle keys models by URL; the layers name them by id.
const byId = new Map([...bundle.models.values()].map((m) => [m.id, m]));
const placed = new Set(Object.values(LAYERS).flatMap((l) => l.models));
for (const id of byId.keys()) {
  if (!placed.has(id))
    throw new Error(`model ${id} is in no layer; add it to LAYERS`);
}

const vocabById = new Map(
  [...bundle.vocabularies.values()].map((v) => [v.url, v]),
);
function typeOf(prop: JsonSchema): string {
  if (prop.$ref) {
    const name = String(prop.$ref).split('/').pop()!;
    return name === 'Reference' ? '→ reference' : name;
  }
  const vocab = prop['x-ours-vocabulary'] as string | undefined;
  if (vocab)
    return `[\`${vocabById.get(vocab)?.id ?? vocab}\`](/reference/vocabularies/#${vocabById.get(vocab)?.id})`;
  if (prop.enum)
    return (prop.enum as unknown[]).map((e) => `\`${String(e)}\``).join(' · ');
  const t = Array.isArray(prop.type)
    ? prop.type.join(' | ')
    : (prop.type as string | undefined);
  if (t === 'array') return `${typeOf((prop.items as JsonSchema) ?? {})}[]`;
  if (t === 'object')
    return prop.additionalProperties &&
      typeof prop.additionalProperties === 'object'
      ? `map of ${typeOf(prop.additionalProperties as JsonSchema)}`
      : 'object';
  if (prop.format) return `${t} (${prop.format})`;
  return t ?? 'any';
}
const esc = (s: string) => s.replace(/\|/g, '\\|');

const models: string[] = [
  '---',
  'title: Models',
  'description: Every model in the ontology, with its fields, generated from the published bundle.',
  '---',
  '',
  `Generated from the OURS bundle at [\`${bundle.ontology.url}\`](${bundle.ontology.url}). Every field is listed; \`*\` marks one the schema requires. Every model also carries the platform base: \`id\`, \`world\`, \`name\`, \`description\`, \`canonStatus\`, \`perspective\`, \`validTime\`, \`recorded\`, \`provenance\`, \`citations\`, \`tags\`, \`module\`.`,
  '',
];
for (const layer of Object.values(LAYERS)) {
  models.push(`## ${layer.title}`, '', layer.note, '');
  for (const id of layer.models) {
    const model = byId.get(id)!;
    const schema = bundle.schemas.get(model.schema)!;
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const aligns = (model.mapsTo ?? [])
      .map((m) => `[${m.schema.split('/').pop()}](${m.schema})`)
      .join(', ');
    models.push(
      `### \`${id}\``,
      '',
      `${model.description}${aligns ? ` Aligns to ${aligns}.` : ''}`,
      '',
    );
    const props = Object.entries(
      (schema.properties ?? {}) as Record<string, JsonSchema>,
    );
    if (props.length === 0) {
      models.push('No fields beyond the base.', '');
      continue;
    }
    models.push('| Field | Type | |', '|---|---|---|');
    for (const [name, prop] of props) {
      models.push(
        `| \`${name}\`${required.has(name) ? '\\*' : ''} | ${typeOf(prop)} | ${esc(String(prop.description ?? ''))} |`,
      );
    }
    models.push('');
  }
}
writeFileSync(join(refDir, 'models.md'), models.join('\n'));

const vocabs: string[] = [
  '---',
  'title: Vocabularies',
  'description: Every code list in the ontology, with the display text for each code.',
  '---',
  '',
  'Generated from the published bundle. A code is what a record stores; the display text is what a person reads. Both come from the ontology, so no client carries its own copy of the labels.',
  '',
];
for (const v of [...bundle.vocabularies.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
)) {
  vocabs.push(
    `## \`${v.id}\``,
    '',
    `${v.description ?? v.name} — ${v.codes?.length ?? 0} codes.`,
    '',
    '| Code | Display | |',
    '|---|---|---|',
    ...(v.codes ?? []).map(
      (c) =>
        `| \`${c.code}\` | ${c.display ?? ''} | ${esc(c.definition ?? '')} |`,
    ),
    '',
  );
}
writeFileSync(join(refDir, 'vocabularies.md'), vocabs.join('\n'));

writeFileSync(
  join(refDir, 'ontology.md'),
  [
    '---',
    'title: The published ontology',
    'description: Where the OURS bundle is served, and how to discover it.',
    '---',
    '',
    'The ontology is published the way [OURS](https://ours.dev) describes: one well-known file, then follow its pointers.',
    '',
    '| | |',
    '|---|---|',
    `| Ontology | [\`${bundle.ontology.url}\`](${bundle.ontology.url}) |`,
    `| Models | [\`${bundle.ontology.models}\`](${bundle.ontology.models}) |`,
    `| Vocabularies | [\`${bundle.ontology.vocabularies}\`](${bundle.ontology.vocabularies}) |`,
    `| Mappings | [\`${bundle.ontology.mappings}\`](${bundle.ontology.mappings}) — empty until element-level maps exist |`,
    `| Schemas | \`${site}/ours/schemas/{model}.schema.json\`, at the \`$id\` each schema declares |`,
    `| Well-known | [\`${site}/.well-known/ours.json\`](${site}/.well-known/ours.json) — the Ontology resource again, so a client fetching the conventional location has the document OURS prescribes |`,
    `| API | [\`${site}/openapi.json\`](${site}/openapi.json), rendered under [API reference](/api/) |`,
    '',
    '```bash',
    `curl ${bundle.ontology.url}`,
    '```',
    '',
    `${bundle.models.size} models, ${bundle.vocabularies.size} vocabularies, ${bundle.schemas.size} schema documents. Regenerated by \`bun run generate\`; the reference pages beside this one are built from the same files.`,
    '',
  ].join('\n'),
);
console.log(
  `Published ${bundle.models.size} models, ${bundle.vocabularies.size} vocabularies to ${oursDir}`,
);
