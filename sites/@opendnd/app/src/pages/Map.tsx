import { ArrowUpIcon, GlobeIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Resource } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import {
  type Cell,
  ancestor,
  cellModels,
  commonAncestor,
  contains,
  parseCell,
  placeWithin,
} from '../schema/cells';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Fills, one per model that sits on the map, in the order the ontology lists them. */
const FILLS = [
  'var(--color-emerald-500)',
  'var(--color-amber-500)',
  'var(--color-sky-500)',
  'var(--color-rose-500)',
  'var(--color-violet-500)',
];

/** Side of the drawing, in its own units. */
const SIDE = 1000;

/** The smallest square a record is drawn as, in the same units. */
const MIN_SIZE = 18;

interface OnMap {
  readonly model: string;
  readonly resource: Resource;
  readonly cell: Cell;
}

/**
 * The world drawn from its cells: every record of a model with a cell field,
 * placed inside the cell in view. With nothing chosen, the view is the
 * smallest cell holding everything on the busiest face. Choosing a cell that
 * has others inside it looks into it; choosing one that does not opens its
 * record.
 */
export function MapPage() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const chosen = params.get('cell') ?? undefined;

  const models = useMemo(() => cellModels(ontology), [ontology]);
  const modelsKey = models.map((m) => m.model).join(',');
  const records = useRequest(
    async () => {
      const pages = await Promise.all(
        models.map((m) =>
          api.list(world.id, m.model, {
            ...(chosen ? { cell: chosen } : {}),
            limit: 500,
          }),
        ),
      );
      return models.flatMap((m, index) =>
        pages[index]!.resources.map((resource) => ({
          model: m.model,
          resource,
          cell: parseCell(resource[m.field]),
        })),
      );
    },
    // The joined key stands for the list, which is rebuilt each render.
    [api, world.id, modelsKey, chosen],
  );

  const all = records.data ?? [];
  const onMap = all.filter((r): r is OnMap => r.cell !== undefined);
  const unplaced = all.filter((r) => r.cell === undefined);
  const focus = chosen
    ? parseCell(chosen)
    : commonAncestor(onMap.map((r) => r.cell));
  const shown = focus
    ? onMap
        .filter((r) => r.cell.face === focus.face)
        .sort((a, b) => a.cell.level - b.cell.level)
    : [];
  const elsewhere = onMap.length - shown.length;
  const here = focus && shown.find((r) => r.cell.token === focus.token);

  const look = (token: string) => setParams({ cell: token });
  const choose = (target: OnMap) => {
    const holdsOthers = shown.some(
      (r) => r !== target && contains(target.cell, r.cell),
    );
    if (holdsOthers && target.cell.token !== focus?.token) {
      look(target.cell.token);
    } else {
      void navigate(recordPath(world.id, target.model, target.resource.id));
    }
  };

  if (models.length === 0) {
    return (
      <Notice tone="warning" title="Nothing in this world can be placed">
        No model has a cell field, so there is nothing to draw.
      </Notice>
    );
  }

  const up =
    focus && focus.level > 0 ? ancestor(focus, focus.level - 1) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {here ? nameOf(here.resource) : 'Map'}
        </h1>
        {focus && (
          <Badge variant="outline" title={`Cell ${focus.token}`}>
            Level {focus.level}
          </Badge>
        )}
        <span className="flex-1" />
        {up && (
          <Button variant="outline" size="sm" onClick={() => look(up.token)}>
            <ArrowUpIcon data-icon="inline-start" />
            Out
          </Button>
        )}
        {chosen && (
          <Button variant="outline" size="sm" onClick={() => setParams({})}>
            <GlobeIcon data-icon="inline-start" />
            Everything
          </Button>
        )}
        {here && (
          <Button
            size="sm"
            render={
              <Link to={recordPath(world.id, here.model, here.resource.id)} />
            }
          >
            Open {ontology.label(here.model).toLowerCase()}
          </Button>
        )}
      </header>

      {records.error && (
        <ErrorNotice error={records.error} onRetry={records.reload} />
      )}
      {records.loading && !records.data && <Loading label="Drawing the map…" />}

      {records.data && !focus && (
        <Notice title="Nothing placed yet">
          Records land on the map when they carry a cell. Generated places come
          with one; anything else can be given one on its record.
        </Notice>
      )}

      {focus && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(14rem,1fr)]">
          <svg
            viewBox={`0 0 ${SIDE} ${SIDE}`}
            role="img"
            aria-label={`Map of ${here ? nameOf(here.resource) : 'the world'}`}
            className="aspect-square w-full rounded-lg border bg-muted/40"
          >
            {shown.map((r) => {
              const at = placeWithin(focus, r.cell)!;
              // A cell far finer than the view is drawn as a marker, so a hamlet
              // inside a county is a mark rather than a pixel.
              const actual = at.size * SIDE;
              const size = Math.max(actual, MIN_SIZE);
              const x = at.x * SIDE - (size - actual) / 2;
              const y = at.y * SIDE - (size - actual) / 2;
              const marker = actual < MIN_SIZE;
              const fill =
                FILLS[
                  models.findIndex((m) => m.model === r.model) % FILLS.length
                ];
              const isFocus = r.cell.token === focus.token;
              return (
                <g
                  key={`${r.model}/${r.resource.id}`}
                  className="cursor-pointer"
                  onClick={() => choose(r)}
                  data-testid={`cell-${r.resource.id}`}
                >
                  <title>{`${nameOf(r.resource)} · ${ontology.label(r.model)}`}</title>
                  <rect
                    x={x}
                    y={y}
                    width={size}
                    height={size}
                    fill={fill}
                    fillOpacity={isFocus ? 0.08 : 0.35}
                    stroke={fill}
                    strokeWidth={isFocus ? 4 : 2}
                    rx={Math.min(6, size / 10)}
                  />
                  {size >= 70 && !isFocus && (
                    <text
                      x={x + size / 2}
                      y={y + size / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.max(14, Math.min(28, size / 6))}
                      className="fill-foreground pointer-events-none select-none"
                    >
                      {nameOf(r.resource)}
                    </text>
                  )}
                  {marker && shown.length <= 40 && (
                    <text
                      x={x + size + 6}
                      y={y + size / 2}
                      dominantBaseline="middle"
                      fontSize={16}
                      className="fill-foreground pointer-events-none select-none"
                    >
                      {nameOf(r.resource)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <aside className="flex flex-col gap-4 text-sm">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                On this map
              </h2>
              <ul className="mt-1 flex flex-col gap-0.5">
                {shown
                  .filter((r) => r !== here)
                  .map((r) => (
                    <li
                      key={`${r.model}/${r.resource.id}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{
                          background:
                            FILLS[
                              models.findIndex((m) => m.model === r.model) %
                                FILLS.length
                            ],
                        }}
                      />
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline"
                        onClick={() => choose(r)}
                      >
                        {nameOf(r.resource)}
                      </button>
                    </li>
                  ))}
                {shown.filter((r) => r !== here).length === 0 && (
                  <li className="text-muted-foreground">
                    Nothing inside this cell.
                  </li>
                )}
              </ul>
            </div>
            {elsewhere > 0 && (
              <p className="text-muted-foreground">
                {elsewhere} more elsewhere on the world, on another face of it.
              </p>
            )}
            {unplaced.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Not placed yet
                </h2>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {unplaced.slice(0, 20).map((r) => (
                    <li key={`${r.model}/${r.resource.id}`}>
                      <Link
                        className="underline-offset-4 hover:underline"
                        to={recordPath(world.id, r.model, r.resource.id)}
                      >
                        {nameOf(r.resource)}
                      </Link>
                    </li>
                  ))}
                  {unplaced.length > 20 && (
                    <li className="text-muted-foreground">
                      and {unplaced.length - 20} more
                    </li>
                  )}
                </ul>
              </div>
            )}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Drawn
              </h2>
              <ul className="mt-1 flex flex-col gap-0.5">
                {models.map((m, index) => (
                  <li key={m.model} className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: FILLS[index % FILLS.length] }}
                    />
                    {ontology.label(m.model)}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function nameOf(resource: Resource): string {
  return typeof resource.name === 'string' ? resource.name : resource.id;
}
