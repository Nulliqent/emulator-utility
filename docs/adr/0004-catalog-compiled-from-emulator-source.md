---
status: accepted
date: 2026-11-18
decisions: D-1, D-11
---
# The Catalog is compiled at build time from the emulator's own service crates

The Console's list of Services and Operations, their Operation Status, and the inferred Resource Types are compiled at build time from `aws-emulator/services/*/smithy-model/*.json` and the `src/ops/*.rs` scaffold markers into versioned, per-service JSON. The Console loads these lazily. The models total 123 MB (largest 5.2 MB), so loading them at runtime in the browser is out. The crate models are what the emulator was generated from, so they match it better than `api-models-aws/` or the SDK, both of which drift (the Kinesis SDK already has 13 commands the emulator model lacks). A fingerprint check fails CI when the emulator tree changes without a rebuilt Catalog. Observed Status from real 501 answers corrects drift against the prebuilt binary at runtime.

Accepted with the commit policy from D-11: only `index.json` and `manifest.json` are committed. The per-service files are rebuilt in CI and in the Docker build.

## Considered options

- **Runtime introspection endpoint in the emulator**: exact, but no safe place to add it (ADR-0002).
- **Parse the generated `core/router/src/lib.rs`**: it lists crates but no operations or status, and its format is codegen-private.
- **Use the SDK's bundled schemas as the source**: covers only what the npm release has, not what the emulator does.

## Consequences

- Adding a service to the emulator needs no Console code, only `pnpm catalog:build`.
- The Gateway image build needs the `services/` models and ops sources in its Docker context.
