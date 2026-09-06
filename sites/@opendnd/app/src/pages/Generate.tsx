import { SparklesIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Resource } from '../api/types';
import { useApi } from '../app/context';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { SchemaForm } from '../components/Form';
import { ErrorNotice, Notice } from '../components/Notice';
import { describe } from '../schema/fields';
import { initialValue, prune } from '../schema/value';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** How many of each kind the result table shows before summarising the rest. */
const SHOWN = 8;

/**
 * Generate resources of a model from what the world already holds.
 *
 * The form is built from the generator's input schema as the API describes
 * it, the same way a resource's form is built from its schema. Nothing is
 * saved until the results are kept: generation is an offer.
 */
export function Generate() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const { model = '' } = useParams();
  const navigate = useNavigate();

  const info = ontology.model(model);
  const generator = info?.generate;
  const root = useMemo(
    () =>
      generator
        ? describe(generator.input, ontology, { name: model })
        : undefined,
    [generator, ontology, model],
  );

  // Started from the schema's defaults at once, so the form is there on the
  // first render; started again whenever the model, and so the form, changes.
  const [value, setValue] = useState<Record<string, unknown> | undefined>(() =>
    root ? (initialValue(root) as Record<string, unknown>) : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [results, setResults] = useState<Resource[]>();
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<Error>();

  useEffect(() => {
    setValue(
      root ? (initialValue(root) as Record<string, unknown>) : undefined,
    );
    setResults(undefined);
  }, [root]);

  const run = async () => {
    if (!value) return;
    setBusy(true);
    setError(undefined);
    setKeepError(undefined);
    try {
      setResults(await api.generate(world.id, model, prune(value) ?? {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const keep = async () => {
    if (!results || results.length === 0) return;
    setKeeping(true);
    setKeepError(undefined);
    try {
      await api.importResources(world.id, results);
      const own = results.filter((r) => r.model === model);
      void navigate(
        own.length === 1 && own[0]
          ? recordPath(world.id, model, own[0].id)
          : `/worlds/${world.id}/${model}`,
      );
    } catch (cause) {
      setKeepError(cause instanceof Error ? cause : new Error(String(cause)));
      setKeeping(false);
    }
  };

  if (!info) {
    return (
      <Notice tone="warning" title={`There is no model called ${model}`} />
    );
  }
  if (!generator || !root) {
    return (
      <Notice
        tone="warning"
        title={`Nothing generates a ${info.name.toLowerCase()} yet`}
        action={
          <Button
            variant="outline"
            size="xs"
            render={<Link to={`/worlds/${world.id}/${model}`} />}
          >
            Back
          </Button>
        }
      >
        Every model can be authored by hand; only some have a generator.
      </Notice>
    );
  }

  const label = info.name.toLowerCase();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Generate a {label}
        </h1>
        <p className="text-sm text-muted-foreground">{generator.description}</p>
      </header>

      {value && (
        <SchemaForm
          root={root}
          value={value}
          onChange={setValue}
          onSubmit={run}
          submitting={busy}
          submitLabel={results ? 'Generate again' : 'Generate'}
          error={error}
        >
          <Button
            variant="ghost"
            render={<Link to={`/worlds/${world.id}/${model}`} />}
          >
            Cancel
          </Button>
        </SchemaForm>
      )}

      {results && (
        <Results
          results={results}
          label={ontology.label.bind(ontology)}
          canKeep={canEdit}
          keeping={keeping}
          error={keepError}
          onKeep={keep}
          onDiscard={() => setResults(undefined)}
        />
      )}
    </div>
  );
}

function Results(props: {
  readonly results: readonly Resource[];
  readonly label: (model: string) => string;
  readonly canKeep: boolean;
  readonly keeping: boolean;
  readonly error?: Error;
  onKeep(): void;
  onDiscard(): void;
}) {
  const groups = new Map<string, Resource[]>();
  for (const resource of props.results) {
    const key = resource.model ?? 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), resource]);
  }
  const summary = [...groups.entries()]
    .map(
      ([model, items]) => `${items.length} ${props.label(model).toLowerCase()}`,
    )
    .join(', ');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Generated {summary}
        </CardTitle>
        <CardDescription>
          Nothing is saved yet. Keep them all, or generate again for a different
          result.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...groups.entries()].flatMap(([model, items]) => [
                ...items.slice(0, SHOWN).map((item) => (
                  <TableRow key={`${model}/${item.id}`}>
                    <TableCell>{item.name ?? item.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{props.label(model)}</Badge>
                    </TableCell>
                  </TableRow>
                )),
                ...(items.length > SHOWN
                  ? [
                      <TableRow key={`${model}/more`}>
                        <TableCell
                          colSpan={2}
                          className="text-muted-foreground"
                        >
                          and {items.length - SHOWN} more{' '}
                          {props.label(model).toLowerCase()}
                        </TableCell>
                      </TableRow>,
                    ]
                  : []),
              ])}
            </TableBody>
          </Table>
        </div>
        {props.error && <ErrorNotice error={props.error} />}
      </CardContent>
      <CardFooter className="gap-2">
        {props.canKeep ? (
          <Button onClick={props.onKeep} disabled={props.keeping}>
            {props.keeping && <Spinner data-icon="inline-start" />}
            {props.keeping ? 'Keeping…' : 'Keep all'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only an editor or owner of this world can keep what was generated.
          </p>
        )}
        <Button
          variant="ghost"
          onClick={props.onDiscard}
          disabled={props.keeping}
        >
          Discard
        </Button>
      </CardFooter>
    </Card>
  );
}
