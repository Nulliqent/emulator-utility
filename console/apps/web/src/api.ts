import {
  BehaviourChangedEvent,
  CONSOLE_HEADER,
  ChecksResponse,
  ConnectionList,
  ConnectionSummary,
  ErrorBody,
  Health,
  HealthEvent,
  Meta,
  SSE_EVENTS,
  paths,
  type BehaviourInput,
} from "@console/api-contract";

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
export function openHealthStream(h: {
  onEvent: (e: HealthEvent) => void;
  onState: (up: boolean) => void;
  /** Another tab saved client behaviour for this Connection. */
  onBehaviourChanged?: (e: BehaviourChangedEvent) => void;
}): () => void {
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
  source.addEventListener(SSE_EVENTS.behaviourChanged, (ev) => {
    try {
      const parsed = BehaviourChangedEvent.safeParse(JSON.parse((ev as MessageEvent<string>).data));
      if (parsed.success) h.onBehaviourChanged?.(parsed.data);
    } catch {
      // ignore a malformed event
    }
  });
  return () => source.close();
}

async function send<T>(method: string, url: string, schema: { parse(x: unknown): T }, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", [CONSOLE_HEADER]: "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = ErrorBody.safeParse(await res.json().catch(() => undefined));
    throw new Error(err.success ? err.data.error.message : `${url}: ${res.status}`);
  }
  return schema.parse(await res.json());
}

export const runChecks = (id: string) => send("POST", paths.checks(id), ChecksResponse);
export const saveBehaviour = (id: string, b: BehaviourInput) => send("PUT", paths.behaviour(id), ConnectionSummary, b);
