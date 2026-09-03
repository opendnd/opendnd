/**
 * @opendnd/types — TypeScript types and Zod schemas for every OpenDnD model.
 *
 * Everything under `generated/` is emitted by `@opendnd/ours` from the OURS
 * bundle in `@opendnd/ontology`. Do not edit it by hand: change the ontology
 * and run `bun run generate`. A test fails if the two drift apart.
 */
export * from './generated';
