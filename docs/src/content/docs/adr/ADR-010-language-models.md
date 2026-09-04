---
title: "ADR-010: One interface to language models, with the choice left to the user"
description: Callers name a task and may name a model; which model runs comes from configuration or from the person asking; every call is priced, hashed and recorded.
---

**Status:** Accepted, 2026-09-04

## Context

Several of the things OpenDnD is for need a language model: articles and chronicles over the simulated record, descriptive text for a place nobody has written yet, authoring a resource against its schema, reading prose for contradictions, and vectors for search.

Running locally is a first-class case. A person building a world on their own machine should be able to use these features without an account, without a key, and without sending their world to anyone; many of them already run Ollama, LM Studio or llama.cpp, and they have opinions about which model they want. The hosted case has to work too, and it costs real money: OpenDnD is free and recovers its costs, so every token has to be attributable to whoever asked for it. And models change faster than anything else here — an identifier, a price, a context window, and which model is best at a task will all be wrong within a year of being written down.

One tempting answer is to let the software choose: ordered lists of candidates, capability filters, automatic failover from a local model to a hosted one. We rejected it. Choosing on someone's behalf spends their money without being asked, substitutes a model they did not pick, and makes a poor answer hard to account for, because the record does not show who produced it. Whoever runs OpenDnD knows their machine, their account and their preferences better than a ranking function can.

## Decision

- **One interface over many models.** `Models` dispatches to the right provider and does the plumbing every model call needs: retries, pricing, the usage line, the cache. It does not choose models.
- **The choice belongs to the user.** A call may name a model outright; failing that the task's configured model is used; failing that the deployment's default. Named nowhere, the call fails with an error that says so and lists what is available. There is no fourth step where the software picks.
- **A failed model is reported, not replaced.** A rate limit or a 5xx is retried on the same model. Everything else is reported: a model whose provider is not configured, a prompt that will not fit its window, a reply that came back empty. The caller decides what to do next.
- **A task is the kind of work, not the model.** `chronicle`, `describe`, `author`, `review`, `embed`. Its configuration carries the voice, the temperature, the output budget and whether reasoning is allowed, so a caller does not repeat a system prompt everywhere; the shipped tasks name no model at all. The task is also the label on the bill.
- **Offer the choice rather than making it.** `catalogue()` is what is known; `available()` asks the endpoints that can be asked, so a picker shows the models a machine has actually pulled. Capabilities are information for that picker rather than a filter.
- **An unknown model id is taken at face value** as a tag on the local endpoint, so a model that has just been pulled can be named without waiting for a release. Its window and price are left unset because they are not known, so it is neither checked against a limit nor billed.
- **A provider is a wire format and nothing else.** Ollama, Bedrock through Converse, and any OpenAI-compatible or Anthropic endpoint. Keeping choice, retries, pricing and caching out of them is what makes a new provider small to add.
- **Bedrock is signed by hand.** It is the only AWS call the project makes, so SigV4 is a hundred lines against `node:crypto`, held to the published AWS test vector, rather than a dependency. Credentials come from the environment, which is what a Lambda already has.
- **Model identifiers, prices, windows and capabilities are configuration**, shipped as a reference catalogue and overridden by `OPENDND_LLM_MODELS` and `OPENDND_LLM_TASKS` without a release. Prices are to be checked against the provider's price list before anyone is charged.
- **Every call is priced and recorded.** Integer micro-dollars from the model's tariff; local models cost nothing. One usage line per call with task, model, provider, tokens, cost, charge, cache status, world and requester. Streams are billed from the counts the stream reports, marked estimated where a provider reports none. A budget is checked before each call.
- **Structured output is validated here, not taken on trust.** The schema is sent so the provider can constrain generation, and the reply is parsed against the same Zod schema regardless. A failure is handed back with its errors and asked for again. Nothing enters a world without passing the schema it claims to satisfy.
- **Replies are cached by a hash of the model and the request**, which is also the `promptHash` in provenance. A committed cache directory turns AI-authored content into a test that runs offline.
- **AI generation is a second contract, not a variant of the first.** `Generator` stays synchronous and reproducible: the same seed gives the same output for ever, which is what lets a region be filled on demand and refilled identically ([ADR-005](/adr/adr-005-deterministic-generation/)). An `Author` is asynchronous, costs money and will not return the same words twice, so it does not make that promise. What it does promise is the same: output stamped `generated`, traceable, and reviewable before it becomes canon. `provenance.generatedBy` stays the author's id and version; the model goes in `provenance.parameters.model` and the records it was written from in `provenance.derivedFrom`.

## Consequences

- Deployments differ by configuration, not by code. A desktop install names a local model; a cloud deployment names a Bedrock one. Neither needs a flag saying which it is, and neither reaches for the other on its own.
- There is no automatic local-to-cloud failover. That is intended: silently sending a world to a paid endpoint because a local model was busy is worse than an error a person can act on. A front end can offer that fallback, having asked.
- A local reasoning model given a small output budget will spend all of it thinking and return nothing, so the prose tasks turn reasoning off, and an empty reply is an error that names the cause.
- Bedrock streaming is not implemented, because ConverseStream frames its events in AWS's binary event-stream format. `stream` returns one chunk there instead.
- OpenAI's strict `json_schema` mode requires every property to be required; a Zod schema with optional fields will not satisfy it, and validation happens here either way.
- The consistency checker's prose scanner ([ADR-008](/adr/adr-008-consistency-checking/)) is the next author, and now has somewhere to run.
