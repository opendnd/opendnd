import { describe, expect, it } from 'bun:test';
import {
  AnthropicProvider,
  BedrockProvider,
  ModelError,
  OllamaProvider,
  OpenAiCompatibleProvider,
  credentialsFromEnv,
  signRequest,
} from 'src';
import { hostedModel, localModel, stubFetch } from './fakes';

const ask = {
  system: 'Be a chronicler.',
  messages: [{ role: 'user' as const, content: 'Tell me of Aerath.' }],
  maxTokens: 256,
  temperature: 0.7,
  seed: 42,
};
const schema = {
  name: 'settlement',
  schema: { type: 'object', properties: { name: { type: 'string' } } },
};

describe('OllamaProvider', () => {
  it('sends the chat shape with the system turn first and reads the counts back', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          model: 'llama-test',
          message: { content: 'Aerath is a kingdom.' },
          done_reason: 'stop',
          prompt_eval_count: 31,
          eval_count: 9,
        },
      },
    ]);
    const reply = await new OllamaProvider({ fetch }).complete(localModel, ask);

    expect(requests[0].url).toBe('http://localhost:11434/api/chat');
    const body = requests[0].body as Record<string, any>;
    expect(body.model).toBe('llama-test');
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'Be a chronicler.',
    });
    expect(body.messages[1].role).toBe('user');
    expect(body.options).toEqual({
      temperature: 0.7,
      num_predict: 256,
      seed: 42,
    });
    expect(reply.text).toBe('Aerath is a kingdom.');
    expect(reply.usage).toEqual({ inputTokens: 31, outputTokens: 9 });
    expect(reply.stopReason).toBe('stop');
  });

  it('passes a schema through as the format', async () => {
    const { fetch, requests } = stubFetch([{ body: { message: {} } }]);
    await new OllamaProvider({ fetch }).complete(localModel, {
      ...ask,
      schema,
    });
    expect((requests[0].body as any).format).toEqual(schema.schema);
  });

  it('treats a model it has not pulled as a reason to try another', async () => {
    const { fetch } = stubFetch([
      { body: { error: 'model "llama-test" not found, try pulling it first' } },
    ]);
    const error = await new OllamaProvider({ fetch })
      .complete(localModel, ask)
      .catch((e: unknown) => e as ModelError);
    expect((error as ModelError).kind).toBe('unavailable');
  });

  it('treats an Ollama that is not running as a reason to try another', async () => {
    const fetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    };
    const error = await new OllamaProvider({ fetch })
      .complete(localModel, ask)
      .catch((e: unknown) => e as ModelError);
    expect((error as ModelError).kind).toBe('unavailable');
  });

  it('reads newline-delimited chunks as they arrive', async () => {
    const { fetch } = stubFetch([
      {
        body: {},
        stream: [
          JSON.stringify({ message: { content: 'Aerath ' } }),
          JSON.stringify({ message: { content: 'endures.' } }),
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: { content: '' },
            prompt_eval_count: 31,
            eval_count: 9,
          }),
        ],
      },
    ]);
    const chunks: string[] = [];
    let usage;
    for await (const c of new OllamaProvider({ fetch }).stream(
      localModel,
      ask,
    )) {
      if (c.text) chunks.push(c.text);
      if (c.usage) usage = c.usage;
    }
    expect(chunks.join('')).toBe('Aerath endures.');
    // The counts come with the final chunk, so a stream can be billed.
    expect(usage).toEqual({ inputTokens: 31, outputTokens: 9 });
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('sends the chat completions shape and the bearer token', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          model: 'hosted-test',
          choices: [{ message: { content: 'hello' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 5, completion_tokens: 7 },
        },
      },
    ]);
    const reply = await new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'secret',
      fetch,
    }).complete(hostedModel, { ...ask, schema });

    expect(requests[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(requests[0].headers.authorization).toBe('Bearer secret');
    const body = requests[0].body as Record<string, any>;
    expect(body.messages[0].role).toBe('system');
    expect(body.max_tokens).toBe(256);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe('settlement');
    expect(reply.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(reply.stopReason).toBe('length');
  });

  it('reads server-sent event deltas', async () => {
    const { fetch } = stubFetch([
      {
        body: {},
        stream: [
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Ae' } }] })}`,
          '',
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'rath' } }] })}`,
          `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 9, completion_tokens: 2 },
          })}`,
          'data: [DONE]',
        ],
      },
    ]);
    const chunks: string[] = [];
    let usage;
    for await (const c of new OpenAiCompatibleProvider({
      baseUrl: 'http://x/v1',
      fetch,
    }).stream(hostedModel, ask)) {
      if (c.text) chunks.push(c.text);
      if (c.usage) usage = c.usage;
    }
    expect(chunks.join('')).toBe('Aerath');
    expect(usage).toEqual({ inputTokens: 9, outputTokens: 2 });
  });

  it('classifies statuses so a caller knows whether trying again could help', async () => {
    const cases: [number, string][] = [
      [404, 'unavailable'],
      [401, 'unavailable'],
      [429, 'retryable'],
      [503, 'retryable'],
      [400, 'fatal'],
    ];
    for (const [status, kind] of cases) {
      const { fetch } = stubFetch([{ status, body: { error: 'no' } }]);
      const error = await new OpenAiCompatibleProvider({
        baseUrl: 'http://x/v1',
        fetch,
      })
        .complete(hostedModel, ask)
        .catch((e: unknown) => e as ModelError);
      expect((error as ModelError).kind).toBe(kind as never);
    }
  });
});

describe('AnthropicProvider', () => {
  it('sends the messages shape with the system prompt held apart', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          model: 'hosted-test',
          content: [{ type: 'text', text: 'Aerath.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 11, output_tokens: 3 },
        },
      },
    ]);
    const reply = await new AnthropicProvider({
      apiKey: 'k',
      fetch,
    }).complete(hostedModel, ask);

    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0].headers['x-api-key']).toBe('k');
    expect(requests[0].headers['anthropic-version']).toBe('2023-06-01');
    const body = requests[0].body as Record<string, any>;
    expect(body.system).toBe('Be a chronicler.');
    expect(body.messages.length).toBe(1);
    expect(reply.text).toBe('Aerath.');
    expect(reply.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
  });

  it('turns a schema into one required tool and reads the call back as JSON', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          content: [{ type: 'tool_use', input: { name: 'Thornehold' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ]);
    const reply = await new AnthropicProvider({ apiKey: 'k', fetch }).complete(
      hostedModel,
      { ...ask, schema },
    );
    const body = requests[0].body as Record<string, any>;
    expect(body.tools[0].name).toBe('settlement');
    expect(body.tools[0].input_schema).toEqual(schema.schema);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'settlement' });
    expect(JSON.parse(reply.text)).toEqual({ name: 'Thornehold' });
    expect(reply.stopReason).toBe('stop');
  });
});

describe('BedrockProvider', () => {
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const bedrockModel = {
    ...hostedModel,
    provider: 'bedrock',
    modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
  };

  it('calls Converse with a signed request and escapes the model id in the path', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          output: { message: { content: [{ text: 'Aerath.' }] } },
          stopReason: 'end_turn',
          usage: { inputTokens: 12, outputTokens: 4 },
        },
      },
    ]);
    const reply = await new BedrockProvider({
      region: 'us-east-1',
      credentials,
      fetch,
    }).complete(bedrockModel, ask);

    expect(requests[0].url).toBe(
      'https://bedrock-runtime.us-east-1.amazonaws.com/model/' +
        'anthropic.claude-3-5-haiku-20241022-v1%3A0/converse',
    );
    expect(requests[0].headers.authorization).toContain(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/',
    );
    expect(requests[0].headers.authorization).toContain(
      '/bedrock/aws4_request',
    );
    expect(requests[0].headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);

    const body = requests[0].body as Record<string, any>;
    expect(body.system).toEqual([{ text: 'Be a chronicler.' }]);
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [{ text: 'Tell me of Aerath.' }],
    });
    expect(body.inferenceConfig).toEqual({ maxTokens: 256, temperature: 0.7 });
    expect(reply.text).toBe('Aerath.');
    expect(reply.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
  });

  it('turns a schema into a required tool and reads the tool input back', async () => {
    const { fetch, requests } = stubFetch([
      {
        body: {
          output: {
            message: {
              content: [{ toolUse: { input: { name: 'Thornehold' } } }],
            },
          },
          stopReason: 'tool_use',
          usage: {},
        },
      },
    ]);
    const reply = await new BedrockProvider({
      region: 'eu-west-2',
      credentials,
      fetch,
    }).complete(bedrockModel, { ...ask, schema });
    const config = (requests[0].body as any).toolConfig;
    expect(config.tools[0].toolSpec.inputSchema.json).toEqual(schema.schema);
    expect(config.toolChoice).toEqual({ tool: { name: 'settlement' } });
    expect(JSON.parse(reply.text)).toEqual({ name: 'Thornehold' });
  });

  it('signs each call with credentials fetched at the time', async () => {
    const { fetch, requests } = stubFetch([
      { body: { output: { message: { content: [] } }, usage: {} } },
    ]);
    let issued = 0;
    await new BedrockProvider({
      region: 'us-east-1',
      credentials: () => {
        issued++;
        return { ...credentials, sessionToken: `token-${issued}` };
      },
      fetch,
    }).complete(bedrockModel, ask);
    expect(issued).toBe(1);
    expect(requests[0].headers['x-amz-security-token']).toBe('token-1');
    // A session token must be signed, or the call is rejected.
    expect(requests[0].headers.authorization).toContain('x-amz-security-token');
  });

  it('comes from the environment only when the environment has what it needs', () => {
    expect(BedrockProvider.fromEnv({})).toBeUndefined();
    expect(
      BedrockProvider.fromEnv({ AWS_REGION: 'us-east-1' }),
    ).toBeUndefined();
    expect(
      BedrockProvider.fromEnv({
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'a',
        AWS_SECRET_ACCESS_KEY: 'b',
      }),
    ).toBeDefined();
    expect(
      credentialsFromEnv({
        AWS_ACCESS_KEY_ID: 'a',
        AWS_SECRET_ACCESS_KEY: 'b',
        AWS_SESSION_TOKEN: 'c',
      })?.sessionToken,
    ).toBe('c');
  });
});

describe('signRequest', () => {
  it('matches the published AWS get-vanilla test vector', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      body: '',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      now: new Date('2015-08-30T12:36:00.000Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(headers.host).toBe('example.amazonaws.com');
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
  });

  it('signs the path a second time, as every service but S3 requires', () => {
    const signed = (url: string) =>
      signRequest({
        method: 'POST',
        url,
        region: 'us-east-1',
        service: 'bedrock',
        body: '{}',
        credentials: { accessKeyId: 'A', secretAccessKey: 'B' },
        now: new Date('2015-08-30T12:36:00.000Z'),
      }).authorization;
    // A colon that arrives as %3A is canonicalised as %253A, so a path that
    // differs only in escaping must not produce the same signature.
    expect(signed('https://h/model/a%3A0/converse')).not.toBe(
      signed('https://h/model/a:0/converse'),
    );
  });

  it('changes the signature when the body changes', () => {
    const sign = (body: string) =>
      signRequest({
        method: 'POST',
        url: 'https://h/x',
        region: 'us-east-1',
        service: 'bedrock',
        body,
        credentials: { accessKeyId: 'A', secretAccessKey: 'B' },
        now: new Date('2015-08-30T12:36:00.000Z'),
      }).authorization;
    expect(sign('{"a":1}')).not.toBe(sign('{"a":2}'));
  });
});
