import {
  MonitorIcon,
  SmartphoneIcon,
  TabletIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import {
  type CSSProperties,
  type DragEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useWorld } from '../app/world';
import { BLOCKS, type Block, blockById, isPlaceable } from '../build/blocks';
import { Page } from '../build/Page';
import {
  CELL_GAP_PX,
  CELL_HEIGHT_PX,
  GRID_COLS,
  GRID_ROWS,
  type GridRect,
  MAX_SPAN_H,
  type Placed,
  clampRect,
  findFreeSlot,
  roomFor,
  usedRows,
} from '../build/grid';
import { projectOf } from '../build/project';
import { useProjects } from '../build/projects';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Where a page is put together.
 *
 * The grid in the middle is the same grid the page is drawn on and the blocks
 * on it are the real ones, reading the real world — a canvas showing pretend
 * content would be a canvas that lies about what you are making. Around it:
 * the blocks to choose from on the left, the widths to check on the right,
 * and Publish, which is the only thing that changes what anybody else sees.
 */

const BLOCK_DRAG = 'application/x-opendnd-block';
const PLACED_DRAG = 'application/x-opendnd-placed';

type Viewport = 'desktop' | 'tablet' | 'mobile';
const COLUMNS: Record<Viewport, number> = { desktop: 6, tablet: 4, mobile: 2 };
const WIDTHS: Record<Viewport, string> = {
  desktop: 'max-w-none',
  tablet: 'max-w-3xl',
  mobile: 'max-w-sm',
};

export function Canvas() {
  const api = useApi();
  const { world, canEdit } = useWorld();
  const params = useParams();
  const projects = useProjects();
  const projectId = params.project ?? '';
  const pageId = params.page ?? '';

  const stored = useRequest(
    () => api.get(world.id, 'project', projectId),
    [api, world.id, projectId],
  );
  const project = useMemo(
    () => (stored.data ? projectOf(stored.data.body) : undefined),
    [stored.data],
  );
  const page = project?.pages.find((one) => one.id === pageId);

  const [draft, setDraft] = useState<readonly Placed[] | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<Error | undefined>(undefined);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [full, setFull] = useState(false);

  const blocks = draft ?? page?.layout.blocks ?? [];

  /** Write the page back, which is what a draft project is for. */
  const save = useCallback(
    async (next: readonly Placed[], status?: 'published') => {
      if (!stored.data || !project || !page) return;
      setDraft(next);
      setSaving(true);
      setFailed(undefined);
      try {
        // Written in the record's shape, which names a repeating element
        // singular: `page`, and `block` inside it.
        const page$ = project.pages.map((one) => ({
          id: one.id,
          name: one.name,
          path: one.path,
          scope: one.scope,
          rows: one.layout.rows,
          block: (one.id === page.id ? next : one.layout.blocks).map(
            (placed) => ({ ...placed }),
          ),
        }));
        await api.patch(world.id, 'project', project.id, {
          page: page$,
          ...(status ? { status } : {}),
        });
        projects.reload();
        stored.reload();
      } catch (cause) {
        setFailed(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        setSaving(false);
      }
    },
    [api, world.id, project, page, stored, projects],
  );

  if (stored.loading && !stored.data) return <Loading />;
  if (stored.error) {
    return <ErrorNotice error={stored.error} onRetry={stored.reload} />;
  }
  if (!project || !page) {
    return <Notice tone="warning" title="There is no such page" />;
  }
  if (!canEdit) {
    return (
      <Notice tone="warning" title="This world is not yours to change">
        You can read every page of it.
      </Notice>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-2xl">{page.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {project.name} ·{' '}
            {project.status === 'published' ? 'published' : 'draft'}
            {saving && ' · saving…'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
          {(
            [
              ['desktop', MonitorIcon],
              ['tablet', TabletIcon],
              ['mobile', SmartphoneIcon],
            ] as const
          ).map(([which, Icon]) => (
            <Button
              key={which}
              variant={viewport === which ? 'secondary' : 'ghost'}
              size="xs"
              aria-label={which}
              aria-pressed={viewport === which}
              onClick={() => setViewport(which)}
            >
              <Icon />
            </Button>
          ))}
        </div>
        <Button
          disabled={saving || project.status === 'published'}
          onClick={() => void save(blocks, 'published')}
        >
          <UploadIcon data-icon="inline-start" />
          {project.status === 'published' ? 'Published' : 'Publish'}
        </Button>
        <Button
          variant="outline"
          render={<Link to={`/worlds/${world.id}/build`} />}
        >
          Done
        </Button>
      </header>

      {failed && <ErrorNotice error={failed} />}
      {full && (
        <Notice tone="warning" title="This page is full">
          Every cell is taken. Make something smaller, or take a block off.
        </Notice>
      )}

      <div className="grid min-h-0 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Palette
          search={search}
          onSearch={setSearch}
          onAdd={(block) => {
            const slot = roomFor(block.size, blocks);
            if (!slot) {
              setFull(true);
              return;
            }
            setFull(false);
            void save([
              ...blocks,
              { id: `b${Date.now().toString(36)}`, block: block.id, ...slot },
            ]);
          }}
        />
        <Board
          blocks={blocks}
          viewport={viewport}
          chosen={chosen}
          onChoose={setChosen}
          onChange={(next) => void save(next)}
        />
      </div>
    </div>
  );
}

/** The blocks there are, to search and to drag onto the page. */
function Palette(props: {
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onAdd: (block: Block) => void;
}) {
  const needle = props.search.trim().toLowerCase();
  const shown = BLOCKS.filter(
    (one) =>
      needle === '' ||
      one.name.toLowerCase().includes(needle) ||
      one.description.toLowerCase().includes(needle),
  );
  const categories = [...new Set(shown.map((one) => one.category))];
  return (
    <aside className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-lg border p-2">
      <Input
        type="search"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        placeholder="Find a block"
        aria-label="Find a block"
        className="h-8"
      />
      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-1">
          <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {category}
          </p>
          {shown
            .filter((one) => one.category === category)
            .map((one) => {
              const usable = isPlaceable(one);
              const Icon = one.icon;
              return (
                <button
                  key={one.id}
                  type="button"
                  draggable={usable}
                  disabled={!usable}
                  title={one.description}
                  onDragStart={(event) =>
                    event.dataTransfer.setData(BLOCK_DRAG, one.id)
                  }
                  onClick={() => usable && props.onAdd(one)}
                  className="flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors enabled:hover:border-ring disabled:opacity-60"
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1">
                      <span className="truncate font-medium">{one.name}</span>
                      {!usable && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                        >
                          {one.status === 'third-party' ? 'Elsewhere' : 'Soon'}
                        </Badge>
                      )}
                    </span>
                    <span className="line-clamp-2 text-muted-foreground">
                      {one.description}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
      ))}
      {shown.length === 0 && (
        <p className="p-2 text-xs text-muted-foreground">
          No block by that name.
        </p>
      )}
    </aside>
  );
}

/** The page itself, with the blocks on it movable. */
function Board(props: {
  readonly blocks: readonly Placed[];
  readonly viewport: Viewport;
  readonly chosen: string | undefined;
  readonly onChoose: (id: string | undefined) => void;
  readonly onChange: (next: readonly Placed[]) => void;
}) {
  const { blocks, viewport } = props;
  const cols = COLUMNS[viewport];
  const desktop = viewport === 'desktop';
  const rows = Math.max(GRID_ROWS, usedRows(blocks) + 1);
  const board = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<GridRect | undefined>(undefined);

  /** Which cell the pointer is over, from the board's own measurements. */
  const cellAt = useCallback(
    (event: DragEvent): { col: number; row: number } | undefined => {
      const grid = board.current;
      if (!grid) return undefined;
      const rect = grid.getBoundingClientRect();
      const wide = (rect.width - CELL_GAP_PX * (cols - 1)) / cols;
      return {
        col: Math.min(
          cols,
          Math.max(
            1,
            Math.floor((event.clientX - rect.left) / (wide + CELL_GAP_PX)) + 1,
          ),
        ),
        row: Math.min(
          rows,
          Math.max(
            1,
            Math.floor(
              (event.clientY - rect.top) / (CELL_HEIGHT_PX + CELL_GAP_PX),
            ) + 1,
          ),
        ),
      };
    },
    [cols, rows],
  );

  const wanted = (event: DragEvent) => {
    const types = [...event.dataTransfer.types];
    if (types.includes(PLACED_DRAG)) {
      const id = event.dataTransfer.getData(PLACED_DRAG);
      const moving = blocks.find((one) => one.id === id);
      return moving ? { w: moving.w, h: moving.h, ignore: id } : undefined;
    }
    if (types.includes(BLOCK_DRAG)) {
      // The id is not readable during a drag, only on drop, so the outline
      // shown while dragging is a single cell and the drop finds the room.
      return { w: 1, h: 1 };
    }
    return undefined;
  };

  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridAutoRows: `${CELL_HEIGHT_PX}px`,
    gridAutoFlow: desktop ? 'row' : 'row dense',
    gap: CELL_GAP_PX,
  };

  const put = (rect: GridRect, id: string) =>
    props.onChange(
      blocks.map((one) => (one.id === id ? { ...one, ...rect } : one)),
    );

  return (
    <div className={`mx-auto w-full ${WIDTHS[viewport]}`}>
      <div
        ref={board}
        style={style}
        className="rounded-lg border border-dashed p-2"
        onDragOver={(event) => {
          const size = wanted(event);
          const cell = cellAt(event);
          if (!size || !cell) return;
          event.preventDefault();
          setOver(findFreeSlot(size, blocks, cell, size.ignore));
        }}
        onDragLeave={() => setOver(undefined)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(undefined);
          const cell = cellAt(event);
          if (!cell) return;
          const added = event.dataTransfer.getData(BLOCK_DRAG);
          const moved = event.dataTransfer.getData(PLACED_DRAG);
          if (added) {
            const block = blockById(added);
            const slot = block && roomFor(block.size, blocks, cell);
            if (block && slot) {
              props.onChange([
                ...blocks,
                { id: `b${Date.now().toString(36)}`, block: block.id, ...slot },
              ]);
            }
            return;
          }
          const moving = blocks.find((one) => one.id === moved);
          const slot = moving && findFreeSlot(moving, blocks, cell, moving.id);
          if (moving && slot) put(slot, moving.id);
        }}
      >
        {blocks.map((placed) => {
          const block = blockById(placed.block);
          return (
            <div
              key={placed.id}
              draggable={desktop}
              onDragStart={(event) =>
                event.dataTransfer.setData(PLACED_DRAG, placed.id)
              }
              onClick={() => props.onChoose(placed.id)}
              style={
                desktop
                  ? {
                      gridColumn: `${placed.col} / span ${placed.w}`,
                      gridRow: `${placed.row} / span ${placed.h}`,
                    }
                  : {
                      gridColumn: `span ${Math.min(placed.w, cols)}`,
                      gridRow: `span ${placed.h}`,
                    }
              }
              className={`group relative min-w-0 overflow-hidden rounded-md border bg-card ${
                props.chosen === placed.id ? 'border-ring' : ''
              }`}
            >
              {/*
                The real block, drawn at the size of its frame rather than at
                the place it sits on the page: inside this cell the cell is
                the whole grid, so the block is put at its top left corner and
                given all of it.
              */}
              <div className="pointer-events-none h-full overflow-hidden p-2 opacity-90">
                <Page
                  page={{
                    rows: 'fill',
                    blocks: [{ ...placed, col: 1, row: 1, w: GRID_COLS, h: 1 }],
                  }}
                />
              </div>
              <div className="absolute top-1 right-1 flex items-center gap-1 rounded-md border bg-card/95 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <span className="px-1 text-[10px] text-muted-foreground">
                  {block?.name ?? placed.block}
                </span>
                <Size
                  placed={placed}
                  onSize={(rect) => put(clampRect(rect), placed.id)}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove ${block?.name ?? placed.block}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onChange(
                      blocks.filter((one) => one.id !== placed.id),
                    );
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          );
        })}
        {over && desktop && (
          <div
            aria-hidden
            style={{
              gridColumn: `${over.col} / span ${over.w}`,
              gridRow: `${over.row} / span ${over.h}`,
            }}
            className="pointer-events-none rounded-md border-2 border-dashed border-ring/60 bg-ring/5"
          />
        )}
        {blocks.length === 0 && (
          <p className="col-span-full self-center text-center text-sm text-muted-foreground">
            Drag a block here, or click one on the left.
          </p>
        )}
      </div>
    </div>
  );
}

/** How wide and how tall, as two small pickers. */
function Size(props: {
  readonly placed: Placed;
  readonly onSize: (rect: GridRect) => void;
}) {
  const { placed } = props;
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
      <select
        aria-label="Columns"
        className="rounded border bg-transparent px-0.5"
        value={placed.w}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          props.onSize({ ...placed, w: Number(event.target.value) })
        }
      >
        {Array.from({ length: GRID_COLS }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}w
          </option>
        ))}
      </select>
      <select
        aria-label="Rows"
        className="rounded border bg-transparent px-0.5"
        value={placed.h}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          props.onSize({ ...placed, h: Number(event.target.value) })
        }
      >
        {Array.from({ length: MAX_SPAN_H }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}h
          </option>
        ))}
      </select>
    </span>
  );
}
