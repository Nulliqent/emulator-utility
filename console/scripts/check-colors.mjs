// D-10: every color is a design token. Raw hex, rgb(), hsl() and the like are banned outside
// packages/ui/src/tokens/. Components use var(--color-*).
//
// Limits: a line-based text scan, not a parser. It cannot see colors built at runtime (string
// concatenation), named CSS colors (`red`), colors inside images, or files outside apps/, packages/
// and e2e/. A `//` comment holding a hex is flagged too; reword it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["apps", "packages", "e2e"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".refs", "test-results", "playwright-report"]);
const EXT = /\.(css|tsx?|html|svg)$/;
const ALLOWED = path.join("packages", "ui", "src", "tokens") + path.sep;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (EXT.test(e.name)) yield path.join(dir, e.name);
  }
}

const offenders = [];
for (const top of SCAN) {
  for (const file of walk(path.join(root, top))) {
    const rel = path.relative(root, file);
    if (rel.startsWith(ALLOWED)) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      // `#section` anchors and `&#39;` entities are not colors: require a non-word char before `#`.
      if (COLOR.test(line.replace(/(\w|&)#/g, "$1_"))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (offenders.length) {
  console.error("Raw colors outside the design tokens (use var(--color-*)):\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("check-colors: ok");
