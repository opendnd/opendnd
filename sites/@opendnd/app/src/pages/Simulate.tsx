import { HourglassIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Finding, SimulateResult } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { SchemaForm } from '../components/Form';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { type Field, describe } from '../schema/fields';
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

/**
 * Run the history simulation over a world, a house or a place.
 *
 * The form comes from the simulation's input as the API describes it. A run
 * is a rehearsal first: what it would produce is counted and checked, and
 * only Keep runs it again with `save` set, which the API does
 * deterministically, so what was looked at is what is kept.
 */
export function Simulate() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const { model = '', id = '' } = useParams();

  const info = ontology.model(model);
  const simulation = info?.simulate;
  const root = useMemo<Field | undefined>(() => {
    if (!simulation) return undefined;
    const described = describe(simulation.input, ontology, { name: model });
    // Whether to keep a run is this page's decision, made after looking.
    return {
      ...described,
      fields: described.fields?.filter((f) => f.name !== 'save'),
    };
  }, [simulation, ontology, model]);

  const subject = useRequest(
    () => api.get(world.id, model, id),
    [api, world.id, model, id],
  );

  const [value, setValue] = useState<Record<string, unknown> | undefined>(() =>
    root ? (initialValue(root) as Record<string, unknown>) : undefined,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error>();
  const [result, setResult] = useState<SimulateResult>();
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<Error>();

  useEffect(() => {
    setValue(
      root ? (initialValue(root) as Record<string, unknown>) : undefined,
    );
    setResult(undefined);
  }, [root]);

  const run = async (save: boolean) => {
    if (!value) return;
    const set = save ? setKeeping : setRunning;
    set(true);
    setError(undefined);
    setKeepError(undefined);
    try {
      const outcome = await api.simulate(world.id, model, id, {
        ...(prune(value) ?? {}),
        save,
      });
      setResult(outcome);
    } catch (cause) {
      (save ? setKeepError : setError)(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    } finally {
      set(false);
    }
  };

  if (!info) {
    return (
      <Notice tone="warning" title={`There is no model called ${model}`} />
    );
  }
  if (!simulation || !root) {
    return (
      <Notice
        tone="warning"
        title={`A history cannot be simulated for a ${info.name.toLowerCase()}`}
        action={
          <Button
            variant="outline"
            size="xs"
            render={<Link to={recordPath(world.id, model, id)} />}
          >
            Back
          </Button>
        }
      >
        A history runs over a world, or the houses and places inside it.
      </Notice>
    );
  }
  if (!canEdit) {
    return (
      <Notice tone="warning" title="Only an editor or owner may simulate here">
        A run is a write to the world, even before anything is kept.
      </Notice>
    );
  }

  const name =
    typeof subject.data?.body.name === 'string'
      ? subject.data.body.name
      : info.name;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Simulate the history of {name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {simulation.description}
        </p>
        {subject.error && <ErrorNotice error={subject.error} />}
      </header>

      {value && (
        <SchemaForm
          root={root}
          value={value}
          onChange={setValue}
          onSubmit={() => void run(false)}
          submitting={running}
          submitLabel={result ? 'Run again' : 'Run'}
          error={error}
        >
          <Button
            variant="ghost"
            render={<Link to={recordPath(world.id, model, id)} />}
          >
            Cancel
          </Button>
        </SchemaForm>
      )}

      {running && <Loading label="Running the years…" />}

      {result && (
        <Outcome
          result={result}
          label={ontology.label.bind(ontology)}
          world={world.id}
          keeping={keeping}
          error={keepError}
          onKeep={() => void run(true)}
          onDiscard={() => setResult(undefined)}
        />
      )}
    </div>
  );
}

function Outcome(props: {
  readonly result: SimulateResult;
  readonly label: (model: string) => string;
  readonly world: string;
  readonly keeping: boolean;
  readonly error?: Error;
  onKeep(): void;
  onDiscard(): void;
}) {
  const { result } = props;
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  const errors = result.findings.filter((f) => f.severity === 'error').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HourglassIcon className="size-4" />
          {result.saved ? 'Kept' : 'Rehearsed'} {result.startYear} to{' '}
          {result.endYear}
        </CardTitle>
        <CardDescription>
          {result.saved
            ? `${total.toLocaleString()} resources are now part of the world.`
            : `${total.toLocaleString()} resources would be produced. Nothing is saved yet.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(result.counts).map(([model, count]) => (
                <TableRow key={model}>
                  <TableCell>{props.label(model)}</TableCell>
                  <TableCell className="text-right">
                    {count.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Consistency{' '}
            {result.findings.length === 0 ? (
              <Badge variant="outline">nothing found</Badge>
            ) : (
              <Badge variant={errors > 0 ? 'destructive' : 'secondary'}>
                {result.findings.length} finding
                {result.findings.length === 1 ? '' : 's'}
              </Badge>
            )}
          </h3>
          {result.findings.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {result.findings.slice(0, 20).map((finding, index) => (
                <FindingRow key={index} finding={finding} />
              ))}
              {result.findings.length > 20 && (
                <li className="text-muted-foreground">
                  and {result.findings.length - 20} more
                </li>
              )}
            </ul>
          )}
        </section>
        {props.error && <ErrorNotice error={props.error} />}
      </CardContent>
      <CardFooter className="gap-2">
        {result.saved ? (
          <Button render={<Link to={`/worlds/${props.world}/event`} />}>
            See what happened
          </Button>
        ) : (
          <>
            <Button onClick={props.onKeep} disabled={props.keeping}>
              {props.keeping && <Spinner data-icon="inline-start" />}
              {props.keeping ? 'Keeping…' : 'Keep this history'}
            </Button>
            <Button
              variant="ghost"
              onClick={props.onDiscard}
              disabled={props.keeping}
            >
              Discard
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function FindingRow(props: { readonly finding: Finding }) {
  const { finding } = props;
  return (
    <li className="flex items-start gap-2">
      <Badge
        variant={finding.severity === 'error' ? 'destructive' : 'outline'}
        className="mt-0.5"
      >
        {finding.severity}
      </Badge>
      <span>
        <span className="font-medium">{finding.rule}</span>: {finding.message}
      </span>
    </li>
  );
}
