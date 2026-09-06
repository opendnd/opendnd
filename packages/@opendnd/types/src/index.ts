/**
 * @opendnd/types — TypeScript types and Zod schemas for every OpenDnD model.
 *
 * Everything under `generated/` is emitted by `@opendnd/ours` from the OURS
 * bundle in `@opendnd/ontology`. Do not edit it by hand: change the ontology
 * and run `bun run generate`. A test fails if the two drift apart.
 */
export * from './generated';

import type { ModelId, Reference } from './generated';

/**
 * A reference the schemas fix to one model, as a manifest's relationship
 * declares it: a tenure's holder is a `ReferenceTo<'person'>`.
 */
export type ReferenceTo<M extends ModelId = ModelId> = Omit<
  Reference,
  'model'
> & {
  readonly model: M;
};
