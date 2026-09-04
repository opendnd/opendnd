# @opendnd/infra

The AWS deployment as CDK: the API on Lambda behind an HTTP API, a Cognito user pool, the outbox drained onto an EventBridge bus, and a bucket for tiles and assets. No VPC, because the database is reached over TLS.

Part of [OpenDnD](https://github.com/opendnd/opendnd), an open ontology, headless API and toolset for building fictional worlds. A project of [OpenHI](https://openhi.org).

Documentation: https://docs.opendnd.org/packages/infra/

Code is MIT. See `CONTENT-LICENSE.md` in the repository root for the
licence covering game content.
