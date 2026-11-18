import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Tone = "ok" | "danger" | "warn" | "neutral";

const ICON: Record<Tone, ReactNode> = {
  ok: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  danger: <path d="M6 6l12 12M18 6L6 18" />,
  warn: <path d="M12 7v6M12 17v.5" />,
  neutral: <circle cx="12" cy="12" r="3" />,
};

/**
 * A short status label. The icon shape (check, cross, ...) plus the words carry the state, not the
 * color. Only `children` sits in the live region; `detail` (a latency, a code) is a silent sibling.
 */
export function StatusPill({ tone, children, detail }: { tone: Tone; children: ReactNode; detail?: ReactNode }) {
  return (
    <span className="ui-pill" data-tone={tone} data-testid="health-pill">
      <span role="status" className="ui-pill-words">
        <svg className="ui-status-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {ICON[tone]}
        </svg>
        {children}
      </span>
      {detail !== undefined && <span aria-hidden="true">{" "}· {detail}</span>}
    </span>
  );
}

/** Filled when ok, hollow otherwise (shape, not just color), with a visually hidden label. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <>
      <span className="ui-dot" aria-hidden="true" data-tone={tone} />
      <span className="ui-sr-only">{label}</span>
    </>
  );
}

export function Button({ variant, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" }) {
  return <button type="button" className="ui-button" data-variant={variant} {...rest} />;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}
