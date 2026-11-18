import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { parseDefaultProfile } from "../../src/connections.ts";
import { createEpochTracker, safeContentType } from "../../src/health.ts";
import { createOriginGuard } from "../../src/origin.ts";

describe("createOriginGuard", () => {
  const allowed = createOriginGuard(new URL("http://127.0.0.1:9300"));
  const ok = { host: "127.0.0.1:9300" };

  it("accepts a same-origin browser request", () => {
    expect(allowed({ ...ok, "sec-fetch-site": "same-origin" })).toBe(true);
  });
  it("accepts curl-style callers: no Sec-Fetch-Site and no Origin", () => {
    expect(allowed(ok)).toBe(true);
  });
  it("refuses an Origin when Sec-Fetch-Site is absent, even the Gateway's own", () => {
    expect(allowed({ ...ok, origin: "http://127.0.0.1:9300" })).toBe(false);
  });
  it("refuses same-site, cross-site and none", () => {
    for (const site of ["same-site", "cross-site", "none"]) expect(allowed({ ...ok, "sec-fetch-site": site })).toBe(false);
  });
  it("accepts localhost and [::1] on the right port, and refuses the wrong port", () => {
    for (const host of ["localhost:9300", "[::1]:9300"]) {
      expect(allowed({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin" })).toBe(true);
    }
    expect(allowed({ host: "127.0.0.1:9301", "sec-fetch-site": "same-origin" })).toBe(false);
    expect(allowed({ host: "127.0.0.1", "sec-fetch-site": "same-origin" })).toBe(false);
  });
  it("refuses a foreign Origin and a rebinding Host", () => {
    expect(allowed({ ...ok, origin: "http://evil.example", "sec-fetch-site": "same-origin" })).toBe(false);
    expect(allowed({ host: "evil.example:9300", "sec-fetch-site": "same-origin" })).toBe(false);
    expect(allowed({ "sec-fetch-site": "same-origin" })).toBe(false);
  });
});

describe("parseDefaultProfile", () => {
  it("reads top-level keys of [default] and skips continuation lines and other sections", () => {
    const text = [
      "[other]",
      "region = eu-west-1",
      "[default]",
      "region = us-east-1",
      "endpoint_url = https://127.0.0.1:9297",
      "s3 =",
      "  signature_version = s3v4",
    ].join("\n");
    expect(parseDefaultProfile(text)).toEqual({
      region: "us-east-1",
      endpoint_url: "https://127.0.0.1:9297",
      s3: "",
    });
  });
  it("copes with CRLF line endings", () => {
    expect(parseDefaultProfile("[default]\r\nregion = us-west-2\r\n")).toEqual({ region: "us-west-2" });
  });
});

describe("createEpochTracker", () => {
  it("starts at 1, increments when the stamp changes, and holds when it does not", () => {
    let stamp = "a";
    const epochOf = createEpochTracker(() => stamp);
    expect(epochOf("local", "f")).toBe(1);
    expect(epochOf("local", "f")).toBe(1);
    stamp = "b";
    expect(epochOf("local", "f")).toBe(2);
    expect(epochOf("local", "f")).toBe(2);
  });
  it("tracks Connections independently", () => {
    const epochOf = createEpochTracker((f) => f);
    expect(epochOf("one", "x")).toBe(1);
    expect(epochOf("two", "y")).toBe(1);
  });
});

describe("safeContentType", () => {
  it("passes JSON and plain text through", () => {
    expect(safeContentType("application/json")).toBe("application/json; charset=utf-8");
    expect(safeContentType("Application/JSON; charset=utf-8")).toBe("application/json; charset=utf-8");
    expect(safeContentType("text/plain")).toBe("text/plain; charset=utf-8");
  });
  it("serves anything else as plain text", () => {
    for (const t of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/javascript", undefined, ""]) {
      expect(safeContentType(t)).toBe("text/plain; charset=utf-8");
    }
  });
});

describe("loadConfig bind address", () => {
  it("defaults to loopback", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });
  it("refuses a non-loopback bind unless explicitly allowed", () => {
    expect(() => loadConfig({ CONSOLE_HOST: "0.0.0.0" })).toThrow(/CONSOLE_ALLOW_REMOTE_BIND/);
    expect(loadConfig({ CONSOLE_HOST: "0.0.0.0", CONSOLE_ALLOW_REMOTE_BIND: "1" }).host).toBe("0.0.0.0");
  });
});
