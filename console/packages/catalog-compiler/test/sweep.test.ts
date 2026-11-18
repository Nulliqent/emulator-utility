import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileCatalog, loadCatalogConfig, loadExpectedCounts, resolveEmulatorRoot } from "../src/index.ts";
import type { CompiledCatalog } from "../src/index.ts";

// The build-time catalog sweep: the compiler runs over every crate of the pinned Emulator
// source and the tests assert on its outputs. The expected counts live in refs.json next to the
// pins, so moving a pin edits one place. They were first taken from an inventory made
// independently of the compiler (OPERATIONS.md per crate and a grep of the scaffold marker).
// The tests need the reference repos: run `pnpm refs:fetch` or set CONSOLE_REFS_DIR.
let catalog: CompiledCatalog;
const expected = loadExpectedCounts();

beforeAll(() => {
  const config = loadCatalogConfig();
  catalog = compileCatalog({ emulatorRoot: resolveEmulatorRoot(), ...config });
});

describe("catalog sweep over all crates", () => {
  it("compiles all 436 Services with zero throws and the expected Operation total", () => {
    expect(catalog.index).toHaveLength(436);
    expect(catalog.manifest.counts.services).toBe(expected.services);
    expect(catalog.manifest.counts.operations).toBe(expected.operations);
    const summed = catalog.index.reduce((n, e) => n + e.coverage.total, 0);
    expect(summed).toBe(expected.operations);
    expect(catalog.diagnostics.filter((d) => d.kind === "error")).toEqual([]);
    // Every crate at the pin is in categories.json.
    expect(catalog.diagnostics.filter((d) => d.code === "unmapped-crate" || d.code === "stale-mapping")).toEqual([]);
  });

  it("counts Source Status in line with the inventory", () => {
    const { implemented, scaffolded, unrouted } = catalog.manifest.counts;
    expect({ implemented, scaffolded, unrouted }).toEqual({
      implemented: expected.implemented,
      scaffolded: expected.scaffolded,
      unrouted: expected.unrouted,
    });
    expect(implemented + scaffolded + unrouted).toBe(expected.operations);
    // SKIPPED_STUBS.md entries that were hand-authored later without a HAND-AUTHORED line.
    expect(catalog.diagnostics.filter((d) => d.code === "skipped-but-authored")).toHaveLength(46);
  });

  it("marks Kinesis GetShardIterator Implemented and SubscribeToShard not Unrouted", () => {
    const kinesis = catalog.services.get("kinesis");
    expect(kinesis).toBeDefined();
    const ops = kinesis!.ui.operations;
    expect(ops["GetShardIterator"]?.status).toBe("implemented");
    expect(ops["SubscribeToShard"]?.status).not.toBe("unrouted");
    expect(ops["SubscribeToShard"]?.streaming).toBe("event-stream");
    expect(ops["ListShards"]?.kind).toBe("read");
    expect(ops["ListStreams"]?.pagination).toEqual({
      inputToken: "NextToken",
      outputToken: "NextToken",
      pageSize: "Limit",
    });
    expect(ops["ListChannels"]?.pagination?.items).toBe("ChannelSummaries");
    expect(ops["CreateStream"]?.kind).toBe("write");
  });

  it("does not leak service-level pagination onto other Operations", () => {
    const ops = catalog.services.get("accessanalyzer")!.ui.operations;
    expect(ops["CreateAnalyzer"]?.pagination).toBeUndefined();
    expect(ops["ListAnalyzers"]?.pagination).toBeDefined();
    // Independent check against the raw models: only Operations with their own paginated trait are paginated.
    const root = resolveEmulatorRoot();
    for (const entry of catalog.index) {
      const own = new Set<string>();
      const dir = join(root, "services", entry.crate, "smithy-model");
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as { shapes: Record<string, { type: string; traits?: Record<string, unknown> }> };
        for (const [id, shape] of Object.entries(raw.shapes)) {
          if (shape.type === "operation" && shape.traits && "smithy.api#paginated" in shape.traits) own.add(id.split("#")[1]!);
        }
      }
      for (const op of Object.values(catalog.services.get(entry.serviceId)!.ui.operations)) {
        if (op.pagination) expect(own.has(op.name), `${entry.serviceId} ${op.name}`).toBe(true);
      }
    }
  });

  it("reads Smithy 1.0 enums and keeps members of multi-file merges", () => {
    const aa = catalog.services.get("accessanalyzer")!.ui;
    expect(aa.shapes["com.amazonaws.accessanalyzer#AccessCheckPolicyType"]?.kind).toBe("enum");
    const q = catalog.services.get("qconnect");
    const grouping = Object.entries(q?.ui.shapes ?? {}).find(([id]) => id.endsWith("#GroupingConfiguration"))?.[1];
    expect(grouping?.kind === "structure" && Object.keys(grouping.members)).toHaveLength(2);
  });

  it("derives sdkPackage and prefers the core List or Describe Operation for probeOp", () => {
    const by = (id: string) => catalog.index.find((e) => e.serviceId === id)!;
    expect(by("kinesis").sdkPackage).toBe("@aws-sdk/client-kinesis");
    expect(by("kinesis").probeOp).toBe("ListStreams");
    expect(by("ecr").probeOp).toBe("DescribeRepositories");
    for (const e of catalog.index) {
      expect(e.sdkPackage).toMatch(/^@aws-sdk\/client-[a-z0-9-]+$/);
      if (e.probeOp) expect(catalog.services.get(e.serviceId)!.ui.operations[e.probeOp]?.streaming).toBeUndefined();
    }
  });

  it("maps every Service to one of 22 Categories and marks 10 Custom-Tier Services", () => {
    const categories = new Set(catalog.index.map((e) => e.category));
    expect(categories.size).toBeLessThanOrEqual(22);
    expect(catalog.categories).toHaveLength(22);
    for (const e of catalog.index) expect(catalog.categories.map((c) => c.id)).toContain(e.category);
    const custom = catalog.index.filter((e) => e.tier === "custom").map((e) => e.serviceId);
    expect(custom.sort()).toEqual(
      [
        "cloudwatch-logs",
        "dynamodb",
        "eventbridge",
        "lambda",
        "s3",
        "secrets-manager",
        "sfn",
        "sns",
        "sqs",
        "ssm",
      ].sort(),
    );
    expect(catalog.index.filter((e) => e.tier === "generated")).toHaveLength(426);
  });

  it("derives Coverage and a probeOp for each Service", () => {
    const kinesis = catalog.index.find((e) => e.serviceId === "kinesis")!;
    expect(kinesis.coverage.total).toBe(45);
    expect(kinesis.coverage.level).toBe("full");
    expect(kinesis.protocol).toBe("awsJson1_1");
    for (const e of catalog.index) {
      const { implemented, total } = e.coverage;
      expect(e.coverage.level).toBe(implemented === 0 ? "none" : implemented === total ? "full" : "partial");
      if (e.probeOp) {
        const op = catalog.services.get(e.serviceId)!.ui.operations[e.probeOp]!;
        expect(op.status).toBe("implemented");
        expect(op.kind).toBe("read");
      }
    }
  });
});
