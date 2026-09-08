import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Resource, SearchHit } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { Markdown } from '../components/Markdown';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import {
  type Cell,
  type View,
  cellAtLatLng,
  cellModels,
  centerOf,
  coverage,
  outlineOf,
  parseCell,
  zoomFor,
} from '../schema/cells';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/** Colours, one per model that sits on the map, in the order the ontology lists them. */
const FILLS = [
  'var(--color-emerald-600)',
  'var(--color-amber-600)',
  'var(--color-sky-600)',
  'var(--color-rose-600)',
  'var(--color-violet-600)',
];

/** How many levels below a tile-sized cell are still drawn, as marks. */
const DRAWN_BELOW = 4;

/** A cell this near a tile's size, or bigger, is drawn as its outline. */
const OUTLINED_BELOW = 2;

/** Up to this many things in view, every one is labelled. */
const MOST_LABELS = 40;

/** How far a base map without its own limit may be zoomed. */
const DEEPEST_ZOOM = 14;

interface Entry {
  readonly model: string;
  readonly field: string;
  readonly resource: Resource;
  readonly cell: Cell;
}

interface Placing {
  readonly model: string;
  readonly field: string;
  readonly resource: Resource;
}

/** What the world's own record says its base map is. */
interface BaseMap {
  readonly tiles: string;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly attribution?: string;
}

interface Viewport extends View {
  readonly lat: number;
  readonly lng: number;
}

/**
 * The world as a map that pans and zooms: the world's picture tiles beneath,
 * when its record names them, and over them every record of a model with a
 * cell field, drawn where its cell is. What is fetched follows the view: the
 * cells under it, down to a level worth drawing at the zoom. A coarse cell is
 * drawn as its outline and a fine one as a mark; either opens a short account
 * of its record, with the way to the whole of it.
 *
 * An editor places a record from here: come with it, then choose the spot.
 */
export function MapPage() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const [params, setParams] = useSearchParams();
  // The year to draw the world as of: what held then, like an older photograph.
  const asOf = params.get('at') ?? undefined;
  // The record being placed is held here, seeded from the address, so that
  // finishing is final even when the address is still catching up.
  const [placingKey, setPlacingKey] = useState<string | undefined>(
    () => params.get('place') ?? undefined,
  );
  const finished = useRef(new Set<string>());
  const wanted = params.get('place');
  useEffect(() => {
    if (wanted && !finished.current.has(wanted)) setPlacingKey(wanted);
  }, [wanted]);
  const models = useMemo(() => cellModels(ontology), [ontology]);
  const modelsKey = models.map((m) => m.model).join(',');

  // The world's own record says what the base map is, when it has one.
  const base = useRequest(
    () =>
      api
        .get(world.id, 'world', world.id)
        .then((got) => got.body)
        .catch(() => undefined),
    [api, world.id],
  );
  const baseMap = asBaseMap(base.data?.map);
  const deepest = baseMap?.maxZoom ?? DEEPEST_ZOOM;

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);
  const clickRef =
    useRef<(at: { lat: number; lng: number }) => void>(undefined);
  const [view, setView] = useState<Viewport>();
  const [preview, setPreview] = useState<Entry>();
  const [placeLevel, setPlaceLevel] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [placeError, setPlaceError] = useState<Error>();
  const [notice, setNotice] = useState<string>();

  const placing = useRequest(async (): Promise<Placing | undefined> => {
    if (!placingKey) return undefined;
    const [model, id] = placingKey.split('/');
    const field = models.find((m) => m.model === model)?.field;
    if (!model || !id || !field) return undefined;
    const got = await api.get(world.id, model, id);
    return { model, field, resource: got.body };
  }, [api, world.id, placingKey, modelsKey]);

  const keep = (
    change: (q: URLSearchParams) => void,
    options?: { replace?: boolean },
  ) => {
    // From what the address holds when the change lands, not when it was
    // asked for: a click's change and the view's must not undo each other.
    setParams((current) => {
      const next = new URLSearchParams(current);
      change(next);
      return next;
    }, options);
  };

  // The map itself, made once the base map is known so its zooms fit the
  // tiles, and starting where the address says: a cell, a point, or the world.
  useEffect(() => {
    const element = container.current;
    if (!element || base.loading || mapRef.current) return undefined;
    const map = L.map(element, {
      minZoom: baseMap?.minZoom ?? 0,
      maxZoom: deepest,
      worldCopyJump: true,
      attributionControl: baseMap?.attribution !== undefined,
    });
    if (baseMap) {
      L.tileLayer(baseMap.tiles, {
        minZoom: baseMap.minZoom ?? 0,
        maxZoom: deepest,
        noWrap: true,
        ...(baseMap.attribution ? { attribution: baseMap.attribution } : {}),
      }).addTo(map);
    }
    drawn.current = L.layerGroup().addTo(map);
    const read = () => {
      const bounds = map.getBounds();
      const centre = map.getCenter();
      setView({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: map.getZoom(),
        lat: centre.lat,
        lng: centre.lng,
      });
    };
    map.on('moveend', read);
    map.on('click', (event) => clickRef.current?.(event.latlng));
    const cell = parseCell(params.get('cell'));
    const ll = params.get('ll')?.split(',').map(Number);
    const z = Number(params.get('z'));
    if (cell) {
      map.setView(centerOf(cell), Math.min(zoomFor(cell.level), deepest));
    } else if (
      ll &&
      ll.length === 2 &&
      ll.every(Number.isFinite) &&
      Number.isFinite(z)
    ) {
      map.setView([ll[0]!, ll[1]!], z);
    } else {
      map.fitBounds([
        [-70, -170],
        [75, 170],
      ]);
    }
    read();
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      drawn.current = null;
    };
    // The map is made once; the address and the base map are read at that moment.
  }, [base.loading]);

  // The address follows the view, so a view can be shared or come back to.
  useEffect(() => {
    if (!view) return;
    const ll = `${view.lat.toFixed(4)},${view.lng.toFixed(4)}`;
    const z = String(Math.round(view.zoom * 100) / 100);
    if (params.get('ll') === ll && params.get('z') === z) return;
    keep(
      (q) => {
        q.set('ll', ll);
        q.set('z', z);
        q.delete('cell');
      },
      { replace: true },
    );
    // Only a move changes the address here; the rest of it is left as it is.
  }, [view]);

  // What is in view: the cells under it, and the coarser things on their faces.
  const plan = view ? coverage(view, { below: DRAWN_BELOW }) : undefined;
  const planKey = plan
    ? `${plan.cells.join(' ')}|${plan.faces.join(' ')}|${plan.sampleLevel}|${plan.maxLevel}`
    : '';
  const records = useRequest(
    async () => {
      if (!plan) return [] as Entry[];
      const queries = [
        ...plan.cells.map((cell) => ({ cell, maxLevel: plan.maxLevel })),
        ...(plan.sampleLevel > 0
          ? plan.faces.map((cell) => ({ cell, maxLevel: plan.sampleLevel - 1 }))
          : []),
      ];
      const pages = await Promise.all(
        models.flatMap((m) =>
          queries.map((q) =>
            api
              .list(world.id, m.model, {
                ...q,
                ...(asOf ? { at: asOf } : {}),
                limit: 500,
              })
              .then((page) =>
                page.resources.map((resource) => ({ m, resource })),
              ),
          ),
        ),
      );
      const seen = new Set<string>();
      const entries: Entry[] = [];
      for (const { m, resource } of pages.flat()) {
        const key = `${m.model}/${resource.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cell = parseCell(resource[m.field]);
        if (cell) {
          entries.push({ model: m.model, field: m.field, resource, cell });
        }
      }
      return entries.sort(
        (a, b) =>
          a.cell.level - b.cell.level ||
          nameOf(a.resource).localeCompare(nameOf(b.resource)),
      );
    },
    // The plan's key stands for the plan, which is rebuilt each render.
    [api, world.id, modelsKey, planKey, asOf],
  );
  const entries = records.data ?? [];
  const fillOf = (model: string) =>
    FILLS[models.findIndex((m) => m.model === model) % FILLS.length]!;

  // Draw what is in view: outlines for the coarse, marks for the fine.
  useEffect(() => {
    const group = drawn.current;
    if (!group || !view) return;
    group.clearLayers();
    const zoom = Math.round(view.zoom);
    const labelled = entries.length <= MOST_LABELS;
    for (const entry of entries) {
      const fill = fillOf(entry.model);
      const outline =
        entry.cell.level <= zoom + OUTLINED_BELOW
          ? outlineOf(entry.cell)
          : undefined;
      const shape = outline
        ? L.polygon(
            outline.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: fill,
              weight: 1.5,
              opacity: 0.8,
              fillColor: fill,
              fillOpacity: 0.08,
            },
          )
        : L.circleMarker(centerOf(entry.cell), {
            radius: 5,
            color: fill,
            weight: 1.5,
            fillColor: fill,
            fillOpacity: 0.9,
          });
      shape.bindTooltip(nameOf(entry.resource), {
        permanent: labelled || entry.cell.level <= zoom + 1,
        direction: outline ? 'center' : 'right',
        className: 'map-label',
        ...(outline ? {} : { offset: [8, 0] }),
      });
      shape.on('click', (event) => {
        if (placing.data) clickRef.current?.(event.latlng);
        else setPreview(entry);
      });
      shape.addTo(group);
    }
    // fillOf is a function of models, which modelsKey stands for.
  }, [entries, view, modelsKey, placing.data]);

  // Placing: a click gives the record the cell under it at the chosen level.
  const level = placeLevel ?? (view ? Math.round(view.zoom) + DRAWN_BELOW : 8);
  useEffect(() => {
    clickRef.current = (at) => {
      const target = placing.data;
      if (!target || busy) return;
      const cell = cellAtLatLng(at, Math.min(level, 30));
      void (async () => {
        setBusy(true);
        setPlaceError(undefined);
        try {
          await api.patch(world.id, target.model, target.resource.id, {
            [target.field]: cell.token,
          });
          finishPlacing();
          setNotice(`${nameOf(target.resource)} is on the map.`);
          records.reload();
        } catch (cause) {
          setPlaceError(
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        } finally {
          setBusy(false);
        }
      })();
    };
  });

  const finishPlacing = () => {
    if (placingKey) finished.current.add(placingKey);
    setPlacingKey(undefined);
    keep((q) => q.delete('place'), { replace: true });
  };

  const go = (entry: Entry) => {
    mapRef.current?.flyTo(
      centerOf(entry.cell),
      Math.min(zoomFor(entry.cell.level), deepest),
    );
    setPreview(entry);
  };

  /** A record found by name: fly to it, or say it is not placed yet. */
  const found = async (hit: SearchHit) => {
    const m = models.find((candidate) => candidate.model === hit.model);
    if (!m) {
      setNotice(`${hit.name} is not the kind of thing the map draws.`);
      return;
    }
    const got = await api.get(world.id, hit.model, hit.id);
    const cell = parseCell(got.body[m.field]);
    if (cell) {
      setNotice(undefined);
      go({ model: m.model, field: m.field, resource: got.body, cell });
    } else if (canEdit) {
      keep((q) => q.set('place', `${hit.model}/${hit.id}`));
    } else {
      setNotice(`${hit.name} has no place on the map yet.`);
    }
  };

  if (models.length === 0) {
    return (
      <Notice tone="warning" title="Nothing in this world can be placed">
        No model has a cell field, so there is nothing to draw.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
        {view && <Badge variant="outline">Zoom {Math.round(view.zoom)}</Badge>}
        <span className="flex-1" />
        <AsOf
          year={asOf}
          onChange={(year) =>
            keep((q) => (year ? q.set('at', year) : q.delete('at')))
          }
        />
      </header>

      {records.error && (
        <ErrorNotice error={records.error} onRetry={records.reload} />
      )}
      {placeError && <ErrorNotice error={placeError} />}
      {notice && (
        <Notice
          title={notice}
          action={
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setNotice(undefined)}
            >
              <XIcon />
            </Button>
          }
        />
      )}
      {placing.data && (
        <Notice
          title={`Placing ${nameOf(placing.data.resource)}`}
          action={
            <Button variant="outline" size="xs" onClick={finishPlacing}>
              <XIcon data-icon="inline-start" />
              Cancel
            </Button>
          }
        >
          <span className="flex flex-wrap items-center gap-2">
            Choose its spot on the map. It will take a level {level} cell; zoom
            in for a finer one, or set the level here.
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Coarser cell"
              disabled={level <= 1}
              onClick={() => setPlaceLevel(level - 1)}
            >
              <MinusIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Finer cell"
              disabled={level >= 30}
              onClick={() => setPlaceLevel(level + 1)}
            >
              <PlusIcon />
            </Button>
          </span>
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div
          ref={container}
          role="application"
          aria-label="Map of the world"
          className={`h-[calc(100vh-12rem)] min-h-96 overflow-hidden rounded-lg border ${
            placing.data ? 'cursor-crosshair' : ''
          }`}
        />
        <aside className="flex min-h-0 flex-col gap-4 text-sm lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
          <Find world={world.id} onFound={(hit) => void found(hit)} />
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              In view
            </h2>
            {records.loading && !records.data && <Loading />}
            <ul className="mt-1 flex flex-col gap-0.5">
              {entries.slice(0, 80).map((entry) => (
                <li
                  key={`${entry.model}/${entry.resource.id}`}
                  className="flex items-center gap-2"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: fillOf(entry.model) }}
                  />
                  <button
                    type="button"
                    className="truncate text-left underline-offset-4 hover:underline"
                    onClick={() => go(entry)}
                  >
                    {nameOf(entry.resource)}
                  </button>
                </li>
              ))}
              {entries.length > 80 && (
                <li className="text-muted-foreground">
                  and {entries.length - 80} more
                </li>
              )}
              {records.data && entries.length === 0 && (
                <li className="text-muted-foreground">
                  Nothing placed in view.
                </li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Drawn
            </h2>
            <ul className="mt-1 flex flex-col gap-0.5">
              {models.map((m) => (
                <li key={m.model} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: fillOf(m.model) }}
                  />
                  {ontology.label(m.model)}
                </li>
              ))}
            </ul>
            {!baseMap && base.data && (
              <p className="mt-2 text-xs text-muted-foreground">
                This world has no picture tiles yet; its records are drawn on a
                blank globe.
              </p>
            )}
          </div>
        </aside>
      </div>

      <Sheet
        open={preview !== undefined}
        onOpenChange={(open) => !open && setPreview(undefined)}
      >
        <SheetContent
          side="right"
          className="flex flex-col gap-4 overflow-y-auto"
        >
          {preview && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-2xl">
                  {nameOf(preview.resource)}
                </SheetTitle>
                <SheetDescription>
                  {ontology.label(preview.model)}
                  {typeof preview.resource.canonStatus === 'string' &&
                    ` · ${preview.resource.canonStatus}`}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4">
                {typeof preview.resource.description === 'string' &&
                preview.resource.description !== '' ? (
                  <Markdown
                    text={preview.resource.description
                      .split(/\n\s*\n/)
                      .slice(0, 3)
                      .join('\n\n')}
                    className="prose-record text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing written about this yet.
                  </p>
                )}
              </div>
              <SheetFooter>
                <Button
                  render={
                    <Link
                      to={recordPath(
                        world.id,
                        preview.model,
                        preview.resource.id,
                      )}
                    />
                  }
                >
                  Learn more
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Find a record by name and go to it on the map. */
function Find(props: {
  readonly world: string;
  readonly onFound: (hit: SearchHit) => void;
}) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>();
  const [error, setError] = useState<Error>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    try {
      setError(undefined);
      setHits(await api.search(props.world, q, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };
  return (
    <form onSubmit={submit} role="search" className="flex flex-col gap-1">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="h-8 pl-8 text-sm"
          placeholder="Find on the map"
          aria-label="Find on the map"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <ErrorNotice error={error} />}
      {hits && (
        <ul className="flex flex-col gap-0.5">
          {hits.map((hit) => (
            <li key={`${hit.model}/${hit.id}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                onClick={() => {
                  setHits(undefined);
                  setQuery('');
                  props.onFound(hit);
                }}
              >
                <MapPinIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{hit.name}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="text-xs text-muted-foreground">
              Nothing is called that.
            </li>
          )}
        </ul>
      )}
    </form>
  );
}

/** The year the map is drawn as of. Empty means today. */
function AsOf(props: {
  readonly year?: string;
  readonly onChange: (year: string) => void;
}) {
  const [draft, setDraft] = useState(props.year ?? '');
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        props.onChange(draft.trim());
      }}
    >
      <Label htmlFor="map-at" className="text-xs text-muted-foreground">
        As of year
      </Label>
      <Input
        id="map-at"
        type="number"
        className="h-8 w-24 text-sm"
        placeholder="now"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline">
        Show
      </Button>
    </form>
  );
}

function asBaseMap(value: unknown): BaseMap | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const map = value as Record<string, unknown>;
  if (typeof map.tiles !== 'string') return undefined;
  return {
    tiles: map.tiles,
    ...(typeof map.minZoom === 'number' ? { minZoom: map.minZoom } : {}),
    ...(typeof map.maxZoom === 'number' ? { maxZoom: map.maxZoom } : {}),
    ...(typeof map.attribution === 'string'
      ? { attribution: map.attribution }
      : {}),
  };
}

function nameOf(resource: Resource): string {
  return typeof resource.name === 'string' ? resource.name : resource.id;
}
