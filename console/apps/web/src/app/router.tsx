import { useQuery } from "@tanstack/react-query";
import { Link, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { fetchMeta } from "../api.ts";
import { useHealthView } from "./HealthPill.tsx";
import { useHealth } from "./HealthProvider.tsx";
import { ExplorerPage } from "../features/explorer/ExplorerPage.tsx";
import { Root, useActiveConnection } from "./Shell.tsx";

function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      {children}
    </>
  );
}

function Home() {
  const { active } = useActiveConnection();
  const meta = useQuery({ queryKey: ["meta"], queryFn: fetchMeta });
  const { health } = useHealth();
  const view = useHealthView();
  return (
    <Page title="Overview">
      <p className="page-sub">
        {view.tone === "ok" ? "Everything running in " : "Not running right now: "}
        <strong>{active?.name ?? "…"}</strong> · <span className="mono">{active?.endpoint ?? "…"}</span> · {active?.region ?? "…"}
        {view.tone !== "ok" && view.tone !== "neutral" ? ` · ${view.text}` : ""}
      </p>
      <section className="card" aria-label="Emulator">
        <dl className="facts">
          <dt>Endpoint for your apps</dt>
          <dd className="mono">{active?.endpoint ?? "…"}</dd>
          <dt>Endpoint the Console dials</dt>
          <dd className="mono">{active?.dialEndpoint ?? "…"}</dd>
          <dt>Last check</dt>
          <dd>{health ? new Date(health.checkedAt).toLocaleTimeString() : "…"}</dd>
          <dt>TLS</dt>
          <dd>{health ? (health.tls === "missing" ? "— (emulator not running)" : health.tls) : "…"}</dd>
          <dt>Credentials epoch</dt>
          <dd>
            {health?.credentialsEpoch ?? "…"}
            <span className="hint"> changes each time the emulator restarts and issues new keys</span>
          </dd>
          <dt>Catalog</dt>
          <dd className="mono">{meta.data ? (meta.data.catalog.fingerprint?.slice(0, 12) ?? "not available") : "…"}</dd>
        </dl>
      </section>
    </Page>
  );
}

const soon = (title: string) => () => (
  <Page title={title}>
    <p className="page-sub">This screen arrives in a later ticket.</p>
  </Page>
);

function NotFound() {
  return (
    <Page title="Page not found">
      <p className="page-sub">
        There is nothing at this address. <Link to="/">Back to Home</Link>
      </p>
    </Page>
  );
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: NotFound });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/explorer",
    component: ExplorerPage,
    // Deep links: /explorer?service=sqs&op=ListQueues
    validateSearch: (s: Record<string, unknown>): { service?: string; op?: string } => ({
      ...(typeof s.service === "string" ? { service: s.service } : {}),
      ...(typeof s.op === "string" ? { op: s.op } : {}),
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/services", component: soon("All services") }),
  createRoute({ getParentRoute: () => rootRoute, path: "/inspector", component: soon("Request inspector") }),
  createRoute({ getParentRoute: () => rootRoute, path: "/connections", component: soon("Connections") }),
]);

export const router = createRouter({ routeTree, basepath: "/__console", defaultNotFoundComponent: NotFound });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
