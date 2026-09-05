import { ChevronDownIcon } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { ObjectFields } from './Field';
import { ErrorNotice } from './Notice';
import type { Field } from '../schema/fields';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';

/**
 * Fields every resource has that describe the record rather than the thing:
 * shown, but folded away beneath the fields an author came to fill in.
 */
export const RECORD_KEEPING: ReadonlySet<string> = new Set([
  'canonStatus',
  'perspective',
  'validTime',
  'derivedId',
  'provenance',
  'citations',
]);

export interface SchemaFormProps {
  /** The resource's root field, from the model's input schema. */
  readonly root: Field;
  readonly value: Record<string, unknown>;
  readonly submitting?: boolean;
  readonly submitLabel?: string;
  readonly error?: Error;
  readonly children?: ReactNode;
  onChange(value: Record<string, unknown>): void;
  onSubmit(): void;
}

/** A form for any resource, built from its schema. */
export function SchemaForm(props: SchemaFormProps) {
  const fields = (props.root.fields ?? []).filter((f) => !f.readOnly);
  const about = fields.filter((f) => !RECORD_KEEPING.has(f.name));
  const record = fields.filter((f) => RECORD_KEEPING.has(f.name));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <ObjectFields
        fields={about}
        value={props.value}
        onChange={props.onChange}
      />
      {record.length > 0 && (
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between rounded-lg"
              />
            }
          >
            Record keeping
            <ChevronDownIcon className="transition-transform group-aria-expanded/button:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <ObjectFields
              fields={record}
              value={props.value}
              onChange={props.onChange}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
      {props.error && <ErrorNotice error={props.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={props.submitting}>
          {props.submitting && <Spinner data-icon="inline-start" />}
          {props.submitting ? 'Saving…' : (props.submitLabel ?? 'Save')}
        </Button>
        {props.children}
      </div>
    </form>
  );
}
