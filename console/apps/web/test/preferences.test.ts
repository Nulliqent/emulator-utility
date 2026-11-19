import { afterEach, describe, expect, it } from "vitest";
import { readPref, writePref } from "../src/preferences.ts";
import { parsePins } from "../src/features/catalog/pins.ts";
import { parseServicesSearch } from "../src/features/catalog/search-params.ts";

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("Preferences storage", () => {
  it("reads and writes under the console:v1: prefix", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writePref("pinned-services", '["sqs"]');
    expect([...store.keys()]).toEqual(["console:v1:pinned-services"]);
    expect(readPref("pinned-services")).toBe('["sqs"]');
  });
  it("never throws when storage is blocked", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(readPref("x")).toBeNull();
    expect(() => writePref("x", "1")).not.toThrow();
  });
});

describe("parsePins", () => {
  it("keeps strings, drops duplicates and survives bad JSON", () => {
    expect(parsePins('["a","b","a",3]')).toEqual(["a", "b"]);
    expect(parsePins("{nope")).toEqual([]);
    expect(parsePins(null)).toEqual([]);
  });
});

describe("parseServicesSearch", () => {
  it("keeps only known values from the URL", () => {
    expect(parseServicesSearch({ q: "s3", category: "storage", tier: "custom", level: "none", view: "card" })).toEqual({ q: "s3", category: "storage", tier: "custom", level: "none", view: "card" });
    expect(parseServicesSearch({ tier: "bogus", level: 4, view: "grid", q: "" })).toEqual({});
  });
});
