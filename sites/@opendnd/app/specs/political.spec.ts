import { describe, expect, it } from 'vitest';
import { cellAt, parseCell } from 'src/schema/cells';
import { type Holding, groundOf, levelToDraw, rollUp } from 'src/schema/ground';

/**
 * The political layer decides, for every patch of ground it draws, which one
 * place holds it, and draws a border wherever that answer changes. Both are
 * worth testing apart from the map that draws them, and with invented cells,
 * so no world's content is needed to say what a border is.
 */

const face = 2;

/** A place the layer will read: a place, and the cells it holds. */
function place(id: string, cells: readonly string[]): Holding {
  return { model: 'place', resource: { id, extent: [...cells] } };
}

/** The four fine cells in the corner of a coarse one at `level`. */
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
    const ground = groundOf([place('a', within(4, 4, 6, 7))], 6);
    expect([...ground.keys()]).toEqual(['place/a']);
    // Four fine cells that fill one coarse cell are one coarse shape.
    expect(ground.get('place/a')?.fills).toHaveLength(1);
  });

  it('keeps a place of two islands as two blocks, so the second is not a hole', () => {
    const ground = groundOf(
      [place('isles', [...within(1, 1, 6, 7), ...within(12, 12, 6, 7)])],
      6,
    );
    expect(ground.get('place/isles')?.fills).toHaveLength(2);
  });

  it('gives contested ground to the smaller holder, because places nest', () => {
    const ground = within(4, 4, 6, 7);
    const drawn = groundOf(
      [
        // A continent over the same ground and a great deal more.
        place('continent', [...ground, ...within(5, 4, 6, 7)]),
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
    expect(drawn.get('place/kingdom')?.fills).toHaveLength(1);
    expect(drawn.get('place/continent')?.fills).toHaveLength(1);
  });

  it('leaves a cell to the same place every time, so the map does not flicker', () => {
    const ground = within(4, 4, 6, 7);
    const one = groundOf([place('b', ground), place('a', ground)], 6);
    const other = groundOf([place('a', ground), place('b', ground)], 6);
    expect([...one.keys()]).toEqual([...other.keys()]);
  });

  it('draws nothing for a place that holds no ground', () => {
    expect(groundOf([{ model: 'place', resource: { id: 'c' } }], 6).size).toBe(
      0,
    );
  });

  it('merges four cells of one place into their parent, which loses nothing', () => {
    // The whole of a level-five cell, held as its four level-six children.
    const quarters = [
      cellAt(face, 8, 8, 6).token,
      cellAt(face, 9, 8, 6).token,
      cellAt(face, 8, 9, 6).token,
      cellAt(face, 9, 9, 6).token,
    ];
    const ground = groundOf([place('whole', quarters)], 6);
    const held = ground.get('place/whole');
    // One ring around the four, with no line through the middle of it, and
    // one point per corner rather than one per step: a square is a square.
    expect(held?.fills).toHaveLength(1);
    expect(held?.fills[0]).toHaveLength(5);
    // Nobody is across any of it, so none of it is a border.
    expect(held?.borders).toHaveLength(0);
  });
});

describe('where a holding ends', () => {
  it('draws no line between two cells of the same place', () => {
    // Two cells side by side are one shape of six sides, not two of four.
    const domino = [cellAt(face, 8, 8, 6).token, cellAt(face, 9, 8, 6).token];
    const ground = groundOf([place('pair', domino)], 6);
    expect(ground.get('place/pair')?.fills).toHaveLength(1);
    expect(ground.get('place/pair')?.fills[0]).toHaveLength(7);
  });

  /*
   * A coarse cell beside a fine one is the case the whole design rests on:
   * who holds the ground across a side is asked of the cells a place owns at
   * whatever level it owns them, so a country drawn coarse inland and fine
   * along its edge has no seam where the two meet.
   */
  const coarse = cellAt(face, 4, 4, 6).token;
  const fine = cellAt(face, 10, 9, 7).token;

  it('asks who holds the ground across a side, not who holds a cell of its own level', () => {
    const ground = groundOf([place('a', [coarse, fine])], 7);
    const held = ground.get('place/a');
    /*
     * A coarse cell and the fine cell on its flank are one shape: the side
     * each turns towards the other is dropped from both, and what is left
     * closes into one ring around the pair — seven stretches for the seven
     * turns an L makes, counting the corner the two blocks share. The join is
     * the thing that must not be drawn.
     */
    expect(held?.fills).toHaveLength(1);
    expect(held?.fills[0]).toHaveLength(8);
    // Nobody else holds anything, so none of that outline is a border.
    expect(held?.borders).toHaveLength(0);
  });

  /*
   * An outline that does not close is not an outline. Anything drawing it as
   * a shape has to close it, and the only thing it can do is run a straight
   * line from the last point back to the first — across the country, through
   * whatever is in the way. So the shape of a ragged holding is worth
   * checking rather than only the shape of a tidy one.
   */
  it('closes every outline it draws, however ragged the ground is', () => {
    const ragged = [
      ...within(3, 3, 6, 9),
      ...within(4, 3, 6, 8),
      cellAt(face, 20, 16, 8).token,
      cellAt(face, 21, 17, 8).token,
      cellAt(face, 16, 20, 8).token,
      cellAt(face, 13, 13, 7).token,
    ];
    const ground = groundOf(
      [place('ragged', ragged), place('n', [cellAt(face, 22, 17, 8).token])],
      9,
    );
    const held = ground.get('place/ragged');
    expect(held?.fills.length).toBeGreaterThan(1);
    for (const ring of held?.fills ?? []) {
      expect(ring.length).toBeGreaterThan(3);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  /*
   * A kingdom standing on a continent is the case that breaks an outline if
   * a place is drawn as the ground left to it rather than as the ground it
   * holds. The continent's square would need a hole cut in it where the
   * kingdom stands, and the continent never said where that hole's sides
   * are — so its outline would stop at the kingdom and be closed by a
   * straight line back across the continent.
   */
  it('outlines a continent whole, with the kingdom on it drawn over the top', () => {
    const province = cellAt(face, 5, 5, 6).token;
    const town = cellAt(face, 41, 41, 9).token;
    const ground = groundOf(
      [place('continent', [province]), place('kingdom', [town])],
      9,
    );
    // The continent keeps its square, all four corners of it...
    const continent = ground.get('place/continent');
    expect(continent?.fills).toHaveLength(1);
    expect(continent?.fills[0]).toHaveLength(5);
    expect(continent?.fills[0]?.[0]).toEqual(continent?.fills[0]?.[4]);
    // ...and the kingdom is drawn after it, so it is drawn on top of it.
    expect([...ground.keys()]).toEqual(['place/continent', 'place/kingdom']);
    const kingdom = ground.get('place/kingdom');
    expect(kingdom?.fills[0]).toHaveLength(5);
    // The kingdom's edge is the continent's ground, so all of it is border.
    expect(kingdom?.borders).toHaveLength(1);
  });

  it('moves the line when a cell changes hands, which is all a border moving is', () => {
    const ground = groundOf([place('a', [coarse]), place('b', [fine])], 7);
    const held = ground.get('place/a');
    // The same two cells, now in two hands. Each keeps its own outline, the
    // coarse one's east side breaking where the fine one's ground begins...
    expect(held?.fills).toHaveLength(1);
    expect(held?.fills[0]).toHaveLength(6);
    expect(ground.get('place/b')?.fills[0]).toHaveLength(5);
    // ...and the one step of side they share is a border, from both sides.
    expect(held?.borders).toHaveLength(1);
    expect(held?.borders[0]).toHaveLength(2);
    expect(ground.get('place/b')?.borders).toHaveLength(1);
  });
});

describe('how fine the ground is drawn', () => {
  /*
   * Drawing coarser than the ground is held has to lose something, and the
   * choice of what decides whether a coast comes out as a coast or as a
   * staircase in the sea. A square goes to a place when the place holds most
   * of it: a border that passes through a square hands it to one side, where
   * handing it to everyone whose ground touches it would draw it whole in
   * both colours and put half of each country out to sea.
   */
  it('hands a coarse square over for most of it, not for a corner of it', () => {
    const quarters = within(4, 4, 6, 7);
    expect(rollUp('all', quarters, 6)[0]?.part).toBe(1);
    expect(rollUp('half', quarters.slice(0, 2), 6)[0]?.part).toBe(0.5);
    expect(rollUp('corner', quarters.slice(0, 1), 6)[0]?.part).toBe(0.25);
  });

  it('keeps the square a place holds most of, so countries do not vanish', () => {
    // A place holding a sixteenth of each of two squares holds neither, but
    // it is still a place and is still drawn somewhere.
    const bits = [within(4, 4, 6, 8)[0]!, within(5, 5, 6, 8)[0]!];
    expect(rollUp('small', bits, 6)).toHaveLength(1);
  });

  it('draws as fine as a pixel can show', () => {
    // Held finely enough that the zoom is what limits it: level twelve is
    // about half a pixel at zoom five.
    expect(levelToDraw([place('a', within(4, 4, 6, 14))], 5)).toBe(12);
  });

  it('never asks finer than the ground has been held', () => {
    // Ground said in level-ten squares answers no question about level
    // fourteen ones, and a layer that asked anyway would go blank.
    expect(levelToDraw([place('a', within(4, 4, 6, 10))], 9)).toBe(10);
  });

  it('gives up levels rather than draw more shapes than it can', () => {
    // A place holding a great many fine cells cannot be drawn at the level a
    // pixel would allow, so the whole layer is drawn coarser.
    const many: string[] = [];
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) many.push(cellAt(face, i, j, 12).token);
    }
    expect(levelToDraw([place('big', many)], 5, 100)).toBeLessThan(12);
  });

  it('reads a token the same way the cells module does', () => {
    // The layer parses tokens itself, with a cache; it must agree.
    const token = cellAt(face, 3, 7, 9).token;
    const ground = groundOf([place('a', [token])], 9);
    const cell = parseCell(token)!;
    expect(cell.level).toBe(9);
    expect(ground.get('place/a')?.fills).toHaveLength(1);
  });
});
