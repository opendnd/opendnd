---
title: "ADR-001: Bun and projen monorepo in the OpenHI layout"
description: One repository, Bun workspaces, Turborepo, projen-generated configuration, OpenHI's folder contract.
---

**Status:** Accepted, 2026-09-03

## Context

OpenDnD is being rebuilt from scratch on the `next` branch of `opendnd/opendnd`. The old code lives in a dozen sibling repositories last touched in 2020. We want the repository to work the way the OpenHI monorepo does, without depending on any OpenHI or `@openhi/*` package.

OpenHI uses `@codedrifters/configulator`, which is pnpm-only. We prefer Bun.

## Decision

- One monorepo. Bun is the package manager and test runner, Turborepo orchestrates tasks, projen generates every configuration file.
- Projen components live in-repo at `packages/@opendnd/projen`, ported from the GraphFlow v2 Bun components. Root config lives in `projenrc/`.
- Folder contract mirrors OpenHI: a single Starlight docs site at `/docs`; libraries under `packages/@opendnd/*`; deployables under `apps/@opendnd/*`; web front ends under `sites/@opendnd/*`. Every sub-project is scoped `@opendnd`.
- Dependency versions are declared once in `packages/@opendnd/projen/src/versions.ts`.
- `AGENTS.md` is the canonical contributor guide; `CLAUDE.md` is generated as a pointer.

## Consequences

- No configulator features (agent rule bundles, layout enforcement at synth time). We re-add what we need in our own components.
- The default release branch is `main`; `next` becomes `main` when the rebuild replaces the old CLI.
