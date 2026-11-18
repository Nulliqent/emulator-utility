import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { Connection } from "./connections.ts";

/** Hop-by-hop headers (RFC 9110 7.6.1) never cross a proxy; Node sets its own framing. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);

/** Not signed by the SDK and meaningless to the Emulator: the browser's identity and context. */
const REQUEST_STRIP = new Set(["origin", "referer", "cookie"]);

/**
 * Headers the Emulator must not push onto the Console's origin: cookies, framing and policy headers
 * (the Gateway's own CSP and friends apply), and CORS grants.
 */
const RESPONSE_STRIP = new Set(["x-console-error", "www-authenticate", "set-cookie", "set-cookie2", "content-security-policy", "content-security-policy-report-only", "x-frame-options", "strict-transport-security", "clear-site-data"]);

/** Headers a `Connection:` value names are hop-by-hop too (RFC 9110 7.6.1). */
function namedByConnection(headers: http.IncomingHttpHeaders): Set<string> {
  const v = headers.connection;
  return new Set(String(v ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
}

/** Method, path, query, body and Host go through unchanged (the browser's SigV4 signature covers them). */
export function upstreamRequestHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  const named = namedByConnection(headers);
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k) || named.has(k) || REQUEST_STRIP.has(k) || k.startsWith("sec-fetch-")) continue;
    out[k] = v;
  }
  return out;
}

export function downstreamResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  const named = namedByConnection(headers);
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k) || named.has(k) || RESPONSE_STRIP.has(k) || k.startsWith("access-control-") || k.startsWith("cross-origin-")) continue;
    out[k] = v;
  }
  // The Emulator's bodies (S3 objects, error pages) are untrusted content on the Console's origin: a sandboxed,
  // script-less document with no `nosniff` escape. API clients ignore this header.
  out["content-security-policy"] = "sandbox; default-src 'none'";
  out["x-content-type-options"] = "nosniff";
  out["cross-origin-resource-policy"] = "same-origin";
  return out;
}

/**
 * Whether the request carries the Console's custom header. A cross-site page cannot send it without a CORS
 * preflight, which the Gateway never approves (OPTIONS from another origin is refused by the origin guard).
 */
export function hasConsoleHeader(headers: http.IncomingHttpHeaders): boolean {
  return headers["x-console"] !== undefined && headers["x-console"] !== "";
}

export interface ProxyOptions {
  /** Idle time on the upstream socket after which the call is destroyed (answered 504). */
  timeoutMs: number;
}

export function createProxy(opts: ProxyOptions) {
  // One keep-alive agent per Connection, so TLS sessions are reused. A new CA (the Emulator was reset) replaces it.
  const agents = new Map<string, { ca: string; agent: https.Agent }>();
  function agentFor(id: string, ca: Buffer): https.Agent {
    const key = ca.toString("latin1");
    const known = agents.get(id);
    if (known?.ca === key) return known.agent;
    known?.agent.destroy();
    const agent = new https.Agent({ ca, keepAlive: true, maxSockets: 32 });
    agents.set(id, { ca: key, agent });
    return agent;
  }

  /** Streams the browser's request to the Emulator and its response back; nothing is buffered. */
  return function proxy(req: http.IncomingMessage, res: http.ServerResponse, c: Connection, fail: (status: number, code: string, message: string) => void): void {
    let ca: Buffer;
    try {
      ca = readFileSync(c.caFile);
    } catch {
      return fail(502, "emulator-unreachable", "The Emulator's certificate was not found; is it running?");
    }
    const upstream = https.request(
      {
        host: c.dialUrl.hostname,
        port: c.dialUrl.port || 443,
        method: req.method,
        path: req.url,
        headers: upstreamRequestHeaders(req.headers),
        agent: agentFor(c.id, ca),
        timeout: opts.timeoutMs,
        // The CA names 127.0.0.1 whatever host we dial; SNI cannot carry an IP, so no `servername`.
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity("127.0.0.1", cert),
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.statusMessage, downstreamResponseHeaders(up.headers));
        up.pipe(res);
        up.on("error", () => res.destroy());
      },
    );
    let timedOut = false;
    upstream.on("timeout", () => {
      timedOut = true;
      upstream.destroy();
    });
    upstream.on("error", () => {
      if (res.headersSent) res.destroy();
      else if (timedOut) fail(504, "emulator-timeout", "The Emulator did not answer in time.");
      else fail(502, "emulator-unreachable", "The Emulator did not answer.");
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy(); // the browser went away: stop the upstream call
    });
    req.pipe(upstream);
  };
}
