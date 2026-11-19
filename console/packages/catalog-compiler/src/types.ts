import type { CatalogEntry } from "@console/api-contract";
import type { UiDocs, UiModel } from "@console/model";

export type { CatalogEntry };

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
