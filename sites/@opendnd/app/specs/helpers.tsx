import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiClient } from 'src/api/client';
import type { World } from 'src/api/types';
import { type AppServices, AppProvider } from 'src/app/context';
import { OntologyProvider } from 'src/app/ontology';
import { WorldProvider } from 'src/app/world';
import { SessionStore, devSession } from 'src/auth/session';
import type { Ontology } from 'src/schema/openapi';
import { WORLD_ID, petOntology } from './fixtures/ontology';

export type Handler = (
  request: Request,
  url: URL,
) => Response | object | undefined | Promise<Response | object | undefined>;

/**
 * A `fetch` that answers from a table of `METHOD /path` handlers and records
 * every request it saw. A plain object answer becomes a JSON 200.
 */
export function fakeFetch(handlers: Record<string, Handler> = {}) {
  const calls: Request[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    // Recorded as a clone, so a handler that reads the body leaves it readable.
    calls.push(request.clone());
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) {
      return Response.json(
        { error: `no handler for ${key}`, code: 'not-found', requestId: 'r0' },
        { status: 404 },
      );
    }
    const answer = await handler(request, url);
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response(null, { status: 204 });
    return Response.json(answer);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const testWorld: World = {
  id: WORLD_ID,
  name: 'Testland',
  visibility: 'private',
  role: 'owner',
};

export function testServices(fetchImpl: typeof fetch): AppServices {
  const sessions = new SessionStore(undefined);
  sessions.write(devSession('tester'));
  const api = new ApiClient({
    baseUrl: 'http://api.test',
    authorization: async () => sessions.read()?.token,
    fetch: fetchImpl,
  });
  return {
    config: { apiUrl: 'http://api.test', auth: { mode: 'dev' } },
    sessions,
    api,
    signInDev: (name) => sessions.write(devSession(name)),
    beginSignIn: async () => undefined,
    signOut: () => sessions.clear(),
  };
}

/** Renders inside the app's providers, the invented ontology and a router, at `/worlds/<id>`. */
export function renderInWorld(
  ui: ReactNode,
  options: {
    readonly fetch?: typeof fetch;
    readonly world?: World;
    readonly path?: string;
    /** Another ontology than the pet one, for models that refer to each other. */
    readonly ontology?: Ontology;
    /** The route pattern to mount `ui` at, when it reads path parameters. */
    readonly route?: string;
  } = {},
) {
  const services = testServices(options.fetch ?? fakeFetch().fetch);
  const world = options.world ?? testWorld;
  const ontology = options.ontology ?? petOntology();
  const router = createMemoryRouter(
    [
      {
        path: options.route ?? '*',
        element: (
          <OntologyProvider ontology={ontology}>
            <WorldProvider world={world}>{ui}</WorldProvider>
          </OntologyProvider>
        ),
      },
    ],
    { initialEntries: [options.path ?? `/worlds/${world.id}`] },
  );
  return {
    ...render(
      <AppProvider services={services}>
        <RouterProvider router={router} />
      </AppProvider>,
    ),
    services,
    router,
  };
}
