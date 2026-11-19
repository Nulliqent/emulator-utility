import { CONSOLE_HEADER, paths, Credentials } from "@console/api-contract";
import { classifyError, isAuthCode, type SdkErrorLike } from "./classify.ts";
import type {
  CallContext,
  ClientContext,
  InvokeCall,
  InvokeResult,
  InvokerMiddleware,
  OperationInvoker,
  SmithyMiddleware,
} from "./types.ts";

type SdkModule = Record<string, unknown>;
export type ModuleLoader = (serviceId: string) => Promise<SdkModule> | undefined;

type Req = { request?: { headers?: Record<string, string> } };
interface SdkClient {
  middlewareStack: { add(mw: SmithyMiddleware, opts: Record<string, unknown>): void };
  send(command: unknown, opts?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown> & { $metadata?: SdkErrorLike["$metadata"] }>;
}
type ClientCtor = new (config: Record<string, unknown>) => SdkClient;
type CommandCtor = new (input: unknown) => { middlewareStack?: SdkClient["middlewareStack"] };

export interface InvokerOptions {
  /** The Gateway's own origin: every client's endpoint (pass-through proxy, ADR-0003). */
  origin: string;
  /** Lazy per-Service module loader; the generated registry in the app, a fake in tests. */
  load: ModuleLoader;
  /** Region of a Connection. */
  regionOf: (connectionId: string) => Promise<string> | string;
  fetchImpl?: typeof fetch;
  /** Per-call deadline when `behaviourOf` is not given. */
  timeoutMs?: number;
  /** Client behaviour of a Connection (its saved max attempts and request timeout). */
  behaviourOf?: (connectionId: string) => Promise<{ maxAttempts: number; timeoutMs: number }> | { maxAttempts: number; timeoutMs: number };
  /** Extra middleware added to each client when it is built (Call Capture, ARCHITECTURE 3.5). */
  middleware?: (ctx: ClientContext) => InvokerMiddleware[];
  /** Extra middleware added to each command: it knows the call's Operation and origin. */
  callMiddleware?: (ctx: CallContext) => InvokerMiddleware[];
  /** Sees the final result of every `invoke`. An exception in it is ignored. */
  onResult?: (call: InvokeCall, result: InvokeResult) => void;
}

/** The custom header the Gateway requires on the pass-through and on the credentials endpoint (CSRF defence). */
export const CONNECTION_HEADER = "x-console-connection";

interface Entry {
  client: SdkClient;
  epoch: number;
  mod: SdkModule;
}

function clientCtorOf(mod: SdkModule, serviceId: string): ClientCtor | undefined {
  const names = Object.keys(mod).filter((k) => k.endsWith("Client") && typeof mod[k] === "function");
  const exact = names.find((k) => k.toLowerCase() === `${serviceId.replaceAll("-", "")}client`);
  const name = exact ?? (names.length === 1 ? names[0] : undefined);
  return name ? (mod[name] as ClientCtor) : undefined;
}

class MissingError extends Error {
  readonly what: "service" | "client";
  constructor(what: "service" | "client") {
    super(what);
    this.what = what;
  }
}

export function createInvoker(opts: InvokerOptions): OperationInvoker {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const clients = new Map<string, Promise<Entry>>();
  const credentials = new Map<string, Promise<Credentials>>();

  function fetchCredentials(connectionId: string): Promise<Credentials> {
    let p = credentials.get(connectionId);
    if (!p) {
      p = (async () => {
        const res = await doFetch(`${opts.origin}${paths.credentials(connectionId)}`, {
          headers: { Accept: "application/json", [CONSOLE_HEADER]: "1" },
          cache: "no-store",
        });
        if (!res.ok) throw Object.assign(new Error(`credentials: HTTP ${res.status}`), { name: "CredentialsUnavailable" });
        return Credentials.parse(await res.json());
      })();
      p.catch(() => credentials.delete(connectionId)); // do not cache a failure
      credentials.set(connectionId, p);
    }
    return p;
  }

  function drop(connectionId: string) {
    credentials.delete(connectionId);
    for (const key of [...clients.keys()]) if (key.startsWith(`${connectionId}\u0000`)) clients.delete(key);
  }

  async function build(connectionId: string, serviceId: string, mod: SdkModule): Promise<Entry> {
    const Ctor = clientCtorOf(mod, serviceId);
    if (!Ctor) throw new MissingError("client");
    const creds = await fetchCredentials(connectionId);
    const region = await opts.regionOf(connectionId);
    const behaviour = (await opts.behaviourOf?.(connectionId)) ?? { maxAttempts: 1, timeoutMs: opts.timeoutMs };
    const client = new Ctor({
      region,
      endpoint: opts.origin,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken },
      // The Gateway is the only host: no `{AccountId}.` or `data-` prefixes on the endpoint.
      disableHostPrefix: true,
      forcePathStyle: serviceId === "s3",
      ...(serviceId === "s3"
        ? { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }
        : {}),
      maxAttempts: behaviour.maxAttempts,
      requestHandler: behaviour.timeoutMs ? { requestTimeout: behaviour.timeoutMs } : undefined,
    });
    // At the build step, so both headers are signed and the Gateway forwards them unchanged.
    client.middlewareStack.add(
      (next) => (args: Req) => {
        const h = args.request?.headers;
        if (h) {
          h[CONSOLE_HEADER.toLowerCase()] = "1";
          h[CONNECTION_HEADER] = connectionId;
        }
        return next(args);
      },
      { step: "build", name: "consoleHeaders", priority: "low" },
    );
    for (const m of opts.middleware?.({ connectionId, serviceId }) ?? []) client.middlewareStack.add(m.middleware, m.options);
    return { client, epoch: creds.epoch, mod };
  }

  function entryFor(connectionId: string, serviceId: string): Promise<Entry> {
    const key = `${connectionId}\u0000${serviceId}`;
    let p = clients.get(key);
    if (!p) {
      const loading = opts.load(serviceId);
      if (!loading) return Promise.reject(new MissingError("service"));
      p = loading.then((mod) => build(connectionId, serviceId, mod));
      p.catch(() => clients.delete(key));
      clients.set(key, p);
    }
    return p;
  }

  /** One send. `epoch` is the epoch of the keys the client used. */
  async function attempt(call: InvokeCall): Promise<{ result: InvokeResult; epoch?: number }> {
    const started = performance.now();
    const took = () => Math.round(performance.now() - started);
    let sent = false; // set by the build-step middleware: after serialization, so before it means a bad input
    let entry: Entry;
    try {
      entry = await entryFor(call.connectionId, call.serviceId);
    } catch (e) {
      if (e instanceof MissingError) {
        return {
          result:
            e.what === "service"
              ? { ok: false, kind: "unknown-service", message: `No Service "${call.serviceId}" in this Catalog.` }
              : { ok: false, kind: "sdk-missing", message: `The SDK for "${call.serviceId}" has no client class.` },
        };
      }
      if ((e as { name?: string }).name === "CredentialsUnavailable") {
        const c = classifyError(e, { sent: false });
        return { result: { ok: false, kind: c.kind, code: c.code, message: c.message, meta: { durationMs: took() } } };
      }
      // A failed chunk import or a client constructor that threw: nothing to do with the user's input.
      return {
        result: {
          ok: false,
          kind: "network",
          code: "ClientLoadFailed",
          message: `The SDK for "${call.serviceId}" could not be loaded: ${(e as Error).message}`,
          meta: { durationMs: took() },
        },
      };
    }
    const Command = entry.mod[`${call.op}Command`] as CommandCtor | undefined;
    if (typeof Command !== "function") {
      return {
        result: { ok: false, kind: "sdk-missing", message: `The SDK has no ${call.op}Command; it is older than the Emulator's model.` },
        epoch: entry.epoch,
      };
    }
    try {
      const command = new Command(call.input ?? {});
      const ctx: CallContext = { connectionId: call.connectionId, serviceId: call.serviceId, op: call.op, origin: call.origin };
      command.middlewareStack?.add((next) => (args: Req) => ((sent = true), next(args)), { step: "build", name: "callSent", priority: "low" });
      for (const m of opts.callMiddleware?.(ctx) ?? []) command.middlewareStack?.add(m.middleware, m.options);
      const out = await entry.client.send(command, { abortSignal: call.signal });
      const { $metadata, ...output } = out;
      return {
        result: { ok: true, output, meta: { durationMs: took(), status: $metadata?.httpStatusCode, requestId: $metadata?.requestId, attempts: $metadata?.attempts ?? 1 } },
        epoch: entry.epoch,
      };
    } catch (e) {
      const c = classifyError(e, { sent });
      const md = (e as SdkErrorLike).$metadata;
      return {
        result: { ok: false, kind: c.kind, code: c.code, message: c.message, meta: { durationMs: took(), status: md?.httpStatusCode, requestId: md?.requestId, attempts: md?.attempts ?? 1 } },
        epoch: entry.epoch,
      };
    }
  }

  async function run(call: InvokeCall): Promise<InvokeResult> {
    const started = performance.now();
    const first = await attempt(call);
    let result = first.result;
    const epoch = first.epoch;
    // The Emulator issues new keys on every restart. When the keys were refused, fetch them again and retry once if
    // they differ from the ones this client used. Other retries are the SDK's own and follow the Connection's maxAttempts.
    if (!result.ok && result.kind === "auth" && isAuthCode(result.code) && epoch !== undefined) {
      drop(call.connectionId);
      const fresh = await fetchCredentials(call.connectionId).catch(() => undefined);
      if (fresh && fresh.epoch !== epoch) {
        const second = await attempt(call);
        result = second.result;
        result = { ...result, meta: { ...(result.meta ?? { durationMs: 0 }), durationMs: Math.round(performance.now() - started), attempts: 2 } };
      }
    }
    return result;
  }

  return {
    async invoke<I, O>(call: InvokeCall<I>): Promise<InvokeResult<O>> {
      const result = await run(call);
      try {
        opts.onResult?.(call, result);
      } catch {
        // an observer must not break the call
      }
      return result as InvokeResult<O>;
    },
    forget: drop,
    async clientFor(connectionId, serviceId) {
      return (await entryFor(connectionId, serviceId)).client;
    },
    notifyEpoch(connectionId, epoch) {
      const known = credentials.get(connectionId);
      if (!known) return;
      void known
        .then((c) => {
          if (c.epoch !== epoch) drop(connectionId);
        })
        .catch(() => undefined);
    },
  };
}
