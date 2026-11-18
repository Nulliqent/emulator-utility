import { createSdkInvoker } from "@console/invoker";
import { fetchConnections } from "../../api.ts";

let shared: ReturnType<typeof createSdkInvoker> | undefined;

/** The tab's one Operation Invoker: clients are built per (Connection, Service), on first use. */
export function getInvoker() {
  shared ??= createSdkInvoker({
    origin: window.location.origin,
    regionOf: async (id) => (await fetchConnections()).items.find((c) => c.id === id)?.region ?? "us-east-1",
    timeoutMs: 30_000,
  });
  return shared;
}
