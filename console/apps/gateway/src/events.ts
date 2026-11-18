import type { ServerResponse } from "node:http";
import { SSE_EVENTS, type HealthEvent } from "@console/api-contract";

const MAX_CLIENTS = 64;

/** Fan-out of the SSE `health` event. Polls only while at least one tab is connected. */
export function createEventHub(poll: () => Promise<HealthEvent[]>, intervalMs: number) {
  const clients = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined;
  let last: HealthEvent[] = [];
  let inFlight = false;

  const send = (res: ServerResponse, events: HealthEvent[]) => {
    if (res.writableNeedDrain) return; // a slow client skips this tick instead of buffering without bound
    for (const e of events) res.write(`event: ${SSE_EVENTS.health}\ndata: ${JSON.stringify(e)}\n\n`);
  };

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const events = await poll();
      if (clients.size === 0) return; // everyone left while we were polling
      last = events;
      for (const res of clients) send(res, events);
    } catch (e) {
      console.warn(`health poll failed: ${(e as Error).message}`);
    } finally {
      inFlight = false;
    }
  }

  return {
    /** Returns false (and answers 503) when too many streams are open. */
    subscribe(res: ServerResponse): boolean {
      if (clients.size >= MAX_CLIENTS) {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "5" });
        res.end(JSON.stringify({ error: { code: "too-many-streams", message: "Too many open event streams." } }));
        return false;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 2000\n\n");
      if (last.length) send(res, last);
      clients.add(res);
      if (!timer) {
        void tick();
        timer = setInterval(() => void tick(), intervalMs);
      }
      res.on("close", () => {
        clients.delete(res);
        if (clients.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
          last = [];
        }
      });
      return true;
    },
    close() {
      if (timer) clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
