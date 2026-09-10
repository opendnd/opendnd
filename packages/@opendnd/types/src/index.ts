/**
 * @opendnd/types — TypeScript types and Zod schemas for every OpenDnD model.
 *
 * Everything under `generated/` is emitted by `@opendnd/ours` from the OURS
 * bundle in `@opendnd/ontology`. Do not edit it by hand: change the ontology
 * and run `bun run generate`. A test fails if the two drift apart.
 */
export * from './generated';

import { type ModelId, type Reference, resourceTypes } from './generated';

/**
 * A reference the schemas fix to one model, as a manifest's relationship
 * declares it: a tenure's holder is a `ReferenceTo<'person'>`.
 *
 * Named by model id, because that is what the ontology calls it, and typed
 * by resource type, because that is what travels on the wire.
 */
export type ReferenceTo<M extends ModelId = ModelId> = Omit<
  Reference,
  'type'
> & {
  readonly type: (typeof resourceTypes)[M];
};

const byType = new Map<string, ModelId>(
  Object.entries(resourceTypes).map(([id, type]) => [type, id as ModelId]),
);

/** The model a resource type belongs to: a `Place` is a `place`. */
export function modelIdOf(type: string): ModelId | undefined {
  return byType.get(type);
}
