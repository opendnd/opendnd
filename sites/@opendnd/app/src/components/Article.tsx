import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { type Resource, isReference } from '../api/types';
import { recordPath, useWorld } from '../app/world';
import { type Field, humanize } from '../schema/fields';
import { isEmpty } from '../schema/value';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

/** Fields the article renders in its own way, or not at all. */
const HANDLED: ReadonlySet<string> = new Set([
  'id',
  'model',
  'world',
  'module',
  'name',
  'alternateNames',
  'description',
  'tags',
  'canonStatus',
  'perspective',
  'recorded',
]);

/** Fields about the record rather than the thing, shown last and folded. */
const RECORD: ReadonlySet<string> = new Set([
  'validTime',
  'derivedId',
  'provenance',
  'citations',
]);

export interface ArticleProps {
  readonly resource: Resource;
  /** The model's root field, from its stored-shape schema. */
  readonly root: Field;
}

/**
 * A resource as an article: its name, what it is, its description, and then
 * every field it carries, in the order the schema gives them. A reference
 * is a link to the resource it points at.
 */
export function Article(props: ArticleProps) {
  const { resource, root } = props;
  const byName = new Map((root.fields ?? []).map((f) => [f.name, f]));
  const names = Object.keys(resource);
  const ordered = orderFields(names, root);
  const body = ordered.filter(
    (name) =>
      !HANDLED.has(name) && !RECORD.has(name) && !isEmpty(resource[name]),
  );
  const record = ordered.filter(
    (name) => RECORD.has(name) && !isEmpty(resource[name]),
  );
  const alternateNames = resource.alternateNames;
  const tags = resource.tags;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {resource.name ?? resource.id}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">
            {humanize(resource.model ?? root.name)}
          </Badge>
          <Meta
            field={byName.get('canonStatus')}
            value={resource.canonStatus}
          />
          <Meta
            field={byName.get('perspective')}
            value={resource.perspective}
          />
          {resource.recorded?.revision !== undefined && (
            <Badge variant="outline">
              Revision {resource.recorded.revision}
            </Badge>
          )}
          {typeof resource.module === 'string' && (
            <Badge variant="outline" title={resource.module}>
              From a module
            </Badge>
          )}
        </div>
        {Array.isArray(alternateNames) && alternateNames.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Also called {alternateNames.map(String).join(', ')}
          </p>
        )}
      </header>
      {typeof resource.description === 'string' && (
        <div className="flex max-w-prose flex-col gap-3 text-base leading-relaxed">
          {resource.description.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}
      {Array.isArray(tags) && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={String(tag)} variant="outline">
              {String(tag)}
            </Badge>
          ))}
        </div>
      )}
      {body.length > 0 && (
        <Definitions names={body} resource={resource} fields={byName} />
      )}
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
            <Definitions names={record} resource={resource} fields={byName} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </article>
  );
}

function Meta(props: { readonly field?: Field; readonly value: unknown }) {
  if (typeof props.value !== 'string') return null;
  const label =
    props.field?.options?.find((o) => o.value === props.value)?.label ??
    humanize(props.value);
  return <Badge variant="outline">{label}</Badge>;
}

function Definitions(props: {
  readonly names: readonly string[];
  readonly resource: Record<string, unknown>;
  readonly fields: ReadonlyMap<string, Field>;
}) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {props.names.map((name) => {
        const field = props.fields.get(name);
        return (
          <div key={name} className="contents">
            <dt className="font-medium text-muted-foreground">
              {field?.label ?? humanize(name)}
            </dt>
            <dd>
              <Value field={field} value={props.resource[name]} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A value shown according to its field, or as best it can be without one. */
export function Value(props: {
  readonly field?: Field;
  readonly value: unknown;
}): ReactNode {
  const { field, value } = props;
  if (isEmpty(value)) return <span className="text-muted-foreground">—</span>;
  if (isReference(value)) return <ReferenceLink reference={value} />;
  if (Array.isArray(value)) {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {value.map((item, index) => (
          <li key={index}>
            <Value field={field?.item} value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (field?.kind === 'json' || !field) {
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    const fields = new Map((field.fields ?? []).map((f) => [f.name, f]));
    const names = orderFields(Object.keys(record), field).filter(
      (name) => !isEmpty(record[name]),
    );
    return <Definitions names={names} resource={record} fields={fields} />;
  }
  if (field?.kind === 'select' && typeof value === 'string') {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }
  if (field?.kind === 'datetime' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field?.kind === 'textarea' && typeof value === 'string') {
    return <span className="whitespace-pre-line">{value}</span>;
  }
  return String(value);
}

function ReferenceLink(props: {
  readonly reference: { model: string; id: string; name?: string };
}) {
  const { world } = useWorld();
  const { model, id, name } = props.reference;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        className="underline underline-offset-4 hover:text-primary"
        to={recordPath(world.id, model, id)}
      >
        {name ?? id}
      </Link>
      <Badge variant="ghost" className="text-muted-foreground">
        {humanize(model)}
      </Badge>
    </span>
  );
}

/** Schema order first, then anything the record carries that the schema does not name. */
function orderFields(
  names: readonly string[],
  field: Field | undefined,
): string[] {
  const order = (field?.fields ?? []).map((f) => f.name);
  const known = order.filter((name) => names.includes(name));
  const unknown = names.filter((name) => !order.includes(name));
  return [...known, ...unknown];
}
