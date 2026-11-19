import type { CatalogEntry } from "@console/api-contract";

export type Level = "full" | "partial" | "none";
export interface Coverage {
  implemented: number;
  total: number;
  level: Level;
}
/** Observed Status (#10) feeds an implemented count here; until then every caller passes none and Source Status counts. */
export interface ObservedCoverage {
  implemented: number;
}

/**
 * The one place Coverage is computed: the bar, its text, the filter and the navigation target all use it.
 * The Catalog's own `coverage.level` is ignored, so an observed count can change the level.
 */
export function coverageOf(entry: Pick<CatalogEntry, "coverage">, observed?: ObservedCoverage): Coverage {
  const total = entry.coverage.total;
  const implemented = observed?.implemented ?? entry.coverage.implemented;
  return { implemented, total, level: implemented <= 0 ? "none" : implemented >= total ? "full" : "partial" };
}

export const LEVEL_TEXT: Record<Level, string> = { full: "Fully implemented", partial: "Partly implemented", none: "Not implemented" };
