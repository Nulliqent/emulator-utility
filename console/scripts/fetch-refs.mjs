// Fetch the two read-only reference repos at the commits pinned in refs.json into a git-ignored
// cache (console/.refs/). Sparse and blobless, so only what the Catalog compiler needs is
// downloaded. Set CONSOLE_REFS_DIR to use existing local clones instead; they are checked
// against the pins and never modified (a mismatch is a warning, and fatal when CI is set).
//
// usage: node scripts/fetch-refs.mjs [aws-emulator] [api-models-aws]   (default: both)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const consoleDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refs = JSON.parse(readFileSync(join(consoleDir, "refs.json"), "utf8")).repos;

function fail(message) {
  console.error(`refs:fetch failed: ${message}`);
  process.exit(1);
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(refs);
for (const name of names) {
  if (!Object.hasOwn(refs, name)) fail(`unknown reference repo "${name}"; known: ${Object.keys(refs).join(", ")}`);
  const { url, sha, sparse } = refs[name];
  if (!/^[0-9a-f]{40}$/.test(sha)) fail(`${name}: the pin in refs.json is not a 40-character commit sha`);
  if (!url.startsWith("https://github.com/")) fail(`${name}: the url in refs.json must start with https://github.com/`);
  if (!Array.isArray(sparse) || sparse.some((p) => typeof p !== "string" || p.startsWith("-"))) fail(`${name}: bad sparse paths`);
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const external = process.env.CONSOLE_REFS_DIR;
if (external) {
  const dir = resolve(external);
  for (const name of names) {
    const repo = join(dir, name);
    if (!existsSync(repo)) fail(`CONSOLE_REFS_DIR is set but ${repo} does not exist`);
    const head = git(repo, "rev-parse", "HEAD");
    const pin = refs[name].sha;
    if (head === pin) {
      console.log(`${name}: local clone is at the pin ${pin}`);
    } else if (process.env.CI) {
      fail(`${name}: local clone is at ${head}, the pin is ${pin}`);
    } else {
      console.warn(`warning: ${name}: local clone is at ${head}, the pin is ${pin}`);
    }
  }
  process.exit(0);
}

const cache = join(consoleDir, ".refs");
mkdirSync(cache, { recursive: true });
for (const name of names) {
  const { url, sha, sparse } = refs[name];
  const repo = join(cache, name);
  if (!existsSync(join(repo, ".git"))) {
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet");
    git(repo, "remote", "add", "origin", url);
  }
  git(repo, "remote", "set-url", "origin", url);
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "sparse-checkout", "set", "--no-cone", "--", ...sparse.map((p) => `/${p}`));
  git(repo, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "--", "origin", sha);
  git(repo, "checkout", "--quiet", "--force", "FETCH_HEAD", "--");
  const head = git(repo, "rev-parse", "HEAD");
  if (head !== sha) fail(`${name}: checked out ${head}, expected the pin ${sha}`);
  console.log(`${name}: fetched ${head}`);
}
