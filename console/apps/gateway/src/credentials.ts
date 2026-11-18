import { readFileSync } from "node:fs";
import type { Credentials } from "@console/api-contract";
import { parseDefaultProfile, type Connection } from "./connections.ts";

/**
 * Reads the Emulator Credentials from the Connection's INI file. Returns null when the file is missing or has no
 * keys (the Emulator is not running). The values are never logged.
 */
export function readCredentials(c: Connection, epoch: number): Credentials | null {
  let text: string;
  try {
    text = readFileSync(c.credentialsFile, "utf8");
  } catch {
    return null;
  }
  const p = parseDefaultProfile(text);
  const accessKeyId = p.aws_access_key_id;
  const secretAccessKey = p.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, ...(p.aws_session_token ? { sessionToken: p.aws_session_token } : {}), epoch };
}
