import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The refs tree is third-party input. Nothing under it may be a symlink, so a hostile checkout
// cannot make the compiler read files outside the tree.

export function assertNotSymlink(path: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing to follow symlink ${path}`);
}

export function readTextFile(path: string): string {
  assertNotSymlink(path);
  return readFileSync(path, "utf8");
}

export function readBinaryFile(path: string): Buffer {
  assertNotSymlink(path);
  return readFileSync(path);
}

/** Names of the entries of a directory, sorted by code unit. Throws if the directory or any entry is a symlink. */
export function listDirNoSymlinks(dir: string): { name: string; isDir: boolean; isFile: boolean }[] {
  assertNotSymlink(dir);
  return readdirSync(dir)
    .sort(compareCodeUnits)
    .map((name) => {
      const st = lstatSync(join(dir, name));
      if (st.isSymbolicLink()) throw new Error(`refusing to follow symlink ${join(dir, name)}`);
      return { name, isDir: st.isDirectory(), isFile: st.isFile() };
    });
}

/** Locale-independent ordering, so output is identical on every machine. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
