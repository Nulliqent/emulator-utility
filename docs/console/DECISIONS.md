# Decisions log

All eleven open questions were answered on 2026-11-18. The user accepted the recommended answer to each. An ADR exists only where a decision is hard to reverse, surprising without context, and the result of a real trade-off; the rest are recorded here only.

| # | Question | Decision | ADR |
|---|---|---|---|
| D-1 | Must the Console work against the unmodified, prebuilt emulator? | Yes. The emulator is a black box: the Console uses only service APIs, `GET /__admin/health`, and the files in `.aws/emulator/<port>/`. Catalog, probing and Reset live in the Gateway. | [0002](../adr/0002-console-lives-outside-the-emulator.md), [0004](../adr/0004-catalog-compiled-from-emulator-source.md), [0010](../adr/0010-scope-this-emulator-only.md) |
| D-2 | Target this emulator only, with one auto-discovered Local Connection in the MVP? | Yes. More Connections to other instances of this emulator come in phase 3. Other emulators are out of scope. | [0010](../adr/0010-scope-this-emulator-only.md) |
| D-3 | Run the Console as a docker-compose service? | Yes: service `console` on `127.0.0.1:9300`, with `.aws/emulator` mounted read-only. A host mode (`pnpm dev`) exists for development. | none: easy to change. Recorded in ARCHITECTURE section 10. |
| D-4 | Reset by restarting the emulator container, controlled by the Console? | Yes, opt-in only: Docker socket mounted plus `CONSOLE_ENABLE_RESET=1`. Otherwise the Console shows `docker compose restart emulator` to copy. The Console warns about Credentials Rotation. | [0008](../adr/0008-reset-is-an-opt-in-container-restart.md) |
| D-5 | Custom-UI Services and their order? | The design's 10. Phase 2: S3, DynamoDB, SQS, Lambda. Phase 3: SNS, EventBridge, Step Functions, CloudWatch Logs, Secrets Manager, Systems Manager. A phase-3 Service is promoted to a Custom Module only if Overrides and Slots fall short. | [0005](../adr/0005-model-driven-by-default-customization-ladder.md) (the list itself is data in `catalog/custom-ui.json`) |
| D-6 | Replace "Running / Not running" with Coverage and Availability? | Yes. | [0009](../adr/0009-coverage-and-availability-replace-running.md) |
| D-7 | Frontend stack? | React 19, TypeScript, Vite, TanStack Router, Query and Table, React Hook Form, Zustand, Vitest, Playwright. | [0011](../adr/0011-typescript-workspace-react-spa-node-gateway.md) |
| D-8 | Gateway language? | TypeScript on Node 22, in the same pnpm workspace. | [0011](../adr/0011-typescript-workspace-react-spa-node-gateway.md) |
| D-9 | Where do Connections and Preferences live? | Connections in the Gateway config file. Preferences (pins, accent, recents, Saved Runs, Observed Status cache) in browser `localStorage`. | none: a small surface, reversible by moving one store. It deviates from the design's "stored only in this browser" because the Gateway must know every Connection to proxy it. Recorded in ARCHITECTURE section 3.10. |
| D-10 | Dark mode timing? | After the MVP. Every color is a design token from day one, and a lint rule bans raw hex outside the token files. | none: no lock-in |
| D-11 | Commit the compiled Catalog? | Commit only `dist/catalog/index.json` and `dist/catalog/manifest.json`. The per-service files are rebuilt in CI and in the Docker build. | none: reversible. Recorded in ARCHITECTURE section 7 and as a note in ADR-0004. |
| D-12 | How do CI and the Docker build get `aws-emulator/` and `api-models-aws/`? (2026-11-18) | Both are third-party reference repos: read-only, never committed or modified. CI and the Docker build fetch them at pinned commits before the Catalog compiler runs. The fingerprint check compares against those pins, and moving a pin is a reviewed change that comes with the rebuilt Catalog. This replaces the repo-root Docker build context described in ARCHITECTURE section 10. Initial pins: `aws/aws-emulator` at `8ae1f15e1239e20a3ab2eb37bf44813feb1807c7`, `aws/api-models-aws` at `00963cb6e3bd2cee061a279682a744bf54e544b2`. | none: reversible |

Decisions taken from the code alone, with no user input, are listed in ARCHITECTURE section 12. The ADRs marked evidence-driven (0001, 0003, 0006, 0007) record those.

## To verify in Phase 0

These assumptions underpin accepted ADRs but have not been tested against a running emulator. Each has a fallback that does not change any user decision.

1. **Pass-through signing survives the Gateway** (ADR-0003). The emulator should verify a SigV4 signature made with `Host` set to the Gateway's host (`127.0.0.1:9300`). Reading `virtual_host.rs` and the signature check in `request_authentication.rs` suggests it will. Test one Operation per protocol: SQS (awsJson1_0), Kinesis (awsJson1_1), Lambda (restJson1), IAM (awsQuery), EC2 (ec2Query), S3 (restXml). *Fallback:* the Gateway re-signs.
2. **S3 uploads survive the pass-through** (ADR-0003). Test `PutObject` and a multipart upload with `requestChecksumCalculation: "WHEN_REQUIRED"`, and check whether `aws-chunked` streaming signatures pass unchanged. *Fallback:* the Gateway re-signs S3 only.
3. **One shared state across access keys.** The engine has no tenant key, but a comment in `vendor/server/src/lib.rs` mentions sharding tenants by access-key id. Test: create a queue with the Emulator Credentials and list it with a key created through IAM or STS. *If state is sharded,* the Console must keep signing with the Emulator Credentials (as designed) and must say so in the Connections screen.
4. **TLS identity inside compose.** The Gateway dials `emulator:9297` and verifies the certificate against `ca.pem` with identity `127.0.0.1`. Confirm that the CA a `0.0.0.0` bind mints names `127.0.0.1`. *Fallback:* `network_mode: service:emulator` and dial `127.0.0.1`.
5. **Prebuilt binary versus source tree.** Probe all 436 Services against the Docker emulator and compare with the Catalog. This sizes how much Observed Status will correct, and whether any Services are Absent.
6. **Bundle cost of 436 SDK clients** (ADR-0006). Measure install size, build time and the largest chunk (EC2). *Fallback:* eager registry for the top 50, and the long tail through a Gateway-side invoker.
7. **Resource Inference quality** (ADR-0007). A person grades the inferred Resource Types for the top 30 Services, and the grades seed the first Overrides.
8. **The 501 shape.** Confirm that a Scaffolded Operation answers HTTP 501 with error code `NotImplemented` on every protocol, including awsQuery and restXml envelopes, so the Invoker's classification is protocol-independent.
