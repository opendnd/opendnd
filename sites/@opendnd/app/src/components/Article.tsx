import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Markdown } from './Markdown';
import { config } from '../config';
import { type Resource, isReference } from '../api/types';
import { recordPath, useWorld } from '../app/world';
import { type Field, humanize } from '../schema/fields';
import {
  type TemporalPosition,
  type TimeSpan,
  formatPosition,
  formatSpan,
  isPosition,
  isSpan,
  yearsOf,
} from '../schema/time';
import { isEmpty } from '../schema/value';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

/** How many values a list may show before it is folded away instead. */
const MANY = 12;

/** How many headings a page needs before a table of contents earns its place. */
const CONTENTS_FROM = 3;

/** How much raw data may sit open in an article before it is folded away. */
const LONG_JSON = 1200;

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
  'citations',
]);

/** Fields about the record rather than the thing, shown last and folded. */
const RECORD: ReadonlySet<string> = new Set(['derivedId', 'provenance']);

export interface ArticleProps {
  readonly resource: Resource;
  /** The model's root field, from its stored-shape schema. */
  readonly root: Field;
  /** What links here. Shown as "See also", the way an encyclopedia does. */
  readonly seeAlso?: ReactNode;
}

/**
 * A resource as an encyclopedia article.
 *
 * The shape is Wikipedia's, because Wikipedia's shape is the one a reader
 * already knows: a title, a line saying what kind of thing this is and how
 * far to trust it, the description as the lead, a box of facts floated beside
 * it, then sections, what links here, and the sources.
 *
 * What goes where is decided by the value, not by a list of field names, so
 * every model gets the same page: **a fact that fits on one line goes in the
 * box, and anything that needs room becomes a section of its own.** A
 * kingdom's population is a fact; the peoples living in it are a section.
 */
export function Article(props: ArticleProps) {
  const { resource, root, seeAlso } = props;
  const byName = new Map((root.fields ?? []).map((f) => [f.name, f]));
  const ordered = orderFields(Object.keys(resource), root);
  const shown = ordered.filter(
    (name) =>
      !HANDLED.has(name) && !RECORD.has(name) && !isEmpty(resource[name]),
  );
  const facts = shown.filter((name) =>
    fitsOnALine(byName.get(name), resource[name]),
  );
  const sections = shown.filter(
    (name) => !fitsOnALine(byName.get(name), resource[name]),
  );
  const record = ordered.filter(
    (name) => RECORD.has(name) && !isEmpty(resource[name]),
  );
  const citations = Array.isArray(resource.citations) ? resource.citations : [];
  const alternateNames = resource.alternateNames;
  const tags = resource.tags;

  const headings = [
    ...sections.map((name) => ({
      id: slug(name),
      label: byName.get(name)?.label ?? humanize(name),
    })),
    ...(seeAlso ? [{ id: 'see-also', label: 'See also' }] : []),
    ...(citations.length > 0
      ? [{ id: 'references', label: 'References' }]
      : []),
  ];

  return (
    <article className="max-w-4xl">
      <header>
        <h1 className="font-display border-b pb-2 text-3xl leading-tight">
          {resource.name ?? resource.id}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground italic">
          {hatnote(resource, root, byName)}
        </p>
        {Array.isArray(alternateNames) && alternateNames.length > 0 && (
          <p className="text-sm text-muted-foreground italic">
            Also called {alternateNames.map(String).join(', ')}.
          </p>
        )}
      </header>

      {/*
        Below a wide window this is a column and the box follows the lead, as
        a phone shows one. Above it the box floats and the lead — and every
        section after it — reads around it, which is what a float is for.
      */}
      <div className="mt-4 flex flex-col gap-4 md:mt-6 md:block">
        <Infobox
          className="order-2 md:float-right md:mb-4 md:ml-8 md:w-72 lg:w-80"
          resource={resource}
          names={facts}
          fields={byName}
        />
        <div className="order-1">
          {typeof resource.description === 'string' && (
            <Markdown text={resource.description} />
          )}
        </div>
      </div>

      {headings.length >= CONTENTS_FROM && (
        <nav
          aria-label="Contents"
          className="mt-6 w-fit rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        >
          <p className="font-medium">Contents</p>
          <ol className="mt-1 list-decimal pl-5 marker:text-muted-foreground">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  className="underline-offset-4 hover:text-primary hover:underline"
                  href={`#${heading.id}`}
                >
                  {heading.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {sections.map((name) => {
        const field = byName.get(name);
        return (
          <section key={name} className="mt-6">
            <Heading id={slug(name)} title={field?.description}>
              {field?.label ?? humanize(name)}
            </Heading>
            <Value field={field} value={resource[name]} />
          </section>
        );
      })}

      {seeAlso && (
        <section className="mt-6">
          <Heading id="see-also">See also</Heading>
          {/*
            Bounded, because what links here is not a curated list: everyone
            of a species links to the species, and three hundred names below
            an article is not a page any more. Short lists never reach it.
          */}
          <div className="max-h-96 overflow-y-auto">{seeAlso}</div>
        </section>
      )}

      {citations.length > 0 && (
        <section className="mt-6">
          <Heading id="references">References</Heading>
          <ol className="list-decimal pl-5 text-sm marker:text-muted-foreground">
            {citations.map((citation, index) => (
              <li key={index} className="mt-1">
                <Cited value={citation} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {Array.isArray(tags) && tags.length > 0 && (
        <p className="clear-both mt-8 border-t pt-3 text-sm text-muted-foreground">
          Categories:{' '}
          {tags.map((tag, index) => (
            <span key={String(tag)}>
              {index > 0 && ' · '}
              <span className="text-foreground">{String(tag)}</span>
            </span>
          ))}
        </p>
      )}

      {record.length > 0 && (
        <Collapsible className="clear-both mt-6 rounded-lg border">
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
      <div className="clear-both" />
    </article>
  );
}

/** A section heading: the display face over a hairline, as a page of type does. */
function Heading(props: {
  readonly id: string;
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <h2
      id={props.id}
      title={props.title}
      className="font-display mb-2 scroll-mt-20 border-b pb-1 text-xl"
    >
      {props.children}
    </h2>
  );
}

/**
 * The line under the title: what kind of thing this is, and how far to trust
 * it. These were badges, which said the same things in a row of chips and
 * made the top of every page look like a form.
 */
function hatnote(
  resource: Resource,
  root: Field,
  fields: ReadonlyMap<string, Field>,
): string {
  const kind = humanize(resource.model ?? root.name).toLowerCase();
  const status = labelOf(fields.get('canonStatus'), resource.canonStatus);
  const said = status
    ? `${indefinite(status)} ${status.toLowerCase()} ${kind}.`
    : `${indefinite(kind)} ${kind}.`;
  const more: string[] = [];
  // In-universe is the default and the ordinary case, so only the unusual one
  // is worth a reader's attention.
  if (resource.perspective === 'out-of-universe') {
    more.push('Written about the world rather than from inside it.');
  }
  if (typeof resource.module === 'string') more.push('From a module.');
  return [said, ...more].join(' ');
}

function labelOf(field: Field | undefined, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return (
    field?.options?.find((option) => option.value === value)?.label ??
    humanize(value)
  );
}

function indefinite(word: string): string {
  return /^[aeiou]/i.test(word) ? 'An' : 'A';
}

/**
 * The box of facts beside the lead: the picture, then every fact that fits on
 * a line, then what the record says about itself.
 */
function Infobox(props: {
  readonly resource: Resource;
  readonly names: readonly string[];
  readonly fields: ReadonlyMap<string, Field>;
  readonly className?: string;
}) {
  const { resource } = props;
  const image = picture(resource);
  const revision = resource.recorded?.revision;
  const updated = resource.recorded?.updatedAt;
  const rows = props.names.flatMap((name) =>
    rowsFor(name, props.fields.get(name), resource[name]),
  );
  if (!image && rows.length === 0) return null;
  return (
    <aside
      className={`overflow-hidden rounded-lg border bg-muted/40 text-sm ${props.className ?? ''}`}
    >
      <p className="font-display border-b px-3 py-2 text-base">
        {resource.name ?? 'At a glance'}
      </p>
      {image && (
        <img
          src={image}
          alt=""
          className="max-h-64 w-full border-b object-cover"
          loading="lazy"
        />
      )}
      {rows.length > 0 && (
        <dl className="flex flex-col">
          {rows.map((row) =>
            row.kind === 'group' ? (
              <dt
                key={row.key}
                className="border-b bg-muted/60 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {row.label}
              </dt>
            ) : (
              <div
                key={row.key}
                className="grid grid-cols-[minmax(6rem,2fr)_3fr] gap-x-3 border-b px-3 py-1.5 last:border-b-0"
                title={row.title}
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words">{row.value}</dd>
              </div>
            ),
          )}
        </dl>
      )}
      {(revision !== undefined || typeof updated === 'string') && (
        <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {revision !== undefined && `Revision ${String(revision)}`}
          {revision !== undefined && typeof updated === 'string' && ' · '}
          {typeof updated === 'string' &&
            `last edited ${new Date(updated).toLocaleDateString()}`}
        </p>
      )}
    </aside>
  );
}

type Row =
  | { kind: 'group'; key: string; label: string }
  | {
      kind: 'fact';
      key: string;
      label: string;
      title?: string;
      value: ReactNode;
    };

/**
 * One field as rows of the box.
 *
 * A small record of parts — an area, a pair of coordinates — is opened out
 * rather than nested, because a box of facts is a list of facts. A wrapper
 * around a single value is simply that value, its own name kept as a title so
 * that nothing is lost.
 */
function rowsFor(
  name: string,
  field: Field | undefined,
  value: unknown,
): Row[] {
  const label = field?.label ?? humanize(name);
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isReference(value) &&
    !isSpan(value) &&
    !isPosition(value)
  ) {
    const inner = new Map((field?.fields ?? []).map((f) => [f.name, f]));
    const record = value as Record<string, unknown>;
    const kept = orderFields(Object.keys(record), field).filter(
      (key) => !isEmpty(record[key]),
    );
    if (kept.length === 1) {
      const only = kept[0]!;
      return [
        {
          kind: 'fact',
          key: name,
          label,
          title: inner.get(only)?.label ?? humanize(only),
          value: <Value field={inner.get(only)} value={record[only]} />,
        },
      ];
    }
    return [
      { kind: 'group', key: `${name}:group`, label },
      ...kept.map((key): Row => ({
        kind: 'fact',
        key: `${name}.${key}`,
        label: inner.get(key)?.label ?? humanize(key),
        value: <Value field={inner.get(key)} value={record[key]} />,
      })),
    ];
  }
  return [
    {
      kind: 'fact',
      key: name,
      label,
      value: <Value field={field} value={value} />,
    },
  ];
}

/**
 * Whether a value is one thing: a number, a word, a date, a link, a count.
 *
 * This is the whole layout rule. What fits on a line is a fact and belongs in
 * the box; what needs room — a list of people, a shape, a paragraph — is a
 * section with a heading of its own.
 */
function fitsOnALine(field: Field | undefined, value: unknown): boolean {
  if (isReference(value)) return true;
  if (isSpan(value) || isPosition(value)) return true;
  if (Array.isArray(value)) {
    // A list of plain values is a line whether it holds three of them or
    // eight hundred: the long ones are shown as a count that opens.
    return value.every((item) => item === null || typeof item !== 'object');
  }
  if (typeof value === 'object' && value !== null) {
    if (!field || field.kind === 'json') return false;
    const kept = Object.entries(value as Record<string, unknown>).filter(
      ([, inner]) => !isEmpty(inner),
    );
    return (
      kept.length <= 3 &&
      kept.every(([, inner]) => fitsOnALine(undefined, inner))
    );
  }
  return field?.kind !== 'textarea';
}

/** A citation: the work, where in it, and what it says there. */
function Cited(props: { readonly value: unknown }) {
  const citation = props.value as {
    work?: unknown;
    locator?: unknown;
    quote?: unknown;
  };
  if (typeof citation !== 'object' || citation === null) {
    return <Value value={props.value} />;
  }
  return (
    <span>
      {isReference(citation.work) ? (
        <ReferenceLink reference={citation.work} />
      ) : (
        <Value value={citation.work} />
      )}
      {typeof citation.locator === 'string' && `, ${citation.locator}`}
      {typeof citation.quote === 'string' && (
        <span className="block text-muted-foreground italic">
          “{citation.quote}”
        </span>
      )}
    </span>
  );
}

/** Something too big for the page, behind a line saying how big it is. */
function Fold(props: {
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          />
        }
      >
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[open]:rotate-180" />
        {props.summary}
      </CollapsibleTrigger>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A heading's anchor, from the field's name. */
function slug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
  if (isSpan(value) || isPosition(value)) return <TimeText value={value} />;
  if (Array.isArray(value)) {
    // A long list of plain values — the cells a country holds, say — is data
    // rather than reading, and a page of it buries everything the record
    // actually says. It is counted, and opened by anyone who wants it.
    const plain = value.every(
      (item) => item === null || typeof item !== 'object',
    );
    if (plain && value.length > MANY) {
      return (
        <Fold summary={`${value.length} values`}>
          <p className="mt-1 max-h-64 overflow-y-auto font-mono text-xs break-words text-muted-foreground">
            {value.map(String).join(', ')}
          </p>
        </Fold>
      );
    }
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
      const text = JSON.stringify(value, null, 2);
      const block = (
        <pre className="max-h-96 overflow-auto rounded-md bg-muted p-2 text-xs">
          {text}
        </pre>
      );
      // A shape the schema does not describe is shown as it is stored, which
      // for a table of a hundred rows is thousands of pixels of an article
      // nobody is reading. Past a screenful it is folded, and the count says
      // what is in there.
      if (text.length <= LONG_JSON) return block;
      return (
        <Fold summary={`${text.split('\n').length} lines of data`}>
          {block}
        </Fold>
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
  // A quantity is grouped so it can be read at a glance; a four-figure number
  // is far more often a year than a quantity, and a year is not grouped.
  if (typeof value === 'number' && Math.abs(value) >= 10000) {
    return value.toLocaleString();
  }
  if (field?.kind === 'textarea' && typeof value === 'string') {
    return <Markdown text={value} className="prose-record text-sm" />;
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

/** In-world time as years, linking to the timeline around them. */
export function TimeText(props: {
  readonly value: TemporalPosition | TimeSpan;
}) {
  const { world } = useWorld();
  const text = isSpan(props.value)
    ? formatSpan(props.value)
    : formatPosition(props.value);
  const years = yearsOf(props.value);
  if (!years) return <span>{text}</span>;
  return (
    <Link
      className="underline underline-offset-4 hover:text-primary"
      title="On the timeline"
      to={`/worlds/${world.id}/timeline?from=${years.from}&to=${years.to}`}
    >
      {text}
    </Link>
  );
}

/** The picture a record carries, its own or a portrait, when it is an address. */
export function picture(resource: Record<string, unknown>): string | undefined {
  for (const key of ['image', 'portrait']) {
    const value = resource[key];
    if (typeof value === 'string') {
      const found = assetUrl(value);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Where a picture is actually fetched from.
 *
 * A record may point anywhere on the web, or at a file the world itself
 * holds, which it names by the path the API serves it at. The second is
 * resolved against this deployment's API, so a world exported from one
 * deployment and imported into another still finds its own pictures.
 */
export function assetUrl(value: string): string | undefined {
  if (/^https?:\/\//.test(value)) return value;
  if (value.startsWith('/v1/')) return `${config.apiUrl}${value}`;
  return undefined;
}
