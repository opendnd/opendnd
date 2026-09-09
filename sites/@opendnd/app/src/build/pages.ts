import type { PageLayout } from './Page';

/**
 * The pages the application ships with, as layouts.
 *
 * They are ordinary layouts of ordinary blocks — there is nothing a built-in
 * page can do that a page somebody builds cannot. They live in the code
 * rather than in the database because a world that has never been touched
 * still has to have a front page; a world that wants its own copies one of
 * these and edits it from then on.
 */

const at = (
  id: string,
  block: string,
  col: number,
  row: number,
  w: number,
  h: number,
  options?: Record<string, unknown>,
) => ({ id, block, col, row, w, h, ...(options ? { options } : {}) });

export const PAGES = {
  home: {
    rows: 'fit',
    blocks: [
      at('ask', 'ask', 1, 1, 6, 4),
      at('counts', 'counts', 1, 5, 6, 1),
      at('campaigns', 'campaigns', 1, 6, 6, 1),
      at('recent', 'recent', 1, 7, 6, 2),
    ],
  },
  campaigns: {
    rows: 'fit',
    blocks: [at('all', 'campaign-list', 1, 1, 6, 4)],
  },
  characters: {
    rows: 'fit',
    blocks: [at('all', 'character-list', 1, 1, 6, 4)],
  },
  compendium: {
    rows: 'fit',
    blocks: [at('all', 'compendium', 1, 1, 6, 4)],
  },
  rules: {
    rows: 'fit',
    blocks: [at('all', 'rules', 1, 1, 6, 4)],
  },
  // One surface that wants the window rather than a card's worth of it.
  map: {
    rows: 'fill',
    blocks: [at('map', 'map', 1, 1, 6, 1)],
  },
  timeline: {
    rows: 'fit',
    blocks: [at('timeline', 'timeline', 1, 1, 6, 4)],
  },
} satisfies Record<string, PageLayout>;

export type BuiltInPage = keyof typeof PAGES;
