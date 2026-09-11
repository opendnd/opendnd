import { describe, expect, it } from 'vitest';
import { politicalRings } from 'src/pages/Map';
import { cellAt, parseCell } from 'src/schema/cells';

/**
 * The political layer decides, for every patch of ground it draws, which
 * one place holds it. That is the whole of what a political map asserts, so
 * it is worth testing apart from the map that draws it.
 */

const face = 2;

/** An entry the layer will read: a place, and the fine cells it holds. */
function place(id: string, cells: readonly string[]) {
  const first = parseCell(cells[0]!)!;
  return {
    model: 'place',
    field: 'cell',
    resource: { id, name: id, extent: [...cells] } as never,
    cell: first,
  };
}

/** Four fine cells, the corners of one coarse one at `level`. */
function within(i: number, j: number, level: number, fine: number): string[] {
  const span = 2 ** (fine - level);
  return [
    cellAt(face, i * span, j * span, fine).token,
    cellAt(face, i * span + 1, j * span, fine).token,
    cellAt(face, i * span, j * span + 1, fine).token,
    cellAt(face, i * span + 1, j * span + 1, fine).token,
  ];
}

describe('who holds the ground a political layer draws', () => {
  it('gives a place one shape, whatever it is made of', () => {
    const rings = politicalRings([place('a', within(4, 4, 6, 10))], 6);
    expect([...rings.keys()]).toEqual(['place/a']);
    // Four fine cells inside one coarse cell are one coarse shape, not four.
    expect(rings.get('place/a')).toHaveLength(1);
  });

  it('gives contested ground to the smaller holder, because places nest', () => {
    const ground = within(4, 4, 6, 10);
    const rings = politicalRings(
      [
        // A continent over the same ground and a great deal more.
        place('continent', [...ground, ...within(5, 4, 6, 10)]),
        place('kingdom', ground),
      ],
      6,
    );
    /*
     * The continent holds more of the contested cell than the kingdom does
     * — it holds all of it — so counting claims would give it everything
     * and paint the map in one colour. What a political map means by a
     * border is the most specific holder.
     */
    expect(rings.get('place/kingdom')).toHaveLength(1);
    expect(rings.get('place/continent')).toHaveLength(1);
  });

  it('leaves a cell to the same place every time, so the map does not flicker', () => {
    const ground = within(4, 4, 6, 10);
    const one = politicalRings([place('b', ground), place('a', ground)], 6);
    const other = politicalRings([place('a', ground), place('b', ground)], 6);
    expect([...one.keys()]).toEqual([...other.keys()]);
  });

  it('draws nothing for a place that holds no ground', () => {
    const rings = politicalRings(
      [
        {
          model: 'place',
          field: 'cell',
          resource: { id: 'c', name: 'c' } as never,
          cell: parseCell(cellAt(face, 1, 1, 4).token)!,
        },
      ],
      6,
    );
    expect(rings.size).toBe(0);
  });
});
