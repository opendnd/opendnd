import type {
  Calendar,
  Culture,
  Economy,
  Event,
  Title,
  Faction,
  Person,
  Place,
  Population,
  Prosperity,
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
  /** Yearly growth of the aggregate population by prosperity. */
  readonly populationGrowth: Record<Prosperity, number>;
  /** Yearly chance the settlement's prosperity moves one step up or down. */
  readonly prosperityDrift: number;
  /** Emit a Population record this often, in years. */
  readonly populationSnapshotEvery: number;
  /**
   * Kinship steps (parent, child or spouse edges) from a current title
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
  populationGrowth: {
    booming: 0.008,
    prosperous: 0.004,
    poor: 0,
    'very-poor': -0.003,
  },
  prosperityDrift: 0.02,
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
  readonly house: Faction;
  /** Seats of authority in the house. The first is the sovereign one. */
  readonly titles: readonly Title[];
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
  /** Prosperity at the start. Defaults to prosperous. */
  readonly prosperity?: Prosperity;
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
  readonly economies: Economy[];
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
