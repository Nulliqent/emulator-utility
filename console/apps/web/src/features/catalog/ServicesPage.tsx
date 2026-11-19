import { useNavigate, useSearch } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { coverageOf, LEVEL_TEXT } from "../../catalog/coverage.ts";
import { useCatalogIndex } from "../../catalog/useCatalogIndex.ts";
import { displayNames } from "./display.ts";
import { facetCounts, filterEntries, sortByName, type Filters } from "./filter.ts";
import { usePins } from "./pins.ts";
import { parseServicesSearch, type ServicesSearch } from "./search-params.ts";
import { ServiceItem } from "./ServiceItem.tsx";

const withCount = (label: string, n: number | undefined) => `${label} (${n ?? 0})`;

export function ServicesPage() {
  const { index, metaError, noCatalog } = useCatalogIndex();
  const pins = usePins();
  const navigate = useNavigate();
  const search = parseServicesSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const view = search.view ?? "pill";
  const ids = { q: useId(), cat: useId(), tier: useId(), level: useId() };
  const results = useRef<HTMLElement>(null);

  // `latest` is the search we last asked for. A delayed update (the typed query) must build on it, not on the
  // URL as it was when typing started, or it would undo a filter picked in between.
  const latest = useRef<ServicesSearch>(search);
  const urlKey = JSON.stringify(search);
  useEffect(() => {
    latest.current = JSON.parse(urlKey) as ServicesSearch;
  }, [urlKey]);
  const update = (patch: Partial<Record<keyof ServicesSearch, string>>) => {
    latest.current = parseServicesSearch({ ...latest.current, ...patch });
    void navigate({ to: "/services", search: latest.current, replace: true });
  };

  // The input is local so typing never waits on the router; the URL follows after a short pause.
  const [text, setText] = useState(search.q ?? "");
  const textRef = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if ((search.q ?? "") !== textRef.current) {
      textRef.current = search.q ?? "";
      setText(textRef.current);
    }
  }, [search.q]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onQuery = (v: string) => {
    textRef.current = v;
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ q: v }), 200);
  };
  const deferredText = useDeferredValue(text);

  const { category, tier, level } = search;
  const filters = useMemo<Filters>(() => ({ query: deferredText, category: category ?? "", tier: tier ?? "", level: level ?? "" }), [deferredText, category, tier, level]);
  const entries = useMemo(() => index.data?.entries ?? [], [index.data]);
  const names = useMemo(() => displayNames(entries), [entries]);
  const sorted = useMemo(() => sortByName(entries, names), [entries, names]);
  const categories = useMemo(() => index.data?.categories ?? [], [index.data]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const shown = useMemo(() => filterEntries(sorted, filters, names), [sorted, filters, names]);
  const counts = useMemo(() => facetCounts(sorted, filters, names), [sorted, filters, names]);
  const coverages = useMemo(() => new Map(entries.map((e) => [e.serviceId, coverageOf(e)])), [entries]);
  const pinned = useMemo(() => new Set(pins), [pins]);
  const customTotal = useMemo(() => entries.filter((e) => e.tier === "custom").length, [entries]);

  const active = Boolean(text || search.category || search.tier || search.level);
  const clear = () => {
    clearTimeout(timer.current);
    textRef.current = "";
    setText("");
    latest.current = parseServicesSearch({ view: search.view });
    void navigate({ to: "/services", search: latest.current, replace: true });
  };

  const groups = useMemo(() => {
    if (view !== "pill" || deferredText.trim()) return null; // a ranked search is one list, not grouped
    const by = new Map<string, typeof shown>();
    for (const e of shown) by.set(e.category, [...(by.get(e.category) ?? []), e]);
    return categories.filter((c) => by.has(c.id)).map((c) => ({ id: c.id, name: c.name, items: by.get(c.id)! }));
  }, [view, deferredText, shown, categories]);

  const item = (e: (typeof shown)[number]) => (
    <ServiceItem key={e.serviceId} entry={e} name={names.get(e.serviceId)!} coverage={coverages.get(e.serviceId)!} pinned={pinned.has(e.serviceId)} view={view} category={categoryName.get(e.category) ?? e.category} />
  );

  return (
    <>
      <h1 className="page-title">All services</h1>
      <p className="page-sub">Every Service in the Catalog, with how much of it the Emulator implements.</p>
      <a
        className="skip-link"
        href="#results"
        onClick={(ev) => {
          ev.preventDefault();
          results.current?.focus();
        }}
      >
        Skip to results
      </a>

      <div className="catalog-filters">
        <div className="field catalog-search">
          <label htmlFor={ids.q}>Search services</label>
          <input id={ids.q} className="ui-input" type="search" placeholder="Name or SDK package" value={text} onChange={(e) => onQuery(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.cat}>Category</label>
          <select id={ids.cat} className="ui-input" value={search.category ?? ""} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {withCount(c.name, counts.category.get(c.id))}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.tier}>Custom UI</label>
          <select id={ids.tier} className="ui-input" value={search.tier ?? ""} onChange={(e) => update({ tier: e.target.value })}>
            <option value="">All</option>
            <option value="custom">{withCount("Custom UI", counts.tier.get("custom"))}</option>
            <option value="generated">{withCount("Generated", counts.tier.get("generated"))}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.level}>Coverage</label>
          <select id={ids.level} className="ui-input" value={search.level ?? ""} onChange={(e) => update({ level: e.target.value })}>
            <option value="">All</option>
            {(["full", "partial", "none"] as const).map((l) => (
              <option key={l} value={l}>
                {withCount(LEVEL_TEXT[l], counts.level.get(l))}
              </option>
            ))}
          </select>
        </div>
        <div className="view-toggle" role="group" aria-label="View">
          {(["pill", "card"] as const).map((v) => (
            <button key={v} type="button" className="view-button" aria-pressed={view === v} onClick={() => update({ view: v === "pill" ? "" : v })}>
              {v === "pill" ? "Pill view" : "Card view"}
            </button>
          ))}
        </div>
        {active && (
          <button type="button" className="ui-button" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      {(metaError || index.isError || noCatalog) && (
        <p className="notice" role="alert">
          {noCatalog ? "The Gateway has no Catalog loaded." : "The Catalog could not be loaded. Check that the Gateway is running, then reload."}
        </p>
      )}
      {index.isPending && !metaError && !noCatalog && <p className="page-sub">Loading the Catalog…</p>}
      {index.data && (
        <div className="catalog-layout">
          <nav className="cat-rail" aria-label="Categories">
            <button type="button" className="cat-item" aria-current={!search.category} onClick={() => update({ category: "" })}>
              <span>All categories</span>
              <span className="cat-count">{[...counts.category.values()].reduce((a, b) => a + b, 0)}</span>
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" className="cat-item" aria-current={search.category === c.id} onClick={() => update({ category: c.id })}>
                <span>{c.name}</span>
                <span className="cat-count">{counts.category.get(c.id) ?? 0}</span>
              </button>
            ))}
          </nav>

          <section id="results" ref={results} tabIndex={-1} className="catalog-results" aria-label="Results">
            <p className="page-sub" data-testid="result-count" aria-live="polite">
              {shown.length} of {entries.length} services
            </p>
            {shown.length === 0 && (
              <div className="empty-state">
                <p>No Service matches these filters.</p>
                <button type="button" className="ui-button" onClick={clear}>
                  Clear filters and search
                </button>
              </div>
            )}
            {groups ? (
              groups.map((g) => (
                <section key={g.id} className="cat-group" aria-labelledby={`cat-${g.id}`}>
                  <h2 id={`cat-${g.id}`} className="cat-heading">
                    {g.name} <span className="cat-count">{g.items.length}</span>
                  </h2>
                  <ul className="service-list service-list-pill">{g.items.map(item)}</ul>
                </section>
              ))
            ) : (
              <ul className={`service-list service-list-${view}`} aria-label="Services">
                {shown.map(item)}
              </ul>
            )}
          </section>

          <aside className="tier-note" aria-label="About Custom UI and Generated">
            <h2 className="tier-note-title">How screens are built</h2>
            <p>
              <span className="tier-badge" data-tier="custom">
                Custom UI
              </span>{" "}
              {customTotal} Services have screens designed by hand.
            </p>
            <p>
              <span className="tier-badge" data-tier="generated">
                Generated
              </span>{" "}
              The other {entries.length - customTotal} get screens built from their Catalog model.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
