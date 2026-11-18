import { existsSync } from "node:fs";
import { join } from "node:path";
import { listDirNoSymlinks, readTextFile } from "./safe-fs.ts";

export interface CrateStatusScan {
  /** Operations that have an `ops/<op>.rs` file: scaffolded when the header carries the marker. */
  fileStatus: Map<string, "implemented" | "scaffolded">;
  /**
   * Operations that SKIPPED_STUBS.md lists with `// SKIPPED:` and does not list again with
   * `// HAND-AUTHORED:`. This is documentation only: it does not decide Source Status.
   * Some of these were hand-authored later without the HAND-AUTHORED line, so the list is
   * stale; the file presence decides (see the rule on `statusOf` in compile.ts).
   */
  skipped: Set<string>;
  /** Stable text lines describing the status facts (one per ops file), hashed into the fingerprint. */
  statusLines: string[];
  /** Skipped according to SKIPPED_STUBS.md but an ops file exists: the file wins. */
  skippedButAuthored: string[];
  problems: string[];
}

const MARKER = /^\/\/! SCAFFOLDED, NOT IMPLEMENTED:/;
const OP_TAG = /^\/\/! @op (\w+)\s*$/;

/**
 * Read the status of one `ops/*.rs` file from its header block only (the leading `//` comment
 * lines). Implemented files mention the marker phrase further down, so a substring search
 * anywhere in the file would be wrong.
 */
export function readOpHeader(source: string): { op?: string; scaffolded: boolean; duplicateOp: boolean } {
  let op: string | undefined;
  let duplicateOp = false;
  let scaffolded = false;
  for (const line of source.split("\n")) {
    if (!line.startsWith("//") && line.trim() !== "") break;
    const tag = OP_TAG.exec(line);
    if (tag) {
      if (op === undefined) op = tag[1];
      else duplicateOp = true;
    }
    if (MARKER.test(line)) scaffolded = true;
  }
  const out: { op?: string; scaffolded: boolean; duplicateOp: boolean } = { scaffolded, duplicateOp };
  if (op !== undefined) out.op = op;
  return out;
}

/** Parse SKIPPED_STUBS.md: `// SKIPPED: <Op>` lines minus `// HAND-AUTHORED: <Op>` lines. */
export function parseSkippedStubs(markdown: string): Set<string> {
  const skipped = new Set<string>();
  const hand = new Set<string>();
  for (const line of markdown.split("\n")) {
    const s = /^\/\/ SKIPPED: (\w+)/.exec(line);
    if (s?.[1]) skipped.add(s[1]);
    const h = /^\/\/ HAND-AUTHORED: (\w+)/.exec(line);
    if (h?.[1]) hand.add(h[1]);
  }
  for (const op of hand) skipped.delete(op);
  return skipped;
}

export function scanCrateStatus(crateDir: string): CrateStatusScan {
  const scan: CrateStatusScan = {
    fileStatus: new Map(),
    skipped: new Set(),
    statusLines: [],
    skippedButAuthored: [],
    problems: [],
  };
  const opsDir = join(crateDir, "src", "ops");
  if (!existsSync(opsDir)) return scan;

  for (const entry of listDirNoSymlinks(opsDir)) {
    if (entry.isFile && entry.name.endsWith(".rs") && entry.name !== "mod.rs") {
      const header = readOpHeader(readTextFile(join(opsDir, entry.name)));
      if (!header.op) {
        scan.problems.push(`ops/${entry.name} has no "//! @op" header`);
        continue;
      }
      if (header.duplicateOp) scan.problems.push(`ops/${entry.name} has more than one "//! @op" header; used ${header.op}`);
      if (scan.fileStatus.has(header.op)) {
        scan.problems.push(`ops/${entry.name} repeats the @op ${header.op} of another file`);
      }
      const status = header.scaffolded ? "scaffolded" : "implemented";
      scan.fileStatus.set(header.op, status);
      scan.statusLines.push(`op ${header.op} ${status}`);
    } else if (entry.isFile && entry.name === "SKIPPED_STUBS.md") {
      scan.skipped = parseSkippedStubs(readTextFile(join(opsDir, entry.name)));
    }
  }
  for (const op of [...scan.skipped].sort()) {
    if (scan.fileStatus.has(op)) scan.skippedButAuthored.push(op);
  }
  return scan;
}
