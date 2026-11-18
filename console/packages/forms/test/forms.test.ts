import { describe, expect, it } from "vitest";
import { formFor, fromInput, plainText, reviveInput, testPattern, toInput } from "../src/index.ts";
import type { UiModel } from "@console/model";

const s = (target: string, required = false, traits?: object) => ({ target, required, ...(traits ? { traits } : {}) });
const model: Pick<UiModel, "operations" | "shapes"> = {
  operations: { Put: { name: "Put", kind: "write", status: "implemented", errors: [], group: "x", input: "t#PutIn" } },
  shapes: {
    "t#PutIn": {
      kind: "structure",
      members: {
        Opt: s("t#Str"),
        Name: s("t#Str", true, { length: { min: 2, max: 4 }, pattern: "^[a-z]+$" }),
        Count: s("t#Int", false, { range: { min: 1, max: 10 } }),
        When: s("t#Ts"),
        Data: s("t#Blob"),
        Bad: s("t#Str", false, { pattern: "(?<=a)(b+)+$[" }),
        Deep: s("t#Rec"),
      },
    },
    "t#Rec": { kind: "structure", members: { Next: s("t#Rec") } },
    "t#Str": { kind: "scalar", scalar: "string" },
    "t#Int": { kind: "scalar", scalar: "integer" },
    "t#Ts": { kind: "scalar", scalar: "timestamp" },
    "t#Blob": { kind: "scalar", scalar: "blob" },
  },
};

describe("forms", () => {
  const spec = formFor(model, "Put");

  it("lists required members first", () => {
    expect(spec.root.members.map((m) => m.name)[0]).toBe("Name");
  });

  it("caps recursion at depth 6 with a JSON field", () => {
    let f = spec.root.members.find((m) => m.name === "Deep")!.field;
    let n = 1;
    while (f.kind === "structure") {
      f = f.members[0]!.field;
      n++;
    }
    expect(f.kind).toBe("json");
    expect(n).toBe(6);
  });

  it("validates length, pattern, range and required", () => {
    const r = toInput(spec, { Name: "ABCDE", Count: "11" });
    expect(r.errors.map((e) => e.code).sort()).toEqual(["length", "pattern", "range"]);
    expect(toInput(spec, {}).errors).toEqual([expect.objectContaining({ path: "Name", code: "required" })]);
  });

  it("converts timestamps to Date and blobs to Uint8Array", () => {
    const r = toInput(spec, { Name: "ab", When: "2026-01-31T12:00:00Z", Data: { mode: "text", text: "hi" } });
    expect(r.errors).toEqual([]);
    expect(r.input["When"]).toEqual(new Date("2026-01-31T12:00:00Z"));
    expect(r.input["Data"]).toEqual(Uint8Array.from([104, 105]));
    const json = reviveInput(spec, { Name: "ab", When: 1769860800, Data: "aGk=", Extra: 1 }) as Record<string, unknown>;
    expect(json["When"]).toEqual(new Date("2026-01-31T12:00:00Z"));
    expect(json["Data"]).toEqual(Uint8Array.from([104, 105]));
    expect(json["Extra"]).toBe(1);
  });

  it("reports what the form cannot show", () => {
    expect(fromInput(spec, { Name: "ab", Nope: 1 }).dropped).toEqual(["Nope"]);
  });

  it("never lets a bad or hostile @pattern block the form", () => {
    expect(toInput(spec, { Name: "ab", Bad: "anything" }).errors).toEqual([]);
    expect(testPattern("(a+)+$", "a".repeat(40) + "!")).toBeUndefined();
    expect(testPattern("^[a-z]+$", "x".repeat(5000))).toBeUndefined();
    expect(testPattern("(", "x")).toBeUndefined();
    expect(testPattern("^[a-z]+$", "abc")).toBe(true);
  });

  it("reduces model HTML to plain text", () => {
    const t = plainText('<p>Hi <a href="javascript:alert(1)" onclick="x()">there</a> &amp; <b>you</b></p><script>alert(1)</script>');
    expect(t).toBe("Hi there & you");
    expect(plainText("&lt;img src=x onerror=alert(1)&gt;")).toBe("<img src=x onerror=alert(1)>");
  });
});
