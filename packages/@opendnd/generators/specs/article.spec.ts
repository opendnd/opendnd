import { describe, expect, it } from 'bun:test';
import type { ModelRequest, ModelSpec, Provider } from '@opendnd/llm';
import {
  DEFAULT_TASKS,
  MemoryLedger,
  Models,
  asTaskConfig,
} from '@opendnd/llm';
import { workSchema } from '@opendnd/types';
import { AuthorContext, articleAuthor, createContext } from 'src';

const world = '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11';
const now = '2026-09-04T12:00:00Z';

const model: ModelSpec = {
  id: 'claude-test',
  provider: 'bedrock',
  modelId: 'anthropic.claude-test-v1:0',
  contextWindow: 200000,
  maxOutputTokens: 4096,
  capabilities: ['schema'],
  pricing: { inputPerMillion: 3, outputPerMillion: 15 },
};

/** A provider that returns fixed prose and remembers what it was asked. */
class Scripted implements Provider {
  readonly id = 'bedrock';
  readonly calls: ModelRequest[] = [];

  constructor(private readonly text: string) {}

  async complete(spec: ModelSpec, request: ModelRequest) {
    this.calls.push(request);
    return {
      text: this.text,
      usage: { inputTokens: 400, outputTokens: 200 },
      stopReason: 'stop' as const,
      modelId: spec.modelId,
    };
  }
}

function contextWith(provider: Provider, ledger?: MemoryLedger): AuthorContext {
  return {
    ...createContext({ world, seedPath: 'article/itumeist', now }),
    models: new Models({
      providers: [provider],
      models: [model],
      // The real chronicle task, pointed at the one model under test, so the
      // house voice the package ships is what the author actually sends.
      tasks: {
        chronicle: {
          ...asTaskConfig(DEFAULT_TASKS.chronicle),
          model: 'claude-test',
        },
      },
      ...(ledger ? { ledger } : {}),
    }),
  };
}

const input = {
  subject: {
    model: 'place',
    id: '9c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a22',
    name: 'Itumeist',
  },
  title: 'Itumeist',
  facts: [
    'Itumeist is a county in the Kingdom of Aerath.',
    'Apiustu Nuriatia was deposed as Count of Itumeist in 1038.',
  ],
  sources: [
    {
      model: 'event',
      id: '1c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a33',
      name: 'War for Count of Itumeist',
    },
  ],
} as const;

describe('articleAuthor', () => {
  it('produces a valid Work about its subject', async () => {
    const provider = new Scripted('  Itumeist is a county of Aerath.  ');
    const work = await articleAuthor.author(input, contextWith(provider));

    workSchema.parse(work);
    expect(work.name).toBe('Itumeist');
    expect(work.workType).toBe('article');
    expect(work.text).toBe('Itumeist is a county of Aerath.');
    expect(work.about).toEqual([input.subject]);
    expect(work.language).toBe('en');
    expect(work.world).toBe(world);
    expect(work.canonStatus).toBe('generated');
  });

  it('records the author, the model and the events it was written from', async () => {
    const provider = new Scripted('prose');
    const work = await articleAuthor.author(input, contextWith(provider));

    expect(work.provenance!.generatedBy).toBe('article@1.0.0');
    expect(work.provenance!.parameters).toEqual({
      model: 'bedrock:anthropic.claude-test-v1:0',
    });
    expect(work.provenance!.seed).toBe('article/itumeist');
    expect(work.provenance!.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(work.provenance!.derivedFrom).toEqual([...input.sources]);
  });

  it('gives the model nothing but the record to work from', async () => {
    const provider = new Scripted('prose');
    await articleAuthor.author(input, contextWith(provider));

    const prompt = provider.calls[0].messages[0].content;
    for (const fact of input.facts) expect(prompt).toContain(fact);
    expect(prompt).toContain('Add no names, dates');
    // The house voice comes from the task, not from the author.
    expect(provider.calls[0].system).toContain('chronicler');
  });

  it('is written from inside the world when it is a chronicle', async () => {
    const article = await articleAuthor.author(
      input,
      contextWith(new Scripted('prose')),
    );
    const chronicle = await articleAuthor.author(
      { ...input, workType: 'chronicle', words: 800 },
      contextWith(new Scripted('prose')),
    );

    expect(article.perspective).toBe('out-of-universe');
    expect(chronicle.perspective).toBe('in-universe');
    expect(chronicle.workType).toBe('chronicle');
  });

  it('gives the same record the same id, so re-authoring replaces it', async () => {
    const first = await articleAuthor.author(
      input,
      contextWith(new Scripted('one')),
    );
    const second = await articleAuthor.author(
      input,
      contextWith(new Scripted('two')),
    );

    // The words differ, because a model does not repeat itself; the identity
    // of the record does not, because it comes from the seed path.
    expect(second.text).not.toBe(first.text);
    expect(second.id).toBe(first.id);
    expect(second.derivedId).toBe(first.derivedId);
  });

  it('puts what it cost on the bill', async () => {
    const ledger = new MemoryLedger();
    await articleAuthor.author(
      input,
      contextWith(new Scripted('prose'), ledger),
    );
    // 400 in at $3/M plus 200 out at $15/M is $0.0042.
    expect(ledger.totalCostMicros()).toBe(4200);
    expect(ledger.totalChargeMicros()).toBe(4620);
    expect(ledger.entries[0]!.task).toBe('chronicle');
  });
});
