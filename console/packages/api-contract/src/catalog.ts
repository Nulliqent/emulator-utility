import type { Protocol } from "@console/model";

/** One Service's summary in the compiled Catalog index (`<CATALOG_BASE>/<fingerprint>/index.json`). Written by the compiler, read by the web app. */
export interface CatalogEntry {
  serviceId: string;
  crate: string;
  title: string;
  sdkId: string;
  signingName: string;
  /** `@aws-sdk/client-` + sdkId lowercased with spaces as hyphens. Whether each Operation has a Command is ticket #13. */
  sdkPackage: string;
  protocol: Protocol;
  category: string;
  tier: "custom" | "generated";
  /** Source Status counts. `level` is derived from them; the web app recomputes it with `coverageOf` so Observed Status can override. */
  coverage: {
    implemented: number;
    scaffolded: number;
    unrouted: number;
    total: number;
    level: "full" | "partial" | "none";
  };
  /**
   * Availability Probe Operation: implemented, read, non-streaming, no required input; ranked by how often
   * its noun appears across the Service's Operations, then List > Describe > Get, then name.
   */
  probeOp?: string;
  /** Content-hashed per-Service files, relative to `dist/catalog/`. */
  files: { ui: string; docs: string };
  // `rootResourceTypes` (ticket #14) and `knownIssues` (Phase 3 Known Issues work) are deferred.
}

export interface CatalogIndex {
  categories: { id: string; name: string }[];
  entries: CatalogEntry[];
}
