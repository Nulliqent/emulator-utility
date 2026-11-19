import https from "node:https";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Check, Credentials, Health } from "@console/api-contract";
import type { GatewayConfig } from "./config.ts";
import type { Connection } from "./connections.ts";
import { readCredentials } from "./credentials.ts";
import { pinnedTls, type createHealthProbe } from "./health.ts";

/** Everything the checks reach for, so a test can stand in for the Emulator. */
export interface CheckDeps {
  health: () => Promise<Health>;
  credentials: () => Credentials | null;
  callerIdentity: (creds: Credentials, signal?: AbortSignal) => Promise<{ account: string }>;
  listBuckets: (creds: Credentials, signal?: AbortSignal) => Promise<number>;
  /** Overall deadline for the SDK calls. */
  deadlineMs?: number;
  /** The Gateway's own origin, for the same-origin line. */
  publicOrigin?: string;
}

const NOT_CHECKED = "Not checked: the Emulator did not answer. Start it with: docker compose start emulator";

/** Error text for the screen: the SDK's name and message, with any credential value in it removed. */
function describe(e: unknown, creds: Credentials | null): string {
  const err = e as { name?: string; message?: string; code?: string };
  let text = [err.name ?? err.code, err.message].filter(Boolean).join(": ") || "failed";
  if (creds) {
    for (const secret of [creds.secretAccessKey, creds.accessKeyId, creds.sessionToken]) {
      if (secret) text = text.split(secret).join("[redacted]");
    }
  }
  return text.slice(0, 300);
}

async function attempt<T>(
  creds: Credentials,
  signal: AbortSignal,
  run: () => Promise<T>,
  ok: (v: T) => string,
  hint = "",
): Promise<{ ok: boolean; detail: string }> {
  // Race the deadline so a call that ignores the signal cannot hold the response open either.
  const deadline = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out before the Emulator answered"), { name: "TimeoutError" })), { once: true }),
  );
  try {
    return { ok: true, detail: ok(await Promise.race([run(), deadline])) };
  } catch (e) {
    return { ok: false, detail: `${describe(e, creds)}${hint}` };
  }
}

/** Runs the Connections screen's checks. Never returns, logs or throws a credential. */
export async function runChecks(c: Connection, d: CheckDeps): Promise<Check[]> {
  const health = await d.health();
  const checks: Check[] = [];

  checks.push(
    health.reachable
      ? { id: "reachable", ok: true, detail: `${c.dialEndpoint} answered in ${health.latencyMs ?? "?"} ms` }
      : {
          id: "reachable",
          ok: false,
          detail: health.status ? `${c.dialEndpoint} answered HTTP ${health.status}, not 200` : `${c.dialEndpoint} did not answer. Start the Emulator: docker compose start emulator`,
        },
  );

  const tlsDetail: Record<Health["tls"], string> = {
    ok: "The certificate verified against the Emulator's ca.pem",
    untrusted: "The certificate is not trusted: it does not match the Emulator's ca.pem (the Emulator may have regenerated it)",
    missing: `No ca.pem to trust at ${c.caFile}; the Emulator is not running or its home is wrong. Start it with: docker compose start emulator`,
    error: NOT_CHECKED,
  };
  checks.push({ id: "tls", ok: health.tls === "ok", detail: tlsDetail[health.tls] });

  const creds = d.credentials();
  const signal = AbortSignal.timeout(d.deadlineMs ?? 20_000);
  if (!health.reachable) {
    checks.push({ id: "credentials", ok: false, detail: NOT_CHECKED });
    checks.push({ id: "s3-path-style", ok: false, detail: NOT_CHECKED });
  } else if (!creds) {
    const detail = `No keys in ${c.credentialsFile}; the Emulator has not written its credentials. Start the Emulator, then run the checks again`;
    checks.push({ id: "credentials", ok: false, detail }, { id: "s3-path-style", ok: false, detail: "Not checked: no credentials." });
  } else {
    const [identity, buckets] = await Promise.all([
      attempt(
        creds,
        signal,
        () => d.callerIdentity(creds, signal),
        (r) => `sts:GetCallerIdentity returned account ${r.account}`,
        ". The Emulator issues new keys each time it starts: run the checks again",
      ),
      attempt(creds, signal, () => d.listBuckets(creds, signal), (n) => `ListBuckets with path-style addressing returned ${n} ${n === 1 ? "bucket" : "buckets"}`),
    ]);
    checks.push({ id: "credentials", ...identity }, { id: "s3-path-style", ...buckets });
  }

  checks.push({
    id: "same-origin",
    ok: true, // the request got past the Gateway's origin guard to get here
    detail: `The page, the API and the Emulator proxy are served from the same origin${d.publicOrigin ? ` (${d.publicOrigin})` : ""}, so the browser needs no CORS`,
  });
  return checks;
}

/** The real thing: Node SDK clients that dial the Connection's endpoint over HTTP/1.1, trusting only its ca.pem. */
export function createChecker(cfg: GatewayConfig, probe: ReturnType<typeof createHealthProbe>) {
  const clientConfig = (c: Connection, creds: Credentials) => {
    const handler = new NodeHttpHandler({
      // The Emulator speaks HTTP/1.1 only; this handler never negotiates HTTP/2.
      httpsAgent: new https.Agent({ ...pinnedTls(c), keepAlive: false }),
      connectionTimeout: 5_000,
      requestTimeout: 10_000,
    });
    return {
      region: c.region,
      endpoint: c.dialEndpoint,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken },
      requestHandler: handler,
      maxAttempts: 1,
    };
  };
  return (c: Connection) =>
    runChecks(c, {
      publicOrigin: cfg.publicOrigin.origin,
      health: () => probe.check(c),
      credentials: () => readCredentials(c, probe.epochOf(c.id, c.credentialsFile)),
      async callerIdentity(creds, signal) {
        const client = new STSClient(clientConfig(c, creds));
        try {
          const out = await client.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
          return { account: out.Account ?? "unknown" };
        } finally {
          client.destroy();
        }
      },
      async listBuckets(creds, signal) {
        const client = new S3Client({
          ...clientConfig(c, creds),
          forcePathStyle: true,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        });
        try {
          return (await client.send(new ListBucketsCommand({}), { abortSignal: signal })).Buckets?.length ?? 0;
        } finally {
          client.destroy();
        }
      },
    });
}
