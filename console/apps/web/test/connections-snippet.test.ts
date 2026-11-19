import type { ConnectionSummary } from "@console/api-contract";
import { describe, expect, it } from "vitest";
import { clientSnippet } from "../src/features/connections/snippet.ts";

const c: ConnectionSummary = {
  id: "local",
  name: "Local emulator",
  endpoint: "https://127.0.0.1:9297",
  dialEndpoint: "https://emulator:9297",
  region: "us-east-1",
  accountId: "000000000000",
  home: { path: "/emulator-home/9297", found: true },
  behaviour: { s3PathStyle: true, maxAttempts: 4, timeoutMs: 45_000 },
};

describe("clientSnippet", () => {
  const text = clientSnippet(c);
  it("points at the endpoint apps on the host use, not the one the Console dials", () => {
    expect(text).toContain('endpoint: "https://127.0.0.1:9297"');
    expect(text).not.toContain("emulator:9297");
  });
  it("carries the region, the saved behaviour and path-style S3", () => {
    expect(text).toContain('region: "us-east-1"');
    expect(text).toContain("maxAttempts: 4");
    expect(text).toContain("requestTimeout: 45000");
    expect(text).toContain("forcePathStyle: true");
  });
  it("reads the keys from the credentials file and trusts the CA with AWS_CA_BUNDLE, never inlining a key", () => {
    expect(text).toContain("emulator_credentials");
    expect(text).toContain("NODE_EXTRA_CA_CERTS=$HOME/.aws/emulator/9297/ca.pem node app.js");
    expect(text).not.toMatch(/AWS_CA_BUNDLE=/);
    expect(text).toContain("9297/ca.pem");
    expect(text).not.toMatch(/accessKeyId|secretAccessKey|aws_secret/i);
  });
});
