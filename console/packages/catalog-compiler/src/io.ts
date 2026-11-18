import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileCatalog, stringify } from "./compile.ts";
import type { CatalogEntry, CategoriesFile, CompileOptions, CompiledCatalog } from "./types.ts";

/** The `console/` workspace root. */
export const CONSOLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Where the reference repos live: `CONSOLE_REFS_DIR` for local clones, else the fetch cache. */
export function resolveRefsDir(): string {
  const fromEnv = process.env["CONSOLE_REFS_DIR"];
  return fromEnv ? resolve(fromEnv) : join(CONSOLE_DIR, ".refs");
}

export function resolveEmulatorRoot(): string {
  const root = join(resolveRefsDir(), "aws-emulator");
  if (!existsSync(join(root, "services"))) {
    throw new Error(
      `the reference repos are missing (no aws-emulator checkout at ${root}). The catalog build and the tests need them: run "pnpm refs:fetch", or set CONSOLE_REFS_DIR to a folder that holds clones of aws-emulator and api-models-aws.`,
    );
  }
  return root;
}

export function loadCatalogConfig(consoleDir: string = CONSOLE_DIR): Omit<CompileOptions, "emulatorRoot"> {
  const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(consoleDir, file), "utf8")) as T;
  return {
    categoryConfig: readJson<CategoriesFile>("catalog/categories.json"),
    customTier: readJson<string[]>("catalog/custom-ui.json"),
    emulatorSha: readRefs(consoleDir).repos["aws-emulator"].sha,
  };
}

export interface ExpectedCounts {
  services: number;
  operations: number;
  implemented: number;
  scaffolded: number;
  unrouted: number;
}

interface RefsFile {
  repos: Record<"aws-emulator" | "api-models-aws", { url: string; sha: string; sparse: string[] }>;
  /** What the compiler must produce at the pinned emulator commit. Edited together with the pin. */
  expectedCounts: ExpectedCounts;
}

function readRefs(consoleDir: string): RefsFile {
  return JSON.parse(readFileSync(join(consoleDir, "refs.json"), "utf8")) as RefsFile;
}

export function loadExpectedCounts(consoleDir: string = CONSOLE_DIR): ExpectedCounts {
  return readRefs(consoleDir).expectedCounts;
}

export const DEFAULT_CATALOG_DIR = join(CONSOLE_DIR, "dist", "catalog");

function indexText(catalog: CompiledCatalog): string {
  return stringify({ categories: catalog.categories, entries: catalog.index }, true);
}

function manifestText(catalog: CompiledCatalog): string {
  return stringify(catalog.manifest, true);
}

/** Write index.json, manifest.json and the per-Service files. Old per-Service files are removed. */
export function writeCatalog(catalog: CompiledCatalog, outDir: string = DEFAULT_CATALOG_DIR): void {
  rmSync(join(outDir, "services"), { recursive: true, force: true });
  mkdirSync(join(outDir, "services"), { recursive: true });
  for (const entry of catalog.index) {
    const svc = catalog.services.get(entry.serviceId)!;
    writeFileSync(join(outDir, entry.files.ui), stringify(svc.ui, false));
    writeFileSync(join(outDir, entry.files.docs), stringify(svc.docs, false));
  }
  writeFileSync(join(outDir, "index.json"), indexText(catalog));
  writeFileSync(join(outDir, "manifest.json"), manifestText(catalog));
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/**
 * Recompile from the emulator tree and compare with the committed index and manifest.
 * Fails when a model or an Operation status line changed without a rebuild.
 */
export function checkCatalog(options: CompileOptions, catalogDir: string = DEFAULT_CATALOG_DIR): CheckResult {
  const catalog = compileCatalog(options);
  const problems = catalog.diagnostics.filter((w) => w.kind === "error").map((w) => `${w.crate}: ${w.message}`);
  const read = (file: string): string | undefined => {
    const p = join(catalogDir, file);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  };
  const committedManifest = read("manifest.json");
  const committedIndex = read("index.json");
  if (committedManifest === undefined || committedIndex === undefined) {
    problems.push("no committed catalog: run `pnpm catalog:build`");
    return { ok: false, problems };
  }
  const committed = JSON.parse(committedManifest) as { fingerprint?: string };
  if (committed.fingerprint !== catalog.manifest.fingerprint || committedIndex !== indexText(catalog)) {
    problems.push(...describeDrift(committedIndex, catalog));
  }
  if (committed.fingerprint !== catalog.manifest.fingerprint) {
    problems.push(
      `fingerprint differs: committed ${committed.fingerprint}, source ${catalog.manifest.fingerprint}. The emulator models or Operation status lines changed.`,
    );
  }
  if (committedManifest !== manifestText(catalog)) problems.push("manifest.json is out of date");
  if (committedIndex !== indexText(catalog)) problems.push("index.json is out of date");
  if (problems.length) problems.push("run `pnpm catalog:build` and commit dist/catalog/index.json and manifest.json");
  return { ok: problems.length === 0, problems };
}

const DRIFT_LIMIT = 25;

/** Which Services differ between the committed index and a fresh compile: added, removed, or changed status counts. */
function describeDrift(committedIndexText: string, catalog: CompiledCatalog): string[] {
  let before: CatalogEntry[];
  try {
    before = (JSON.parse(committedIndexText) as { entries: CatalogEntry[] }).entries;
  } catch {
    return ["committed index.json cannot be read"];
  }
  const old = new Map(before.map((e) => [e.serviceId, e]));
  const now = new Map(catalog.index.map((e) => [e.serviceId, e]));
  const lines: string[] = [];
  for (const [id, e] of now) {
    const o = old.get(id);
    if (!o) {
      lines.push(`service added: ${id}`);
      continue;
    }
    const a = o.coverage;
    const b = e.coverage;
    if (a.implemented !== b.implemented || a.scaffolded !== b.scaffolded || a.unrouted !== b.unrouted) {
      lines.push(
        `${id}: implemented ${a.implemented} -> ${b.implemented}, scaffolded ${a.scaffolded} -> ${b.scaffolded}, unrouted ${a.unrouted} -> ${b.unrouted}`,
      );
    } else if (o.files.ui !== e.files.ui) {
      lines.push(`${id}: model changed`);
    } else if (JSON.stringify(o) !== JSON.stringify(e)) {
      lines.push(`${id}: catalog entry changed`);
    }
  }
  for (const id of old.keys()) if (!now.has(id)) lines.push(`service removed: ${id}`);
  const shown = lines.slice(0, DRIFT_LIMIT);
  if (lines.length > shown.length) shown.push(`... and ${lines.length - shown.length} more`);
  return shown.length ? ["changed Services:", ...shown.map((l) => `  ${l}`)] : [];
}
