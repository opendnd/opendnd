import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from 'src/app/context';
import { MeProvider } from 'src/app/me';
import { OntologyProvider } from 'src/app/ontology';
import { PanelProvider, usePanel } from 'src/app/panel';
import { RightPanel } from 'src/components/RightPanel';
import { PET_ID, WORLD_ID, petOntology, storedPet } from './fixtures/ontology';
import { fakeFetch, testServices, testWorld } from './helpers';

/** Stands in for a page that puts a question to the panel, the home screen say. */
function Asker() {
  const panel = usePanel();
  return (
    <button type="button" onClick={() => panel.ask('Who owns Biscuit?')}>
      Put the question
    </button>
  );
}

function renderPanel(
  kind: 'ask' | 'inspect',
  path: string,
  fetchImpl: typeof fetch,
  beneath?: ReactNode,
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
                {beneath}
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
  beforeEach(() => {
    localStorage.clear();
    // The conversation is kept for the visit, so one test's answers would
    // otherwise still be on screen in the next.
    sessionStorage.clear();
  });

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

  it('takes a question put from the page, once, and not before it knows the models', async () => {
    const user = userEvent.setup();
    let answerCatalogue: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      answerCatalogue = resolve;
    });
    const { fetch, calls } = fakeFetch({
      ...me,
      'GET /v1/llm': async () => {
        await held;
        return {
          task: { name: 'chronicle' },
          models: [{ id: 'local-small', provider: 'ollama' }],
        };
      },
      [`POST /v1/worlds/${WORLD_ID}/$ask`]: () => ({
        answer: 'Biscuit belongs to **Ada**.',
        sources: [],
        facts: [],
      }),
    });
    renderPanel('inspect', `/worlds/${WORLD_ID}`, fetch, <Asker />);

    await user.click(
      await screen.findByRole('button', { name: 'Put the question' }),
    );
    // The panel comes forward on Ask at once, with the question shown.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    // But nothing is sent while the deployment has not said what it holds,
    // because a question sent then is a question sent with no model.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    answerCatalogue!();
    expect(await screen.findByText('Ada')).toBeInTheDocument();

    const asked = calls.filter((c) => c.method === 'POST');
    // Asked once, however many times the panel re-rendered around it.
    expect(asked).toHaveLength(1);
    expect(await asked[0]!.json()).toEqual({
      question: 'Who owns Biscuit?',
      model: 'local-small',
    });
  });
});
