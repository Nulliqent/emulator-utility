import { describe, expect, it } from "vitest";
import { downstreamResponseHeaders, hasConsoleHeader, upstreamRequestHeaders } from "../../src/proxy.ts";

describe("upstreamRequestHeaders", () => {
  it("forwards Host, the signature and the body headers unchanged", () => {
    const h = {
      host: "127.0.0.1:9300",
      authorization: "AWS4-HMAC-SHA256 Credential=...",
      "x-amz-date": "20260101T000000Z",
      "content-type": "application/x-amz-json-1.0",
      "content-length": "12",
      "x-console": "1",
    };
    expect(upstreamRequestHeaders(h)).toEqual(h);
  });
  it("strips Origin, Referer, Cookie, Sec-Fetch-* and hop-by-hop headers", () => {
    const out = upstreamRequestHeaders({
      host: "h",
      origin: "http://127.0.0.1:9300",
      referer: "http://127.0.0.1:9300/__console/",
      cookie: "a=b",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      connection: "keep-alive",
      "transfer-encoding": "chunked",
    });
    expect(Object.keys(out)).toEqual(["host"]);
  });
});

describe("downstreamResponseHeaders", () => {
  it("drops cookies, the Emulator's own policy and CORS headers, and sandboxes the body", () => {
    const out = downstreamResponseHeaders({
      "content-type": "text/html",
      "set-cookie": ["a=b"],
      "access-control-allow-origin": "*",
      "x-frame-options": "ALLOWALL",
      "content-security-policy": "default-src *",
      "x-amzn-requestid": "r",
    });
    expect(out["set-cookie"]).toBeUndefined();
    expect(out["access-control-allow-origin"]).toBeUndefined();
    expect(out["x-frame-options"]).toBeUndefined();
    expect(out["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(out["x-content-type-options"]).toBe("nosniff");
    expect(out["x-amzn-requestid"]).toBe("r");
    expect(out["content-type"]).toBe("text/html");
  });
});

describe("the Gateway's error marker", () => {
  it("cannot be forged by an upstream response", () => {
    const out = downstreamResponseHeaders({ "x-console-error": "emulator-unreachable", "x-keep": "1" });
    expect(out["x-console-error"]).toBeUndefined();
    expect(out["x-keep"]).toBe("1");
  });
});

describe("headers named by Connection", () => {
  it("are dropped in both directions, and www-authenticate never reaches the page", () => {
    expect(upstreamRequestHeaders({ host: "h", connection: "close, x-secret", "x-secret": "1", "x-keep": "2" })).toEqual({ host: "h", "x-keep": "2" });
    const out = downstreamResponseHeaders({ connection: "x-private", "x-private": "1", "www-authenticate": "Basic", "x-keep": "2" });
    expect(out["x-private"]).toBeUndefined();
    expect(out["www-authenticate"]).toBeUndefined();
    expect(out["x-keep"]).toBe("2");
  });
});

describe("hasConsoleHeader", () => {
  it("needs a non-empty X-Console", () => {
    expect(hasConsoleHeader({})).toBe(false);
    expect(hasConsoleHeader({ "x-console": "" })).toBe(false);
    expect(hasConsoleHeader({ "x-console": "1" })).toBe(true);
  });
});
