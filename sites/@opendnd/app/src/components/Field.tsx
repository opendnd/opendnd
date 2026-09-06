import { PlusIcon, XIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { ReferencePicker } from './ReferencePicker';
import { type Reference, isReference } from '../api/types';
import type { Field } from '../schema/fields';
import { initialValue, parseNumber } from '../schema/value';
import { Button } from '@/components/ui/button';
import {
  Field as FieldFrame,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export interface ControlProps {
  readonly field: Field;
  readonly value: unknown;
  readonly id?: string;
  onChange(value: unknown): void;
}

/** One control for one field, chosen by the field's kind. */
export function FieldControl(props: ControlProps) {
  const { field, value, onChange } = props;
  const id = props.id ?? field.path;

  switch (field.kind) {
    case 'text':
    case 'uuid':
      return (
        <Input
          id={id}
          className={field.kind === 'uuid' ? 'font-mono' : undefined}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          id={id}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'integer':
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          step={field.kind === 'integer' ? 1 : 'any'}
          min={field.minimum}
          max={field.maximum}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) =>
            onChange(parseNumber(e.target.value, field.kind === 'integer'))
          }
        />
      );
    case 'boolean':
      return (
        <NativeSelect
          id={id}
          className="w-full"
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) =>
            onChange(
              e.target.value === '' ? undefined : e.target.value === 'true',
            )
          }
        >
          {!field.required && (
            <NativeSelectOption value="">—</NativeSelectOption>
          )}
          <NativeSelectOption value="true">Yes</NativeSelectOption>
          <NativeSelectOption value="false">No</NativeSelectOption>
        </NativeSelect>
      );
    case 'select':
      return (
        <NativeSelect
          id={id}
          className="w-full"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          {(!field.required || value === undefined) && (
            <NativeSelectOption value="">—</NativeSelectOption>
          )}
          {field.options?.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(fromLocalInput(e.target.value))}
        />
      );
    case 'reference':
      return (
        <ReferencePicker
          id={id}
          value={isReference(value) ? value : undefined}
          models={field.referenceModels}
          onChange={(reference: Reference | undefined) => onChange(reference)}
        />
      );
    case 'list':
      return <ListControl {...props} />;
    case 'object':
      return <ObjectControl {...props} />;
    default:
      return <JsonControl {...props} id={id} />;
  }
}

function ListControl({ field, value, onChange }: ControlProps) {
  const items = Array.isArray(value) ? value : [];
  const item = field.item;
  if (!item) {
    return <JsonControl field={field} value={value} onChange={onChange} />;
  }
  const update = (index: number, next: unknown) =>
    onChange(items.map((existing, i) => (i === index ? next : existing)));
  const remove = (index: number) =>
    onChange(items.filter((_, i) => i !== index));
  const itemLabel = item.label.toLowerCase() || 'item';
  return (
    <div className="space-y-2">
      {items.map((existing, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="grow">
            <FieldControl
              field={item}
              value={existing}
              onChange={(next) => update(index, next)}
              id={`${field.path}.${index}`}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => remove(index)}
            aria-label={`Remove ${itemLabel} ${index + 1}`}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, initialValue(item)])}
      >
        <PlusIcon data-icon="inline-start" />
        Add {itemLabel}
      </Button>
    </div>
  );
}

function ObjectControl({ field, value, onChange }: ControlProps) {
  const present = typeof value === 'object' && value !== null;
  const label = field.label.toLowerCase();
  if (!present && !field.required) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(initialValue(field))}
      >
        <PlusIcon data-icon="inline-start" />
        Add {label}
      </Button>
    );
  }
  const record = (present ? value : {}) as Record<string, unknown>;
  return (
    <div className="rounded-lg border p-3">
      <ObjectFields
        fields={field.fields ?? []}
        value={record}
        onChange={onChange}
      />
      {!field.required && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-3 text-muted-foreground"
          onClick={() => onChange(undefined)}
        >
          <XIcon data-icon="inline-start" />
          Remove {label}
        </Button>
      )}
    </div>
  );
}

/** The properties of an object, each labelled, writing back into one record. */
export function ObjectFields(props: {
  readonly fields: readonly Field[];
  readonly value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
}) {
  const set = (name: string, next: unknown) => {
    const copy = { ...props.value };
    if (next === undefined) delete copy[name];
    else copy[name] = next;
    props.onChange(copy);
  };
  return (
    <div className="flex flex-col gap-4">
      {props.fields
        .filter((field) => !field.readOnly)
        .map((field) => (
          <Labelled key={field.name} field={field}>
            {(id) => (
              <FieldControl
                id={id}
                field={field}
                value={props.value[field.name]}
                onChange={(next) => set(field.name, next)}
              />
            )}
          </Labelled>
        ))}
    </div>
  );
}

/** A label, a description and a required mark around a control. */
export function Labelled(props: {
  readonly field: Field;
  readonly children: (id: string) => ReactNode;
}) {
  const generated = useId();
  const id = `${generated}-${props.field.name}`;
  const { field } = props;
  return (
    <FieldFrame>
      <FieldLabel htmlFor={id}>
        {field.label}
        {field.required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </FieldLabel>
      {field.description && (
        <FieldDescription>{field.description}</FieldDescription>
      )}
      {props.children(id)}
    </FieldFrame>
  );
}

/** The raw value as JSON, for shapes with no better control. */
function JsonControl({ field, value, onChange, id }: ControlProps) {
  const [text, setText] = useState(
    value === undefined ? '' : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string>();
  const commit = () => {
    if (text.trim() === '') {
      setError(undefined);
      onChange(undefined);
      return;
    }
    try {
      onChange(JSON.parse(text));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'not valid JSON');
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id ?? field.path}
        className="font-mono"
        rows={Math.min(12, Math.max(3, text.split('\n').length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        aria-invalid={error !== undefined}
      />
      <FieldDescription>
        JSON. This shape has no form of its own yet.
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function toLocalInput(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(text: string): string | undefined {
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
