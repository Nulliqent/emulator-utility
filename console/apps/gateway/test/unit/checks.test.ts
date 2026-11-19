import { describe, expect, it } from "vitest";
import type { Credentials, Health } from "@console/api-contract";
import { runChecks, type CheckDeps } from "../../src/checks.ts";
import { discoverLocal } from "../../src/connections.ts";
import { loadConfig } from "../../src/config.ts";

const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const creds: Credentials = { accessKeyId: "AKIAEXAMPLE0000000", secretAccessKey: SECRET, epoch: 1 };
const healthy: Health = { reachable: true, status: 200, latencyMs: 12, checkedAt: "now", credentialsEpoch: 1, tls: "ok" };
const connection = discoverLocal(loadConfig({ CONSOLE_EMULATOR_HOME: "/nonexistent" }));

function deps(over: Partial<CheckDeps> = {}): CheckDeps {
  return {
    health: async () => healthy,
    credentials: () => creds,
    callerIdentity: async () => ({ account: "000000000000" }),
    listBuckets: async () => 12,
    ...over,
  };
}
const byId = (r: Awaited<ReturnType<typeof runChecks>>) => Object.fromEntries(r.map((c) => [c.id, c]));

describe("runChecks", () => {
  it("passes every check against a healthy Emulator, with detail", async () => {
    const r = await runChecks(connection, deps());
    expect(r.map((c) => c.id)).toEqual(["reachable", "tls", "credentials", "s3-path-style", "same-origin"]);
    expect(r.every((c) => c.ok)).toBe(true);
    const c = byId(r);
    expect(c.reachable?.detail).toContain("12 ms");
    expect(c.credentials?.detail).toContain("000000000000");
    expect(c["s3-path-style"]?.detail).toContain("12 buckets");
    expect(c["same-origin"]?.detail).toMatch(/same origin/i);
  });

  it("fails reachable and TLS, and skips the SDK calls, when the Emulator does not answer", async () => {
    let called = false;
    const r = await runChecks(
      connection,
      deps({
        health: async () => ({ ...healthy, reachable: false, status: null, latencyMs: null, tls: "error" }),
        callerIdentity: async () => ((called = true), { account: "x" }),
        listBuckets: async () => ((called = true), 0),
      }),
    );
    const c = byId(r);
    expect(c.reachable?.ok).toBe(false);
    expect(c.reachable?.detail).toMatch(/did not answer/);
    expect(c.tls?.ok).toBe(false);
    expect(c.credentials?.ok).toBe(false);
    expect(c.credentials?.detail).toMatch(/not checked/i);
    expect(c["s3-path-style"]?.ok).toBe(false);
    expect(c["same-origin"]?.ok).toBe(true); // a property of the Gateway, not of the Emulator
    expect(called).toBe(false);
  });

  it("reports untrusted and missing TLS apart", async () => {
    const untrusted = byId(await runChecks(connection, deps({ health: async () => ({ ...healthy, reachable: false, tls: "untrusted" }) })));
    expect(untrusted.tls?.detail).toMatch(/not trusted/i);
    const missing = byId(await runChecks(connection, deps({ health: async () => ({ ...healthy, reachable: false, tls: "missing" }) })));
    expect(missing.tls?.detail).toMatch(/ca\.pem/);
  });

  it("fails credentials when the file is missing, without calling STS", async () => {
    const r = byId(await runChecks(connection, deps({ credentials: () => null, callerIdentity: async () => Promise.reject(new Error("no")) })));
    expect(r.credentials?.ok).toBe(false);
    expect(r.credentials?.detail).toMatch(/emulator_credentials/);
    expect(r["s3-path-style"]?.ok).toBe(false);
  });

  it("fails one SDK check without failing the other", async () => {
    const r = byId(
      await runChecks(
        connection,
        deps({ callerIdentity: async () => Promise.reject(Object.assign(new Error("The security token is invalid"), { name: "InvalidClientTokenId" })) }),
      ),
    );
    expect(r.credentials?.ok).toBe(false);
    expect(r.credentials?.detail).toContain("InvalidClientTokenId");
    expect(r["s3-path-style"]?.ok).toBe(true);
  });

  it("never puts a credential in any detail, even when an SDK error echoes it", async () => {
    const leak = new Error(`bad signature for ${creds.accessKeyId} with ${SECRET}`);
    const r = await runChecks(connection, deps({ callerIdentity: async () => Promise.reject(leak), listBuckets: async () => Promise.reject(leak) }));
    const text = JSON.stringify(r);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(creds.accessKeyId);
    expect(r.find((c) => c.id === "credentials")?.detail).toContain("[redacted]");
  });

  it("gives up on a hung SDK call at the overall deadline and says so", async () => {
    const hang = () => new Promise<never>(() => undefined);
    const r = byId(await runChecks(connection, deps({ callerIdentity: hang, listBuckets: hang, deadlineMs: 30 })));
    expect(r.credentials?.ok).toBe(false);
    expect(r.credentials?.detail).toMatch(/timed out/i);
    expect(r["s3-path-style"]?.detail).toMatch(/timed out/i);
  });

  it("tells the user what to do about a failure", async () => {
    const down = byId(await runChecks(connection, deps({ health: async () => ({ ...healthy, reachable: false, status: null, tls: "error" }) })));
    expect(down.reachable?.detail).toContain("docker compose start emulator");
    const noKeys = byId(await runChecks(connection, deps({ credentials: () => null })));
    expect(noKeys.credentials?.detail).toMatch(/start the Emulator/i);
    const rejected = byId(await runChecks(connection, deps({ callerIdentity: async () => Promise.reject(Object.assign(new Error("bad"), { name: "InvalidClientTokenId" })) })));
    expect(rejected.credentials?.detail).toMatch(/run the checks again/i);
  });
});
