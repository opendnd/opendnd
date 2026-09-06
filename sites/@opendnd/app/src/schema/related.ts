import { type Field, describe, humanize } from './fields';
import type { Ontology } from './openapi';
import { isReference } from '../api/types';

/**
 * A way to make a new record that is linked to an existing one: the new
 * record points at it, it points at the new record, or both.
 */
export interface RelatedAction {
  /** The model of the record to make. */
  readonly target: string;
  readonly label: string;
  /** What the link will do, in words. */
  readonly description: string;
  /** A field of the new record that will point at the existing one. */
  readonly set?: string;
  /** A field of the existing record that will point at the new one, once made. */
  readonly link?: string;
}

interface Pointer {
  readonly field: Field;
  readonly list: boolean;
}

/**
 * What can be made from a record of `model`, read from the schemas alone.
 *
 * For every model, the reference fields at its top that the schema fixes to
 * `model` are ways in, and the reference fields at the top of `model` fixed to
 * it are ways out. One way in and one way out become one action that does
 * both; more than one of either becomes one action per field, named for it.
 * Fields that may point at anything are left alone: they would put every
 * model on every page.
 */
export function relatedActions(
  ontology: Ontology,
  model: string,
): RelatedAction[] {
  const own = rootOf(ontology, model);
  const here = ontology.label(model).toLowerCase();
  const actions: RelatedAction[] = [];
  for (const info of ontology.models) {
    // A world is made on the worlds page, not inside another world.
    if (info.id === 'world') continue;
    const root = rootOf(ontology, info.id);
    if (!root) continue;
    const incoming = pointersTo(root, model);
    // A model that points at itself offers each field once: the new record
    // points at this one, which is the direction a page can fill in.
    const outgoing = own && info.id !== model ? pointersTo(own, info.id) : [];
    if (incoming.length === 0 && outgoing.length === 0) continue;
    const label = ontology.label(info.id);
    if (incoming.length <= 1 && outgoing.length <= 1) {
      actions.push(action(label, info.id, here, incoming[0], outgoing[0]));
      continue;
    }
    for (const pointer of incoming) {
      actions.push(
        action(
          `${label} · ${pointer.field.label.toLowerCase()}`,
          info.id,
          here,
          pointer,
        ),
      );
    }
    for (const pointer of outgoing) {
      actions.push(
        action(
          `${label} · ${pointer.field.label.toLowerCase()}`,
          info.id,
          here,
          undefined,
          pointer,
        ),
      );
    }
  }
  return actions.sort((a, b) => a.label.localeCompare(b.label));
}

function action(
  label: string,
  target: string,
  here: string,
  set?: Pointer,
  link?: Pointer,
): RelatedAction {
  const parts: string[] = [];
  if (set) {
    parts.push(
      set.list
        ? `Its ${set.field.label.toLowerCase()} will include this ${here}.`
        : `Its ${set.field.label.toLowerCase()} will be this ${here}.`,
    );
  }
  if (link) {
    parts.push(
      link.list
        ? `It will be added to this ${here}'s ${link.field.label.toLowerCase()}.`
        : `It will become this ${here}'s ${link.field.label.toLowerCase()}.`,
    );
  }
  return {
    target,
    label,
    description: parts.join(' '),
    ...(set ? { set: set.field.name } : {}),
    ...(link ? { link: link.field.name } : {}),
  };
}

/** The writable reference fields at the top of `root` that the schema fixes to `model`. */
function pointersTo(root: Field, model: string): Pointer[] {
  const pointers: Pointer[] = [];
  for (const field of root.fields ?? []) {
    if (field.readOnly) continue;
    if (
      field.kind === 'reference' &&
      field.referenceModels?.includes(model) === true
    ) {
      pointers.push({ field, list: false });
    } else if (
      field.kind === 'list' &&
      field.item?.kind === 'reference' &&
      field.item.referenceModels?.includes(model) === true
    ) {
      pointers.push({ field, list: true });
    }
  }
  return pointers;
}

/** A model's input shape as fields, or nothing for a model the ontology lacks. */
export function rootOf(ontology: Ontology, model: string): Field | undefined {
  const schema = ontology.schema(model, 'input');
  return schema ? describe(schema, ontology, { name: model }) : undefined;
}

/** The top-level fields of `resource` under which a reference to `id` sits. */
export function referringFields(
  resource: Record<string, unknown>,
  id: string,
): string[] {
  return Object.entries(resource)
    .filter(([, value]) => holds(value, id))
    .map(([key]) => key);
}

function holds(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => holds(item, id));
  if (isReference(value)) return value.id === id;
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => holds(item, id));
  }
  return false;
}

/** The first date a record carries at its top, as something a list can sort by. */
export function dateOf(
  resource: Record<string, unknown>,
  root: Field | undefined,
): { label: string; value: string; kind: 'date' | 'datetime' } | undefined {
  for (const field of root?.fields ?? []) {
    if (field.readOnly) continue;
    if (field.kind !== 'date' && field.kind !== 'datetime') continue;
    const value = resource[field.name];
    if (typeof value === 'string' && value !== '') {
      return { label: field.label, value, kind: field.kind };
    }
  }
  return undefined;
}

/** A field's label by name, from a root, or the name made readable. */
export function labelOf(root: Field | undefined, name: string): string {
  return root?.fields?.find((f) => f.name === name)?.label ?? humanize(name);
}
