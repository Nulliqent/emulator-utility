import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BehaviourInput } from "@console/api-contract";
import { loadConfig } from "../../src/config.ts";
import { createRegistry } from "../../src/connections.ts";

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "console-behaviour-"));
  const cfg = loadConfig({ CONSOLE_CONFIG_DIR: dir, CONSOLE_EMULATOR_HOME: path.join(dir, "home") });
  return { dir, cfg, file: path.join(dir, "connections.json") };
}

describe("BehaviourInput bounds", () => {
  const ok = { maxAttempts: 3, timeoutMs: 30_000 };
  it("accepts the edges", () => {
    expect(BehaviourInput.safeParse({ maxAttempts: 1, timeoutMs: 1_000 }).success).toBe(true);
    expect(BehaviourInput.safeParse({ maxAttempts: 10, timeoutMs: 120_000 }).success).toBe(true);
  });
  it("refuses values outside the bounds, non-integers, other types and unknown keys", () => {
    for (const bad of [
      { ...ok, maxAttempts: 0 },
      { ...ok, maxAttempts: 11 },
      { ...ok, maxAttempts: 2.5 },
      { ...ok, timeoutMs: 999 },
      { ...ok, timeoutMs: 120_001 },
      { ...ok, timeoutMs: "30000" },
      { ...ok, extra: 1 },
      { maxAttempts: 3 },
    ]) {
      expect(BehaviourInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("Connection behaviour persistence", () => {
  it("starts with the defaults", () => {
    const { cfg } = setup();
    expect(createRegistry(cfg).get("local")?.behaviour).toEqual({ s3PathStyle: true, maxAttempts: 1, timeoutMs: 30_000 });
  });

  it("survives a Gateway restart (a new registry on the same config dir)", () => {
    const { cfg } = setup();
    expect(createRegistry(cfg).setBehaviour("local", { maxAttempts: 5, timeoutMs: 45_000 })?.behaviour).toEqual({
      s3PathStyle: true,
      maxAttempts: 5,
      timeoutMs: 45_000,
    });
    const restarted = createRegistry(cfg);
    expect(restarted.get("local")?.behaviour).toMatchObject({ maxAttempts: 5, timeoutMs: 45_000 });
    expect(restarted.list().items[0]?.behaviour.maxAttempts).toBe(5);
  });

  it("merges into the config file without clobbering what else is in it", () => {
    const { cfg, file } = setup();
    writeFileSync(file, JSON.stringify({ note: "keep me", items: [{ id: "local", extra: "keep too" }] }));
    createRegistry(cfg).setBehaviour("local", { maxAttempts: 2, timeoutMs: 10_000 });
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.note).toBe("keep me");
    expect(written.items[0].extra).toBe("keep too");
    expect(written.items[0].behaviour).toMatchObject({ maxAttempts: 2, timeoutMs: 10_000 });
  });

  it("ignores stored values that are out of bounds", () => {
    const { cfg, file } = setup();
    writeFileSync(file, JSON.stringify({ items: [{ id: "local", behaviour: { maxAttempts: 99, timeoutMs: 5 } }] }));
    expect(createRegistry(cfg).get("local")?.behaviour).toMatchObject({ maxAttempts: 1, timeoutMs: 30_000 });
  });

  it("returns undefined for an unknown Connection", () => {
    expect(createRegistry(setup().cfg).setBehaviour("nope", { maxAttempts: 2, timeoutMs: 10_000 })).toBeUndefined();
  });
});

describe("one call per click by default", () => {
  it("defaults to a single attempt so a retry never resends a write", async () => {
    const { DEFAULT_BEHAVIOUR } = await import("@console/api-contract");
    expect(DEFAULT_BEHAVIOUR.maxAttempts).toBe(1);
  });
});

describe("a failed write", () => {
  it("throws from setBehaviour and keeps serving the old settings", () => {
    const { dir } = setup();
    const blocker = path.join(dir, "not-a-folder");
    writeFileSync(blocker, "x");
    const cfg = loadConfig({ CONSOLE_CONFIG_DIR: blocker, CONSOLE_EMULATOR_HOME: path.join(dir, "home") });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = createRegistry(cfg);
    expect(() => registry.setBehaviour("local", { maxAttempts: 5, timeoutMs: 45_000 })).toThrow(/could not write/);
    expect(registry.get("local")?.behaviour.maxAttempts).toBe(1);
  });

  it("retries the write on the next call instead of remembering it as done", () => {
    const { dir, cfg, file } = setup();
    const blocker = path.join(dir, "blocked");
    writeFileSync(blocker, "x");
    const blockedCfg = { ...cfg, configDir: blocker };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = createRegistry(blockedCfg);
    registry.list();
    expect(() => registry.setBehaviour("local", { maxAttempts: 2, timeoutMs: 5_000 })).toThrow();
    expect(() => readFileSync(file)).toThrow(); // nothing was written
  });
});

describe("a corrupt connections.json", () => {
  it("is backed up and warned about, not silently overwritten", () => {
    const { cfg, dir, file } = setup();
    writeFileSync(file, "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createRegistry(cfg).list();
    const backup = readdirSync(dir).find((f) => f.startsWith("connections.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(dir, backup!), "utf8")).toBe("{ not json");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("corrupt"));
    expect(JSON.parse(readFileSync(file, "utf8")).items[0].id).toBe("local");
  });
});

describe("reading the file", () => {
  it("is cached: a request does not re-read connections.json", () => {
    const { cfg, file } = setup();
    const registry = createRegistry(cfg);
    registry.list();
    writeFileSync(file, JSON.stringify({ items: [{ id: "local", behaviour: { maxAttempts: 9, timeoutMs: 9_000 } }] }));
    expect(registry.get("local")?.behaviour.maxAttempts).toBe(1); // the cached copy, until a PUT replaces it
  });
});
