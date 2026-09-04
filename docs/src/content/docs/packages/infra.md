---
title: "@opendnd/infra"
description: The AWS deployment as CDK, with no network of its own and nothing charged by the hour.
---

Two stacks per stage. See [ADR-012](/adr/adr-012-aws-deployment/) for why it is shaped this way.

```bash
cd apps/@opendnd/infra
bunx projen synth              # templates into cdk.out
bunx projen diff               # what a deployment would change
bunx projen deploy             # needs AWS credentials
```

A stage comes from context: `cdk deploy --all -c stage=prod`. A stage that is not in `STAGES` is refused rather than guessed at, because what differs between stages includes whether the data can be deleted.

## What it creates

**`OpenDnD-{stage}-Persistent`** — the things that must outlive the code using them.

| | |
|---|---|
| Cognito user pool and web client | Email sign-in, verified addresses, a 12-character minimum. The client has no secret and uses the authorization code grant, which is the only flow safe without one. |
| `opendnd/{stage}/database-url` | The URL for the role the API serves as. |
| `opendnd/{stage}/database-admin-url` | The URL for the owner. Read by the migration function and nothing else. |
| Asset bucket | Private, TLS-only, CORS for range requests so map tiles can be read directly. |

In production the pool and the bucket are retained on delete and the bucket is versioned.

**`OpenDnD-{stage}-Service`** — the things meant to be replaced.

| | |
|---|---|
| API function | Node 22 on ARM, the same Hono app the local server runs. |
| HTTP API | One route, `ANY /{proxy+}`. |
| Event bus | `opendnd-{stage}`. |
| Publisher function and schedule | Drains the outbox every minute. |
| Migration function | Invoked deliberately. Not scheduled, not reachable through the API. |

## Setting up a deployment

1. `bunx projen deploy` both stacks.
2. Create the Postgres database (Neon, or any managed Postgres reachable over TLS). Make two users: an owner, and `opendnd_app` with no ownership and no superuser rights.
3. Put the two URLs in the secrets the persistent stack created. The app URL **must not** be the owner: an owner bypasses the row-level security that separates one world from another, and the tenancy would silently stop working.
4. Invoke the migration function, whose name the service stack outputs. It applies the SQL and grants `opendnd_app` access to every table.
5. Point a client at the `ApiUrl` output, with the `UserPoolId` and `UserPoolClientId` for sign-in.

## What is not here

No VPC, no NAT gateway, no database instance. That is the point: an idle deployment costs the secrets, the log storage and the bucket, and nothing is charged by the hour. The exchange is that the database is reached over TLS across the public internet rather than over private networking.

## Testing infrastructure

The specs assert against the synthesized template with bundling switched off — fast, hermetic, and needing no AWS account. They check the things that would be expensive or dangerous to get wrong: that no VPC or NAT gateway exists, that the connection URL travels by reference and never by value, that only the migration function can read the owner credentials, that only the API can spend on models, that the migrator is neither scheduled nor exposed, and that a production deployment cannot delete the user pool.

What a template assertion cannot tell you is whether the code runs, so the bundles are built and loaded too, and the API handler is invoked with a real gateway event shape against a real database.
