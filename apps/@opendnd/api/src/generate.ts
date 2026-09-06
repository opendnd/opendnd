import {
  type GeneratorContext,
  createContext,
  personGenerator,
  realmGenerator,
  settlementGenerator,
} from '@opendnd/generators';
import { type ModelId, vocabularies } from '@opendnd/types';
import type { Resource } from './store';

/**
 * Generation returns resources rather than a resource: asking for a place
 * produces the place, its population and its economy, because a settlement
 * that does not say how many people live in it is not a settlement. Each
 * carries its `model`, since a bundle of several kinds is otherwise a list
 * of bodies with nothing to say which route saves them.
 */
export type Generated = Record<string, unknown>[];

export class NoGeneratorError extends Error {
  constructor(model: string) {
    super(`nothing generates a ${model} yet`);
    this.name = 'NoGeneratorError';
  }
}

const LOCALITY = ['hamlet', 'village', 'town', 'city', 'metropolis'];
const DEMESNE = ['county', 'duchy', 'kingdom'];

/**
 * The place tiers a caller with no account may generate. A settlement or a
 * county is a moment of processor time; a kingdom is seconds of it, which is
 * more than an anonymous request should be able to ask for.
 */
export const ANONYMOUS_TIERS: readonly string[] = [...LOCALITY, 'county'];

/** A JSON Schema, loosely: what a generator's input is described with. */
export type JsonSchema = Record<string, unknown>;

/** A generator as a client sees it: what it makes, and what it takes. */
export interface GeneratorDescription {
  readonly description: string;
  /** The request body, as JSON Schema, so a form can be built from it. */
  readonly input: JsonSchema;
}

/**
 * A pointer to one resource of a model, in the ontology's `Reference` shape.
 * The `model` is fixed to a constant, which is how a client learns which
 * model to offer without the API saying so in any other way. The API also
 * accepts a bare id here.
 */
export function reference(model: ModelId, description: string): JsonSchema {
  return {
    type: 'object',
    description,
    properties: {
      model: { const: model },
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
    },
    required: ['model', 'id'],
    additionalProperties: false,
  };
}

function codes(vocabulary: keyof typeof vocabularies): string[] {
  return vocabularies[vocabulary].codes.map((c) => c.code);
}

/**
 * What can be generated, and what each generator takes.
 *
 * Described as JSON Schema rather than in prose so a client can build the
 * form from it, the way it builds a resource's form from the ontology, and
 * so the OpenAPI description says what a request body is.
 */
export const GENERATORS: Partial<Record<ModelId, GeneratorDescription>> = {
  person: {
    description:
      'A whole person: a name from the culture, a genome and appearance from the species.',
    input: {
      type: 'object',
      properties: {
        species: reference('species', 'The species the person belongs to.'),
        culture: reference(
          'culture',
          'The culture whose naming the person follows.',
        ),
        sex: {
          type: 'string',
          enum: codes('sex'),
          description: 'Left out, a coin flip between male and female.',
        },
        name: {
          type: 'string',
          description: 'A name to use instead of generating one.',
        },
      },
      required: ['species', 'culture'],
      additionalProperties: false,
    },
  },
  place: {
    description:
      'A settlement with its population and economy, or a whole realm of settlements with the houses that hold them and the titles they carry.',
    input: {
      type: 'object',
      properties: {
        tier: {
          type: 'string',
          enum: [...LOCALITY, ...DEMESNE],
          description:
            'A locality is one settlement; a county, duchy or kingdom is a realm of them.',
        },
        species: reference('species', 'Who lives there.'),
        culture: reference(
          'culture',
          'Whose names the places and people take.',
        ),
        calendar: reference(
          'calendar',
          'The calendar the snapshot is dated in.',
        ),
        year: {
          type: 'integer',
          description: 'The in-world year the snapshot describes.',
        },
        name: {
          type: 'string',
          description: 'A name to use instead of generating one.',
        },
        terrain: {
          type: 'string',
          enum: codes('terrain'),
          description: 'Left out, drawn for the tier.',
        },
        population: {
          type: 'integer',
          minimum: 1,
          description: 'Left out, drawn from the range the tier allows.',
        },
      },
      required: ['tier', 'species', 'culture', 'calendar', 'year'],
      additionalProperties: false,
    },
  },
};

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
      return [tag('person', personGenerator.generate(input as never, ctx))];
    case 'place': {
      const tier = String(input.tier ?? 'town');
      if (LOCALITY.includes(tier)) {
        const out = settlementGenerator.generate(input as never, ctx);
        return [
          tag('place', out.place),
          tag('population', out.population),
          tag('economy', out.economy),
        ];
      }
      const realm = realmGenerator.generate(input as never, ctx);
      return [
        ...realm.places.map((r) => tag('place', r)),
        ...realm.factions.map((r) => tag('faction', r)),
        ...realm.titles.map((r) => tag('title', r)),
        ...realm.populations.map((r) => tag('population', r)),
        ...realm.economies.map((r) => tag('economy', r)),
      ];
    }
    default:
      throw new NoGeneratorError(model);
  }
}

function tag(model: ModelId, body: unknown): Record<string, unknown> {
  return { ...(body as Record<string, unknown>), model };
}

export function canGenerate(model: ModelId): boolean {
  return GENERATORS[model] !== undefined;
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
 * than send them, so a field holding an id, or a `Reference` to one, is
 * loaded from the world before the generator sees it.
 */
export async function resolveInputs(
  input: Record<string, unknown>,
  fields: readonly string[],
  load: (model: ModelId, id: string) => Promise<Resource | undefined>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...input };
  for (const field of fields) {
    const id = idOf(out[field]);
    if (id === undefined) continue;
    const resource = await load(field as ModelId, id);
    if (resource === undefined) {
      throw new NoGeneratorError(`${field} ${id}, which is not in this world`);
    }
    out[field] = resource;
  }
  return out;
}

/** Fields of a generator input that may be given as an id or a reference instead. */
export const REFERENCE_FIELDS = ['species', 'culture', 'calendar'] as const;

/** The id a field names: a uuid string, or the `id` of a `Reference`. */
export function idOf(value: unknown): string | undefined {
  if (typeof value === 'string') return isUuid(value) ? value : undefined;
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && isUuid(id)) return id;
  }
  return undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
