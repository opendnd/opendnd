import type { Field } from './fields';

/**
 * A starting value for a field: an object with its defaults filled in, an
 * empty list, or nothing. Defaults nested inside optional objects are applied
 * when that object is created, not before, so an untouched optional object
 * stays absent rather than arriving as its defaults.
 */
export function initialValue(field: Field): unknown {
  switch (field.kind) {
    case 'object':
      return Object.fromEntries(
        (field.fields ?? [])
          .filter((child) => !child.readOnly)
          .map((child) => [child.name, initialFor(child)])
          .filter(([, value]) => value !== undefined),
      );
    case 'list':
      return [];
    default:
      return field.default;
  }
}

function initialFor(child: Field): unknown {
  if (child.default !== undefined) return child.default;
  if (child.kind === 'object' && child.required) return initialValue(child);
  return undefined;
}

/** Whether a value carries nothing worth sending. `0` and `false` are values. */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * The value with empty parts removed, recursively, so that a form's untouched
 * fields do not arrive as empty strings and empty objects that the schema
 * would refuse.
 */
export function prune<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return (items.length > 0 ? items : undefined) as T | undefined;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, prune(item)] as const)
      .filter(([, item]) => item !== undefined);
    return (entries.length > 0 ? Object.fromEntries(entries) : undefined) as
      T | undefined;
  }
  return isEmpty(value) ? undefined : value;
}

/** A resource without the fields the server sets, ready to be edited and sent back. */
export function editable(
  resource: Record<string, unknown>,
  root: Field,
): Record<string, unknown> {
  const readOnly = new Set(
    (root.fields ?? []).filter((f) => f.readOnly).map((f) => f.name),
  );
  return Object.fromEntries(
    Object.entries(resource).filter(([key]) => !readOnly.has(key)),
  );
}

/** A number from a text control, or nothing for text that is not one. */
export function parseNumber(
  text: string,
  integer: boolean,
): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return undefined;
  return integer ? Math.trunc(value) : value;
}

/** A path like `a.b[].c` split into its parts, for messages about a field. */
export function pathLabel(path: string): string {
  return path.replace(/\[\]/g, ' item').replace(/\./g, ' › ');
}
