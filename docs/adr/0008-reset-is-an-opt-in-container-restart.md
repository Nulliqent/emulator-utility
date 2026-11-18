---
status: accepted
date: 2026-11-18
decisions: D-4
---
# Reset restarts the emulator container, and the Console may do it only when explicitly opted in

The emulator keeps all state in memory, and its engine has no API to clear, snapshot or restore that state (`vendor/engine/src/lib.rs`). A Reset is therefore a process restart. The Gateway restarts the `emulator` container through the Docker Engine API, and only when the Docker socket is mounted **and** `CONSOLE_ENABLE_RESET=1`. Otherwise the Console shows `docker compose restart emulator` to copy. Mounting the socket gives the Console container control of the whole Docker daemon, so that power is never on by default.

## Considered options

- **Per-service delete sweeps** (call every Delete operation for every discovered Resource): incomplete by construction. About 7.2k operations are scaffolded, and some state has no delete operation at all.
- **Always mount the socket**: the simplest UX, but a large privilege for a convenience button.
- **No Reset button at all**: hides a task the design puts on Home.
- **Run the emulator with `--auth off`** so a restart does not break callers: changes the emulator's security posture for everyone on the machine.

## Consequences

- Every restart mints new Emulator Credentials. The Gateway's file watcher bumps the credentials epoch, the SPA rebuilds its clients, and the Console warns that other apps holding the old keys must reload them. The confirm dialog says so before the restart.
- The lifecycle adapter knows Docker. That coupling is acceptable because the deployment is the user's docker-compose (D-3).
