import { readFileSync } from "node:fs";
import http from "node:http";
import { API_BASE, CATALOG_BASE, type ConnectionList, type Meta } from "@console/api-contract";
import { serveCatalog } from "./catalog.ts";
import type { GatewayConfig } from "./config.ts";
import { createRegistry, toSummary } from "./connections.ts";
import { readCredentials } from "./credentials.ts";
import { createEventHub } from "./events.ts";
import { createHealthProbe } from "./health.ts";
import { createOriginGuard } from "./origin.ts";
import { createProxy, hasConsoleHeader } from "./proxy.ts";
import { serveSpa } from "./static.ts";

// The built SPA loads only same-origin scripts and styles (no inline code), so this CSP needs no 'unsafe-inline'.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// The Gateway marks its own failures with `X-Console-Error`, so a client can tell them from the Emulator's.
const fail = (res: http.ServerResponse, status: number, code: string, message: string) => {
  res.setHeader("X-Console-Error", code);
  json(res, status, { error: { code, message } });
};

function readMeta(cfg: GatewayConfig): Meta {
  let fingerprint: string | null = null;
  let sourceCommit: string | null = null;
  try {
    const m = JSON.parse(readFileSync(cfg.catalogManifest, "utf8")) as {
      fingerprint?: string;
      source?: { emulator?: string };
    };
    fingerprint = m.fingerprint ?? null;
    sourceCommit = m.source?.emulator ?? null;
  } catch {
    // The Catalog is not served yet (D-14); the meta endpoint still answers.
  }
  return {
    gatewayVersion: cfg.gatewayVersion,
    catalog: { fingerprint, sourceCommit, sdkVersion: null, builtAt: null },
    features: { reset: false },
  };
}

export function createServer(cfg: GatewayConfig) {
  const registry = createRegistry(cfg);
  const probe = createHealthProbe(cfg);
  const isSameOrigin = createOriginGuard(cfg.publicOrigin);
  const proxy = createProxy({ timeoutMs: cfg.proxyTimeoutMs });
  const hub = createEventHub(
    () =>
      Promise.all(registry.list().items.map(async (c) => ({ connectionId: c.id, health: await probe.check(c) }))),
    cfg.healthIntervalMs,
  );

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let p: string;
    try {
      p = decodeURIComponent(new URL(req.url ?? "/", "http://gateway.invalid").pathname);
    } catch {
      return fail(res, 404, "not-found", "No such endpoint."); // malformed URL or % escape
    }
    const method = req.method ?? "GET";

    // The SPA is public; it holds no secrets. It is navigated to directly, so it is not origin-checked.
    // Only for browser navigations: an SDK call to `GET /` (S3 ListBuckets) carries X-Console and goes to the proxy.
    if ((p === "/" && (method === "GET" || method === "HEAD") && !hasConsoleHeader(req.headers)) || p === "/__console") {
      res.writeHead(302, { Location: "/__console/" });
      return void res.end();
    }
    // The compiled Catalog is public like the SPA (no secrets), content-addressed by its fingerprint.
    if (p.startsWith(`${CATALOG_BASE}/`)) {
      if (method !== "GET" && method !== "HEAD") return fail(res, 405, "method-not-allowed", "Use GET.");
      return serveCatalog(cfg.catalogManifest, p.slice(CATALOG_BASE.length + 1), res, method === "HEAD");
    }
    const isApi = p === API_BASE || p.startsWith(`${API_BASE}/`);
    if (p.startsWith("/__console/") && !isApi) {
      if (method !== "GET" && method !== "HEAD") return fail(res, 405, "method-not-allowed", "Use GET.");
      return serveSpa(cfg.webDir, p.slice("/__console/".length), res, method === "HEAD");
    }

    // Everything else (the API and the Emulator pass-through) accepts same-origin callers only.
    if (!isSameOrigin(req.headers)) return fail(res, 403, "forbidden-origin", "Cross-origin requests are refused.");

    const { active, items } = registry.list();

    if (isApi) {
      const route = p.slice(API_BASE.length);
      // A cross-site page cannot add a custom header without a CORS preflight, which is never approved.
      const credentials = /^\/connections\/([^/]+)\/credentials$/.exec(route);
      if ((credentials || method !== "GET") && !hasConsoleHeader(req.headers)) {
        return fail(res, 403, "console-header-required", "Send the X-Console header.");
      }
      if (method !== "GET") return fail(res, 405, "method-not-allowed", "Only GET is available yet.");
      if (route === "/meta") return json(res, 200, readMeta(cfg));
      if (route === "/connections") {
        const body: ConnectionList = { active, items: items.map(toSummary) };
        return json(res, 200, body);
      }
      if (credentials) {
        const c = items.find((x) => x.id === credentials[1]);
        if (!c) return fail(res, 404, "connection-not-found", "No such Connection.");
        const body = readCredentials(c, probe.epochOf(c.id, c.credentialsFile));
        if (!body) return fail(res, 503, "credentials-unavailable", "The Emulator has not written its credentials; is it running?");
        return json(res, 200, body);
      }
      const health = /^\/connections\/([^/]+)\/health$/.exec(route);
      if (health) {
        const c = items.find((x) => x.id === health[1]);
        if (!c) return fail(res, 404, "connection-not-found", "No such Connection.");
        return json(res, 200, await probe.check(c));
      }
      if (route === "/events") {
        hub.subscribe(res);
        return;
      }
      return fail(res, 404, "not-found", "No such endpoint.");
    }

    if (p === "/__admin/health" && method === "GET") {
      const c = items.find((x) => x.id === active);
      if (!c) return fail(res, 404, "connection-not-found", "No active Connection.");
      try {
        const r = await probe.request(c);
        res.writeHead(r.status, { "Content-Type": r.contentType, "Cache-Control": "no-store" });
        return void res.end(r.body);
      } catch {
        return fail(res, 502, "emulator-unreachable", "The Emulator did not answer.");
      }
    }

    // Everything else is the AWS pass-through (ARCHITECTURE 3.9). It needs the custom header like any other
    // state-changing route, and names its Connection with `x-console-connection` (default: the active one).
    if (!hasConsoleHeader(req.headers)) {
      // A browser typing an address (/favicon.ico) gets a plain 404; anything else is told what it is missing.
      if (req.headers["sec-fetch-mode"] === "navigate") return fail(res, 404, "not-found", "No such endpoint.");
      return fail(res, 403, "console-header-required", "Send the X-Console header.");
    }
    const wanted = req.headers["x-console-connection"];
    const target = items.find((x) => x.id === (typeof wanted === "string" ? wanted : active));
    if (!target) return fail(res, 404, "connection-not-found", "No such Connection.");
    return proxy(req, res, target, (status, code, message) => fail(res, status, code, message));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      console.error(`request failed: ${(e as Error).message}`);
      if (!res.headersSent) fail(res, 500, "internal", "Internal error.");
      else res.end();
    });
  });
  server.on("close", () => hub.close());
  return { server, registry };
}
