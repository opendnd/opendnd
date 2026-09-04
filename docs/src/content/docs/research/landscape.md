---
title: Landscape research
description: Existing TTRPG data standards, general ontologies for fictional worlds, and the serverless stack survey that shaped the first decisions.
---


Consolidated from three research passes: TTRPG data standards, general ontologies for fictional worlds, and the AWS serverless + local-first stack. Intended to seed `docs/` research pages and the first ADRs.

## 1. Existing TTRPG data standards

| Project | Scope | Format | License | Verdict |
|---|---|---|---|---|
| [5e-database / 5e-SRD-API](https://github.com/5e-bits/5e-database) | 2014 + 2024 rules, 24 collections | JSON + TypeScript schemas, OpenAPI | MIT code, CC-BY-4.0 SRD data | **Align rules shapes to the 2024 tree** |
| [Open5e API v2](https://github.com/open5e/open5e-api) | 34 resources incl. `documents`, `licenses`, `publishers`, `gamesystems`, `rulesets` | Django REST / OpenAPI | Modified MIT | **Adopt its publisher/document/license provenance model** |
| [5etools homebrew schema](https://github.com/TheGiddyLimit/5etools-utils/tree/master/schema/brew) | Broadest rules coverage, edition-aware | JSON Schema | Utils repo unlicensed; data DMCA'd 2024 | Reference only |
| [Foundry VTT dnd5e](https://github.com/foundryvtt/dnd5e) | Actor/Item type split, runtime-validated DataModels | JS | MIT code, CC-BY SRD | Sanity check for VTT consumption |
| [Datasworn](https://github.com/rsek/datasworn) | Ironsworn; JSON Schema as source of truth, multi-language codegen, per-object `source` | JSON Schema + JTD | MIT | **Borrow the discipline** |
| [Universal VTT (.dd2vtt)](https://arkenforge.com/universal-vtt-files/) | Battlemap geometry, LOS, lights, portals | JSON | Informal de facto | **Adopt verbatim for battlemaps** |
| OrcPub `.orcbrew`, D&D Beyond JSON, Roll20, TTS | Various | EDN / undocumented JSON | Mixed / proprietary | Skip |
| [RPG-Schema.org](https://github.com/rpg-schema/) | Aspirational "schema.org for RPGs" | RDF/Turtle | MIT | Empty repo; not adoptable |

**Formal ontologies found:** a 2017 toy `rpg.owl` gist; Franco & Rolim 2018 OntoUML (play structure: Campaign, Session, Encounter, not setting history); GOLEM (CIDOC-CRM based, for fanfiction corpora, active 2026); Drammar, OntoMedia, NOnt (narrative theory). None model a GM's canonical world state; none carry RPG stats.

**Conclusion:** every rules format has zero classes for places, factions, events, eras, or calendars. The only structured setting models are Kanka (Commons Clause, no spec) and World Anvil (proprietary). The setting/history layer is genuinely unowned.

## 2. Vocabulary spine for the setting layer

| Concern | Align to | Why |
|---|---|---|
| Class/property names, JSON-LD context | [schema.org](https://schema.org/Person) `Person`, `Place`, `Organization`, `Event`, `CreativeWork`; `name`, `alternateName`, `description`, `about`, `memberOf`, `location`, `startDate` | Free interop; `Person` already covers fictional. No `FictionalThing` exists (proposals stalled 2013 and 2025) |
| Universe / work / real-analog linkage | Wikidata `from narrative universe` P1080, `present in work` P1441, `fictional analog of` P1074, `narrative role` P5800, `nature of statement` P5102 = in-universe / out-of-universe | Per-statement diegetic flag is the single most reusable idea |
| Events, periods, actors | CIDOC-CRM v7.1.3 shapes: `Event → TimeSpan{begin, end, earliest, latest}`, `Period ⊃ Event`, `Actor = Person | Group`, participants with roles, `E13 Attribute Assignment` | Fuzzy bounds and reified sourced claims |
| Contested facts / canon | CRMinf `Belief{holder, propositions, value}` reified as `Assertion` | "Maesters believe X, Free Folk believe Y" and canon-vs-generated use the same machinery |
| In-world dates | OWL-Time `TemporalPosition{trs, numericPosition | components}` plus Allen relations; calendar definitions per Kanka's schema (months, weekdays, leap rules, moons, eras, year-zero) | No published calendar-definition vocabulary exists; Kanka's JSON is the only practical one |
| Kinship / dynasties | GEDCOM X `Relationship{type: Couple | ParentChild}`, `Fact{type, date, place}`, `Confidence`, `SourceReference`; extend with succession order, legitimacy, house/cadet branch, adoptive heir, non-human reproduction | JSON-native, CC BY-SA |
| Geometry | GeoJSON RFC 7946 geometry + explicit `crs` (IRI, or `{type: "planar", mapId}`); GeoSPARQL Feature/Geometry split; optional S2 cell ids | GeoJSON hard-codes CRS84 so CRS must be out-of-band; H3 is Earth-welded, S2 is planet-agnostic |
| Provenance | PROV-O `wasGeneratedBy`, `wasDerivedFrom`, `wasRevisionOf`, `wasAttributedTo` | Authoring-side lineage incl. generator seed and prompt |
| Texts / works | schema.org `CreativeWork` + NOnt fabula / narration / reference triad | World-events vs the works that tell them vs the mapping |
| Generated history | Simulation-game legends formats: individual `historical_events` plus event *collections* that contain them (a war contains its battles), and link tables from events to figures and entities | The pattern to copy: the collection is what makes a run of events tell one story |
| Procedural geography | Azgaar FMG: `states, provinces, burgs, cultures, religions, rivers, routes, markers, zones`, 8-valued diplomacy matrix, regiments, `options.year/era` | Best "generated geography" model in the wild |

**Practitioner requirements (Kanka, World Anvil, Campfire):** Characters, Locations, Families, Organisations, Items, Events, Calendars, Timelines/Eras, Races/Species *separate from* Ethnicity/Culture, Quests, Journals, Maps (real lat/lon vs image/pixel), Myth/Legend as explicitly untrue in-world content, Conflicts, Titles/Ranks, Languages, Religions.

**Gaps no vocabulary covers (must be minted by OpenDnD):**
1. Canon status tiers: canon / non-canon / proposed / generated / player-authored.
2. Three-way time: in-world time, authoring/publication time, record transaction time.
3. Calendar definitions.
4. Procedural seeds and generator lineage: seed, generator version, parameters, regenerate-vs-frozen.
5. Non-Earth CRS registry (mint IRIs per world).
6. Species vs culture as distinct axes.
7. Faction game-stat profiles (Worlds Without Number, Kingdoms & Warfare) as system-tagged side-cars.
8. Event collections with in-world cause links.

## 3. Content licensing

- SRD 5.1 and SRD 5.2/5.2.1 (May 2025) are CC-BY-4.0 and irrevocable. Excluded: beholder, mind flayer, Strahd, Tiamat, Artificer, Aasimar, all setting lore.
- Ship SRD data with the Foundry-style notice: "This work includes material taken from the System Reference Document 5.2.1 ('SRD 5.2.1') by Wizards of the Coast LLC ... licensed under CC-BY-4.0."
- Keep code (MIT) and content (CC-BY) licenses in separate files.
- ORC is share-alike and cannot be relicensed as CC-BY; OGL 1.0a is reputationally dead. Exclude both from the core corpus; allow as third-party modules with their own notices.

## 4. Stack

### Rejected
- **Aurora DSQL**: GA, free tier, but no extensions at all (no PostGIS, no pgvector), no triggers, 3,000-row write cap per transaction.
- **SQLite on EFS/S3 with concurrent Lambdas**: NFS locking unreliable; single-writer only.
- **OpenSearch Serverless classic**: ~$175–350/mo floor. NextGen (May 2026) scales to zero but 15 s cold start.
- **Meilisearch/Typesense**: always-on.
- **Kubernetes / containers**: out of scope by requirement.

### Viable
- **PGlite v0.4** (Mar 2026): PostGIS + pgvector, Node/Bun, Electron main/utility process officially supported with PID-lock protection, ElectricSQL sync. Single-connection by design.
- **Neon** (runs in AWS regions): scale-to-zero in seconds, PostGIS + pgvector, Free tier 0.5 GB, no monthly minimums since Dec 2025.
- **Aurora Serverless v2 min 0 ACU**: all-AWS, full PostGIS/pgvector, but ~15 s resume and $43.80/mo if never paused at 0.5 ACU.
- **libSQL / Turso**: SQLite everywhere with embedded replicas; single writer per DB; weak geo, sqlite-vec still 0.1.x alpha.
- **Litestream v0.5 VFS**: SQLite reads straight from S3 pages; opt-in single-writer mode.
- **S3 Vectors** (GA Dec 2025): 2B vectors/index, ~100 ms warm, $2.50/M queries. Right home for large shared corpora, not the hot path.
- **PMTiles on S3 + CloudFront**: static vector tiles via range requests, no tile server. Same file read from disk locally via MapLibre's pmtiles protocol. Regenerate with tippecanoe (native) or geojson-vt (TS, small worlds).
- **Hono**: same app on Node, Bun, Lambda (`@hono/aws-lambda`, `streamHandle` on a Function URL), and inside Electron. Lambda SnapStart does not support Node; mitigate with esbuild + Node 22.
- **Electron** over Tauri here: PGlite runs in-process, no sidecar to sign. Apple waives the $99 fee for nonprofits; SignPath Foundation signs OSS Windows builds free.
- **Bedrock**: Claude Sonnet 5 $2/$10 per M tokens, Haiku 4.5 $1/$5, Nova Lite $0.06/$0.24, Titan Embeddings V2 $0.02/M. Meter in-app from the `usage` block of each Converse response; application inference profiles for per-tier cost allocation; reconcile against CUR monthly.
- **Stripe**: nonprofit rate only if ≥80% of volume is donations, so keep a separate donations account. Connect Express with platform-handled pricing has no per-account fees; take an `application_fee`.
- **AWS credits**: TechSoup nonprofit credits $1k–5k/yr; Activate is startups-only.

### Recommended: one Postgres dialect everywhere

| Layer | Local (laptop / Electron) | Cloud (AWS) |
|---|---|---|
| Database | PGlite + postgis + pgvector, NodeFS in app data dir | Neon (AWS region, scale-to-zero); fallback Aurora Serverless v2 min 0 ACU |
| Schema/ORM | Drizzle pg dialect; recursive CTEs for graph; `tstzrange` + GiST exclusion for bitemporal | same migrations, same code |
| Search | `tsvector` + `pg_trgm` | same |
| Vectors | pgvector | pgvector; S3 Vectors for large shared corpora |
| Map | MapLibre GL + `.pmtiles` on disk | same file on S3 + CloudFront |
| API | Hono in Electron utility process | Hono on Lambda Function URL |
| UI | React in Electron | React on S3 + CloudFront |
| AI | Bedrock via user key or platform proxy | Bedrock, inference profiles, in-app metering to DynamoDB |
| Files, exports, module snapshots | local folder | S3 Standard |
| Sync | ElectricSQL shapes cloud → PGlite; writes via API | Neon is source of truth |

Idle cloud cost: roughly $0–20/mo.

**Hardest parity points:** PGlite is single-connection (serialize DB access behind one repository module); tippecanoe is native (bundle per platform or use geojson-vt); extension version drift between PGlite and cloud Postgres (pin and test both engines in CI).

**Runner-up:** libSQL everywhere (local file ↔ Turso per-world DB) if PGlite proves too heavy on desktop, accepting weaker geo and manual bitemporal columns.

## 5. Design patterns adopted

- **Stable ids with a derived twin.** An entity's `id` is a random v4 so renames never break references; a deterministic v5 id derived from a namespace and a name sits beside it so "the same thing by seed" stays computable. For OpenDnD the derived field comes from the seed path, which makes regeneration idempotent.
- **Content-addressed data layers.** Immutable snapshots of resources with deterministic hashes, stacked over a base the way container images stack layers. This *is* the module system: paid, bring-your-own and AI-generated modules are one mechanism with different provenance.
- **Interface-first storage.** Repositories and graph traversal defined as interfaces with database adapters behind them, using recursive CTEs for graph queries in SQL, so the engine can change without touching services.
