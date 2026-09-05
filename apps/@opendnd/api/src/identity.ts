import { createPublicKey, createVerify } from 'node:crypto';

/** Who is making a request, as far as the API is concerned. */
export interface Identity {
  /** Stable identifier from the identity provider: Cognito's `sub`. */
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  /** Cognito groups, for roles that are not per-world. */
  readonly groups?: readonly string[];
}

/** Turns an Authorization header into an identity, or nothing. */
export interface IdentityResolver {
  resolve(authorization: string | undefined): Promise<Identity | undefined>;
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

export interface CognitoOptions {
  readonly region: string;
  readonly userPoolId: string;
  /**
   * App client ids this API accepts tokens for. An access token carries the
   * client in `client_id`, an id token in `aud`; either must be listed here,
   * or a token minted for another application would be accepted.
   */
  readonly clientIds: readonly string[];
  /** Injectable for tests, which serve a JWKS of their own making. */
  readonly fetch?: typeof globalThis.fetch;
  /** How long a fetched key set is trusted. Default one hour. */
  readonly cacheMs?: number;
  /**
   * How long an unknown key id is refused without fetching the key set
   * again. Default thirty seconds. Without a floor, anyone could make the API
   * fetch the key set once per request by sending tokens with made-up ids.
   */
  readonly minRefreshMs?: number;
  /** How long a key set fetch may take. Default five seconds. */
  readonly fetchTimeoutMs?: number;
  /** Clock skew allowed on `exp` and `nbf`, in seconds. Default 60. */
  readonly clockSkewSeconds?: number;
  readonly now?: () => number;
}

/**
 * Verifies Cognito JSON Web Tokens.
 *
 * Verification is done here against the pool's published key set rather than
 * with an SDK: it is a signature check and four claim checks, it needs no AWS
 * credentials, and doing it in-process means a test can mint its own keys and
 * run with no network and no account.
 *
 * Both token kinds are accepted. An access token is what an API is normally
 * given; an id token is what carries the user's email, which is worth having
 * when a user is first seen.
 */
export class CognitoVerifier implements IdentityResolver {
  /** A verifier from the environment, or nothing if the pool is not configured. */
  static fromEnv(
    env: Record<string, string | undefined>,
  ): CognitoVerifier | undefined {
    const region = env.COGNITO_REGION ?? env.AWS_REGION;
    const userPoolId = env.COGNITO_USER_POOL_ID;
    const clientIds = (env.COGNITO_CLIENT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (!region || !userPoolId || clientIds.length === 0) return undefined;
    return new CognitoVerifier({ region, userPoolId, clientIds });
  }

  private readonly issuer: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cacheMs: number;
  private readonly minRefreshMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly skew: number;
  private readonly now: () => number;
  private keys = new Map<string, Jwk>();
  private fetchedAt = 0;

  constructor(private readonly options: CognitoOptions) {
    this.issuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.cacheMs = options.cacheMs ?? 60 * 60 * 1000;
    this.minRefreshMs = options.minRefreshMs ?? 30 * 1000;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 5000;
    this.skew = options.clockSkewSeconds ?? 60;
    this.now = options.now ?? (() => Date.now());
  }

  async resolve(
    authorization: string | undefined,
  ): Promise<Identity | undefined> {
    const token = bearer(authorization);
    if (token === undefined) return undefined;
    return this.verify(token);
  }

  /** Verify a token and return who it is for. Throws if it is not acceptable. */
  async verify(token: string): Promise<Identity> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedError('token is not a JWT');
    }
    const [encodedHeader, encodedPayload, signature] = parts as [
      string,
      string,
      string,
    ];
    const header = decode<{ kid?: string; alg?: string }>(encodedHeader);
    if (header.alg !== 'RS256') {
      throw new UnauthorizedError(`unsupported algorithm ${header.alg}`);
    }
    if (!header.kid) throw new UnauthorizedError('token names no key');

    const jwk = await this.keyFor(header.kid);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    const ok = verifier.verify(
      createPublicKey({ key: jwk as never, format: 'jwk' }),
      Buffer.from(signature, 'base64url'),
    );
    if (!ok) throw new UnauthorizedError('token signature does not verify');

    return this.claims(decode<Record<string, unknown>>(encodedPayload));
  }

  private claims(payload: Record<string, unknown>): Identity {
    const seconds = Math.floor(this.now() / 1000);
    if (payload.iss !== this.issuer) {
      throw new UnauthorizedError('token was issued by another pool');
    }
    const use = payload.token_use;
    if (use !== 'access' && use !== 'id') {
      throw new UnauthorizedError(`unexpected token_use ${String(use)}`);
    }
    const client = (payload.client_id ?? payload.aud) as string | undefined;
    if (client === undefined || !this.options.clientIds.includes(client)) {
      throw new UnauthorizedError('token was issued for another application');
    }
    const exp = payload.exp as number | undefined;
    if (exp === undefined || exp + this.skew < seconds) {
      throw new UnauthorizedError('token has expired');
    }
    const nbf = payload.nbf as number | undefined;
    if (nbf !== undefined && nbf - this.skew > seconds) {
      throw new UnauthorizedError('token is not valid yet');
    }
    const subject = payload.sub as string | undefined;
    if (subject === undefined) throw new UnauthorizedError('token has no sub');

    const groups = payload['cognito:groups'];
    return {
      subject,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string'
        ? { name: payload.name }
        : typeof payload['cognito:username'] === 'string'
          ? { name: payload['cognito:username'] }
          : {}),
      ...(Array.isArray(groups) ? { groups: groups as string[] } : {}),
    };
  }

  /**
   * The signing key for a key id. A key id that is not in the cache is
   * treated as a signal that the pool has rotated its keys, so the set is
   * fetched again before the token is rejected, but not more often than the
   * refresh floor allows: a rotation happens rarely, a flood of forged key
   * ids can happen any time.
   */
  private async keyFor(kid: string): Promise<Jwk> {
    const age = this.now() - this.fetchedAt;
    const stale = age > this.cacheMs;
    const unknown = !this.keys.has(kid) && age > this.minRefreshMs;
    if (stale || unknown) await this.refresh();
    const jwk = this.keys.get(kid);
    if (!jwk) throw new UnauthorizedError('token was signed by an unknown key');
    return jwk;
  }

  private async refresh(): Promise<void> {
    const response = await this.fetchImpl(
      `${this.issuer}/.well-known/jwks.json`,
      { signal: AbortSignal.timeout(this.fetchTimeoutMs) },
    );
    if (!response.ok) {
      throw new UnauthorizedError(
        `could not fetch the signing keys (${response.status})`,
      );
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    this.keys = new Map((body.keys ?? []).map((k) => [k.kid, k]));
    this.fetchedAt = this.now();
  }
}

/**
 * Accepts `Bearer dev:<subject>` and nothing else.
 *
 * For working on the API without a user pool. It is only ever constructed
 * when `OPENDND_DEV_AUTH=on` is set explicitly, so it cannot be reached by
 * forgetting to configure Cognito: with neither configured the API is
 * anonymous-only, which fails closed.
 */
export class DevIdentityResolver implements IdentityResolver {
  async resolve(
    authorization: string | undefined,
  ): Promise<Identity | undefined> {
    const token = bearer(authorization);
    if (token === undefined || !token.startsWith('dev:')) return undefined;
    const subject = token.slice(4);
    if (subject.length === 0) return undefined;
    return { subject, name: subject, email: `${subject}@dev.invalid` };
  }
}

/** Cognito when it is configured, the dev resolver when it is asked for. */
export function resolverFromEnv(
  env: Record<string, string | undefined> = process.env,
): IdentityResolver | undefined {
  const cognito = CognitoVerifier.fromEnv(env);
  if (cognito) return cognito;
  if (env.OPENDND_DEV_AUTH === 'on') return new DevIdentityResolver();
  return undefined;
}

function bearer(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
}

function decode<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch (cause) {
    throw new UnauthorizedError('token is not readable');
  }
}
