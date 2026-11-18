import { describe, expect, it } from "vitest";
import type { ServiceOps } from "../src/features/explorer/catalog.ts";
import { parseInput, skeletonInput } from "../src/features/explorer/format.ts";

const ops: ServiceOps = {
  operations: { Put: { name: "Put", kind: "write", status: "implemented", group: "g", input: "in#Put" }, Bare: { name: "Bare", kind: "read", status: "implemented", group: "g" } },
  shapes: {
    "in#Put": {
      kind: "structure",
      members: {
        Name: { target: "s#Str", required: true },
        Count: { target: "s#Int", required: true },
        Flag: { target: "s#Bool", required: true },
        Tags: { target: "s#List", required: true },
        Attrs: { target: "s#Map", required: true },
        Cfg: { target: "s#Struct", required: true },
        Kind: { target: "s#Enum", required: true },
        Optional: { target: "s#Str", required: false },
      },
    },
    "s#Str": { kind: "scalar", scalar: "string" },
    "s#Int": { kind: "scalar", scalar: "integer" },
    "s#Bool": { kind: "scalar", scalar: "boolean" },
    "s#List": { kind: "list", member: { target: "s#Str", required: false } },
    "s#Map": { kind: "map", key: { target: "s#Str", required: false }, value: { target: "s#Str", required: false } },
    "s#Struct": { kind: "structure", members: {} },
    "s#Enum": { kind: "enum", values: { A: "a" }, intEnum: false },
  },
};

describe("skeletonInput", () => {
  it("pre-fills the required top-level members by shape kind, and leaves optional ones out", () => {
    expect(JSON.parse(skeletonInput(ops, "Put"))).toEqual({ Name: "", Count: 0, Flag: false, Tags: [], Attrs: {}, Cfg: {}, Kind: "" });
  });
  it("is {} for an Operation with no input or an unknown one", () => {
    expect(JSON.parse(skeletonInput(ops, "Bare"))).toEqual({});
    expect(JSON.parse(skeletonInput(ops, "Nope"))).toEqual({});
    expect(JSON.parse(skeletonInput(ops, "constructor"))).toEqual({});
    expect(JSON.parse(skeletonInput(undefined, "Put"))).toEqual({});
  });
});

describe("parseInput", () => {
  it("accepts an object, treats blank as {}, and refuses everything else", () => {
    expect(parseInput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseInput("  ")).toEqual({ ok: true, value: {} });
    expect(parseInput("[1]").ok).toBe(false);
    expect(parseInput("{ nope").ok).toBe(false);
  });
});
