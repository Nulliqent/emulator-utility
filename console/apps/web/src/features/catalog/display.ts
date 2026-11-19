import type { CatalogEntry } from "@console/api-contract";
import shortNames from "../../catalog/short-names.json";

export interface DisplayName {
  /** The primary label: the design's short name, else the title without a leading "Amazon "/"AWS ". */
  label: string;
  /** The full Catalog title. */
  full: string;
  /** The short name on its own, for search. */
  short: string;
}

const strip = (title: string) => title.replace(/^(Amazon|AWS) /, "");

/** `overrides` is `src/catalog/short-names.json`: the design's short names, keyed by serviceId. */
export function displayNames(entries: CatalogEntry[], overrides: Record<string, string> = shortNames): Map<string, DisplayName> {
  const base = entries.map((e) => ({ e, short: overrides[e.serviceId] ?? strip(e.title) }));
  const seen = new Map<string, number>();
  for (const { short } of base) seen.set(short, (seen.get(short) ?? 0) + 1);
  return new Map(
    base.map(({ e, short }) => [e.serviceId, { label: (seen.get(short) ?? 0) > 1 ? `${short} (${e.serviceId})` : short, full: e.title, short }]),
  );
}
