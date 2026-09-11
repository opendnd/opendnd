import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { WorldHome } from 'src/pages/WorldHome';
import { Campaigns } from 'src/pages/Campaigns';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';
import { usePanel } from 'src/app/panel';

/** Reports what the panel was told, since the panel itself is not on the page here. */
function Probe() {
  const panel = usePanel();
  return (
    <div data-testid="panel">
      {panel.tab}:{panel.open ? 'open' : 'shut'}:{panel.pending?.question ?? ''}
    </div>
  );
}

/** An ontology with the models the home page's surfaces stand on. */
const base: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  name: { type: 'string' },
  description: { type: 'string' },
  status: { type: 'string', enum: ['running', 'finished'] },
  setting: {
    type: 'object',
    properties: {
      type: { const: 'Place' },
      id: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['model', 'id'],
    additionalProperties: false,
  },
};
const models: ModelInfo[] = [
  { id: 'campaign', name: 'Campaign' },
  { id: 'character', name: 'Character' },
  { id: 'work', name: 'Work' },
  { id: 'place', name: 'Place' },
  { id: 'character', name: 'Character' },
];
const ontology = ontologyFrom(
  {
    components: {
      schemas: Object.fromEntries(
        models.flatMap((m) => [
          [m.id, { type: 'object', properties: base, required: ['id'] }],
          [
            `${m.id}Input`,
            { type: 'object', properties: { name: base.name! } },
          ],
        ]),
      ),
    },
  },
  models,
  [],
);
const meta = (lastUpdated: string) => ({ versionId: '1', lastUpdated });
const campaigns = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    name: 'The Lantern Road',
    status: 'running',
    description: 'A road, a lantern, a long night.',
    setting: { type: 'Place', id: 'p1', display: 'Aldermere' },
    meta: meta('2026-09-06T10:00:00Z'),
  },
];

function api() {
  return fakeFetch({
    [`GET /v1/worlds/${WORLD_ID}/$counts`]: () => ({
      counts: {
        campaign: 1,
        'character-sheet': 0,
        work: 1240,
        place: 900,
        character: 2,
      },
    }),
    [`GET /v1/worlds/${WORLD_ID}/character`]: () => ({
      resources: [{ id: 'per1', name: 'Wren of the Ford' }],
    }),
    [`GET /v1/worlds/${WORLD_ID}/place`]: () => ({
      resources: [{ id: 'p1', name: 'Aldermere' }],
    }),
    [`GET /v1/worlds/${WORLD_ID}/campaign`]: () => ({ resources: campaigns }),
    [`GET /v1/worlds/${WORLD_ID}/character-sheet`]: () => ({
      resources: [],
    }),
    [`GET /v1/worlds/${WORLD_ID}/work`]: () => ({
      resources: [
        {
          id: 'w1',
          name: 'A chronicle',
          meta: meta('2026-09-07T10:00:00Z'),
        },
      ],
      next: 'more',
    }),
  });
}

describe('a world’s home', () => {
  it('greets with a question box, its own suggestions, and what the world holds', async () => {
    const { fetch } = api();
    renderInWorld(<WorldHome />, { fetch, ontology });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /Good (morning|afternoon|evening|night), tester\. What would you like to know about Testland\?/,
      }),
    ).toBeInTheDocument();

    // The numbers come from one count of the whole world, not a page per kind,
    // and a large one is written the way a navigation writes it.
    expect(await screen.findByText('1.2k')).toBeInTheDocument();
    expect(await screen.findByText('2.1k')).toBeInTheDocument();

    // Suggestions name things that are actually in this world.
    expect(
      await screen.findByRole('button', { name: 'Who is Wren of the Ford?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tell me about Aldermere.' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Campaigns/ })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/campaigns`,
    );
    expect(
      (await screen.findAllByText('The Lantern Road')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Set in Aldermere')).toBeInTheDocument();
    const recent = within(
      screen.getByText('Recently changed').closest('section')!,
    );
    const rows = recent.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toContain('A chronicle');
    expect(rows[1]).toContain('The Lantern Road');
  });

  it('hands a question to the panel rather than answering it here', async () => {
    const { fetch } = api();
    renderInWorld(
      <>
        <WorldHome />
        <Probe />
      </>,
      { fetch, ontology },
    );
    const box = await screen.findByRole('textbox', {
      name: 'Ask Testland a question',
    });
    await userEvent.type(box, 'Who holds the Lantern Road?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByTestId('panel')).toHaveTextContent(
      'ask:open:Who holds the Lantern Road?',
    );
    // The box is cleared, so the same question is not asked twice by accident.
    expect(box).toHaveValue('');
  });

  it('asks a suggestion the moment it is chosen', async () => {
    const { fetch } = api();
    renderInWorld(
      <>
        <WorldHome />
        <Probe />
      </>,
      { fetch, ontology },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Who is Wren of the Ford?' }),
    );
    expect(await screen.findByTestId('panel')).toHaveTextContent(
      'ask:open:Who is Wren of the Ford?',
    );
  });

  it('lists campaigns as cards with a way to start one', async () => {
    const { fetch } = api();
    renderInWorld(<Campaigns />, { fetch, ontology });
    expect(await screen.findByText('The Lantern Road')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New campaign/ })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/campaign/new`,
    );
  });
});
