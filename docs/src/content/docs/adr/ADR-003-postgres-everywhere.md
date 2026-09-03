---
title: "ADR-003: Postgres dialect everywhere, serverless on AWS"
description: Docker Postgres locally, Neon in the cloud, Hono on Lambda, PMTiles on S3, Bedrock for AI, no Kubernetes.
---

**Status:** Accepted, 2026-09-03

## Context

The project must run locally first, later as a desktop app, and deploy to AWS as serverless as possible for a donation-funded nonprofit. Data needs are graph-ish relationships, geospatial tiles with zoom levels, bitemporal history, full-text search and vector embeddings. SQLite was the initial instinct, following GraphFlow v2's local mode.

## Decision

- **One Postgres dialect.** Local development uses Postgres with PostGIS and pgvector in Docker. The cloud uses Neon (running in an AWS region, scale-to-zero) with Aurora Serverless v2 at 0 ACU as the documented fallback. PGlite is reserved for the desktop app so it can share migrations. Aurora DSQL is rejected because it supports no extensions.
- **Schema and queries.** Drizzle in the pg dialect; recursive CTEs for graph traversal; `tstzrange` with GiST exclusion for bitemporal history; `tsvector` and `pg_trgm` for search; pgvector for embeddings, with S3 Vectors only for large shared corpora.
- **API.** Hono, so the same app runs in Node, Bun, on a Lambda Function URL with response streaming, and inside Electron. One route set per resource type. A command-pattern data-operations layer sits under thin REST adapters, with GraphQL possible later.
- **Maps.** MapLibre GL reading PMTiles: from disk locally, from S3 behind CloudFront in the cloud. No tile server.
- **Events.** A versioned event envelope; EventBridge in the cloud.
- **AI.** Amazon Bedrock. Token usage is metered in-app from each response and recorded per user, which is the cost-plus-ten-percent mechanism.
- **Modules.** Content-addressed, immutable snapshots layered over vanilla content, after GraphFlow v2's data-layers design.
- **No Kubernetes and no always-on containers.** GitHub Actions for CI/CD once the local path works.

## Consequences

- SQLite is not used. Geospatial, vector and range features are too weak there, and one dialect keeps local and cloud identical.
- Idle cloud cost should be near zero.
- Parity risks to manage: extension version drift between engines, and a native tile builder that must be bundled per platform or replaced with a TypeScript one for small worlds.
