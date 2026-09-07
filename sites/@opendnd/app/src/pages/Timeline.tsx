import { type FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ModelInfo, Resource } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** How many of a model a page asks for at once. */
const PAGE = 200;

interface Entry {
  readonly model: string;
  readonly resource: Resource;
  readonly begin: number;
  readonly end?: number;
}

/**
 * The world's dated records in the order they begin, grouped by year. Which
 * models are dated comes from the ontology through the API's description of
 * each; the page starts with those whose records both begin and end, the
 * things that happen and the things that last, and any model can be added.
 */
export function Timeline() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const [params, setParams] = useSearchParams();
  const from = yearParam(params.get('from'));
  const to = yearParam(params.get('to'));

  const dated = ontology.models.filter((m) => m.validTime !== undefined);
  const defaults = useMemo(
    () => dated.filter((m) => m.validTime?.end !== undefined).map((m) => m.id),
    [dated],
  );
  const chosen = useMemo(() => {
    const asked = params.get('models');
    return asked === null
      ? defaults
      : asked.split(',').filter((id) => ontology.model(id) !== undefined);
  }, [params, defaults, ontology]);
  const chosenKey = chosen.join(',');

  const pages = useRequest(
    async () => {
      const results = await Promise.all(
        chosen.map((model) =>
          api.list(world.id, model, {
            sort: 'validTime',
            from,
            to,
            limit: PAGE,
          }),
        ),
      );
      return chosen.map((model, index) => ({ model, page: results[index]! }));
    },
    // The joined key stands for the list, which is rebuilt each render.
    [api, world.id, chosenKey, from, to],
  );

  const entries = useMemo(() => {
    const found: Entry[] = [];
    for (const { model, page } of pages.data ?? []) {
      for (const resource of page.resources) {
        const begin = yearOf(resource, 'begin');
        if (begin === undefined) continue;
        const end = yearOf(resource, 'end');
        found.push({
          model,
          resource,
          begin,
          ...(end !== undefined ? { end } : {}),
        });
      }
    }
    return found.sort(
      (a, b) =>
        a.begin - b.begin ||
        (a.end ?? a.begin) - (b.end ?? b.begin) ||
        nameOf(a.resource).localeCompare(nameOf(b.resource)),
    );
  }, [pages.data]);

  const years = useMemo(() => {
    const groups = new Map<number, Entry[]>();
    for (const entry of entries) {
      groups.set(entry.begin, [...(groups.get(entry.begin) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [entries]);

  const truncated = (pages.data ?? [])
    .filter(({ page }) => page.next !== undefined)
    .map(({ model }) => ontology.label(model).toLowerCase());

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    change(next);
    setParams(next);
  };
  const toggle = (id: string, on: boolean) => {
    const set = new Set(chosen);
    if (on) set.add(id);
    else set.delete(id);
    const next = ontology.models.map((m) => m.id).filter((m) => set.has(m));
    update((q) => {
      if (next.join(',') === defaults.join(',')) q.delete('models');
      else q.set('models', next.join(','));
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
        <p className="text-sm text-muted-foreground">
          What the world records, in the order it began, by year of its
          calendar.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(14rem,1fr)]">
        <div className="flex flex-col gap-4">
          <Span
            from={from}
            to={to}
            onChange={(f, t) =>
              update((q) => {
                if (f === undefined) q.delete('from');
                else q.set('from', String(f));
                if (t === undefined) q.delete('to');
                else q.set('to', String(t));
              })
            }
          />
          {pages.error && (
            <ErrorNotice error={pages.error} onRetry={pages.reload} />
          )}
          {pages.loading && !pages.data && (
            <Loading label="Reading the years…" />
          )}
          {pages.data && years.length === 0 && (
            <Notice title="Nothing dated here">
              {chosen.length === 0
                ? 'Choose what to show.'
                : 'No record of the chosen kinds begins in this span.'}
            </Notice>
          )}
          {truncated.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing the first {PAGE} {truncated.join(', ')}; narrow the span
              to see the rest.
            </p>
          )}
          <ol className="flex flex-col gap-4">
            {years.map(([year, list]) => (
              <li
                key={year}
                className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3"
              >
                <h2 className="text-right text-sm font-semibold tabular-nums text-muted-foreground">
                  {year}
                </h2>
                <ul className="flex flex-col gap-1 border-l pl-3">
                  {list.map((entry) => (
                    <li
                      key={`${entry.model}/${entry.resource.id}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <Badge variant="outline">
                        {ontology.label(entry.model)}
                      </Badge>
                      <Link
                        className="underline-offset-4 hover:underline"
                        to={recordPath(
                          world.id,
                          entry.model,
                          entry.resource.id,
                        )}
                      >
                        {nameOf(entry.resource)}
                      </Link>
                      {entry.end !== undefined && entry.end !== entry.begin && (
                        <span className="text-muted-foreground">
                          until {entry.end}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <aside className="flex flex-col gap-4 text-sm">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dated by the ontology
            </legend>
            <ModelToggles models={dated} chosen={chosen} onToggle={toggle} />
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Anything else with a date
            </legend>
            <ModelToggles
              models={ontology.models.filter((m) => m.validTime === undefined)}
              chosen={chosen}
              onToggle={toggle}
            />
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function Span(props: {
  readonly from?: number;
  readonly to?: number;
  readonly onChange: (from?: number, to?: number) => void;
}) {
  const [from, setFrom] = useState(props.from?.toString() ?? '');
  const [to, setTo] = useState(props.to?.toString() ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onChange(yearParam(from), yearParam(to));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="timeline-from">From year</Label>
        <Input
          id="timeline-from"
          type="number"
          className="w-28"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="timeline-to">To year</Label>
        <Input
          id="timeline-to"
          type="number"
          className="w-28"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline">
        Show
      </Button>
      {(props.from !== undefined || props.to !== undefined) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setFrom('');
            setTo('');
            props.onChange(undefined, undefined);
          }}
        >
          All years
        </Button>
      )}
    </form>
  );
}

function ModelToggles(props: {
  readonly models: readonly ModelInfo[];
  readonly chosen: readonly string[];
  readonly onToggle: (id: string, on: boolean) => void;
}) {
  if (props.models.length === 0) {
    return <p className="mt-1 text-muted-foreground">None.</p>;
  }
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {props.models.map((m) => (
        <li key={m.id}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={props.chosen.includes(m.id)}
              onChange={(e) => props.onToggle(m.id, e.target.checked)}
            />
            {m.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

function yearParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const year = Number(value);
  return Number.isInteger(year) ? year : undefined;
}

/** The year a record's valid time begins or ends, when it has one. */
function yearOf(
  resource: Resource,
  bound: 'begin' | 'end',
): number | undefined {
  const time = resource.validTime as
    { begin?: { year?: unknown }; end?: { year?: unknown } } | undefined;
  const year = time?.[bound]?.year;
  return typeof year === 'number' ? year : undefined;
}

function nameOf(resource: Resource): string {
  return typeof resource.name === 'string' ? resource.name : resource.id;
}
