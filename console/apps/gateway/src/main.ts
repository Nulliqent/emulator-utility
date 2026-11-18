import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const cfg = loadConfig();
const { server, registry } = createServer(cfg);

const local = registry.list().items[0];
if (local && !local.home.found) {
  console.warn(
    `Emulator home not found at ${cfg.emulatorHome}/${cfg.emulatorUrl.port || "9297"}. ` +
      "Check CONSOLE_EMULATOR_HOME; the Emulator will show as unreachable until it appears.",
  );
}

server.listen(cfg.port, cfg.host, () => {
  console.log(`console gateway on ${cfg.host}:${cfg.port} (public origin ${cfg.publicOrigin.origin}) -> ${cfg.emulatorUrl.origin}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections(); // open SSE streams would otherwise hold the process
  });
}
