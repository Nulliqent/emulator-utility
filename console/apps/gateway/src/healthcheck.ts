// Container HEALTHCHECK: asks the Gateway for /meta as a curl-style caller on its public Host.
import http from "node:http";

const origin = new URL(process.env.CONSOLE_PUBLIC_ORIGIN ?? "http://127.0.0.1:9300");
http
  .get(
    { host: "127.0.0.1", port: Number(process.env.CONSOLE_PORT ?? 9300), path: "/__console/api/v1/meta", headers: { host: origin.host }, timeout: 3000 },
    (res) => {
      res.resume();
      process.exit(res.statusCode === 200 ? 0 : 1);
    },
  )
  .on("error", () => process.exit(1))
  .on("timeout", () => process.exit(1));
