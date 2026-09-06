import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Record } from 'src/pages/Record';
import { WORLD_ID } from './fixtures/ontology';
import {
  TROUPE_ID,
  laterShow,
  storedShow,
  storedTroupe,
  troupeOntology,
} from './fixtures/troupe';
import { fakeFetch, renderInWorld } from './helpers';

function renderTroupe() {
  const { fetch } = fakeFetch({
    [`GET /v1/worlds/${WORLD_ID}/troupe/${TROUPE_ID}`]: () => storedTroupe,
    [`GET /v1/worlds/${WORLD_ID}/troupe/${TROUPE_ID}/references`]: () => ({
      references: [
        { model: 'show', resource: laterShow },
        { model: 'show', resource: storedShow },
      ],
    }),
    [`GET /v1/worlds/${WORLD_ID}/troupe/${TROUPE_ID}/history`]: () => ({
      history: [],
    }),
  });
  return renderInWorld(<Record />, {
    fetch,
    ontology: troupeOntology(),
    route: '/worlds/:world/:model/:id',
    path: `/worlds/${WORLD_ID}/troupe/${TROUPE_ID}`,
  });
}

describe('a record’s page', () => {
  it('lists what links here by kind, saying through which field and when, in date order', async () => {
    renderTroupe();
    const heading = await screen.findByText('What links here');
    const card = within(heading.closest('[data-slot="card"]')!);
    const items = card.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Opening Nightas troupe · played on /),
      expect.stringMatching(/^Second Nightas troupe · played on /),
    ]);
    expect(card.getByRole('link', { name: 'Opening Night' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/show/${storedShow.id}`,
    );
  });

  it('offers to make linked records, with the link in the address', async () => {
    renderTroupe();
    const heading = await screen.findByText('Add a linked record');
    const card = within(heading.closest('[data-slot="card"]')!);
    expect(card.getByRole('link', { name: 'Show' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/show/new?ref=troupe%2F${TROUPE_ID}&set=troupe`,
    );
    expect(card.getByRole('link', { name: 'Player' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/player/new?ref=troupe%2F${TROUPE_ID}&set=troupe&link=players`,
    );
    expect(card.queryByRole('link', { name: 'Happening' })).toBeNull();
  });
});
