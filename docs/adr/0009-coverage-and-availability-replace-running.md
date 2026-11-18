---
status: accepted
date: 2026-11-18
decisions: D-6
---
# Service status is Coverage plus Availability, not "Running / Not running"

The design shows each service as running or not running ("114 / 435"). That model comes from emulators that start services on demand. Here all 436 services are mounted in one process (`core/router/src/lib.rs`), and what actually varies is how much of each is implemented: about 12.2k of 19.4k operations, with about 7.2k answering 501. The Console therefore reports two independent signals:
- **Coverage**: implemented / total Operations, with a level of full, partial or none. It comes from the Catalog, corrected by Observed Status.
- **Availability**: whether the running binary routes the Service at all (Available, Absent or Unknown). It comes from Probes, where `404 UnknownService` means Absent.

The Catalog Entry, the Console API's probe result, the catalog filters and the Home cards are all built on this model, which is why it is recorded here.

## Considered options

- **Keep "Running", meaning at least one implemented operation**: matches the design's copy, but hides that most services are partial, which is the fact developers most need.
- **Coverage only**: misses drift between the source tree and the prebuilt binary in Docker.

## Consequences

- A reader comparing the Console to the design will find different labels and filters on Home and in the catalog. This ADR is the reason.
- Probes must never call write operations. They use a read operation, or an empty input that is expected to fail validation.
