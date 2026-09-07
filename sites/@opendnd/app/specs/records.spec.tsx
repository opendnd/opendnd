import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'src/api/types';
import { Records } from 'src/pages/Records';
import { type JsonSchema, ontologyFrom } from 'src/schema/openapi';
import { WORLD_ID, storedPet } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';

describe('a model’s list', () => {
  it('shows the schema’s first compact fields beside each name', async () => {
    const { fetch } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/pet`]: () => ({ resources: [storedPet] }),
    });
    renderInWorld(<Records />, {
      fetch,
      route: '/worlds/:world/:model',
      path: `/worlds/${WORLD_ID}/pet`,
    });
    expect(
      await screen.findByRole('link', { name: 'Biscuit' }),
    ).toBeInTheDocument();
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Name',
      'Mood',
      'Colour',
      'Legs',
      'Status',
      'Updated',
    ]);
    expect(screen.getByRole('cell', { name: 'Happy' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument();
    // A pet is not dated by the ontology, so it cannot be ordered by time.
    expect(
      screen.queryByRole('option', { name: /In-world time/ }),
    ).not.toBeInTheDocument();
  });

  it('orders a dated model by in-world time when asked', async () => {
    const user = userEvent.setup();
    const models: ModelInfo[] = [
      {
        id: 'happening',
        name: 'Happening',
        validTime: { begin: 'when.begin' },
      },
    ];
    const base: Record<string, JsonSchema> = {
      id: { type: 'string', format: 'uuid', readOnly: true },
      name: { type: 'string' },
      when: {
        type: 'object',
        properties: {
          begin: {
            type: 'object',
            properties: { trs: { type: 'string' }, year: { type: 'integer' } },
          },
        },
      },
    };
    const ontology = ontologyFrom(
      {
        components: {
          schemas: {
            happening: { type: 'object', properties: base, required: ['id'] },
            happeningInput: {
              type: 'object',
              properties: { name: base.name!, when: base.when! },
            },
          },
        },
      },
      models,
      [],
    );
    const { fetch, calls } = fakeFetch({
      [`GET /v1/worlds/${WORLD_ID}/happening`]: () => ({
        resources: [
          {
            id: 'b0000000-0000-4000-8000-000000000001',
            name: 'A coronation',
            when: { begin: { trs: 'c', year: 1000 } },
          },
        ],
      }),
    });
    renderInWorld(<Records />, {
      fetch,
      ontology,
      route: '/worlds/:world/:model',
      path: `/worlds/${WORLD_ID}/happening`,
    });
    expect(
      await screen.findByRole('link', { name: 'A coronation' }),
    ).toBeInTheDocument();
    // The span reads as its year and links to the timeline there.
    expect(screen.getByRole('link', { name: '1000' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/timeline?from=1000&to=1000`,
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Order' }),
      'validTime',
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => new URL(c.url).searchParams.get('sort') === 'validTime',
        ),
      ).toBe(true),
    );
  });
});
