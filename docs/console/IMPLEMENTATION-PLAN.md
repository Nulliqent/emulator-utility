# Implementation plan

The work items are ordered. Each one can be merged and shipped on its own, and leaves `main` working. "Packages" are paths under `console/`. Write tests first for the pure packages (`model`, `forms`, `snippets`). "The Docker emulator" means `docker compose up emulator` from the repo root. Terms follow `GLOSSARY.md`; design detail is in `ARCHITECTURE.md`.

---

## Phase 0: spikes (throwaway code in `console/spikes/`, about 1 week)

Each spike ends with a short result note appended to `DECISIONS.md` under "To verify in Phase 0".

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| P0.1 | Pass-through signing proxy | A browser page served by a ~50-line Node proxy on `127.0.0.1:9300` calls, through the proxy, SQS `ListQueues`, Kinesis `ListStreams`, Lambda `ListFunctions`, IAM `ListUsers`, EC2 `DescribeVpcs` and S3 `ListBuckets`, `PutObject` (5 MB) and a multipart upload, all signed with the Emulator Credentials. Each returns 2xx. The note records the result for each protocol and whether S3 needs the re-sign fallback. | `spikes/proxy` |
| P0.2 | Tenancy and TLS checks | Recorded answers to verify items 3 (shared state across keys) and 4 (CA identity when dialing `emulator:9297`). | `spikes/proxy` |
| P0.3 | SDK bundle cost | Vite build of a generated registry of 436 lazy `@aws-sdk/client-*` imports. Install size, cold build time and the largest chunk are recorded. Go if the build takes under 3 minutes and the largest chunk is under 2 MB gzipped. Otherwise the note picks the ADR-0006 contingency. | `spikes/sdk-registry` |
| P0.4 | Inference and drift report | A script runs draft Resource Inference over all 436 models and probes all 436 Services on the Docker emulator. A person grades the top 30 inferred Resource Types (good / fixable by Override / wrong). The Absent count and the 501 envelope per protocol (verify items 5 and 8) are recorded. | `spikes/inference` |

---

## Phase 1: MVP, every Service reachable

### Foundations

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 1.1 | Workspace skeleton | `console/` pnpm workspace; `tsconfig.base.json`; ESLint with boundary rules (packages cannot import React, the DOM or Node APIs; features cannot import each other); Vitest; CI runs lint, typecheck and test. Nothing under `aws-emulator/` is touched. | root, all |
| 1.2 | Model Interpreter | `interpret(smithyJson[]) -> UiModel` merges multi-file crates; classifies each operation as read or write; extracts pagination and streaming; groups operations. A sweep test over all 436 crates passes with zero throws and 19,454 operations. | `packages/model` |
| 1.3 | Operation Status scan | Header-line detection of `SCAFFOLDED, NOT IMPLEMENTED`, and `SKIPPED_STUBS.md` minus `HAND-AUTHORED` lines. Counts match the inventory (about 12.2k implemented, 7.2k scaffolded, 92 skipped before hand-authored ones are subtracted). Kinesis `GetShardIterator` is implemented and `SubscribeToShard` is not unrouted. | `packages/catalog-compiler` |
| 1.4 | Resource Inference v1 | Rules 1 to 7 from ARCHITECTURE 3.3. Snapshot tests for the top 30 Services, approved by a person. At least 359 Services get one or more Resource Types. Kinesis gets `stream` (ListStreams + DescribeStreamSummary) and the child type `consumer`. | `packages/model` |
| 1.5 | Overrides format | Typed `defineOverrides()`. The compiler validates every operation and member name an Override mentions against the model, and an unknown name fails the build. Ships with the Overrides P0.4 found, including Cognito `ListUserPools` and Lightsail `GetInstances`. | `catalog/overrides`, `packages/catalog-compiler` |
| 1.6 | Catalog compiler | `pnpm catalog:build` writes `index.json`, `manifest.json` (with fingerprint), and per-service `*.ui.json` and `*.docs.json` files. Categories come from `catalog/categories.json` (all 436 mapped; seeded from the design), tiers from `custom-ui.json` (10 entries), and the `probeOp` for each Service. `pnpm catalog:check` fails after an `ops/*.rs` status change. Only `index.json` and `manifest.json` are committed. CI runs the check. | `packages/catalog-compiler`, `catalog/` |
| 1.7 | SDK support column | The compiler marks each operation `sdk: supported` or `missing` against the pinned `@aws-sdk/client-*` set, and prints a report of missing operations. | `packages/catalog-compiler`, `packages/invoker` |
| 1.8 | Console API contract | zod schemas and types for every endpoint in ARCHITECTURE section 4, plus the SSE event types. Both apps import them. | `packages/api-contract` |

### Gateway

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 1.9 | Gateway: static, meta, Local Connection | Serves the SPA and the Catalog under `/__console/`. `GET /meta` works. The Local Connection is discovered from `CONSOLE_EMULATOR_HOME`. `GET /connections` and `GET /connections/{id}/credentials` (no-store) work. The credentials-file watcher emits `credentials-rotated` over SSE. The connections file is created in `CONSOLE_CONFIG_DIR`. | `apps/gateway` |
| 1.10 | Gateway: pass-through proxy | Root-path proxy that keeps Host, strips Origin, Referer, Cookie and `Sec-Fetch-*`, refuses cross-site requests with 403, pins the CA with identity `127.0.0.1`, and streams both ways. Unit tests against an HTTPS stub that verifies SigV4. The P0.1 calls pass through the real Gateway. | `apps/gateway` |
| 1.11 | Gateway: health, checks, probe | `/health` (latency, TLS state), `/checks` (reachable, TLS trusted, credentials accepted via `sts:GetCallerIdentity`, S3 path-style, Gateway same-origin), `/probe` (concurrency 8, never a write operation, 404 `UnknownService` means Absent, results cached per epoch). Contract suite green against the Docker emulator. | `apps/gateway` |
| 1.12 | Compose service | `console/apps/gateway/Dockerfile` (multi-stage; runs `catalog:build` from a repo-root context with a tight `.dockerignore`) and a `console` service in `docker-compose.yaml` on `127.0.0.1:9300` with `.aws/emulator` mounted read-only. `docker compose up` serves the shell. Image under 150 MB. | `apps/gateway`, repo `docker-compose.yaml` (a change to make in implementation, not in this plan) |

### Invoker and engines

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 1.13 | Operation Invoker | A generated `sdk-registry.gen.ts`; clients per (Connection, Service) with the Gateway's origin as endpoint, credentials from the API, rebuilt on a new epoch; `forcePathStyle` for S3. `invoke` and `paginate`. Classifies results as `not-implemented`, `service-error`, `auth`, `network`, `unknown-service` and `sdk-missing`. Unit tests use a mock handler. Integration: SQS `CreateQueue` then `ListQueues` against the Docker emulator. | `packages/invoker` |
| 1.14 | Call Capture and Call Log | Middleware records Call Records with their attempts. Ring buffer of 5,000. Bodies truncated at 256 KB. Call Origin tagging. Subscribe API. | `packages/invoker` |
| 1.15 | Observed Status store | A 501 `NotImplemented` marks an operation scaffolded, and any other answer marks it implemented. Stored per Connection in `localStorage` under `console:v1:`, cleared when the catalog fingerprint changes. Coverage recomputes from it. | `packages/invoker`, `apps/web` |
| 1.16 | Form Engine | `formFor`, `toInput` and `fromInput` for every field kind in ARCHITECTURE 3.6, with recursion capped at depth 6 (JSON fallback beyond). Sweep: a FormSpec for every operation; round-trip tests pass. | `packages/forms` |
| 1.17 | Snippet Generator | SDK v3, CLI and HTTP output; golden files for SQS `SendMessage`, Lambda `Invoke`, S3 `PutObject` and EC2 `DescribeInstances`. Snippets name `https://127.0.0.1:9297`, the credentials file and `AWS_CA_BUNDLE`. | `packages/snippets` |

### Web app

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 1.18 | Design tokens and primitives | All visual-system values from the spec as CSS tokens (light only). About 25 primitives (button, segmented control, search field, table, badge, status dot plus label, card, tabs, dialog, toast). Lint rule bans hex literals outside the token files. Axe passes on a primitives story page. | `packages/ui` |
| 1.19 | App shell | Sidebar (Local Connection, sections, pinned services, region and account footer), toolbar (breadcrumb, search, health pill from SSE and `/health`), routing, Preferences store, credentials-rotated banner. Phone-width layout stacks the sidebar. | `apps/web/app` |
| 1.20 | Service catalog | All 436 Services. Filters: text (name or SDK package), Category, Tier, Coverage level, Availability (probes run when this filter is first used). Pill view and card view. Coverage bar with numbers. "Absent" shown as a hollow dot plus text. | `apps/web/features/catalog` |
| 1.21 | API Explorer | Operation list with READ/WRITE and Not implemented / Not routed badges; Operation Form and JSON tab; resource suggestions; Send; response panel with a neutral 501 card showing the source path; SDK/CLI/HTTP preview; Saved Runs in Preferences; `sdk-missing` shows the model-built raw request. Playwright: SQS `CreateQueue` then `SendMessage`, and a scaffolded operation renders the 501 card. | `apps/web/features/explorer` |
| 1.22 | Request Inspector | Table, filters (text, service, outcome including not-implemented, slow over 500 ms), probe and discovery Calls hidden by default, detail with Request / Response / Timing tabs, Replay, Edit in API Explorer, Copy as SDK / CLI / cURL, Pause, Clear. The failed count excludes 501s. | `apps/web/features/inspector` |
| 1.23 | Generated View | `GeneratedServiceModule`: Resource Type tabs, list with pagination, lazy describe enrichment for visible rows, detail panel with ARN copy, tags and raw JSON, actions through the Operation Form; disabled tabs and actions for Scaffolded Operations with "Try anyway". Playwright: Kinesis create stream, list it, update shard count. | `apps/web/features/generated` |
| 1.24 | Connections screen (read-only) | Shows the Local Connection, the checks list, client behaviour settings (max attempts, timeout) saved to the Gateway, and the "same settings in your code" snippet. | `apps/web/features/connections`, `apps/gateway` |
| 1.25 | Home v1 | Stat cards: Operations implemented, Services available (or "not yet probed"), API calls this session with median latency, failed calls. Pinned service cards. Latest calls. | `apps/web/features/home` |

**MVP exit:** the Playwright flows in 1.21 and 1.23 pass in CI against `docker compose up`, and the catalog, Gateway contract and inference sweeps are green.

---

## Phase 2: daily-driver Custom Modules

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 2.1 | `/emulator-url` fetch | The Gateway streams a URL the emulator handed out, only when its origin matches the Connection endpoint (403 otherwise). | `apps/gateway` |
| 2.2 | S3 module | Bucket list and create; folder breadcrumb; object table; drag-and-drop upload with `lib-storage` (8 MB parts, progress); download and preview via 2.1; delete and copy; presigned URL generator with expiry. Other S3 Resource Types stay as Generated tabs. Playwright: upload 20 MB, preview, presign, delete. | `apps/web/modules/s3` |
| 2.3 | DynamoDB module | Tables stay Generated. Custom item browser: scan or query with key conditions, an item editor (`lib-dynamodb`, JSON and typed views), put and delete item. | `apps/web/modules/dynamodb` |
| 2.4 | SQS module | Queue detail with attributes; send (reusing the explorer form plus Field Hints); receive and delete messages; purge; DLQ link. | `apps/web/modules/sqs`, `catalog/overrides/sqs.ts` |
| 2.5 | Lambda module | Functions Generated, plus Slots: an Invoke panel (payload, result, log tail from CloudWatch Logs) and a code and configuration summary. | `apps/web/modules/lambda` |
| 2.6 | Discovery and Rescan | Runs Root List Operations (skipping scaffolded ones) with concurrency limits, tagged `discovery`. Counts per Service in the sidebar and on Home. Recently viewed Resources kept in Preferences. | `apps/web/features/home`, `packages/invoker` |
| 2.7 | Command palette | ⌘K over Services, Operations, Resource Types and discovered Resources; type tabs with counts; actions from `paletteProviders`; ⌘P pins a Service. | `apps/web/features/palette` |
| 2.8 | Home v2 | Availability by Category chart (Coverage level, with Absent counted separately), recently viewed Resources, Rescan button. | `apps/web/features/home` |

---

## Phase 3: breadth and polish

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 3.1 | Reset | Lifecycle adapter (Docker Engine API) active only with the socket mounted and `CONSOLE_ENABLE_RESET=1`; otherwise `409` and the copy-command dialog. The confirm dialog warns about Credentials Rotation. After a restart: health returns 200, the epoch is bumped, clients are rebuilt and caches cleared. Tested with and without the socket. | `apps/gateway`, `apps/web/features/home` |
| 3.2 | SNS, EventBridge, Step Functions, CloudWatch Logs, Secrets Manager, Systems Manager | For each: Overrides and Slots first (for example publish, put events, start execution with a history view, a log stream tail, reveal secret value, parameter tree). Promoted to a full Custom Module only where a person reviewing it says Generated falls short. One item per Service, shippable separately. | `catalog/overrides`, `apps/web/modules/*` |
| 3.3 | Overrides for the next 40 Services | Ranked by Call Log usage and P0.4 grades. Snapshot tests updated. | `catalog/overrides` |
| 3.4 | Known Issues | The compiler indexes `aws-emulator/issues/things-that-do-not-work`. A count and list appear per Service and per Operation, linked from the 501 card. | `packages/catalog-compiler`, `apps/web` |
| 3.5 | Export HAR | The inspector exports the filtered Call Log as HAR 1.2, and Chrome DevTools can import it. | `apps/web/features/inspector` |
| 3.6 | Additional Connections | Connections CRUD in the Gateway (static-credentials source for other instances of this emulator); activation; `x-console-connection` routing; per-Service endpoint overrides. | `apps/gateway`, `apps/web/features/connections` |
| 3.7 | Nightly live sweep | CI job invokes every implemented read operation with no required input and reports any 5xx other than 501 as catalog/runtime drift. | `packages/catalog-compiler` (script) |

---

## Phase 4: after the MVP line

| ID | Item | Acceptance criteria | Packages |
|---|---|---|---|
| 4.1 | Dark mode | A dark token set under `prefers-color-scheme` plus a manual toggle saved in Preferences; every screen reviewed; contrast at least 4.5:1. | `packages/ui`, `apps/web` |
| 4.2 | Gateway-side invoker | For `sdk-missing` operations: the Gateway loads a newer SDK client in Node and executes the call, still captured in the Call Log through a server-sent record. Only if the 1.7 report shows meaningful gaps. | `apps/gateway`, `packages/invoker` |
