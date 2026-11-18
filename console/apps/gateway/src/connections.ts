import { existsSync, mkdirSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ConnectionSummary } from "@console/api-contract";
import type { GatewayConfig } from "./config.ts";

/** Gateway-internal view of a Connection. Credentials are referenced by path, never read here. */
export interface Connection extends ConnectionSummary {
  dialUrl: URL;
  caFile: string;
  credentialsFile: string;
}

const LOCAL_ID = "local";
const ACCOUNT_ID = "000000000000"; // always this account for this Emulator

/** Top-level `key = value` lines of the `[default]` profile; indented continuation lines are skipped. */
export function parseDefaultProfile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inDefault = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) inDefault = line === "[default]";
    else if (inDefault && !/^\s/.test(raw) && line.includes("=")) {
      const i = line.indexOf("=");
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Discovers the Local Connection from the mounted Emulator home. Safe to call per request. */
export function discoverLocal(cfg: GatewayConfig): Connection {
  const port = cfg.emulatorUrl.port || "9297";
  const dir = path.join(cfg.emulatorHome, port);
  const profile = parseDefaultProfile(readIfPresent(path.join(dir, "config")) ?? "");
  return {
    id: LOCAL_ID,
    name: "Local emulator",
    endpoint: profile.endpoint_url ?? `https://127.0.0.1:${port}`,
    dialEndpoint: cfg.emulatorUrl.origin,
    region: profile.region ?? "us-east-1",
    accountId: ACCOUNT_ID,
    home: { path: dir, found: existsSync(dir) }, // the folder actually checked: <home>/<port>
    dialUrl: cfg.emulatorUrl,
    caFile: path.join(dir, "ca.pem"),
    credentialsFile: path.join(dir, "emulator_credentials"),
  };
}

export function toSummary(c: Connection): ConnectionSummary {
  return {
    id: c.id,
    name: c.name,
    endpoint: c.endpoint,
    dialEndpoint: c.dialEndpoint,
    region: c.region,
    accountId: c.accountId,
    home: c.home,
  };
}

/** Persists the Connection list (summaries only, no secrets) to `$CONSOLE_CONFIG_DIR/connections.json`. */
export function createRegistry(cfg: GatewayConfig) {
  const file = path.join(cfg.configDir, "connections.json");
  let lastWritten = "";
  function list(): { active: string; items: Connection[] } {
    const local = discoverLocal(cfg);
    const body = JSON.stringify({ active: local.id, items: [toSummary(local)] }, null, 2) + "\n";
    if (body !== lastWritten) {
      lastWritten = body; // warn at most once per change
      try {
        mkdirSync(cfg.configDir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, body, { mode: 0o600 });
        renameSync(tmp, file); // atomic: readers never see a half-written file
      } catch (e) {
        console.warn(`could not write ${file}: ${(e as Error).message}`);
      }
    }
    return { active: local.id, items: [local] };
  }
  return { list, get: (id: string) => list().items.find((c) => c.id === id) };
}

/** A cheap fingerprint of the credentials file that changes when the Emulator rotates it. */
export function credentialsStamp(file: string): string {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
}
