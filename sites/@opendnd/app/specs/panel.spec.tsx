import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from 'src/app/context';
import { MeProvider } from 'src/app/me';
import { OntologyProvider } from 'src/app/ontology';
import { PanelProvider } from 'src/app/panel';
import { RightPanel } from 'src/components/RightPanel';
import { PET_ID, WORLD_ID, petOntology, storedPet } from './fixtures/ontology';
import { fakeFetch, testServices, testWorld } from './helpers';

function renderPanel(
  kind: 'ask' | 'inspect',
  path: string,
  fetchImpl: typeof fetch,
) {
  const onClose = vi.fn();
  // The provider opens on the tab that was remembered.
  localStorage.setItem('opendnd.panel', kind);
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <MeProvider>
            <OntologyProvider ontology={petOntology()}>
              <PanelProvider>
                <RightPanel onClose={onClose} />
              </PanelProvider>
            </OntologyProvider>
          </MeProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <AppProvider services={testServices(fetchImpl)}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
  return onClose;
}

const me = { 'GET /v1/me': () => ({ subject: 'tester', worlds: [testWorld] }) };

describe('the right panel', () => {
  beforeEach(() => localStorage.clear());

  it('inspects the record on the page as the API holds it', async () => {
    const { fetch } = fakeFetch({
      ...me,
      [`GET /v1/worlds/${WORLD_ID}/pet/${PET_ID}`]: () =>
        Response.json(storedPet, { headers: { etag: '"2"' } }),
    });
    renderPanel('inspect', `/worlds/${WORLD_ID}/pet/${PET_ID}`, fetch);
    expect(await screen.findByText('"Biscuit"')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Inspect' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByText(`/v1/worlds/${WORLD_ID}/pet/${PET_ID}`),
    ).toHaveAttribute('title', 'ETag "2"');
  });

  it('asks nothing until a record is open, and says so', async () => {
    const { fetch } = fakeFetch(me);
    renderPanel('inspect', `/worlds/${WORLD_ID}/pet`, fetch);
    expect(await screen.findByText(/Open a record/)).toBeInTheDocument();
  });

  it('asks the world and links the records the answer rests on', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch({
      ...me,
      'GET /v1/llm': () => ({
        task: { name: 'chronicle' },
        models: [
          { id: 'local-small', provider: 'ollama' },
          { id: 'local-large', provider: 'ollama' },
        ],
      }),
      [`POST /v1/worlds/${WORLD_ID}/$ask`]: () => ({
        answer: 'Biscuit belongs to **Ada**.',
        sources: [{ model: 'pet', id: PET_ID, name: 'Biscuit' }],
        facts: ['Pet: Biscuit'],
      }),
    });
    renderPanel('ask', `/worlds/${WORLD_ID}`, fetch);
    await user.type(
      await screen.findByLabelText('Your question'),
      'Who owns Biscuit?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Biscuit' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/pet/${PET_ID}`,
    );
    // With nothing configured, the first model the deployment holds answers.
    const asked = calls.find((c) => c.method === 'POST')!;
    expect(await asked.json()).toEqual({
      question: 'Who owns Biscuit?',
      model: 'local-small',
    });
    await waitFor(() =>
      expect(screen.getByText('Who owns Biscuit?')).toBeInTheDocument(),
    );
  });
});
