import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { AppProvider } from 'src/app/context';
import { MeProvider } from 'src/app/me';
import { Worlds } from 'src/pages/Worlds';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, testServices, testWorld } from './helpers';

const OLD_ID = '55555555-5555-4555-8555-555555555555';

describe('the worlds page', () => {
  it('lists worlds put away, and restores one', async () => {
    const user = userEvent.setup();
    let restored = false;
    const { fetch, calls } = fakeFetch({
      'GET /v1/me': () => ({
        subject: 'tester',
        worlds: restored
          ? [
              testWorld,
              {
                id: OLD_ID,
                name: 'Old Aerath',
                visibility: 'private',
                role: 'owner',
              },
            ]
          : [testWorld],
      }),
      'GET /v1/worlds': (_, url) =>
        url.searchParams.get('archived') === 'true'
          ? {
              worlds: restored
                ? []
                : [
                    {
                      id: OLD_ID,
                      name: 'Old Aerath',
                      visibility: 'private',
                      role: 'owner',
                      archivedAt: '2026-09-01T00:00:00.000Z',
                    },
                  ],
            }
          : { worlds: [testWorld] },
      [`POST /v1/worlds/${OLD_ID}/$restore`]: () => {
        restored = true;
        return undefined;
      },
    });
    const services = testServices(fetch);
    const router = createMemoryRouter(
      [
        {
          path: '/worlds',
          element: (
            <MeProvider>
              <Worlds />
            </MeProvider>
          ),
        },
        { path: `/worlds/${WORLD_ID}`, element: <p>a world</p> },
      ],
      { initialEntries: ['/worlds'] },
    );
    render(
      <AppProvider services={services}>
        <RouterProvider router={router} />
      </AppProvider>,
    );

    expect(await screen.findByText('Testland')).toBeInTheDocument();
    expect(await screen.findByText('Put away')).toBeInTheDocument();
    expect(screen.getByText('Old Aerath')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      calls.some((c) => c.url.endsWith(`/v1/worlds/${OLD_ID}/$restore`)),
    ).toBe(true);
    // Back among the living, and gone from the put-away list.
    await waitFor(() =>
      expect(screen.queryByText('Put away')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Old Aerath')).toBeInTheDocument();
  });
});
