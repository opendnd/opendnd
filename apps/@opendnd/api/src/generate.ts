import {
  type GeneratorContext,
  createContext,
  personGenerator,
  realmGenerator,
  settlementGenerator,
} from '@opendnd/generators';
import type { ModelId } from '@opendnd/types';
import type { Resource } from './store';

/**
 * Generation returns resources rather than a resource: asking for a place
 * produces the place, its population and its economy, because a settlement
 * that does not say how many people live in it is not a settlement.
 */
export type Generated = Record<string, unknown>[];

export class NoGeneratorError extends Error {
  constructor(model: string) {
    super(`nothing generates a ${model} yet`);
    this.name = 'NoGeneratorError';
  }
}

const LOCALITY = ['hamlet', 'village', 'town', 'city', 'metropolis'];

/**
 * Run the generator for a model.
 *
 * `place` dispatches on the tier asked for: the localities are settlements,
 * and the demesnes are whole realms of them with the houses and titles that
 * hold them, which is a different generator and many more resources.
 */
export function generate(
  model: ModelId,
  input: Record<string, unknown>,
  ctx: GeneratorContext,
): Generated {
  switch (model) {
    case 'person':
      return [personGenerator.generate(input as never, ctx)];
    case 'place': {
      const tier = String(input.tier ?? 'town');
      if (LOCALITY.includes(tier)) {
        const out = settlementGenerator.generate(input as never, ctx);
        return [out.place, out.population, out.economy];
      }
      const realm = realmGenerator.generate(input as never, ctx);
      return [
        ...realm.places,
        ...realm.factions,
        ...realm.titles,
        ...realm.populations,
        ...realm.economies,
      ];
    }
    default:
      throw new NoGeneratorError(model);
  }
}

export function canGenerate(model: ModelId): boolean {
  return model === 'person' || model === 'place';
}

/** A context for a generation request. */
export function contextFor(options: {
  readonly world: string;
  readonly seedPath?: string;
  readonly requestedBy?: string;
}): GeneratorContext {
  return createContext({
    world: options.world,
    seedPath: options.seedPath ?? crypto.randomUUID(),
    ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
  });
}

/**
 * Replace a reference to a resource with the resource itself.
 *
 * Generators take whole resources: a species with its chromosomes, a culture
 * with its name lists. A caller working inside a world would rather name them
 * by id than send them, so a field whose value is a uuid is loaded from the
 * world before the generator sees it.
 */
export async function resolveInputs(
  input: Record<string, unknown>,
  fields: readonly string[],
  load: (model: ModelId, id: string) => Promise<Resource | undefined>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...input };
  for (const field of fields) {
    const value = out[field];
    if (typeof value !== 'string' || !isUuid(value)) continue;
    const resource = await load(field as ModelId, value);
    if (resource === undefined) {
      throw new NoGeneratorError(
        `${field} ${value}, which is not in this world`,
      );
    }
    out[field] = resource;
  }
  return out;
}

/** Fields of a generator input that may be given as an id instead. */
export const REFERENCE_FIELDS = ['species', 'culture', 'calendar'] as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
