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
}

export interface GeneratorInfo {
  readonly description: string;
  /** The request body as JSON Schema, which a form is built from. */
  readonly input: JsonSchema;
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
