import { describe, expect, it } from 'vitest';
import {
  GRID_COLS,
  GRID_ROWS,
  type Placed,
  clampRect,
  findFreeSlot,
  inReadingOrder,
  isFree,
  overlaps,
  roomFor,
  usedRows,
} from 'src/build/grid';

const at = (id: string, col: number, row: number, w: number, h: number) =>
  ({ id, block: 'x', col, row, w, h }) satisfies Placed;

describe('the grid a page is laid out on', () => {
  it('knows when two blocks are over the same ground, and when they only touch', () => {
    expect(
      overlaps({ col: 1, row: 1, w: 2, h: 1 }, { col: 2, row: 1, w: 2, h: 1 }),
    ).toBe(true);
    expect(
      overlaps({ col: 1, row: 1, w: 2, h: 2 }, { col: 2, row: 2, w: 1, h: 1 }),
    ).toBe(true);
    expect(
      overlaps({ col: 1, row: 1, w: 2, h: 1 }, { col: 3, row: 1, w: 1, h: 1 }),
    ).toBe(false);
    expect(
      overlaps({ col: 1, row: 1, w: 1, h: 1 }, { col: 1, row: 2, w: 1, h: 1 }),
    ).toBe(false);
  });

  it('pulls a block back inside the grid rather than refusing it', () => {
    expect(clampRect({ col: 6, row: 1, w: 3, h: 1 })).toEqual({
      col: GRID_COLS - 2,
      row: 1,
      w: 3,
      h: 1,
    });
    // Nothing is taller than the cap, or wider than the grid, or off its top.
    expect(clampRect({ col: 0, row: 0, w: 99, h: 99 })).toEqual({
      col: 1,
      row: 1,
      w: GRID_COLS,
      h: 4,
    });
  });

  it('holds a space against everything but the block being moved', () => {
    const page = [at('a', 1, 1, 2, 2)];
    expect(isFree({ col: 1, row: 1, w: 1, h: 1 }, page)).toBe(false);
    expect(isFree({ col: 1, row: 1, w: 1, h: 1 }, page, 'a')).toBe(true);
    expect(isFree({ col: 3, row: 1, w: 2, h: 2 }, page)).toBe(true);
    // Off the grid is not free, however empty it is.
    expect(isFree({ col: 6, row: 1, w: 2, h: 1 }, page)).toBe(false);
  });

  it('finds the first gap that fits, preferring where the block was dropped', () => {
    const page = [at('a', 1, 1, 6, 1)];
    expect(findFreeSlot({ w: 6, h: 1 }, page)).toEqual({
      col: 1,
      row: 2,
      w: 6,
      h: 1,
    });
    // A drop lands where the cursor is when it can.
    expect(findFreeSlot({ w: 2, h: 1 }, page, { col: 3, row: 4 })).toEqual({
      col: 3,
      row: 4,
      w: 2,
      h: 1,
    });
    // And nearby when it cannot: row 1 is taken, so the search moves on.
    expect(findFreeSlot({ w: 2, h: 1 }, page, { col: 3, row: 1 })).toEqual({
      col: 1,
      row: 2,
      w: 2,
      h: 1,
    });
  });

  it('says when there is nowhere left to put anything', () => {
    const full = Array.from({ length: GRID_ROWS }, (_, index) =>
      at(`r${index}`, 1, index + 1, GRID_COLS, 1),
    );
    expect(findFreeSlot({ w: 1, h: 1 }, full)).toBeUndefined();
    expect(usedRows(full)).toBe(GRID_ROWS);
  });

  it('reads a page down and then across, whatever order it was built in', () => {
    const page = [
      at('c', 1, 3, 6, 1),
      at('b', 4, 1, 3, 2),
      at('a', 1, 1, 3, 2),
    ];
    expect(inReadingOrder(page).map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });

  it('grows with its content and is empty when there is none', () => {
    expect(usedRows([])).toBe(0);
    expect(usedRows([at('a', 1, 2, 1, 3)])).toBe(4);
  });
});

describe('finding room on a page', () => {
  it('shrinks a block rather than refusing it, when the page is nearly full', () => {
    // Every row taken but the last cell of the last one.
    const nearly = [
      ...Array.from({ length: GRID_ROWS - 1 }, (_, index) =>
        at(`r${index}`, 1, index + 1, GRID_COLS, 1),
      ),
      at('last', 1, GRID_ROWS, GRID_COLS - 1, 1),
    ];
    expect(findFreeSlot({ w: 6, h: 4 }, nearly)).toBeUndefined();
    expect(roomFor({ w: 6, h: 4 }, nearly)).toEqual({
      col: GRID_COLS,
      row: GRID_ROWS,
      w: 1,
      h: 1,
    });
  });

  it('gives a block its own size when the page has room for it', () => {
    expect(roomFor({ w: 3, h: 2 }, [])).toEqual({ col: 1, row: 1, w: 3, h: 2 });
  });

  it('has nothing to offer a page with no cell left', () => {
    const full = Array.from({ length: GRID_ROWS }, (_, index) =>
      at(`r${index}`, 1, index + 1, GRID_COLS, 1),
    );
    expect(roomFor({ w: 1, h: 1 }, full)).toBeUndefined();
  });
});
