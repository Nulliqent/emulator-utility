// Host mode: the Gateway (loopback) plus Vite's dev server, which proxies the API to the Gateway.
// Open http://127.0.0.1:5173/__console/. Override any CONSOLE_* variable in the environment.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  CONSOLE_EMULATOR_URL: "https://127.0.0.1:9297",
  CONSOLE_EMULATOR_HOME: path.resolve(root, "../.aws/emulator"),
  CONSOLE_CONFIG_DIR: path.join(root, ".dev-data"),
  CONSOLE_PUBLIC_ORIGIN: "http://127.0.0.1:9300",
  ...process.env,
};

const children = [
  spawn(process.execPath, ["apps/gateway/src/main.ts"], { cwd: root, env, stdio: "inherit" }),
  spawn("npx", ["--no-install", "vite"], { cwd: path.join(root, "apps/web"), env, stdio: "inherit" }),
];
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => { stop(); process.exit(code ?? 0); });
