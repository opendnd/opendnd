---
title: "ADR-012: The deployment is serverless and has no network of its own"
description: The API runs on Lambda behind an HTTP API, Postgres is a managed endpoint reached over TLS, and the two stacks per stage separate what holds state from what is replaced.
---

**Status:** Accepted, 2026-09-04

## Context

OpenDnD is free to use and recovers its costs. That makes the cost of an idle deployment a design constraint rather than an operational detail: a world nobody is looking at should cost nothing to keep, and the bill should scale with use, not with uptime. ADR-003 already settled Postgres everywhere and serverless where possible; this is how that is actually built.

The infrastructure also has to be described in code, in this repository, alongside the API it deploys — a deployment that lives in a console is one nobody can review, reproduce or roll back.

## Decision

- **CDK, in `apps/@opendnd/infra`.** The stacks are TypeScript in the same monorepo as the API they deploy, so a change to a route and the permission it needs are one commit.
- **Two stacks per stage.** The persistent stack holds what a deployment must not be able to destroy: the Cognito user pool, the connection secrets and the asset bucket. The service stack holds what is meant to be replaced: the API function, the HTTP API, the event bus and the publisher. A rolled-back service deployment cannot take the user pool, and therefore every account in it, with it. In production both stateful resources are retained on delete and the bucket is versioned.
- **No VPC.** This is the decision the cost of an idle deployment turns on. Postgres is a managed endpoint reached over TLS, so the functions run outside any network of ours and reach Cognito, Bedrock and the database directly. A VPC would mean either a NAT gateway or a set of interface endpoints, both charged by the hour whether or not anyone is using the thing. The consequence accepted in exchange is that the database is reached over the public internet with TLS rather than over private networking.
- **Postgres is not a CloudFormation resource.** It is Neon, or any managed Postgres, and the stack creates only somewhere to put the two connection URLs. Aurora Serverless v2 would be the alternative and would bring the VPC back with it.
- **Two database secrets, and only the migrator gets the second.** The API serves as a role that cannot bypass row-level security ([ADR-011](/adr/adr-011-world-as-tenant/)); the owner can read and write any world's content. So the owner URL is a separate secret, read by the migration function and by nothing that answers a request.
- **Migrations are invoked, not deployed.** The migration function is not on a schedule and is not reachable through the API. A schema change is not something to have happen as a side effect of shipping code.
- **The connection URL travels by reference.** Functions get the secret's identifier, not its value, and resolve it once per cold start. A URL in an environment variable is readable by anyone who can describe the function.
- **One gateway route to the application.** `ANY /{proxy+}` to the Lambda. The API's own route table is generated from the ontology, so mirroring it in the gateway would mean a deployment for every model added and two descriptions of the same thing that could disagree. Authorization is the application's too: it depends on the caller's role in the world being addressed, which a gateway authorizer cannot know.
- **The same Hono app everywhere.** Hono's Lambda handler wraps a `fetch` function, so there is no Lambda variant of any route and nothing can behave differently in a deployment than it does on a machine.
- **The outbox is drained on a schedule.** A publisher runs every minute, claims a page and puts it on an EventBridge bus. Publishing inside the transaction that produced the event would make a write fail whenever the bus is unavailable; this way a write needs only the database, and publishing catches up.
- **Only the API may spend on models.** The Bedrock permission is on the function that answers requests and on nothing else.
- **Log groups are declared.** Created implicitly they have no retention and keep everything for ever, which costs money quietly, and they outlive the function that made them.
- **Stages are enumerated in code.** A stage name that is not defined is refused rather than defaulted, because what differs between stages includes whether the data can be deleted.

## Consequences

- An idle deployment costs the secrets, the log storage and the bucket. There is nothing charged by the hour.
- The database is reached over TLS across the public internet. Neon's connection strings require TLS; a deployment that pointed at something without it would be a mistake this stack cannot prevent.
- Infrastructure is tested by assertion against the synthesized template, with bundling off: fast, hermetic, and needing no AWS account. What that cannot check is whether the bundle runs, so the bundles are also built and loaded, and the API handler is invoked with a real gateway event shape against a real database.
- `$simulate` holds a request while it runs and a gateway request may last 29 seconds, which bounds a synchronous run. Longer histories need the work moved to a queue and a worker, which is a change to that route rather than to the simulation.
- The `@aws-sdk` packages are left out of the bundles because the runtime provides them. That means a bundle cannot be loaded outside Lambda without the SDK resolvable, which is a wrinkle when verifying one by hand.
