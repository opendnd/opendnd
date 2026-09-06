import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transfer, summarise } from 'src/components/Transfer';
import { WORLD_ID } from './fixtures/ontology';
import { fakeFetch, renderInWorld, testWorld } from './helpers';

const bundle = {
  resourceType: 'Bundle',
  type: 'collection',
  total: 3,
  entry: [
    { model: 'pet', resource: { id: 'a', name: 'Biscuit' } },
    { model: 'pet', resource: { id: 'b', name: 'Crumb' } },
    { model: 'person', resource: { id: 'c', name: 'Ada' } },
  ],
};

describe('taking a world with you', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exports the world as a bundle, with the caller’s token, and hands the browser the file', async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { fetch, calls } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/$export/json`]: () =>
        new Response(JSON.stringify(bundle), {
          headers: { 'content-type': 'application/json' },
        }),
    });
    renderInWorld(<Transfer />, { fetch });

    await user.click(
      screen.getByRole('button', { name: 'Export as a bundle' }),
    );
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const request = calls.find((c) => c.url.includes('$export/json'))!;
    expect(request.headers.get('authorization')).toBe('Bearer dev:tester');
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe(`world-${WORLD_ID.slice(0, 8)}.json`);
  });

  it('shows what a chosen file holds, by kind, and imports it as it is', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch({
      [`POST /v1/worlds/${WORLD_ID}/$import`]: () =>
        Response.json({ imported: 3, world: WORLD_ID }, { status: 201 }),
    });
    renderInWorld(<Transfer />, { fetch });

    const file = new File([JSON.stringify(bundle)], 'aerath.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('Import a bundle'), file);
    expect(
      await screen.findByText('3 resources to import'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 pet')).toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Import 3 resources' }),
    );
    const request = calls.find((c) => c.url.includes('$import'))!;
    expect(await request.json()).toEqual(bundle);
    expect(await screen.findByText('Imported 3 resources')).toBeInTheDocument();
  });

  it('refuses a file that is not a bundle, before asking the API', async () => {
    const user = userEvent.setup();
    const { fetch, calls } = fakeFetch();
    renderInWorld(<Transfer />, { fetch });
    await user.upload(
      screen.getByLabelText('Import a bundle'),
      new File(['{"hello": "world"}'], 'nope.json', {
        type: 'application/json',
      }),
    );
    expect(
      await screen.findByText('That file is not a bundle'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('$import'))).toBe(false);
  });

  it('leaves import to editors', () => {
    renderInWorld(<Transfer />, { world: { ...testWorld, role: 'viewer' } });
    expect(
      screen.getByRole('button', { name: 'Export as a bundle' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Import a bundle')).not.toBeInTheDocument();
  });

  it('counts a plain list and a resources list too', () => {
    expect(summarise([{ model: 'pet' }, { model: 'pet' }]).total).toBe(2);
    expect(
      summarise({ resources: [{ model: 'person', resource: {} }] }).counts.get(
        'person',
      ),
    ).toBe(1);
    expect(() => summarise({ hello: 'world' })).toThrow(/expected a bundle/);
  });
});
