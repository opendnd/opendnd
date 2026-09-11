import { describe, expect, it } from 'vitest';
import { GRID_COLS, MAX_SPAN_H } from 'src/build/grid';
import {
  BUNDLED,
  FLOOR,
  appsOff,
  builtIn,
  copyOf,
  layoutFor,
  offers,
  projectFor,
  projectOf,
} from 'src/build/project';
import type { Resource } from 'src/api/types';

const record = (body: Record<string, unknown>) =>
  ({ id: 'p1', world: 'w', name: 'A project', ...body }) as Resource;

describe('a project record read as pages', () => {
  it('takes the pages and blocks it is given', () => {
    const project = projectOf(
      record({
        status: 'published',
        replaces: ['home'],
        page: [
          {
            id: 'front',
            name: 'Front',
            path: 'home',
            rows: 'fill',
            block: [{ id: 'a', block: 'ask', col: 2, row: 3, w: 4, h: 2 }],
          },
        ],
      }),
    );
    expect(project.status).toBe('published');
    expect(project.replaces).toEqual(['home']);
    expect(project.pages[0]!.layout.rows).toBe('fill');
    expect(project.pages[0]!.layout.blocks[0]).toEqual({
      id: 'a',
      block: 'ask',
      col: 2,
      row: 3,
      w: 4,
      h: 2,
    });
  });

  it('makes a page that draws out of a record that would not', () => {
    // A record can hold anything: it may come from another deployment, an
    // older grid, or a hand-edited export.
    const project = projectOf(
      record({
        status: 'nonsense',
        page: [
          {
            block: [
              { block: 'ask', col: -5, row: 0, w: 99, h: 99 },
              { col: 1, row: 1, w: 1, h: 1 },
              'not a block',
            ],
          },
        ],
      }),
    );
    expect(project.status).toBe('draft');
    const page = project.pages[0]!;
    expect(page.name).toBe('Untitled page');
    // The one entry naming a block survives, clamped onto the grid; the two
    // that name none are dropped rather than drawn as holes.
    expect(page.layout.blocks).toHaveLength(1);
    const only = page.layout.blocks[0]!;
    expect(only.col).toBeGreaterThanOrEqual(1);
    expect(only.row).toBeGreaterThanOrEqual(1);
    expect(only.w).toBeLessThanOrEqual(GRID_COLS);
    expect(only.h).toBeLessThanOrEqual(MAX_SPAN_H);
  });
});

describe('which layout a path draws', () => {
  const own = projectOf(
    record({
      status: 'published',
      page: [
        {
          id: 'front',
          name: 'Front',
          path: 'home',
          block: [{ id: 'a', block: 'ask', col: 1, row: 1, w: 6, h: 4 }],
        },
      ],
    }),
  );

  it('is the application’s until a world publishes one of its own', () => {
    expect(layoutFor('home', []).from).toBeUndefined();
    expect(layoutFor('home', []).layout.blocks.length).toBe(4);
    expect(layoutFor('home', [own]).from?.id).toBe('p1');
    expect(layoutFor('home', [own]).layout.blocks).toHaveLength(1);
  });

  it('ignores a draft, which is what makes publishing mean anything', () => {
    const draft = { ...own, status: 'draft' as const };
    expect(layoutFor('home', [draft]).from).toBeUndefined();
    expect(layoutFor('home', [draft]).layout.blocks.length).toBe(4);
  });

  it('leaves every other path to the application', () => {
    expect(layoutFor('map', [own]).from).toBeUndefined();
    expect(layoutFor('nowhere', [own]).layout.blocks).toEqual([]);
  });
});

describe('customizing a page', () => {
  it('copies it as a draft that answers to the same address', () => {
    const home = builtIn().pages.find((one) => one.path === 'home')!;
    const copy = copyOf(home, 'Somewhere');
    expect(copy.status).toBe('draft');
    expect(copy.replaces).toEqual(['home']);
    const pages = copy.page as { path: string; block: unknown[] }[];
    expect(pages[0]!.path).toBe('home');
    expect(pages[0]!.block).toHaveLength(home.layout.blocks.length);
    // And what it copies is what was on the page, not a reference to it.
    expect(pages[0]!.block[0]).not.toBe(home.layout.blocks[0]);
    expect(pages[0]!.block[0]).toEqual(home.layout.blocks[0]);
  });

  it('offers every page the application ships', () => {
    const shipped = builtIn();
    expect(shipped.pages.map((one) => one.path)).toContain('home');
    expect(shipped.pages.map((one) => one.path)).toContain('map');
    for (const page of shipped.pages) {
      expect(page.name.length).toBeGreaterThan(0);
      expect(page.layout.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe('the applications OpenDnD ships', () => {
  it('are projects like any other, made of pages that exist', () => {
    for (const app of BUNDLED) {
      const project = projectFor(app);
      expect(project.pages.length).toBe(app.pages.length);
      for (const page of project.pages) {
        expect(page.layout.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it('are all on until a world turns one off', () => {
    expect(appsOff(undefined).size).toBe(0);
    expect(appsOff({ apps: { off: ['atlas'] } })).toEqual(new Set(['atlas']));
    // And nonsense on the record is not an application anybody turned off.
    expect(appsOff({ apps: 'no' }).size).toBe(0);
  });

  it('take their pages with them when they go', () => {
    const off = new Set(['atlas']);
    expect(offers('map', off)).toBe(false);
    expect(offers('campaigns', off)).toBe(true);
    // The front page is the floor, not an application: it cannot be removed.
    expect(offers('home', new Set(['play', 'atlas', 'library']))).toBe(true);
    // A page belonging to no application is nobody's to withhold.
    expect(offers('somewhere-else', off)).toBe(true);
  });

  it('between them cover every page the application ships but the floor', () => {
    const inApps = new Set<string>(
      BUNDLED.flatMap((a) => a.pages.map((p) => p.path)),
    );
    for (const page of builtIn().pages) {
      expect(
        inApps.has(page.path) ||
          (FLOOR as readonly string[]).includes(page.path),
        page.path,
      ).toBe(true);
    }
  });
});
