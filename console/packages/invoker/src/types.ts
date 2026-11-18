export type CallOrigin = "user" | "view" | "discovery" | "probe";

export interface CallMeta {
  durationMs: number;
  /** HTTP status the Emulator answered, when it answered. */
  status?: number;
  requestId?: string;
  attempts?: number;
}

export type FailureKind =
  | "not-implemented"
  | "service-error"
  | "auth"
  | "network"
  | "input"
  | "unknown-service"
  | "sdk-missing";

export type InvokeResult<O = unknown> =
  | { ok: true; output: O; meta: CallMeta }
  | { ok: false; kind: FailureKind; code?: string; message: string; meta?: CallMeta };

export interface InvokeCall<I = unknown> {
  connectionId: string;
  serviceId: string;
  op: string;
  input: I;
  signal?: AbortSignal;
  origin: CallOrigin;
}

/** An AWS SDK (smithy) middleware: wraps `next`. Typed loosely so this package needs no smithy types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SmithyMiddleware = (next: (args: any) => Promise<any>) => (args: any) => Promise<any>;
export interface InvokerMiddleware {
  middleware: SmithyMiddleware;
  /** The smithy `HandlerOptions`: `step`, `name`, `priority`, `relation`... */
  options: Record<string, unknown>;
}

export interface ClientContext {
  connectionId: string;
  serviceId: string;
}
export interface CallContext extends ClientContext {
  op: string;
  origin: CallOrigin;
}

export interface OperationInvoker {
  invoke<I, O = unknown>(call: InvokeCall<I>): Promise<InvokeResult<O>>;
  /** The SDK client of a (Connection, Service), built on first use: for bespoke modules (lib-storage, presigner). */
  clientFor(connectionId: string, serviceId: string): Promise<unknown>;
  /** Tell the Invoker the Connection's credentials epoch; a change drops its cached credentials and clients. */
  notifyEpoch(connectionId: string, epoch: number): void;
}
