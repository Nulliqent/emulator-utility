import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Serves the built SPA for a path below `/__console/`. Unknown paths fall back to index.html (client routes). */
export function serveSpa(webDir: string, rel: string, res: ServerResponse, headOnly: boolean): void {
  let target = path.join(webDir, path.normalize("/" + rel));
  if (!target.startsWith(webDir)) return notFound(res);
  const isAsset = rel.startsWith("assets/");
  try {
    if (!statSync(target).isFile()) throw new Error("not a file");
  } catch {
    if (isAsset || path.extname(rel)) return notFound(res); // a missing file, not a client route
    target = path.join(webDir, "index.html");
  }
  let size: number;
  try {
    size = statSync(target).size;
  } catch {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The web app is not built. Run `pnpm build`.");
    return;
  }
  const ext = path.extname(target);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (headOnly) return void res.end();
  createReadStream(target).pipe(res);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}
