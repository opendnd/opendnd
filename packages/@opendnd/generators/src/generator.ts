import { Rng, derivedId } from '@opendnd/random';
import type { Provenance, Recorded, ResourceBase } from '@opendnd/types';

/**
 * Everything a generator needs to run reproducibly.
 *
 * The seed path identifies this piece of work inside the world, for example
 * `dynasty/thorne/3`. The Rng is seeded from `world/seedPath` so the same
 * request in the same world always produces the same output, and
 * `derivedId(world, seedPath)` gives the output a stable identity.
 */
export interface GeneratorContext {
  /** The World the output belongs to. */
  readonly world: string;
  /** Path of this piece of work inside the world, e.g. `dynasty/thorne/3`. */
  readonly seedPath: string;
  readonly rng: Rng;
  /** Transaction time stamped on output, ISO 8601. Defaults to now. */
  readonly now?: string;
  /** User id credited in provenance, when a person asked for the generation. */
  readonly requestedBy?: string;
}

/**
 * The contract every generator implements, procedural or AI: typed input in,
 * typed output out, and a stable id and version that go into provenance so
 * any generated record can be traced to the code that made it.
 */
export interface Generator<Input, Output> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  generate(input: Input, ctx: GeneratorContext): Output;
}

/** Build a context whose Rng is seeded from the world and seed path. */
export function createContext(
  options: Omit<GeneratorContext, 'rng'>,
): GeneratorContext {
  return { ...options, rng: new Rng(`${options.world}/${options.seedPath}`) };
}

/** A context for a labelled sub-task: `seedPath/label`, with a matching child Rng. */
export function childContext(
  ctx: GeneratorContext,
  label: string,
): GeneratorContext {
  return {
    ...ctx,
    seedPath: `${ctx.seedPath}/${label}`,
    rng: ctx.rng.child(label),
  };
}

/**
 * The platform fields every generated resource carries: a reproducible id,
 * the derived id, canon status `generated`, transaction time and provenance.
 * Spread this into the resource before its own fields.
 */
export function stamp(
  generator: Pick<Generator<unknown, unknown>, 'id' | 'version'>,
  ctx: GeneratorContext,
  extra: Partial<Provenance> = {},
): Pick<
  ResourceBase,
  'id' | 'derivedId' | 'world' | 'canonStatus' | 'recorded' | 'provenance'
> {
  const now = ctx.now ?? new Date().toISOString();
  const recorded: Recorded = { createdAt: now, updatedAt: now, revision: 1 };
  return {
    id: ctx.rng.child('id').uuid(),
    derivedId: derivedId(ctx.world, ctx.seedPath),
    world: ctx.world,
    canonStatus: 'generated',
    recorded,
    provenance: {
      generatedBy: `${generator.id}@${generator.version}`,
      seed: ctx.seedPath,
      ...(ctx.requestedBy ? { attributedTo: ctx.requestedBy } : {}),
      ...extra,
    },
  };
}
