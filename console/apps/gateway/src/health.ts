import { readFileSync } from "node:fs";
import https from "node:https";
import tls from "node:tls";
import type { Health } from "@console/api-contract";
import type { GatewayConfig } from "./config.ts";
import { credentialsStamp, type Connection } from "./connections.ts";

const CERT_ERRORS = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Counts credential rotations per Connection: the epoch increments when `stampOf(file)` changes.
 * It is a change marker (compare with `!==`), and restarts at 1 when the Gateway restarts.
 */
export function createEpochTracker(stampOf: (file: string) => string = credentialsStamp) {
  const state = new Map<string, { stamp: string; epoch: number }>();
  return (id: string, credentialsFile: string): number => {
    const stamp = stampOf(credentialsFile);
    const prev = state.get(id);
    if (!prev) {
      state.set(id, { stamp, epoch: 1 });
      return 1;
    }
    if (prev.stamp !== stamp) {
      prev.stamp = stamp;
      prev.epoch += 1;
    }
    return prev.epoch;
  };
}

/** Only JSON and plain text pass through from the Emulator; any other type is served as plain text. */
export function safeContentType(value: string | undefined): string {
  const mime = (value ?? "").split(";")[0]!.trim().toLowerCase();
  return mime === "application/json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
}

export interface ProbeResponse {
  status: number;
  body: string;
  contentType: string;
  latencyMs: number;
}

export function createHealthProbe(cfg: GatewayConfig) {
  const epochOf = createEpochTracker();

  /** GET <emulator>/__admin/health over TLS, trusting only the Connection's ca.pem (spike P0.1). */
  function request(c: Connection): Promise<ProbeResponse> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      let ca: Buffer;
      try {
        ca = readFileSync(c.caFile);
      } catch {
        reject(Object.assign(new Error("ca.pem not found"), { code: "CA_MISSING" }));
        return;
      }
      const req = https.request(
        {
          host: c.dialUrl.hostname,
          port: c.dialUrl.port || 443,
          path: "/__admin/health",
          method: "GET",
          ca,
          agent: false,
          signal: AbortSignal.timeout(cfg.healthTimeoutMs), // hard deadline for the whole exchange
          // The CA names 127.0.0.1 whatever host we dial; SNI cannot carry an IP, so no `servername`.
          checkServerIdentity: (_host, cert) => tls.checkServerIdentity("127.0.0.1", cert),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (d: Buffer) => {
            size += d.length;
            if (size > MAX_BODY_BYTES) req.destroy(Object.assign(new Error("body too large"), { code: "BODY_TOO_LARGE" }));
            else chunks.push(d);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              contentType: safeContentType(res.headers["content-type"]),
              latencyMs: Math.round(performance.now() - started),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  return {
    request,
    async check(c: Connection): Promise<Health> {
      const checkedAt = new Date().toISOString();
      const credentialsEpoch = epochOf(c.id, c.credentialsFile);
      try {
        const r = await request(c);
        return { reachable: r.status === 200, status: r.status, latencyMs: r.latencyMs, checkedAt, credentialsEpoch, tls: "ok" };
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        const tlsState = code === "CA_MISSING" ? "missing" : CERT_ERRORS.has(code) ? "untrusted" : "error";
        return { reachable: false, status: null, latencyMs: null, checkedAt, credentialsEpoch, tls: tlsState };
      }
    },
  };
}
