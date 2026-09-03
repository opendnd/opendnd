import type {
  Economy,
  Event,
  Person,
  Population,
  Prosperity,
  Relationship,
  Tenure,
} from '@opendnd/types';

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
  /** Aggregate head count of the settlement this year. */
  populationCount = 0;
  prosperity: Prosperity = 'prosperous';
  /** Ids of people this run created, as opposed to authored input. */
  readonly generated = new Set<string>();
  /** Person id -> year they must die, from canon death events. */
  readonly forcedDeath = new Map<string, number>();
  private readonly parentsOf = new Map<string, string[]>();
  private readonly childrenOf = new Map<string, string[]>();
  private readonly spouseOf = new Map<string, string>();

  constructor(startYear: number) {
    this.year = startYear;
  }

  addPerson(person: Person, generated: boolean): void {
    this.people.set(person.id, person);
    if (generated) this.generated.add(person.id);
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

  /** The current holder of an title, if any. */
  currentTenure(titleId: string): Tenure | undefined {
    for (let i = this.tenures.length - 1; i >= 0; i--) {
      const t = this.tenures[i];
      if (t.title.id === titleId && t.ended === undefined) return t;
    }
    return undefined;
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
