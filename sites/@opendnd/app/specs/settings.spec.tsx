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
import { Settings, dollars } from 'src/pages/Settings';
import { WORLD_ID, petOntology } from './fixtures/ontology';
import { type Handler, fakeFetch, testServices, testWorld } from './helpers';

const members = {
  members: [
    { subject: 'tester', name: 'Tester', role: 'owner' },
    {
      subject: 'ada-1',
      name: 'Ada',
      email: 'ada@example.test',
      role: 'editor',
    },
  ],
  invitations: [
    { email: 'sam@example.test', role: 'viewer', invitedAt: '2026-09-01' },
  ],
};

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
    [`GET /v1/worlds/${WORLD_ID}/world/${WORLD_ID}`]: () => ({
      id: WORLD_ID,
      name: 'Testland',
      summary: 'A place to test.',
    }),
    [`GET /v1/worlds/${WORLD_ID}/members`]: () => members,
    [`GET /v1/worlds/${WORLD_ID}/modules`]: () => ({
      modules: [enabledModule],
    }),
    'GET /v1/modules': () => ({ modules: [enabledModule, offered] }),
    [`GET /v1/worlds/${WORLD_ID}/usage`]: () => ({
      calls: 12,
      inputTokens: 3400,
      outputTokens: 1200,
      costMicros: 12_500,
      chargeMicros: 13_750,
    }),
    ...extra,
  });
}

function renderSettings(fetchImpl: typeof fetch, world: World = testWorld) {
  const services = testServices(fetchImpl);
  const router = createMemoryRouter(
    [
      {
        path: '/worlds/:world/settings',
        element: (
          <MeProvider>
            <OntologyProvider ontology={petOntology()}>
              <WorldProvider world={world}>
                <Settings />
              </WorldProvider>
            </OntologyProvider>
          </MeProvider>
        ),
      },
      { path: '/worlds', element: <p>the worlds page</p> },
    ],
    { initialEntries: [`/worlds/${WORLD_ID}/settings`] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('a world’s settings', () => {
  it('lets an owner rename the world, change its visibility and clear its summary', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`PATCH /v1/worlds/${WORLD_ID}`]: () => ({
        ...testWorld,
        name: 'Renamed',
        visibility: 'public',
      }),
    });
    renderSettings(fetch);

    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Testland');
    const summary = screen.getByLabelText('Summary');
    await waitFor(() => expect(summary).toHaveValue('A place to test.'));

    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.selectOptions(screen.getByLabelText('Visibility'), 'public');
    await user.clear(summary);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(await patch.json()).toEqual({
      name: 'Renamed',
      visibility: 'public',
      summary: null,
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('lists members and invitations, invites by email, changes roles and removes', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/members`]: async (request) => {
        const body = (await request.json()) as { email?: string; role: string };
        return body.email
          ? Response.json(
              { invited: body.email.toLowerCase(), role: body.role },
              { status: 202 },
            )
          : undefined;
      },
      [`DELETE /v1/worlds/${WORLD_ID}/members/ada-1`]: () => undefined,
      [`DELETE /v1/worlds/${WORLD_ID}/invitations/sam%40example.test`]: () =>
        undefined,
    });
    renderSettings(fetch);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    expect(screen.getByText('sam@example.test')).toBeInTheDocument();
    expect(screen.getByText('invited')).toBeInTheDocument();

    // Invite someone new: the API answers 202 and the page says what that means.
    await user.type(
      screen.getByLabelText('Invite by email'),
      'New@Example.test',
    );
    await user.selectOptions(screen.getByLabelText('As'), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(
      await screen.findByText(/new@example.test is invited as viewer/),
    ).toBeInTheDocument();
    const invite = calls.find((c) => c.method === 'POST')!;
    expect(await invite.json()).toEqual({
      email: 'New@Example.test',
      role: 'viewer',
    });

    // Change Ada's role: a POST by subject.
    await user.selectOptions(screen.getByLabelText('Role of Ada'), 'viewer');
    await waitFor(async () => {
      const posts = calls.filter((c) => c.method === 'POST');
      expect(posts).toHaveLength(2);
    });
    const roleChange = calls.filter((c) => c.method === 'POST')[1]!;
    expect(await roleChange.json()).toEqual({
      subject: 'ada-1',
      role: 'viewer',
    });
    expect(await screen.findByText('Ada is now viewer.')).toBeInTheDocument();

    // Remove Ada, and withdraw Sam's invitation.
    await user.click(screen.getByRole('button', { name: 'Remove Ada' }));
    expect(
      await screen.findByText('Ada no longer belongs.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Withdraw the invitation to sam@example.test',
      }),
    );
    expect(
      await screen.findByText(/invitation to sam@example.test is withdrawn/),
    ).toBeInTheDocument();
    const deletes = calls
      .filter((c) => c.method === 'DELETE')
      .map((c) => new URL(c.url).pathname);
    expect(deletes).toEqual([
      `/v1/worlds/${WORLD_ID}/members/ada-1`,
      `/v1/worlds/${WORLD_ID}/invitations/sam%40example.test`,
    ]);
  });

  it('shows what the world has spent, in dollars', async () => {
    renderSettings(apiFor().fetch);
    const spend = (await screen.findByText('Spend')).closest(
      '[data-slot=card]',
    ) as HTMLElement;
    await waitFor(() =>
      expect(within(spend).getByText('12')).toBeInTheDocument(),
    );
    expect(within(spend).getByText('$0.0125')).toBeInTheDocument();
    expect(within(spend).getByText('$0.0138')).toBeInTheDocument();
    expect(dollars(2_500_000)).toBe('$2.50');
  });

  it('archives the world after confirmation and goes back to the list', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`DELETE /v1/worlds/${WORLD_ID}`]: () => undefined,
    });
    renderSettings(fetch);
    await user.click(
      await screen.findByRole('button', { name: 'Archive Testland' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('the worlds page')).toBeInTheDocument();
    expect(
      calls.some(
        (c) =>
          c.method === 'DELETE' &&
          new URL(c.url).pathname === `/v1/worlds/${WORLD_ID}`,
      ),
    ).toBe(true);
  });

  it('turns anyone but an owner away', async () => {
    renderSettings(apiFor().fetch, { ...testWorld, role: 'editor' });
    expect(
      await screen.findByText("Only an owner may change a world's settings"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
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
});
