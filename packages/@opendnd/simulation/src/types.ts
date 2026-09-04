import type {
  Calendar,
  Claim,
  Culture,
  Economy,
  Event,
  Faction,
  Person,
  Place,
  Population,
  Prosperity,
  Relationship,
  Species,
  Tenure,
  Title,
} from '@opendnd/types';

/** Tunable rates. Defaults suit a pre-industrial human realm. */
export interface HistoryParams {
  /** Yearly chance an unmarried notable adult marries. */
  readonly marriageChance: number;
  /**
   * Share of those marriages made with another house rather than a commoner
   * drawn from the local population. A dynastic match ties two houses
   * together and is how alliances form.
   */
  readonly dynasticMarriageChance: number;
  /** Yearly chance a married couple in fertile years has a child. */
  readonly birthChance: number;
  /** Extra yearly mortality under age five. */
  readonly infantMortality: number;
  /** Floor of yearly mortality at any age. */
  readonly baseMortality: number;
  /** Largest age gap, in years, when a spouse is drawn from the population. */
  readonly spouseAgeSpread: number;
  /** Yearly growth of a settlement's aggregate population by prosperity. */
  readonly populationGrowth: Record<Prosperity, number>;
  /** Yearly chance a settlement's prosperity moves one step up or down. */
  readonly prosperityDrift: number;
  /** Emit Population and Economy records this often, in years. */
  readonly populationSnapshotEvery: number;
  /**
   * Kinship steps (parent, child or spouse edges) from a current title
   * holder within which a person is notable enough to marry and have
   * children in the record. Everyone else ages and dies but leaves no line;
   * their descendants live on in the aggregate population.
   */
  readonly lineageDepth: number;
  /** Safety cap on living tracked figures per house. */
  readonly maxFiguresPerHouse: number;
  /** Yearly chance a living claimant presses an unresolved claim by force. */
  readonly warChance: number;
  /** Battles one side must win to carry a war. */
  readonly battlesToWin: number;
  /** After this many years a war ends inconclusively, exhausted. */
  readonly maxWarYears: number;
}

export const DEFAULT_PARAMS: HistoryParams = {
  marriageChance: 0.2,
  dynasticMarriageChance: 0.35,
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
  maxFiguresPerHouse: 40,
  warChance: 0.08,
  battlesToWin: 2,
  maxWarYears: 8,
};

export interface HistoryInput {
  readonly calendar: Calendar;
  readonly species: Species;
  readonly culture: Culture;
  /**
   * Every place in the realm. Localities (hamlet through metropolis) carry a
   * population and an economy; demesnes (county, duchy, kingdom) are
   * containers whose population is the sum of what they hold.
   */
  readonly places: readonly Place[];
  /** The houses. A house's `seat` is where its figures live, its `parent` is its liege. */
  readonly factions: readonly Faction[];
  /** Titles, each belonging to a house and held by one person at a time. */
  readonly titles: readonly Title[];
  /** Economy snapshots that seed each settlement's starting prosperity. */
  readonly economies?: readonly Economy[];
  /**
   * Authored people to start from. Any house with no living member gets a
   * founding couple instead. Existing birth and death fields are respected.
   */
  readonly founders?: readonly Person[];
  /**
   * Authored events that already happened or must happen. A death event
   * for a person forces their death in that year; the simulation will not
   * kill them earlier.
   */
  readonly canonEvents?: readonly Event[];
  readonly startYear: number;
  readonly years: number;
  readonly params?: Partial<HistoryParams>;
}

export interface HistoryOutput {
  readonly people: Person[];
  readonly relationships: Relationship[];
  readonly events: Event[];
  readonly tenures: Tenure[];
  readonly claims: Claim[];
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
