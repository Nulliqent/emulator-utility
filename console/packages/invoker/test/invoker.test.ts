import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createInvoker, type InvokerOptions } from "../src/invoker.ts";
import type { SmithyMiddleware } from "../src/types.ts";

type Mw = { mw: SmithyMiddleware; opts: Record<string, unknown> };

// A fake SDK module: records config and headers, runs client and command middleware like the SDK's stacks do.
function fakeSdk(answer: (input: unknown, config: Record<string, unknown>) => unknown) {
  const seen: { config?: Record<string, unknown>; headers?: Record<string, string>; configs: Record<string, unknown>[] } = { configs: [] };
  class FakeClient {
    stack: Mw[] = [];
    config: Record<string, unknown>;
    middlewareStack = { add: (mw: SmithyMiddleware, opts: Record<string, unknown>) => void this.stack.push({ mw, opts }) };
    constructor(config: Record<string, unknown>) {
      this.config = config;
      seen.config = config;
      seen.configs.push(config);
    }
    async send(cmd: ListThingsCommand) {
      const request = { headers: {} as Record<string, string> };
      // serialization (a bad input throws here, before any build-step middleware runs)
      if (cmd.input && (cmd.input as { bad?: boolean }).bad) throw new Error("No value provided for input HTTP label: Name.");
      const all = [...this.stack, ...cmd.stack];
      const handler = all.reduceRight<(a: unknown) => Promise<unknown>>(
        (next, m) => m.mw(next as never) as never,
        async () => answer(cmd.input, this.config) as never,
      );
      await handler({ request });
      seen.headers = request.headers;
      return answer(cmd.input, this.config);
    }
  }
  class ListThingsCommand {
    input: unknown;
    stack: Mw[] = [];
    middlewareStack = { add: (mw: SmithyMiddleware, opts: Record<string, unknown>) => void this.stack.push({ mw, opts }) };
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return { seen, mod: { FakeClient, ListThingsCommand } as Record<string, unknown> };
}

const creds = (epoch: number) => ({ accessKeyId: `AK${epoch}`, secretAccessKey: "s", epoch });
const okFetch = (epoch = 1) => (async () => new Response(JSON.stringify(creds(epoch)), { status: 200 })) as unknown as typeof fetch;
const base = { origin: "http://127.0.0.1:9300", regionOf: () => "us-east-1" };
const call = { connectionId: "local", serviceId: "fake", op: "ListThings", input: {}, origin: "user" as const };
const make = (sdk: ReturnType<typeof fakeSdk>, extra: Partial<InvokerOptions> = {}) =>
  createInvoker({ ...base, fetchImpl: okFetch(), load: () => Promise.resolve(sdk.mod), ...extra });
const authError = (name = "InvalidClientTokenId") => Object.assign(new Error("bad"), { name, $metadata: { httpStatusCode: 403 } });

describe("client behaviour of the Connection", () => {
  it("builds each client with the Connection's maxAttempts and request timeout", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    await make(sdk, { behaviourOf: () => ({ maxAttempts: 4, timeoutMs: 12_000 }) }).invoke(call);
    expect(sdk.seen.config?.maxAttempts).toBe(4);
    expect(sdk.seen.config?.requestHandler).toEqual({ requestTimeout: 12_000 });
  });

  it("reports the attempts the SDK made", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200, attempts: 3 } }));
    const r = await make(sdk, { behaviourOf: () => ({ maxAttempts: 4, timeoutMs: 12_000 }) }).invoke(call);
    expect(r.ok && r.meta.attempts).toBe(3);
  });

  it("builds a fresh client after forget(), so changed settings apply", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    let attempts = 2;
    const inv = make(sdk, { behaviourOf: () => ({ maxAttempts: attempts, timeoutMs: 5_000 }) });
    await inv.invoke(call);
    attempts = 6;
    await inv.invoke(call);
    expect(sdk.seen.configs.map((c) => c.maxAttempts)).toEqual([2]); // still the old client
    inv.forget("local");
    await inv.invoke(call);
    expect(sdk.seen.configs.map((c) => c.maxAttempts)).toEqual([2, 6]);
  });
});

describe("createInvoker", () => {
  it("loads a Service's module only on its first call, and once", async () => {
    const loaded: string[] = [];
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const inv = make(sdk, { load: (id) => (loaded.push(id), Promise.resolve(sdk.mod)) });
    expect(loaded).toEqual([]);
    await inv.invoke(call);
    await inv.invoke(call);
    expect(loaded).toEqual(["fake"]);
  });

  it("builds the client against the Gateway origin, with no host prefix, and sends the X-Console header", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const inv = make(sdk);
    await inv.invoke(call);
    expect(sdk.seen.config).toMatchObject({ endpoint: "http://127.0.0.1:9300", region: "us-east-1", forcePathStyle: false, disableHostPrefix: true });
    expect(sdk.seen.config).not.toHaveProperty("requestChecksumCalculation");
    expect(sdk.seen.headers).toMatchObject({ "x-console": "1", "x-console-connection": "local" });
  });

  it("uses path style and WHEN_REQUIRED checksums for s3 only", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    await make(sdk).invoke({ ...call, serviceId: "s3" });
    expect(sdk.seen.config).toMatchObject({ forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  });

  it("returns the output without $metadata, with status and timing", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200, requestId: "r1" }, Things: ["a"] }));
    const r = await make(sdk).invoke(call);
    expect(r).toMatchObject({ ok: true, output: { Things: ["a"] }, meta: { status: 200, requestId: "r1" } });
    expect(r.ok && r.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports unknown-service and sdk-missing", async () => {
    const sdk = fakeSdk(() => ({}));
    const inv = make(sdk, { load: (id) => (id === "fake" ? Promise.resolve(sdk.mod) : undefined) });
    expect(await inv.invoke({ ...call, serviceId: "nope" })).toMatchObject({ ok: false, kind: "unknown-service" });
    expect(await inv.invoke({ ...call, op: "Missing" })).toMatchObject({ ok: false, kind: "sdk-missing" });
  });

  it("classifies a 501 and keeps the status", async () => {
    const sdk = fakeSdk(() => {
      throw Object.assign(new Error("nope"), { name: "NotImplemented", $metadata: { httpStatusCode: 501 } });
    });
    expect(await make(sdk).invoke(call)).toMatchObject({ ok: false, kind: "not-implemented", meta: { status: 501 } });
  });

  it("an input the SDK refuses before sending is `input`, not network", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const r = await make(sdk).invoke({ ...call, input: { bad: true } });
    expect(r).toMatchObject({ ok: false, kind: "input" });
    expect(!r.ok && r.message).toMatch(/Name/);
  });

  it("a failed SDK chunk import or a client constructor throw is a load failure (network), never `input`", async () => {
    const sdk = fakeSdk(() => ({}));
    const failedImport = make(sdk, { load: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) });
    const r1 = await failedImport.invoke(call);
    expect(r1).toMatchObject({ ok: false, kind: "network", code: "ClientLoadFailed" });
    expect(!r1.ok && r1.message).toMatch(/could not be loaded/);

    class Boom {
      constructor() {
        throw new Error("bad config");
      }
    }
    const badCtor = make(sdk, { load: () => Promise.resolve({ BoomClient: Boom, ListThingsCommand: class {} }), regionOf: () => "us-east-1" });
    const r2 = await badCtor.invoke({ ...call, serviceId: "boom" });
    expect(r2).toMatchObject({ ok: false, kind: "network", code: "ClientLoadFailed" });
  });

  it("a credentials fetch failure says the keys are refreshing", async () => {
    const sdk = fakeSdk(() => ({}));
    const inv = make(sdk, { fetchImpl: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch });
    const r = await inv.invoke(call);
    expect(r).toMatchObject({ ok: false, kind: "auth", code: "CredentialsUnavailable" });
    expect(!r.ok && r.message).toMatch(/refreshing, retry/);
  });
});

describe("the auth retry", () => {
  it("rebuilds the client and retries once when the epoch differs from the failing client's, reporting 2 attempts", async () => {
    let epoch = 1;
    const sdk = fakeSdk((_i, config) => {
      if ((config.credentials as { accessKeyId: string }).accessKeyId === "AK1") throw authError();
      return { $metadata: { httpStatusCode: 200 } };
    });
    const fetchImpl = (async () => new Response(JSON.stringify(creds(epoch)))) as unknown as typeof fetch;
    const inv = make(sdk, { fetchImpl });
    epoch = 1;
    const first = await inv.invoke(call); // epoch unchanged: no retry
    expect(first).toMatchObject({ ok: false, kind: "auth", meta: { attempts: 1 } });
    epoch = 2; // the Emulator restarted; the cached client still carries epoch 1
    const second = await inv.invoke(call);
    expect(second).toMatchObject({ ok: true, meta: { attempts: 2 } });
    expect(second.ok && second.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not retry for AccessDenied, which is the policy answering", async () => {
    let fetches = 0;
    const sdk = fakeSdk(() => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    });
    const inv = make(sdk, { fetchImpl: (async () => (fetches++, new Response(JSON.stringify(creds(fetches))))) as unknown as typeof fetch });
    expect(await inv.invoke(call)).toMatchObject({ ok: false, kind: "service-error", meta: { attempts: 1 } });
    expect(fetches).toBe(1);
  });
});

describe("hooks", () => {
  it("adds client middleware per (Connection, Service) and command middleware that knows the Operation and origin", async () => {
    const clientCtx: unknown[] = [];
    const callCtx: unknown[] = [];
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const inv = make(sdk, {
      middleware: (ctx) => (clientCtx.push(ctx), []),
      callMiddleware: (ctx) => (
        callCtx.push(ctx),
        [{ middleware: (next) => (args) => next(args), options: { step: "build", name: "x" } }]
      ),
    });
    await inv.invoke({ ...call, origin: "probe" });
    await inv.invoke({ ...call, origin: "view" });
    expect(clientCtx).toEqual([{ connectionId: "local", serviceId: "fake" }]);
    expect(callCtx).toEqual([
      { connectionId: "local", serviceId: "fake", op: "ListThings", origin: "probe" },
      { connectionId: "local", serviceId: "fake", op: "ListThings", origin: "view" },
    ]);
  });

  it("onResult sees every result, and its exceptions are ignored", async () => {
    const seen: string[] = [];
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const inv = make(sdk, {
      onResult: (c, r) => {
        seen.push(`${c.op}:${r.ok}`);
        throw new Error("observer bug");
      },
    });
    expect((await inv.invoke(call)).ok).toBe(true);
    expect(seen).toEqual(["ListThings:true"]);
  });

  it("clientFor returns the cached client the calls use", async () => {
    const sdk = fakeSdk(() => ({ $metadata: { httpStatusCode: 200 } }));
    const inv = make(sdk);
    const c1 = await inv.clientFor("local", "fake");
    await inv.invoke(call);
    expect(await inv.clientFor("local", "fake")).toBe(c1);
    expect(sdk.seen.configs).toHaveLength(1);
  });
});

describe("the generated registry", () => {
  const index = JSON.parse(readFileSync(new URL("../../../dist/catalog/index.json", import.meta.url), "utf8")) as {
    entries: { serviceId: string; sdkPackage: string }[];
  };

  it("covers every Service of the committed Catalog index, one lazy import each", () => {
    const gen = readFileSync(new URL("../src/sdk-registry.gen.js", import.meta.url), "utf8");
    for (const e of index.entries) {
      expect(gen).toContain(`${JSON.stringify(e.serviceId)}: () => import(${JSON.stringify(e.sdkPackage)}),`);
    }
    expect(gen.match(/: \(\) => import\(/g)).toHaveLength(index.entries.length);
  });

  it("package.json depends on exactly those SDK clients, at one pinned version", () => {
    const pj = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    const sdk = Object.entries(pj.dependencies).filter(([k]) => k.startsWith("@aws-sdk/client-"));
    expect(sdk.map(([k]) => k).sort()).toEqual([...new Set(index.entries.map((e) => e.sdkPackage))].sort());
    expect(new Set(sdk.map(([, v]) => v)).size).toBe(1);
  });
});
