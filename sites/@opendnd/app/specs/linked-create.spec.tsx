import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Edit } from 'src/pages/Edit';
import { WORLD_ID } from './fixtures/ontology';
import {
  SHOW_ID,
  TROUPE_ID,
  storedShow,
  storedTroupe,
  troupeOntology,
} from './fixtures/troupe';
import { fakeFetch, renderInWorld } from './helpers';

const NEW_ID = '99999999-9999-4999-8999-999999999999';

describe('making a record from another’s page', () => {
  it('links the new record back into the field it came from, then returns there', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/show/${SHOW_ID}`]: () =>
        Response.json(storedShow, { headers: { etag: '"1"' } }),
      [`POST /v1/worlds/${WORLD_ID}/happening`]: async (request) => {
        const body = (await request.json()) as Record<string, unknown>;
        return Response.json(
          { ...body, id: NEW_ID, model: 'happening', world: WORLD_ID },
          { status: 201 },
        );
      },
      [`PUT /v1/worlds/${WORLD_ID}/show/${SHOW_ID}`]: async (request) =>
        Response.json(await request.json(), { headers: { etag: '"2"' } }),
    });
    const { router } = renderInWorld(<Edit />, {
      fetch,
      ontology: troupeOntology(),
      route: '/worlds/:world/:model/new',
      path: `/worlds/${WORLD_ID}/happening/new?ref=show/${SHOW_ID}&link=produced`,
    });

    expect(
      await screen.findByRole('heading', { name: 'New happening' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Opening Night' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/show/${SHOW_ID}`,
    );

    await user.type(await screen.findByLabelText(/^Name/), 'A bow');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/worlds/${WORLD_ID}/show/${SHOW_ID}`,
      ),
    );
    const created = calls.find((c) => c.method === 'POST')!;
    expect(await created.json()).toEqual({ name: 'A bow' });
    const linked = calls.find((c) => c.method === 'PUT')!;
    expect(linked.headers.get('if-match')).toBe('"1"');
    const body = (await linked.json()) as { produced: unknown[] };
    expect(body.produced).toEqual([
      ...storedShow.produced,
      { model: 'happening', id: NEW_ID, name: 'A bow' },
    ]);
  });

  it('fills the field that points back at the record it came from', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/troupe/${TROUPE_ID}`]: () => storedTroupe,
      [`POST /v1/worlds/${WORLD_ID}/show`]: async (request) =>
        Response.json(
          { ...(await request.json()), id: NEW_ID, model: 'show' },
          { status: 201 },
        ),
    });
    const { router } = renderInWorld(<Edit />, {
      fetch,
      ontology: troupeOntology(),
      route: '/worlds/:world/:model/new',
      path: `/worlds/${WORLD_ID}/show/new?ref=troupe/${TROUPE_ID}&set=troupe`,
    });

    // The picker already holds the troupe, beside the note of what this is linked to.
    await screen.findByLabelText(/^Name/);
    expect(
      screen.getAllByRole('link', { name: 'The Lantern Players' }),
    ).toHaveLength(2);
    await user.type(screen.getByLabelText(/^Name/), 'Third Night');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const created = calls.find((c) => c.method === 'POST')!;
    expect(await created.json()).toEqual({
      name: 'Third Night',
      troupe: { model: 'troupe', id: TROUPE_ID, name: 'The Lantern Players' },
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/worlds/${WORLD_ID}/troupe/${TROUPE_ID}`,
      ),
    );
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
