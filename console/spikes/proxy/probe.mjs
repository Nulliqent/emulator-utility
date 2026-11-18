// Throwaway: show S3 upload wire headers, and check browser-header rejection when direct.
import fs from 'node:fs';
import https from 'node:https';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const ini = fs.readFileSync(process.env.CREDS, 'utf8');
const credentials = { accessKeyId: ini.match(/key_id\s*=\s*(\S+)/)[1], secretAccessKey: ini.match(/secret_access_key\s*=\s*(\S+)/)[1] };
for (const chk of ['WHEN_REQUIRED', 'WHEN_SUPPORTED']) {
  const s3 = new S3Client({ endpoint: 'http://127.0.0.1:9300', region: 'us-east-1', forcePathStyle: true, credentials, requestChecksumCalculation: chk, maxAttempts: 1 });
  s3.middlewareStack.add((next) => async (a) => {
    const h = a.request.headers; const keep = ['content-encoding', 'x-amz-content-sha256', 'x-amz-decoded-content-length', 'x-amz-trailer', 'x-amz-sdk-checksum-algorithm', 'transfer-encoding', 'content-length', 'host'];
    console.log(chk, Object.fromEntries(keep.filter((k) => k in h).map((k) => [k, h[k]]))); return next(a);
  }, { step: 'finalizeRequest', priority: 'low' });
  console.log(chk, 'status', (await s3.send(new PutObjectCommand({ Bucket: process.argv[2], Key: 'p-' + chk, Body: Buffer.alloc(5 << 20, 1) }))).$metadata.httpStatusCode);
}
// Direct to emulator with browser-ish headers (no proxy): expect 403
for (const hdr of [{ Origin: 'http://127.0.0.1:9300' }, { 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
  await new Promise((ok) => https.get('https://127.0.0.1:9297/__admin/health', { ca: fs.readFileSync(process.env.CA), headers: hdr }, (r) => { console.log('direct', JSON.stringify(hdr), '->', r.statusCode); r.resume(); ok(); }));
}
