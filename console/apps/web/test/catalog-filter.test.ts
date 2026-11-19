import type { CatalogEntry } from "@console/api-contract";
import { describe, expect, it } from "vitest";
import { coverageOf } from "../src/catalog/coverage.ts";
import { displayNames } from "../src/features/catalog/display.ts";
import { facetCounts, filterEntries, sortByName, type Filters } from "../src/features/catalog/filter.ts";
import { serviceTarget } from "../src/features/catalog/target.ts";

const e = (serviceId: string, title: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  serviceId,
  crate: serviceId,
  title,
  sdkId: title,
  sdkPackage: `@aws-sdk/client-${serviceId}`,
  signingName: serviceId,
  category: "storage",
  tier: "generated",
  protocol: "restJson1",
  // `level` is deliberately wrong in places: coverageOf must ignore it.
  coverage: { implemented: 1, scaffolded: 1, unrouted: 0, total: 2, level: "full" },
  files: { ui: "", docs: "" },
  ...over,
});
const cov = (implemented: number, total: number) => ({ implemented, scaffolded: total - implemented, unrouted: 0, total, level: "partial" as const });
const all: Filters = { query: "", category: "", tier: "", level: "" };

describe("coverageOf", () => {
  it("derives the level from the counts, ignoring the entry's own level field", () => {
    expect(coverageOf(e("a", "A", { coverage: cov(3, 3) }))).toEqual({ implemented: 3, total: 3, level: "full" });
    expect(coverageOf(e("a", "A", { coverage: cov(1, 3) }))).toEqual({ implemented: 1, total: 3, level: "partial" });
    expect(coverageOf(e("a", "A", { coverage: cov(0, 3) }))).toEqual({ implemented: 0, total: 3, level: "none" });
  });
  it("lets an observed count override the source count", () => {
    expect(coverageOf(e("a", "A", { coverage: cov(3, 3) }), { implemented: 0 })).toEqual({ implemented: 0, total: 3, level: "none" });
  });
});

describe("filterEntries", () => {
  const raw = [
    e("sqs", "Amazon Simple Queue Service", { coverage: cov(1, 2) }),
    e("s3", "Amazon S3", { tier: "custom", coverage: cov(2, 2) }),
    e("s3-control", "Amazon S3 Control", { coverage: cov(1, 2) }),
    e("ses", "Amazon SES", { category: "app", coverage: cov(0, 2) }),
    e("route-53", "Amazon Route 53", { signingName: "route53" }),
    e("sfn", "AWS Step Functions", { sdkId: "SFN", signingName: "states" }),
  ];
  const names = displayNames(raw, { sqs: "SQS" });
  const list = sortByName(raw, names);
  const ids = (f: Partial<Filters>) => filterEntries(list, { ...all, ...f }, names).map((x) => x.serviceId);

  it("keeps the by-name order with no filters", () => expect(ids({})).toEqual(["route-53", "s3", "s3-control", "ses", "sqs", "sfn"]));
  it("matches the id, name, SDK package, signing name and short name", () => {
    expect(ids({ query: "route53" })).toEqual(["route-53"]);
    expect(ids({ query: "states" })).toEqual(["sfn"]);
    expect(ids({ query: "client-ses" })).toEqual(["ses"]);
    expect(ids({ query: "SQS" })).toEqual(["sqs"]);
  });
  it("ranks exact matches, then prefix matches, then the rest", () => {
    expect(ids({ query: "s3" })).toEqual(["s3", "s3-control"]);
    expect(ids({ query: "s" })[0]).not.toBe("route-53");
    expect(ids({ query: "queue" })).toEqual(["sqs"]);
  });
  it("filters by category, tier and coverage level, and combines them", () => {
    expect(ids({ category: "app" })).toEqual(["ses"]);
    expect(ids({ tier: "custom" })).toEqual(["s3"]);
    expect(ids({ level: "none" })).toEqual(["ses"]);
    expect(ids({ level: "full" })).toEqual(["s3"]);
    expect(ids({ category: "storage", level: "partial" })).toEqual(["route-53", "s3-control", "sqs", "sfn"]);
  });
  it("counts each option with the other filters applied, including zero", () => {
    const c = facetCounts(list, { ...all, tier: "custom" }, names);
    expect(c.category.get("storage")).toBe(1);
    expect(c.category.get("app") ?? 0).toBe(0);
    expect(c.tier.get("generated")).toBe(5); // the Tier facet ignores the Tier filter itself
    expect(c.level.get("full")).toBe(1);
    expect(c.level.get("none") ?? 0).toBe(0);
  });
});

describe("displayNames", () => {
  it("prefers the design's short name, then strips Amazon/AWS, and keeps the full title apart", () => {
    const list = [e("s3", "Amazon Simple Storage Service"), e("lambda", "AWS Lambda"), e("x", "Amazon Foo")];
    const n = displayNames(list, { s3: "S3" });
    expect(n.get("s3")).toMatchObject({ label: "S3", full: "Amazon Simple Storage Service" });
    expect(n.get("lambda")?.label).toBe("Lambda");
    expect(n.get("x")?.label).toBe("Foo");
  });
  it("adds the serviceId to labels that would otherwise be the same", () => {
    const n = displayNames([e("ses", "Amazon SES"), e("sesv2", "Amazon SES")], {});
    expect(n.get("ses")?.label).toBe("SES (ses)");
    expect(n.get("sesv2")?.label).toBe("SES (sesv2)");
  });
});

describe("serviceTarget", () => {
  it("opens the explorer with the probe Operation preselected for a Service that has one", () => {
    expect(serviceTarget(e("sqs", "SQS", { coverage: cov(1, 2), probeOp: "ListQueues" }))).toEqual({
      to: "/explorer",
      search: { service: "sqs", op: "ListQueues" },
    });
  });
  it("opens the explorer on the Service alone when there is no probe Operation", () => {
    expect(serviceTarget(e("sqs", "SQS", { coverage: cov(1, 2) })).search).toEqual({ service: "sqs" });
  });
  it("sends a Service at Coverage None straight to the explorer, saying it is not implemented yet", () => {
    expect(serviceTarget(e("ses", "SES", { coverage: cov(0, 2), probeOp: "ListX" }))).toEqual({
      to: "/explorer",
      search: { service: "ses" },
      note: "Not implemented yet",
    });
  });
  it("follows an observed count, so Observed Status can make a Service None", () => {
    expect(serviceTarget(e("sqs", "SQS", { coverage: cov(2, 2) }), { implemented: 0 }).note).toBe("Not implemented yet");
  });
});
