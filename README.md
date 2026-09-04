# OpenDnD

An open ontology, headless API and toolset for building fictional worlds. A project of [OpenHI](https://openhi.org), a 501(c)(3).

One ontology, authored in [OURS](https://ours.dev), drives a headless event-driven API, and one application is built on top of it: a map that zooms from a planet to a five-foot battle-map square, a wiki of every record and its history, character design, and campaigns to run. They are features rather than separate products because they are views of the same ontology.

Everything is free to use. Features that cost money to run, such as AI token spend, are offered at cost plus ten percent. Donations go to OpenHI, which sponsors the project.

## Documentation

The docs site carries the architecture decisions, the guide to authoring the ontology, and a page per package.

```bash
cd docs && bun run dev
```

## Getting started

```bash
bun install && bunx projen
bunx projen build
bunx projen test
```

`AGENTS.md` is the contributor guide: repository layout, tooling rules and conventions.

## Layout

| Folder | Purpose |
|---|---|
| `docs` | The docs site: research, architecture decisions, guides, package pages. |
| `packages/@opendnd/*` | Shared libraries: the ontology and its tooling, generators, simulation, spatial identity, model access. |
| `apps/@opendnd/*` | Deployables: the API, generation workers, infrastructure, desktop app. |
| `sites/@opendnd/*` | Web front ends. |

## Licence

Code is MIT. Game content is CC-BY-4.0 under SRD 5.2.1; see `CONTENT-LICENSE.md`.
