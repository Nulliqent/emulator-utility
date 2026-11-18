import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCatalog, compileCatalog, writeCatalog } from "../src/index.ts";
import type { CompileOptions } from "../src/index.ts";

// The compiler and the check command, exercised on a temp copy of a fixture emulator tree;
// never the real repo.
const FIXTURE = join(import.meta.dirname, "fixtures", "mini-emulator");
const CRATE = "service-com-example-widgets";

let work: string;
let options: CompileOptions;
let catalogDir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "catalog-check-"));
  cpSync(FIXTURE, join(work, "emulator"), { recursive: true });
  catalogDir = join(work, "catalog");
  options = {
    emulatorRoot: join(work, "emulator"),
    emulatorSha: "0".repeat(40),
    categoryConfig: {
      categories: [
        { id: "compute", name: "Compute" },
        { id: "other", name: "Other" },
      ],
      services: { widgets: { crate: CRATE, category: "compute" } },
    },
    customTier: [],
  };
  writeCatalog(compileCatalog(options), catalogDir);
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

const crateDir = (crate = CRATE): string => join(work, "emulator", "services", crate);
const opFile = (name: string): string => join(crateDir(), "src", "ops", name);
const widgets = () => compileCatalog(options).services.get("widgets")!.ui;

describe("Source Status", () => {
  it("reads Source Status from the header line only", () => {
    const ops = widgets().operations;
    expect(ops["GetWidget"]?.status).toBe("implemented");
    expect(ops["PutWidget"]?.status).toBe("scaffolded");
    expect(ops["WatchWidgets"]?.status).toBe("unrouted");
    expect(ops["WatchWidgets"]?.streaming).toBe("event-stream");
  });

  it("treats an Operation as present when its file exists even if SKIPPED_STUBS.md lists it, and warns", () => {
    const catalog = compileCatalog(options);
    expect(catalog.services.get("widgets")!.ui.operations["DeleteWidget"]?.status).toBe("implemented");
    const warn = catalog.diagnostics.find((d) => d.code === "skipped-but-authored");
    expect(warn?.message).toContain("DeleteWidget");
    expect(catalog.diagnostics.filter((d) => d.code === "skipped-but-authored")).toHaveLength(1);
  });
});

describe("Model Interpreter on a fixture", () => {
  it("does not leak a service-level paginated trait onto other Operations", () => {
    const ops = widgets().operations;
    expect(ops["GetWidget"]?.pagination).toBeUndefined();
    expect(ops["PutWidget"]?.pagination).toBeUndefined();
    expect(ops["ListWidgets"]?.pagination).toEqual({
      inputToken: "NextToken",
      outputToken: "NextToken",
      pageSize: "MaxResults",
      items: "Widgets",
    });
  });

  it("merges a later file's stub member by member instead of replacing the shape", () => {
    const ui = widgets();
    const out = ui.shapes["com.example#GetWidgetOutput"];
    expect(out?.kind).toBe("structure");
    if (out?.kind !== "structure") return;
    expect(Object.keys(out.members).sort()).toEqual(["Color", "Extra", "Missing", "Name"]);
    expect(out.members["Name"]?.traits?.sensitive).toBe(true);
    const emptyStub = ui.shapes["com.example#ListWidgetsOutput"];
    expect(emptyStub?.kind === "structure" && Object.keys(emptyStub.members)).toEqual(["NextToken"]);
  });

  it("warns on a shape-type conflict between files and on an unresolved target", () => {
    const messages = compileCatalog(options)
      .diagnostics.filter((d) => d.code === "model")
      .map((d) => d.message)
      .join("\n");
    expect(messages).toContain("com.example#Conflict");
    expect(messages).toContain("com.example#NoSuchShape");
  });

  it("turns a Smithy 1.0 enum trait on a string into an enum", () => {
    const color = widgets().shapes["com.example#Color"];
    expect(color).toEqual({ kind: "enum", values: { RED: "red", blue: "blue" }, intEnum: false });
  });

  it("rejects a model whose keys would reach Object.prototype", () => {
    const model = join(crateDir(), "smithy-model", "widgets.json");
    writeFileSync(model, readFileSync(model, "utf8").replace('"Id":', '"__proto__":'));
    const errors = compileCatalog(options).diagnostics.filter((d) => d.kind === "error");
    expect(errors.map((e) => e.message).join("\n")).toContain("unsafe key");
  });
});

describe("Catalog Entry", () => {
  it("derives sdkPackage from the sdkId and picks a non-streaming probeOp", () => {
    const entry = compileCatalog(options).index.find((e) => e.serviceId === "widgets")!;
    expect(entry.sdkPackage).toBe("@aws-sdk/client-widget-works");
    expect(entry.probeOp).toBe("ListWidgets");
  });

  it("gives a crate missing from categories.json a derived id and the fallback Category, with a warning", () => {
    const catalog = compileCatalog(options);
    const entry = catalog.index.find((e) => e.crate === "service-com-example-newcomer")!;
    expect(entry.serviceId).toBe("com-example-newcomer");
    expect(entry.category).toBe("other");
    expect(catalog.diagnostics.filter((d) => d.code === "unmapped-crate").map((d) => d.crate)).toEqual([
      "service-com-example-newcomer",
    ]);
    expect(catalog.diagnostics.filter((d) => d.kind === "error")).toEqual([]);
  });
});

describe("refs tree hygiene", () => {
  it("refuses to follow a symlink in the refs tree", () => {
    rmSync(opFile("SKIPPED_STUBS.md"));
    symlinkSync(join(FIXTURE, "..", "..", "package.json"), opFile("SKIPPED_STUBS.md"));
    const errors = compileCatalog(options).diagnostics.filter((d) => d.kind === "error");
    expect(errors.map((e) => e.message).join("\n")).toContain("symlink");
  });
});

describe("catalog:check", () => {
  it("passes on an untouched tree", () => {
    expect(checkCatalog(options, catalogDir)).toEqual({ ok: true, problems: [] });
  });

  it("fails when an Operation's status line changes without a rebuild, naming the Service", () => {
    const put = opFile("put_widget.rs");
    writeFileSync(put, readFileSync(put, "utf8").replace("//! SCAFFOLDED, NOT IMPLEMENTED:", "//! Implemented:"));
    const result = checkCatalog(options, catalogDir);
    expect(result.ok).toBe(false);
    const text = result.problems.join("\n");
    expect(text).toContain("changed Services:");
    expect(text).toContain("widgets: implemented 3 -> 4, scaffolded 1 -> 0");
    expect(text).toContain("fingerprint differs");
  });

  it("fails when a model file changes without a rebuild", () => {
    const model = join(crateDir(), "smithy-model", "widgets.json");
    writeFileSync(model, readFileSync(model, "utf8").replace("Example Widgets", "Example Widgets v2"));
    expect(checkCatalog(options, catalogDir).ok).toBe(false);
  });

  it("reports added Services, and passes again after a rebuild", () => {
    cpSync(crateDir(), crateDir("service-com-example-extra"), { recursive: true });
    const failed = checkCatalog(options, catalogDir);
    expect(failed.ok).toBe(false);
    expect(failed.problems.join("\n")).toContain("service added: com-example-extra");
    writeCatalog(compileCatalog(options), catalogDir);
    expect(checkCatalog(options, catalogDir).ok).toBe(true);
  });

  it("fails when an ops file disappears, then passes after a rebuild", () => {
    rmSync(opFile("delete_widget.rs"));
    expect(checkCatalog(options, catalogDir).ok).toBe(false);
    writeCatalog(compileCatalog(options), catalogDir);
    expect(checkCatalog(options, catalogDir).ok).toBe(true);
  });

  it("fails when the committed catalog is missing", () => {
    rmSync(join(catalogDir, "manifest.json"));
    expect(checkCatalog(options, catalogDir).ok).toBe(false);
  });

  it("writeCatalog tolerates a subdirectory left in services/", () => {
    cpSync(FIXTURE, join(catalogDir, "services", "stale", "deep"), { recursive: true });
    expect(() => writeCatalog(compileCatalog(options), catalogDir)).not.toThrow();
  });
});
