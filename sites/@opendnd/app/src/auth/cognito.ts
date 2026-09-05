import {
  type OAuthClient,
  type TokenResponse,
  authorizeUrl,
  challengeFor,
  claimsOf,
  exchangeCode,
  randomString,
  refreshTokens,
} from './pkce';
import type { KeyValueStorage, Session } from './session';

export interface CognitoAuthOptions extends OAuthClient {
  /** Where the hosted UI sends the browser back to, e.g. https://app/callback. */
  readonly redirectUri: string;
  /** Where the hosted UI sends the browser after signing out. */
  readonly signOutUri: string;
  /** Holds the verifier and state across the redirect. Session storage. */
  readonly storage: KeyValueStorage;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const PENDING = 'opendnd.signin';

interface Pending {
  readonly verifier: string;
  readonly state: string;
  readonly returnTo: string;
}

/**
 * Sign-in through the Cognito hosted UI.
 *
 * The id token is what goes to the API. Both token kinds verify there, and
 * the id token is the one that carries the email address, which is how a
 * membership invitation finds the person it was for.
 */
export class CognitoAuth {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: CognitoAuthOptions) {
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
  }

  /** The URL to send the browser to. Remembers what it needs for `complete`. */
  async begin(returnTo = '/'): Promise<string> {
    const verifier = randomString();
    const state = randomString(16);
    const pending: Pending = { verifier, state, returnTo };
    this.options.storage.setItem(PENDING, JSON.stringify(pending));
    return authorizeUrl({
      domain: this.options.domain,
      clientId: this.options.clientId,
      redirectUri: this.options.redirectUri,
      state,
      challenge: await challengeFor(verifier),
    });
  }

  /** Finish sign-in from the callback URL. Returns the session and where to go. */
  async complete(
    callbackUrl: string,
  ): Promise<{ session: Session; returnTo: string }> {
    const url = new URL(callbackUrl);
    const error = url.searchParams.get('error');
    if (error) {
      throw new Error(
        url.searchParams.get('error_description') ?? `sign-in failed: ${error}`,
      );
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('the callback carries no code');

    const raw = this.options.storage.getItem(PENDING);
    this.options.storage.removeItem(PENDING);
    if (!raw) throw new Error('no sign-in was in progress in this window');
    const pending = JSON.parse(raw) as Pending;
    if (pending.state !== state) {
      throw new Error('the callback does not belong to this sign-in');
    }

    const tokens = await exchangeCode(
      {
        domain: this.options.domain,
        clientId: this.options.clientId,
        redirectUri: this.options.redirectUri,
        code,
        verifier: pending.verifier,
      },
      this.fetchImpl,
    );
    return { session: this.sessionFrom(tokens), returnTo: pending.returnTo };
  }

  /** A fresh session from the refresh token, keeping it for next time. */
  async refresh(session: Session): Promise<Session> {
    if (!session.refreshToken) {
      throw new Error('the session cannot be refreshed');
    }
    const tokens = await refreshTokens(
      { domain: this.options.domain, clientId: this.options.clientId },
      session.refreshToken,
      this.fetchImpl,
    );
    return this.sessionFrom({
      ...tokens,
      refresh_token: tokens.refresh_token ?? session.refreshToken,
    });
  }

  /** Where to send the browser to end the hosted session too. */
  signOutUrl(): string {
    const url = new URL('/logout', this.options.domain);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('logout_uri', this.options.signOutUri);
    return url.href;
  }

  private sessionFrom(tokens: TokenResponse): Session {
    const token = tokens.id_token ?? tokens.access_token;
    const claims = claimsOf(token);
    const subject = claims.sub;
    if (typeof subject !== 'string') {
      throw new Error('the token has no subject');
    }
    const name =
      typeof claims.name === 'string'
        ? claims.name
        : typeof claims['cognito:username'] === 'string'
          ? claims['cognito:username']
          : undefined;
    return {
      mode: 'cognito',
      subject,
      ...(name ? { name } : {}),
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      token,
      expiresAt: this.now() + tokens.expires_in * 1000,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };
  }
}
