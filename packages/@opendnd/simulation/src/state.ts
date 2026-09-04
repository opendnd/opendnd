import type {
  Claim,
  Economy,
  Event,
  Faction,
  Person,
  Place,
  Population,
  Prosperity,
  Reference,
  Relationship,
  Tenure,
  Title,
} from '@opendnd/types';

/** A war in progress, with the tally of battles won on each side. */
export interface War {
  readonly event: Event;
  readonly titleId: string;
  readonly claim: Claim;
  readonly claimantId: string;
  /** House pressing the claim, and the house holding the title. */
  readonly attacker: string;
  readonly defender: string;
  readonly startedIn: number;
  attackerWins: number;
  defenderWins: number;
}

/** What the settlements system tracks for one locality between snapshots. */
export interface SettlementState {
  count: number;
  prosperity: Prosperity;
}

/**
 * Mutable in-memory world state for one simulation run. Everything in it is
 * either an input resource (canon, left untouched) or a resource this run
 * created (stamped generated).
 */
export class HistoryState {
  year: number;
  /** Insertion order is creation order, which keeps iteration deterministic. */
  readonly people = new Map<string, Person>();
  readonly relationships: Relationship[] = [];
  readonly events: Event[] = [];
  readonly tenures: Tenure[] = [];
  readonly populations: Population[] = [];
  readonly economies: Economy[] = [];
  readonly claims: Claim[] = [];
  /** Wars still being fought, in declaration order. */
  readonly wars: War[] = [];

  /** The realm, indexed once so systems do not rescan the input each year. */
  readonly houses = new Map<string, Faction>();
  readonly titlesById = new Map<string, Title>();
  readonly places = new Map<string, Place>();
  /** Aggregate head count and prosperity per settlement. */
  readonly settlements = new Map<string, SettlementState>();
  /** House id -> the places it controls directly. */
  readonly holdings = new Map<string, string[]>();
  private strengthCache = new Map<string, number>();
  private strengthYear = -1;

  /** Titles already recorded as vacant, so the record says so only once. */
  readonly vacant = new Set<string>();
  /** Ids of people this run created, as opposed to authored input. */
  readonly generated = new Set<string>();
  /** Person id -> year they must die, from canon death events. */
  readonly forcedDeath = new Map<string, number>();

  private readonly parentsOf = new Map<string, string[]>();
  private readonly childrenOf = new Map<string, string[]>();
  private readonly spouseOf = new Map<string, string>();
  private readonly houseOfPerson = new Map<string, string>();
  private readonly membersOfHouse = new Map<string, string[]>();

  constructor(startYear: number) {
    this.year = startYear;
  }

  addPerson(person: Person, generated: boolean): void {
    this.people.set(person.id, person);
    if (generated) this.generated.add(person.id);
    const house = person.memberOf?.[0]?.id;
    if (house !== undefined) this.setHouse(person.id, house);
  }

  /** Move a person into a house, keeping the membership index in step. */
  setHouse(personId: string, houseId: string): void {
    const previous = this.houseOfPerson.get(personId);
    if (previous === houseId) return;
    if (previous !== undefined) {
      const list = this.membersOfHouse.get(previous);
      if (list) {
        this.membersOfHouse.set(
          previous,
          list.filter((id) => id !== personId),
        );
      }
    }
    this.houseOfPerson.set(personId, houseId);
    push(this.membersOfHouse, houseId, personId);
  }

  houseOf(personId: string): string | undefined {
    return this.houseOfPerson.get(personId);
  }

  /** Where a house's figures live, if it has a seat. */
  seatOf(houseId: string): Reference | undefined {
    return this.houses.get(houseId)?.seat;
  }

  livingMembers(houseId: string): Person[] {
    return (this.membersOfHouse.get(houseId) ?? [])
      .map((id) => this.person(id))
      .filter((p) => this.isAlive(p));
  }

  /**
   * Move a person into a house: their membership, their home, and the index
   * all follow. Generated people are mutated; authored ones are replaced, so
   * the input resource is never written through.
   */
  movePersonToHouse(person: Person, houseId: string): void {
    if (this.houseOf(person.id) === houseId) return;
    const house = this.houses.get(houseId);
    const patch: Partial<Person> = {
      memberOf: [
        {
          model: 'faction',
          id: houseId,
          ...(house?.name ? { name: house.name } : {}),
        },
      ],
      ...(house?.seat ? { residence: house.seat } : {}),
    };
    if (this.generated.has(person.id)) {
      Object.assign(person, patch);
    } else {
      this.people.set(person.id, { ...person, ...patch });
    }
    this.setHouse(person.id, houseId);
  }

  /**
   * The people a house can put in the field: everyone living in the places it
   * holds, and in the places its vassals hold. Land is the only measure of
   * power the simulation has, which is close enough to the medieval truth.
   */
  strengthOf(houseId: string): number {
    if (this.strengthYear !== this.year) {
      this.strengthCache = new Map();
      this.strengthYear = this.year;
    }
    const cached = this.strengthCache.get(houseId);
    if (cached !== undefined) return cached;
    this.strengthCache.set(houseId, 0); // guard against a cycle of lieges
    let total = 0;
    for (const placeId of this.holdings.get(houseId) ?? []) {
      total += this.settlements.get(placeId)?.count ?? 0;
    }
    for (const house of this.houses.values()) {
      if (house.parent?.id === houseId) total += this.strengthOf(house.id);
    }
    const rounded = Math.round(total);
    this.strengthCache.set(houseId, rounded);
    return rounded;
  }

  addRelationship(rel: Relationship): void {
    this.relationships.push(rel);
    const a = rel.person1.id;
    const b = rel.person2.id;
    switch (rel.relationshipType) {
      case 'parent-child':
      case 'adoptive-parent-child':
      case 'foster-parent-child':
        push(this.childrenOf, a, b);
        push(this.parentsOf, b, a);
        break;
      case 'couple':
        this.spouseOf.set(a, b);
        this.spouseOf.set(b, a);
        break;
      default:
        break;
    }
  }

  addEvent(event: Event): void {
    this.events.push(event);
  }

  person(id: string): Person {
    const p = this.people.get(id);
    if (!p) throw new Error(`Unknown person ${id}`);
    return p;
  }

  isAlive(person: Person): boolean {
    return person.death === undefined;
  }

  age(person: Person): number | undefined {
    const born = person.birth?.time?.year;
    return born === undefined ? undefined : this.year - born;
  }

  children(id: string): Person[] {
    return (this.childrenOf.get(id) ?? []).map((c) => this.person(c));
  }

  parents(id: string): Person[] {
    return (this.parentsOf.get(id) ?? []).map((c) => this.person(c));
  }

  spouse(id: string): Person | undefined {
    const s = this.spouseOf.get(id);
    if (s === undefined) return undefined;
    const spouse = this.person(s);
    return this.isAlive(spouse) ? spouse : undefined;
  }

  /** End a marriage when one partner dies. */
  widow(id: string): void {
    const s = this.spouseOf.get(id);
    if (s !== undefined) {
      this.spouseOf.delete(id);
      this.spouseOf.delete(s);
    }
  }

  /**
   * Kinship distance from each living person to the nearest current title
   * holder, counting parent, child and spouse edges, up to `maxDepth`.
   * People beyond the horizon are absent from the result.
   */
  kinshipToHolders(maxDepth: number): Map<string, number> {
    const distance = new Map<string, number>();
    let frontier: string[] = [];
    for (const t of this.tenures) {
      if (t.ended === undefined && !distance.has(t.holder.id)) {
        distance.set(t.holder.id, 0);
        frontier.push(t.holder.id);
      }
    }
    for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const linked = [
          ...(this.parentsOf.get(id) ?? []),
          ...(this.childrenOf.get(id) ?? []),
          ...(this.spouseOf.has(id) ? [this.spouseOf.get(id)!] : []),
        ];
        for (const other of linked) {
          if (!distance.has(other)) {
            distance.set(other, d);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return distance;
  }

  /** Living people, in creation order. */
  living(): Person[] {
    return [...this.people.values()].filter((p) => this.isAlive(p));
  }

  /** The current holder of a title, if any. */
  currentTenure(titleId: string): Tenure | undefined {
    for (let i = this.tenures.length - 1; i >= 0; i--) {
      const t = this.tenures[i];
      if (t.title.id === titleId && t.ended === undefined) return t;
    }
    return undefined;
  }

  /** The title a house holds, if any. A house holds at most one in this model. */
  titleOfHouse(houseId: string): Title | undefined {
    for (const title of this.titlesById.values()) {
      if (title.faction.id === houseId) return title;
    }
    return undefined;
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
