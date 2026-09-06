import type { JsonSchema } from '../schema/openapi';

/** Shapes the API answers with. Content shapes come from the ontology at run time. */

export type Role = 'owner' | 'editor' | 'viewer';
export type Visibility = 'private' | 'public';

export interface World {
  readonly id: string;
  readonly name: string;
  readonly visibility: Visibility;
  readonly role?: Role;
  readonly archivedAt?: string;
}

export interface Me {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly groups?: readonly string[];
  readonly worlds: readonly World[];
}

export interface ModelInfo {
  readonly id: string;
  /** The name the ontology gives the model. */
  readonly name: string;
  readonly description?: string;
  /** Present when something generates the model: what, and what it takes. */
  readonly generate?: GeneratorInfo;
  /** Present when a history can be simulated over one of these. */
  readonly simulate?: GeneratorInfo;
  /** Present when a language model can be asked to write about one of these. */
  readonly author?: GeneratorInfo;
}

/** A language model the deployment can write with. */
export interface LlmModel {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  /** Free at the point of use: a model on the deployment's own machine. */
  readonly local: boolean;
}

export interface LlmCatalogue {
  /** The writing task, and the model it is configured with when one is. */
  readonly task: { readonly name: string; readonly model?: string };
  readonly models: readonly LlmModel[];
}

/** What a model call cost. Money is in millionths of a dollar. */
export interface Spend {
  readonly model: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly chargeMicros: number;
  readonly cached: boolean;
}

/** What asking a model to write produced. */
export interface AuthorResult {
  /** The work, carrying its `model`, so it can be imported as it is. */
  readonly work: Resource;
  readonly saved: boolean;
  readonly facts: readonly string[];
  readonly spend?: Spend;
}

export interface GeneratorInfo {
  readonly description: string;
  /** The request body as JSON Schema, which a form is built from. */
  readonly input: JsonSchema;
}

/** A consistency finding over a simulated history. */
export interface Finding {
  readonly rule: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** Ids of the resources involved. */
  readonly resources: readonly string[];
}

/** What a simulation run produced, and whether it was kept. */
export interface SimulateResult {
  readonly startYear: number;
  readonly endYear: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
  /** Present when nothing was saved, to look at before keeping. */
  readonly resources?: readonly Resource[];
  readonly saved: boolean;
}

export interface VocabularyCode {
  readonly code: string;
  readonly display: string;
  readonly definition?: string;
}

export interface Vocabulary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly codes: readonly VocabularyCode[];
}

/** Any resource. `id`, `world` and `model` are set by the API on the way out. */
export type Resource = Record<string, unknown> & {
  readonly id: string;
  readonly world?: string;
  readonly model?: string;
  readonly name?: string;
  readonly recorded?: {
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly revision?: number;
  };
};

export interface Page {
  readonly resources: Resource[];
  /** Cursor for the next page; absent on the last. */
  readonly next?: string;
}

export interface HistoryEntry {
  readonly revision: number;
  readonly recordedAt: string;
  readonly deleted: boolean;
  readonly generatedBy?: string;
}

export interface ReferenceHit {
  readonly model: string;
  readonly resource: Resource;
}

export interface SearchHit {
  readonly model: string;
  readonly id: string;
  readonly name: string;
  readonly canonStatus: string;
}

export interface Member {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly role: Role;
}

/** Someone admitted by email who has not signed in yet. */
export interface Invitation {
  readonly email: string;
  readonly role: Role;
  readonly invitedAt: string;
}

/** What a world has spent on model calls. Money is in millionths of a dollar. */
export interface Usage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly chargeMicros: number;
}

/** What an owner may change about a world. `summary: null` clears it. */
export interface WorldPatch {
  readonly name?: string;
  readonly visibility?: Visibility;
  readonly summary?: string | null;
}

/** A pointer to another resource, as the ontology's `Reference`. */
export interface Reference {
  readonly model: string;
  readonly id: string;
  readonly name?: string;
}

export function isReference(value: unknown): value is Reference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Reference).model === 'string' &&
    typeof (value as Reference).id === 'string'
  );
}
