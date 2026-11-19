import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCatalogIndex } from "../../catalog/useCatalogIndex.ts";
import { displayNames } from "./display.ts";
import { usePins } from "./pins.ts";
import { serviceTarget } from "./target.ts";

/** Pinned Services in the sidebar, in pin order. Renders nothing until something is pinned. */
export function PinnedNav() {
  const pins = usePins();
  const { index } = useCatalogIndex();
  const entries = index.data?.entries;
  const names = useMemo(() => displayNames(entries ?? []), [entries]);
  const byId = new Map((entries ?? []).map((e) => [e.serviceId, e]));
  const items = pins.map((id) => byId.get(id)).filter((e) => e !== undefined);
  if (items.length === 0) return null;
  return (
    <div className="nav-list pinned-nav" role="group" aria-labelledby="pinned-heading">
      <span id="pinned-heading" className="nav-heading">
        Pinned
      </span>
      {items.map((e) => {
        const { to, search } = serviceTarget(e);
        return (
          <Link key={e.serviceId} to={to} search={search} className="nav-item pinned-item" title={names.get(e.serviceId)?.full}>
            {names.get(e.serviceId)?.label ?? e.title}
          </Link>
        );
      })}
    </div>
  );
}
