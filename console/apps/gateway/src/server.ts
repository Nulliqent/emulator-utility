import { readFileSync } from "node:fs";
import http from "node:http";
import { API_BASE, type ConnectionList, type Meta } from "@console/api-contract";
import type { GatewayConfig } from "./config.ts";
import { createRegistry, toSummary } from "./connections.ts";
import { createEventHub } from "./events.ts";
import { createHealthProbe } from "./health.ts";
import { createOriginGuard } from "./origin.ts";
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

const fail = (res: http.ServerResponse, status: number, code: string, message: string) =>
  json(res, status, { error: { code, message } });

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
    if ((p === "/" && (method === "GET" || method === "HEAD")) || p === "/__console") {
      res.writeHead(302, { Location: "/__console/" });
      return void res.end();
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
      if (method !== "GET") return fail(res, 405, "method-not-allowed", "Only GET is available yet.");
      if (route === "/meta") return json(res, 200, readMeta(cfg));
      if (route === "/connections") {
        const body: ConnectionList = { active, items: items.map(toSummary) };
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

    // The AWS pass-through proxy arrives with ticket #7.
    return fail(res, 404, "not-found", "No such endpoint.");
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
