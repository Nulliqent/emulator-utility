import { StatusPill } from "@console/ui";
import { describeHealth } from "./health-state.ts";
import { STALE_AFTER_MS, useHealth } from "./HealthProvider.tsx";

export function useHealthView() {
  const state = useHealth();
  return describeHealth({ ...state, staleAfterMs: STALE_AFTER_MS });
}

/** Reachable plus latency, or unreachable with text. The icon shape and the words carry the state. */
export function HealthPill() {
  const { tone, text, detail } = useHealthView();
  return (
    <StatusPill tone={tone} detail={detail}>
      {text}
    </StatusPill>
  );
}
