import {
  FeatherIcon,
  HourglassIcon,
  PencilIcon,
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
import { describe, humanize } from '../schema/fields';
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
import { Button } from '@/components/ui/button';
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
            <ReferenceList hits={references.data ?? []} world={world.id} />
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

function ReferenceList(props: {
  readonly hits: readonly ReferenceHit[];
  readonly world: string;
}) {
  const groups = new Map<string, ReferenceHit[]>();
  for (const hit of props.hits) {
    groups.set(hit.model, [...(groups.get(hit.model) ?? []), hit]);
  }
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([model, hits]) => (
        <div key={model}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {humanize(model)}
          </h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {hits.map((hit) => (
              <li key={hit.resource.id}>
                <Link
                  className="underline-offset-4 hover:underline"
                  to={recordPath(props.world, model, hit.resource.id)}
                >
                  {hit.resource.name ?? hit.resource.id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
