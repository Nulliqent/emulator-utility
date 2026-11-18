import type { IncomingHttpHeaders } from "node:http";

/**
 * The same-origin rule of ARCHITECTURE 3.9 (ADR-0003). A request is accepted when
 * - `Sec-Fetch-Site` is `same-origin`, or is absent and there is no `Origin` (curl-style callers);
 * - `Origin`, when present, equals the Gateway's own origin;
 * - `Host` names the Gateway (this also stops DNS rebinding).
 * Everything else is refused with 403.
 */
export function createOriginGuard(publicOrigin: URL) {
  const port = publicOrigin.port;
  const hosts = new Set(
    [publicOrigin.hostname, "localhost", "127.0.0.1", "[::1]"].map((h) => (port ? `${h}:${port}` : h)),
  );
  const origins = new Set([...hosts].map((h) => `${publicOrigin.protocol}//${h}`));

  return function isAllowed(headers: IncomingHttpHeaders): boolean {
    const host = headers.host?.toLowerCase();
    if (!host || !hosts.has(host)) return false;
    const origin = headers.origin;
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) return false;
    const site = headers["sec-fetch-site"];
    if (site === undefined) return origin === undefined;
    return site === "same-origin";
  };
}
