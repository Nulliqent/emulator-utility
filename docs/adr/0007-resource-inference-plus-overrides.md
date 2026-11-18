---
status: accepted
date: 2026-11-18
decisions: evidence-driven
---
# Resource Types come from heuristic inference plus typed Overrides, not only Smithy resource shapes

Only 127 of 436 models declare Smithy `resource` shapes, and Kinesis, the design's own example of a generated Service, declares none. Only 2,687 of 19,454 Operations carry `@readonly`. So Resource Types come from naming and shape rules: Root List Operations (`List*`/`Describe*` with no required input; found for 359 of 436 Services), Describe Operations paired by identifier, Child Resource Types keyed by a parent identifier, and Resource Actions from Create/Delete/Update operations that take the identifier. Smithy resources are used where they exist. Overrides win over both. They are typed data per Service, validated against the model when the Catalog builds.

## Consequences

- The rules will be wrong for some Services. Snapshot tests over the top 30 make every change to the rules or Overrides visible in review.
- Services where nothing is inferred (77 today) still work through the API Explorer until someone writes an Override.
