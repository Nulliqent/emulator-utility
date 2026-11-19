import type { CatalogEntry } from "@console/api-contract";
import { coverageOf, type Level, type ObservedCoverage } from "../../catalog/coverage.ts";
import type { DisplayName } from "./display.ts";

export interface Filters {
  query: string;
  category: string;
  tier: "" | "custom" | "generated";
  level: "" | Level;
}

type Names = Map<string, DisplayName>;
type Observe = (e: CatalogEntry) => ObservedCoverage | undefined;

/** Sorts by display name. Do it once per Catalog load: `filterEntries` keeps this order. */
export const sortByName = (entries: CatalogEntry[], names?: Names): CatalogEntry[] => {
  const key = (e: CatalogEntry) => names?.get(e.serviceId)?.label ?? e.title;
  return [...entries].sort((a, b) => key(a).localeCompare(key(b)));
};

/** 0 exact on an identifier or name, 1 a prefix of one, 2 contained anywhere (title, SDK package), -1 no match. */
function rank(e: CatalogEntry, q: string, name: DisplayName | undefined): number {
  const ids = [e.serviceId, e.sdkId, e.signingName, name?.short ?? "", e.title].map((v) => v.toLowerCase());
  if (ids.some((v) => v === q)) return 0;
  if (ids.some((v) => v.startsWith(q))) return 1;
  if (ids.some((v) => v.includes(q)) || e.sdkPackage.toLowerCase().includes(q)) return 2;
  return -1;
}

function matches(e: CatalogEntry, f: Filters, skip: "category" | "tier" | "level" | null, observe?: Observe): boolean {
  return (
    (skip === "category" || !f.category || e.category === f.category) &&
    (skip === "tier" || !f.tier || e.tier === f.tier) &&
    (skip === "level" || !f.level || coverageOf(e, observe?.(e)).level === f.level)
  );
}

/**
 * Filters `entries` (already sorted by name). With a query the result is ranked: exact identifier or name
 * matches first, then prefix matches, then the rest; ties keep the by-name order.
 */
export function filterEntries(entries: CatalogEntry[], f: Filters, names?: Names, observe?: Observe): CatalogEntry[] {
  const q = f.query.trim().toLowerCase();
  const kept = entries.filter((e) => matches(e, f, null, observe));
  if (!q) return kept;
  const ranked: [number, CatalogEntry][] = [];
  for (const e of kept) {
    const r = rank(e, q, names?.get(e.serviceId));
    if (r >= 0) ranked.push([r, e]);
  }
  return ranked.sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}

export interface FacetCounts {
  category: Map<string, number>;
  tier: Map<string, number>;
  level: Map<string, number>;
}

/** How many Services each option of each filter would show, with every other filter (and the query) applied. */
export function facetCounts(entries: CatalogEntry[], f: Filters, names?: Names, observe?: Observe): FacetCounts {
  const out: FacetCounts = { category: new Map(), tier: new Map(), level: new Map() };
  const q = f.query.trim().toLowerCase();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of entries) {
    if (q && rank(e, q, names?.get(e.serviceId)) < 0) continue;
    const level = coverageOf(e, observe?.(e)).level;
    if (matches(e, f, "category", observe)) bump(out.category, e.category);
    if (matches(e, f, "tier", observe)) bump(out.tier, e.tier);
    if (matches(e, f, "level", observe)) bump(out.level, level);
  }
  return out;
}
