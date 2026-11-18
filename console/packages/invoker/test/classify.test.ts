import { describe, expect, it } from "vitest";
import { classifyError } from "../src/classify.ts";

const http = (status: number, name = "SomeError", message = "boom", headers: Record<string, string> = {}) => ({
  name,
  message,
  $metadata: { httpStatusCode: status },
  $response: { headers },
});

describe("classifyError", () => {
  it("501 is not-implemented, whatever the code", () => {
    expect(classifyError(http(501, "UnknownError")).kind).toBe("not-implemented");
    expect(classifyError(http(400, "NotImplemented")).kind).toBe("not-implemented");
  });

  it("401 and the authentication codes are auth", () => {
    expect(classifyError(http(401)).kind).toBe("auth");
    for (const code of ["InvalidClientTokenId", "UnrecognizedClientException", "SignatureDoesNotMatch", "InvalidSignatureException", "IncompleteSignature", "MissingAuthenticationToken", "ExpiredToken", "ExpiredTokenException", "InvalidAccessKeyId", "AuthFailure", "InvalidToken"]) {
      expect(classifyError(http(400, code)).kind, code).toBe("auth");
    }
  });

  it("AccessDenied and UnauthorizedOperation are the policy answering: service-error", () => {
    for (const code of ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation"]) {
      expect(classifyError(http(403, code)).kind, code).toBe("service-error");
    }
    expect(classifyError(http(403)).kind).toBe("service-error");
  });

  it("no HTTP answer after sending is network", () => {
    expect(classifyError(new TypeError("Failed to fetch"), { sent: true }).kind).toBe("network");
    expect(classifyError(Object.assign(new Error("t"), { name: "TimeoutError" })).kind).toBe("network");
    expect(classifyError(Object.assign(new Error("a"), { name: "AbortError" })).kind).toBe("network");
  });

  it("the Gateway's own marker is network; an unmarked 502 or 504 is a service error", () => {
    expect(classifyError(http(502, "UnknownError", "x", { "x-console-error": "emulator-unreachable" })).kind).toBe("network");
    expect(classifyError(http(504, "UnknownError", "x", { "x-console-error": "emulator-timeout" })).kind).toBe("network");
    expect(classifyError(http(502)).kind).toBe("service-error");
    expect(classifyError(http(504)).kind).toBe("service-error");
  });

  it("an error thrown before anything was sent is input, not network", () => {
    const r = classifyError(new Error("No value provided for input HTTP label: QueueName."), { sent: false });
    expect(r.kind).toBe("input");
    expect(r.message).toContain("QueueName");
    expect(classifyError(new TypeError("Expected string, got number"), { sent: false }).kind).toBe("input");
  });

  it("a credentials fetch failure says the keys are refreshing", () => {
    const r = classifyError(Object.assign(new Error("credentials: HTTP 503"), { name: "CredentialsUnavailable" }), { sent: false });
    expect(r).toMatchObject({ kind: "auth", code: "CredentialsUnavailable" });
    expect(r.message).toMatch(/refreshing, retry/);
    expect(r.message).not.toMatch(/network/i);
  });

  it("any other HTTP answer is a service error and keeps its code and message", () => {
    expect(classifyError(http(400, "QueueDoesNotExist", "gone"))).toEqual({ kind: "service-error", code: "QueueDoesNotExist", message: "gone" });
    expect(classifyError(http(500)).kind).toBe("service-error");
  });

  it("copes with a thrown non-object", () => {
    expect(classifyError("oops").kind).toBe("network");
  });
});
