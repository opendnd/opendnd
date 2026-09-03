import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  JsonSchema,
  Model,
  Ontology,
  Vocabulary,
  bundleSchema,
  modelSchema,
  ontologySchema,
  vocabularySchema,
} from './resources';

/**
 * An OURS ontology loaded into memory: the root, every model and vocabulary,
 * and every JSON Schema document the models point at, all keyed by URL.
 */
export interface OursBundle {
  readonly ontology: Ontology;
  readonly models: ReadonlyMap<string, Model>;
  readonly vocabularies: ReadonlyMap<string, Vocabulary>;
  readonly schemas: ReadonlyMap<string, JsonSchema>;
}

/**
 * Directory layout expected by {@link loadOursDirectory}:
 *
 * ```
 * ontology.json
 * models/*.json         Model resources (or Bundles of them)
 * vocabularies/*.json   Vocabulary resources (or Bundles of them)
 * schemas/*.json        JSON Schema documents, keyed by their `$id`
 * ```
 */
export function loadOursDirectory(dir: string): OursBundle {
  const ontology = ontologySchema.parse(readJson(join(dir, 'ontology.json')));

  const models = new Map<string, Model>();
  for (const resource of readResources(join(dir, 'models'))) {
    const model = modelSchema.parse(resource);
    if (models.has(model.url)) {
      throw new Error(`Duplicate model url ${model.url}`);
    }
    models.set(model.url, model);
  }

  const vocabularies = new Map<string, Vocabulary>();
  for (const resource of readResources(join(dir, 'vocabularies'))) {
    const vocabulary = vocabularySchema.parse(resource);
    if (vocabularies.has(vocabulary.url)) {
      throw new Error(`Duplicate vocabulary url ${vocabulary.url}`);
    }
    vocabularies.set(vocabulary.url, vocabulary);
  }

  const schemas = new Map<string, JsonSchema>();
  for (const file of listJsonFiles(join(dir, 'schemas'))) {
    const schema = readJson(file) as JsonSchema;
    if (typeof schema.$id !== 'string') {
      throw new Error(`Schema ${file} has no $id`);
    }
    if (schemas.has(schema.$id)) {
      throw new Error(`Duplicate schema $id ${schema.$id}`);
    }
    schemas.set(schema.$id, schema);
  }

  return { ontology, models, vocabularies, schemas };
}

/**
 * Render the bundle as the three FHIR-style collection Bundles OURS publishes,
 * ready to be written to the URLs the ontology root points at.
 */
export function toPublishedBundles(bundle: OursBundle) {
  const collect = (resources: Iterable<Model | Vocabulary>) =>
    bundleSchema.parse({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [...resources]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((resource) => ({ fullUrl: resource.url, resource })),
    });
  return {
    ontology: bundle.ontology,
    models: collect(bundle.models.values()),
    vocabularies: collect(bundle.vocabularies.values()),
  };
}

function readResources(dir: string): unknown[] {
  const out: unknown[] = [];
  for (const file of listJsonFiles(dir)) {
    const json = readJson(file) as { resourceType?: string };
    if (json.resourceType === 'Bundle') {
      for (const entry of bundleSchema.parse(json).entry) {
        out.push(entry.resource);
      }
    } else {
      out.push(json);
    }
  }
  return out;
}

function listJsonFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile())
    .sort();
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}
