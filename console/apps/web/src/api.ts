import { ConnectionList, ErrorBody, Health, HealthEvent, Meta, SSE_EVENTS, paths } from "@console/api-contract";

async function get<T>(url: string, schema: { parse(x: unknown): T }): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = ErrorBody.safeParse(await res.json().catch(() => undefined));
    throw new Error(err.success ? `${err.data.error.code}: ${err.data.error.message}` : `${url}: ${res.status}`);
  }
  return schema.parse(await res.json());
}

export const fetchMeta = () => get(paths.meta, Meta);
export const fetchConnections = () => get(paths.connections, ConnectionList);
export const fetchHealth = (id: string) => get(paths.health(id), Health);

/** Opens the tab's one SSE stream. `onState(true)` while connected. Returns a close function. */
export function openHealthStream(h: { onEvent: (e: HealthEvent) => void; onState: (up: boolean) => void }): () => void {
  const source = new EventSource(paths.events);
  source.onopen = () => h.onState(true);
  source.onerror = () => h.onState(false); // EventSource reconnects by itself
  source.addEventListener(SSE_EVENTS.health, (ev) => {
    try {
      const parsed = HealthEvent.safeParse(JSON.parse((ev as MessageEvent<string>).data));
      if (parsed.success) h.onEvent(parsed.data);
    } catch {
      // ignore a malformed event
    }
  });
  return () => source.close();
}
