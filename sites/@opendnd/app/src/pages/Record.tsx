import {
  FeatherIcon,
  HourglassIcon,
  MapIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Problem } from '../api/client';
import type { ReferenceHit } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { Article } from '../components/Article';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { cellModels, parseCell } from '../schema/cells';
import { type Field, describe } from '../schema/fields';
import {
  type RelatedAction,
  dateOf,
  labelOf,
  referringFields,
  relatedActions,
  rootOf,
} from '../schema/related';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One resource: its article, what links to it, and its history. */
export function Record() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const { model = '', id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const at = params.get('at') ?? '';
  const asOf = params.get('asOf') ?? '';
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<Error>();

  const schema = ontology.schema(model);
  const root = useMemo(
    () => (schema ? describe(schema, ontology, { name: model }) : undefined),
    [schema, ontology, model],
  );
  const resource = useRequest(
    () =>
      api.get(world.id, model, id, {
        at: at || undefined,
        asOf: asOf || undefined,
      }),
    [api, world.id, model, id, at, asOf],
  );
  const references = useRequest(
    () => api.references(world.id, model, id),
    [api, world.id, model, id],
  );
  const history = useRequest(
    () => api.history(world.id, model, id),
    [api, world.id, model, id],
  );
  const actions = useMemo(
    () => relatedActions(ontology, model),
    [ontology, model],
  );
  const cellField = useMemo(
    () => cellModels(ontology).find((m) => m.model === model)?.field,
    [ontology, model],
  );
  const onMap =
    cellField !== undefined
      ? parseCell(resource.data?.body[cellField])?.token
      : undefined;

  const remove = async () => {
    setRemoving(true);
    try {
      await api.remove(world.id, model, id);
      void navigate(`/worlds/${world.id}/${model}`);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause : new Error(String(cause)));
      setRemoving(false);
    }
  };

  if (!root) {
    return (
      <Notice tone="warning" title={`There is no model called ${model}`} />
    );
  }

  const notAtTime =
    resource.error instanceof Problem &&
    resource.error.code === 'not-found' &&
    at !== '';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <div className="flex flex-col gap-4">
        {asOf && (
          <Notice
            tone="warning"
            title={`As it was on ${new Date(asOf).toLocaleString()}`}
            action={
              <Button variant="outline" size="xs" onClick={() => setParams({})}>
                Current version
              </Button>
            }
          >
            An earlier revision, read only.
          </Notice>
        )}
        {notAtTime ? (
          <Notice tone="warning" title={`Nothing recorded for year ${at}`}>
            This record does not hold at that point in the world&apos;s time.
          </Notice>
        ) : (
          resource.error && (
            <ErrorNotice error={resource.error} onRetry={resource.reload} />
          )
        )}
        {resource.loading && !resource.data && <Loading />}
        {resource.data && <Article resource={resource.data.body} root={root} />}
      </div>

      <aside className="flex flex-col gap-4 text-sm">
        {canEdit && !asOf && (
          <div className="flex flex-wrap gap-2">
            <Button
              render={<Link to={`${recordPath(world.id, model, id)}/edit`} />}
            >
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            {ontology.model(model)?.simulate && (
              <Button
                variant="outline"
                render={
                  <Link to={`${recordPath(world.id, model, id)}/simulate`} />
                }
              >
                <HourglassIcon data-icon="inline-start" />
                Simulate history
              </Button>
            )}
            {ontology.model(model)?.author && (
              <Button
                variant="outline"
                render={
                  <Link to={`${recordPath(world.id, model, id)}/author`} />
                }
              >
                <FeatherIcon data-icon="inline-start" />
                Write about this
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" disabled={removing} />}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its history is kept, and anything that refers to it will
                    point at a record that is gone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={remove}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        {removeError && <ErrorNotice error={removeError} />}

        {onMap && (
          <div>
            <Button
              variant="outline"
              size="sm"
              render={<Link to={`/worlds/${world.id}/map?cell=${onMap}`} />}
            >
              <MapIcon data-icon="inline-start" />
              On the map
            </Button>
          </div>
        )}

        <Card size="sm">
          <CardHeader>
            <CardTitle>In-world time</CardTitle>
            <CardDescription>
              The record as it held in a year of the world, for models whose
              facts have a span.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Label htmlFor="at-year">Year</Label>
              <Input
                id="at-year"
                type="number"
                className="w-28"
                value={at}
                onChange={(e) =>
                  setParams(e.target.value ? { at: e.target.value } : {}, {
                    replace: true,
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        {canEdit && !asOf && actions.length > 0 && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Add a linked record</CardTitle>
              <CardDescription>
                New records that refer to this one, or that it refers to, with
                the link already made.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {actions.map((action) => (
                  <Link
                    key={`${action.target}/${action.set ?? ''}/${action.link ?? ''}`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'xs',
                    })}
                    title={action.description}
                    to={createPath(world.id, model, id, action)}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {action.label}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card size="sm">
          <CardHeader>
            <CardTitle>What links here</CardTitle>
          </CardHeader>
          <CardContent>
            {references.error && <ErrorNotice error={references.error} />}
            {references.data?.length === 0 && (
              <p className="text-muted-foreground">
                Nothing refers to this yet.
              </p>
            )}
            <ReferenceList
              hits={references.data ?? []}
              world={world.id}
              id={id}
            />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {history.error && <ErrorNotice error={history.error} />}
            <ol className="flex flex-col gap-1">
              {history.data?.map((entry) => (
                <li
                  key={entry.revision}
                  className="flex items-center justify-between gap-2"
                >
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setParams({ asOf: entry.recordedAt })}
                  >
                    Revision {entry.revision}
                    {entry.deleted && ' (deleted)'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.recordedAt).toLocaleString()}
                    {entry.generatedBy && ` · ${entry.generatedBy}`}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

/** Where a new record linked to this one is made. */
function createPath(
  world: string,
  model: string,
  id: string,
  action: RelatedAction,
): string {
  const query = new URLSearchParams({ ref: `${model}/${id}` });
  if (action.set) query.set('set', action.set);
  if (action.link) query.set('link', action.link);
  return `/worlds/${world}/${action.target}/new?${query.toString()}`;
}

/**
 * What refers to a record, by model, each entry saying through which field
 * and, when the record carries a date, when: a list of sessions reads as a
 * chronology, a list of holders as a roll.
 */
function ReferenceList(props: {
  readonly hits: readonly ReferenceHit[];
  readonly world: string;
  readonly id: string;
}) {
  const ontology = useOntology();
  const groups = useMemo(() => {
    const roots = new Map<string, Field | undefined>();
    const byModel = new Map<string, Entry[]>();
    for (const hit of props.hits) {
      if (!roots.has(hit.model)) {
        roots.set(hit.model, rootOf(ontology, hit.model));
      }
      const root = roots.get(hit.model);
      const entry: Entry = {
        hit,
        via: referringFields(hit.resource, props.id).map((name) =>
          labelOf(root, name),
        ),
        date: dateOf(hit.resource, root),
      };
      byModel.set(hit.model, [...(byModel.get(hit.model) ?? []), entry]);
    }
    for (const entries of byModel.values()) entries.sort(compareEntries);
    return byModel;
  }, [props.hits, props.id, ontology]);

  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([model, entries]) => (
        <div key={model}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ontology.label(model)}
          </h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {entries.map(({ hit, via, date }) => (
              <li key={hit.resource.id} className="flex flex-col">
                <Link
                  className="underline-offset-4 hover:underline"
                  to={recordPath(props.world, model, hit.resource.id)}
                >
                  {hit.resource.name ?? hit.resource.id}
                </Link>
                {(via.length > 0 || date) && (
                  <span className="text-xs text-muted-foreground">
                    {via.length > 0 && `as ${via.join(', ').toLowerCase()}`}
                    {via.length > 0 && date && ' · '}
                    {date && `${date.label.toLowerCase()} ${formatDate(date)}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface Entry {
  readonly hit: ReferenceHit;
  readonly via: readonly string[];
  readonly date: ReturnType<typeof dateOf>;
}

/** Dated entries first, in date order; the rest by name. */
function compareEntries(a: Entry, b: Entry): number {
  if (a.date && b.date) return a.date.value.localeCompare(b.date.value);
  if (a.date) return -1;
  if (b.date) return 1;
  return String(a.hit.resource.name ?? '').localeCompare(
    String(b.hit.resource.name ?? ''),
  );
}

function formatDate(date: NonNullable<ReturnType<typeof dateOf>>): string {
  const parsed = new Date(date.value);
  if (Number.isNaN(parsed.getTime())) return date.value;
  return date.kind === 'date'
    ? parsed.toLocaleDateString(undefined, { timeZone: 'UTC' })
    : parsed.toLocaleString();
}
