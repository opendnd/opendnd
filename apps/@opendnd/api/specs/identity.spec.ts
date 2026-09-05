import { describe, expect, it } from 'bun:test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  CognitoVerifier,
  DevIdentityResolver,
  UnauthorizedError,
  resolverFromEnv,
} from 'src/identity';

const REGION = 'us-east-1';
const POOL = 'us-east-1_Example';
const CLIENT = '2example3client4id';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL}`;
const NOW = 1_800_000_000_000;

/**
 * The pool's keys are minted here, so verification is tested against a real
 * RS256 signature with no network and no AWS account.
 */
function pool(kid = 'key-1') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' };
  return {
    jwk,
    sign(
      claims: Record<string, unknown>,
      header: Record<string, unknown> = {},
    ) {
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const signing = `${encode({ alg: 'RS256', kid, ...header })}.${encode(claims)}`;
      const signer = createSign('RSA-SHA256');
      signer.update(signing);
      return `${signing}.${signer.sign(privateKey).toString('base64url')}`;
    },
  };
}

function verifier(
  keys: Record<string, unknown>[],
  options: { onFetch?: () => void } = {},
) {
  return new CognitoVerifier({
    region: REGION,
    userPoolId: POOL,
    clientIds: [CLIENT],
    now: () => NOW,
    fetch: (async (url: string) => {
      options.onFetch?.();
      expect(String(url)).toBe(`${ISSUER}/.well-known/jwks.json`);
      return {
        ok: true,
        status: 200,
        json: async () => ({ keys }),
      };
    }) as never,
  });
}

const claims = (extra: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  sub: 'ff9c1b6a-0000-4000-8000-000000000001',
  token_use: 'access',
  client_id: CLIENT,
  exp: Math.floor(NOW / 1000) + 3600,
  ...extra,
});

describe('CognitoVerifier', () => {
  it('accepts an access token the pool signed', async () => {
    const p = pool();
    const identity = await verifier([p.jwk]).verify(p.sign(claims()));
    expect(identity.subject).toBe('ff9c1b6a-0000-4000-8000-000000000001');
  });

  it('takes the email and groups from an id token', async () => {
    const p = pool();
    const identity = await verifier([p.jwk]).verify(
      p.sign(
        claims({
          token_use: 'id',
          client_id: undefined,
          aud: CLIENT,
          email: 'drew@example.org',
          'cognito:username': 'drew',
          'cognito:groups': ['staff'],
        }),
      ),
    );
    expect(identity.email).toBe('drew@example.org');
    expect(identity.name).toBe('drew');
    expect(identity.groups).toEqual(['staff']);
  });

  it('rejects a token signed by a key the pool does not publish', async () => {
    const theirs = pool();
    const mine = pool('key-other');
    await expect(
      verifier([mine.jwk]).verify(theirs.sign(claims())),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a token whose payload was changed after signing', async () => {
    const p = pool();
    const token = p.sign(claims());
    const [header, , signature] = token.split('.');
    const tampered = Buffer.from(
      JSON.stringify(claims({ sub: 'someone-else' })),
    ).toString('base64url');
    await expect(
      verifier([p.jwk]).verify(`${header}.${tampered}.${signature}`),
    ).rejects.toThrow('signature does not verify');
  });

  it('rejects a token from another pool, another app, or the past', async () => {
    const p = pool();
    const v = verifier([p.jwk]);
    await expect(
      v.verify(p.sign(claims({ iss: `${ISSUER}_other` }))),
    ).rejects.toThrow('another pool');
    await expect(
      v.verify(p.sign(claims({ client_id: 'someone-elses-app' }))),
    ).rejects.toThrow('another application');
    await expect(
      v.verify(p.sign(claims({ exp: Math.floor(NOW / 1000) - 3600 }))),
    ).rejects.toThrow('expired');
    await expect(
      v.verify(p.sign(claims({ token_use: 'refresh' }))),
    ).rejects.toThrow('token_use');
  });

  it('refuses an unsigned token, whatever its header claims', async () => {
    const p = pool();
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const none = `${encode({ alg: 'none', kid: 'key-1' })}.${encode(claims())}.`;
    await expect(verifier([p.jwk]).verify(none)).rejects.toThrow(
      'unsupported algorithm',
    );
  });

  it('fetches the key set once and again when a key id is unknown', async () => {
    const first = pool('key-1');
    const second = pool('key-2');
    let fetches = 0;
    const v = verifier([first.jwk, second.jwk], {
      onFetch: () => {
        fetches++;
      },
    });
    await v.verify(first.sign(claims()));
    await v.verify(first.sign(claims()));
    expect(fetches).toBe(1);
    // A key id it has not seen is treated as rotation, not as a bad token.
    await v.verify(second.sign(claims()));
    expect(fetches).toBe(1);
  });

  it('does not fetch the key set again for every unknown key id', async () => {
    const first = pool('key-1');
    const forged = pool('key-9');
    let fetches = 0;
    const v = verifier([first.jwk], {
      onFetch: () => {
        fetches++;
      },
    });
    await v.verify(first.sign(claims()));
    // Unknown ids arriving inside the refresh floor are refused without a
    // fetch each; otherwise a stream of forged tokens is a stream of requests
    // to the pool.
    for (let i = 0; i < 5; i++) {
      await expect(v.verify(forged.sign(claims()))).rejects.toThrow(
        'unknown key',
      );
    }
    expect(fetches).toBe(1);
  });

  it('comes from the environment only when a pool and a client are named', () => {
    expect(CognitoVerifier.fromEnv({ AWS_REGION: REGION })).toBeUndefined();
    expect(
      CognitoVerifier.fromEnv({
        AWS_REGION: REGION,
        COGNITO_USER_POOL_ID: POOL,
      }),
    ).toBeUndefined();
    expect(
      CognitoVerifier.fromEnv({
        AWS_REGION: REGION,
        COGNITO_USER_POOL_ID: POOL,
        COGNITO_CLIENT_IDS: `${CLIENT}, other`,
      }),
    ).toBeDefined();
  });
});

describe('the development resolver', () => {
  it('is only ever chosen when it is asked for by name', () => {
    // Neither configured means anonymous, which fails closed: a missing pool
    // must not quietly hand out a development identity.
    expect(resolverFromEnv({})).toBeUndefined();
    expect(resolverFromEnv({ OPENDND_DEV_AUTH: 'on' })).toBeInstanceOf(
      DevIdentityResolver,
    );
    expect(
      resolverFromEnv({
        AWS_REGION: REGION,
        COGNITO_USER_POOL_ID: POOL,
        COGNITO_CLIENT_IDS: CLIENT,
        OPENDND_DEV_AUTH: 'on',
      }),
    ).toBeInstanceOf(CognitoVerifier);
  });

  it('accepts its own token shape and nothing else', async () => {
    const resolver = new DevIdentityResolver();
    expect((await resolver.resolve('Bearer dev:drew'))?.subject).toBe('drew');
    expect(
      await resolver.resolve('Bearer something.else.here'),
    ).toBeUndefined();
    expect(await resolver.resolve(undefined)).toBeUndefined();
  });
});
