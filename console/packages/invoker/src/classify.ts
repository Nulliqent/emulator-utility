import type { FailureKind } from "./types.ts";

/** The parts of an SDK v3 exception the classifier reads (ServiceException and plain errors). */
export interface SdkErrorLike {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number; requestId?: string; attempts?: number };
  $response?: { headers?: Record<string, string | undefined> };
}

/** Codes that mean the credentials were refused (and so may have rotated). AccessDenied is the policy answering, not this. */
const AUTH_CODES = new Set([
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
  "IncompleteSignature",
  "MissingAuthenticationToken",
  "MissingAuthenticationTokenException",
  "ExpiredToken",
  "ExpiredTokenException",
  "InvalidAccessKeyId",
  "AuthFailure",
  "InvalidToken",
]);

export const isAuthCode = (code: string | undefined): boolean => code !== undefined && AUTH_CODES.has(code);

/** The header with which the Gateway marks a failure of its own (the Emulator was unreachable or too slow). */
export const GATEWAY_ERROR_HEADER = "x-console-error";
const GATEWAY_NETWORK_CODES = new Set(["emulator-unreachable", "emulator-timeout"]);

export interface Classified {
  kind: Exclude<FailureKind, "unknown-service" | "sdk-missing">;
  code?: string;
  message: string;
}

/**
 * Maps a thrown SDK error to a failure kind (ARCHITECTURE 3.4 and 6.2):
 * - `not-implemented`: 501 or `NotImplemented`;
 * - `auth`: 401 or an authentication code; or the Console could not fetch the keys (they are being refreshed);
 * - `network`: no HTTP answer after the request went out, or the Gateway's own marker that the Emulator did not answer;
 * - `input`: the SDK refused the input before sending anything (`sent` is false);
 * - `service-error`: any other HTTP answer, including 403 AccessDenied and a 502 or 504 the Gateway did not mark.
 */
export function classifyError(err: unknown, opts: { sent?: boolean } = {}): Classified {
  const e = (err && typeof err === "object" ? err : { message: String(err) }) as SdkErrorLike;
  const status = e.$metadata?.httpStatusCode;
  const code = e.name;
  const message = e.message && e.message !== "UnknownError" ? e.message : (code ?? "The call failed.");
  if (code === "CredentialsUnavailable") {
    return { kind: "auth", code, message: "The credentials are refreshing, retry in a moment." };
  }
  const marker = e.$response?.headers?.[GATEWAY_ERROR_HEADER];
  if (marker && GATEWAY_NETWORK_CODES.has(marker)) return { kind: "network", code: marker, message };
  if (status === 501 || code === "NotImplemented" || code === "NotImplementedException") return { kind: "not-implemented", code, message };
  if (status === 401 || isAuthCode(code)) return { kind: "auth", code, message };
  if (status === undefined) return opts.sent === false ? { kind: "input", code, message } : { kind: "network", code, message };
  return { kind: "service-error", code, message };
}
