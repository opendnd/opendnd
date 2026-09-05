import { describe, expect, it } from 'vitest';
import { CognitoAuth } from 'src/auth/cognito';
import { challengeFor } from 'src/auth/pkce';
import type { KeyValueStorage } from 'src/auth/session';
import { fakeFetch } from './helpers';

function memory(): KeyValueStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256', kid: 'k' })}.${encode(claims)}.sig`;
}

const NOW = 1_800_000_000_000;

function auth(fetchImpl: typeof fetch, storage = memory()) {
  return {
    storage,
    auth: new CognitoAuth({
      domain: 'https://pool.example',
      clientId: 'client-1',
      redirectUri: 'http://localhost:4100/callback',
      signOutUri: 'http://localhost:4100/sign-in',
      storage,
      fetch: fetchImpl,
      now: () => NOW,
    }),
  };
}

describe('Cognito sign-in', () => {
  it('begins by remembering a verifier and state, and sends their challenge', async () => {
    const { auth: cognito, storage } = auth(fakeFetch().fetch);
    const url = new URL(await cognito.begin('/worlds/abc'));
    const pending = JSON.parse(storage.map.get('opendnd.signin')!) as {
      verifier: string;
      state: string;
      returnTo: string;
    };
    expect(pending.returnTo).toBe('/worlds/abc');
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('code_challenge')).toBe(
      await challengeFor(pending.verifier),
    );
  });

  it('completes by exchanging the code and reading the id token', async () => {
    const idToken = jwt({
      sub: 'sub-1',
      email: 'ada@example.test',
      name: 'Ada',
    });
    const { fetch, calls } = fakeFetch({
      'POST /oauth2/token': () => ({
        access_token: jwt({ sub: 'sub-1' }),
        id_token: idToken,
        refresh_token: 'r1',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });
    const { auth: cognito } = auth(fetch);
    const begun = new URL(await cognito.begin('/worlds/abc'));
    const state = begun.searchParams.get('state')!;

    const { session, returnTo } = await cognito.complete(
      `http://localhost:4100/callback?code=c1&state=${state}`,
    );
    expect(returnTo).toBe('/worlds/abc');
    expect(session).toEqual({
      mode: 'cognito',
      subject: 'sub-1',
      name: 'Ada',
      email: 'ada@example.test',
      token: idToken,
      expiresAt: NOW + 3_600_000,
      refreshToken: 'r1',
    });
    const form = new URLSearchParams(await calls[0]!.text());
    expect(form.get('code')).toBe('c1');
  });

  it('refuses a callback whose state is not the one it issued', async () => {
    const { auth: cognito } = auth(fakeFetch().fetch);
    await cognito.begin();
    await expect(
      cognito.complete('http://localhost:4100/callback?code=c1&state=forged'),
    ).rejects.toThrow(/does not belong/);
  });

  it('refuses a callback when no sign-in was begun in this window', async () => {
    const { auth: cognito } = auth(fakeFetch().fetch);
    await expect(
      cognito.complete('http://localhost:4100/callback?code=c1&state=s'),
    ).rejects.toThrow(/no sign-in was in progress/);
  });

  it('surfaces the hosted UI error rather than exchanging anything', async () => {
    const { fetch, calls } = fakeFetch();
    const { auth: cognito } = auth(fetch);
    await expect(
      cognito.complete(
        'http://localhost:4100/callback?error=access_denied&error_description=User+cancelled',
      ),
    ).rejects.toThrow('User cancelled');
    expect(calls).toHaveLength(0);
  });

  it('refreshes and keeps the old refresh token when none comes back', async () => {
    const { fetch } = fakeFetch({
      'POST /oauth2/token': () => ({
        access_token: 'a',
        id_token: jwt({ sub: 'sub-1' }),
        expires_in: 60,
        token_type: 'Bearer',
      }),
    });
    const { auth: cognito } = auth(fetch);
    const fresh = await cognito.refresh({
      mode: 'cognito',
      subject: 'sub-1',
      token: 'old',
      refreshToken: 'r1',
    });
    expect(fresh.refreshToken).toBe('r1');
    expect(fresh.expiresAt).toBe(NOW + 60_000);
  });

  it('signs out through the hosted UI too', () => {
    const { auth: cognito } = auth(fakeFetch().fetch);
    expect(cognito.signOutUrl()).toBe(
      'https://pool.example/logout?client_id=client-1&logout_uri=http%3A%2F%2Flocalhost%3A4100%2Fsign-in',
    );
  });
});
