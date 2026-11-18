import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { interpret } from "@console/model";
import type { OperationModel, SmithyJson, UiModel } from "@console/model";
import { scanCrateStatus } from "./scan-status.ts";
import { assertNotSymlink, compareCodeUnits, listDirNoSymlinks, readBinaryFile } from "./safe-fs.ts";
import type {
  CatalogEntry,
  CatalogManifest,
  CompileOptions,
  CompiledCatalog,
  CompiledService,
  Diagnostic,
} from "./types.ts";

/** Bump when the compiler's output format changes without any source change, so the fingerprint (and cache URLs) change. */
const COMPILER_SCHEMA_VERSION = 1;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

const PROBE_PREFIX = /^(List|Describe|Get|Search|Query|Head|BatchGet)/;
const PROBE_PREFERENCE = ["List", "Describe", "Get"];

function hasRequiredInput(ui: UiModel, op: OperationModel): boolean {
  if (!op.input) return false;
  const shape = ui.shapes[op.input];
  if (!shape || shape.kind !== "structure") return false;
  return Object.values(shape.members).some((m) => m.required);
}

function singular(noun: string): string {
  if (/[^aeiou]ies$/.test(noun)) return noun.slice(0, -3) + "y";
  if (/(s|x|ch|sh|z)es$/.test(noun)) return noun.slice(0, -2);
  if (/[^s]s$/.test(noun) && !/us$/.test(noun)) return noun.slice(0, -1);
  return noun;
}

/**
 * Pick the Operation a Probe sends to learn Availability.
 *
 * Candidates are implemented read Operations that need no input and do not stream. A Probe is
 * read-only by convention of the name (List/Describe/Get...), not by proof. Among candidates the
 * "core" Operation wins: the one whose noun appears in the most Operation names of the Service
 * (ListStreams for Kinesis: every `*Stream*` Operation counts; DescribeRepositories for ECR),
 * then List before Describe before Get, then the first by name.
 */
export function pickProbeOp(ui: UiModel): string | undefined {
  const all = Object.values(ui.operations);
  const candidates = all.filter(
    (op) => op.status === "implemented" && op.kind === "read" && !op.streaming && !hasRequiredInput(ui, op),
  );
  const score = (op: OperationModel): number => {
    const noun = singular(op.name.replace(PROBE_PREFIX, ""));
    return noun ? all.filter((o) => o.name.includes(noun)).length : 0;
  };
  const rank = (name: string): number => {
    const i = PROBE_PREFERENCE.findIndex((p) => name.startsWith(p));
    return i < 0 ? PROBE_PREFERENCE.length : i;
  };
  const scored = candidates.map((op) => ({ op, score: score(op) }));
  scored.sort((a, b) => b.score - a.score || rank(a.op.name) - rank(b.op.name) || compareCodeUnits(a.op.name, b.op.name));
  return scored[0]?.op.name;
}

export function stringify(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined) + "\n";
}

/** Console id of a crate that categories.json does not know: its name without the `service-com-amazonaws-` prefix. */
function derivedServiceId(crate: string): string {
  return crate.replace(/^service-(com-amazonaws-)?/, "");
}

function sdkPackageOf(sdkId: string): string {
  return `@aws-sdk/client-${sdkId.toLowerCase().replace(/\s+/g, "-")}`;
}

/** Compile every crate of the emulator tree into the Catalog, in memory. */
export function compileCatalog(options: CompileOptions): CompiledCatalog {
  const { emulatorRoot, categoryConfig, customTier, emulatorSha } = options;
  const servicesDir = join(emulatorRoot, "services");
  const diagnostics: Diagnostic[] = [];
  const crates = listDirNoSymlinks(servicesDir)
    .filter((d) => d.isDir && d.name.startsWith("service-"))
    .map((d) => d.name);

  const categoryIds = new Set(categoryConfig.categories.map((c) => c.id));
  const fallbackCategory = categoryIds.has("other") ? "other" : categoryConfig.categories[0]?.id;
  if (!fallbackCategory) throw new Error("categories.json has no categories");
  const byCrate = new Map<string, { serviceId: string; category: string }>();
  for (const [serviceId, v] of Object.entries(categoryConfig.services)) {
    if (!categoryIds.has(v.category)) throw new Error(`categories.json: ${serviceId} has unknown category "${v.category}"`);
    byCrate.set(v.crate, { serviceId, category: v.category });
  }
  const crateSet = new Set(crates);
  for (const crate of byCrate.keys()) {
    if (!crateSet.has(crate)) {
      diagnostics.push({ kind: "warn", code: "stale-mapping", crate, message: "categories.json maps a crate the emulator no longer has" });
    }
  }
  // A crate nobody categorised yet must not stop the build (ADR-0004): it gets a derived id and the fallback Category.
  const usedIds = new Set([...byCrate.values()].map((v) => v.serviceId));
  for (const crate of crates) {
    if (byCrate.has(crate)) continue;
    let serviceId = derivedServiceId(crate);
    while (usedIds.has(serviceId)) serviceId += "-new";
    usedIds.add(serviceId);
    byCrate.set(crate, { serviceId, category: fallbackCategory });
    diagnostics.push({
      kind: "warn",
      code: "unmapped-crate",
      crate,
      message: `not in categories.json; using id "${serviceId}" and Category "${fallbackCategory}". Add it to catalog/categories.json.`,
    });
  }
  const knownIds = new Set([...byCrate.values()].map((v) => v.serviceId));
  const customSet = new Set(customTier);
  for (const id of customSet) {
    if (!knownIds.has(id)) throw new Error(`custom-ui.json names unknown service "${id}"`);
  }

  const index: CatalogEntry[] = [];
  const services = new Map<string, CompiledService>();
  const fingerprintLines: string[] = [];
  const counts = { services: 0, operations: 0, implemented: 0, scaffolded: 0, unrouted: 0 };

  for (const crate of crates) {
    const { serviceId, category } = byCrate.get(crate)!;
    const crateDir = join(servicesDir, crate);
    try {
      assertNotSymlink(crateDir);
      const modelDir = join(crateDir, "smithy-model");
      const modelFiles = listDirNoSymlinks(modelDir).filter((f) => f.isFile && f.name.endsWith(".json"));
      const files: SmithyJson[] = [];
      fingerprintLines.push(`crate ${crate}`);
      for (const f of modelFiles) {
        const raw = readBinaryFile(join(modelDir, f.name));
        fingerprintLines.push(`model ${crate}/${f.name} ${sha256(raw)}`);
        files.push(JSON.parse(raw.toString("utf8")) as SmithyJson);
      }

      if (existsSync(join(crateDir, "src"))) assertNotSymlink(join(crateDir, "src"));
      const scan = scanCrateStatus(crateDir);
      for (const line of scan.statusLines) fingerprintLines.push(`status ${crate} ${line}`);
      for (const problem of scan.problems) diagnostics.push({ kind: "warn", code: "ops-file", crate, message: problem });
      // SKIPPED_STUBS.md is deliberately not hashed: it never decides a status, only the ops files do.

      // Source Status rule: an Operation with an `ops/<op>.rs` file is Implemented, or Scaffolded
      // when its header carries the marker. An Operation with no file is Unrouted. SKIPPED_STUBS.md
      // is not consulted: 46 Operations it lists were hand-authored later without a HAND-AUTHORED
      // line, and the file is the truth.
      const { model, docs, diagnostics: modelDiagnostics } = interpret(files, {
        statusOf: (op) => scan.fileStatus.get(op) ?? "unrouted",
      });
      for (const message of modelDiagnostics) diagnostics.push({ kind: "warn", code: "model", crate, message });
      for (const op of scan.skippedButAuthored) {
        diagnostics.push({
          kind: "warn",
          code: "skipped-but-authored",
          crate,
          message: `${op} is listed as SKIPPED but has an ops file; treated as ${scan.fileStatus.get(op)}`,
        });
      }
      for (const op of scan.fileStatus.keys()) {
        if (!Object.hasOwn(model.operations, op)) {
          diagnostics.push({ kind: "warn", code: "ops-file", crate, message: `ops file for ${op}, which the model does not declare` });
        }
      }

      const ops = Object.values(model.operations);
      const implemented = ops.filter((o) => o.status === "implemented").length;
      const scaffolded = ops.filter((o) => o.status === "scaffolded").length;
      const unrouted = ops.length - implemented - scaffolded;
      const total = ops.length;
      const probeOp = pickProbeOp(model);

      const uiText = stringify(model, false);
      const docsText = stringify(docs, false);
      const entry: CatalogEntry = {
        serviceId,
        crate,
        title: model.service.title,
        sdkId: model.service.sdkId,
        sdkPackage: sdkPackageOf(model.service.sdkId),
        signingName: model.service.signingName,
        protocol: model.service.protocol,
        category,
        tier: customSet.has(serviceId) ? "custom" : "generated",
        coverage: {
          implemented,
          scaffolded,
          unrouted,
          total,
          level: implemented === 0 ? "none" : implemented === total ? "full" : "partial",
        },
        files: {
          ui: `services/${serviceId}.${sha256(uiText).slice(0, 10)}.ui.json`,
          docs: `services/${serviceId}.${sha256(docsText).slice(0, 10)}.docs.json`,
        },
      };
      if (probeOp) entry.probeOp = probeOp;
      index.push(entry);
      services.set(serviceId, { ui: model, docs });
      counts.services += 1;
      counts.operations += total;
      counts.implemented += implemented;
      counts.scaffolded += scaffolded;
      counts.unrouted += unrouted;
    } catch (error) {
      diagnostics.push({ kind: "error", code: "compile-error", crate, message: error instanceof Error ? error.message : String(error) });
    }
  }

  index.sort((a, b) => compareCodeUnits(a.serviceId, b.serviceId));
  // The fingerprint names what is emitted, not only its source: the compiler's schema version, the Category overlay,
  // and every Catalog Entry (which holds the content hashes of the emitted per-Service files, the tier and the Category).
  fingerprintLines.push(`compiler-schema ${COMPILER_SCHEMA_VERSION}`);
  fingerprintLines.push(`categories ${sha256(JSON.stringify(categoryConfig.categories))}`);
  for (const entry of index) fingerprintLines.push(`entry ${sha256(JSON.stringify(entry))}`);
  const manifest: CatalogManifest = {
    schemaVersion: 1,
    fingerprint: sha256(fingerprintLines.join("\n")),
    source: { emulator: emulatorSha },
    counts,
  };
  return { categories: categoryConfig.categories, index, manifest, services, diagnostics };
}
