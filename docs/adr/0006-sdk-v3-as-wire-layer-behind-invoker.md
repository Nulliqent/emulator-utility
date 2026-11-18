---
status: accepted
date: 2026-11-18
decisions: evidence-driven; stack confirmed by D-7
---
# AWS SDK for JavaScript v3 is the wire layer, loaded lazily per Service behind one Invoker

All Calls go through one `OperationInvoker` interface. Its implementation uses the published `@aws-sdk/client-*` packages through a generated registry of 436 dynamic imports, so each Service's client is a separate lazy chunk. Commands are looked up by Operation name at runtime. The SDK already implements all six wire protocols the emulator serves (restJson1 260 Services, awsJson1_1 102, awsJson1_0 51, awsQuery 15, restXml 4, ec2Query 1), plus retries, signing and middleware for the Request Inspector. The spec also asks for SDK v3 snippets. The SDK checked (3.1171.0) has a client for every Service tried, including the newest ones (`s3files`, `lambda-microvms`, `simpledbv2`).

## Considered options

- **A generic Smithy-driven client** built from the emulator's models: no drift and no 436 dependencies, but it means writing and testing six protocol serializers. A middle path exists: feed schemas compiled from the models into the SDK's own protocol classes in `@aws-sdk/core` (`AwsJson1_0Protocol`, `AwsRestJsonProtocol`, ...). Those are semi-internal APIs, so this stays a later option behind the same interface.
- **SDK in the Gateway (Node)**: dynamic `import()` without bundling, but see ADR-0003.

## Consequences

- An Operation the model has and the pinned SDK lacks returns `sdk-missing`. The Explorer then offers the raw request built from the model.
- All `@aws-sdk/client-*` packages are bumped together. The Catalog records SDK support per Operation, so a bump shows up as a diff.
- The install is large (EC2 alone is about 18 MB unpacked). Phase 0 measures the build cost before committing.
