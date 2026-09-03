import { describe, expect, it } from 'bun:test';
import { Rng } from '@opendnd/random';
import {
  CellId,
  MAX_LEVEL,
  faceUVToPoint,
  latLngToPoint,
  normalize,
  pointToFaceUVAuto,
  pointToLatLng,
  stToUV,
  uvToST,
} from 'src';

const rng = new Rng('spatial');
const randomLatLng = () => ({
  lat: rng.next() * 180 - 90,
  lng: rng.next() * 360 - 180,
});

describe('projection', () => {
  it('round-trips lat/lng through 3-D', () => {
    for (let k = 0; k < 200; k++) {
      const ll = randomLatLng();
      const back = pointToLatLng(latLngToPoint(ll));
      expect(back.lat).toBeCloseTo(ll.lat, 9);
      expect(back.lng).toBeCloseTo(ll.lng, 9);
    }
  });

  it('round-trips a point through face/uv and st', () => {
    for (let k = 0; k < 200; k++) {
      const p = latLngToPoint(randomLatLng());
      const { face, u, v } = pointToFaceUVAuto(p);
      expect(u).toBeGreaterThanOrEqual(-1 - 1e-12);
      expect(u).toBeLessThanOrEqual(1 + 1e-12);
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-12);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
      const q = normalize(faceUVToPoint(face, u, v));
      expect(q.x).toBeCloseTo(p.x, 12);
      expect(q.y).toBeCloseTo(p.y, 12);
      expect(q.z).toBeCloseTo(p.z, 12);
      expect(stToUV(uvToST(u))).toBeCloseTo(u, 12);
    }
  });
});

describe('CellId', () => {
  it('every point has exactly one cell per level and levels nest as prefixes', () => {
    for (let k = 0; k < 100; k++) {
      const ll = randomLatLng();
      const leaf = CellId.fromLatLng(ll, MAX_LEVEL);
      expect(leaf.isLeaf()).toBe(true);
      for (let level = 0; level < MAX_LEVEL; level++) {
        const cell = CellId.fromLatLng(ll, level);
        expect(cell.level()).toBe(level);
        expect(cell.contains(leaf)).toBe(true);
        expect(leaf.parent(level).equals(cell)).toBe(true);
        expect(cell.face()).toBe(leaf.face());
      }
    }
  });

  it('children partition the parent and are disjoint', () => {
    for (let k = 0; k < 50; k++) {
      const cell = CellId.fromLatLng(randomLatLng(), rng.int(0, 20));
      const kids = cell.children();
      expect(kids.length).toBe(4);
      let min = cell.rangeMax();
      let max = cell.rangeMin();
      for (const kid of kids) {
        expect(kid.level()).toBe(cell.level() + 1);
        expect(kid.parent().equals(cell)).toBe(true);
        expect(cell.contains(kid)).toBe(true);
        min = kid.rangeMin() < min ? kid.rangeMin() : min;
        max = kid.rangeMax() > max ? kid.rangeMax() : max;
      }
      expect(min).toBe(cell.rangeMin());
      expect(max).toBe(cell.rangeMax());
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          expect(kids[a].intersects(kids[b])).toBe(false);
        }
      }
    }
  });

  it('tokens and ij round-trip', () => {
    for (let k = 0; k < 100; k++) {
      const level = rng.int(0, MAX_LEVEL);
      const cell = CellId.fromLatLng(randomLatLng(), level);
      expect(CellId.fromToken(cell.token()).equals(cell)).toBe(true);
      const [i, j] = cell.ij();
      expect(CellId.fromFaceIJ(cell.face(), i, j, level).equals(cell)).toBe(
        true,
      );
    }
    expect(() => CellId.fromToken('xyz')).toThrow(SyntaxError);
  });

  it('a cell centre maps back to the same cell', () => {
    for (let k = 0; k < 100; k++) {
      const level = rng.int(0, 28);
      const cell = CellId.fromLatLng(randomLatLng(), level);
      expect(CellId.fromPoint(cell.center(), level).equals(cell)).toBe(true);
    }
  });

  it('neighbours are symmetric, distinct, and wrap across faces', () => {
    for (let k = 0; k < 100; k++) {
      const cell = CellId.fromLatLng(randomLatLng(), rng.int(1, 12));
      const ns = cell.neighbors();
      expect(new Set(ns.map((n) => n.token())).size).toBe(4);
      for (const n of ns) {
        expect(n.level()).toBe(cell.level());
        expect(n.equals(cell)).toBe(false);
        expect(n.neighbors().some((m) => m.equals(cell))).toBe(true);
      }
    }
    // A corner cell of face 0 has two neighbours on other faces.
    const corner = CellId.fromFaceIJ(0, 0, 0, 3);
    const faces = corner.neighbors().map((n) => n.face());
    expect(faces.filter((f) => f !== 0).length).toBe(2);
    // Each level-0 face touches four others.
    const face0 = CellId.fromFaceIJ(0, 0, 0, 0);
    expect(new Set(face0.neighbors().map((n) => n.face())).size).toBe(4);
  });

  it('rejects malformed ids and levels', () => {
    expect(() => CellId.fromFaceIJ(6, 0, 0, 1)).toThrow(RangeError);
    expect(() => CellId.fromFaceIJ(0, 2, 0, 1)).toThrow(RangeError);
    expect(() => CellId.fromLatLng({ lat: 0, lng: 0 }, 31)).toThrow(RangeError);
    expect(() => CellId.fromFaceIJ(0, 0, 0, 0).parent()).toThrow(RangeError);
  });
});
