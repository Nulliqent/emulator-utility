import type { Health } from "@console/api-contract";
import { describe, expect, it } from "vitest";
import { describeHealth, type HealthInput } from "../src/app/health-state.ts";

const base: Health = {
  reachable: true,
  status: 200,
  latencyMs: 12,
  checkedAt: "2026-11-18T10:00:00.000Z", // the Gateway's clock: never compared with the browser's
  credentialsEpoch: 1,
  tls: "ok",
};
const unreachable = (tls: Health["tls"]): Health => ({ ...base, reachable: false, status: null, latencyMs: null, tls });
const NOW = 1_000_000;
const view = (health: Health | undefined, extra: Partial<HealthInput> = {}) =>
  describeHealth({ health, gatewayDown: false, now: NOW, receivedAt: NOW - 1000, staleAfterMs: 10_000, ...extra });

describe("describeHealth", () => {
  it("reports healthy with latency kept apart from the announced words", () => {
    expect(view(base)).toEqual({ tone: "ok", text: "Emulator healthy", detail: "12 ms" });
  });
  it("reports unreachable", () => {
    expect(view(unreachable("error"))).toMatchObject({ tone: "danger", text: "Emulator unreachable" });
  });
  it("does not blame the certificate when ca.pem is missing", () => {
    const v = view(unreachable("missing"));
    expect(v.text).toBe("Emulator unreachable");
    expect(v.detail).toBe("not running?");
  });
  it("points at CONSOLE_EMULATOR_HOME while the home is not found", () => {
    expect(view(unreachable("missing"), { homeFound: false }).detail).toBe("check CONSOLE_EMULATOR_HOME");
  });
  it("blames the certificate only for an untrusted one", () => {
    expect(view(unreachable("untrusted")).detail).toBe("certificate not trusted");
  });
  it("shows a 503 over working TLS as unhealthy", () => {
    expect(view({ ...base, reachable: false, status: 503 })).toMatchObject({ tone: "danger", text: "Emulator unhealthy", detail: "503" });
  });
  it("reports the Gateway as unreachable", () => {
    expect(view(base, { gatewayDown: true }).text).toBe("Gateway unreachable");
  });
  it("measures staleness from when the browser received the data", () => {
    expect(view(base, { receivedAt: NOW - 60_000 }).text).toBe("Gateway unreachable");
    expect(view(base, { receivedAt: NOW - 9_000 }).text).toBe("Emulator healthy");
  });
  it("ignores a skewed Gateway checkedAt", () => {
    const skewed = { ...base, checkedAt: "1999-01-01T00:00:00.000Z" };
    expect(view(skewed).text).toBe("Emulator healthy");
    expect(view({ ...base, checkedAt: "2999-01-01T00:00:00.000Z" }).text).toBe("Emulator healthy");
  });
  it("shows a neutral state before the first answer", () => {
    expect(view(undefined, { receivedAt: undefined })).toMatchObject({ tone: "neutral", text: "Checking emulator…" });
  });
});
