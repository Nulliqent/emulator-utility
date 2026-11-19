import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { createServer } from "../../src/server.ts";

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

// The Gateway's JSON replies are asserted field by field, so the test reads them untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = Omit<Response, "json"> & { json(): Promise<any> };

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function start(dir = mkdtempSync(path.join(tmpdir(), "console-api-"))) {
  const port = await freePort();
  const cfg = loadConfig({
    CONSOLE_PORT: String(port),
    CONSOLE_CONFIG_DIR: dir,
    CONSOLE_EMULATOR_HOME: path.join(dir, "home"),
    CONSOLE_EMULATOR_URL: "https://127.0.0.1:1", // nothing listens: the Emulator is down
    CONSOLE_HEALTH_INTERVAL_MS: "600000",
  });
  const { server } = createServer(cfg);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  closers.push(() => {
    server.close();
    server.closeAllConnections();
  });
  const base = `http://127.0.0.1:${port}/__console/api/v1`;
  const call = (method: string, p: string, opts: { body?: unknown; console?: boolean } = {}) =>
    fetch(base + p, {
      method,
      headers: { ...(opts.console === false ? {} : { "X-Console": "1" }), "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }) as Promise<Reply>;
  return { call, dir };
}

describe("PUT /connections/{id}/behaviour", () => {
  it("saves valid settings, shows them in the Connection list, and they survive a restart", async () => {
    const a = await start();
    const put = await a.call("PUT", "/connections/local/behaviour", { body: { maxAttempts: 4, timeoutMs: 20_000 } });
    expect(put.status).toBe(200);
    expect((await put.json()).behaviour).toEqual({ s3PathStyle: true, maxAttempts: 4, timeoutMs: 20_000 });
    const b = await start(a.dir); // a new Gateway on the same config dir
    const list = await (await b.call("GET", "/connections")).json();
    expect(list.items[0].behaviour).toEqual({ s3PathStyle: true, maxAttempts: 4, timeoutMs: 20_000 });
  });

  it("refuses out-of-bounds, malformed and unknown-key bodies with 400, and changes nothing", async () => {
    const { call } = await start();
    for (const body of [{ maxAttempts: 0, timeoutMs: 20_000 }, { maxAttempts: 3, timeoutMs: 999_999 }, { maxAttempts: 3 }, "x", { maxAttempts: 3, timeoutMs: 5_000, s3PathStyle: false }]) {
      const r = await call("PUT", "/connections/local/behaviour", { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await r.json()).error.code).toBe("invalid-behaviour");
    }
    expect((await (await call("GET", "/connections")).json()).items[0].behaviour).toMatchObject({ maxAttempts: 1, timeoutMs: 30_000 });
  });

  it("answers an oversize body with 400, not a connection reset", async () => {
    const { call } = await start();
    const r = await call("PUT", "/connections/local/behaviour", { body: { maxAttempts: 2, timeoutMs: 5_000, pad: "x".repeat(200_000) } });
    expect(r.status).toBe(400);
  });

  it("answers 500 config-write-failed, not 200, when the config file cannot be written", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "console-api-"));
    const blocker = path.join(dir, "file");
    writeFileSync(blocker, "x");
    const { call } = await start(blocker); // the config dir is a regular file
    const r = await call("PUT", "/connections/local/behaviour", { body: { maxAttempts: 2, timeoutMs: 5_000 } });
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe("config-write-failed");
  });

  it("pushes a behaviour-changed event to open streams after a save", async () => {
    const { call } = await start();
    const stream = await call("GET", "/events");
    const reader = stream.body!.getReader();
    const seen = (async () => {
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("behaviour-changed")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      return text;
    })();
    await call("PUT", "/connections/local/behaviour", { body: { maxAttempts: 2, timeoutMs: 5_000 } });
    const text = await seen;
    await reader.cancel();
    expect(text).toContain('event: behaviour-changed\ndata: {"connectionId":"local"}');
  });

  it("requires the X-Console header, and 404s an unknown Connection", async () => {
    const { call } = await start();
    const body = { maxAttempts: 2, timeoutMs: 5_000 };
    expect((await call("PUT", "/connections/local/behaviour", { body, console: false })).status).toBe(403);
    expect((await call("PUT", "/connections/other/behaviour", { body })).status).toBe(404);
  });

  it("refuses a cross-origin caller", async () => {
    const { call } = await start();
    const r = await fetch((await call("GET", "/meta")).url.replace("/meta", "/connections/local/behaviour"), {
      method: "PUT",
      headers: { "X-Console": "1", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
      body: JSON.stringify({ maxAttempts: 2, timeoutMs: 5_000 }),
    });
    expect(r.status).toBe(403);
  });
});

describe("POST /connections/{id}/checks", () => {
  it("fails the Emulator checks with detail when it is down, passes same-origin, and returns no credentials", async () => {
    const { call } = await start();
    const r = await call("POST", "/connections/local/checks");
    expect(r.status).toBe(200);
    const { checks } = await r.json();
    expect(checks.map((c: { id: string }) => c.id)).toEqual(["reachable", "tls", "credentials", "s3-path-style", "same-origin"]);
    for (const c of checks) expect(c.detail.length).toBeGreaterThan(0);
    expect(checks.find((c: { id: string }) => c.id === "reachable").ok).toBe(false);
    expect(checks.find((c: { id: string }) => c.id === "same-origin").ok).toBe(true);
  });

  it("requires X-Console and a known Connection", async () => {
    const { call } = await start();
    expect((await call("POST", "/connections/local/checks", { console: false })).status).toBe(403);
    expect((await call("POST", "/connections/nope/checks")).status).toBe(404);
  });
});

describe("creating, editing and deleting Connections", () => {
  it("answers 405 until more Connections ship", async () => {
    const { call } = await start();
    for (const [method, p] of [
      ["POST", "/connections"],
      ["PUT", "/connections/local"],
      ["DELETE", "/connections/local"],
      ["POST", "/connections/local/activate"],
    ] as const) {
      const r = await call(method, p, { body: {} });
      expect(r.status, `${method} ${p}`).toBe(405);
      expect((await r.json()).error.code).toBe("method-not-allowed");
    }
  });
});
