// Throwaway spike: pass-through proxy on 127.0.0.1:9300 -> emulator over TLS.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import tls from 'node:tls';

const UP_HOST = process.env.UP_HOST ?? '127.0.0.1';
const UP_PORT = Number(process.env.UP_PORT ?? 9297);
const CA = fs.readFileSync(process.env.CA_FILE);
const LISTEN_HOST = process.env.LISTEN_HOST ?? '127.0.0.1';
const agent = new https.Agent({ ca: CA, keepAlive: true }); // trusts ONLY ca.pem
const STRIP = /^(origin|referer|cookie|sec-fetch-.*)$/i;

http.createServer((req, res) => {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!STRIP.test(k)) headers[k] = v; // Host kept
  if (process.env.LOG) console.log(req.method, req.url.slice(0, 60), 'stripped:', Object.keys(req.headers).filter((k) => STRIP.test(k)).join(','));
  const up = https.request({
    host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers, agent,
    checkServerIdentity: (_h, cert) => tls.checkServerIdentity('127.0.0.1', cert), // identity is 127.0.0.1 whatever name we dial
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); });
  req.pipe(up); // stream both ways, no buffering
}).listen(9300, LISTEN_HOST, () => console.log(`proxy ${LISTEN_HOST}:9300 -> ${UP_HOST}:${UP_PORT}`));
