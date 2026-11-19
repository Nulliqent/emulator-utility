import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
export const PROJECT = "console-e2e";
export const ORIGIN = "http://127.0.0.1:19300";

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: { ...process.env, PORT: "9297", CONSOLE_WEB_SOURCE: process.env.E2E_WEB === "host" ? "prebuilt" : "build" }, // the base file's ${PORT:-9297}; a PORT in the caller's shell must not leak in
  });
}

const compose = (...args: string[]) =>
  run("docker", ["compose", "-p", PROJECT, "-f", "docker-compose.yaml", "-f", "console/e2e/compose.e2e.yaml", ...args]);

export const stopEmulator = () => compose("stop", "emulator");
export const startEmulator = () => compose("start", "emulator");
export const restartEmulator = () => compose("restart", "emulator");
export const stopConsole = () => compose("stop", "console");
export const startConsole = () => compose("start", "console");

function imageExists(tag: string): boolean {
  try {
    run("docker", ["image", "inspect", tag]);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(what: string, ok: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms;
  while (!(await ok().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`${what} did not become ready within ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function up(): Promise<void> {
  // Never rebuild or retag a developer's own `aws-emulator` image: build it only when it is absent (a fresh CI runner).
  if (!imageExists("aws-emulator")) compose("build", "emulator");
  if (process.env.E2E_WEB === "host") {
    // The SPA bundles 436 SDK clients and needs several GB to build: build it on the host and let the image copy it.
    execFileSync("pnpm", ["--filter", "@console/web", "build"], {
      cwd: path.join(repoRoot, "console"),
      stdio: "inherit",
    });
  }
  compose("build", "console"); // tagged aws-emulator-console:e2e, apart from the developer's image
  compose("up", "-d", "--no-build");
  await waitFor(
    "the console and the Emulator",
    async () => {
      const res = await fetch(`${ORIGIN}/__console/api/v1/connections/local/health`);
      return res.ok && ((await res.json()) as { reachable: boolean }).reachable;
    },
    120_000,
  );
}

export function down(): void {
  // -v removes only this project's own named volumes: e2e-home (the Emulator home) and console-data (the Gateway's /data).
  compose("down", "-v", "--remove-orphans", "--timeout", "5");
}
