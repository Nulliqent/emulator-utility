import type { ConnectionSummary } from "@console/api-contract";

/**
 * The "same settings in your code" snippet: AWS SDK v3 for Node, pointed at the endpoint apps on the host use. The
 * keys are read from the Emulator's credentials file, so this text never holds a key.
 */
export function clientSnippet(c: ConnectionSummary): string {
  let port = "9297";
  try {
    port = new URL(c.endpoint).port || port;
  } catch {
    // keep the default
  }
  return [
    'import { homedir } from "node:os";',
    'import { join } from "node:path";',
    'import { fromIni } from "@aws-sdk/credential-providers";',
    'import { S3Client } from "@aws-sdk/client-s3";',
    "",
    "// The Emulator's certificate comes from its own CA. Start your app with:",
    `//   NODE_EXTRA_CA_CERTS=$HOME/.aws/emulator/${port}/ca.pem node app.js`,
    "// (AWS CLI and boto3 read AWS_CA_BUNDLE; the JavaScript SDK v3 does not.)",
    `const home = join(homedir(), ".aws", "emulator", "${port}");`,
    "",
    "const config = {",
    `  region: "${c.region}",`,
    `  endpoint: "${c.endpoint}",`,
    "  // The Emulator writes new keys here each time it starts.",
    "  // The file holds a [default] profile, which is what fromIni reads when no profile is named.",
    '  credentials: fromIni({ filepath: join(home, "emulator_credentials") }),',
    `  maxAttempts: ${c.behaviour.maxAttempts},`,
    `  requestHandler: { requestTimeout: ${c.behaviour.timeoutMs} },`,
    "};",
    "",
    "// S3 needs path-style addressing",
    "const s3 = new S3Client({ ...config, forcePathStyle: true });",
    "",
  ].join("\n");
}
