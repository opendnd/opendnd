import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { MapPage } from 'src/pages/Map';
import { cellAt, contains, parseCell } from 'src/schema/cells';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';

/** An invented model with a cell field, the way a place has one. */
const stored: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  name: { type: 'string' },
  spot: { type: 'string', pattern: '^[0-9a-f]{1,16}$' },
};
const models: ModelInfo[] = [
  { id: 'camp', name: 'Camp' },
  { id: 'song', name: 'Song' },
];
const ontology = ontologyFrom(
  {
    components: {
      schemas: {
        camp: { type: 'object', properties: stored, required: ['id'] },
        campInput: {
          type: 'object',
          properties: { name: stored.name!, spot: stored.spot! },
        },
        song: {
          type: 'object',
          properties: { id: stored.id!, name: stored.name! },
        },
        songInput: { type: 'object', properties: { name: stored.name! } },
      },
    },
  },
  models,
  [],
);

const valley = cellAt(2, 5, 9, 6);
const north = cellAt(2, 5 * 4 + 1, 9 * 4 + 0, 8);
const south = cellAt(2, 5 * 4 + 2, 9 * 4 + 3, 8);
const camps = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'The Valley',
    spot: valley.token,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'North Camp',
    spot: north.token,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    name: 'South Camp',
    spot: south.token,
  },
  { id: 'a0000000-0000-4000-8000-000000000004', name: 'Nowhere Camp' },
  {
    id: 'a0000000-0000-4000-8000-000000000005',
    name: 'Lost Camp',
    within: { model: 'camp', id: 'a0000000-0000-4000-8000-000000000001' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000006',
    name: 'Stray Camp',
    within: { model: 'camp', id: 'a0000000-0000-4000-8000-000000000001' },
  },
];

function renderMap(path = `/worlds/${WORLD_ID}/map`) {
  const { fetch, calls } = fakeFetch({
    ...Object.fromEntries(
      camps.map((camp) => [
        `PATCH /v1/worlds/${WORLD_ID}/camp/${camp.id}`,
        async (request: Request) => ({
          ...camp,
          ...((await request.json()) as Record<string, unknown>),
        }),
      ]),
    ),
    [`GET /v1/worlds/${WORLD_ID}/camp/${camps[0]!.id}/references`]: () => ({
      references: camps
        .filter((c) => 'within' in c)
        .map((resource) => ({ model: 'camp', resource })),
    }),
    [`GET /v1/worlds/${WORLD_ID}/camp`]: (request) => {
      const cell = new URL(request.url).searchParams.get('cell');
      return {
        resources: cell
          ? camps.filter((c) => c.spot?.startsWith(cell.slice(0, 2)))
          : camps,
      };
    },
  });
  return {
    calls,
    ...renderInWorld(<MapPage />, {
      fetch,
      ontology,
      path,
      route: '/worlds/:world/map',
    }),
  };
}

describe('the map', () => {
  it('draws every placed record inside the smallest cell that holds them, and lists the rest', async () => {
    const { calls } = renderMap();
    const map = await screen.findByRole('img', { name: 'Map of The Valley' });
    // Only the model with a cell field is asked for.
    expect(calls.some((c) => c.url.includes('/song'))).toBe(false);
    const north1 = within(map).getByTestId(`cell-${camps[1]!.id}`);
    const rect = north1.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('250');
    expect(rect.getAttribute('y')).toBe('0');
    expect(rect.getAttribute('width')).toBe('250');
    expect(screen.getByText('Level 6')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Nowhere Camp' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open camp' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/camp/${camps[0]!.id}`,
    );
  });

  it('looks into a cell that holds others, and previews a record that holds none', async () => {
    const user = userEvent.setup();
    renderMap();
    await screen.findByRole('img', { name: 'Map of The Valley' });
    await user.click(screen.getByRole('button', { name: 'South Camp' }));
    // A record with nothing inside opens beside the map, with the way to its page.
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('South Camp')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('link', { name: 'Learn more' }),
    ).toHaveAttribute('href', `/worlds/${WORLD_ID}/camp/${camps[2]!.id}`);
  });

  it('opens on the cell it is given and can step out of it', async () => {
    const user = userEvent.setup();
    const { router } = renderMap(`/worlds/${WORLD_ID}/map?cell=${north.token}`);
    await screen.findByRole('img', { name: 'Map of North Camp' });
    await user.click(screen.getByRole('button', { name: 'Out' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?cell=${cellAt(2, 5 * 2 + 0, 9 * 2 + 0, 7).token}`,
      ),
    );
  });

  it('places a record from the list by choosing a square of the grid', async () => {
    const user = userEvent.setup();
    const { calls } = renderMap();
    await screen.findByRole('img', { name: 'Map of The Valley' });
    await user.click(
      screen.getByRole('button', { name: 'Place Nowhere Camp' }),
    );
    expect(screen.getByText(/Placing Nowhere Camp/)).toBeInTheDocument();
    // Two levels below the view by default: a four-by-four grid.
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(16);
    await user.click(screen.getByRole('button', { name: 'Finer grid' }));
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(64);
    await user.click(screen.getByRole('button', { name: 'Coarser grid' }));

    const slot = cellAt(2, 5 * 4 + 1, 9 * 4 + 2, 8);
    await user.click(screen.getByTestId(`slot-${slot.token}`));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true),
    );
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain(`/camp/${camps[3]!.id}`);
    expect(await patch.json()).toEqual({ spot: slot.token });
  });

  it('places everything unplaced that refers to the record in view, inside it', async () => {
    const user = userEvent.setup();
    const { calls } = renderMap();
    await screen.findByRole('img', { name: 'Map of The Valley' });
    await user.click(
      screen.getByRole('button', { name: 'Place 2 inside The Valley' }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2),
    );
    const tokens = await Promise.all(
      calls
        .filter((c) => c.method === 'PATCH')
        .map(async (c) => ((await c.json()) as { spot: string }).spot),
    );
    expect(new Set(tokens).size).toBe(2);
    for (const token of tokens) {
      const cell = parseCell(token)!;
      expect(contains(valley, cell)).toBe(true);
      expect(cell.level).toBe(8);
    }
  });

  it('finds what waits to be placed inside the record in view by what refers to it', async () => {
    const user = userEvent.setup();
    const { calls } = renderMap(`/worlds/${WORLD_ID}/map?cell=${valley.token}`);
    await screen.findByRole('img', { name: 'Map of The Valley' });
    await user.click(
      await screen.findByRole('button', { name: 'Place 2 inside The Valley' }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2),
    );
    expect(
      calls.some((c) => c.url.endsWith(`/camp/${camps[0]!.id}/references`)),
    ).toBe(true);
  });
});
