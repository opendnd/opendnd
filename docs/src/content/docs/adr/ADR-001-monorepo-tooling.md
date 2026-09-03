---
title: "ADR-001: Bun and projen monorepo"
description: One repository, Bun workspaces, Turborepo, projen-generated configuration, and a fixed folder contract.
---

**Status:** Accepted, 2026-09-03

## Context

OpenDnD is being rebuilt from scratch on the `next` branch of `opendnd/opendnd`. The old code lives in a dozen sibling repositories last touched in 2020. We want one repository with every configuration file generated from code and a fixed folder layout, and no dependency on any other organisation's internal tooling.

The off-the-shelf projen monorepo toolkits we looked at assume pnpm. We prefer Bun.

## Decision

- One monorepo. Bun is the package manager and test runner, Turborepo orchestrates tasks, projen generates every configuration file.
- Projen components live in-repo at `packages/@opendnd/projen`: a Bun monorepo project, a Bun workspace project, Bun test configuration and docs-site wiring. Root config lives in `projenrc/`.
- Folder contract: a single Starlight docs site at `/docs`; libraries under `packages/@opendnd/*`; deployables under `apps/@opendnd/*`; web front ends under `sites/@opendnd/*`. Every sub-project is scoped `@opendnd`.
- Dependency versions are declared once in `packages/@opendnd/projen/src/versions.ts`.
- `AGENTS.md` is the canonical contributor guide; `CLAUDE.md` is generated as a pointer.

## Consequences

- No third-party monorepo toolkit. Layout enforcement at synth time, agent rule bundles and similar conveniences are added to our own components as they are needed.
- The default release branch is `main`; `next` becomes `main` when the rebuild replaces the old CLI.
