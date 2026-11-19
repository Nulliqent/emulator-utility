import type { CatalogEntry } from "@console/api-contract";
import { coverageOf, type ObservedCoverage } from "../../catalog/coverage.ts";

export interface ServiceTarget {
  to: "/explorer";
  search: { service: string; op?: string };
  /** Shown beside the link when there is something to say about where it goes. */
  note?: string;
}

/**
 * Where opening a Service from the catalog goes. The one place to change when the Generated View (#15) exists:
 * a Service at Coverage None keeps going to the API Explorer, because it has no screens worth generating.
 */
export function serviceTarget(entry: CatalogEntry, observed?: ObservedCoverage): ServiceTarget {
  if (coverageOf(entry, observed).level === "none") return { to: "/explorer", search: { service: entry.serviceId }, note: "Not implemented yet" };
  // For now every other Service opens the explorer too, on its probe Operation when it has one.
  return { to: "/explorer", search: { service: entry.serviceId, ...(entry.probeOp ? { op: entry.probeOp } : {}) } };
}
