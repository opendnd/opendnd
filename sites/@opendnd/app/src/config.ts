/**
 * How the application signs people in.
 *
 * `dev` sends `Bearer dev:<name>`, which the API accepts only when it was
 * started with `OPENDND_DEV_AUTH=on`, so working on the application needs no
 * user pool. `cognito` is the hosted sign-in with the code grant and PKCE.
 * `none` is a build that asked for Cognito without saying which pool: it
 * refuses to sign anyone in rather than quietly falling back to `dev`.
 */
export type AuthConfig =
  | { readonly mode: 'dev' }
  | {
      readonly mode: 'cognito';
      /** The hosted UI origin, e.g. https://opendnd-dev.auth.us-east-1.amazoncognito.com */
      readonly domain: string;
      readonly clientId: string;
    }
  | { readonly mode: 'none'; readonly reason: string };

export interface AppConfig {
  /** Origin of the API, with no trailing slash. */
  readonly apiUrl: string;
  readonly auth: AuthConfig;
}

/** The variables Vite exposes at build time, plus whether this is the dev server. */
export interface ConfigSource {
  readonly VITE_API_URL?: string;
  readonly VITE_AUTH?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly DEV?: boolean;
}

export const LOCAL_API_URL = 'http://localhost:4080';
export const PUBLIC_API_URL = 'https://api.opendnd.org';

export function readConfig(env: ConfigSource): AppConfig {
  const dev = env.DEV === true;
  const apiUrl = (
    env.VITE_API_URL ?? (dev ? LOCAL_API_URL : PUBLIC_API_URL)
  ).replace(/\/+$/, '');
  return { apiUrl, auth: readAuth(env, dev) };
}

function readAuth(env: ConfigSource, dev: boolean): AuthConfig {
  // Development auth is the default only under the dev server. A production
  // build gets it when asked for explicitly, and the API still has to agree.
  const mode = env.VITE_AUTH ?? (dev ? 'dev' : 'cognito');
  if (mode === 'dev') return { mode: 'dev' };
  if (mode !== 'cognito') {
    return { mode: 'none', reason: `VITE_AUTH=${mode} is not a sign-in mode` };
  }
  const domain = env.VITE_COGNITO_DOMAIN?.replace(/\/+$/, '');
  const clientId = env.VITE_COGNITO_CLIENT_ID;
  if (!domain || !clientId) {
    return {
      mode: 'none',
      reason:
        'Sign-in is not configured: set VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID, or VITE_AUTH=dev to work without a user pool.',
    };
  }
  return { mode: 'cognito', domain, clientId };
}

export const config: AppConfig = readConfig(
  import.meta.env as unknown as ConfigSource,
);
