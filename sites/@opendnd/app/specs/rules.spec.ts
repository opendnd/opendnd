import { describe, expect, it } from 'vitest';
import {
  bonusFor,
  healthOf,
  hitDice,
  hitDiceText,
  levelOf,
  modifierOf,
  passive,
  proficiencyBonus,
  signed,
  spellAttack,
  spellSaveDc,
} from 'src/build/sheet/rules';

describe('the arithmetic of a sheet', () => {
  it('halves the distance from average, rounding down', () => {
    expect(modifierOf(10)).toBe(0);
    expect(modifierOf(11)).toBe(0);
    expect(modifierOf(12)).toBe(1);
    expect(modifierOf(20)).toBe(5);
    expect(modifierOf(1)).toBe(-5);
    expect(modifierOf(9)).toBe(-1);
    // A score nobody has filled in is an ordinary one, not a hopeless one.
    expect(modifierOf(undefined)).toBe(0);
  });

  it('adds a point to the proficiency bonus every four levels after the fourth', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([
      2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
    // Nobody is below first level, whatever the record says.
    expect(proficiencyBonus(0)).toBe(2);
  });

  it('takes the level a character states, and adds up their classes when they state none', () => {
    expect(levelOf({ level: 7 })).toBe(7);
    expect(levelOf({ classes: [{ level: 3 }, { level: 2 }] })).toBe(5);
    // A character with neither is first level, not level zero.
    expect(levelOf({})).toBe(1);
    expect(levelOf({ level: 0, classes: [] })).toBe(1);
  });

  it('writes a bonus with its sign, and a minus that is a minus', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('+0');
    expect(signed(-1)).toBe('−1');
  });

  it('adds the proficiency bonus only where somebody is proficient', () => {
    const scores = { dexterity: 16, wisdom: 13 };
    expect(bonusFor('dexterity', scores, 3, true)).toBe(6);
    expect(bonusFor('dexterity', scores, 3, false)).toBe(3);
    expect(bonusFor('wisdom', scores, 3, true)).toBe(4);
    expect(passive(bonusFor('wisdom', scores, 3, true))).toBe(14);
  });

  it('sets a spell save at eight plus the caster, and the attack at the same without it', () => {
    expect(spellSaveDc(3, 4)).toBe(15);
    expect(spellAttack(3, 4)).toBe(7);
  });

  it('keeps a multiclassed character’s hit dice apart, largest first', () => {
    const sides = (id: string) => ({ fighter: 10, wizard: 6, rogue: 8 })[id];
    const dice = hitDice(
      [
        { class: { id: 'wizard' }, level: 2 },
        { class: { id: 'fighter' }, level: 3 },
        { class: { id: 'rogue' }, level: 1 },
      ],
      sides,
    );
    expect(dice).toEqual([
      { die: 10, count: 3 },
      { die: 8, count: 1 },
      { die: 6, count: 2 },
    ]);
    expect(hitDiceText(dice)).toBe('3d10 · 1d8 · 2d6');
    // Two classes on the same die are one entry.
    expect(
      hitDice(
        [
          { class: { id: 'rogue' }, level: 2 },
          { class: { id: 'bard' }, level: 3 },
        ],
        (id) => ({ rogue: 8, bard: 8 })[id],
      ),
    ).toEqual([{ die: 8, count: 5 }]);
    // A class whose record is not to hand contributes nothing rather than NaN.
    expect(
      hitDice([{ class: { id: 'unknown' }, level: 5 }], () => undefined),
    ).toEqual([]);
  });

  it('reads hit points as they stand, and says when somebody is down', () => {
    expect(healthOf({ current: 12, maximum: 24 })).toMatchObject({
      current: 12,
      maximum: 24,
      temporary: 0,
      share: 0.5,
      down: false,
    });
    // Temporary points fill the bar but cannot overfill it.
    expect(healthOf({ current: 24, maximum: 24, temporary: 8 }).share).toBe(1);
    expect(healthOf({ current: 0, maximum: 24 }).down).toBe(true);
    // A character nobody has given hit points is not dying.
    expect(healthOf(undefined)).toMatchObject({ share: 0, down: false });
  });
});
