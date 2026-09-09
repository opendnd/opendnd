/**
 * The grid a page is laid out on.
 *
 * A page is a fixed-column grid of cells, and a block occupies a rectangle of
 * them: `col` and `row` are 1-based like CSS grid lines, `w` and `h` are
 * spans. The numbers are the ones OpenHI Studio uses — six columns, cells of
 * 108 pixels, gaps of 12, nothing taller than four rows — so a layout means
 * the same thing in both products and a block written for one sits correctly
 * in the other.
 *
 * Everything here is a pure function of rectangles. Nothing draws.
 */

export const GRID_COLS = 6;
export const GRID_ROWS = 8;
export const MAX_SPAN_H = 4;

/** Rendered cell height and gap, shared by the canvas and the page. */
export const CELL_HEIGHT_PX = 108;
export const CELL_GAP_PX = 12;

export interface GridRect {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
}

/** A block placed on a page: which block, where, and how it is set up. */
export interface Placed extends GridRect {
  /** Unique within the page, so a page may hold two of the same block. */
  readonly id: string;
  /** The catalogue id of the block to draw here. */
  readonly block: string;
  readonly options?: Record<string, unknown>;
}

export function overlaps(a: GridRect, b: GridRect): boolean {
  return (
    a.col < b.col + b.w &&
    b.col < a.col + a.w &&
    a.row < b.row + b.h &&
    b.row < a.row + a.h
  );
}

export function withinGrid(rect: GridRect): boolean {
  return (
    rect.col >= 1 &&
    rect.row >= 1 &&
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.col + rect.w - 1 <= GRID_COLS &&
    rect.row + rect.h - 1 <= GRID_ROWS
  );
}

/** Clamp a span so it fits the grid, and the origin so the rectangle does. */
export function clampRect(rect: GridRect): GridRect {
  const w = Math.min(Math.max(1, rect.w), GRID_COLS);
  const h = Math.min(Math.max(1, rect.h), MAX_SPAN_H);
  const col = Math.min(Math.max(1, rect.col), GRID_COLS - w + 1);
  const row = Math.min(Math.max(1, rect.row), GRID_ROWS - h + 1);
  return { col, row, w, h };
}

export function isFree(
  rect: GridRect,
  placed: readonly Placed[],
  ignore?: string,
): boolean {
  if (!withinGrid(rect)) return false;
  return placed.every((other) => other.id === ignore || !overlaps(rect, other));
}

/**
 * The first free rectangle of the given size, reading the grid like a page:
 * left to right, then down. Starts at `preferred` when given, so a drop lands
 * where the cursor was if it can, and nearby if it cannot.
 */
export function findFreeSlot(
  size: { readonly w: number; readonly h: number },
  placed: readonly Placed[],
  preferred?: { readonly col: number; readonly row: number },
  ignore?: string,
): GridRect | undefined {
  const w = Math.min(Math.max(1, size.w), GRID_COLS);
  const h = Math.min(Math.max(1, size.h), MAX_SPAN_H);

  if (preferred) {
    const at = clampRect({ ...preferred, w, h });
    if (isFree(at, placed, ignore)) return at;
  }

  const startRow = preferred?.row ?? 1;
  for (let pass = 0; pass < 2; pass += 1) {
    const from = pass === 0 ? startRow : 1;
    const to = pass === 0 ? GRID_ROWS : startRow - 1;
    for (let row = from; row <= to; row += 1) {
      for (let col = 1; col <= GRID_COLS - w + 1; col += 1) {
        const candidate = { col, row, w, h };
        if (isFree(candidate, placed, ignore)) return candidate;
      }
    }
  }
  return undefined;
}

/** Rows actually used, so a page can grow with what is on it. */
export function usedRows(placed: readonly Placed[]): number {
  return placed.reduce((most, item) => Math.max(most, item.row + item.h - 1), 0);
}

/** Reading order: down the page, then across it. */
export function inReadingOrder(placed: readonly Placed[]): Placed[] {
  return [...placed].sort((a, b) => a.row - b.row || a.col - b.col);
}
