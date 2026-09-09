import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BLOCKS, blockById, isPlaceable } from 'src/build/blocks';
import { Page } from 'src/build/Page';
import { PAGES } from 'src/build/pages';
import { GRID_COLS, MAX_SPAN_H, isFree } from 'src/build/grid';
import { renderInWorld } from './helpers';

describe('a page of blocks', () => {
  it('puts each block where the layout says, and reflows nothing on a wide window', () => {
    renderInWorld(
      <Page
        page={{
          rows: 'fit',
          // Two blocks the catalogue lists but nobody has written: they draw
          // as themselves, which is enough to see where they were put.
          blocks: [
            { id: 'a', block: 'search', col: 1, row: 1, w: 2, h: 1 },
            { id: 'b', block: 'note', col: 3, row: 1, w: 4, h: 2 },
          ],
        }}
      />,
    );
    const cell = (name: string) =>
      screen
        .getByText(name)
        .closest('div[style*="grid-column"]') as HTMLElement;
    expect(cell('Search').style.gridColumn).toBe('1 / span 2');
    expect(cell('Note').style.gridColumn).toBe('3 / span 4');
    expect(cell('Note').style.gridRow).toBe('1 / span 2');
  });

  it('says so when a page asks for a block that is not installed', () => {
    renderInWorld(
      <Page
        page={{
          rows: 'fit',
          blocks: [
            { id: 'a', block: 'from-elsewhere', col: 1, row: 1, w: 6, h: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByText('A block is missing')).toBeInTheDocument();
    expect(screen.getByText('from-elsewhere')).toBeInTheDocument();
  });

  it('says what a listed block would do, when it is not built yet', () => {
    renderInWorld(
      <Page
        page={{
          rows: 'fit',
          blocks: [
            { id: 'a', block: 'record-table', col: 1, row: 1, w: 6, h: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByText('Record table')).toBeInTheDocument();
    expect(screen.getByText(/Not built yet/)).toBeInTheDocument();
  });

  it('reads a page down and then across, whatever order the layout is written in', () => {
    renderInWorld(
      <Page
        page={{
          rows: 'fit',
          blocks: [
            { id: 'b', block: 'note', col: 1, row: 2, w: 6, h: 1 },
            { id: 'a', block: 'search', col: 1, row: 1, w: 6, h: 1 },
          ],
        }}
      />,
    );
    const drawn = [
      ...document.querySelectorAll('div[style*="grid-column"]'),
    ].map(
      (cell) => cell.querySelector('[data-slot="alert-title"]')?.textContent,
    );
    expect(drawn).toEqual(['Search', 'Note']);
  });
});

describe('the block catalogue', () => {
  it('gives every block an id of its own and a footprint the grid can hold', () => {
    expect(new Set(BLOCKS.map((one) => one.id)).size).toBe(BLOCKS.length);
    for (const one of BLOCKS) {
      expect(one.size.w).toBeGreaterThanOrEqual(1);
      expect(one.size.w).toBeLessThanOrEqual(GRID_COLS);
      expect(one.size.h).toBeGreaterThanOrEqual(1);
      expect(one.size.h).toBeLessThanOrEqual(MAX_SPAN_H);
      expect(one.description.length).toBeGreaterThan(20);
    }
  });

  it('will not let a block be placed unless it was actually written', () => {
    for (const one of BLOCKS) {
      expect(isPlaceable(one)).toBe(
        one.render !== undefined && (one.status ?? 'available') === 'available',
      );
    }
    // Both halves matter: a listed block has no renderer, and a written one
    // is not hidden behind a status.
    expect(isPlaceable(blockById('record-table')!)).toBe(false);
    expect(isPlaceable(blockById('ask')!)).toBe(true);
  });
});

describe('the pages that ship with the application', () => {
  it('are made only of blocks that exist and can be placed', () => {
    for (const [name, page] of Object.entries(PAGES)) {
      for (const placed of page.blocks) {
        const block = blockById(placed.block);
        expect(block, `${name} asks for ${placed.block}`).toBeDefined();
        expect(isPlaceable(block!), `${name}: ${placed.block}`).toBe(true);
      }
    }
  });

  it('lay their blocks out without any two over the same ground', () => {
    for (const [name, page] of Object.entries(PAGES)) {
      const laid: (typeof page.blocks)[number][] = [];
      for (const placed of page.blocks) {
        expect(isFree(placed, laid), `${name}: ${placed.id}`).toBe(true);
        laid.push(placed);
      }
    }
  });
});
