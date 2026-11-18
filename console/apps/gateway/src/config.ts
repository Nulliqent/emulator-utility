import path from "node:path";

export interface GatewayConfig {
  port: number;
  host: string;
  /** Where the Gateway dials the Emulator, for example https://emulator:9297 */
  emulatorUrl: URL;
  /** Folder holding `<port>/{config,ca.pem,emulator_credentials}` (mounted read-only). */
  emulatorHome: string;
  configDir: string;
  /** The origin browsers use to reach the Gateway, for example http://127.0.0.1:9300 */
  publicOrigin: URL;
  webDir: string;
  catalogManifest: string;
  gatewayVersion: string;
  healthIntervalMs: number;
  healthTimeoutMs: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = Number(env.CONSOLE_PORT ?? 9300);
  const host = env.CONSOLE_HOST ?? "127.0.0.1";
  // The Gateway holds the Emulator Credentials' reach and the Host check is not a network
  // boundary, so a non-loopback bind must be asked for explicitly (the container image does).
  if (!LOOPBACK.has(host) && env.CONSOLE_ALLOW_REMOTE_BIND !== "1") {
    throw new Error(`Refusing to bind ${host}: set CONSOLE_ALLOW_REMOTE_BIND=1 to listen beyond loopback.`);
  }
  const root = path.resolve(import.meta.dirname, "../../..");
  return {
    port,
    host,
    emulatorUrl: new URL(env.CONSOLE_EMULATOR_URL ?? "https://127.0.0.1:9297"),
    emulatorHome: env.CONSOLE_EMULATOR_HOME ?? "/emulator-home",
    configDir: env.CONSOLE_CONFIG_DIR ?? "/data",
    publicOrigin: new URL(env.CONSOLE_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`),
    webDir: path.resolve(env.CONSOLE_WEB_DIR ?? path.join(root, "apps/web/dist")),
    catalogManifest: env.CONSOLE_CATALOG_MANIFEST ?? path.join(root, "dist/catalog/manifest.json"),
    gatewayVersion: env.CONSOLE_VERSION ?? "0.1.0",
    healthIntervalMs: Number(env.CONSOLE_HEALTH_INTERVAL_MS ?? 2000),
    healthTimeoutMs: Number(env.CONSOLE_HEALTH_TIMEOUT_MS ?? 1500),
  };
}
