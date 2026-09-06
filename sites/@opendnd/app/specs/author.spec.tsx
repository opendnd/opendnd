import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import type { ModelInfo, World } from 'src/api/types';
import { AppProvider } from 'src/app/context';
import { OntologyProvider } from 'src/app/ontology';
import { WorldProvider } from 'src/app/world';
import { Author } from 'src/pages/Author';
import {
  PET_ID,
  WORLD_ID,
  petDocument,
  petModels,
  petVocabularies,
} from './fixtures/ontology';
import { type Handler, fakeFetch, testServices, testWorld } from './helpers';

const WORK_ID = '66666666-6666-4666-8666-666666666666';

/** The pet model, with writing offered about one. */
const models: ModelInfo[] = petModels.map((m) =>
  m.id === 'pet'
    ? {
        ...m,
        author: {
          description: 'Ask a model to write about this pet.',
          input: {
            type: 'object',
            properties: {
              workType: {
                type: 'string',
                enum: ['article', 'chronicle'],
                default: 'article',
              },
              words: {
                type: 'integer',
                minimum: 50,
                maximum: 2000,
                default: 250,
              },
              model: { type: 'string', description: 'By id.' },
              save: { type: 'boolean', default: false },
            },
            additionalProperties: false,
          },
        },
      }
    : m,
);

const draft = {
  work: {
    id: WORK_ID,
    model: 'work',
    name: 'Biscuit',
    workType: 'article',
    text: 'Biscuit is a small dog.\n\nBiscuit is fond of shoes.',
    about: [{ model: 'pet', id: PET_ID }],
  },
  saved: false,
  facts: ['Pet: Biscuit', 'Mood: happy'],
  spend: {
    model: 'gemma-test',
    provider: 'ollama',
    inputTokens: 300,
    outputTokens: 120,
    costMicros: 0,
    chargeMicros: 0,
    cached: false,
  },
};

function apiFor(extra: Record<string, Handler> = {}) {
  return fakeFetch({
    'GET /v1/models': () => ({ models }),
    'GET /v1/vocabularies': () => ({
      vocabularies: Object.fromEntries(petVocabularies.map((v) => [v.id, v])),
    }),
    'GET /v1/openapi.json': () => petDocument,
    'GET /v1/llm': () => ({
      task: { name: 'chronicle', model: 'gemma-test' },
      models: [
        {
          id: 'gemma-test',
          provider: 'ollama',
          name: 'gemma:test',
          local: true,
        },
        {
          id: 'claude-test',
          provider: 'bedrock',
          name: 'claude',
          local: false,
        },
      ],
    }),
    [`GET /v1/worlds/${WORLD_ID}/pet/${PET_ID}`]: () => ({
      id: PET_ID,
      model: 'pet',
      name: 'Biscuit',
    }),
    ...extra,
  });
}

function renderAuthor(fetchImpl: typeof fetch, world: World = testWorld) {
  const services = testServices(fetchImpl);
  const router = createMemoryRouter(
    [
      {
        path: '/worlds/:world/:model/:id/author',
        element: (
          <OntologyProvider>
            <WorldProvider world={world}>
              <Author />
            </WorldProvider>
          </OntologyProvider>
        ),
      },
      { path: '/worlds/:world/work/:id', element: <p>the work page</p> },
    ],
    { initialEntries: [`/worlds/${WORLD_ID}/pet/${PET_ID}/author`] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('asking a model to write about a record', () => {
  it('offers the models the deployment holds, writes a draft, and keeps the very text read', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/${PET_ID}/$author`]: () => draft,
      [`POST /v1/worlds/${WORLD_ID}/$import`]: () =>
        Response.json({ imported: 1, world: WORLD_ID }, { status: 201 }),
    });
    renderAuthor(fetch);

    expect(
      await screen.findByRole('heading', { name: 'Write about Biscuit' }),
    ).toBeInTheDocument();
    // The model field became a choice among what /v1/llm listed.
    const model = await screen.findByLabelText(/^Model/);
    expect(
      within(model).getByRole('option', {
        name: 'gemma-test · ollama · local',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the chronicle task's model, gemma-test, writes/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Save/)).not.toBeInTheDocument();

    await user.selectOptions(model, 'claude-test');
    await user.selectOptions(screen.getByLabelText(/^Work type/), 'chronicle');
    await user.click(screen.getByRole('button', { name: 'Write' }));

    const asked = calls.find((c) => c.url.includes('$author'))!;
    expect(await asked.json()).toEqual({
      workType: 'chronicle',
      words: 250,
      model: 'claude-test',
    });

    const card = (await screen.findByText('Biscuit is a small dog.')).closest(
      '[data-slot=card]',
    ) as HTMLElement;
    expect(
      within(card).getByText('Biscuit is fond of shoes.'),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        /Written by gemma-test via ollama: 300 tokens in, 120 out, costing a local model, nothing/,
      ),
    ).toBeInTheDocument();

    // The facts the model was held to are there to check.
    await user.click(
      within(card).getByRole('button', {
        name: /What the model was given: 2 facts/,
      }),
    );
    expect(within(card).getByText('Mood: happy')).toBeInTheDocument();

    // Keeping imports exactly the draft, then opens it.
    await user.click(screen.getByRole('button', { name: 'Keep this' }));
    const imported = calls.find((c) => c.url.includes('$import'))!;
    expect(await imported.json()).toEqual({ resources: [draft.work] });
    expect(await screen.findByText('the work page')).toBeInTheDocument();
  });

  it('shows why a model refused or was not there', async () => {
    const user = userEvent.setup();
    const { fetch } = apiFor({
      [`POST /v1/worlds/${WORLD_ID}/pet/${PET_ID}/$author`]: () =>
        Response.json(
          {
            error: 'no model was named and the task names none',
            code: 'no-model',
            requestId: 'r1',
          },
          { status: 400 },
        ),
    });
    renderAuthor(fetch);
    await screen.findByLabelText(/^Model/);
    await user.click(screen.getByRole('button', { name: 'Write' }));
    expect(
      await screen.findByText(/no model was named and the task names none/),
    ).toBeInTheDocument();
  });

  it('turns a viewer away, since a call spends the world’s money', async () => {
    renderAuthor(apiFor().fetch, { ...testWorld, role: 'viewer' });
    expect(
      await screen.findByText('Only an editor or owner may ask for writing'),
    ).toBeInTheDocument();
  });
});
