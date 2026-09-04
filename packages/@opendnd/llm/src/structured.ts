import { type ZodType, toJSONSchema } from 'zod';
import type { JsonSchema, Message, ModelResponse } from './message';
import type { Models } from './models';

export interface StructuredOptions<T> {
  /** The shape the reply must take. The ontology's own schemas fit here. */
  readonly schema: ZodType<T>;
  /** Name the schema is given to the provider. Defaults to `result`. */
  readonly name?: string;
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Times to hand validation errors back and ask again. Default 2. */
  readonly repairAttempts?: number;
  /** The model to use, overriding the task's. */
  readonly model?: string;
  readonly noCache?: boolean;
}

export interface StructuredResult<T> {
  readonly value: T;
  /** The reply that validated. */
  readonly response: ModelResponse;
  /** Every reply, including the ones that failed validation. */
  readonly responses: readonly ModelResponse[];
}

export class StructuredError extends Error {
  constructor(
    message: string,
    readonly responses: readonly ModelResponse[],
  ) {
    super(message);
    this.name = 'StructuredError';
  }
}

/**
 * Ask for a value of a given shape and get one back, validated.
 *
 * The schema goes to the provider so it can constrain generation natively,
 * and the reply is parsed against the same schema regardless, because a
 * record that enters a world is checked here rather than taken on trust. A
 * reply that fails validation is handed back with its errors and asked for
 * again, which recovers most near-misses in one turn.
 */
export async function structured<T>(
  models: Models,
  task: string,
  options: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const name = options.name ?? 'result';
  const schema = jsonSchemaOf(options.schema);
  const responses: ModelResponse[] = [];
  const messages: Message[] = [...options.messages];
  const tries = 1 + (options.repairAttempts ?? 2);
  let complaint = '';

  for (let attempt = 0; attempt < tries; attempt++) {
    const response = await models.complete(
      task,
      {
        messages,
        schema: { name, schema },
        ...(options.system === undefined ? {} : { system: options.system }),
        ...(options.maxTokens === undefined
          ? {}
          : { maxTokens: options.maxTokens }),
        ...(options.temperature === undefined
          ? {}
          : { temperature: options.temperature }),
      },
      {
        ...(options.model === undefined ? {} : { model: options.model }),
        // A repair must not be served the cached reply that just failed.
        noCache: options.noCache === true || attempt > 0,
      },
    );
    responses.push(response);

    const json = extractJson(response.text);
    if (json === undefined) {
      complaint = 'the reply contained no JSON value';
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (error) {
        complaint = `the JSON did not parse: ${(error as Error).message}`;
        parsed = undefined;
      }
      if (parsed !== undefined) {
        const result = options.schema.safeParse(parsed);
        if (result.success) {
          return { value: result.data, response, responses };
        }
        complaint = result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
      }
    }

    messages.push({ role: 'assistant', content: response.text });
    messages.push({
      role: 'user',
      content:
        `That did not validate: ${complaint}. ` +
        `Return only a JSON value matching the schema, with no commentary.`,
    });
  }

  throw new StructuredError(
    `${task} did not return a valid ${name} in ${tries} tries: ${complaint}`,
    responses,
  );
}

/**
 * A Zod schema as JSON Schema for the wire. `$schema` is dropped because
 * several providers reject keys they do not know.
 */
export function jsonSchemaOf(schema: ZodType<unknown>): JsonSchema {
  const json = toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'output',
  }) as JsonSchema;
  const { $schema: _ignored, ...rest } = json;
  return rest;
}

/**
 * The first JSON value in a reply. Models wrap JSON in prose or a fenced
 * block often enough that finding it is part of the job; the balanced scan
 * respects strings so a brace inside a name does not end the value early.
 */
export function extractJson(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.search(/[[{]/);
  if (start < 0) return undefined;
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return undefined;
}
