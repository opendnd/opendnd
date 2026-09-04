import { describe, expect, it } from 'bun:test';
import {
  Budget,
  BudgetExceededError,
  MemoryCache,
  MemoryLedger,
  ModelError,
  Models,
  NoModelError,
  chargeFor,
  costOf,
  formatMicros,
  promptHash,
} from 'src';
import type { Provider } from 'src';
import { FakeProvider, embedModel, hostedModel, localModel } from './fakes';

const ask = {
  messages: [{ role: 'user' as const, content: 'Tell me of Aerath.' }],
};

function modelsWith(
  providers: Provider[],
  extra: Partial<ConstructorParameters<typeof Models>[0]> = {},
) {
  return new Models({
    providers,
    models: [localModel, hostedModel, embedModel],
    tasks: {
      chronicle: { model: 'test-local', temperature: 0.7 },
      embed: { model: 'test-embed' },
    },
    retryDelayMs: 0,
    ...extra,
  });
}

describe('Models: choosing a model', () => {
  it('uses the model the task is configured with', async () => {
    const local = new FakeProvider('local', ['Aerath is a kingdom.']);
    const hosted = new FakeProvider('hosted', []);
    const response = await modelsWith([local, hosted]).complete(
      'chronicle',
      ask,
    );

    expect(response.text).toBe('Aerath is a kingdom.');
    expect(response.model).toBe('test-local');
    expect(response.costMicros).toBe(0); // a model on your own machine is free
    expect(hosted.calls.length).toBe(0);
  });

  it('lets the call name a model, which beats the task', async () => {
    const local = new FakeProvider('local', []);
    const hosted = new FakeProvider('hosted', ['From the cloud.']);
    const response = await modelsWith([local, hosted]).complete(
      'chronicle',
      ask,
      { model: 'test-hosted' },
    );

    expect(response.model).toBe('test-hosted');
    expect(local.calls.length).toBe(0);
  });

  it('falls back on the deployment default only when nothing else is named', async () => {
    const hosted = new FakeProvider('hosted', ['default']);
    const models = new Models({
      providers: [hosted],
      models: [hostedModel],
      tasks: { describe: { temperature: 0.9 } },
      defaultModel: 'test-hosted',
    });
    expect((await models.complete('describe', ask)).model).toBe('test-hosted');
    expect(models.resolve('describe').id).toBe('test-hosted');
  });

  it('reports when no model was chosen, and lists what it knows', async () => {
    const models = new Models({
      providers: [new FakeProvider('hosted', [])],
      models: [hostedModel],
      tasks: {},
    });
    const error = await models
      .complete('chronicle', ask)
      .catch((e: unknown) => e as NoModelError);
    expect(error).toBeInstanceOf(NoModelError);
    expect((error as NoModelError).message).toContain(
      'no model was named for chronicle',
    );
    expect((error as NoModelError).message).toContain('test-hosted');
    expect((error as NoModelError).message).toContain('available()');
  });

  it('says so when the chosen model runs somewhere this deployment is not configured for', async () => {
    // The catalogue knows the hosted model, but only the local provider is here.
    const models = modelsWith([new FakeProvider('local', [])]);
    expect(() => models.resolve('chronicle', 'test-hosted')).toThrow(
      'runs on hosted, which is not configured here',
    );
  });

  it('never substitutes another model when the chosen one fails', async () => {
    const local = new FakeProvider('local', [
      new ModelError('model not pulled', 'unavailable', 'local'),
    ]);
    const hosted = new FakeProvider('hosted', ['would have worked']);
    await expect(
      modelsWith([local, hosted]).complete('chronicle', ask),
    ).rejects.toThrow('model not pulled');
    // A named model that fails is reported, not replaced.
    expect(hosted.calls.length).toBe(0);
  });

  it('retries the same model when it merely stumbles', async () => {
    const local = new FakeProvider('local', [
      new ModelError('too many requests', 'retryable', 'local'),
      'Second time lucky.',
    ]);
    const response = await modelsWith([local]).complete('chronicle', ask);
    expect(response.text).toBe('Second time lucky.');
    expect(local.calls.length).toBe(2);
  });

  it('applies the task defaults the call left out, and yields to the call', async () => {
    const local = new FakeProvider('local', ['x', 'y']);
    const models = new Models({
      providers: [local],
      models: [localModel],
      tasks: {
        describe: {
          model: 'test-local',
          system: 'Be brief.',
          temperature: 0.9,
          maxTokens: 128,
          think: false,
        },
      },
    });
    await models.complete('describe', ask);
    expect(local.calls[0].request.system).toBe('Be brief.');
    expect(local.calls[0].request.temperature).toBe(0.9);
    expect(local.calls[0].request.maxTokens).toBe(128);
    expect(local.calls[0].request.think).toBe(false);

    await models.complete('describe', {
      ...ask,
      temperature: 0.1,
      think: true,
    });
    expect(local.calls[1].request.temperature).toBe(0.1);
    expect(local.calls[1].request.think).toBe(true);
  });

  it('takes a model id absent from the catalogue as a local tag', async () => {
    const ollama = new FakeProvider('ollama', ['from a freshly pulled model']);
    const models = new Models({
      providers: [ollama],
      models: [],
      tasks: {},
    });
    const spec = models.resolve('chronicle', 'gemma4:26b');
    expect(spec.provider).toBe('ollama');
    expect(spec.modelId).toBe('gemma4:26b');
    // Its limits and price are left unset because they are not known.
    expect(spec.contextWindow).toBeUndefined();
    expect(spec.pricing).toBeUndefined();

    const response = await models.complete('chronicle', ask, {
      model: 'gemma4:26b',
    });
    expect(response.model).toBe('gemma4:26b');
    expect(response.costMicros).toBe(0);
  });

  it('refuses a prompt that cannot fit, naming both numbers', async () => {
    const models = modelsWith([new FakeProvider('local', ['unused'])]);
    const long = {
      messages: [{ role: 'user' as const, content: 'a'.repeat(200000) }],
    };
    await expect(models.complete('chronicle', long)).rejects.toThrow(
      /needs about \d+ tokens and test-local holds 8192/,
    );
  });

  it('does not check a prompt against a context window it does not know', async () => {
    const ollama = new FakeProvider('ollama', ['answered anyway']);
    const models = new Models({ providers: [ollama], models: [], tasks: {} });
    const long = {
      messages: [{ role: 'user' as const, content: 'a'.repeat(200000) }],
    };
    expect(
      (await models.complete('chronicle', long, { model: 'gemma4:26b' })).text,
    ).toBe('answered anyway');
  });

  it('reports an empty reply instead of passing it off as an answer', async () => {
    // What a local reasoning model does under a tight output cap: all the
    // tokens go into thinking and the answer comes back empty.
    const local = new FakeProvider('local', [
      {
        text: '',
        stopReason: 'length',
        reasoning: 'The county was held by...',
        usage: { inputTokens: 200, outputTokens: 1024 },
      },
    ]);
    await expect(
      modelsWith([local]).complete('chronicle', ask),
    ).rejects.toThrow('raise maxTokens or set think: false');
  });
});

describe('Models: what is available', () => {
  it('lists what the configured providers offer', () => {
    const models = modelsWith([
      new FakeProvider('local', []),
      new FakeProvider('hosted', []),
    ]);
    expect(
      models
        .catalogue()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['test-embed', 'test-hosted', 'test-local']);
    // A model whose provider is not configured is not on offer.
    expect(
      modelsWith([new FakeProvider('local', [])])
        .catalogue()
        .map((m) => m.id),
    ).toEqual(['test-local']);
  });

  it('asks an endpoint what it actually holds, including models no table knows', async () => {
    const ollama: Provider = {
      id: 'ollama',
      complete: async () => {
        throw new Error('not used');
      },
      list: async () => ['llama-test', 'gemma4:26b'],
    };
    const models = new Models({
      providers: [ollama],
      models: [{ ...localModel, provider: 'ollama' }],
      tasks: {},
    });
    const available = await models.available();
    expect(available.map((m) => m.id)).toEqual(['test-local', 'gemma4:26b']);
    // A model in the catalogue keeps its recorded limits.
    expect(available[0]!.contextWindow).toBe(8192);
    expect(available[1]!.contextWindow).toBeUndefined();
  });

  it('offers nothing from an endpoint that is down', async () => {
    const ollama: Provider = {
      id: 'ollama',
      complete: async () => {
        throw new Error('not used');
      },
      list: async () => {
        throw new Error('connection refused');
      },
    };
    const models = new Models({
      providers: [ollama],
      models: [{ ...localModel, provider: 'ollama' }],
      tasks: {},
    });
    expect(await models.available()).toEqual([]);
    // The catalogue still lists it: it records what is known, not what is
    // currently reachable.
    expect(models.catalogue().length).toBe(1);
  });

  it('treats capabilities as information, not as a filter', async () => {
    // A model without the 'tools' capability is still callable when named.
    const local = new FakeProvider('local', ['answered']);
    const models = modelsWith([local]);
    expect(localModel.capabilities).not.toContain('tools');
    expect((await models.complete('chronicle', ask)).text).toBe('answered');
  });
});

describe('Models: the plumbing', () => {
  it('prices a hosted call from the model tariff and bills it with the margin', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    // 1M in at $3 plus 100k out at $15 is $3 + $1.50.
    expect(costOf(hostedModel, usage)).toBe(4_500_000);
    expect(formatMicros(costOf(hostedModel, usage))).toBe('$4.500000');
    expect(chargeFor(4_500_000)).toBe(4_950_000);
    expect(costOf(localModel, usage)).toBe(0);
  });

  it('writes a usage line per call, with the world and the requester', async () => {
    const ledger = new MemoryLedger();
    const hosted = new FakeProvider('hosted', [
      { text: 'billed', usage: { inputTokens: 2000, outputTokens: 1000 } },
    ]);
    await modelsWith([hosted], {
      ledger,
      world: '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11',
      requestedBy: 'drew',
    }).complete('chronicle', ask, { model: 'test-hosted' });

    const entry = ledger.entries[0]!;
    expect(entry.task).toBe('chronicle');
    expect(entry.model).toBe('test-hosted');
    expect(entry.world).toBe('3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11');
    expect(entry.requestedBy).toBe('drew');
    // 2000 in at $3/M plus 1000 out at $15/M is $0.021.
    expect(entry.costMicros).toBe(21000);
    expect(entry.chargeMicros).toBe(chargeFor(21000));
    expect(ledger.summary()).toContain('total $0.023100');
  });

  it('stops when the budget is spent rather than billing on', async () => {
    const hosted = new FakeProvider('hosted', [
      { text: 'one', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      { text: 'two', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]);
    const models = new Models({
      providers: [hosted],
      models: [hostedModel],
      tasks: { chronicle: 'test-hosted' },
      budget: Budget.dollars(2),
      retryDelayMs: 0,
    });
    expect((await models.complete('chronicle', ask)).text).toBe('one');
    await expect(models.complete('chronicle', ask)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(hosted.calls.length).toBe(1);
  });

  it('serves a repeated request from the cache, free, without calling out', async () => {
    const cache = new MemoryCache();
    const hosted = new FakeProvider('hosted', ['once']);
    const ledger = new MemoryLedger();
    const models = new Models({
      providers: [hosted],
      models: [hostedModel],
      tasks: { chronicle: 'test-hosted' },
      cache,
      ledger,
    });
    const first = await models.complete('chronicle', ask);
    const second = await models.complete('chronicle', ask);

    expect(second.text).toBe('once');
    expect(second.cached).toBe(true);
    expect(second.costMicros).toBe(0);
    expect(first.promptHash).toBe(second.promptHash);
    expect(hosted.calls.length).toBe(1);
    expect(cache.size).toBe(1);
    // Both calls are on the bill; only the first one costs anything.
    expect(ledger.entries.map((e) => e.cached)).toEqual([false, true]);
    expect(ledger.totalCostMicros()).toBe(first.costMicros);
  });

  it('keys the cache on the model and everything that can change the answer', () => {
    const a = promptHash('m', ask);
    expect(promptHash('m', ask)).toBe(a);
    expect(promptHash('other', ask)).not.toBe(a);
    expect(promptHash('m', { ...ask, temperature: 0.5 })).not.toBe(a);
    expect(promptHash('m', { ...ask, system: 'hi' })).not.toBe(a);
    // Key order in the request must not matter.
    expect(promptHash('m', { temperature: 1, messages: ask.messages })).toBe(
      promptHash('m', { messages: ask.messages, temperature: 1 }),
    );
  });

  it('streams from a provider that can, and in one piece from one that cannot', async () => {
    const local = new FakeProvider('local', ['a b c']);
    const chunks: string[] = [];
    for await (const chunk of modelsWith([local]).stream('chronicle', ask)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['a ', 'b ', 'c ']);

    const noStream: Provider = {
      id: 'local',
      complete: async () => ({
        text: 'all at once',
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop' as const,
        modelId: 'llama-test',
      }),
    };
    const whole: string[] = [];
    for await (const chunk of modelsWith([noStream]).stream('chronicle', ask)) {
      whole.push(chunk);
    }
    expect(whole).toEqual(['all at once']);
  });

  it('bills a streamed call from the counts the stream reported', async () => {
    const ledger = new MemoryLedger();
    const hosted = new FakeProvider('hosted', [
      { text: 'one two', usage: { inputTokens: 2000, outputTokens: 1000 } },
    ]);
    const models = new Models({
      providers: [hosted],
      models: [hostedModel],
      tasks: { chronicle: 'test-hosted' },
      ledger,
    });
    const chunks: string[] = [];
    for await (const chunk of models.stream('chronicle', ask))
      chunks.push(chunk);

    expect(chunks.join('')).toBe('one two ');
    expect(ledger.entries.length).toBe(1);
    expect(ledger.entries[0]!.costMicros).toBe(21000);
    expect(ledger.entries[0]!.estimated).toBeUndefined();
  });

  it('estimates and says so when a stream reports no counts', async () => {
    const ledger = new MemoryLedger();
    const silent: Provider = {
      id: 'hosted',
      complete: async () => {
        throw new Error('not used');
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream() {
        yield { text: 'a'.repeat(400) };
      },
    };
    const models = new Models({
      providers: [silent],
      models: [hostedModel],
      tasks: { chronicle: 'test-hosted' },
      ledger,
    });
    for await (const _chunk of models.stream('chronicle', ask)) void _chunk;

    expect(ledger.entries[0]!.estimated).toBe(true);
    expect(ledger.entries[0]!.usage.outputTokens).toBe(100);
    expect(ledger.summary()).toContain('(estimated)');
  });

  it('embeds through the model the task names, and bills the tokens', async () => {
    const ledger = new MemoryLedger();
    const hosted = new FakeProvider('hosted', []);
    const vectors = await modelsWith([hosted], { ledger }).embed('embed', [
      'Aerath',
      'Itumeist',
    ]);

    expect(vectors).toEqual([
      [6, 1, 2],
      [8, 1, 2],
    ]);
    expect(ledger.entries[0]!.model).toBe('test-embed');
    expect(ledger.entries[0]!.usage.inputTokens).toBe(4);
    expect(ledger.entries[0]!.estimated).toBe(true);
  });

  it('says which models can embed when the chosen one cannot', async () => {
    const provider: Provider = {
      id: 'hosted',
      complete: async () => {
        throw new Error('not used');
      },
    };
    const models = modelsWith([provider]);
    await expect(models.embed('embed', ['x'])).rejects.toThrow(
      'cannot produce embeddings',
    );
  });
});
