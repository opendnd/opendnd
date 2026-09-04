import { createHash, createHmac } from 'node:crypto';

export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Present for temporary credentials, which is every role, including Lambda's. */
  readonly sessionToken?: string;
}

export interface SigningRequest {
  readonly method: string;
  /** Full URL, with the path already percent-encoded as it will be sent. */
  readonly url: string;
  readonly region: string;
  readonly service: string;
  readonly headers?: Record<string, string>;
  readonly body: string;
  readonly credentials: Credentials;
  /** Signing time. Defaults to now; supplied by tests. */
  readonly now?: Date;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * Sign a request with AWS Signature Version 4 and return the headers to send.
 *
 * Signing is implemented here rather than taken from the AWS SDK because the
 * only AWS call OpenDnD makes is Bedrock, and one signing function keeps the
 * package free of dependencies and testable with no network and no account.
 * Credentials come from the environment, which is what Lambda and the CLI
 * both provide.
 */
export function signRequest(request: SigningRequest): Record<string, string> {
  const { method, region, service, body, credentials } = request;
  const url = new URL(request.url);
  const now = request.now ?? new Date();
  const amzDate = `${iso(now)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    ...lowerKeys(request.headers ?? {}),
    host: url.host,
    'x-amz-date': amzDate,
    ...(credentials.sessionToken
      ? { 'x-amz-security-token': credentials.sessionToken }
      : {}),
  };

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${collapse(headers[n])}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const payloadHash = sha256(body);

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const signature = hmac(
    signingKey(credentials.secretAccessKey, dateStamp, region, service),
    stringToSign,
  ).toString('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Credentials as Lambda, the CLI and CI all expose them. */
export function credentialsFromEnv(
  env: Record<string, string | undefined>,
): Credentials | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return undefined;
  const sessionToken = env.AWS_SESSION_TOKEN;
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

/** `20150830T123600`, which is an ISO timestamp with the punctuation removed. */
function iso(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const date = hmac(`AWS4${secret}`, dateStamp);
  const regional = hmac(date, region);
  const serviceKey = hmac(regional, service);
  return hmac(serviceKey, 'aws4_request');
}

/**
 * The canonical path. Every service but S3 encodes the path a second time,
 * so a Bedrock model id whose colon already arrived as `%3A` is signed as
 * `%253A`. Getting this wrong is the classic cause of a signature mismatch.
 */
function canonicalPath(pathname: string): string {
  if (pathname === '') return '/';
  return pathname.split('/').map(escapeUri).join('/');
}

function canonicalQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  params.forEach((value, key) => pairs.push([key, value]));
  pairs.sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])));
  return pairs.map(([k, v]) => `${escapeUri(k)}=${escapeUri(v)}`).join('&');
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** RFC 3986 encoding: unreserved characters pass, everything else escapes. */
function escapeUri(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}
