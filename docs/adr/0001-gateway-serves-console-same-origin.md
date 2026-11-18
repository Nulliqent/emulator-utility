---
status: accepted
date: 2026-11-18
decisions: D-1 (evidence-driven; follows from treating the emulator as a black box)
---
# The Console reaches the Emulator only through a same-origin Gateway

The design assumed the browser calls the emulator endpoint directly, with CORS. That cannot work here. The emulator refuses every browser request whose `Origin` or `Sec-Fetch-Site` says cross-site, and the allowlist is hard-coded to same-origin only (`vendor/smithy-server-runtime/src/multi_service_router.rs`, `refuse_cross_site_browsers`). It also serves HTTPS with a self-signed CA minted per process. So a small Gateway process serves the Console's pages and passes AWS requests through to the emulator. To the browser, every request is same-origin. The Gateway trusts the emulator's `ca.pem`.

## Considered options

- **Browser direct with CORS**: impossible without editing `vendor/`, which is replaced on every update.
- **Serve the Console from the emulator's own origin** through the vendored `WithExtraRoutes` seam: requests would be same-origin and allowed. Rejected because it means editing `core/router/src/main.rs` ("emitted once, do not edit"), building from source (Linux only, about 100 GB), and dropping the prebuilt Docker image.
- **Browser extension or desktop shell (Electron/Tauri)**: avoids the origin rule, but it is a much heavier product to ship and update.

## Consequences

- The Gateway must enforce for its own origin the same browser rule the emulator enforces: same-origin only. Otherwise any web page could drive the emulator through it (see ADR-0003).
- URLs the emulator hands out (presigned S3 URLs, queue URLs) name `https://127.0.0.1:9297`. The browser cannot fetch them, so the Gateway offers `/emulator-url` for the few cases where the Console must fetch one.
