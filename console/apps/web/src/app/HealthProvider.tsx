import type { Health } from "@console/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchHealth, openHealthStream } from "../api.ts";

// Fallback poll 5 s + probe timeout ~1.5 s + slack: data older than this means the Gateway went quiet.
export const STALE_AFTER_MS = 10_000;
export const healthKey = (id: string | undefined) => ["health", id];

/** Health plus the browser-clock time it arrived, so staleness never depends on the Gateway's clock. */
interface Stamped {
  health: Health;
  receivedAt: number;
}

interface HealthState {
  health: Health | undefined;
  receivedAt: number | undefined;
  gatewayDown: boolean;
  homeFound: boolean;
  now: number;
}
const Ctx = createContext<HealthState>({ health: undefined, receivedAt: undefined, gatewayDown: false, homeFound: true, now: 0 });

/**
 * One SSE stream per tab. It writes `health` events into the query cache; `/health` is fetched only
 * to seed the first value and while the stream is down. Everything below only reads.
 */
export function HealthProvider({
  connectionId,
  connectionsFailed,
  homeFound,
  children,
}: {
  connectionId: string | undefined;
  connectionsFailed: boolean;
  homeFound: boolean;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [streamUp, setStreamUp] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectionId === undefined) return;
    return openHealthStream({
      onEvent: (e) => {
        if (e.connectionId === connectionId) {
          queryClient.setQueryData<Stamped>(healthKey(connectionId), { health: e.health, receivedAt: Date.now() });
        }
      },
      onState: setStreamUp,
    });
  }, [connectionId, queryClient]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000); // lets stale data show as such
    return () => clearInterval(t);
  }, []);

  const query = useQuery({
    queryKey: healthKey(connectionId),
    queryFn: async (): Promise<Stamped> => ({ health: await fetchHealth(connectionId!), receivedAt: Date.now() }),
    enabled: connectionId !== undefined,
    refetchInterval: streamUp ? false : 5000,
  });

  // A fresh stream event clears a past fetch error (setQueryData), so errors only count while the stream is down.
  const gatewayDown = connectionsFailed || (query.isError && !streamUp);
  return (
    <Ctx.Provider value={{ health: query.data?.health, receivedAt: query.data?.receivedAt, gatewayDown, homeFound, now }}>
      {children}
    </Ctx.Provider>
  );
}

export const useHealth = () => useContext(Ctx);
