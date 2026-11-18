---
status: accepted
date: 2026-11-18
decisions: D-7, D-8, D-13
---
# One TypeScript pnpm workspace: a React SPA and a Node Gateway sharing framework-free packages

The Console is a single pnpm workspace under `console/`:
- The SPA uses React, TypeScript and Vite, with TanStack Router, Query and Table, React Hook Form, and Zustand.
- The Gateway is TypeScript on Node 24 (first written as Node 22; see D-13).

Both import the same framework-free packages:
- `model`: Model Interpreter and Resource Inference
- `forms`: the Form Engine core
- `snippets`
- `api-contract`: zod schemas for the Console API

The Catalog compiler also runs in Node. One language means the Catalog and Console API types are defined once and checked on both sides of the wire.

## Considered options

- **Rust (axum) Gateway**: one static binary in the emulator's own language. But the Catalog and API types would have to be duplicated or generated, and the compiler would need porting or a second toolchain.
- **Angular, Svelte or Solid for the SPA**: workable. React was chosen for its data-grid and form ecosystem and for the lazy-route tooling that 436 per-service chunks need.

## Consequences

- `packages/*` must not import React, the DOM or Node APIs. A lint boundary rule enforces this, so the core stays portable if the view layer ever changes.
