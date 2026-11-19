import { CATALOG_BASE } from "@console/api-contract";
import type { OperationStatus, Protocol, UiShape } from "@console/model";

/** The slice of a Catalog Entry the explorer reads. */
export interface CatalogEntry {
  serviceId: string;
  title: string;
  sdkId: string;
  category: string;
  protocol: Protocol;
  files: { ui: string; docs: string };
}

export interface CatalogIndex {
  categories: { id: string; name: string }[];
  entries: CatalogEntry[];
}

export interface ServiceOps {
  operations: Record<string, { name: string; kind: "read" | "write"; status: OperationStatus; group: string; input?: string }>;
  shapes: Record<string, UiShape>;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) throw new Error(`${what} was not found (404). The Catalog on the Gateway may be a different build; reload the page.`);
  if (!res.ok) throw new Error(`${what} could not be loaded (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

// Content-addressed URLs (the fingerprint, then a hashed file name), so the browser caches them for good.
export const fetchCatalogIndex = (fingerprint: string) => getJson<CatalogIndex>(`${CATALOG_BASE}/${fingerprint}/index.json`, "The Catalog index");

export const fetchServiceOps = (fingerprint: string, entry: CatalogEntry) =>
  getJson<ServiceOps>(`${CATALOG_BASE}/${fingerprint}/${entry.files.ui}`, `The ${entry.title} model`);

export interface ServiceDocs {
  shapes: Record<string, { doc?: string; members?: Record<string, string> }>;
}

export const fetchServiceDocs = (fingerprint: string, entry: CatalogEntry) =>
  getJson<ServiceDocs>(`${CATALOG_BASE}/${fingerprint}/${entry.files.docs}`, `The ${entry.title} documentation`);
