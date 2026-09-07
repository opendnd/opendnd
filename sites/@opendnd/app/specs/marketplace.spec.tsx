import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import type { World } from 'src/api/types';
import { AppProvider } from 'src/app/context';
import { MeProvider } from 'src/app/me';
import { OntologyProvider } from 'src/app/ontology';
import { WorldProvider } from 'src/app/world';
import { Marketplace } from 'src/pages/Marketplace';
import { WORLD_ID, petOntology } from './fixtures/ontology';
import { type Handler, fakeFetch, testServices, testWorld } from './helpers';

const enabledModule = {
  id: '3b9d2c1e-0000-4000-8000-000000000001',
  digest: `sha256:${'a'.repeat(64)}`,
  name: 'Core Bestiary',
  version: '1.0.0',
  visibility: 'public',
  contents: { pet: 2, person: 1 },
  total: 3,
  publishedAt: '2026-09-01T00:00:00Z',
  position: 1,
};

const offered = {
  id: '3b9d2c1e-0000-4000-8000-000000000002',
  digest: `sha256:${'b'.repeat(64)}`,
  name: 'Reach Setting',
  version: '2.0.0',
  summary: 'Two tongues and a calendar.',
  visibility: 'public',
  contents: { pet: 5 },
  total: 5,
  publishedAt: '2026-09-02T00:00:00Z',
};

function apiFor(extra: Record<string, Handler> = {}) {
  return fakeFetch({
    'GET /v1/me': () => ({ subject: 'tester', worlds: [testWorld] }),
    [`GET /v1/worlds/${WORLD_ID}/modules`]: () => ({
      modules: [enabledModule],
    }),
    'GET /v1/modules': () => ({ modules: [enabledModule, offered] }),
    ...extra,
  });
}

function renderSettings(fetchImpl: typeof fetch, world: World = testWorld) {
  const services = testServices(fetchImpl);
  const router = createMemoryRouter(
    [
      {
        path: '/worlds/:world/marketplace',
        element: (
          <MeProvider>
            <OntologyProvider ontology={petOntology()}>
              <WorldProvider world={world}>
                <Marketplace />
              </WorldProvider>
            </OntologyProvider>
          </MeProvider>
        ),
      },
    ],
    { initialEntries: [`/worlds/${WORLD_ID}/marketplace`] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('the marketplace', () => {
  it('lets a viewer see the stack and the offer but not change them', async () => {
    const { fetch } = apiFor();
    renderSettings(fetch, { ...testWorld, role: 'viewer' });
    expect(await screen.findByText('Core Bestiary')).toBeInTheDocument();
    expect(
      screen.getByText(/Owners change what a world reads/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();
  });

  it('lists the modules the world reads, enables another, disables one and publishes the world', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/modules`]: () =>
        Response.json({ ...offered, position: 2 }, { status: 201 }),
      [`DELETE /v1/worlds/${WORLD_ID}/modules/${enabledModule.id}`]: () =>
        undefined,
      [`POST /v1/worlds/${WORLD_ID}/$publish`]: () =>
        Response.json(
          {
            ...enabledModule,
            id: '3b9d2c1e-0000-4000-8000-000000000003',
            name: 'Testland',
            total: 7,
            contents: { pet: 7 },
          },
          { status: 201 },
        ),
    });
    renderSettings(fetch);

    expect(await screen.findByText('Core Bestiary')).toBeInTheDocument();
    expect(screen.getByText('3 records')).toBeInTheDocument();
    expect(screen.getByText('1 person, 2 pet')).toBeInTheDocument();

    // Only what is not yet enabled is offered.
    const choice = screen.getByLabelText('Enable a module');
    expect(within(choice).queryByText(/Core Bestiary/)).not.toBeInTheDocument();
    await user.selectOptions(choice, offered.id);
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    const enable = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/modules'),
    )!;
    expect(await enable.json()).toEqual({ module: offered.id });

    await user.click(
      screen.getByRole('button', { name: 'Disable Core Bestiary' }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'DELETE' &&
            c.url.endsWith(`/modules/${enabledModule.id}`),
        ),
      ).toBe(true),
    );

    // Publishing sends the form as it stands, named after the world.
    expect(screen.getByLabelText('Module name')).toHaveValue('Testland');
    await user.type(screen.getByLabelText('License'), 'CC-BY-4.0');
    await user.selectOptions(
      screen.getByLabelText('Who may enable it'),
      'public',
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const publish = calls.find((c) => c.url.includes('$publish'))!;
    expect(await publish.json()).toEqual({
      name: 'Testland',
      version: '1.0.0',
      license: 'CC-BY-4.0',
      visibility: 'public',
    });
    expect(
      await screen.findByText('Published Testland 1.0.0'),
    ).toBeInTheDocument();
  });

  it('lets an owner move a module up the stack', async () => {
    const user = userEvent.setup();
    const second = { ...offered, position: 2 };
    const { fetch, calls } = apiFor({
      [`GET /v1/worlds/${WORLD_ID}/modules`]: () => ({
        modules: [enabledModule, second],
      }),
      [`PUT /v1/worlds/${WORLD_ID}/modules`]: async (request) => {
        const { order } = (await request.json()) as { order: string[] };
        return {
          modules: order.map((id, index) => ({
            ...(id === offered.id ? offered : enabledModule),
            position: index + 1,
          })),
        };
      },
    });
    renderSettings(fetch);
    expect(await screen.findByText('Reach Setting')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move Core Bestiary up' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Move Reach Setting up' }),
    );
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(await put.json()).toEqual({ order: [offered.id, enabledModule.id] });
  });
});
