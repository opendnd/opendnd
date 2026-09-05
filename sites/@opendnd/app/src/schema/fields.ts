import type { JsonSchema, SchemaContext } from './openapi';

/**
 * What kind of control a value takes. Every kind the renderer understands
 * gets a control; anything else is `json`, an editor for the raw value, so
 * that no field the ontology can express is one the application cannot
 * author.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'reference'
  | 'list'
  | 'object'
  | 'json';

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** A property of a schema, described for a form and for an article. */
export interface Field {
  readonly name: string;
  /** Dotted from the resource root; empty for the root itself. */
  readonly path: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly description?: string;
  readonly default?: unknown;
  readonly options?: readonly Option[];
  /** For `list`: the shape of one item. */
  readonly item?: Field;
  /** For `object`: its properties, in schema order. */
  readonly fields?: readonly Field[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly schema: JsonSchema;
}

export interface DescribeOptions {
  readonly name?: string;
  readonly path?: string;
  readonly required?: boolean;
  readonly depth?: number;
}

/** Names whose text is prose, however short the schema lets it be. */
const PROSE = new Set([
  'description',
  'notes',
  'summary',
  'text',
  'body',
  'definition',
  'quote',
  'note',
]);

const MAX_DEPTH = 8;

export function describe(
  raw: JsonSchema,
  context: SchemaContext,
  options: DescribeOptions = {},
): Field {
  const schema = context.resolve(raw);
  const name = options.name ?? '';
  const path = options.path ?? '';
  const depth = options.depth ?? 0;
  const base = {
    name,
    path,
    label: schema.title ?? humanize(name),
    required: options.required ?? false,
    readOnly: schema.readOnly === true,
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.default !== undefined ? { default: schema.default } : {}),
    schema,
  };

  if (depth > MAX_DEPTH || schema.anyOf || schema.oneOf || schema.allOf) {
    return { ...base, kind: 'json' };
  }

  const type = typeOf(schema);

  if (schema.enum && schema.enum.every((v) => typeof v === 'string')) {
    const codes = schema.enum as readonly string[];
    const labels = context.labels(codes);
    return {
      ...base,
      kind: 'select',
      options: codes.map((code) => ({
        value: code,
        label: labels?.get(code) ?? humanize(code),
      })),
    };
  }

  switch (type) {
    case 'string':
      if (schema.format === 'uuid') return { ...base, kind: 'uuid' };
      if (schema.format === 'date-time') return { ...base, kind: 'datetime' };
      if (schema.format === 'date') return { ...base, kind: 'date' };
      return {
        ...base,
        kind:
          PROSE.has(name) || (schema.maxLength ?? 0) > 200
            ? 'textarea'
            : 'text',
      };
    case 'integer':
    case 'number':
      return {
        ...base,
        kind: type,
        ...(isFinite(schema.minimum) ? { minimum: schema.minimum } : {}),
        ...(isFinite(schema.maximum) ? { maximum: schema.maximum } : {}),
      };
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'array': {
      if (!schema.items) return { ...base, kind: 'json' };
      const item = describe(schema.items, context, {
        name: singular(name),
        path: `${path}[]`,
        required: true,
        depth: depth + 1,
      });
      return { ...base, kind: 'list', item };
    }
    case 'object': {
      if (isReferenceSchema(schema)) return { ...base, kind: 'reference' };
      const properties = schema.properties;
      if (!properties || Object.keys(properties).length === 0) {
        return { ...base, kind: 'json' };
      }
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(properties).map(([key, property]) =>
        describe(property, context, {
          name: key,
          path: path ? `${path}.${key}` : key,
          required: required.has(key),
          depth: depth + 1,
        }),
      );
      return { ...base, kind: 'object', fields };
    }
    default:
      return { ...base, kind: 'json' };
  }
}

/** Whether a schema is the ontology's `Reference`: a typed pointer to a resource. */
export function isReferenceSchema(schema: JsonSchema): boolean {
  const keys = Object.keys(schema.properties ?? {});
  const required = schema.required ?? [];
  return (
    keys.includes('model') &&
    keys.includes('id') &&
    required.includes('model') &&
    required.includes('id') &&
    keys.every((key) => key === 'model' || key === 'id' || key === 'name')
  );
}

/** `abilityScores` to `Ability scores`, `lawful-good` to `Lawful good`. */
export function humanize(name: string): string {
  if (!name) return '';
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function singular(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('ses') || name.endsWith('xes')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function typeOf(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== 'null');
  }
  if (typeof schema.type === 'string') return schema.type;
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
}

function isFinite(value: number | undefined): value is number {
  return value !== undefined && Math.abs(value) < Number.MAX_SAFE_INTEGER;
}
