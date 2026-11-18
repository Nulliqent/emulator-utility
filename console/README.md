# AWS Emulator Console (workspace)

The Catalog compiler and the Model Interpreter live here; the Gateway and web app come later (see `docs/console/IMPLEMENTATION-PLAN.md`).

## Prerequisites

- Node 24 or newer (D-13). The CLI runs the TypeScript sources directly by type stripping.
- pnpm 10. If `corepack` is missing (Node 26 does not ship it), use `npx pnpm@10 <command>` in place of `pnpm <command>`.
- `git`, to fetch the reference repos.

```sh
pnpm install
```

## The reference repos

The Emulator source (`aws-emulator`) and the Smithy models (`api-models-aws`) are third-party, read-only repos. They are never committed or modified. Their commits are pinned in `refs.json`, which also holds the expected sweep counts, so moving a pin edits one file.

- `pnpm refs:fetch` clones the pinned commits, sparsely, into `console/.refs/` (git-ignored). `pnpm refs:fetch aws-emulator` fetches only the Emulator, which is all the compiler needs today.
- To use clones you already have, set `CONSOLE_REFS_DIR` to the folder that holds `aws-emulator/` and `api-models-aws/`. They are only read. A clone that is not at the pin gives a warning from `refs:fetch`, and an error when `CI` is set.

**The tests need the refs.** The catalog sweep runs the compiler over all 436 crates, so run `pnpm refs:fetch` (or set `CONSOLE_REFS_DIR`) before `pnpm test`. Without them the sweep fails with that hint.

## Commands

| Command | What it does |
|---|---|
| `pnpm catalog:build` | Compiles the Catalog into `dist/catalog/`. Commit `index.json` and `manifest.json` only; the per-Service files are git-ignored (D-11). |
| `pnpm catalog:check` | Recompiles and fails if the committed index or manifest differ. It lists the Services that changed, then the fingerprints. |
| `pnpm test` | Vitest: the sweep over all crates plus fixture tests of the check command. |
| `pnpm typecheck`, `pnpm lint` | `tsc` and ESLint, including the rule that `packages/model` imports nothing from the browser, React or Node. |

### When `catalog:check` fails

The Emulator source (a model or an Operation's status line) no longer matches the committed Catalog, for example after moving the pin in `refs.json` or editing `categories.json`. Run `pnpm catalog:build`, read the diff of `dist/catalog/index.json` ("Kinesis: 3 Operations now implemented"), and commit `index.json` and `manifest.json`. If you moved the pin, also update `expectedCounts` in `refs.json` to the new counts that `catalog:build` prints.

## Source Status

An Operation with an `ops/<op>.rs` file is Implemented, or Scaffolded when its leading header comment carries `//! SCAFFOLDED, NOT IMPLEMENTED:`. An Operation with no file is Unrouted. `SKIPPED_STUBS.md` is read only to warn when it disagrees (46 entries at the pin were hand-authored later without a HAND-AUTHORED line). The ~46 "listed as SKIPPED but has an ops file" warnings at every build are expected.

## Categories

`catalog/categories.json` maps each Service (keyed by its `api-models-aws` directory name, such as `s3` or `route-53`) to one of 22 Categories, with its crate name. It was seeded from the `SVCS` table of the prototype's All services screen in the UI design. That table has 435 Services; the 436th, `workspaces`, is missing from it, so it was placed in "End-user computing" next to the other WorkSpaces Services. A new crate that is not in the file does not stop the build: it gets a derived id and the "Other" Category and a warning, which the sweep test turns into a failure at the pin so the file is kept complete.

`catalog/custom-ui.json` lists the 10 Custom-Tier Services (D-5).

## Catalog Entry notes

- `probeOp` is the implemented, non-streaming read Operation with no required input whose noun appears in the most Operation names of the Service (ListStreams for Kinesis, DescribeRepositories for ECR), List before Describe before Get. It is chosen by name, so it is read-only by convention, not by proof. A missing `probeOp` (75 Services at the pin) means no implemented, non-streaming read Operation without required input exists, so Availability falls back to an empty-input read, as ARCHITECTURE 6.1 describes.
- `sdkPackage` is `@aws-sdk/client-` plus the sdkId lowercased with spaces as hyphens.
- `rootResourceTypes` (Resource Inference, ticket #14) and `knownIssues` (the Phase 3 Known Issues work) are deferred and absent for now.

## Running the Console

```sh
docker compose up --build        # from the repo root: the Emulator plus the console on 127.0.0.1:9300
```

Open http://127.0.0.1:9300 (it redirects to `/__console/`). The `console` service mounts `.aws/emulator` read-only. Compose 2.24.4 or newer is needed for the e2e override (`!reset`, `!override`).

Host mode (Gateway on 127.0.0.1:9300 plus Vite on port 5173, open `/__console/` there): `pnpm dev`. Both `http://localhost:5173/__console/` and `http://127.0.0.1:5173/__console/` work, as do `localhost:9300` and `127.0.0.1:9300` for the Gateway itself. It defaults to `CONSOLE_EMULATOR_URL=https://127.0.0.1:9297`, `CONSOLE_EMULATOR_HOME=../.aws/emulator` and `CONSOLE_CONFIG_DIR=./.dev-data`; set any of them in the environment to override.

| Piece | Where |
|---|---|
| Gateway (Node 24, TypeScript by type stripping) | `apps/gateway`, `pnpm start` |
| Web app (React 19, Vite, TanStack Router) | `apps/web`, `pnpm build` or `pnpm --filter @console/web dev` |
| Console API contract (zod) | `packages/api-contract` |
| Design tokens and primitives | `packages/ui` (colors only in `src/tokens/tokens.css`; `pnpm lint` bans raw colors elsewhere) |
| Playwright end-to-end tests | `e2e/`, `pnpm e2e` |

The Gateway reads `CONSOLE_EMULATOR_URL`, `CONSOLE_EMULATOR_HOME`, `CONSOLE_CONFIG_DIR` and `CONSOLE_PUBLIC_ORIGIN` (see `apps/gateway/src/config.ts`).

**Network exposure.** The Gateway binds `127.0.0.1` by default and refuses to start on any other address unless `CONSOLE_ALLOW_REMOTE_BIND=1`. The image sets `CONSOLE_HOST=0.0.0.0` and that flag because a container must listen on all interfaces; compose publishes the port on `127.0.0.1` only, so keep it that way. Outside compose, publish it the same way: `docker run -p 127.0.0.1:9300:9300 ...` (never `-p 9300:9300`, which listens on every interface). The same-origin rule (ARCHITECTURE 3.9) and the `Host` check stop other web pages and DNS rebinding from driving the API through your browser. They are not a network boundary: anyone who can reach the port directly (curl-style, no `Origin`) is served, so never publish it beyond loopback.

### End-to-end tests

`pnpm e2e` builds and starts its own compose project (`console-e2e`) with `e2e/compose.e2e.yaml`: other host ports (19297, 19300), its own Emulator home in a named volume, and no fixed container name, so it never touches your own `emulator` container. The first run needs `pnpm --filter @console/e2e exec playwright install chromium`. The Emulator image is aarch64 only, so CI runs the job on an arm runner.
