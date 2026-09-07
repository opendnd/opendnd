import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { AppProvider } from 'src/app/context';
import { placeIn } from 'src/components/Layout';
import { MeProvider } from 'src/app/me';
import { OntologyProvider } from 'src/app/ontology';
import { AppSidebar } from 'src/components/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { WORLD_ID, petOntology } from './fixtures/ontology';
import { fakeFetch, testServices, testWorld } from './helpers';
import { troupeOntology } from './fixtures/troupe';

function renderSidebar(path: string, ontology = petOntology()) {
  const { fetch } = fakeFetch({
    'GET /v1/me': () => ({ subject: 'tester', worlds: [testWorld] }),
  });
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <MeProvider>
            <OntologyProvider ontology={ontology}>
              <SidebarProvider>
                <AppSidebar />
              </SidebarProvider>
            </OntologyProvider>
          </MeProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <AppProvider services={testServices(fetch)}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('the shell', () => {
  it('lists the worlds outside one, and nothing of any world', async () => {
    renderSidebar('/worlds');
    expect(
      await screen.findByRole('link', { name: 'Testland' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Play')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Leave/ }),
    ).not.toBeInTheDocument();
  });

  it('inside a world is the world: its surfaces, its data, and one door out', async () => {
    renderSidebar(`/worlds/${WORLD_ID}/pet`);
    expect(await screen.findByText('Play')).toBeInTheDocument();
    // The pet ontology has no campaigns or characters, so those are not offered.
    expect(
      screen.queryByRole('link', { name: 'Campaigns' }),
    ).not.toBeInTheDocument();
    for (const surface of ['Maps', 'Timeline', 'Marketplace', 'Settings']) {
      expect(screen.getByRole('link', { name: surface })).toBeInTheDocument();
    }
    // Every model is under Data, and the list can be narrowed.
    expect(screen.getByRole('link', { name: 'Pet' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/pet`,
    );
    expect(
      screen.getByRole('link', { name: 'Leave Testland' }),
    ).toHaveAttribute('href', '/worlds');
    // No list of other worlds while inside one.
    expect(screen.queryByText('Your worlds')).not.toBeInTheDocument();
  });

  it('offers a surface only when the ontology has its model', async () => {
    renderSidebar(`/worlds/${WORLD_ID}/show`, troupeOntology());
    await screen.findByText('Play');
    expect(
      screen.queryByRole('link', { name: 'Campaigns' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Compendium' }),
    ).not.toBeInTheDocument();
    const data = within(
      screen.getByText('Data').closest('[data-slot="sidebar-group"]')!,
    );
    expect(data.getByRole('link', { name: 'Show' })).toBeInTheDocument();
  });

  it('tells a surface from a model in an address', () => {
    expect(placeIn(`/worlds/${WORLD_ID}/campaigns`)).toEqual({
      world: WORLD_ID,
      surface: 'campaigns',
    });
    expect(placeIn(`/worlds/${WORLD_ID}/pet/abc`)).toEqual({
      world: WORLD_ID,
      model: 'pet',
      id: 'abc',
    });
    expect(placeIn(`/worlds/${WORLD_ID}/search`)).toEqual({
      world: WORLD_ID,
      surface: 'search',
    });
  });
});
