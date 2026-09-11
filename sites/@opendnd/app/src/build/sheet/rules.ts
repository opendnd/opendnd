/**
 * The arithmetic of a character sheet.
 *
 * Every number here is derived and none of it is stored. A modifier is a
 * function of a score, a proficiency bonus is a function of a level, and a
 * spell save DC is a function of both — so storing any of them would be
 * storing a thing that can disagree with the record it came from. Change the
 * score and the sheet changes; there is nothing to keep in step.
 *
 * What the rules need beyond the character — which ability a skill uses, how
 * many sides a class's hit die has — is read from the world's own records,
 * not from a table written here. A world that gives Perception to Wisdom and
 * a world that gives it to Intelligence both get a sheet that adds up.
 */

export type Ability =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export const ABILITIES: readonly Ability[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** The three-letter form a sheet prints. */
export const SHORT: Record<Ability, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

export type Scores = Partial<Record<Ability, number>>;

/**
 * The modifier for a score: how far it is from average, halved.
 *
 * A missing score is 10 rather than 0, because a sheet half filled in should
 * read as an ordinary person, not as one who cannot lift a cup.
 */
export function modifierOf(score: number | undefined): number {
  return Math.floor(((score ?? 10) - 10) / 2);
}

/** Two at first level, and one more every four levels after the fourth. */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/** A character's level: what they say, or the sum of their classes. */
export function levelOf(character: {
  level?: unknown;
  class?: unknown;
}): number {
  if (typeof character.level === 'number' && character.level > 0) {
    return character.level;
  }
  const classes = Array.isArray(character.class) ? character.class : [];
  const summed = classes.reduce(
    (total: number, one) =>
      total +
      (typeof (one as { level?: unknown })?.level === 'number'
        ? (one as { level: number }).level
        : 0),
    0,
  );
  return Math.max(1, summed);
}

/** A bonus with its sign, the way a sheet writes it. */
export function signed(bonus: number): string {
  return bonus < 0 ? `−${Math.abs(bonus)}` : `+${bonus}`;
}

/** A check or a save: the ability's modifier, and the bonus if proficient. */
export function bonusFor(
  ability: Ability,
  scores: Scores,
  proficiency: number,
  proficient: boolean,
): number {
  return modifierOf(scores[ability]) + (proficient ? proficiency : 0);
}

/** What somebody notices without looking: ten, plus the bonus. */
export function passive(bonus: number): number {
  return 10 + bonus;
}

/** Eight, the proficiency bonus, and the modifier of whatever casts. */
export function spellSaveDc(proficiency: number, modifier: number): number {
  return 8 + proficiency + modifier;
}

/** The same, without the eight. */
export function spellAttack(proficiency: number, modifier: number): number {
  return proficiency + modifier;
}

/**
 * The hit dice a character has, gathered by die.
 *
 * A multiclassed character has some of each, and a sheet says "3d8, 2d6"
 * rather than pretending they are the same die.
 */
export function hitDice(
  classes: readonly { class?: { id?: string }; level?: number }[],
  sidesOf: (id: string) => number | undefined,
): { die: number; count: number }[] {
  const byDie = new Map<number, number>();
  for (const taken of classes) {
    const sides = taken.class?.id ? sidesOf(taken.class.id) : undefined;
    if (!sides) continue;
    byDie.set(sides, (byDie.get(sides) ?? 0) + (taken.level ?? 0));
  }
  return [...byDie]
    .filter(([, count]) => count > 0)
    .map(([die, count]) => ({ die, count }))
    .sort((a, b) => b.die - a.die);
}

/** Hit dice as a sheet writes them: "3d8 · 2d6". */
export function hitDiceText(
  dice: readonly { die: number; count: number }[],
): string {
  return dice.map((one) => `${one.count}d${one.die}`).join(' · ');
}

export interface Health {
  readonly current: number;
  readonly maximum: number;
  readonly temporary: number;
  /** Where the bar stands, 0 to 1, temporary points included. */
  readonly share: number;
  readonly down: boolean;
}

/** Hit points as they stand, with the share a bar should fill. */
export function healthOf(value: unknown): Health {
  const hp = (value ?? {}) as {
    current?: unknown;
    maximum?: unknown;
    temporary?: unknown;
  };
  const maximum = typeof hp.maximum === 'number' ? hp.maximum : 0;
  const current = typeof hp.current === 'number' ? hp.current : 0;
  const temporary = typeof hp.temporary === 'number' ? hp.temporary : 0;
  return {
    current,
    maximum,
    temporary,
    share:
      maximum <= 0
        ? 0
        : Math.min(1, Math.max(0, (current + temporary) / maximum)),
    down: maximum > 0 && current <= 0,
  };
}
