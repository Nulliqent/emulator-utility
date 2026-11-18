import { createInvoker, type InvokerOptions } from "./invoker.ts";
import { registry } from "./sdk-registry.gen.js";
import type { OperationInvoker } from "./types.ts";

export { classifyError, GATEWAY_ERROR_HEADER, isAuthCode } from "./classify.ts";
export { CONNECTION_HEADER, createInvoker } from "./invoker.ts";
export type { InvokerOptions, ModuleLoader } from "./invoker.ts";
export type {
  CallContext,
  CallMeta,
  CallOrigin,
  ClientContext,
  FailureKind,
  InvokeCall,
  InvokeResult,
  InvokerMiddleware,
  OperationInvoker,
  SmithyMiddleware,
} from "./types.ts";

/** The Invoker over the real SDK: each Service's client is a lazy chunk, loaded on first use. */
export function createSdkInvoker(opts: Omit<InvokerOptions, "load">): OperationInvoker {
  return createInvoker({ ...opts, load: (serviceId) => registry[serviceId]?.() });
}
