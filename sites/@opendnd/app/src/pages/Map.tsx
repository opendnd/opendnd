import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  LayersIcon,
  ListIcon,
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
import { config } from '../config';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { humanize } from '../schema/fields';
import { recordPath, useWorld } from '../app/world';
import { Markdown } from '../components/Markdown';
import { ErrorNotice, Notice } from '../components/Notice';
import {
  type Cell,
  type LatLng,
  type View,
  ancestor,
  cellAtLatLng,
  cellModels,
  centerOf,
  coverage,
  outlineOf,
  parseCell,
  zoomFor,
} from '../schema/cells';
import { Button } from '@/components/ui/button';
import { Page } from '../build/Page';
import { usePageLayout } from '../build/projects';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

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

/**
 * A cell this near a tile's size, or bigger, is a place you are *in* rather
 * than a place you can see, so it is written across the map instead of marked
 * on it — a continent's name in large letters, the way an atlas does it.
 */
const NAMED_BELOW = 2;

/** Up to this many things in view, every one is labelled. */
const MOST_LABELS = 40;

/** How many of a place's cells are shaded when it is picked out. */
const MOST_CELLS = 1200;

/** How near, in pixels, two marks may be before the second is left out. */
const CROWDED = 22;

/** How far from the edge a name is held when its own middle is off the map. */
const EDGE = 56;

/** And how far from the top, which is where the map's own controls float. */
const EDGE_TOP = 104;

/** How far a base map without its own limit may be zoomed. */
const DEEPEST_ZOOM = 14;

/**
 * The ground each place holds, coarse enough to draw.
 *
 * A kingdom's extent is eight hundred cells at level ten, and there are a
 * hundred and fifty kingdoms: drawing every cell is a hundred thousand
 * shapes nobody asked for, and at a world's zoom each one is a fraction of
 * a pixel. So the cells are rolled up to an ancestor coarse enough to see,
 * which is what any atlas does when it draws a country small.
 *
 * Rolling up overlaps, because one coarse cell can hold ground from two
 * kingdoms. That would draw borders that are simply wrong, so a coarse cell
 * goes to whichever place holds most of it and to nobody else. A political
 * map is a partition — that is the whole idea of one — and this keeps it a
 * partition at every zoom, generalised but never double-claimed.
 */
/**
 * A place's cells rolled up to one level, remembered.
 *
 * A hundred and fifty kingdoms of eight hundred cells is a hundred and
 * twenty thousand tokens to parse, and panning refetches mostly the same
 * places. Rolling up is the expensive half and depends only on the place
 * and the level, so it is kept; the partition over what comes out is
 * cheap, because what comes out is tens of cells rather than hundreds.
 */
interface Rolled {
  readonly cell: Cell;
  /** How many of the place's own cells fall inside this coarse one. */
  readonly n: number;
}

const rolled = new Map<string, Rolled[]>();

function rollUp(
  id: string,
  extent: readonly unknown[],
  level: number,
): Rolled[] {
  const key = `${id}:${level}`;
  const had = rolled.get(key);
  if (had) return had;
  const seen = new Map<string, { cell: Cell; n: number }>();
  for (const token of extent) {
    const cell = parseCell(String(token));
    if (!cell) continue;
    const coarse = cell.level <= level ? cell : ancestor(cell, level);
    if (!coarse) continue;
    const at = seen.get(coarse.token);
    if (at) at.n += 1;
    else seen.set(coarse.token, { cell: coarse, n: 1 });
  }
  const out = [...seen.values()];
  // Enough for every place in view at a handful of levels; a world does not
  // hold so many that this is worth evicting cleverly.
  if (rolled.size > 4000) rolled.clear();
  rolled.set(key, out);
  return out;
}

export function politicalRings(
  entries: readonly Entry[],
  level: number,
): Map<string, LatLng[][]> {
  const claims = new Map<string, Map<string, number>>();
  const owners = new Map<string, Cell>();
  /*
   * How much ground each claimant holds altogether, because the smaller
   * holder wins a contested cell. Places nest — a kingdom sits on a
   * continent, and both say so honestly — so the claimant with the most
   * children in a coarse cell is almost always the continent, and a
   * political map drawn that way is two colours. The most specific holder
   * is the one a political map means.
   */
  const held = new Map<string, number>();
  for (const entry of entries) {
    const extent = entry.resource.extent;
    if (!Array.isArray(extent)) continue;
    const key = `${entry.model}/${entry.resource.id}`;
    held.set(key, extent.length);
    for (const { cell, n } of rollUp(
      String(entry.resource.id),
      extent,
      level,
    )) {
      owners.set(cell.token, cell);
      const byPlace = claims.get(cell.token) ?? new Map<string, number>();
      byPlace.set(key, (byPlace.get(key) ?? 0) + n);
      claims.set(cell.token, byPlace);
    }
  }
  const rings = new Map<string, LatLng[][]>();
  for (const [token, byPlace] of claims) {
    let best: string | undefined;
    let bestHeld = Infinity;
    let bestCount = 0;
    for (const [key, n] of byPlace) {
      const size = held.get(key) ?? Infinity;
      // Smallest holder first; then whoever holds more of this cell; then
      // the same one every time, or the map would flicker as it redrew.
      const better =
        best === undefined ||
        size < bestHeld ||
        (size === bestHeld &&
          (n > bestCount || (n === bestCount && key < best)));
      if (better) {
        best = key;
        bestHeld = size;
        bestCount = n;
      }
    }
    const cell = owners.get(token);
    const outline = best !== undefined && cell && outlineOf(cell, 2);
    if (!best || !outline) continue;
    rings.set(best, [...(rings.get(best) ?? []), outline]);
  }
  return rings;
}

/**
 * A colour for a place, the same one every time.
 *
 * A political map wants neighbours to differ and nothing else; it does not
 * want to mean anything. Hues off a hash give that without anybody keeping
 * a list, and holding saturation and lightness still keeps the map a map
 * rather than a paint chart.
 */
function politicalFill(id: string): string {
  let hash = 0;
  for (let at = 0; at < id.length; at++) {
    hash = (hash * 31 + id.charCodeAt(at)) % 360;
  }
  return `hsl(${hash} 55% 55%)`;
}

/** Which layers are drawn. Remembered, because it is a preference. */
interface Layers {
  readonly political: boolean;
  readonly labels: boolean;
  readonly marks: boolean;
}

const LAYERS_KEY = 'opendnd.map.layers';
const LAYERS_DEFAULT: Layers = {
  political: true,
  labels: true,
  marks: true,
};

function readLayers(): Layers {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (!raw) return LAYERS_DEFAULT;
    return { ...LAYERS_DEFAULT, ...(JSON.parse(raw) as Partial<Layers>) };
  } catch {
    return LAYERS_DEFAULT;
  }
}

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
export function MapSurface() {
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
  const baseMap = asBaseMap(world.id, base.data?.map);
  const deepest = baseMap?.maxZoom ?? DEEPEST_ZOOM;

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);
  const [layers, setLayers] = useState<Layers>(readLayers);
  const toggle = (which: keyof Layers) =>
    setLayers((was) => {
      const next = { ...was, [which]: !was[which] };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        // A browser that keeps nothing still draws the map.
      }
      return next;
    });
  const political = useRef<L.LayerGroup | null>(null);
  const held = useRef<L.LayerGroup | null>(null);
  const resizing = useRef<ResizeObserver | null>(null);
  const clickRef =
    useRef<(at: { lat: number; lng: number }) => void>(undefined);
  const [view, setView] = useState<Viewport>();
  const [preview, setPreview] = useState<Entry>();
  const [placeLevel, setPlaceLevel] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [placeError, setPlaceError] = useState<Error>();
  const [notice, setNotice] = useState<string>();
  // Closed by default: the map is the thing, and a list over it is a choice.
  const [listing, setListing] = useState(false);

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
    // A world is round east to west and stops at its poles, which is what
    // every map of a globe does: sail west from one coast and you arrive at
    // the other, so the map repeats sideways and fills any window with world
    // rather than with nothing. North and south it ends, and the view is held
    // there rather than drifting off into blank paper.
    const poles = L.latLngBounds([-85.05, -720], [85.05, 720]);
    const map = L.map(element, {
      minZoom: baseMap?.minZoom ?? 0,
      maxZoom: deepest,
      maxBounds: poles,
      maxBoundsViscosity: 0.6,
      worldCopyJump: true,
      attributionControl: baseMap?.attribution !== undefined,
      // Where every map on the web puts them, and out of the way of the
      // things that float over the top left.
      zoomControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    if (baseMap) {
      L.tileLayer(baseMap.tiles, {
        minZoom: baseMap.minZoom ?? 0,
        maxZoom: deepest,
        // The tiles repeat: the API draws the column east of the last as
        // the first again.
        noWrap: false,
        ...(baseMap.attribution ? { attribution: baseMap.attribution } : {}),
      }).addTo(map);
    }
    // Ground first, so a name is never behind the shading of its own land.
    political.current = L.layerGroup().addTo(map);
    held.current = L.layerGroup().addTo(map);
    drawn.current = L.layerGroup().addTo(map);
    // Leaflet measures its box once and listens only to the window. This box
    // changes without the window doing anything — the sidebar collapses, the
    // panel opens, a block is resized on a canvas — and a map that has not
    // been told is a map drawn for a box it is no longer in, pinned to one
    // corner with a band of nothing beside it.
    const watching = new ResizeObserver(() => map.invalidateSize());
    watching.observe(element);
    resizing.current = watching;
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
      resizing.current?.disconnect();
      resizing.current = null;
      map.remove();
      mapRef.current = null;
      drawn.current = null;
      political.current = null;
      held.current = null;
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

  // What is in view, which is two questions. What is *inside* the squares under
  // the view — the towns and the encounters. And what the view is *inside* —
  // the county, the kingdom, the continent, whose own squares are far larger
  // than anything on screen and which the first question can never find.
  const plan = view ? coverage(view, { below: DRAWN_BELOW }) : undefined;
  const planKey = plan
    ? `${plan.cells.join(' ')}|${plan.points.join(' ')}|${plan.maxLevel}`
    : '';
  const records = useRequest(
    async () => {
      if (!plan) return [] as Entry[];
      const queries = [
        ...plan.cells.map((cell) => ({ cell, maxLevel: plan.maxLevel })),
        // One "whose ground is this" for each sampled spot, rather than
        // sweeping a whole face for everything coarse: a world of a hundred
        // and fifty kingdoms is all coarse, and every one of them would come
        // back. A spot rather than a square, because a kingdom holds its
        // ground in pieces smaller than the view.
        ...plan.points.map((cell) => ({ covers: cell })),
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

  /**
   * Draw what is in view.
   *
   * A big place is its name written across the map and a small one is a mark
   * with its name beside it, which is how every map anybody has used works.
   * It used to be drawn as the square of its quadtree cell, and a square is
   * the one thing a country is definitely not: the outline of a continent's
   * level-one cell is a rectangle in the sea with a coastline somewhere
   * inside it. The cell is how the map *finds* a place, not what it looks
   * like.
   */
  useEffect(() => {
    const group = drawn.current;
    if (!group || !view) return;
    group.clearLayers();
    const zoom = Math.round(view.zoom);
    const labelled = entries.length <= MOST_LABELS;
    // Nothing is drawn on top of something already drawn. Eighty places in a
    // corner of the world is eighty marks in a heap, which says less than one
    // does; the coarser a place is the earlier it comes, so what survives the
    // crowd is the biggest thing there. Zooming in gives the rest their room.
    const taken: { x: number; y: number }[] = [];
    const map = mapRef.current;
    for (const entry of entries) {
      const fill = fillOf(entry.model);
      const named = entry.cell.level <= zoom + NAMED_BELOW;
      let at = middleOf(entry) ?? centerOf(entry.cell);
      if (map) {
        // A place found because the view is *inside* it has its middle
        // somewhere off the screen — stand in the middle of a kingdom and the
        // cell its name hangs from can be a hundred miles away. So the name
        // of somewhere you are in is kept on the screen, sliding along the
        // edge as you pan, which is what every map does with a country.
        const size = map.getSize();
        const point = map.latLngToContainerPoint(at);
        const inside = {
          x: Math.min(Math.max(point.x, EDGE), Math.max(EDGE, size.x - EDGE)),
          y: Math.min(
            Math.max(point.y, EDGE_TOP),
            Math.max(EDGE_TOP, size.y - EDGE),
          ),
        };
        if (named && (inside.x !== point.x || inside.y !== point.y)) {
          at = map.containerPointToLatLng([inside.x, inside.y]);
        } else if (!named && (inside.x !== point.x || inside.y !== point.y)) {
          // A mark, unlike a name, belongs where the thing is or nowhere.
          continue;
        }
        const room = named ? CROWDED * 2 : CROWDED;
        const crowded = taken.some(
          (other) =>
            Math.abs(other.x - inside.x) < room &&
            Math.abs(other.y - inside.y) < room,
        );
        if (crowded) continue;
        taken.push({ x: inside.x, y: inside.y });
      }
      if (!named && !layers.marks) continue;
      if (named && !layers.labels) continue;
      const shape = named
        ? L.marker(at, {
            opacity: 0,
            interactive: true,
            keyboard: false,
          })
        : L.circleMarker(at, {
            radius: 4,
            color: fill,
            weight: 1.5,
            fillColor: fill,
            fillOpacity: 0.9,
          });
      shape.bindTooltip(nameOf(entry.resource), {
        permanent: named || labelled || entry.cell.level <= zoom + 1,
        direction: named ? 'center' : 'right',
        className: named ? 'map-label map-label-wide' : 'map-label',
        ...(named ? {} : { offset: [8, 0] }),
      });
      shape.on('click', (event) => {
        if (placing.data) clickRef.current?.(event.latlng);
        else setPreview(entry);
      });
      shape.addTo(group);
    }
    // fillOf is a function of models, which modelsKey stands for.
  }, [entries, view, modelsKey, placing.data, layers.labels, layers.marks]);

  /**
   * The political layer: who holds what, in colour, always on.
   *
   * It is drawn from the places in view that own ground, rolled up to a
   * level worth seeing at this zoom and partitioned so no coarse cell is
   * claimed twice. One path per place rather than one per cell: a hundred
   * squares as a hundred shapes shows a hundred seams where their edges
   * meet, and as one shape shows a country.
   */
  const politicalLevel = view ? Math.max(2, Math.round(view.zoom) + 2) : 5;
  const rings = useMemo(
    () =>
      layers.political ? politicalRings(entries, politicalLevel) : undefined,
    [entries, politicalLevel, layers.political],
  );
  useEffect(() => {
    const group = political.current;
    if (!group) return;
    group.clearLayers();
    if (!rings) return;
    for (const [key, shapes] of rings) {
      const id = key.slice(key.indexOf('/') + 1);
      L.polygon(
        shapes.map((ring) =>
          ring.map((p) => [p.lat, p.lng] as [number, number]),
        ),
        {
          stroke: false,
          fillColor: politicalFill(id),
          fillOpacity: 0.28,
          interactive: false,
        },
      ).addTo(group);
    }
  }, [rings]);

  /**
   * The ground the picked-out place holds, shaded.
   *
   * This is the one honest way to show a country's shape: not a bounding
   * square but the cells it actually owns, which is what the record says and
   * what a border moving would change.
   */
  useEffect(() => {
    const group = held.current;
    if (!group) return;
    group.clearLayers();
    const extent = preview?.resource.extent;
    if (!Array.isArray(extent)) return;
    const fill = fillOf(preview!.model);
    const shapes: [number, number][][] = [];
    for (const token of extent.slice(0, MOST_CELLS)) {
      const cell = parseCell(String(token));
      const outline = cell && outlineOf(cell);
      if (!outline) continue;
      shapes.push(outline.map((p) => [p.lat, p.lng] as [number, number]));
    }
    if (shapes.length === 0) return;
    // One shape, not one per cell: separate shapes show a seam wherever two
    // of them touch, which reads as a grid rather than as a country.
    L.polygon(shapes, {
      color: fill,
      weight: 1,
      opacity: 0.8,
      fillColor: fill,
      fillOpacity: 0.25,
      interactive: false,
    }).addTo(group);
    // fillOf is a function of models, which modelsKey stands for.
  }, [preview, modelsKey]);

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

  /**
   * Where a place's name belongs: the middle of the ground it holds.
   *
   * A record says where it is with one cell, and for a continent that cell is a
   * quarter of a face — a square whose centre can be a thousand miles out to
   * sea. Where a place also says which cells it *holds*, that is the real
   * answer, and the name goes in the middle of it.
   */
  function middleOf(entry: Entry): { lat: number; lng: number } | undefined {
    const extent = entry.resource.extent;
    if (!Array.isArray(extent) || extent.length === 0) return undefined;
    let lat = 0;
    let lng = 0;
    let count = 0;
    for (const token of extent) {
      const cell = parseCell(String(token));
      if (!cell) continue;
      const at = centerOf(cell);
      lat += at.lat;
      lng += at.lng;
      count += 1;
    }
    return count === 0 ? undefined : { lat: lat / count, lng: lng / count };
  }

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
    /*
     * The map is the page. Everything else floats over it — the search, what
     * is in view, the year, the zoom — because a map with a rail beside it is
     * a map you are looking at through a letterbox, and every map anybody
     * uses gives the whole window to the ground and puts its controls on top.
     */
    <div className="relative h-full min-h-96 overflow-hidden rounded-lg border">
      <div
        ref={container}
        role="application"
        aria-label="Map of the world"
        className={`absolute inset-0 ${placing.data ? 'cursor-crosshair' : ''}`}
      />

      {/*
        Above the map's own layers. Leaflet stacks its panes up to 800 and its
        controls on top of those, so anything floating over the ground has to
        say where it stands or it ends up under the tiles.
      */}
      <div className="pointer-events-none absolute inset-0 z-[1000] flex flex-col gap-2 p-3">
        <div className="flex items-start gap-2">
          <div className="pointer-events-auto flex w-72 flex-col gap-2">
            <Find world={world.id} onFound={(hit) => void found(hit)} />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full bg-background shadow-lg"
                aria-expanded={listing}
                onClick={() => setListing(!listing)}
              >
                <ListIcon data-icon="inline-start" />
                {records.loading && !records.data
                  ? 'Looking'
                  : entries.length === 0
                    ? 'Nothing in view'
                    : `${entries.length} in view`}
              </Button>
              <LayersButton layers={layers} onToggle={toggle} />
            </div>
            {preview && (
              /*
                What you clicked, over the map and beside it — not a drawer
                from the right. A place on a map is looked at *with* the map:
                the mark stays where it is, the ground stays visible, and
                clicking somewhere else moves the card rather than opening a
                second one. Closing it leaves you where you were.
              */
              <div
                role="group"
                aria-label={nameOf(preview.resource)}
                className="flex max-h-[26rem] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
              >
                <div className="flex items-start gap-2 border-b p-3">
                  <div className="flex min-w-0 flex-col">
                    <p className="font-display truncate text-lg leading-tight">
                      {nameOf(preview.resource)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ontology.label(preview.model)}
                      {typeof preview.resource.type === 'string' &&
                        ` · ${humanize(preview.resource.type)}`}
                      {Array.isArray(preview.resource.extent) &&
                        ` · ${preview.resource.extent.length} cells held`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto shrink-0"
                    aria-label="Close"
                    onClick={() => setPreview(undefined)}
                  >
                    <XIcon />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                  {typeof preview.resource.description === 'string' &&
                  preview.resource.description !== '' ? (
                    <Markdown
                      text={preview.resource.description
                        .split(/\n\s*\n/)
                        .slice(0, 2)
                        .join('\n\n')}
                      className="prose-record text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing written about this yet.
                    </p>
                  )}
                </div>
                <div className="flex gap-2 border-t p-2">
                  <Button
                    size="sm"
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
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => go(preview)}
                  >
                    Centre on it
                  </Button>
                </div>
              </div>
            )}
            {listing && !preview && (
              <div className="max-h-[calc(100%-8rem)] overflow-y-auto rounded-lg border bg-background/95 p-2 text-sm shadow-lg backdrop-blur">
                <ul aria-label="In view" className="flex flex-col gap-0.5">
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
                <ul
                  aria-label="What the map draws"
                  className="mt-2 flex flex-wrap gap-x-3 border-t pt-2 text-xs text-muted-foreground"
                >
                  {models.map((m) => (
                    <li key={m.model} className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: fillOf(m.model) }}
                      />
                      {ontology.label(m.model)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="pointer-events-auto ml-auto flex items-center gap-2 rounded-full border bg-background px-2 py-1 shadow-lg">
            {view && (
              <span className="px-1 text-xs text-muted-foreground">
                Zoom {Math.round(view.zoom)}
              </span>
            )}
            <AsOf
              year={asOf}
              onChange={(year) =>
                keep((q) => (year ? q.set('at', year) : q.delete('at')))
              }
            />
          </div>
        </div>

        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
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
                Choose its spot on the map. It will take a level {level} cell;
                zoom in for a finer one, or set the level here.
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
          {!baseMap && base.data && !placing.data && !notice && (
            <p className="w-fit rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              This world has no picture tiles yet; its records are drawn on a
              blank globe.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Find a record by name and go to it on the map. */
/**
 * What the map draws, as a short list you can switch off.
 *
 * Every map anybody uses has this, and the reason is not that people want
 * to configure a map: it is that a map showing everything shows nothing,
 * and only the person looking knows which thing they came for.
 */
function LayersButton(props: {
  readonly layers: Layers;
  readonly onToggle: (which: keyof Layers) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows: { key: keyof Layers; label: string; note: string }[] = [
    { key: 'political', label: 'Political', note: 'Who holds what ground' },
    { key: 'labels', label: 'Names', note: 'Countries and regions' },
    { key: 'marks', label: 'Places', note: 'Towns, and everything smaller' },
  ];
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="rounded-full bg-background shadow-lg"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <LayersIcon data-icon="inline-start" />
        Layers
      </Button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 flex w-56 flex-col rounded-lg border bg-background p-1 shadow-lg">
          {rows.map((row) => (
            <Label
              key={row.key}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-accent"
            >
              {/* The registry's checkbox rather than a square drawn by hand. */}
              <Checkbox
                className="mt-0.5"
                checked={props.layers[row.key]}
                onCheckedChange={() => props.onToggle(row.key)}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-tight">{row.label}</span>
                <span className="text-xs text-muted-foreground">
                  {row.note}
                </span>
              </span>
            </Label>
          ))}
        </div>
      )}
    </div>
  );
}

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
      {/* A pill floating over the ground, the way every map has one. */}
      <div className="relative rounded-full border bg-background shadow-lg">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="h-10 rounded-full border-transparent bg-transparent pl-9 text-sm shadow-none"
          placeholder="Find on the map"
          aria-label="Find on the map"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <ErrorNotice error={error} />}
      {hits && (
        <ul className="flex flex-col gap-0.5 rounded-lg border bg-background/95 p-1 text-sm shadow-lg backdrop-blur">
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

/**
 * The pictures drawn beneath a world's records, as the world's own record
 * describes them. A world that says nothing about where its tiles are is
 * drawn from the ones it holds itself, which is where a map imported into
 * this deployment puts them; a world may name a template instead when its
 * pictures live somewhere else on the web.
 */
function asBaseMap(world: string, value: unknown): BaseMap | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const map = value as Record<string, unknown>;
  // A world drawn from its own coastlines is asked for SVG, which is rendered
  // when the tile is wanted and is therefore right at any depth. One that has
  // pictures somebody made is asked for those, which stop where they stop.
  const drawn = map.source === 'terrain';
  const own = `${config.apiUrl}/v1/worlds/${world}/tiles/{z}/{x}/{y}.${drawn ? 'svg' : 'png'}`;
  return {
    tiles: typeof map.tiles === 'string' ? map.tiles : own,
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

/** The map page: one block, filling the window. */
export function MapPage() {
  return <Page page={usePageLayout('map')} />;
}
