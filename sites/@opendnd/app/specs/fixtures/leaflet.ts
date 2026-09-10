/**
 * A stand-in for the map library: enough of its surface for the map page to
 * make a map, draw on it and hear it move, with the drawing kept where a test
 * can read it and a way to fire its events.
 */
export interface FakeLayer {
  readonly kind: 'polygon' | 'marker' | 'name';
  readonly latlngs: unknown;
  readonly options: unknown;
  tooltip?: string;
  readonly handlers: Record<string, (event: unknown) => void>;
  bindTooltip(text: string): FakeLayer;
  on(event: string, handler: (event: unknown) => void): FakeLayer;
  addTo(group: unknown): FakeLayer;
}

export class FakeMap {
  /** Big enough to hold the whole of the projection below, so that nothing
   *  in a test is dropped for being off the screen. */
  getSize() {
    return { x: 360 * 400, y: 180 * 400 };
  }

  containerPointToLatLng(point: [number, number]) {
    return { lat: 90 - point[1] / 400, lng: point[0] / 400 - 180 };
  }

  /** Somewhere different for every place, so nothing is crowded out. */
  latLngToContainerPoint(at: { lat: number; lng: number }) {
    return { x: (at.lng + 180) * 400, y: (90 - at.lat) * 400 };
  }

  readonly handlers: Record<string, (event: unknown) => void> = {};
  bounds = { north: 60, south: -10, east: 60, west: -60 };
  zoom = 4;
  center = { lat: 25, lng: 0 };
  removed = false;
  on(event: string, handler: (event: unknown) => void) {
    this.handlers[event] = handler;
    return this;
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
  setView(
    center: { lat: number; lng: number } | [number, number],
    zoom: number,
  ) {
    this.center = Array.isArray(center)
      ? { lat: center[0], lng: center[1] }
      : center;
    this.zoom = zoom;
    return this;
  }
  flyTo(center: { lat: number; lng: number }, zoom: number) {
    return this.setView(center, zoom);
  }
  fitBounds() {
    return this;
  }
  remove() {
    this.removed = true;
  }
  /** What a test does in place of a person: move the map, or click it. */
  fire(event: string, detail: unknown) {
    this.handlers[event]?.(detail);
  }
}

export const fake: { map?: FakeMap; layers: FakeLayer[] } = { layers: [] };

/** Start again, for a test that wants a clean map. */
export function reset() {
  fake.map = undefined;
  fake.layers = [];
}

function layer(
  kind: FakeLayer['kind'],
  latlngs: unknown,
  options: unknown,
): FakeLayer {
  const made: FakeLayer = {
    kind,
    latlngs,
    options,
    handlers: {},
    bindTooltip(text) {
      made.tooltip = text;
      return made;
    },
    on(event, handler) {
      made.handlers[event] = handler;
      return made;
    },
    addTo() {
      fake.layers.push(made);
      return made;
    },
  };
  return made;
}

const L = {
  map: () => {
    fake.map = new FakeMap();
    return fake.map;
  },
  tileLayer: () => ({ addTo: () => undefined }),
  layerGroup: () => {
    const group = {
      addTo: () => group,
      clearLayers: () => {
        fake.layers = [];
      },
    };
    return group;
  },
  polygon: (latlngs: unknown, options: unknown) =>
    layer('polygon', latlngs, options),
  circleMarker: (latlng: unknown, options: unknown) =>
    layer('marker', latlng, options),
  // A big place is a name written on the map, which is an invisible marker
  // carrying a tooltip.
  marker: (latlng: unknown, options: unknown) => layer('name', latlng, options),
  control: { zoom: () => ({ addTo: () => undefined }) },
};

export default L;
