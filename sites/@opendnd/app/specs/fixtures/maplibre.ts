/**
 * A stand-in for MapLibre: one camera, long-lived GeoJSON sources and DOM
 * markers, with enough of each exposed for the map specs to read what the
 * page drew.
 */

export interface FakeSource {
  data: {
    readonly type: 'FeatureCollection';
    readonly features: unknown[];
  };
  setData(data: FakeSource['data']): void;
}

export interface FakeMarker {
  readonly element: HTMLElement;
  lngLat?: { lng: number; lat: number };
  removed: boolean;
  setLngLat(at: [number, number]): FakeMarker;
  addTo(map: FakeMap): FakeMarker;
  remove(): void;
}

export class FakeMap {
  readonly handlers: Record<string, (event: unknown) => void> = {};
  readonly sources: Record<string, FakeSource> = {};
  readonly layers: unknown[] = [];
  readonly options: Record<string, unknown>;
  bounds = { north: 60, south: -10, east: 60, west: -60 };
  zoom = 4;
  center = { lat: 25, lng: 0 };
  removed = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    fake.map = this;
    queueMicrotask(() => this.fire('style.load', undefined));
  }

  on(event: string, handler: (event: unknown) => void) {
    this.handlers[event] = handler;
    return this;
  }

  fire(event: string, detail: unknown) {
    this.handlers[event]?.(detail);
  }

  addControl() {}

  addSource(id: string, options: { data: FakeSource['data'] }) {
    const source: FakeSource = {
      data: options.data,
      setData(data) {
        source.data = data;
      },
    };
    this.sources[id] = source;
  }

  getSource(id: string) {
    return this.sources[id];
  }

  addLayer(layer: unknown) {
    this.layers.push(layer);
  }

  getBounds() {
    const b = this.bounds;
    return {
      getNorth: () => b.north,
      getSouth: () => b.south,
      getEast: () => b.east,
      getWest: () => b.west,
    };
  }

  getCenter() {
    return this.center;
  }

  getZoom() {
    return this.zoom;
  }

  isStyleLoaded() {
    return false;
  }

  getContainer() {
    return {
      getBoundingClientRect: () => ({ width: 360 * 400, height: 180 * 400 }),
    };
  }

  /** Somewhere different for every place, so nothing is crowded out. */
  project(at: [number, number]) {
    return { x: (at[0] + 180) * 400, y: (90 - at[1]) * 400 };
  }

  unproject(point: [number, number]) {
    return { lat: 90 - point[1] / 400, lng: point[0] / 400 - 180 };
  }

  jumpTo(options: { center?: [number, number]; zoom?: number }) {
    if (options.center) {
      this.center = { lng: options.center[0], lat: options.center[1] };
    }
    if (options.zoom !== undefined) this.zoom = options.zoom;
    return this;
  }

  flyTo(options: { center?: [number, number]; zoom?: number }) {
    return this.jumpTo(options);
  }

  resize() {}

  triggerRepaint() {}

  remove() {
    this.removed = true;
  }
}

export const fake: {
  map?: FakeMap;
  markers: FakeMarker[];
} = { markers: [] };

export function reset() {
  fake.map = undefined;
  fake.markers = [];
}

export class Map extends FakeMap {}

export class Marker implements FakeMarker {
  readonly element: HTMLElement;
  lngLat?: { lng: number; lat: number };
  removed = false;

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
  }

  setLngLat(at: [number, number]) {
    this.lngLat = { lng: at[0], lat: at[1] };
    return this;
  }

  addTo() {
    fake.markers.push(this);
    return this;
  }

  remove() {
    this.removed = true;
    const at = fake.markers.indexOf(this);
    if (at >= 0) fake.markers.splice(at, 1);
  }
}

export class NavigationControl {}
export class AttributionControl {}

export function setWorkerUrl() {}
