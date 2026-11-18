import type { OpName, Protocol, UiDocs, UiModel } from "@console/model";

export interface CategoryDef {
  id: string;
  name: string;
}

/** `catalog/categories.json`: 22 Categories and the Service-to-Category map. */
export interface CategoriesFile {
  categories: CategoryDef[];
  /** Keyed by serviceId (the api-models directory name). */
  services: Record<string, { crate: string; category: string }>;
}

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
  probeOp?: OpName;
  /** Content-hashed per-Service files, relative to `dist/catalog/`. */
  files: { ui: string; docs: string };
  // `rootResourceTypes` (ticket #14) and `knownIssues` (Phase 3 Known Issues work) are deferred.
}

export interface CatalogManifest {
  schemaVersion: 1;
  fingerprint: string;
  source: { emulator: string };
  counts: { services: number; operations: number; implemented: number; scaffolded: number; unrouted: number };
}

export type DiagnosticCode =
  | "compile-error"
  | "unmapped-crate"
  | "stale-mapping"
  | "skipped-but-authored"
  | "ops-file"
  | "model";

/** Something the compiler noticed. `error` diagnostics fail the build and the check; `warn` ones are reported. */
export interface Diagnostic {
  kind: "error" | "warn";
  code: DiagnosticCode;
  crate: string;
  message: string;
}

export interface CompiledService {
  ui: UiModel;
  docs: UiDocs;
}

export interface CompiledCatalog {
  categories: CategoryDef[];
  index: CatalogEntry[];
  manifest: CatalogManifest;
  services: Map<string, CompiledService>;
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  /** Root of the aws-emulator checkout (the folder that holds `services/`). */
  emulatorRoot: string;
  categoryConfig: CategoriesFile;
  /** serviceIds of the Custom-Tier Services (`catalog/custom-ui.json`). */
  customTier: string[];
  /** Pinned emulator commit, recorded in the manifest. */
  emulatorSha: string;
}
