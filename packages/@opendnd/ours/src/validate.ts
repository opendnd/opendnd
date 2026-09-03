import { OursBundle } from './bundle';
import { JsonSchema } from './resources';

export interface ValidationIssue {
  readonly level: 'error' | 'warning';
  readonly resource: string;
  readonly message: string;
}

/**
 * Cross-resource checks that Zod cannot do on its own: every model's schema
 * resolves, every relationship target names a model, every `$ref` and
 * `x-ours-vocabulary` inside the schemas resolves, and ids are unique.
 */
export function validateBundle(bundle: OursBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (resource: string, message: string) =>
    issues.push({ level: 'error', resource, message });
  const warning = (resource: string, message: string) =>
    issues.push({ level: 'warning', resource, message });

  const modelNames = new Set<string>();
  const seenIds = new Set<string>();
  for (const model of bundle.models.values()) {
    modelNames.add(model.name);
    modelNames.add(model.id);
    if (seenIds.has(model.id)) {
      error(model.url, `Duplicate model id "${model.id}"`);
    }
    seenIds.add(model.id);
    if (!bundle.schemas.has(model.schema)) {
      error(model.url, `schema ${model.schema} is not in the bundle`);
    }
    if (!model.mapsTo || model.mapsTo.length === 0) {
      warning(model.url, 'model has no mapsTo alignment');
    }
  }
  for (const model of bundle.models.values()) {
    for (const rel of model.relationships ?? []) {
      if (!modelNames.has(rel.target)) {
        error(
          model.url,
          `relationship "${rel.predicate}" targets unknown model "${rel.target}"`,
        );
      }
    }
  }

  for (const vocabulary of bundle.vocabularies.values()) {
    if (seenIds.has(vocabulary.id)) {
      error(vocabulary.url, `Duplicate id "${vocabulary.id}"`);
    }
    seenIds.add(vocabulary.id);
    const codes = new Set<string>();
    for (const code of vocabulary.codes ?? []) {
      if (codes.has(code.code)) {
        error(vocabulary.url, `duplicate code "${code.code}"`);
      }
      codes.add(code.code);
    }
  }

  for (const [id, schema] of bundle.schemas) {
    walkSchema(schema, (node, path) => {
      if (node.$ref !== undefined && !resolvesRef(bundle, id, node.$ref)) {
        error(id, `${path}: $ref ${node.$ref} does not resolve`);
      }
      const vocab = node['x-ours-vocabulary'];
      if (vocab !== undefined) {
        const v = bundle.vocabularies.get(vocab);
        if (!v) {
          error(id, `${path}: x-ours-vocabulary ${vocab} is not in the bundle`);
        } else if (!v.codes || v.codes.length === 0) {
          error(id, `${path}: vocabulary ${vocab} has no inline codes`);
        }
      }
    });
  }

  return issues;
}

/** Depth-first walk over every sub-schema, with a JSON-pointer-ish path. */
export function walkSchema(
  schema: JsonSchema,
  visit: (node: JsonSchema, path: string) => void,
  path = '#',
): void {
  visit(schema, path);
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    walkSchema(def, visit, `${path}/$defs/${name}`);
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    walkSchema(prop, visit, `${path}/properties/${name}`);
  }
  if (schema.items) walkSchema(schema.items, visit, `${path}/items`);
  if (typeof schema.additionalProperties === 'object') {
    walkSchema(
      schema.additionalProperties,
      visit,
      `${path}/additionalProperties`,
    );
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    (schema[key] ?? []).forEach((sub, i) =>
      walkSchema(sub, visit, `${path}/${key}/${i}`),
    );
  }
}

/** Split a `$ref` into the document URL (or undefined for local) and pointer. */
export function splitRef(
  ref: string,
  currentDoc: string,
): { doc: string; pointer: string } {
  const hash = ref.indexOf('#');
  if (hash === -1) return { doc: ref, pointer: '' };
  const doc = ref.slice(0, hash);
  return { doc: doc === '' ? currentDoc : doc, pointer: ref.slice(hash + 1) };
}

function resolvesRef(bundle: OursBundle, currentDoc: string, ref: string) {
  const { doc, pointer } = splitRef(ref, currentDoc);
  const target = bundle.schemas.get(doc);
  if (!target) return false;
  if (pointer === '' || pointer === '/') return true;
  const m = /^\/\$defs\/([^/]+)$/.exec(pointer);
  if (!m) return false;
  return target.$defs !== undefined && m[1] in target.$defs;
}
