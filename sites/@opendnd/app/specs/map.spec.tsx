import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import {
  MapPage,
  atlasZoom,
  cityLabelAt,
  onMap,
  overlaps,
  politicalLabelAt,
  roomFor,
  slideInside,
} from 'src/pages/Map';
import {
  cellAt,
  cellAtLatLng,
  centerOf,
  contains,
  parseCell,
} from 'src/schema/cells';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fake, reset } from './fixtures/maplibre';
import { fakeFetch, renderInWorld } from './helpers';

vi.mock('maplibre-gl', () => import('./fixtures/maplibre'));

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
const remote = cellAt(4, 5 * 4 + 1, 9 * 4 + 1, 8);
const camps = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'The Valley',
    description: 'A green valley.',
    spot: valley.token,
    // Four fine cells inside the valley, so it holds ground for the
    // political layer to colour and roll up.
    extent: [
      cellAt(2, 5 * 16, 9 * 16, 10).token,
      cellAt(2, 5 * 16 + 1, 9 * 16, 10).token,
      cellAt(2, 5 * 16, 9 * 16 + 1, 10).token,
      cellAt(2, 5 * 16 + 1, 9 * 16 + 1, 10).token,
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'North Camp',
    type: 'kingdom',
    spot: north.token,
    // Ground of its own, against the valley's eastern side, so the two have
    // a border between them and not only a coast.
    extent: [
      cellAt(2, 5 * 16 + 2, 9 * 16, 10).token,
      cellAt(2, 5 * 16 + 2, 9 * 16 + 1, 10).token,
    ],
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
  {
    id: 'a0000000-0000-4000-8000-000000000006',
    name: 'Remote Crown',
    type: 'kingdom',
    // Its seat is far away, but its held ground is in this view. The census,
    // not the sampled seat query, is what must put it in the list.
    spot: remote.token,
    extent: [cellAt(2, 5 * 16 + 3, 9 * 16, 10).token],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000007',
    name: 'Harbour Town',
    type: 'city',
    // A city is a seat, not a country: no ground of its own to colour.
    spot: cellAt(2, 5 * 4 + 1, 9 * 4 + 2, 8).token,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000008',
    name: 'CE<DUR/ANV',
    type: 'kingdom',
    // A border tick the recogniser treated as a country. It must not be
    // named, and its ground is folded into a real neighbour.
    spot: cellAt(2, 5 * 4 + 2, 9 * 4 + 1, 8).token,
    extent: [cellAt(2, 5 * 16 + 2, 9 * 16 + 2, 10).token],
  },
];

/** The API's answer to a list: what is inside the cell, down to the level asked. */
function listed(request: Request) {
  const url = new URL(request.url);
  const cell = parseCell(url.searchParams.get('cell'));
  // `covers` is the other question: not what is inside this square, but what
  // this square is inside.
  const covers = parseCell(url.searchParams.get('covers'));
  const maxLevel = Number(url.searchParams.get('maxLevel') ?? 30);
  return {
    resources: camps.filter((c) => {
      const spot = parseCell(c.spot);
      if (!spot) return false;
      if (cell && !contains(cell, spot)) return false;
      if (covers && !contains(spot, covers)) return false;
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
      map: { source: 'terrain' },
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

  it('draws one globe rather than repeating a flat world', async () => {
    renderMap();
    await mapAt(0);
    const style = fake.map!.options.style as {
      projection?: { type?: string };
      sources?: { world?: { tiles?: string[] } };
    };
    expect(style.projection?.type).toBe('globe');
    expect(style.sources?.world?.tiles?.[0]).toContain('terrain=1');
    expect(fake.map!.options.renderWorldCopies).toBe(false);
  });

  it('opens the painted political map beside the held ground so they share one camera', async () => {
    renderMap(`/worlds/${WORLD_ID}/map?compare=1`);
    await mapAt(3);
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(screen.getByLabelText('Original political map')).toBeInTheDocument();
    expect(screen.getByText('Original map')).toBeInTheDocument();
    expect(screen.getByText('Held ground')).toBeInTheDocument();
    const [held, art] = fake.maps;
    const heldTiles = (
      held!.options.style as { sources?: { world?: { tiles?: string[] } } }
    ).sources?.world?.tiles?.[0];
    const artTiles = (
      art!.options.style as { sources?: { world?: { tiles?: string[] } } }
    ).sources?.world?.tiles?.[0];
    expect(heldTiles).toContain('terrain=1');
    expect(artTiles).not.toContain('terrain=1');
    expect(held!.getSource('political-ground')).toBeDefined();
    expect(art!.getSource('political-ground')).toBeUndefined();
    held!.center = { lat: 12, lng: 34 };
    held!.zoom = 5;
    held!.fire('move', undefined);
    expect(art!.center).toEqual({ lat: 12, lng: 34 });
    expect(art!.zoom).toBe(5);
  });

  it('turns the split on from the chrome', async () => {
    const user = userEvent.setup();
    renderMap();
    await mapAt(3);
    expect(fake.maps).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('names continents while zoomed out and kingdoms while zoomed in', () => {
    expect(politicalLabelAt('continent', 2)).toBe(true);
    expect(politicalLabelAt('kingdom', 2)).toBe(false);
    // A continent's name is of no use once a country fills the screen, so
    // the two change places as early as the third step in.
    expect(politicalLabelAt('continent', 3)).toBe(false);
    expect(politicalLabelAt('kingdom', 3)).toBe(true);
    // The chrome rounds, so 2.6 is already the zoom that says "3".
    expect(atlasZoom(2.6)).toBe(3);
    expect(politicalLabelAt('continent', 2.6)).toBe(false);
    expect(politicalLabelAt('kingdom', 2.6)).toBe(true);
    expect(politicalLabelAt('city', 6)).toBeUndefined();
    expect(cityLabelAt('city', 2)).toBe(false);
    expect(cityLabelAt('city', 3)).toBe(true);
    expect(cityLabelAt('kingdom', 3)).toBe(false);
    expect(onMap({ x: 10, y: 10 }, { width: 100, height: 80 })).toBe(true);
    expect(onMap({ x: -1, y: 10 }, { width: 100, height: 80 })).toBe(false);
    expect(onMap({ x: 10, y: 90 }, { width: 100, height: 80 })).toBe(false);
  });

  it('keeps a name clear of the width of another name, not just its middle', () => {
    const one = roomFor('MOSHEDWOM', { x: 200, y: 100 });
    const beside = roomFor('DRINDERMOK', { x: 260, y: 100 });
    const away = roomFor('DRINDERMOK', { x: 500, y: 100 });
    const below = roomFor('DRINDERMOK', { x: 260, y: 160 });
    expect(overlaps(one, beside)).toBe(true);
    expect(overlaps(one, away)).toBe(false);
    expect(overlaps(one, below)).toBe(false);
    // A mark is a dot, and takes only a dot's room.
    expect(
      overlaps(
        roomFor(undefined, { x: 200, y: 100 }),
        roomFor(undefined, { x: 260, y: 100 }),
      ),
    ).toBe(false);
  });

  it('slides a name off the edge that would cut it, and leaves a mark alone', () => {
    const pane = { width: 640, height: 400 };
    /*
     * A country whose seat is a few letters from the right edge: its anchor
     * is on the map, so nothing before this caught it, and its name was
     * drawn ALDERM.
     */
    const cut = roomFor('ALDERMARCH', { x: 620, y: 100 });
    const slide = slideInside(cut, pane);
    expect(slide.x).toBeLessThan(0);
    expect(cut.right + slide.x).toBeCloseTo(pane.width);
    // Slid exactly far enough to be read, and no further.
    expect(cut.left + slide.x).toBeGreaterThan(0);

    // The left edge is the same fault the other way round: MEREHOLT as REHOLT.
    const left = roomFor('MEREHOLT', { x: 6, y: 100 });
    expect(left.left + slideInside(left, pane).x).toBeCloseTo(0);

    // A name already clear of both edges is not moved at all.
    const clear = roomFor('CANTLOW', { x: 320, y: 200 });
    expect(slideInside(clear, pane)).toEqual({ x: 0, y: 0 });

    // A name wider than the pane has nowhere to go, so it stays put rather
    // than being shunted about to no purpose.
    expect(
      slideInside(roomFor('CANTLOW', { x: 30, y: 100 }), {
        width: 40,
        height: 400,
      }).x,
    ).toBe(0);
  });

  it('fetches the cells under the view down to a level worth drawing, and lists what it finds', async () => {
    const { calls } = renderMap();
    await mapAt(4);
    // The list is over the map rather than beside it, and opens when asked.
    const open = await screen.findByRole('button', { name: /in view/ });
    await userEvent.click(open);
    const list = screen.getByRole('list', { name: 'In view' });
    await within(list).findByText('The Valley');
    expect(within(list).getByText('North Camp')).toBeInTheDocument();
    expect(within(list).getByText('Remote Crown')).toBeInTheDocument();
    expect(within(list).queryByText('CE<DUR/ANV')).not.toBeInTheDocument();
    // Four levels below a tile-sized cell is as fine as zoom 4 draws: level 8.
    expect(within(list).queryByText('Tiny Hamlet')).not.toBeInTheDocument();
    const asked = () =>
      calls
        .filter((c) => c.url.includes('/camp?'))
        .map((c) => new URL(c.url).searchParams);
    // Two questions per sampled square, and a third of the whole layer so
    // the political fill is not missing a country whose seat is off-screen.
    await waitFor(() => expect(asked().length).toBeGreaterThan(1));
    expect(
      asked().every(
        (q) =>
          (q.has('cell') && q.has('maxLevel')) ||
          q.has('covers') ||
          (!q.has('cell') && !q.has('covers')),
      ),
    ).toBe(true);
    expect(asked().some((q) => q.get('maxLevel') === '8')).toBe(true);
    expect(asked().some((q) => q.has('covers'))).toBe(true);
    expect(asked().some((q) => !q.has('cell') && !q.has('covers'))).toBe(true);
    // A model without a cell field is not asked; only camps sit on the map.
    expect(calls.some((c) => c.url.includes('/song'))).toBe(false);
  });

  it('writes a big place across the map and marks a small one, each named', async () => {
    renderMap();
    await mapAt(4);
    await waitFor(() =>
      expect(
        fake.markers.map((marker) => marker.element.getAttribute('aria-label')),
      ).toContain('The Valley'),
    );
    const byName = Object.fromEntries(
      fake.markers.map((marker) => [
        marker.element.getAttribute('aria-label'),
        marker,
      ]),
    );
    // A place larger than the view is its name, not a rectangle: the square
    // of a valley's quadtree cell is not the shape of the valley.
    expect(byName['The Valley']!.element.dataset.kind).toBe('name');
    expect(byName['North Camp']!.element.dataset.kind).toBe('name');
    expect(byName['South Camp']!.element.dataset.kind).toBe('marker');
    expect(byName['Harbour Town']!.element.dataset.kind).toBe('marker');
    expect(byName['Harbour Town']!.element.className).toBe('map-mark');
    expect(
      byName['Harbour Town']!.element.querySelector('.map-mark-dot'),
    ).not.toBeNull();
    expect(byName['Harbour Town']!.element.textContent).toContain(
      'Harbour Town',
    );
    expect(byName['CE<DUR/ANV']).toBeUndefined();
    // The shapes that are drawn are the political fill, which is the ground
    // a place holds; none of them is a named place's own cell square.
    const political = fake.map!.sources['political-ground']!.data.features as {
      properties: { color: string };
      geometry: {
        coordinates: [number, number][][][];
      };
    }[];
    expect(political).toHaveLength(3);
    // Feature colours are serialized rather than left as CSS HSL strings.
    expect(
      political.every((feature) =>
        /^#[0-9a-f]{6}$/.test(feature.properties.color),
      ),
    ).toBe(true);
    for (const feature of political) {
      for (const polygon of feature.geometry.coordinates) {
        for (const [index, ring] of polygon.entries()) {
          expect(ring[ring.length - 1]).toEqual(ring[0]);
          const twice = ring.reduce((area, point, at) => {
            const next = ring[(at + 1) % ring.length]!;
            return area + point[0] * next[1] - next[0] * point[1];
          }, 0);
          expect(index === 0 ? twice : -twice).toBeGreaterThan(0);
        }
      }
    }
  });

  it('opens a short account of a record from its mark, with the way to the whole of it', async () => {
    renderMap();
    await mapAt(4);
    await waitFor(() =>
      expect(
        fake.markers.map((marker) => marker.element.getAttribute('aria-label')),
      ).toContain('The Valley'),
    );
    const valleyLayer = fake.markers.find(
      (marker) => marker.element.getAttribute('aria-label') === 'The Valley',
    )!;
    valleyLayer.element.click();
    // A card over the map, not a drawer from the side: the map stays live
    // and the mark you clicked stays where it is.
    const card = await screen.findByRole('group', { name: 'The Valley' });
    expect(within(card).getByText('A green valley.')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/camp/${camps[0]!.id}`,
    );
  });

  it('paints the ground a place holds seamlessly, draws its border, and lets both go', async () => {
    renderMap();
    await waitFor(() =>
      expect(fake.map?.sources['political-ground']).toBeDefined(),
    );
    const filled = fake.map!.sources['political-ground']!;
    await waitFor(() => expect(filled.data.features.length).toBeGreaterThan(0));
    /*
     * The ground is one WebGL layer, faded once by the layer rather than once
     * per cell. A country made of a hundred cells consequently reads as a
     * country rather than a grid.
     */
    const fillLayer = fake.map!.layers.find(
      (layer) => (layer as { id?: string }).id === 'political-fill',
    ) as { paint: { 'fill-opacity': number } };
    expect(fillLayer.paint['fill-opacity']).toBeLessThan(1);

    // The border is a line of its own, above the ground rather than on it.
    expect(
      fake.map!.sources['political-borders']!.data.features.length,
    ).toBeGreaterThan(0);

    // And it is a layer, so it goes away.
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Political/ }));
    await waitFor(() => expect(filled.data.features).toHaveLength(0));
    expect(fake.map!.sources['political-borders']!.data.features).toHaveLength(
      0,
    );
  });

  it('places a record brought to it at the cell under the click, as fine as the zoom', async () => {
    const nowhere = camps[4]!;
    const { calls } = renderMap(
      `/worlds/${WORLD_ID}/map?place=camp/${nowhere.id}`,
    );
    const map = await mapAt(4);
    await screen.findByText('Placing Nowhere Camp');
    const at = { lat: 20.5, lng: -30.25 };
    map.fire('click', { lngLat: at });
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
    const { fetch, calls } = fakeFetch({
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
    await waitFor(() => expect(map.zoom).toBe(6));
    const search = calls.find((call) => call.url.includes('/$search?'))!;
    expect(new URL(search.url).searchParams.get('models')).toBe('camp');
    const centre = centerOf(north);
    expect(map.center.lat).toBeCloseTo(centre.lat, 5);
    expect(
      await screen.findByRole('group', { name: 'North Camp' }),
    ).toBeInTheDocument();
  });
});
