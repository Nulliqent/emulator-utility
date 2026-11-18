---
status: accepted
date: 2026-11-18
decisions: evidence-driven; confirmed with D-1 and D-2
---
# The browser signs with the Emulator Credentials; the Gateway forwards requests byte for byte

The browser's AWS SDK clients point at the Gateway's origin and sign with the real Emulator Credentials, which the Gateway reads from the emulator's credentials file and hands to its own origin only. The Gateway forwards method, path, query, body and `Host` unchanged, so the signature still verifies at the emulator. It strips only the headers the SDK does not sign (`Origin`, `Referer`, `Cookie`, `Sec-Fetch-*`). AWS paths are proxied at the root, and the Console reserves `/__console/*`, a prefix no S3 bucket name can take. This keeps the Gateway a dumb pipe, which matters for 436 services across 6 wire protocols. It also means the Request Inspector shows the real signed request.

## Considered options

- **Gateway re-signs every request** with the real keys (browser uses placeholder keys): keeps the secret out of the browser, but the Gateway must parse every protocol's signing scope, and S3's chained streaming signatures (`aws-chunked`) break under re-signing.
- **Gateway runs the SDK** (browser posts `{service, op, input}` as JSON): moves all wire handling server-side and simplifies credentials, but the Request Inspector loses the browser-level middleware view, and every call takes an extra hop through a custom RPC.
- **Path-prefixed proxy (`/proxy/<connection>/...`)**: breaks the signature, because the signed path differs from the forwarded path.

## Consequences

- The Gateway must refuse non-same-origin browser requests. Otherwise it would reopen the hole the emulator closes.
- The local secret is visible to the Console page. That is accepted for a loopback-only development tool whose secret already sits in an owner-only file (`.aws/emulator/9297/emulator_credentials`, mode 600) that every process of the same user can read.
- If phase 0 shows that S3 uploads fail to verify through the pass-through, S3 alone falls back to Gateway re-signing.
