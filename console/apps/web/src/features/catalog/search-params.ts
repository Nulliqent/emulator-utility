/** The All services page keeps its query, filters and view in the URL, so reload, Back and a shared link restore them. */
export interface ServicesSearch {
  q?: string;
  category?: string;
  tier?: "custom" | "generated";
  level?: "full" | "partial" | "none";
  view?: "pill" | "card";
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => allowed.find((a) => a === v);

export function parseServicesSearch(s: Record<string, unknown>): ServicesSearch {
  const q = typeof s.q === "string" && s.q !== "" ? s.q : undefined;
  const category = typeof s.category === "string" && s.category !== "" ? s.category : undefined;
  const tier = oneOf(s.tier, ["custom", "generated"] as const);
  const level = oneOf(s.level, ["full", "partial", "none"] as const);
  const view = oneOf(s.view, ["pill", "card"] as const);
  return { ...(q ? { q } : {}), ...(category ? { category } : {}), ...(tier ? { tier } : {}), ...(level ? { level } : {}), ...(view ? { view } : {}) };
}
