import type { Models, UsageRecord } from '@opendnd/llm';
import type { ModelId, Reference } from '@opendnd/types';
import { factsAbout } from './author';
import { NotFoundError, type Store } from './store';

/** What a question takes, as JSON Schema for a client to build a form from. */
export const ASK = {
  description:
    'Ask a question about the world. The answer is written by a language model from the records that match the names in the question, and from nothing else; it says which records it drew on.',
  input: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
        description:
          'The question, in plain words. Name the people and places you mean.',
      },
      model: {
        type: 'string',
        description:
          "A language model by id. Left out, the task's configured model answers.",
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
} as const;

export interface AskRequest {
  readonly question: string;
  readonly model?: string;
}

export interface AskResult {
  readonly answer: string;
  /** The records whose facts the model was given. */
  readonly sources: Reference[];
  /** What the model was told, so the answer can be checked. */
  readonly facts: string[];
  readonly spend?: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    chargeMicros: number;
    cached: boolean;
  };
}

export interface AskOptions {
  readonly models: Models;
  readonly label: (model: ModelId) => string;
  readonly spend: () => UsageRecord | undefined;
}

/** How many names are looked up, and how many records are read for them. */
const MOST_NAMES = 6;
const MOST_RECORDS = 8;
const MOST_FACTS = 160;

/**
 * Answer a question about a world from its records.
 *
 * The names in the question are searched for; the records found, and the
 * world's own record, are turned into the same facts an article is written
 * from; and the model is asked to answer from those facts alone. The records
 * used come back as sources, so an answer can be checked and followed.
 */
export async function askWorld(
  store: Store,
  world: string,
  request: AskRequest,
  options: AskOptions,
): Promise<AskResult> {
  const facts: string[] = [];
  const sources: Reference[] = [];

  const own = await store.get('world', world);
  if (!own) throw new NotFoundError('world', world);
  const worldName = typeof own.name === 'string' ? own.name : 'the world';
  facts.push(`World: ${worldName}`);
  if (typeof own.summary === 'string' && own.summary.trim()) {
    facts.push(own.summary.trim());
  }
  const now = (own.currentTime as { year?: unknown } | undefined)?.year;
  if (typeof now === 'number') facts.push(`The present year is ${now}.`);

  const seen = new Set<string>();
  for (const term of namesIn(request.question).slice(0, MOST_NAMES)) {
    const hits = await store.search(term, { limit: 3 });
    for (const hit of hits) {
      if (seen.has(hit.id) || seen.size >= MOST_RECORDS) continue;
      seen.add(hit.id);
      const record = await store.get(hit.model, hit.id);
      if (!record) continue;
      const about = await factsAbout(store, hit.model, record, options.label);
      facts.push('', ...about.facts);
      sources.push({ type: hit.model, id: hit.id, display: hit.name });
    }
  }

  const told = facts.slice(0, MOST_FACTS);
  const response = await options.models.complete(
    'ask',
    {
      messages: [
        {
          role: 'user',
          content:
            `Records of ${worldName}:\n\n${told.join('\n')}\n\n` +
            `Question: ${request.question}\n\n` +
            (sources.length === 0
              ? 'No record in the world matches a name in the question. Say so, and answer only what the world itself tells you.'
              : 'Answer from the records above and from nothing else. Where they do not say, say so.'),
        },
      ],
    },
    request.model ? { model: request.model } : {},
  );

  const line = options.spend();
  return {
    answer: response.text.trim(),
    sources,
    facts: told,
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

/**
 * The names a question is about: runs of capitalised words, joined across
 * the little words that sit inside names, and anything in quotation marks.
 * Falls back to the question's longer words when it names nothing.
 */
export function namesIn(question: string): string[] {
  const names = new Set<string>();
  for (const quoted of question.matchAll(/["“']([^"”']{2,80})["”']/g)) {
    names.add(quoted[1]!.trim());
  }
  const joiner = /^(of|the|de|la|le|du|des|von|van|da|di|no|の|and|&)$/i;
  const words = question
    .replace(/[?!.,;:()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    while (run.length > 0 && joiner.test(run[run.length - 1]!)) run.pop();
    if (run.length > 0) names.add(run.join(' '));
    run = [];
  };
  for (const [i, word] of words.entries()) {
    const capital = /^\p{Lu}/u.test(word);
    if (
      capital &&
      !(
        i === 0 &&
        /^(who|what|when|where|why|how|which|is|are|was|were|did|does|do|tell|describe|list|name)$/i.test(
          word,
        )
      )
    ) {
      run.push(word);
    } else if (run.length > 0 && joiner.test(word)) {
      run.push(word);
    } else {
      flush();
    }
  }
  flush();
  if (names.size === 0) {
    for (const word of words) {
      if (word.length > 5) names.add(word.toLowerCase());
    }
  }
  return [...names];
}
