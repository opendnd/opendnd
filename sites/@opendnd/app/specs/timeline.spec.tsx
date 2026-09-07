import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { Timeline } from 'src/pages/Timeline';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';

const base: Record<string, JsonSchema> = {
  id: { type: 'string', format: 'uuid', readOnly: true },
  name: { type: 'string' },
};
const models: ModelInfo[] = [
  {
    id: 'happening',
    name: 'Happening',
    validTime: { begin: 'when.begin', end: 'when.end' },
  },
  { id: 'reading', name: 'Reading', validTime: { begin: 'at' } },
  { id: 'note', name: 'Note' },
];
const schemas = Object.fromEntries(
  models.flatMap((m) => [
    [m.id, { type: 'object', properties: base, required: ['id'] }],
    [`${m.id}Input`, { type: 'object', properties: { name: base.name! } }],
  ]),
);
const ontology = ontologyFrom({ components: { schemas } }, models, []);

const at = (year: number, end?: number) => ({
  validTime: {
    begin: { trs: 'c', year },
    ...(end ? { end: { trs: 'c', year: end } } : {}),
  },
});
const happenings = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'A coronation',
    ...at(1000),
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'A long war',
    ...at(1004, 1012),
  },
  { id: 'b0000000-0000-4000-8000-000000000003', name: 'A birth', ...at(1004) },
];
const readings = [
  { id: 'b0000000-0000-4000-8000-000000000011', name: 'A census', ...at(1002) },
];

function renderTimeline(path = `/worlds/${WORLD_ID}/timeline`) {
  const { fetch, calls } = fakeFetch({
    [`GET /v1/worlds/${WORLD_ID}/happening`]: (request) => {
      const q = new URL(request.url).searchParams;
      const from = q.get('from') ? Number(q.get('from')) : -Infinity;
      const to = q.get('to') ? Number(q.get('to')) : Infinity;
      return {
        resources: happenings.filter(
          (h) =>
            h.validTime.begin.year <= to &&
            (h.validTime.end?.year ?? h.validTime.begin.year) >= from,
        ),
      };
    },
    [`GET /v1/worlds/${WORLD_ID}/reading`]: () => ({ resources: readings }),
    [`GET /v1/worlds/${WORLD_ID}/note`]: () => ({ resources: [] }),
  });
  return {
    calls,
    ...renderInWorld(<Timeline />, {
      fetch,
      ontology,
      path,
      route: '/worlds/:world/timeline',
    }),
  };
}

describe('the timeline', () => {
  it('starts with what begins and ends, ordered by year and grouped, each span with its end', async () => {
    const { calls } = renderTimeline();
    expect(await screen.findByText('A coronation')).toBeInTheDocument();
    // Besides the world's own record, only the model with a beginning and an
    // end is asked for.
    const asked = calls.filter(
      (c) => c.url.includes('/v1/worlds/') && !c.url.includes('/world/'),
    );
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!.url).searchParams.get('sort')).toBe('validTime');
    expect(asked[0]!.url).toContain('/happening');

    const years = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(years).toEqual(['1000', '1004']);
    const year1004 = within(
      screen.getByRole('heading', { level: 2, name: '1004' }).closest('li')!,
    );
    expect(year1004.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'A birth',
      'A long war',
    ]);
    expect(year1004.getByText('until 1012')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Happening' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Reading' })).not.toBeChecked();
  });

  it('adds a model when it is ticked and narrows to a span of years', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderTimeline();
    await screen.findByText('A coronation');
    await user.click(screen.getByRole('checkbox', { name: 'Reading' }));
    expect(await screen.findByText('A census')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?models=happening%2Creading');

    await user.clear(screen.getByLabelText('From year'));
    await user.type(screen.getByLabelText('From year'), '1003');
    await user.type(screen.getByLabelText('To year'), '1010');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() =>
      expect(screen.queryByText('A coronation')).not.toBeInTheDocument(),
    );
    const asked = calls.filter((c) => c.url.includes('/happening'));
    const last = asked[asked.length - 1]!;
    const q = new URL(last.url).searchParams;
    expect([q.get('from'), q.get('to')]).toEqual(['1003', '1010']);
    expect(screen.getByText('A long war')).toBeInTheDocument();
  });

  it('opens on the span it is given', async () => {
    renderTimeline(`/worlds/${WORLD_ID}/timeline?from=1000&to=1001`);
    expect(await screen.findByText('A coronation')).toBeInTheDocument();
    expect(screen.queryByText('A long war')).not.toBeInTheDocument();
    expect(screen.getByLabelText('From year')).toHaveValue(1000);
    expect(
      screen.getByRole('button', { name: 'All years' }),
    ).toBeInTheDocument();
  });

  it('marks the world’s now among the years and lets an editor move it', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/happening`]: () => ({
        resources: happenings,
      }),
      [`GET /v1/worlds/${WORLD_ID}/world/${WORLD_ID}`]: () =>
        Response.json(
          {
            id: WORLD_ID,
            name: 'Testland',
            standing: { trs: 'c', year: 1002 },
          },
          { headers: { etag: '"3"' } },
        ),
      [`PATCH /v1/worlds/${WORLD_ID}/world/${WORLD_ID}`]: async (request) => ({
        id: WORLD_ID,
        ...((await request.json()) as Record<string, unknown>),
      }),
    });
    renderInWorld(<Timeline />, {
      fetch,
      ontology,
      route: '/worlds/:world/timeline',
      path: `/worlds/${WORLD_ID}/timeline`,
    });
    expect(await screen.findByText('Now: 1002')).toBeInTheDocument();
    const years = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(years).toEqual(['1000', '1002now', '1004']);

    await user.clear(screen.getByLabelText('Move now to'));
    await user.type(screen.getByLabelText('Move now to'), '1010');
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true),
    );
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers.get('if-match')).toBe('"3"');
    expect(await patch.json()).toEqual({ standing: { trs: 'c', year: 1010 } });
  });
});
