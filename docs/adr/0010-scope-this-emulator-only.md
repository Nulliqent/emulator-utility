---
status: accepted
date: 2026-11-18
decisions: D-1, D-2
---
# The Console targets this emulator only, starting with one auto-discovered local Connection

The design reads like a generic client for any AWS-compatible endpoint: `http://localhost:4566`, `test`/`test` keys, teammates' machines, import from `~/.aws/config`. The Console instead targets this emulator, unmodified, and relies on its specifics:
- HTTPS with a per-start CA (`ca.pem`)
- per-start keys in `emulator_credentials`
- `GET /__admin/health`
- `501 NotImplemented` for Scaffolded Operations
- `404 UnknownService` for unrouted services
- the fixed account `000000000000`

The MVP ships one Connection, discovered from the mounted `.aws/emulator` folder. More Connections to other instances of this same emulator come in phase 3. Compatibility with LocalStack, moto or real AWS is out of scope.

## Consequences

- Operation Status, Availability, Reset and credential rotation all assume this emulator's behaviour. Supporting another emulator later would mean an adapter per target, not a settings change.
- The design's "Browser CORS allowed" connection check is replaced by "Gateway same-origin", and its `4566` defaults by `9297`.
