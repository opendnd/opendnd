import * as maplibregl from 'maplibre-gl';
import {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
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
  cellAtLatLng,
  cellModels,
  centerOf,
  coverage,
  parseCell,
  zoomFor,
} from '../schema/cells';
import { groundOf, inView, levelToDraw } from '../schema/ground';
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

/**
 * The depth where an atlas stops naming continents and starts naming their
 * countries. Political places are always names on their ground, never dots:
 * the outline already says where they are.
 */
const POLITICAL_DETAIL_ZOOM = 5;

/** Up to this many things in view, every one is labelled. */
const MOST_LABELS = 40;
/** How near, in pixels, two marks may be before the second is left out. */
const CROWDED = 22;

/** How far from the edge a name is held when its own middle is off the map. */
const EDGE = 56;

/** And how far from the top, which is where the map's own controls float. */
const EDGE_TOP = 104;

/** How far a base map without its own limit may be zoomed. */
const DEEPEST_ZOOM = 14;

/** The whole globe, large enough to read and small enough to turn. */
const WORLD_ZOOM = 2.2;

/**
 * A colour for a place, the same one every time.
 *
 * A political map wants neighbours to differ and nothing else; it does not
 * want to mean anything. Hues off a hash give that without anybody keeping
 * a list, and holding saturation and lightness still keeps the map a map
 * rather than a paint chart.
 */
function hueOf(id: string): number {
  let hash = 0;
  for (let at = 0; at < id.length; at++) {
    hash = (hash * 31 + id.charCodeAt(at)) % 360;
  }
  return hash;
}

function politicalFill(id: string): string {
  return `hsl(${hueOf(id)} 55% 55%)`;
}

/** The same colour, dark enough to read as a line over its own ground. */
function politicalEdge(id: string): string {
  return `hsl(${hueOf(id)} 60% 32%)`;
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

/** Whether a political place belongs at this depth; undefined for other places. */
export function politicalLabelAt(
  type: unknown,
  zoom: number,
): boolean | undefined {
  if (type === 'continent') return zoom < POLITICAL_DETAIL_ZOOM;
  if (type === 'kingdom') return zoom >= POLITICAL_DETAIL_ZOOM;
  return undefined;
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

const POLITICAL_SOURCE = 'political-ground';
const BORDERS_SOURCE = 'political-borders';
const PREVIEW_SOURCE = 'picked-ground';

/** GeoJSON with nothing in it, for a source that will be filled after load. */
const emptyGeoJson = (): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

/** A ring in GeoJSON's longitude-first order. */
function coordinatesOf(ring: readonly LatLng[]): [number, number][] {
  return ring.map((point) => [point.lng, point.lat]);
}

/** Whether a point is inside a ring, on the flat unwrapped span of that ring. */
function insideRing(point: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const a = ring[at]!;
    const b = ring[before]!;
    const crosses =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng <
        ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Even-odd rings as GeoJSON polygons.
 *
 * The ground walker returns exactly what was drawn: closed rings, with a
 * ring inside another meaning a lake and a ring inside that meaning an
 * island. GeoJSON instead asks every island to be its own polygon and every
 * lake to follow the outer ring it cuts. Establishing each ring's nearest
 * container makes those two descriptions agree.
 */
function polygonsOf(rings: readonly LatLng[][]): [number, number][][][] {
  const parent = rings.map((ring, index) => {
    const point = ring[0];
    if (!point) return undefined;
    let nearest: number | undefined;
    let nearestArea = Infinity;
    for (let other = 0; other < rings.length; other++) {
      if (other === index || !insideRing(point, rings[other]!)) continue;
      const area = ringArea(rings[other]!);
      if (area < nearestArea) {
        nearest = other;
        nearestArea = area;
      }
    }
    return nearest;
  });
  const depth = (index: number): number => {
    let count = 0;
    let at = parent[index];
    while (at !== undefined && count <= rings.length) {
      count++;
      at = parent[at];
    }
    return count;
  };
  return rings.flatMap((ring, index) => {
    if (depth(index) % 2 !== 0) return [];
    const holes = rings
      .map((candidate, at) => ({ candidate, at }))
      .filter(({ at }) => parent[at] === index && depth(at) % 2 === 1)
      .map(({ candidate }) => coordinatesOf(candidate));
    return [[coordinatesOf(ring), ...holes]];
  });
}

/** Absolute planar area, used only to pick the nearest containing ring. */
function ringArea(ring: readonly LatLng[]): number {
  let twice = 0;
  for (let at = 0; at < ring.length; at++) {
    const a = ring[at]!;
    const b = ring[(at + 1) % ring.length]!;
    twice += a.lng * b.lat - b.lng * a.lat;
  }
  return Math.abs(twice) / 2;
}

/** Replace the contents of one of the map's long-lived GeoJSON sources. */
function setGeoJson(
  map: MapLibreMap,
  id: string,
  features: readonly Feature<Geometry>[],
): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData({ type: 'FeatureCollection', features: [...features] });
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
  const startsWithView = useRef(
    params.has('cell') || (params.has('ll') && params.has('z')),
  );
  const centredWorld = useRef(false);
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
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

  // One map from the whole planet to a street-sized cell. MapLibre projects
  // the same Mercator picture tiles onto a globe while the whole world is in
  // view, then eases them back to their flat tile grid as it is approached.
  // There is consequently one camera and one set of overlays rather than a
  // globe and a slippy map trying to hand the view back and forth.
  useEffect(() => {
    const element = container.current;
    if (!element || base.loading || mapRef.current) return undefined;
    const raster: Record<
      string,
      {
        type: 'raster';
        tiles: string[];
        tileSize: number;
        minzoom: number;
        maxzoom: number;
        attribution?: string;
      }
    > = {};
    if (baseMap) {
      raster.world = {
        type: 'raster',
        tiles: [baseMap.tiles],
        tileSize: 256,
        minzoom: baseMap.minZoom ?? 0,
        maxzoom: deepest,
        ...(baseMap.attribution ? { attribution: baseMap.attribution } : {}),
      };
    }
    const map = new maplibregl.Map({
      container: element,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: raster,
        layers: [
          {
            id: 'world-background',
            type: 'background',
            paint: { 'background-color': '#dbe7df' },
          },
          ...(baseMap
            ? [
                {
                  id: 'world',
                  type: 'raster' as const,
                  source: 'world',
                },
              ]
            : []),
        ],
        sky: {
          'atmosphere-blend': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            1,
            5,
            1,
            7,
            0,
          ],
        },
      },
      minZoom: baseMap?.minZoom ?? 0,
      maxZoom: deepest,
      center: [0, 0],
      zoom: WORLD_ZOOM,
      attributionControl: false,
      renderWorldCopies: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    );
    if (baseMap?.attribution) {
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      );
    }
    // A map measures its box once and listens only to the window. This box
    // changes without the window doing anything — the sidebar collapses, the
    // panel opens, a block is resized on a canvas — and a map that has not
    // been told is a map drawn for a box it is no longer in, pinned to one
    // corner with a band of nothing beside it.
    const watching = new ResizeObserver(() => map.resize());
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
    map.on('click', (event) =>
      clickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
    );
    map.on('load', () => {
      for (const id of [POLITICAL_SOURCE, BORDERS_SOURCE, PREVIEW_SOURCE]) {
        map.addSource(id, { type: 'geojson', data: emptyGeoJson() });
      }
      map.addLayer({
        id: 'political-fill',
        type: 'fill',
        source: POLITICAL_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.34,
          'fill-outline-color': ['get', 'color'],
        },
      });
      map.addLayer({
        id: 'political-border',
        type: 'line',
        source: BORDERS_SOURCE,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.4,
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'picked-fill',
        type: 'fill',
        source: PREVIEW_SOURCE,
        filter: ['==', ['get', 'part'], 'fill'],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.3,
        },
      });
      map.addLayer({
        id: 'picked-border',
        type: 'line',
        source: PREVIEW_SOURCE,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.95,
        },
      });
      const cell = parseCell(params.get('cell'));
      const ll = params.get('ll')?.split(',').map(Number);
      const z = Number(params.get('z'));
      if (cell) {
        const at = centerOf(cell);
        map.jumpTo({
          center: [at.lng, at.lat],
          zoom: Math.min(zoomFor(cell.level), deepest),
        });
      } else if (
        ll &&
        ll.length === 2 &&
        ll.every(Number.isFinite) &&
        Number.isFinite(z)
      ) {
        map.jumpTo({ center: [ll[1]!, ll[0]!], zoom: z });
      }
      read();
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      resizing.current?.disconnect();
      resizing.current = null;
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
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
  /**
   * Every place that holds ground, for the political layer.
   *
   * The view fetch samples a handful of spots, which is enough to name what
   * you are looking at and the wrong way to colour a country: a kingdom
   * whose capital is off-screen would simply not be drawn. The census is
   * the whole layer; a hundred and fifty kingdoms is one page.
   */
  const census = useRequest(async () => {
    if (!layers.political) return [] as Entry[];
    const pages = await Promise.all(
      models.map(async (m) => {
        const resources: Resource[] = [];
        let cursor: string | undefined;
        do {
          const page = await api.list(world.id, m.model, {
            limit: 500,
            ...(cursor ? { cursor } : {}),
            ...(asOf ? { at: asOf } : {}),
          });
          resources.push(...page.resources);
          cursor = page.next;
        } while (cursor !== undefined);
        return resources.map((resource) => ({ m, resource }));
      }),
    );
    const entries: Entry[] = [];
    for (const { m, resource } of pages.flat()) {
      if (!Array.isArray(resource.extent) || resource.extent.length === 0) {
        continue;
      }
      const cell = parseCell(resource[m.field]);
      if (cell) {
        entries.push({ model: m.model, field: m.field, resource, cell });
      }
    }
    return entries;
  }, [api, world.id, modelsKey, asOf, layers.political]);

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
  // At planetary scale the meaningful things in view are the continents,
  // not a sample of whichever seats happen to face the camera. The census is
  // already the complete political layer, and MapLibre itself hides the
  // continent on the far side of the globe.
  const continents = (census.data ?? []).filter(
    (entry) => entry.resource.type === 'continent',
  );
  const entries =
    view && view.zoom < POLITICAL_DETAIL_ZOOM && continents.length > 0
      ? continents
      : (records.data ?? []);
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
    const map = mapRef.current;
    if (!map || !mapReady || !view) return;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    const zoom = Math.round(view.zoom);
    const labelled = entries.length <= MOST_LABELS;
    // Nothing is drawn on top of something already drawn. Eighty places in a
    // corner of the world is eighty marks in a heap, which says less than one
    // does; the coarser a place is the earlier it comes, so what survives the
    // crowd is the biggest thing there. Zooming in gives the rest their room.
    const taken: { x: number; y: number }[] = [];
    for (const entry of entries) {
      const fill = fillOf(entry.model);
      const political = politicalLabelAt(entry.resource.type, zoom);
      if (political === false) continue;
      const named = political ?? entry.cell.level <= zoom + NAMED_BELOW;
      // A political cell is its seat: imported from a name written on the
      // authored map and therefore guaranteed to lie on the country. An
      // extent's geometric middle can instead fall in a bay or between the
      // islands of an archipelago.
      let at =
        political === true
          ? centerOf(entry.cell)
          : (middleOf(entry) ?? centerOf(entry.cell));
      // A place found because the view is *inside* it has its middle
      // somewhere off the screen — stand in the middle of a kingdom and the
      // cell its name hangs from can be a hundred miles away. So the name
      // of somewhere you are in is kept on the screen, sliding along the
      // edge as you pan, which is what every map does with a country.
      const size = map.getContainer().getBoundingClientRect();
      const point = map.project([at.lng, at.lat]);
      const onGlobe = view.zoom < POLITICAL_DETAIL_ZOOM;
      const inside = onGlobe
        ? { x: point.x, y: point.y }
        : {
            x: Math.min(
              Math.max(point.x, EDGE),
              Math.max(EDGE, size.width - EDGE),
            ),
            y: Math.min(
              Math.max(point.y, EDGE_TOP),
              Math.max(EDGE_TOP, size.height - EDGE),
            ),
          };
      if (!onGlobe && named && (inside.x !== point.x || inside.y !== point.y)) {
        const moved = map.unproject([inside.x, inside.y]);
        at = { lat: moved.lat, lng: moved.lng };
      } else if (
        !onGlobe &&
        !named &&
        (inside.x !== point.x || inside.y !== point.y)
      ) {
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
      if (!named && !layers.marks) continue;
      if (named && !layers.labels) continue;
      const permanent =
        named || labelled || entry.cell.level <= Math.round(view.zoom) + 1;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = named
        ? 'map-label map-label-wide'
        : 'map-mark map-label';
      element.dataset.kind = named ? 'name' : 'marker';
      element.setAttribute('aria-label', nameOf(entry.resource));
      element.title = permanent ? '' : nameOf(entry.resource);
      if (named || permanent) {
        const text = document.createElement('span');
        text.className = named ? '' : 'map-mark-name';
        text.textContent = nameOf(entry.resource);
        element.append(text);
      }
      if (!named) {
        const dot = document.createElement('span');
        dot.className = 'map-mark-dot';
        dot.style.background = fill;
        element.prepend(dot);
      }
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (placing.data) clickRef.current?.(at);
        else setPreview(entry);
      });
      markers.current.push(
        new maplibregl.Marker({
          element,
          anchor: named ? 'center' : 'left',
          opacityWhenCovered: 0,
        })
          .setLngLat([at.lng, at.lat])
          .addTo(map),
      );
    }
    // fillOf is a function of models, which modelsKey stands for.
  }, [
    entries,
    view,
    modelsKey,
    placing.data,
    layers.labels,
    layers.marks,
    mapReady,
  ]);

  /**
   * The political layer: who holds what, in colour, always on.
   *
   * The ground is painted flat and seamless — blocks of one colour, drawn on
   * a pane the browser fades as a whole, so no cell's own edge shows through
   * another's. The only lines are borders, and a border is not a shape
   * anybody stored: it is the sides of the held cells whose far side belongs
   * to somebody else. Give a five-foot cell to the neighbour and the line
   * moves, which is the whole of what a border is.
   */
  const heldEntries = census.data ?? [];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || startsWithView.current || centredWorld.current) {
      return;
    }
    const continent = heldEntries
      .filter((entry) => entry.resource.type === 'continent')
      .sort(
        (a, b) =>
          (Array.isArray(b.resource.extent) ? b.resource.extent.length : 0) -
          (Array.isArray(a.resource.extent) ? a.resource.extent.length : 0),
      )[0];
    if (!continent) return;
    centredWorld.current = true;
    const at = centerOf(continent.cell);
    map.flyTo({
      center: [at.lng, at.lat],
      zoom: WORLD_ZOOM,
      essential: true,
    });
  }, [heldEntries, mapReady]);
  const showing = useMemo(
    () => (view ? inView(heldEntries, view) : heldEntries),
    [heldEntries, view],
  );
  const politicalLevel = useMemo(
    () => (view ? levelToDraw(showing, view.zoom) : 8),
    [showing, view?.zoom],
  );
  const ground = useMemo(
    () => (layers.political ? groundOf(showing, politicalLevel) : undefined),
    [showing, politicalLevel, layers.political],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const fills: Feature<Geometry>[] = [];
    const edges: Feature<Geometry>[] = [];
    if (ground) {
      for (const [key, held] of ground) {
        const id = key.slice(key.indexOf('/') + 1);
        const polygons = polygonsOf(held.fills);
        if (polygons.length > 0) {
          fills.push({
            type: 'Feature',
            properties: { id, color: politicalFill(id) },
            geometry: { type: 'MultiPolygon', coordinates: polygons },
          });
        }
        if (held.borders.length > 0) {
          edges.push({
            type: 'Feature',
            properties: { id, color: politicalEdge(id) },
            geometry: {
              type: 'MultiLineString',
              coordinates: held.borders.map(coordinatesOf),
            },
          });
        }
      }
    }
    setGeoJson(map, POLITICAL_SOURCE, fills);
    setGeoJson(map, BORDERS_SOURCE, edges);
  }, [ground, mapReady]);

  /**
   * The ground the picked-out place holds, shaded.
   *
   * This is the one honest way to show a country's shape: not a bounding
   * square but the cells it actually owns, which is what the record says and
   * what a border moving would change.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features: Feature<Geometry>[] = [];
    const extent = preview?.resource.extent;
    if (Array.isArray(extent) && preview) {
      const color = politicalFill(String(preview.resource.id));
      const level = view ? Math.max(8, Math.round(view.zoom) + 5) : 10;
      const shown = groundOf([preview], level).values().next().value;
      const polygons = polygonsOf(shown?.fills ?? []);
      if (polygons.length > 0) {
        features.push({
          type: 'Feature',
          properties: { color, part: 'fill' },
          geometry: { type: 'MultiPolygon', coordinates: polygons },
        });
      }
      if (shown && shown.borders.length > 0) {
        features.push({
          type: 'Feature',
          properties: { color, part: 'border' },
          geometry: {
            type: 'MultiLineString',
            coordinates: shown.borders.map(coordinatesOf),
          },
        });
      }
    }
    setGeoJson(map, PREVIEW_SOURCE, features);
    // fillOf is a function of models, which modelsKey stands for.
  }, [preview, modelsKey, view, mapReady]);

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
    const at = centerOf(entry.cell);
    mapRef.current?.flyTo({
      center: [at.lng, at.lat],
      zoom: Math.min(zoomFor(entry.cell.level), deepest),
      essential: true,
    });
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
    const cells: { at: { lat: number; lng: number }; level: number }[] = [];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const token of extent) {
      const cell = parseCell(String(token));
      if (!cell) continue;
      const at = centerOf(cell);
      const lat = (at.lat * Math.PI) / 180;
      const lng = (at.lng * Math.PI) / 180;
      const weight = 4 ** -cell.level;
      const flat = Math.cos(lat);
      x += flat * Math.cos(lng) * weight;
      y += flat * Math.sin(lng) * weight;
      z += Math.sin(lat) * weight;
      cells.push({ at, level: cell.level });
    }
    if (cells.length === 0) return undefined;
    // A centroid can sit in a bay or between islands. Put the name on one of
    // the largest interior cells nearest that centroid, so text always lands
    // on the place it names rather than in the sea beside it.
    const coarsest = Math.min(...cells.map((cell) => cell.level));
    return cells
      .filter((cell) => cell.level === coarsest)
      .reduce(
        (best, cell) => {
          const lat = (cell.at.lat * Math.PI) / 180;
          const lng = (cell.at.lng * Math.PI) / 180;
          const flat = Math.cos(lat);
          const score =
            flat * Math.cos(lng) * x +
            flat * Math.sin(lng) * y +
            Math.sin(lat) * z;
          return score > best.score ? { at: cell.at, score } : best;
        },
        { at: cells[0]!.at, score: -Infinity },
      ).at;
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
      <div className="absolute inset-0">
        <div
          ref={container}
          role="application"
          aria-label="Map of the world"
          className={`size-full ${placing.data ? 'cursor-crosshair' : ''}`}
        />
      </div>

      {/*
        Above MapLibre's one WebGL canvas and its controls, so the page's own
        search, notices and article card remain reachable over the planet.
      */}
      <div className="pointer-events-none absolute inset-0 z-1000 flex flex-col gap-2 p-3">
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
                className="flex max-h-104 flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
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
  // MapLibre uploads each tile as a WebGL texture. A terrain world therefore
  // asks the API for a cached PNG rendering of its live vector coastlines;
  // `terrain=1` distinguishes that from an imported pyramid of authored PNGs.
  const terrain = map.source === 'terrain';
  const own =
    `${config.apiUrl}/v1/worlds/${world}/tiles/{z}/{x}/{y}.png` +
    (terrain ? '?terrain=1' : '');
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
