// Console API contract (ARCHITECTURE section 4), shared by the Gateway and the web app.
import { z } from "zod";

export const API_BASE = "/__console/api/v1";

/** The custom request header the Gateway requires on the credentials endpoint, the AWS pass-through and every mutating route. */
export const CONSOLE_HEADER = "X-Console";
/** Where the Gateway serves the compiled Catalog: `<CATALOG_BASE>/<fingerprint>/index.json` and so on. */
export const CATALOG_BASE = "/__console/catalog";

/** Names of the Server-Sent Events on `GET /events`. */
export const SSE_EVENTS = { health: "health" } as const;

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Meta = z.object({
  gatewayVersion: z.string(),
  catalog: z.object({
    /** null when the Catalog manifest is missing. */
    fingerprint: z.string().nullable(),
    sourceCommit: z.string().nullable(),
    sdkVersion: z.string().nullable(),
    builtAt: z.string().nullable(),
  }),
  features: z.object({ reset: z.boolean() }),
});
export type Meta = z.infer<typeof Meta>;

/** No secrets: the Emulator Credentials never appear in a ConnectionSummary. */
export const ConnectionSummary = z.object({
  id: z.string(),
  name: z.string(),
  /** The endpoint apps on the host use (from the Emulator's own config), kept for snippets. */
  endpoint: z.string(),
  /** The endpoint the Gateway itself dials, for example https://emulator:9297 inside compose. */
  dialEndpoint: z.string(),
  region: z.string(),
  accountId: z.string(),
  /** Where the Gateway looks for the Emulator home, and whether it found it. */
  home: z.object({ path: z.string(), found: z.boolean() }),
});
export type ConnectionSummary = z.infer<typeof ConnectionSummary>;

export const ConnectionList = z.object({ active: z.string(), items: z.array(ConnectionSummary) });
export type ConnectionList = z.infer<typeof ConnectionList>;

export const Health = z.object({
  /** True only when the Emulator's health endpoint answered 200. */
  reachable: z.boolean(),
  /** HTTP status of the health endpoint, or null when it could not be reached. */
  status: z.number().int().nullable(),
  latencyMs: z.number().nullable(),
  checkedAt: z.string(),
  /**
   * Changes when the Emulator rotates its credentials (a restart). Compare with `!==`, never `>`:
   * it is a change marker, and it restarts at 1 when the Gateway restarts.
   */
  credentialsEpoch: z.number().int(),
  /**
   * ok: the TLS handshake worked (or not needed yet); untrusted: the certificate did not verify;
   * missing: no `ca.pem` to trust (the Emulator is not running or its home is wrong);
   * error: any other connection failure.
   */
  tls: z.enum(["ok", "untrusted", "missing", "error"]),
});
export type Health = z.infer<typeof Health>;

/** Payload of the SSE `health` event on `GET /events`. */
export const HealthEvent = z.object({ connectionId: z.string(), health: Health });
export type HealthEvent = z.infer<typeof HealthEvent>;

/**
 * The Emulator Credentials of a Connection, for the SPA's SDK clients. Served same-origin only, `no-store`, and only
 * to a request that carries the `X-Console` header. Never logged, never put in a URL.
 */
export const Credentials = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  /** The Connection's credentials epoch (see Health). */
  epoch: z.number().int(),
});
export type Credentials = z.infer<typeof Credentials>;

export const paths = {
  meta: `${API_BASE}/meta`,
  connections: `${API_BASE}/connections`,
  health: (id: string) => `${API_BASE}/connections/${encodeURIComponent(id)}/health`,
  credentials: (id: string) => `${API_BASE}/connections/${encodeURIComponent(id)}/credentials`,
  events: `${API_BASE}/events`,
} as const;
