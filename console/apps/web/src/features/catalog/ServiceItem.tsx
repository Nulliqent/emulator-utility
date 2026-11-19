import type { CatalogEntry } from "@console/api-contract";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { LEVEL_TEXT, type Coverage } from "../../catalog/coverage.ts";
import type { DisplayName } from "./display.ts";
import { togglePin } from "./pins.ts";
import { serviceTarget } from "./target.ts";

const coverageSentence = (c: Coverage) => `${c.implemented} of ${c.total} implemented`;

/** Coverage Level as a shape (full, half, empty circle), so it never depends on color. */
function LevelGlyph({ level }: { level: Coverage["level"] }) {
  return (
    <svg className="level-glyph" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {level === "full" && <circle cx="6" cy="6" r="3" fill="currentColor" />}
      {level === "partial" && <path d="M6 3a3 3 0 0 1 0 6z" fill="currentColor" />}
    </svg>
  );
}

/** Implemented out of total: a bar and the words, never the bar alone. */
export function CoverageBar({ coverage }: { coverage: Coverage }) {
  return (
    <span className="coverage" data-testid="coverage">
      <progress className="coverage-bar" aria-hidden="true" max={Math.max(coverage.total, 1)} value={coverage.implemented} />
      <span className="coverage-text">
        {coverageSentence(coverage)}
        <span className="coverage-level"> · {LEVEL_TEXT[coverage.level]}</span>
      </span>
    </span>
  );
}

/** The compact form for a chip: the count and a level shape on screen, the full sentence for a screen reader. */
function CoverageChip({ coverage }: { coverage: Coverage }) {
  return (
    <span className="coverage-chip" data-testid="coverage">
      <span aria-hidden="true">
        <LevelGlyph level={coverage.level} /> {coverage.implemented}/{coverage.total}
      </span>
      <span className="ui-sr-only">
        {coverageSentence(coverage)} · {LEVEL_TEXT[coverage.level]}
      </span>
    </span>
  );
}

function StarIcon() {
  return (
    <svg className="tier-star" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
    </svg>
  );
}

/** A pushpin, deliberately unlike the star that marks Custom UI. */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
      <path d="M12 14v7" />
    </svg>
  );
}

function PinButton({ entry, label, pinned }: { entry: CatalogEntry; label: string; pinned: boolean }) {
  return (
    <button type="button" className="pin-button" aria-label={`Pin ${label}`} aria-pressed={pinned} onClick={() => togglePin(entry.serviceId)}>
      <PinIcon pinned={pinned} />
    </button>
  );
}

interface Props {
  entry: CatalogEntry;
  name: DisplayName;
  coverage: Coverage;
  pinned: boolean;
  view: "pill" | "card";
  category: string;
}

export const ServiceItem = memo(function ServiceItem({ entry, name, coverage, pinned, view, category }: Props) {
  const { note, ...link } = serviceTarget(entry, { implemented: coverage.implemented });
  const custom = entry.tier === "custom";
  if (view === "pill") {
    return (
      <li className="chip" data-testid={`service-${entry.serviceId}`}>
        {custom && (
          <span className="chip-star" title="Custom UI">
            <StarIcon />
            <span className="ui-sr-only">Custom UI</span>
          </span>
        )}
        <Link {...link} className="service-link" title={name.full}>
          {name.label}
        </Link>
        <CoverageChip coverage={coverage} />
        <PinButton entry={entry} label={name.label} pinned={pinned} />
      </li>
    );
  }
  return (
    <li className="service-card" data-testid={`service-${entry.serviceId}`}>
      <div className="service-head">
        <span className="service-name">{name.label}</span>
        <span className="tier-badge" data-tier={entry.tier}>
          {custom && <StarIcon />}
          {custom ? "Custom UI" : "Generated"}
        </span>
      </div>
      <p className="service-meta">{name.full}</p>
      <p className="service-meta">
        {category} · <span className="mono">{entry.sdkPackage}</span>
      </p>
      <CoverageBar coverage={coverage} />
      <div className="service-foot">
        <Link {...link} className="open-link" aria-label={`Open ${name.label}`}>
          Open
        </Link>
        {note && <span className="service-note">{note}</span>}
        <PinButton entry={entry} label={name.label} pinned={pinned} />
      </div>
    </li>
  );
});
