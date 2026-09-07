import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { WorldHome } from 'src/pages/WorldHome';
import { Campaigns } from 'src/pages/Campaigns';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';

/** An ontology with the models the home page's surfaces stand on. */
const base: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  name: { type: 'string' },
  description: { type: 'string' },
  status: { type: 'string', enum: ['running', 'finished'] },
  setting: {
    type: 'object',
    properties: {
      model: { const: 'place' },
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
const recorded = (updatedAt: string) => ({
  createdAt: updatedAt,
  updatedAt,
  revision: 1,
});
const campaigns = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    name: 'The Lantern Road',
    status: 'running',
    description: 'A road, a lantern, a long night.',
    setting: { model: 'place', id: 'p1', name: 'Aldermere' },
    recorded: recorded('2026-09-06T10:00:00Z'),
  },
];

function api() {
  return fakeFetch({
    [`GET /v1/worlds/${WORLD_ID}/campaign`]: () => ({ resources: campaigns }),
    [`GET /v1/worlds/${WORLD_ID}/character`]: () => ({ resources: [] }),
    [`GET /v1/worlds/${WORLD_ID}/work`]: () => ({
      resources: [
        {
          id: 'w1',
          name: 'A chronicle',
          recorded: recorded('2026-09-07T10:00:00Z'),
        },
      ],
      next: 'more',
    }),
  });
}

describe('a world’s home', () => {
  it('greets, counts what the surfaces hold, and shows the campaigns and what changed last', async () => {
    const { fetch } = api();
    renderInWorld(<WorldHome />, { fetch, ontology });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /Good (morning|afternoon|evening|night), tester\. Testland is open\./,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();
    // Five hundred or more reads as a floor, not a count.
    expect(await screen.findByText('1+')).toBeInTheDocument();
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
