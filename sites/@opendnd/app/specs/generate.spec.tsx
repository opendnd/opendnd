import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { AppProvider } from 'src/app/context';
import { OntologyProvider } from 'src/app/ontology';
import { WorldProvider } from 'src/app/world';
import { Generate } from 'src/pages/Generate';
import {
  OWNER_ID,
  PET_ID,
  WORLD_ID,
  petDocument,
  petModels,
  petVocabularies,
} from './fixtures/ontology';
import { type Handler, fakeFetch, testServices, testWorld } from './helpers';
import { render } from '@testing-library/react';

/** The API this page needs: the ontology, search, generation and import. */
function apiFor(extra: Record<string, Handler> = {}) {
  return fakeFetch({
    'GET /v1/models': () => ({ models: petModels }),
    'GET /v1/vocabularies': () => ({
      vocabularies: Object.fromEntries(petVocabularies.map((v) => [v.id, v])),
    }),
    'GET /v1/openapi.json': () => petDocument,
    [`GET /v1/worlds/${WORLD_ID}/$search`]: (_, url) =>
      url.searchParams.get('q') === 'Ada'
        ? {
            results: [
              {
                model: 'person',
                id: OWNER_ID,
                name: 'Ada',
                canonStatus: 'canon',
              },
            ],
          }
        : { results: [] },
    ...extra,
  });
}

function renderGenerate(
  fetchImpl: typeof fetch,
  role: 'owner' | 'viewer' = 'owner',
) {
  const services = testServices(fetchImpl);
  const router = createMemoryRouter(
    [
      {
        path: '/worlds/:world/:model/generate',
        element: (
          <OntologyProvider>
            <WorldProvider world={{ ...testWorld, role }}>
              <Generate />
            </WorldProvider>
          </OntologyProvider>
        ),
      },
      { path: '/worlds/:world/:model/:id', element: <p>the record page</p> },
      { path: '/worlds/:world/:model', element: <p>the list page</p> },
    ],
    { initialEntries: [`/worlds/${WORLD_ID}/pet/generate`] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('generating from the app', () => {
  it('builds the form from the generator’s input, narrows the picker, and keeps the result', async () => {
    const user = userEvent.setup();
    const generated = [
      { id: PET_ID, model: 'pet', name: 'Biscuit', mood: 'happy' },
    ];
    const { fetch, calls } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/$generate`]: () => ({
        resources: generated,
      }),
      [`POST /v1/worlds/${WORLD_ID}/$import`]: () =>
        Response.json({ imported: 1, world: WORLD_ID }, { status: 201 }),
    });
    renderGenerate(fetch);

    expect(
      await screen.findByRole('heading', { name: 'Generate a pet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A pet with a mood, belonging to someone.'),
    ).toBeInTheDocument();

    // The owner is a reference fixed to persons, so the picker says so and
    // asks the API for persons only.
    const owner = await screen.findByLabelText(/^Owner/);
    expect(owner).toHaveAttribute('placeholder', 'Search person by name');
    await user.type(owner, 'Ada');
    await user.click(await screen.findByRole('option', { name: /Ada/ }));
    const search = calls.find((c) => c.url.includes('$search'))!;
    expect(new URL(search.url).searchParams.get('models')).toBe('person');

    await user.selectOptions(screen.getByLabelText(/^Mood/), 'sad');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    const generate = calls.find((c) => c.url.includes('$generate'))!;
    expect(await generate.json()).toEqual({
      owner: { model: 'person', id: OWNER_ID, name: 'Ada' },
      mood: 'sad',
    });

    const results = await screen.findByText(/Generated 1 pet/);
    const card = results.closest('[data-slot=card]') as HTMLElement;
    expect(within(card).getByText('Biscuit')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep all' }));
    const imported = calls.find((c) => c.url.includes('$import'))!;
    expect(await imported.json()).toEqual({ resources: generated });
    // One resource of the model asked for: straight to its page.
    expect(await screen.findByText('the record page')).toBeInTheDocument();
  });

  it('shows the API’s refusal and lets the form be corrected', async () => {
    const user = userEvent.setup();
    const { fetch } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/$generate`]: () =>
        Response.json(
          {
            error: 'the input is not valid',
            code: 'validation',
            requestId: 'r1',
            issues: [{ path: ['owner'], message: 'required' }],
          },
          { status: 400 },
        ),
    });
    renderGenerate(fetch);
    await screen.findByRole('heading', { name: 'Generate a pet' });
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('owner: required'),
    );
    // The form is still there to fix.
    expect(screen.getByLabelText(/^Owner/)).toBeInTheDocument();
  });

  it('lets a viewer generate but not keep', async () => {
    const user = userEvent.setup();
    const { fetch } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/$generate`]: () => ({
        resources: [{ id: PET_ID, model: 'pet', name: 'Crumb' }],
      }),
    });
    renderGenerate(fetch, 'viewer');
    await screen.findByRole('heading', { name: 'Generate a pet' });
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText(/Generated 1 pet/);
    expect(
      screen.queryByRole('button', { name: 'Keep all' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Only an editor or owner/)).toBeInTheDocument();
  });

  it('says when nothing generates a model', async () => {
    const { fetch } = apiFor();
    const services = testServices(fetch);
    const router = createMemoryRouter(
      [
        {
          path: '/worlds/:world/:model/generate',
          element: (
            <OntologyProvider>
              <WorldProvider world={testWorld}>
                <Generate />
              </WorldProvider>
            </OntologyProvider>
          ),
        },
      ],
      { initialEntries: [`/worlds/${WORLD_ID}/person/generate`] },
    );
    render(
      <AppProvider services={services}>
        <RouterProvider router={router} />
      </AppProvider>,
    );
    expect(
      await screen.findByText('Nothing generates a person yet'),
    ).toBeInTheDocument();
  });
});
