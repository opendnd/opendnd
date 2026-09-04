---
title: OpenDnD
description: An open ontology, headless API and toolset for building fictional worlds.
---

OpenDnD is a rebuild of the 2016 to 2020 OpenDnD generators as a project of [OpenHI](https://openhi.org), a 501(c)(3). It follows OpenHI's vision: one ontology, authored in [OURS](https://ours.dev), drives a headless event-driven API, and applications are built on top of it.

## What it will power

One application, signed into once, holding several ways of working on the same world. They are features rather than products because they are views of one ontology: a place on the map, its article in the wiki and the county in a campaign are the same record, and an edit in any of them is an edit to it.

- **The map**: a Google-Maps-like view with zoom levels, from a planet down to a battle-map square.
- **The wiki**: every record as an article, with what links to it, its in-world history and its authoring history.
- **Characters**: design them, from ancestry and culture through to a sheet.
- **Campaigns**: run them, with the world's own history as the backdrop.
- **Studio**: author any resource directly, for whoever wants the ontology itself.
- **Procedural and AI generation**, everywhere in it: fill in any region at any point in time, deterministically first and with AI on top, kept consistent by the ontology. AI runs on whichever model is chosen, on the user's own machine or in the cloud, with no change to anything above it.
- **Modules**: vanilla content, bring-your-own content, paid content, and AI-generated content are all the same immutable, content-addressed object.

Everything is free to use. Features that cost money to run, such as AI token spend, are offered at cost plus ten percent. Donations go to OpenHI, which sponsors the project.

## Where to start

- [Authoring the ontology](/guides/authoring-the-ontology/): how to add a model.
- [Research](/research/landscape/): what already exists and what we align to.
- [Ontology coverage](/research/coverage/): every concept the old repositories named, and where it lives now.
- [Architecture decisions](/adr/adr-001-monorepo-tooling/): the choices, in order.
