import { OursBundle } from './bundle';
import { JsonSchema } from './resources';

export interface ValidationIssue {
  readonly level: 'error' | 'warning';
  readonly resource: string;
  readonly message: string;
}

/**
 * Cross-resource checks that Zod cannot do on its own: every model's schema
 * resolves, every relationship names a model and a Reference-typed property,
 * every `$ref` inside the schemas resolves (vocabulary schemas included), and
 * ids are unique.
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
    const schema = bundle.schemas.get(model.schema);
    for (const rel of model.relationships ?? []) {
      if (!modelNames.has(rel.target)) {
        error(
          model.url,
          `relationship "${rel.predicate}" targets unknown model "${rel.target}"`,
        );
      }
      // A relationship is a claim about the schema, so it has to be true of
      // the schema: the predicate must be a property holding a Reference.
      if (
        schema &&
        !isReferencePath(bundle, schema, model.schema, rel.predicate)
      ) {
        error(
          model.url,
          `relationship "${rel.predicate}" is not a Reference-typed property of the schema`,
        );
      }
    }
    for (const [bound, path] of Object.entries(model.validTime ?? {})) {
      const leaf = schema && propertyAt(bundle, schema, model.schema, path);
      if (!leaf || !/\/TemporalPosition$/.test(leaf.$ref ?? '')) {
        error(
          model.url,
          `validTime.${bound} names ${path}, which is not a TemporalPosition property of the schema`,
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

/**
 * The schema of a property named by a dotted path, unresolved, so the caller
 * can see what it refers to. Arrays are looked through, and properties a
 * schema inherits through `allOf` count as its own.
 */
export function propertyAt(
  bundle: OursBundle,
  schema: JsonSchema,
  doc: string,
  path: string,
): JsonSchema | undefined {
  let node: JsonSchema | undefined = schema;
  let nodeDoc = doc;
  for (const segment of path.split('.')) {
    const here = deref(bundle, node, nodeDoc);
    if (!here) return undefined;
    const inner = here.node.items
      ? deref(bundle, here.node.items, here.doc)
      : here;
    if (!inner) return undefined;
    node = allProperties(bundle, inner.node, inner.doc)[segment];
    nodeDoc = inner.doc;
    if (!node) return undefined;
  }
  return node;
}

function isReferencePath(
  bundle: OursBundle,
  schema: JsonSchema,
  doc: string,
  path: string,
): boolean {
  const leaf = propertyAt(bundle, schema, doc, path);
  const target = leaf?.items ?? leaf;
  return /\/Reference$/.test(target?.$ref ?? '');
}

/** Own properties plus those of every `allOf` part, nearest last. */
function allProperties(
  bundle: OursBundle,
  schema: JsonSchema,
  doc: string,
): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const part of schema.allOf ?? []) {
    const resolved = deref(bundle, part, doc);
    if (resolved) {
      Object.assign(out, allProperties(bundle, resolved.node, resolved.doc));
    }
  }
  Object.assign(out, schema.properties ?? {});
  return out;
}

/** Follow one `$ref`, or return the node as it is. */
function deref(
  bundle: OursBundle,
  node: JsonSchema,
  doc: string,
): { node: JsonSchema; doc: string } | undefined {
  if (node.$ref === undefined) return { node, doc };
  const { doc: targetDoc, pointer } = splitRef(node.$ref, doc);
  const target = bundle.schemas.get(targetDoc);
  if (!target) return undefined;
  if (pointer === '' || pointer === '/') {
    return { node: target, doc: targetDoc };
  }
  const m = /^\/\$defs\/([^/]+)$/.exec(pointer);
  const def = m && target.$defs?.[m[1]];
  return def ? { node: def, doc: targetDoc } : undefined;
}

/**
 * Split a `$ref` into the document URL and the pointer inside it. A relative
 * document, `common.schema.json` or `../vocabularies/sex.schema.json`, is
 * resolved against the document the reference appears in, as JSON Schema
 * resolves it against that document's `$id`.
 */
export function splitRef(
  ref: string,
  currentDoc: string,
): { doc: string; pointer: string } {
  const hash = ref.indexOf('#');
  const document = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  return {
    doc: document === '' ? currentDoc : resolveUrl(document, currentDoc),
    pointer,
  };
}

function resolveUrl(reference: string, base: string): string {
  try {
    return new URL(reference, base).href;
  } catch {
    return reference;
  }
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
