import { useMemo } from 'react';
import {
  type Ability,
  type Scores,
  bonusFor,
  hitDice,
  levelOf,
  modifierOf,
  proficiencyBonus,
} from './rules';
import type { Resource } from '../../api/types';
import { useApi } from '../../app/context';
import { useRequest } from '../../app/hooks';
import { useOntology } from '../../app/ontology';
import { useWorld } from '../../app/world';

/**
 * A character, worked out.
 *
 * The character record says which skills and classes it has by pointing at
 * them; what those *are* — which ability a skill uses, how many sides a
 * class's die has — belongs to the world, so it is fetched. One request per
 * model, by id, rather than one per reference.
 */

export interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly ability: Ability;
  readonly proficient: boolean;
  readonly bonus: number;
}

export interface Sheet {
  readonly level: number;
  readonly proficiency: number;
  readonly scores: Scores;
  readonly modifiers: Record<Ability, number>;
  readonly saves: { ability: Ability; proficient: boolean; bonus: number }[];
  readonly skills: SkillRow[];
  readonly initiative: number;
  readonly passivePerception: number | undefined;
  readonly hitDice: { die: number; count: number }[];
  readonly loading: boolean;
}

/** Every reference in a list of them, by the model it points at. */
function referenced(values: unknown[]): Map<string, Set<string>> {
  const by = new Map<string, Set<string>>();
  const add = (value: unknown) => {
    const ref = value as { model?: unknown; id?: unknown } | null;
    if (!ref || typeof ref !== 'object') return;
    if (typeof ref.model !== 'string' || typeof ref.id !== 'string') return;
    by.set(ref.model, (by.get(ref.model) ?? new Set()).add(ref.id));
  };
  for (const value of values) add(value);
  return by;
}

export function useSheet(character: Record<string, unknown>): Sheet {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();

  const classes = Array.isArray(character.classes)
    ? (character.classes as { class?: { id?: string }; level?: number }[])
    : [];
  const held = Array.isArray(character.proficiencies)
    ? character.proficiencies
    : [];
  const classIds = classes
    .map((one) => one.class?.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
  const profIds = [
    ...(referenced(held).get('proficiency') ?? new Set<string>()),
  ].sort();

  // Skills are asked for whole rather than by id: a sheet lists every skill
  // the world has, proficient or not, which is the list a player reads down.
  const wanted = useRequest(async () => {
    const [skills, proficiencies, taken] = await Promise.all([
      ontology.model('skill')
        ? api.list(world.id, 'skill', { limit: 100, sort: 'name' })
        : Promise.resolve(undefined),
      profIds.length > 0 && ontology.model('proficiency')
        ? api.list(world.id, 'proficiency', {
            ids: profIds.join(','),
            limit: 200,
          })
        : Promise.resolve(undefined),
      classIds.length > 0 && ontology.model('class')
        ? api.list(world.id, 'class', { ids: classIds.join(','), limit: 50 })
        : Promise.resolve(undefined),
    ]);
    return {
      skills: skills?.resources ?? [],
      proficiencies: proficiencies?.resources ?? [],
      classes: taken?.resources ?? [],
    };
  }, [api, world.id, ontology, classIds.join(','), profIds.join(',')]);

  return useMemo(() => {
    const scores = (character.abilityScores ?? {}) as Scores;
    const level = levelOf(character);
    const proficiency = proficiencyBonus(level);
    const found = wanted.data;

    // What the character is proficient in, as two sets: the skills they have
    // by reference, and the abilities they save with.
    const inSkills = new Set<string>();
    const inSaves = new Set<string>();
    for (const one of found?.proficiencies ?? []) {
      const kind = one.proficiencyType;
      const points = one.reference as { model?: string; id?: string } | undefined;
      if (kind === 'saving-throw' && typeof one.ability === 'string') {
        inSaves.add(one.ability);
      } else if (points?.model === 'skill' && points.id) {
        inSkills.add(points.id);
      }
    }

    const modifiers = Object.fromEntries(
      (
        [
          'strength',
          'dexterity',
          'constitution',
          'intelligence',
          'wisdom',
          'charisma',
        ] as Ability[]
      ).map((ability) => [ability, modifierOf(scores[ability])]),
    ) as Record<Ability, number>;

    const skills: SkillRow[] = (found?.skills ?? [])
      .map((skill: Resource) => {
        const ability = skill.ability as Ability | undefined;
        if (!ability) return undefined;
        const proficient = inSkills.has(String(skill.id));
        return {
          id: String(skill.id),
          name: String(skill.name ?? skill.id),
          ability,
          proficient,
          bonus: bonusFor(ability, scores, proficiency, proficient),
        };
      })
      .filter((row): row is SkillRow => row !== undefined);

    const perception = skills.find((one) =>
      one.name.toLowerCase().startsWith('perception'),
    );

    const sides = new Map(
      (found?.classes ?? []).map((one: Resource) => [
        String(one.id),
        typeof one.hitDie === 'number' ? one.hitDie : undefined,
      ]),
    );

    return {
      level,
      proficiency,
      scores,
      modifiers,
      saves: (
        [
          'strength',
          'dexterity',
          'constitution',
          'intelligence',
          'wisdom',
          'charisma',
        ] as Ability[]
      ).map((ability) => {
        const proficient = inSaves.has(ability);
        return {
          ability,
          proficient,
          bonus: bonusFor(ability, scores, proficiency, proficient),
        };
      }),
      skills,
      initiative: modifiers.dexterity,
      passivePerception: perception ? 10 + perception.bonus : undefined,
      hitDice: hitDice(classes, (id) => sides.get(id)),
      loading: wanted.loading,
    };
  }, [character, wanted.data, wanted.loading, classes]);
}
