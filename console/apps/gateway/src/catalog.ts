import { createReadStream, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

const FILE = /^(?:index\.json|manifest\.json|services\/[A-Za-z0-9._-]+\.json)$/;

/** The fingerprint of the compiled Catalog, or null when there is none. */
export function catalogFingerprint(manifestFile: string): string | null {
  try {
    const m = JSON.parse(readFileSync(manifestFile, "utf8")) as { fingerprint?: unknown };
    return typeof m.fingerprint === "string" ? m.fingerprint : null;
  } catch {
    return null;
  }
}

/**
 * Serves `/__console/catalog/<fingerprint>/<file>` from the folder beside the manifest. Only the current
 * fingerprint is served, and only the Catalog's own file names, so the URL is a content address: immutable.
 */
export function serveCatalog(manifestFile: string, rel: string, res: ServerResponse, headOnly: boolean): void {
  const slash = rel.indexOf("/");
  const fingerprint = slash < 0 ? rel : rel.slice(0, slash);
  const file = slash < 0 ? "" : rel.slice(slash + 1);
  const current = catalogFingerprint(manifestFile);
  if (!current || fingerprint !== current || !FILE.test(file)) return notFound(res);
  const target = path.join(path.dirname(manifestFile), file);
  let size: number;
  try {
    const s = statSync(target);
    if (!s.isFile()) return notFound(res);
    size = s.size;
  } catch {
    return notFound(res);
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": size,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (headOnly) return void res.end();
  createReadStream(target).pipe(res);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("Not found");
}
