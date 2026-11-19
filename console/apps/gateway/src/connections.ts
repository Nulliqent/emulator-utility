import { existsSync, mkdirSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BehaviourInput, DEFAULT_BEHAVIOUR, type ConnectionSummary } from "@console/api-contract";
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
export function discoverLocal(cfg: GatewayConfig, behaviour: BehaviourInput = DEFAULT_BEHAVIOUR): Connection {
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
    behaviour: { s3PathStyle: true, ...behaviour },
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
    behaviour: c.behaviour,
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Persists the Connection list (summaries only, no secrets) to `$CONSOLE_CONFIG_DIR/connections.json`. */
export function createRegistry(cfg: GatewayConfig) {
  const file = path.join(cfg.configDir, "connections.json");
  let lastWritten = "";
  let lastWarned = "";
  /** The parsed file, read once; a successful write replaces it. */
  let cached: Json | undefined;

  /** The file as it is on disk, or an empty object. Keys this code does not know are kept when it writes. */
  function readStore(): Json {
    if (cached) return cached;
    let text: string | undefined;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return (cached = {}); // not there yet
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (isObject(parsed)) return (cached = parsed);
    } catch {
      // fall through to the backup
    }
    // Do not silently overwrite a file somebody may have meant: keep a copy first.
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      writeFileSync(backup, text, { mode: 0o600 });
      console.warn(`${file} is corrupt; kept a copy at ${backup} and started from the defaults`);
    } catch (e) {
      console.warn(`${file} is corrupt and could not be backed up: ${(e as Error).message}`);
    }
    return (cached = {});
  }
  function storedBehaviour(id: string): BehaviourInput {
    const items = readStore().items;
    const item = Array.isArray(items) ? items.find((i) => isObject(i) && i.id === id) : undefined;
    const parsed = BehaviourInput.safeParse(isObject(item) && isObject(item.behaviour) ? { maxAttempts: item.behaviour.maxAttempts, timeoutMs: item.behaviour.timeoutMs } : undefined);
    return parsed.success ? parsed.data : DEFAULT_BEHAVIOUR; // a hand-edited or out-of-bounds value falls back
  }

  /**
   * Writes the list into the existing file: other top-level keys and other fields of each item stay. Returns an
   * error message when the write failed; the in-memory copy and `lastWritten` only move after a good write.
   */
  function persist(connections: Connection[], active: string): string | undefined {
    const store = readStore();
    const old = Array.isArray(store.items) ? store.items.filter(isObject) : [];
    const items = connections.map((c) => ({ ...old.find((o) => o.id === c.id), ...toSummary(c) }));
    const next = { ...store, active, items };
    const body = JSON.stringify(next, null, 2) + "\n";
    if (body === lastWritten) return undefined;
    try {
      mkdirSync(cfg.configDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, body, { mode: 0o600 });
      renameSync(tmp, file); // atomic: readers never see a half-written file
    } catch (e) {
      const message = `could not write ${file}: ${(e as Error).message}`;
      if (body !== lastWarned) console.warn(message); // warn once per change, not once per request
      lastWarned = body;
      return message;
    }
    lastWritten = body;
    cached = next;
    return undefined;
  }

  function list(): { active: string; items: Connection[] } {
    const local = discoverLocal(cfg, storedBehaviour(LOCAL_ID));
    persist([local], local.id);
    return { active: local.id, items: [local] };
  }
  return {
    list,
    get: (id: string) => list().items.find((c) => c.id === id),
    /**
     * Saves the client behaviour of a Connection (already validated) and returns the updated Connection.
     * Throws when the file cannot be written, so the caller never reports a save that did not happen.
     */
    setBehaviour(id: string, behaviour: BehaviourInput): Connection | undefined {
      if (id !== LOCAL_ID) return undefined;
      const local = discoverLocal(cfg, behaviour);
      const failure = persist([local], local.id);
      if (failure) throw new Error(failure);
      return local;
    },
  };
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
