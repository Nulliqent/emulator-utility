import { checkCatalog, compileCatalog, loadCatalogConfig, resolveEmulatorRoot, writeCatalog } from "./index.ts";

function run(command: string): number {
  const options = { emulatorRoot: resolveEmulatorRoot(), ...loadCatalogConfig() };
  if (command === "build") {
    const catalog = compileCatalog(options);
    for (const d of catalog.diagnostics) console.error(`${d.kind}: ${d.crate}: ${d.message}`);
    if (catalog.diagnostics.some((d) => d.kind === "error")) return 1;
    writeCatalog(catalog);
    const c = catalog.manifest.counts;
    console.log(
      `catalog built: ${c.services} services, ${c.operations} operations (${c.implemented} implemented, ${c.scaffolded} scaffolded, ${c.unrouted} unrouted), fingerprint ${catalog.manifest.fingerprint}`,
    );
    return 0;
  }
  const result = checkCatalog(options);
  if (result.ok) {
    console.log("catalog is up to date");
    return 0;
  }
  for (const p of result.problems) console.error(p);
  return 1;
}

const command = process.argv[2];
if (command !== "build" && command !== "check") {
  console.error("usage: cli.ts build | check");
  process.exit(2);
}
try {
  process.exit(run(command));
} catch (error) {
  console.error(`catalog:${command} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
