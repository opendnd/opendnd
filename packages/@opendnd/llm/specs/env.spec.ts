import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_TASKS,
  KNOWN_MODELS,
  TASKS,
  mergeModels,
  mergeTasks,
  modelsFromEnv,
} from 'src';
import type { ModelSpec, TaskConfig } from 'src';
import { stubFetch } from './fakes';

describe('modelsFromEnv', () => {
  it('needs no configuration: a local Ollama, and the model named per call', async () => {
    const { fetch, requests } = stubFetch([
      { body: { message: { content: 'Aerath is a kingdom.' } } },
    ]);
    const models = modelsFromEnv({ env: {}, fetch });
    const response = await models.complete(
      'chronicle',
      { messages: [{ role: 'user', content: 'Tell me of Aerath.' }] },
      { model: 'gemma4:26b' },
    );
    expect(requests[0].url).toBe('http://localhost:11434/api/chat');
    expect((requests[0].body as { model: string }).model).toBe('gemma4:26b');
    expect(response.provider).toBe('ollama');
    expect(response.costMicros).toBe(0);
    // The task still supplies the voice it is written in.
    expect(
      (requests[0].body as { messages: { role: string }[] }).messages[0].role,
    ).toBe('system');
  });

  it('takes a default model from the environment', () => {
    const models = modelsFromEnv({
      env: { OPENDND_LLM_MODEL: 'llama3.1:8b' },
    });
    expect(models.resolve('chronicle').id).toBe('llama3.1:8b');
    expect(models.resolve('chronicle').contextWindow).toBe(128000);
  });

  it('offers only what the configured providers can serve', () => {
    expect(
      modelsFromEnv({ env: {} })
        .catalogue()
        .every((m) => m.provider === 'ollama'),
    ).toBe(true);
    const withAws = modelsFromEnv({
      env: {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'a',
        AWS_SECRET_ACCESS_KEY: 'b',
      },
    });
    expect(new Set(withAws.catalogue().map((m) => m.provider))).toEqual(
      new Set(['ollama', 'bedrock']),
    );
    expect(
      modelsFromEnv({
        env: {
          OPENDND_LLM_LOCAL: 'off',
          AWS_REGION: 'us-east-1',
          AWS_ACCESS_KEY_ID: 'a',
          AWS_SECRET_ACCESS_KEY: 'b',
        },
      })
        .catalogue()
        .every((m) => m.provider === 'bedrock'),
    ).toBe(true);
  });

  it('registers an OpenAI-compatible endpoint from its base URL', async () => {
    const { fetch, requests } = stubFetch([
      { body: { choices: [{ message: { content: 'hi' } }] } },
    ]);
    const models = modelsFromEnv({
      env: {
        OPENDND_LLM_LOCAL: 'off',
        OPENAI_BASE_URL: 'http://localhost:1234/v1',
        OPENAI_API_KEY: 'k',
        OPENDND_LLM_MODELS: JSON.stringify([
          {
            id: 'studio',
            provider: 'openai',
            modelId: 'local-model',
            contextWindow: 32000,
            maxOutputTokens: 2048,
            capabilities: ['schema'],
          },
        ]),
        OPENDND_LLM_TASKS: JSON.stringify({ chronicle: 'studio' }),
      },
      fetch,
    });
    const response = await models.complete('chronicle', {
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(requests[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(response.model).toBe('studio');
  });

  it('refuses configuration that is not JSON, by name', () => {
    expect(() =>
      modelsFromEnv({ env: { OPENDND_LLM_TASKS: '{oops' } }),
    ).toThrow('OPENDND_LLM_TASKS is not valid JSON');
    expect(() =>
      modelsFromEnv({ env: { OPENDND_LLM_MODELS: 'nope' } }),
    ).toThrow('OPENDND_LLM_MODELS is not valid JSON');
  });
});

describe('the default tasks', () => {
  it('name no model, because that choice is not ours', () => {
    for (const task of TASKS) {
      const config = DEFAULT_TASKS[task] as TaskConfig;
      expect(config.model).toBeUndefined();
    }
  });

  it('carry a voice and an output budget for the work that needs one', () => {
    for (const task of TASKS) {
      if (task === 'embed') continue;
      const config = DEFAULT_TASKS[task] as TaskConfig;
      expect(config.system!.length).toBeGreaterThan(50);
      expect(config.maxTokens).toBeGreaterThan(0);
    }
    // Prose tasks turn reasoning off: it would eat the whole output budget.
    expect((DEFAULT_TASKS.chronicle as TaskConfig).think).toBe(false);
    expect((DEFAULT_TASKS.describe as TaskConfig).think).toBe(false);
  });
});

describe('the known-models table', () => {
  it('names local models by the tag the user pulls, and prices nothing local', () => {
    for (const model of KNOWN_MODELS) {
      if (model.provider === 'ollama') {
        expect(model.id).toBe(model.modelId);
        expect(model.pricing).toBeUndefined();
      } else {
        expect(model.pricing!.inputPerMillion).toBeGreaterThan(0);
        expect(model.pricing!.outputPerMillion).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('offers something for every kind of work, local and hosted', () => {
    const canEmbed = KNOWN_MODELS.filter((m) =>
      m.capabilities.includes('embedding'),
    );
    expect(canEmbed.map((m) => m.provider).sort()).toEqual([
      'bedrock',
      'ollama',
    ]);
    const canSchema = KNOWN_MODELS.filter((m) =>
      m.capabilities.includes('schema'),
    );
    expect(new Set(canSchema.map((m) => m.provider))).toEqual(
      new Set(['ollama', 'bedrock']),
    );
  });
});

describe('configuration merging', () => {
  const base: ModelSpec[] = [
    { id: 'a', provider: 'p', modelId: 'x', capabilities: [] },
  ];

  it('replaces a table entry by id and appends the rest', () => {
    const merged = mergeModels(
      base,
      JSON.stringify([
        { id: 'a', provider: 'p', modelId: 'y', capabilities: [] },
        { id: 'b', provider: 'p', modelId: 'z', capabilities: [] },
      ]),
    );
    expect(merged.map((m) => [m.id, m.modelId])).toEqual([
      ['a', 'y'],
      ['b', 'z'],
    ]);
    expect(mergeModels(base, undefined)).toEqual(base);
  });

  it('names a model for a task without throwing away its voice', () => {
    const merged = mergeTasks(
      { chronicle: { system: 'Be a chronicler.', temperature: 0.7 } },
      JSON.stringify({ chronicle: 'claude-sonnet' }),
    );
    expect(merged.chronicle).toEqual({
      system: 'Be a chronicler.',
      temperature: 0.7,
      model: 'claude-sonnet',
    });
  });

  it('leaves the tasks it was not asked about alone', () => {
    const merged = mergeTasks(
      { chronicle: 'a', describe: 'b' },
      JSON.stringify({ describe: { model: 'c', temperature: 0.2 } }),
    );
    expect(merged).toEqual({
      chronicle: 'a',
      describe: { model: 'c', temperature: 0.2 },
    });
  });
});
