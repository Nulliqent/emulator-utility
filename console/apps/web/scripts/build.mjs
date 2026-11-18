// `vite build` with the Node heap the 436 lazy SDK chunks need (spike P0.3), on any OS, then a stamp: when the
// compiled Catalog manifest is beside the repo (host builds), dist/catalog-fingerprint.txt records which Catalog this
// build was made for, and the Docker "prebuilt" stage refuses a dist built for another one.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = path.join(path.dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
const heap = "--max-old-space-size=12288";
const options = process.env.NODE_OPTIONS ?? "";
const env = { ...process.env, NODE_OPTIONS: options.includes("--max-old-space-size") ? options : `${options} ${heap}`.trim() };

const r = spawnSync(process.execPath, [vite, "build"], { cwd: webDir, env, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);

const manifest = path.resolve(webDir, "../../dist/catalog/manifest.json");
if (existsSync(manifest)) {
  const { fingerprint } = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(path.join(webDir, "dist/catalog-fingerprint.txt"), `${fingerprint}\n`);
  console.log(`stamped dist with catalog fingerprint ${fingerprint.slice(0, 12)}`);
}
