import type { Health } from "@console/api-contract";

export type Tone = "ok" | "danger" | "warn" | "neutral";
export interface HealthView {
  tone: Tone;
  /** The state in words: announced by screen readers. */
  text: string;
  /** Extra detail (latency, status code, a hint) shown beside the words, not announced. */
  detail?: string;
}

export interface HealthInput {
  health: Health | undefined;
  /** The Gateway does not answer: its request failed or its event stream is down. */
  gatewayDown: boolean;
  /** Browser clock now, and when the browser received `health` (never the Gateway's `checkedAt`). */
  now: number;
  receivedAt: number | undefined;
  /** Data received longer ago than this is treated as the Gateway having gone quiet. */
  staleAfterMs: number;
  /** False when the Gateway cannot find the Emulator home. */
  homeFound?: boolean;
}

export function describeHealth({ health, gatewayDown, now, receivedAt, staleAfterMs, homeFound = true }: HealthInput): HealthView {
  if (gatewayDown) return { tone: "danger", text: "Gateway unreachable" };
  if (!health) return { tone: "neutral", text: "Checking emulator…" };
  if (receivedAt === undefined || now - receivedAt > staleAfterMs) return { tone: "danger", text: "Gateway unreachable" };
  if (health.reachable) return { tone: "ok", text: "Emulator healthy", detail: `${health.latencyMs ?? 0} ms` };
  if (health.status !== null) return { tone: "danger", text: "Emulator unhealthy", detail: String(health.status) };
  const hint =
    health.tls === "untrusted"
      ? "certificate not trusted"
      : health.tls === "missing"
        ? homeFound
          ? "not running?"
          : "check CONSOLE_EMULATOR_HOME"
        : undefined;
  return { tone: "danger", text: "Emulator unreachable", detail: hint };
}
