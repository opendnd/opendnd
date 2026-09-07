import type { Field, FieldKind } from './fields';
import { RECORD_KEEPING } from '../components/Form';

/**
 * In-world time as the ontology shapes it: a position in a named calendar,
 * and a span of two positions with optional outer bounds. Recognised by
 * shape rather than by field name, so a session's covered years and an
 * event's when read the same way.
 */
export interface TemporalPosition {
  readonly trs: string;
  readonly year?: number;
  readonly month?: number;
  readonly day?: number;
  readonly precision?: string;
  readonly nominal?: string;
}

export interface TimeSpan {
  readonly begin?: TemporalPosition;
  readonly end?: TemporalPosition;
  readonly earliest?: TemporalPosition;
  readonly latest?: TemporalPosition;
}

const SPAN_KEYS = new Set(['begin', 'end', 'earliest', 'latest']);
const ROUGH = new Set(['era', 'century', 'decade']);

export function isPosition(value: unknown): value is TemporalPosition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.trs === 'string' &&
    (typeof v.year === 'number' || typeof v.nominal === 'string')
  );
}

export function isSpan(value: unknown): value is TimeSpan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => SPAN_KEYS.has(key)) &&
    keys.some((key) => isPosition((value as Record<string, unknown>)[key]))
  );
}

/** `1030`, `1030, month 3, day 12`, `about 1030`, or a nominal name. */
export function formatPosition(position: TemporalPosition): string {
  if (position.year === undefined) return position.nominal ?? '';
  const parts = [String(position.year)];
  if (position.month !== undefined) parts.push(`month ${position.month}`);
  if (position.day !== undefined) parts.push(`day ${position.day}`);
  const text = parts.join(', ');
  return position.precision !== undefined && ROUGH.has(position.precision)
    ? `about ${text}`
    : text;
}

/** `1030`, `1030 to 1035`, `until 1035`, or `between 1030 and 1040`. */
export function formatSpan(span: TimeSpan): string {
  const begin =
    span.begin && isPosition(span.begin)
      ? formatPosition(span.begin)
      : undefined;
  const end =
    span.end && isPosition(span.end) ? formatPosition(span.end) : undefined;
  if (begin !== undefined && end !== undefined) {
    return begin === end ? begin : `${begin} to ${end}`;
  }
  if (begin !== undefined) return begin;
  if (end !== undefined) return `until ${end}`;
  const earliest =
    span.earliest && isPosition(span.earliest)
      ? formatPosition(span.earliest)
      : undefined;
  const latest =
    span.latest && isPosition(span.latest)
      ? formatPosition(span.latest)
      : undefined;
  if (earliest !== undefined && latest !== undefined) {
    return `between ${earliest} and ${latest}`;
  }
  if (earliest !== undefined) return `after ${earliest}`;
  if (latest !== undefined) return `before ${latest}`;
  return '';
}

/** The years a time covers, for a timeline to open on; nothing for a nominal one. */
export function yearsOf(
  value: TemporalPosition | TimeSpan,
): { from: number; to: number } | undefined {
  if (isPosition(value)) {
    return value.year === undefined
      ? undefined
      : { from: value.year, to: value.year };
  }
  const years = [value.begin, value.end, value.earliest, value.latest]
    .filter((p): p is TemporalPosition => p !== undefined && isPosition(p))
    .map((p) => p.year)
    .filter((y): y is number => typeof y === 'number');
  if (years.length === 0) return undefined;
  return { from: Math.min(...years), to: Math.max(...years) };
}

/** Whether a field's schema is a position or a span, before any value is seen. */
export function isTimeField(field: Field): boolean {
  if (field.kind !== 'object') return false;
  const names = (field.fields ?? []).map((child) => child.name);
  if (names.length === 0) return false;
  return (
    (names.includes('trs') && names.includes('year')) ||
    names.every((name) => SPAN_KEYS.has(name))
  );
}

const COMPACT: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'select',
  'date',
  'datetime',
  'integer',
  'number',
  'boolean',
]);

/**
 * The first few fields of a model that fit in a table cell, in schema order:
 * codes, numbers, dates and in-world times, leaving out the name and the
 * record keeping. What a list of sessions shows beside each name.
 */
export function summaryFields(root: Field, limit = 3): Field[] {
  return (root.fields ?? [])
    .filter(
      (field) =>
        !field.readOnly &&
        field.name !== 'name' &&
        field.name !== 'description' &&
        !RECORD_KEEPING.has(field.name) &&
        (COMPACT.has(field.kind) || isTimeField(field)),
    )
    .slice(0, limit);
}
