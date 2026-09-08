import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { MapPage } from 'src/pages/Map';
import {
  cellAt,
  cellAtLatLng,
  centerOf,
  contains,
  parseCell,
} from 'src/schema/cells';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fake, reset } from './fixtures/leaflet';
import { fakeFetch, renderInWorld } from './helpers';

vi.mock('leaflet', () => import('./fixtures/leaflet'));

/** An invented model with a cell field, the way a place has one. */
const stored: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  name: { type: 'string' },
  description: { type: 'string' },
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
const hamlet = cellAt(2, 5 * 64 + 7, 9 * 64 + 3, 12);
const camps = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'The Valley',
    description: 'A green valley.',
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
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    name: 'Tiny Hamlet',
    spot: hamlet.token,
  },
  { id: 'a0000000-0000-4000-8000-000000000005', name: 'Nowhere Camp' },
];

/** The API's answer to a list: what is inside the cell, down to the level asked. */
function listed(request: Request) {
  const url = new URL(request.url);
  const cell = parseCell(url.searchParams.get('cell'));
  const maxLevel = Number(url.searchParams.get('maxLevel') ?? 30);
  return {
    resources: camps.filter((c) => {
      const spot = parseCell(c.spot);
      if (!spot) return false;
      if (cell && !contains(cell, spot)) return false;
      return spot.level <= maxLevel;
    }),
  };
}

function renderMap(path = `/worlds/${WORLD_ID}/map`) {
  const { fetch, calls } = fakeFetch({
    ...Object.fromEntries(
      camps.map((camp) => [
        `GET /v1/worlds/${WORLD_ID}/camp/${camp.id}`,
        () => camp,
      ]),
    ),
    ...Object.fromEntries(
      camps.map((camp) => [
        `PATCH /v1/worlds/${WORLD_ID}/camp/${camp.id}`,
        async (request: Request) => ({
          ...camp,
          ...((await request.json()) as Record<string, unknown>),
        }),
      ]),
    ),
    [`GET /v1/worlds/${WORLD_ID}/world/${WORLD_ID}`]: () => ({
      id: WORLD_ID,
      name: 'Testland',
    }),
    [`GET /v1/worlds/${WORLD_ID}/camp`]: listed,
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

/** The map, once the page has made it, looking at the valley from a given zoom. */
async function mapAt(zoom: number) {
  await waitFor(() => expect(fake.map).toBeDefined());
  const map = fake.map!;
  const centre = centerOf(valley);
  map.bounds = {
    north: centre.lat + 4,
    south: centre.lat - 4,
    east: centre.lng + 6,
    west: centre.lng - 6,
  };
  map.center = centre;
  map.zoom = zoom;
  map.fire('moveend', undefined);
  return map;
}

describe('the map', () => {
  beforeEach(reset);

  it('fetches the cells under the view down to a level worth drawing, and lists what it finds', async () => {
    const { calls } = renderMap();
    await mapAt(4);
    const list = await screen.findByRole('heading', { name: 'In view' });
    const aside = list.parentElement!;
    await within(aside).findByText('The Valley');
    expect(within(aside).getByText('North Camp')).toBeInTheDocument();
    // Four levels below a tile-sized cell is as fine as zoom 4 draws: level 8.
    expect(within(aside).queryByText('Tiny Hamlet')).not.toBeInTheDocument();
    const asked = () =>
      calls
        .filter((c) => c.url.includes('/camp?'))
        .map((c) => new URL(c.url).searchParams);
    // Every request is bounded by a cell and a level: the sample cells down
    // to level 8, and their faces for what is coarser than the samples.
    await waitFor(() =>
      expect(asked().some((q) => Number(q.get('maxLevel')) < 8)).toBe(true),
    );
    expect(asked().every((q) => q.has('cell') && q.has('maxLevel'))).toBe(true);
    expect(asked().some((q) => q.get('maxLevel') === '8')).toBe(true);
    // A model without a cell field is not asked; only camps sit on the map.
    expect(calls.some((c) => c.url.includes('/song'))).toBe(false);
  });

  it('draws a coarse cell as its outline and a fine one as a mark, each labelled', async () => {
    renderMap();
    await mapAt(4);
    await waitFor(() =>
      expect(fake.layers.map((l) => l.tooltip)).toContain('The Valley'),
    );
    const byName = Object.fromEntries(fake.layers.map((l) => [l.tooltip, l]));
    expect(byName['The Valley']!.kind).toBe('polygon');
    expect(byName['North Camp']!.kind).toBe('marker');
  });

  it('opens a short account of a record from its mark, with the way to the whole of it', async () => {
    renderMap();
    await mapAt(4);
    await waitFor(() =>
      expect(fake.layers.map((l) => l.tooltip)).toContain('The Valley'),
    );
    const valleyLayer = fake.layers.find((l) => l.tooltip === 'The Valley')!;
    valleyLayer.handlers.click!({ latlng: centerOf(valley) });
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('A green valley.')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('link', { name: 'Learn more' }),
    ).toHaveAttribute('href', `/worlds/${WORLD_ID}/camp/${camps[0]!.id}`);
  });

  it('places a record brought to it at the cell under the click, as fine as the zoom', async () => {
    const nowhere = camps[4]!;
    const { calls } = renderMap(
      `/worlds/${WORLD_ID}/map?place=camp/${nowhere.id}`,
    );
    const map = await mapAt(4);
    await screen.findByText('Placing Nowhere Camp');
    const at = { lat: 20.5, lng: -30.25 };
    map.fire('click', { latlng: at });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true),
    );
    const patched = calls.find((c) => c.method === 'PATCH')!;
    expect(patched.url).toContain(`/camp/${nowhere.id}`);
    expect(await patched.json()).toEqual({ spot: cellAtLatLng(at, 8).token });
    await screen.findByText('Nowhere Camp is on the map.');
    await waitFor(() =>
      expect(
        screen.queryByText('Placing Nowhere Camp'),
      ).not.toBeInTheDocument(),
    );
  });

  it('finds a record by name and flies to it', async () => {
    const user = userEvent.setup();
    const { fetch } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/$search`]: () => ({
        results: [
          {
            model: 'camp',
            id: camps[1]!.id,
            name: 'North Camp',
            canonStatus: 'canon',
          },
        ],
      }),
      [`GET /v1/worlds/${WORLD_ID}/camp/${camps[1]!.id}`]: () => camps[1],
      [`GET /v1/worlds/${WORLD_ID}/world/${WORLD_ID}`]: () => ({
        id: WORLD_ID,
      }),
      [`GET /v1/worlds/${WORLD_ID}/camp`]: listed,
    });
    renderInWorld(<MapPage />, {
      fetch,
      ontology,
      path: `/worlds/${WORLD_ID}/map`,
      route: '/worlds/:world/map',
    });
    const map = await mapAt(2);
    await user.type(screen.getByLabelText('Find on the map'), 'North{enter}');
    await user.click(await screen.findByRole('button', { name: 'North Camp' }));
    await waitFor(() => expect(map.zoom).toBe(11));
    const centre = centerOf(north);
    expect(map.center.lat).toBeCloseTo(centre.lat, 5);
    expect(await screen.findByRole('dialog')).toHaveTextContent('North Camp');
  });
});
