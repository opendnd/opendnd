import { describe, expect, it } from 'vitest';
import { cellAt, centerOf, type View } from 'src/schema/cells';
import {
  dropWater,
  isPaintFill,
  isWaterColor,
  mercatorTile,
  paintEdge,
  rgbHex,
  sampleFill,
} from 'src/schema/paint';

describe('isWaterColor', () => {
  it('treats white, ice and the sea fill as water', () => {
    expect(isWaterColor(255, 255, 255)).toBe(true);
    expect(isWaterColor(235, 235, 235)).toBe(true);
    expect(isWaterColor(182, 209, 219)).toBe(true);
  });

  it('does not treat a painted country as water', () => {
    expect(isWaterColor(196, 98, 64)).toBe(false);
    expect(isWaterColor(120, 72, 160)).toBe(false);
    expect(isWaterColor(72, 140, 88)).toBe(false);
    expect(isWaterColor(180, 140, 200)).toBe(false);
  });
});

describe('isPaintFill', () => {
  it('accepts a country fill and refuses ink and paper', () => {
    expect(isPaintFill(196, 98, 64)).toBe(true);
    expect(isPaintFill(20, 20, 20)).toBe(false);
    expect(isPaintFill(250, 250, 250)).toBe(false);
  });
});

describe('sampleFill', () => {
  it('walks off the ink of a name onto the fill beside it', async () => {
    const colorAt = async (lat: number, lng: number) => {
      if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
        return [20, 20, 20] as const;
      }
      return [196, 98, 64] as const;
    };
    await expect(sampleFill(colorAt, 0, 0)).resolves.toEqual([196, 98, 64]);
  });
});

describe('rgbHex', () => {
  it('writes a CSS hex and a darker edge', () => {
    expect(rgbHex(182, 209, 219)).toBe('#b6d1db');
    expect(paintEdge('#c46240')).toBe('#582c1d');
  });
});

describe('mercatorTile', () => {
  it('puts the equator on the middle row of the world', () => {
    const { x, y } = mercatorTile(0, 0, 1);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
  });
});

describe('dropWater', () => {
  it('drops in-view cells that sample as the sea', async () => {
    const land = cellAt(2, 4, 4, 8);
    const sea = cellAt(2, 4, 5, 8);
    const at = centerOf(land);
    const view: View = {
      north: at.lat + 8,
      south: at.lat - 8,
      east: at.lng + 8,
      west: at.lng - 8,
      zoom: 4,
    };
    const held = await dropWater(
      [
        {
          model: 'place',
          resource: { id: 'beaucourt', extent: [land.token, sea.token] },
        },
      ],
      view,
      async (point) => {
        const here = centerOf(sea);
        if (
          Math.abs(point.lat - here.lat) < 0.01 &&
          Math.abs(point.lng - here.lng) < 0.01
        ) {
          return [182, 209, 219];
        }
        return [196, 98, 64];
      },
    );
    expect(held[0]?.resource.extent).toEqual([land.token]);
  });
});
