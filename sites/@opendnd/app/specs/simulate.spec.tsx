import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import type { ModelInfo, World } from 'src/api/types';
import { AppProvider } from 'src/app/context';
import { OntologyProvider } from 'src/app/ontology';
import { WorldProvider } from 'src/app/world';
import { Simulate } from 'src/pages/Simulate';
import {
  PET_ID,
  WORLD_ID,
  petDocument,
  petModels,
  petVocabularies,
} from './fixtures/ontology';
import { type Handler, fakeFetch, testServices, testWorld } from './helpers';

/** The pet model, with a history that can be simulated over one. */
const models: ModelInfo[] = petModels.map((m) =>
  m.id === 'pet'
    ? {
        ...m,
        simulate: {
          description: 'Run the pet’s life forward, year by year.',
          input: {
            type: 'object',
            properties: {
              years: {
                type: 'integer',
                minimum: 1,
                maximum: 1000,
                default: 100,
              },
              startYear: { type: 'integer', default: 1000 },
              save: { type: 'boolean', default: false },
            },
            additionalProperties: false,
          },
        },
      }
    : m,
);

const outcome = {
  startYear: 1000,
  endYear: 1100,
  counts: { pet: 3, person: 12 },
  findings: [
    {
      rule: 'tenure-ends-when-its-event-says',
      severity: 'warning',
      message: 'one tenure outlived its ending',
      resources: [PET_ID],
    },
  ],
  saved: false,
  resources: [],
};

function apiFor(extra: Record<string, Handler> = {}) {
  return fakeFetch({
    'GET /v1/models': () => ({ models }),
    'GET /v1/vocabularies': () => ({
      vocabularies: Object.fromEntries(petVocabularies.map((v) => [v.id, v])),
    }),
    'GET /v1/openapi.json': () => petDocument,
    [`GET /v1/worlds/${WORLD_ID}/pet/${PET_ID}`]: () => ({
      id: PET_ID,
      model: 'pet',
      name: 'Biscuit',
    }),
    ...extra,
  });
}

function renderSimulate(
  fetchImpl: typeof fetch,
  world: World = testWorld,
  model = 'pet',
) {
  const services = testServices(fetchImpl);
  const router = createMemoryRouter(
    [
      {
        path: '/worlds/:world/:model/:id/simulate',
        element: (
          <OntologyProvider>
            <WorldProvider world={world}>
              <Simulate />
            </WorldProvider>
          </OntologyProvider>
        ),
      },
      { path: '/worlds/:world/event', element: <p>the events</p> },
    ],
    { initialEntries: [`/worlds/${WORLD_ID}/${model}/${PET_ID}/simulate`] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('simulating a history from the app', () => {
  it('rehearses a run, shows what it would produce and its findings, then keeps it', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/${PET_ID}/$simulate`]: async (
        request,
      ) => {
        const body = (await request.json()) as { save?: boolean };
        return body.save
          ? { ...outcome, saved: true, resources: undefined }
          : outcome;
      },
    });
    renderSimulate(fetch);

    expect(
      await screen.findByRole('heading', {
        name: 'Simulate the history of Biscuit',
      }),
    ).toBeInTheDocument();
    // The form comes from the schema, defaults filled in, and never asks about saving.
    const years = await screen.findByLabelText(/^Years/);
    expect(years).toHaveValue(100);
    expect(screen.queryByLabelText(/^Save/)).not.toBeInTheDocument();

    await user.clear(years);
    await user.type(years, '40');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const rehearsal = calls.find((c) => c.url.includes('$simulate'))!;
    expect(await rehearsal.json()).toEqual({
      years: 40,
      startYear: 1000,
      save: false,
    });

    const card = (await screen.findByText(/Rehearsed 1000 to 1100/)).closest(
      '[data-slot=card]',
    ) as HTMLElement;
    expect(
      within(card).getByText(
        '15 resources would be produced. Nothing is saved yet.',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('Pet')).toBeInTheDocument();
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByText('1 finding')).toBeInTheDocument();
    expect(
      within(card).getByText(/one tenure outlived its ending/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep this history' }));
    const kept = calls.filter((c) => c.url.includes('$simulate'))[1]!;
    expect(await kept.json()).toEqual({
      years: 40,
      startYear: 1000,
      save: true,
    });
    expect(await screen.findByText(/Kept 1000 to 1100/)).toBeInTheDocument();
    expect(
      screen.getByText('15 resources are now part of the world.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See what happened' }),
    ).toHaveAttribute('href', `/worlds/${WORLD_ID}/event`);
  });

  it('shows the API’s refusal when there is nothing to simulate', async () => {
    const user = userEvent.setup();
    const { fetch } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/${PET_ID}/$simulate`]: () =>
        Response.json(
          {
            error:
              'there is nothing to simulate here: the scope holds no titles',
            code: 'validation',
            requestId: 'r1',
          },
          { status: 400 },
        ),
    });
    renderSimulate(fetch);
    await screen.findByLabelText(/^Years/);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByText(/the scope holds no titles/),
    ).toBeInTheDocument();
  });

  it('turns a viewer away, since a run is a write', async () => {
    renderSimulate(apiFor().fetch, { ...testWorld, role: 'viewer' });
    expect(
      await screen.findByText('Only an editor or owner may simulate here'),
    ).toBeInTheDocument();
  });

  it('says when a model is not something a history runs over', async () => {
    const { fetch } = apiFor({
      [`GET /v1/worlds/${WORLD_ID}/person/${PET_ID}`]: () => ({
        id: PET_ID,
        model: 'person',
        name: 'Ada',
      }),
    });
    renderSimulate(fetch, testWorld, 'person');
    expect(
      await screen.findByText('A history cannot be simulated for a person'),
    ).toBeInTheDocument();
  });
});
