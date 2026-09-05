import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  challengeFor,
  claimsOf,
  exchangeCode,
  randomString,
  refreshTokens,
} from 'src/auth/pkce';
import { fakeFetch } from './helpers';

describe('PKCE', () => {
  it('derives the S256 challenge in the RFC 7636 example', async () => {
    expect(
      await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes verifiers that are URL-safe, long enough, and different', () => {
    const a = randomString();
    const b = randomString();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('builds the authorization URL the hosted UI expects', () => {
    const url = new URL(
      authorizeUrl({
        domain: 'https://pool.auth.eu-west-1.amazoncognito.com',
        clientId: 'client-1',
        redirectUri: 'http://localhost:4100/callback',
        state: 'st',
        challenge: 'ch',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://pool.auth.eu-west-1.amazoncognito.com/oauth2/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'http://localhost:4100/callback',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges a code as a form post carrying the verifier', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /oauth2/token': () => ({
        access_token: 'a',
        id_token: 'i',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });
    const tokens = await exchangeCode(
      {
        domain: 'https://pool.example',
        clientId: 'client-1',
        redirectUri: 'http://localhost:4100/callback',
        code: 'code-1',
        verifier: 'verifier-1',
      },
      fetch,
    );
    expect(tokens.id_token).toBe('i');
    const request = calls[0]!;
    expect(request.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(
      Object.fromEntries(new URLSearchParams(await request.text())),
    ).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      redirect_uri: 'http://localhost:4100/callback',
      code: 'code-1',
      code_verifier: 'verifier-1',
    });
  });

  it('refreshes with the refresh grant', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /oauth2/token': () => ({
        access_token: 'a2',
        expires_in: 60,
        token_type: 'Bearer',
      }),
    });
    await refreshTokens(
      { domain: 'https://pool.example', clientId: 'c' },
      'r1',
      fetch,
    );
    expect(
      Object.fromEntries(new URLSearchParams(await calls[0]!.text())),
    ).toEqual({
      grant_type: 'refresh_token',
      client_id: 'c',
      refresh_token: 'r1',
    });
  });

  it('reports a token endpoint that refuses', async () => {
    const { fetch } = fakeFetch({
      'POST /oauth2/token': () =>
        new Response('{"error":"invalid_grant"}', { status: 400 }),
    });
    await expect(
      refreshTokens(
        { domain: 'https://pool.example', clientId: 'c' },
        'r1',
        fetch,
      ),
    ).rejects.toThrow(/400.*invalid_grant/);
  });

  it('reads the claims of a token without verifying it', () => {
    const payload = btoa(JSON.stringify({ sub: 's', email: 'e@x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(claimsOf(`h.${payload}.sig`)).toEqual({ sub: 's', email: 'e@x' });
    expect(() => claimsOf('nope')).toThrow(/JWT/);
  });
});
