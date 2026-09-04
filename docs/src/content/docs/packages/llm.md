---
title: "@opendnd/llm"
description: One way in to every language model, with the choice of model left to the user.
---

One interface, many models. Which model runs comes from configuration or from the call, not from this package. A model that fails is reported rather than replaced, so the choice of what to do next stays with whoever made the first one. See [ADR-010](/adr/adr-010-language-models/).

```ts
const models = modelsFromEnv();

// The model the task is configured with.
await models.complete('chronicle', { messages });

// Or the one the person asking just picked.
await models.complete('chronicle', { messages }, { model: 'gemma4:26b' });
```

The package knows nothing about worlds. Like `@opendnd/ours`, it is domain-agnostic on purpose.

## Tasks

A task is the kind of work, not the model that does it: `chronicle`, `describe`, `author`, `review`, `embed`. Its configuration carries the voice the work is written in and how long it may run, so a caller does not repeat a system prompt at every call site, and it may name a model.

```ts
interface TaskConfig {
  model?: string;      // omitted: the deployment's default model
  system?: string;     // the voice
  temperature?: number;
  maxTokens?: number;
  think?: boolean;     // may the model reason before answering
}
```

The tasks that ship name **no model at all**. The model comes from `OPENDND_LLM_TASKS`, from `OPENDND_LLM_MODEL`, or from the call — in that order of increasing specificity, each beating the last. Ask for a task with no model named anywhere and the call fails with an error that says so and lists what is available, rather than falling back on a guess.

The task is also what the usage line on the bill says, which is why every call names one.

## Choosing a model

`catalogue()` is what this deployment knows about: models whose provider is configured, with their limits, capabilities and price. `available()` goes further and asks the endpoints that can be asked, so a local Ollama contributes the tags it has actually pulled — including models no table of ours mentions — and an endpoint that is down contributes nothing. That is what a model picker should show.

A model id absent from the catalogue is taken at face value as a tag on the local Ollama, so a model that has just been pulled can be named immediately. Its context window and price are left unset because they are not known, so it is neither checked against a limit nor billed.

`capabilities` (`schema`, `tools`, `vision`, `embedding`) is information for whoever is choosing rather than a filter: it never rules a model out on their behalf.

## Providers

A provider holds a wire format and nothing else: no model choice, no retries, no cost, no cache.

| Provider | Endpoint | Notes |
|---|---|---|
| `OllamaProvider` | `/api/chat` | The local-first path: no key, no network, no cost. Honours `seed`, so replies are reproducible. Structured output through Ollama's `format`. Streams newline-delimited JSON, and reports the models it holds. |
| `BedrockProvider` | Converse | One request shape for every family AWS hosts, so a new model is a catalogue entry rather than an adapter. Signed with SigV4 from environment credentials. |
| `OpenAiCompatibleProvider` | `/chat/completions` | One adapter for LM Studio, llama.cpp's server, vLLM and the hosted gateways. An endpoint already running needs nothing but its base URL. |
| `AnthropicProvider` | `/v1/messages` | For anyone holding their own key. |

`embed` is implemented on Ollama, the OpenAI-compatible endpoint, and Bedrock's Titan and Cohere families. `stream` is implemented everywhere except Bedrock, whose ConverseStream frames its events in AWS's binary event-stream format; there `stream` returns the whole reply as one chunk, so a caller can always render progressively without checking who is serving it.

### SigV4

Bedrock is the only AWS call OpenDnD makes, so `signRequest` is a hundred lines of `node:crypto` rather than a dependency, which keeps the package dependency-free and testable with no network and no account. It is held to the published AWS `get-vanilla` test vector. Credentials come from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`, which is exactly what a Lambda already has, or from a function called before each request so a rotating role keeps working.

The one subtlety is that every AWS service but S3 encodes the request path a second time when signing, so a Bedrock model id whose colon arrives as `%3A` is signed as `%253A`. Getting that wrong is the classic cause of a signature mismatch.

## What happens when a call fails

A rate limit or a 5xx is retried on the same model, backing off, up to `attempts`. Everything else is thrown, with a message that says what to do:

- The model belongs to a provider this deployment has not configured, or no model was named at all: a `NoModelError` listing what is available.
- The prompt cannot fit: an error naming the token count and the model's window, so a larger model can be picked. A model whose window is unknown is not checked.
- The reply came back empty: an error saying so. The commonest cause is a reasoning model that spent its whole output budget thinking, so the message says to raise `maxTokens` or set `think: false`.

## Cost

Money is only ever added as integers, in millionths of a dollar. `costOf(spec, usage)` prices a call from the model's tariff; local models have no tariff and cost nothing. `chargeFor(cost)` adds the margin — OpenDnD recovers its costs and no more, so the margin exists to absorb price changes and payment fees. It converts the margin to basis points first, because `21000 * 1.1` in binary floating point is `23100.000000000004`, and rounding that up bills a micro-dollar nobody earned.

Every call writes a `UsageRecord` to the `Ledger`: task, model, provider, tokens, cost, charge, whether it was cached, and the world and requester. Streams are billed from the counts the stream reports, and the line says `estimated` where a provider reported none. A `Budget` is checked before each call, so a runaway generation stops instead of billing someone.

Model identifiers and prices in `KNOWN_MODELS` are **configuration, not facts**. Check both against the provider's current lists before charging anyone, and override them with `OPENDND_LLM_MODELS` rather than editing the catalogue.

## Structured output

```ts
const { value } = await structured(models, 'author', {
  schema: placeSchema, // any Zod schema, the ontology's included
  messages: [{ role: 'user', content: 'A hamlet in the hills.' }],
  model: 'claude-sonnet', // optional, as everywhere
});
```

The schema goes to the provider so it can constrain generation natively — Ollama's `format`, OpenAI's `json_schema`, one required tool on Anthropic and Bedrock — and the reply is parsed against the same schema regardless, because no provider's guarantee is worth trusting with a record that goes into a world. A reply that fails validation is handed back with its errors and asked for again, which recovers most near-misses in one turn; a repair is never answered from the cache that just failed.

`extractJson` digs the value out of prose and code fences, with a balanced scan that respects strings so a brace inside a name does not end the value early.

## Caching

The cache key is a hash over the model and every field of the request that can change the reply; it is also the `promptHash` recorded in provenance. `MemoryCache` lasts a process. `FileCache` writes one file per reply, which makes a cache committable: a fixture directory turns AI-authored content into a test that runs offline.

## Configuration

Nothing is required. With nothing set at all this talks to an Ollama on the usual port, and the model is named per call.

| Variable | Effect |
|---|---|
| `OPENDND_LLM_MODEL` | Default model for tasks that name none. |
| `OLLAMA_URL` | Where Ollama listens. Default `http://localhost:11434`. |
| `OPENDND_LLM_LOCAL=off` | Do not register Ollama at all. |
| `AWS_REGION` plus credentials | Register Bedrock. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Register the Anthropic API. |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Register any OpenAI-compatible endpoint. |
| `OPENDND_LLM_MODELS` | JSON array of model specs, merged over the catalogue by id. |
| `OPENDND_LLM_TASKS` | JSON object of task to config, merged field by field over the defaults. |
| `OPENDND_LLM_BUDGET` | Spending ceiling for this process, in dollars. |
| `OPENDND_LLM_CACHE` | Directory to cache replies in. |
| `OPENDND_LLM_MARGIN` | Margin over cost when charging. Default `0.1`. |

Task configuration merges field by field, so naming a model for a task does not throw away the voice it is written in: `OPENDND_LLM_TASKS={"chronicle":"claude-sonnet"}` changes who writes chronicles and nothing else.
