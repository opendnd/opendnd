/**
 * The OAuth 2.0 authorization code grant with PKCE (RFC 7636), which is the
 * flow for a public client with no secret. Written against the platform's
 * `crypto` and `fetch` rather than a library, because it is two hashes and
 * two requests.
 */

export interface OAuthClient {
  /** Authorization server origin, e.g. a Cognito hosted UI domain. */
  readonly domain: string;
  readonly clientId: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly id_token?: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A high-entropy random string, for a code verifier or a state. */
export function randomString(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64url(buffer);
}

/** The S256 code challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

export interface AuthorizeRequest extends OAuthClient {
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
  readonly scope?: string;
}

export function authorizeUrl(request: AuthorizeRequest): string {
  const url = new URL('/oauth2/authorize', request.domain);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('scope', request.scope ?? 'openid email profile');
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

export interface ExchangeRequest extends OAuthClient {
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
}

export async function exchangeCode(
  request: ExchangeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return requestTokens(
    request,
    {
      grant_type: 'authorization_code',
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      code: request.code,
      code_verifier: request.verifier,
    },
    fetchImpl,
  );
}

export async function refreshTokens(
  client: OAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return requestTokens(
    client,
    {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      refresh_token: refreshToken,
    },
    fetchImpl,
  );
}

async function requestTokens(
  client: OAuthClient,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(new URL('/oauth2/token', client.domain), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `the token endpoint answered ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return (await response.json()) as TokenResponse;
}

/** The claims of a JWT, unverified: the API verifies, the client only reads. */
export function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('not a JWT');
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json) as Record<string, unknown>;
}
