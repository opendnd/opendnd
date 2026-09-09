import { HeartIcon, ShieldIcon } from 'lucide-react';
import { Link } from 'react-router';
import { NumberField } from '../sheet/Editable';
import {
  ABILITIES,
  SHORT,
  type Ability,
  healthOf,
  hitDiceText,
  signed,
} from '../sheet/rules';
import { useSheet } from '../sheet/useSheet';
import { recordPath, useWorld } from '../../app/world';
import { humanize } from '../../schema/fields';
import { Badge } from '@/components/ui/badge';

/**
 * A character sheet, as blocks.
 *
 * The arrangement is the one every player already knows, and it is arrived at
 * the same way any other page is: blocks on the grid, which means a table can
 * rearrange it, drop the parts it does not use, and put its own beside them.
 *
 * Every number a player can change is changed where it stands, and every
 * number derived from one is derived here rather than stored — so a score
 * typed into the abilities block moves the saves, the skills and the passive
 * perception before the finger is off the key.
 */

type Character = Record<string, unknown>;

function reference(value: unknown): { model: string; id: string; name?: string } | undefined {
  const ref = value as { model?: unknown; id?: unknown; name?: unknown };
  if (!ref || typeof ref !== 'object') return undefined;
  if (typeof ref.model !== 'string' || typeof ref.id !== 'string') return undefined;
  return {
    model: ref.model,
    id: ref.id,
    ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
  };
}

function Ref(props: { readonly value: unknown; readonly fallback?: string }) {
  const { world } = useWorld();
  const ref = reference(props.value);
  if (!ref) return <span className="text-muted-foreground">{props.fallback ?? '—'}</span>;
  return (
    <Link
      className="underline-offset-4 hover:underline"
      to={recordPath(world.id, ref.model, ref.id)}
    >
      {ref.name ?? ref.id}
    </Link>
  );
}

/** A framed part of the sheet, with its name in the corner. */
function Panel(props: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly aside?: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {props.title}
        </h3>
        {props.aside}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{props.children}</div>
    </section>
  );
}

/** Who this is: their name, what they are, and who plays them. */
export function SheetHeader(props: { readonly record?: Character }) {
  const character = props.record ?? {};
  const classes = Array.isArray(character.classes) ? character.classes : [];
  const sheet = useSheet(character);
  return (
    <section className="flex h-full flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="font-display truncate text-2xl leading-tight">
          {String(character.name ?? 'Unnamed')}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {classes
            .map((one) => {
              const taken = one as { class?: unknown; level?: unknown };
              const ref = reference(taken.class);
              return `${ref?.name ?? 'Class'} ${String(taken.level ?? '')}`.trim();
            })
            .join(' / ') || 'No class yet'}
        </span>
      </div>
      <Fact label="Level" value={String(sheet.level)} />
      <Fact label="Proficiency" value={signed(sheet.proficiency)} />
      <Fact label="Person" value={<Ref value={character.person} />} />
      <Fact label="Background" value={<Ref value={character.background} />} />
      {typeof character.status === 'string' && (
        <Badge variant="secondary" className="ml-auto">
          {humanize(character.status)}
        </Badge>
      )}
    </section>
  );
}

function Fact(props: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {props.label}
      </span>
      <span className="text-sm">{props.value}</span>
    </div>
  );
}

/** The six scores, each a number a player can change. */
export function SheetAbilities(props: { readonly record?: Character }) {
  const character = props.record ?? {};
  const sheet = useSheet(character);
  const scores = (character.abilityScores ?? {}) as Partial<Record<Ability, number>>;
  return (
    <Panel title="Abilities">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ABILITIES.map((ability) => (
          <div
            key={ability}
            className="flex flex-col items-center rounded-md border py-1"
          >
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
              {SHORT[ability]}
            </dt>
            <dd className="font-display text-xl leading-none tabular-nums">
              {signed(sheet.modifiers[ability])}
            </dd>
            <dd className="text-xs text-muted-foreground">
              <NumberField
                label={ability}
                value={scores[ability]}
                min={1}
                max={30}
                patch={(next) => ({
                  abilityScores: { ...scores, [ability]: next },
                })}
              />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Saving throws and skills: the two lists a player reads down. */
export function SheetChecks(props: { readonly record?: Character }) {
  const sheet = useSheet(props.record ?? {});
  return (
    <Panel title="Saves and skills">
      <div className="flex flex-col gap-3">
        <ul className="grid grid-cols-2 gap-x-4 text-sm">
          {sheet.saves.map((save) => (
            <li
              key={save.ability}
              className="flex items-center gap-2 border-b py-0.5 last:border-b-0"
            >
              <Dot on={save.proficient} />
              <span className="truncate">{SHORT[save.ability]}</span>
              <span className="ml-auto tabular-nums">{signed(save.bonus)}</span>
            </li>
          ))}
        </ul>
        {sheet.skills.length > 0 && (
          <ul className="text-sm">
            {sheet.skills.map((skill) => (
              <li
                key={skill.id}
                className="flex items-center gap-2 border-b py-0.5 last:border-b-0"
              >
                <Dot on={skill.proficient} />
                <span className="truncate">{skill.name}</span>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {SHORT[skill.ability]}
                </span>
                <span className="ml-auto tabular-nums">
                  {signed(skill.bonus)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!sheet.loading && sheet.skills.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This world has no skills on record, so there is nothing to check
            against.
          </p>
        )}
      </div>
    </Panel>
  );
}

function Dot(props: { readonly on: boolean }) {
  return (
    <span
      aria-label={props.on ? 'Proficient' : 'Not proficient'}
      className={`size-2 shrink-0 rounded-full border ${
        props.on ? 'bg-foreground' : ''
      }`}
    />
  );
}

/** Hit points, hit dice, initiative and what is noticed without looking. */
export function SheetCombat(props: { readonly record?: Character }) {
  const character = props.record ?? {};
  const sheet = useSheet(character);
  const hp = healthOf(character.hitPoints);
  const points = (character.hitPoints ?? {}) as Record<string, unknown>;
  const conditions = Array.isArray(character.conditions)
    ? character.conditions
    : [];
  return (
    <Panel
      title="Combat"
      aside={
        conditions.length > 0 ? (
          <span className="ml-auto flex flex-wrap gap-1">
            {conditions.map((one, index) => (
              <Badge key={index} variant="outline" className="text-[10px]">
                {reference(one)?.name ?? 'Condition'}
              </Badge>
            ))}
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <HeartIcon
            className={`size-4 ${hp.down ? 'text-destructive' : 'text-muted-foreground'}`}
          />
          <span className="font-display text-2xl leading-none tabular-nums">
            <NumberField
              label="Hit points"
              value={hp.maximum > 0 ? hp.current : undefined}
              min={0}
              patch={(next) => ({ hitPoints: { ...points, current: next } })}
            />
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="text-lg tabular-nums">
            <NumberField
              label="Maximum hit points"
              value={hp.maximum > 0 ? hp.maximum : undefined}
              min={0}
              patch={(next) => ({ hitPoints: { ...points, maximum: next } })}
            />
          </span>
          {hp.temporary > 0 && (
            <Badge variant="secondary" className="mb-0.5">
              +{hp.temporary} temp
            </Badge>
          )}
          {hp.down && (
            <Badge variant="destructive" className="mb-0.5">
              Down
            </Badge>
          )}
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${hp.current} of ${hp.maximum} hit points`}
        >
          <div
            className={hp.down ? 'h-full bg-destructive' : 'h-full bg-success'}
            style={{ width: `${Math.round(hp.share * 100)}%` }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Small label="Initiative" value={signed(sheet.initiative)} />
          <Small
            label="Passive perception"
            value={
              sheet.passivePerception === undefined
                ? '—'
                : String(sheet.passivePerception)
            }
          />
          <Small
            label="Hit dice"
            value={hitDiceText(sheet.hitDice) || '—'}
          />
          <Small
            label="Spent"
            value={
              <NumberField
                label="Hit dice spent"
                value={
                  typeof character.hitDiceSpent === 'number'
                    ? character.hitDiceSpent
                    : 0
                }
                min={0}
                patch={(next) => ({ hitDiceSpent: next })}
              />
            }
          />
        </dl>
      </div>
    </Panel>
  );
}

function Small(props: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {props.label}
      </dt>
      <dd className="tabular-nums">{props.value}</dd>
    </div>
  );
}

/** What the character carries, and what of it is in hand. */
export function SheetEquipment(props: { readonly record?: Character }) {
  const carried = Array.isArray(props.record?.inventory)
    ? props.record.inventory
    : [];
  return (
    <Panel title="Equipment">
      {carried.length === 0 ? (
        <p className="text-xs text-muted-foreground">Carrying nothing.</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {carried.map((entry, index) => {
            const one = entry as {
              item?: unknown;
              quantity?: unknown;
              equipped?: unknown;
              attuned?: unknown;
            };
            return (
              <li
                key={index}
                className="flex items-center gap-2 border-b py-0.5 last:border-b-0"
              >
                <Ref value={one.item} />
                {typeof one.quantity === 'number' && one.quantity > 1 && (
                  <span className="text-xs text-muted-foreground">
                    ×{one.quantity}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {one.equipped === true && (
                    <ShieldIcon
                      className="size-3.5 text-muted-foreground"
                      aria-label="Equipped"
                    />
                  )}
                  {one.attuned === true && (
                    <Badge variant="outline" className="text-[10px]">
                      Attuned
                    </Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Feats and proficiencies: what the character can do that others cannot. */
export function SheetTraining(props: { readonly record?: Character }) {
  const character = props.record ?? {};
  const feats = Array.isArray(character.feats) ? character.feats : [];
  const proficiencies = Array.isArray(character.proficiencies)
    ? character.proficiencies
    : [];
  return (
    <Panel title="Feats and proficiencies">
      <div className="flex flex-col gap-2 text-sm">
        {feats.length > 0 && (
          <ul className="flex flex-col">
            {feats.map((one, index) => (
              <li key={index} className="border-b py-0.5 last:border-b-0">
                <Ref value={one} />
              </li>
            ))}
          </ul>
        )}
        {proficiencies.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {proficiencies.map((one, index) => (
              <Badge key={index} variant="outline" className="font-normal">
                {reference(one)?.name ?? 'Proficiency'}
              </Badge>
            ))}
          </p>
        )}
        {feats.length === 0 && proficiencies.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
        )}
      </div>
    </Panel>
  );
}

/** Spells known and prepared, and the slots left today. */
export function SheetSpells(props: { readonly record?: Character }) {
  const spells = (props.record?.spells ?? {}) as {
    known?: unknown;
    prepared?: unknown;
    slotsUsed?: unknown;
  };
  const known = Array.isArray(spells.known) ? spells.known : [];
  const prepared = Array.isArray(spells.prepared) ? spells.prepared : [];
  const used = Array.isArray(spells.slotsUsed) ? spells.slotsUsed : [];
  if (known.length === 0 && prepared.length === 0 && used.length === 0) {
    return (
      <Panel title="Spells">
        <p className="text-xs text-muted-foreground">
          No spellcasting on record.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Spells">
      <div className="flex flex-col gap-3 text-sm">
        {used.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {used.map((entry, index) => {
              const slot = entry as { level?: unknown; used?: unknown };
              return (
                <li
                  key={index}
                  className="flex flex-col items-center rounded-md border px-2 py-1"
                >
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Level {String(slot.level ?? '?')}
                  </span>
                  <span className="tabular-nums">
                    {String(slot.used ?? 0)} spent
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {prepared.length > 0 && (
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
              Prepared
            </p>
            <p className="flex flex-wrap gap-x-2">
              {prepared.map((one, index) => (
                <Ref key={index} value={one} />
              ))}
            </p>
          </div>
        )}
        {known.length > 0 && (
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
              Known
            </p>
            <p className="flex flex-wrap gap-x-2 text-muted-foreground">
              {known.map((one, index) => (
                <Ref key={index} value={one} />
              ))}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
