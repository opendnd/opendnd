import type {
  Calendar,
  Culture,
  Event,
  Office,
  Organization,
  Person,
  Place,
  Population,
  Relationship,
  Species,
  Tenure,
} from '@opendnd/types';

/** Tunable rates. Defaults suit a pre-industrial human settlement. */
export interface HistoryParams {
  /** Yearly chance an unmarried adult of the house marries. */
  readonly marriageChance: number;
  /** Yearly chance a married couple in fertile years has a child. */
  readonly birthChance: number;
  /** Extra yearly mortality under age five. */
  readonly infantMortality: number;
  /** Floor of yearly mortality at any age. */
  readonly baseMortality: number;
  /** Largest age gap, in years, when a spouse is drawn from the population. */
  readonly spouseAgeSpread: number;
  /** Yearly growth of the settlement's aggregate population. */
  readonly populationGrowth: number;
  /** Emit a Population record this often, in years. */
  readonly populationSnapshotEvery: number;
  /**
   * Kinship steps (parent, child or spouse edges) from a current office
   * holder within which a person is notable enough to marry and have
   * children in the record. Everyone else ages and dies but leaves no line;
   * their descendants live on in the aggregate population.
   */
  readonly lineageDepth: number;
  /** Safety cap on living tracked figures; beyond it no new figures are created. */
  readonly maxLivingFigures: number;
}

export const DEFAULT_PARAMS: HistoryParams = {
  marriageChance: 0.2,
  birthChance: 0.3,
  infantMortality: 0.03,
  baseMortality: 0.004,
  spouseAgeSpread: 6,
  populationGrowth: 0.004,
  populationSnapshotEvery: 50,
  lineageDepth: 2,
  maxLivingFigures: 300,
};

export interface HistoryInput {
  readonly calendar: Calendar;
  readonly species: Species;
  readonly culture: Culture;
  /** The settlement everything happens in. */
  readonly settlement: Place;
  /** The house or dynasty whose figures are tracked. */
  readonly house: Organization;
  /** Seats of authority in the house. The first is the sovereign one. */
  readonly offices: readonly Office[];
  /**
   * Authored people to start from. When absent, a founding couple is
   * generated. Their existing birth and death fields are respected.
   */
  readonly founders?: readonly Person[];
  /**
   * Authored events that already happened or must happen. A death event
   * for a person forces their death in that year; the simulation will not
   * kill them earlier.
   */
  readonly canonEvents?: readonly Event[];
  /** Aggregate population of the settlement at the start. */
  readonly initialPopulation: number;
  readonly startYear: number;
  readonly years: number;
  readonly params?: Partial<HistoryParams>;
}

export interface HistoryOutput {
  readonly people: Person[];
  readonly relationships: Relationship[];
  readonly events: Event[];
  readonly tenures: Tenure[];
  readonly populations: Population[];
  /** Consistency findings over the produced history. Empty when all is well. */
  readonly findings: Finding[];
  readonly endYear: number;
}

export interface Finding {
  readonly rule: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** Ids of the resources involved. */
  readonly resources: string[];
}
