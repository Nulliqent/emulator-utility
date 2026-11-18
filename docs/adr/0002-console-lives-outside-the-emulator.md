---
status: accepted
date: 2026-11-18
decisions: D-1
---
# The Console does not modify the emulator; its API lives on the Gateway

The Console lives in a new top-level `console/` workspace and changes nothing under `aws-emulator/`. Every place where emulator-side admin endpoints could go is regenerated or frozen: `vendor/` is "replaced on update", `core/router/src/lib.rs`, `core/router/Cargo.toml` and the root `Cargo.toml` are re-rendered on every service add, and `core/router/src/main.rs` is marked "do not edit". The Docker image does not build this repo at all; it installs a prebuilt RPM. So catalog, health aggregation, probing and Reset are a **Console API** served by the Gateway, using only the emulator's public surface: service APIs, `GET /__admin/health`, and the files it writes to `~/.aws/emulator/<port>/`.

Accepted: the user chose to treat the emulator as a black box: the prebuilt Docker image, unmodified (D-1). The Console API is still shaped around emulator concepts, so the emulator could serve it if that ever changes.

## Considered options

- **New `/__admin/catalog`, `/__admin/state`, `/__admin/reset` in the emulator**: they would give exact runtime operation status. But they need edits to frozen files, a source build the Docker setup does not do, and engine support that does not exist (the engine cannot enumerate, serialize or clear state).
- **A separate Rust binary that links the router and adds routes**: needs a new workspace member, and the root `Cargo.toml` is re-rendered. It also inherits the 100 GB, Linux-only build.

## Consequences

- No state snapshot. Reset is a process restart.
- Operation status from the source tree can disagree with the binary in Docker. Observed Status from real answers corrects it at runtime (ADR-0004).
- The Console API names emulator concepts, not Gateway internals, so the emulator could serve it later if the project ever builds from source.
