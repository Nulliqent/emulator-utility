import { StatusDot } from "@console/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { fetchConnections } from "../api.ts";
import { HealthPill, useHealthView } from "./HealthPill.tsx";
import { HealthProvider } from "./HealthProvider.tsx";
import { GridIcon, HomeIcon, PlugIcon, PulseIcon } from "./icons.tsx";

const NAV = [
  { to: "/", label: "Home", icon: <HomeIcon /> },
  { to: "/services", label: "All services", icon: <GridIcon /> },
  { to: "/explorer", label: "API Explorer", icon: <PulseIcon /> },
  { to: "/inspector", label: "Request inspector", icon: <PulseIcon /> },
  { to: "/connections", label: "Connections", icon: <PlugIcon /> },
] as const;

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function useActiveConnection() {
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: fetchConnections,
    // Keep looking while the Gateway fails or cannot find the Emulator home, so the alert clears once it appears.
    refetchInterval: (q) => (q.state.status === "error" || q.state.data?.items.some((c) => !c.home.found) ? 5000 : false),
  });
  const active = connections.data?.items.find((c) => c.id === connections.data?.active);
  return { active, failed: connections.isError };
}

/** Root route: loads the active Connection, then provides its health to the whole shell. */
export function Root() {
  const { active, failed } = useActiveConnection();
  return (
    <HealthProvider connectionId={active?.id} connectionsFailed={failed} homeFound={active?.home.found ?? true}>
      <Shell />
    </HealthProvider>
  );
}

function Shell() {
  const { active } = useActiveConnection();
  const view = useHealthView();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = NAV.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))?.label ?? "Emulator Console";

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-tile" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l9 5v10l-9 5-9-5V7z" />
              <path d="M12 22V12" />
              <path d="M21 7l-9 5-9-5" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">Emulator Console</span>
            <span className="brand-sub">AWS SDK v3 web client</span>
          </div>
        </div>

        <Link to="/connections" className="connection-card">
          <StatusDot tone={view.tone} label={`${view.text}.`} />
          <span className="connection-text">
            <span className="connection-name">{active?.name ?? "Local emulator"}</span>
            <span className="connection-host">{active ? hostOf(active.endpoint) : "…"}</span>
          </span>
        </Link>

        <div className="nav-list">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="nav-item" activeOptions={{ exact: n.to === "/" }}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </div>

        <div className="sidebar-footer">
          <span>
            Region <span className="footer-value">{active?.region ?? "…"}</span>
          </span>
          <span>
            Account <span className="footer-value mono">{active?.accountId ?? "…"}</span>
          </span>
        </div>
      </nav>

      <div className="main-col">
        <header className="toolbar">
          <span className="toolbar-title">{title}</span>
          <span className="toolbar-region" title="Region of the active Connection">
            {active?.region ?? "…"}
          </span>
          <HealthPill />
        </header>
        <main className="content">
          {active && !active.home.found && (
            <p className="notice" role="alert">
              Emulator home not found at <span className="mono">{active.home.path}</span>. Check CONSOLE_EMULATOR_HOME.
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
