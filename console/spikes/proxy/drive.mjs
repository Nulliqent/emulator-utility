// Throwaway driver: AWS SDK v3 through the proxy at http://127.0.0.1:9300.
// Env: CREDS (INI path), TAG. Optional: BROWSERISH=1 adds Origin/Referer/Cookie/Sec-Fetch-* after signing.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SQSClient, ListQueuesCommand, CreateQueueCommand } from '@aws-sdk/client-sqs';
import { KinesisClient, ListStreamsCommand } from '@aws-sdk/client-kinesis';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { IAMClient, ListUsersCommand, CreateUserCommand, CreateAccessKeyCommand } from '@aws-sdk/client-iam';
import { EC2Client, DescribeVpcsCommand } from '@aws-sdk/client-ec2';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, ListBucketsCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Upload } from '@aws-sdk/lib-storage';
import { createHash } from 'node:crypto';

const ini = fs.readFileSync(process.env.CREDS, 'utf8');
const accessKeyId = ini.match(/aws_access_key_id\s*=\s*(\S+)/)[1];
const secretAccessKey = ini.match(/aws_secret_access_key\s*=\s*(\S+)/)[1];
const base = { endpoint: process.env.ENDPOINT ?? 'http://127.0.0.1:9300', region: 'us-east-1', credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 };

function browserish(c) {
  if (!process.env.BROWSERISH) return c;
  c.middlewareStack.add((next) => async (args) => {
    Object.assign(args.request.headers, { Origin: 'http://127.0.0.1:9300', Referer: 'http://127.0.0.1:9300/__console/',
      Cookie: 'a=b', 'Sec-Fetch-Site': process.env.SFS ?? 'same-origin', 'Sec-Fetch-Mode': 'cors' });
    return next(args);
  }, { step: 'finalizeRequest', priority: 'low', name: 'browserish' });
  return c;
}
const mk = (C, extra = {}) => browserish(new C({ ...base, ...extra }));
const results = [];
async function t(name, proto, fn) {
  try { const r = await fn(); const code = r?.$metadata?.httpStatusCode; results.push([name, proto, 'PASS', code]); console.log('PASS', name, proto, code); return r; }
  catch (e) { results.push([name, proto, 'FAIL', e.$metadata?.httpStatusCode, e.name + ': ' + e.message]); console.log('FAIL', name, proto, e.$metadata?.httpStatusCode, e.name, e.message.slice(0, 200)); }
}

const sqs = mk(SQSClient);
const s3 = mk(S3Client, { forcePathStyle: true, requestChecksumCalculation: process.env.CHK ?? 'WHEN_REQUIRED' });
const bucket = 'spike-' + randomBytes(4).toString('hex');

await t('SQS ListQueues', 'awsJson1_0', () => sqs.send(new ListQueuesCommand({})));
await t('Kinesis ListStreams', 'awsJson1_1', () => mk(KinesisClient, { requestHandler: new NodeHttpHandler() }).send(new ListStreamsCommand({})));
await t('Lambda ListFunctions', 'restJson1', () => mk(LambdaClient).send(new ListFunctionsCommand({})));
await t('IAM ListUsers', 'awsQuery', () => mk(IAMClient).send(new ListUsersCommand({})));
await t('EC2 DescribeVpcs', 'ec2Query', () => mk(EC2Client).send(new DescribeVpcsCommand({})));
await t('S3 ListBuckets', 'restXml', () => s3.send(new ListBucketsCommand({})));
await t('S3 CreateBucket', 'restXml', () => s3.send(new CreateBucketCommand({ Bucket: bucket })));

const five = randomBytes(5 * 1024 * 1024);
const sha = (b) => createHash('sha256').update(b).digest('hex');
await t('S3 PutObject 5MB (Buffer)', 'restXml', () => s3.send(new PutObjectCommand({ Bucket: bucket, Key: 'five.bin', Body: five })));
await t('S3 GetObject 5MB roundtrip', 'restXml', async () => {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'five.bin' }));
  const got = Buffer.from(await r.Body.transformToByteArray());
  if (sha(got) !== sha(five)) throw new Error('content mismatch'); return r;
});
await t('S3 PutObject 5MB (stream, unknown length -> aws-chunked?)', 'restXml', async () => {
  const { Readable } = await import('node:stream');
  return s3.send(new PutObjectCommand({ Bucket: bucket, Key: 'stream.bin', Body: Readable.from([five]), ContentLength: five.length }));
});
await t('S3 PutObject 5MB CRC32 (WHEN_SUPPORTED)', 'restXml', () =>
  mk(S3Client, { forcePathStyle: true, requestChecksumCalculation: 'WHEN_SUPPORTED' }).send(new PutObjectCommand({ Bucket: bucket, Key: 'crc.bin', Body: five })));
await t('S3 Multipart manual (2 x 5MB)', 'restXml', async () => {
  const m = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'mp.bin' }));
  const parts = [];
  for (const n of [1, 2]) { const p = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: 'mp.bin', UploadId: m.UploadId, PartNumber: n, Body: five })); parts.push({ PartNumber: n, ETag: p.ETag }); }
  return s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: 'mp.bin', UploadId: m.UploadId, MultipartUpload: { Parts: parts } }));
});
await t('S3 Multipart lib-storage (12MB)', 'restXml', async () => {
  const body = randomBytes(12 * 1024 * 1024);
  const r = await new Upload({ client: s3, params: { Bucket: bucket, Key: 'lib.bin', Body: body }, partSize: 5 * 1024 * 1024 }).done();
  const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'lib.bin' }));
  if (h.ContentLength !== body.length) throw new Error('size mismatch'); return { $metadata: { httpStatusCode: h.$metadata.httpStatusCode } };
});

// Tenancy
const qname = 'spike-q-' + randomBytes(3).toString('hex');
const q = await t('SQS CreateQueue (emulator creds)', 'awsJson1_0', () => sqs.send(new CreateQueueCommand({ QueueName: qname })));
console.log('queueUrl', q?.QueueUrl);
await t('STS GetCallerIdentity (emulator creds)', 'awsQuery', async () => { const r = await mk(STSClient).send(new GetCallerIdentityCommand({})); console.log('  identity', r.Account, r.Arn); return r; });
const iam = mk(IAMClient);
const uname = 'spike-u-' + randomBytes(3).toString('hex');
await t('IAM CreateUser', 'awsQuery', () => iam.send(new CreateUserCommand({ UserName: uname })));
const ak = await t('IAM CreateAccessKey', 'awsQuery', () => iam.send(new CreateAccessKeyCommand({ UserName: uname })));
if (ak?.AccessKey) {
  const k = ak.AccessKey;
  console.log('  new key', k.AccessKeyId);
  const other = new SQSClient({ ...base, credentials: { accessKeyId: k.AccessKeyId, secretAccessKey: k.SecretAccessKey } });
  const r = await t('SQS ListQueues (IAM-created key)', 'awsJson1_0', async () => { const r = await other.send(new ListQueuesCommand({})); console.log('  sees queues:', JSON.stringify(r.QueueUrls)); return r; });
  const sts = new STSClient({ ...base, credentials: { accessKeyId: k.AccessKeyId, secretAccessKey: k.SecretAccessKey } });
  await t('STS GetCallerIdentity (IAM-created key)', 'awsQuery', async () => { const r = await sts.send(new GetCallerIdentityCommand({})); console.log('  identity', r.Account, r.Arn); return r; });
}
// Arbitrary (never-created) key
const rnd = new SQSClient({ ...base, credentials: { accessKeyId: 'AKIAARBITRARY12345', secretAccessKey: 'x'.repeat(40) } });
await t('SQS ListQueues (arbitrary unregistered key)', 'awsJson1_0', async () => { const r = await rnd.send(new ListQueuesCommand({})); console.log('  sees queues:', JSON.stringify(r.QueueUrls)); return r; });
// Wrong secret on the real key
const bad = new SQSClient({ ...base, credentials: { accessKeyId, secretAccessKey: 'y'.repeat(40) } });
await t('SQS ListQueues (real key, wrong secret) [expect FAIL]', 'awsJson1_0', () => bad.send(new ListQueuesCommand({})));
