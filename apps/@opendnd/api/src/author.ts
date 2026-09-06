import {
  type ArticleInput,
  type GeneratorContext,
  articleAuthor,
} from '@opendnd/generators';
import type { Models, UsageRecord } from '@opendnd/llm';
import type { ModelId, Reference } from '@opendnd/types';
import type { JsonSchema } from './generate';
import { NotFoundError, type Resource, type Store } from './store';

/**
 * Writing about a record, as a client sees it: what it does and what a
 * request takes, as JSON Schema, so a form can be built from it the way one
 * is built for a generator.
 */
export const AUTHOR = {
  description:
    'Ask a language model to write about this record from the facts on file: an article about the world, or a chronicle from inside it. The model may say nothing the record does not support. Nothing is saved until asked.',
  input: {
    type: 'object',
    properties: {
      workType: {
        type: 'string',
        enum: ['article', 'chronicle'],
        default: 'article',
        description:
          'An article is written about the world; a chronicle from inside it.',
      },
      words: {
        type: 'integer',
        minimum: 50,
        maximum: 2000,
        default: 250,
        description: 'Roughly how long.',
      },
      language: {
        type: 'string',
        default: 'en',
        description: 'A BCP 47 language tag.',
      },
      model: {
        type: 'string',
        description:
          'The language model to write with, by id as /v1/llm lists them. Left out, the task’s configured model is used, or the deployment’s default.',
      },
      save: {
        type: 'boolean',
        default: false,
        description:
          'Keep the work at once. Left false, it is returned to read first.',
      },
    },
    additionalProperties: false,
  } satisfies JsonSchema,
};

export interface AuthorRequest {
  readonly workType?: 'article' | 'chronicle';
  readonly words?: number;
  readonly language?: string;
  readonly model?: string;
  readonly save?: boolean;
}

/** What a call cost, for the response to show. */
export interface Spend {
  readonly model: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly chargeMicros: number;
  readonly cached: boolean;
}

export interface AuthorResult {
  /** The work, carrying its `model`, so it can be imported as it is. */
  readonly work: Record<string, unknown>;
  readonly saved: boolean;
  readonly spend?: Spend;
  /** What the model was given to work from. */
  readonly facts: readonly string[];
}

export interface AuthorOptions {
  readonly models: Models;
  readonly context: (seedPath: string) => GeneratorContext;
  /** What to call a model, e.g. `person` becomes `Person`. */
  readonly label: (model: ModelId) => string;
  /** Where the ledger left the last usage line. */
  readonly spend: () => UsageRecord | undefined;
}

/**
 * Write about one record.
 *
 * Everything the model is allowed to say is gathered here first: the
 * record's own fields, and every record in the world that refers to it, with
 * its year where it has one. Those become the facts the author is held to,
 * and the records they came from go into the work's provenance.
 */
export async function authorAbout(
  store: Store,
  scope: { model: ModelId; id: string },
  request: AuthorRequest,
  options: AuthorOptions,
): Promise<AuthorResult> {
  const subject = await store.get(scope.model, scope.id);
  if (!subject) throw new NotFoundError(scope.model, scope.id);

  const { facts, sources } = await factsAbout(
    store,
    scope.model,
    subject,
    options.label,
  );
  const title = typeof subject.name === 'string' ? subject.name : scope.id;
  const input: ArticleInput = {
    subject: { model: scope.model, id: scope.id, name: title },
    title,
    facts,
    sources,
    ...(request.workType ? { workType: request.workType } : {}),
    ...(request.words !== undefined ? { words: request.words } : {}),
    ...(request.language ? { language: request.language } : {}),
  };
  const work = await articleAuthor.author(input, {
    ...options.context(`work/${scope.model}/${scope.id}/${Date.now()}`),
    models: options.models,
    ...(request.model ? { model: request.model } : {}),
  });

  const tagged: Record<string, unknown> = { ...work, model: 'work' };
  const saved = request.save === true;
  const stored = saved ? await store.put('work', work.id, tagged) : tagged;
  const line = options.spend();
  return {
    work: stored,
    saved,
    facts,
    ...(line
      ? {
          spend: {
            model: line.model,
            provider: line.provider,
            inputTokens: line.usage.inputTokens,
            outputTokens: line.usage.outputTokens,
            costMicros: line.costMicros,
            chargeMicros: line.chargeMicros,
            cached: line.cached,
          },
        }
      : {}),
  };
}

/** Fields that are about the record rather than the thing, and say nothing worth writing. */
const PLATFORM: ReadonlySet<string> = new Set([
  'id',
  'model',
  'world',
  'module',
  'name',
  'description',
  'recorded',
  'provenance',
  'canonStatus',
  'perspective',
  'derivedId',
  'citations',
]);

const MOST_RELATED = 60;
const MOST_LISTED = 12;

/**
 * Statements about a record, as a model may be told them.
 *
 * The record's primitive fields and its references become one line each; an
 * object field is passed over unless it plainly carries a year. Then every
 * record in the world that refers to this one adds a line, which is how the
 * events of a life reach the article about the person who lived it.
 */
export async function factsAbout(
  store: Store,
  model: ModelId,
  subject: Resource,
  label: (model: ModelId) => string,
): Promise<{ facts: string[]; sources: Reference[] }> {
  const facts: string[] = [];
  const name = typeof subject.name === 'string' ? subject.name : subject.id;
  facts.push(`${label(model)}: ${name}`);
  if (typeof subject.description === 'string' && subject.description.trim()) {
    facts.push(subject.description.trim());
  }
  for (const [key, value] of Object.entries(subject)) {
    if (PLATFORM.has(key)) continue;
    const text = describeValue(value, label);
    if (text !== undefined) facts.push(`${words(key)}: ${text}`);
  }

  const related = await store.references(subject.id, { limit: MOST_RELATED });
  for (const hit of related) {
    const title =
      typeof hit.resource.name === 'string'
        ? hit.resource.name
        : hit.resource.id;
    const year = yearOf(hit.resource);
    facts.push(
      `${label(hit.model)}: ${title}${year === undefined ? '' : ` (year ${year})`}`,
    );
  }

  const sources: Reference[] = [
    { model, id: subject.id, name },
    ...related.map((hit) => ({
      model: hit.model,
      id: hit.resource.id,
      ...(typeof hit.resource.name === 'string'
        ? { name: hit.resource.name }
        : {}),
    })),
  ];
  return { facts, sources };
}

function describeValue(
  value: unknown,
  label: (model: ModelId) => string,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (isReference(value)) {
    return `${value.name ?? value.id} (${label(value.model as ModelId).toLowerCase()})`;
  }
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, MOST_LISTED)
      .map((item) => describeValue(item, label))
      .filter((part): part is string => part !== undefined);
    if (parts.length === 0) return undefined;
    const more = value.length - parts.length;
    return parts.join(', ') + (more > 0 ? ` and ${more} more` : '');
  }
  if (typeof value === 'object') {
    const year = yearOf(value as Record<string, unknown>);
    return year === undefined ? undefined : `year ${year}`;
  }
  return undefined;
}

/** A year an object plainly carries: its own, or its beginning's. */
function yearOf(value: Record<string, unknown>): number | undefined {
  const own = value.year;
  if (typeof own === 'number') return own;
  for (const key of ['time', 'begin', 'when', 'validTime']) {
    const inner = value[key];
    if (typeof inner === 'object' && inner !== null) {
      const found = yearOf(inner as Record<string, unknown>);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function isReference(value: unknown): value is Reference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Reference).model === 'string' &&
    typeof (value as Reference).id === 'string'
  );
}

/** `hitDiceSpent` as `hit dice spent`. */
function words(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
