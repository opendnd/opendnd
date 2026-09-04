import type { Reference, Work, WorkType } from '@opendnd/types';
import { Author, AuthorContext, stampAuthored } from '../author';

export interface ArticleInput {
  /** What the article is about. */
  readonly subject: Reference;
  /** Its title, usually the subject's name. */
  readonly title: string;
  /**
   * Statements drawn from the record. The article may not contradict them and
   * may not add anything they do not support, which is the guard against a
   * model inventing detail that is not in the world.
   */
  readonly facts: readonly string[];
  /**
   * Records the facts came from. They are recorded in provenance, so a reader
   * of the article can get back to the events behind any sentence in it.
   */
  readonly sources?: readonly Reference[];
  /** `article` is written about the world; `chronicle` from inside it. */
  readonly workType?: WorkType;
  /** Roughly how long, in words. */
  readonly words?: number;
  /** BCP 47 tag. Defaults to `en`. */
  readonly language?: string;
}

/**
 * An article about one record, for the Codex.
 *
 * Everything the model is allowed to say arrives in `facts`, so the article
 * is a rendering of the record rather than a new source of truth, and the
 * events it came from are named in provenance. A `chronicle` is written as if
 * from inside the world and is marked in-universe; an `article` is written
 * about the world and is marked out-of-universe.
 */
export const articleAuthor: Author<ArticleInput, Work> = {
  id: 'article',
  version: '1.0.0',
  description:
    'Writes an article or chronicle about one record from the facts on file.',
  task: 'chronicle',

  async author(input: ArticleInput, ctx: AuthorContext): Promise<Work> {
    const workType = input.workType ?? 'article';
    const words = input.words ?? 250;
    const response = await ctx.models.complete(
      this.task,
      {
        messages: [
          {
            role: 'user',
            content: [
              `Write about ${input.title} in roughly ${words} words.`,
              workType === 'chronicle'
                ? 'Write as a chronicler of the world, in its own voice.'
                : 'Write as a reference work about the world.',
              'Use only what the record below supports. Add no names, dates,',
              'places or relations that are not in it. Return prose only, with',
              'no heading and no commentary.',
              '',
              'Record:',
              ...input.facts.map((f) => `- ${f}`),
            ].join('\n'),
          },
        ],
      },
      // The model the caller chose, when they chose one.
      ctx.model === undefined ? {} : { model: ctx.model },
    );

    const text = response.text.trim();
    return {
      ...stampAuthored(this, ctx, response, {
        ...(input.sources ? { derivedFrom: input.sources } : {}),
      }),
      name: input.title,
      perspective: workType === 'chronicle' ? 'in-universe' : 'out-of-universe',
      workType,
      about: [input.subject],
      text,
      language: input.language ?? 'en',
    };
  },
};
