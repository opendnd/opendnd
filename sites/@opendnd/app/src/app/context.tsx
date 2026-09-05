import {
  type ReactNode,
  createContext,
  useContext,
  useSyncExternalStore,
} from 'react';
import { ApiClient } from '../api/client';
import { CognitoAuth } from '../auth/cognito';
import {
  type KeyValueStorage,
  type Session,
  SessionStore,
  devSession,
  expiresSoon,
} from '../auth/session';
import type { AppConfig } from '../config';

/** Everything the pages share: configuration, the session, and the API. */
export interface AppServices {
  readonly config: AppConfig;
  readonly sessions: SessionStore;
  readonly cognito?: CognitoAuth;
  readonly api: ApiClient;
  /** Development mode: sign in as a name the API will trust. */
  signInDev(name: string): void;
  /** Cognito: send the browser to the hosted UI. Resolves after the redirect starts. */
  beginSignIn(returnTo: string): Promise<void>;
  signOut(): void;
}

export interface Browser {
  readonly origin: string;
  readonly local?: KeyValueStorage;
  readonly session?: KeyValueStorage;
  assign(url: string): void;
}

export function createServices(
  config: AppConfig,
  browser: Browser,
): AppServices {
  const sessions = new SessionStore(browser.local);
  const cognito =
    config.auth.mode === 'cognito'
      ? new CognitoAuth({
          domain: config.auth.domain,
          clientId: config.auth.clientId,
          redirectUri: `${browser.origin}/callback`,
          signOutUri: `${browser.origin}/sign-in`,
          storage: browser.session ?? memoryStorage(),
        })
      : undefined;

  // One refresh at a time, however many requests notice the token is old.
  let refreshing: Promise<Session | undefined> | undefined;
  const authorization = async (): Promise<string | undefined> => {
    const session = sessions.read();
    if (!session) return undefined;
    if (!cognito || !expiresSoon(session, Date.now())) return session.token;
    refreshing ??= cognito
      .refresh(session)
      .then((fresh) => {
        sessions.write(fresh);
        return fresh;
      })
      .catch(() => {
        sessions.clear();
        return undefined;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return (await refreshing)?.token;
  };

  const api = new ApiClient({
    baseUrl: config.apiUrl,
    authorization,
    onUnauthorized: () => sessions.clear(),
  });

  return {
    config,
    sessions,
    ...(cognito ? { cognito } : {}),
    api,
    signInDev(name) {
      sessions.write(devSession(name));
    },
    async beginSignIn(returnTo) {
      if (!cognito) throw new Error('sign-in is not configured');
      browser.assign(await cognito.begin(returnTo));
    },
    signOut() {
      const wasCognito = sessions.read()?.mode === 'cognito';
      sessions.clear();
      if (wasCognito && cognito) browser.assign(cognito.signOutUrl());
    },
  };
}

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const AppContext = createContext<AppServices | undefined>(undefined);

export function AppProvider(props: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  return (
    <AppContext.Provider value={props.services}>
      {props.children}
    </AppContext.Provider>
  );
}

export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error('useApp needs an AppProvider above it');
  return services;
}

export function useApi(): ApiClient {
  return useApp().api;
}

/** The current session, re-rendering when it changes. */
export function useSession(): Session | undefined {
  const { sessions } = useApp();
  return useSyncExternalStore(
    (listener) => sessions.subscribe(listener),
    () => sessions.read(),
    () => sessions.read(),
  );
}
