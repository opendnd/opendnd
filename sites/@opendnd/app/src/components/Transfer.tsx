import { DownloadIcon, UploadIcon } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import { useApi } from '../app/context';
import { useOntology } from '../app/ontology';
import { useWorld } from '../app/world';
import { ErrorNotice, Notice } from '../components/Notice';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/**
 * A world as a file, both ways: export everything as the bundle the API
 * serves, or as a prose digest; import a bundle, an exported one or a plain
 * list, after seeing what it holds.
 */
export function Transfer() {
  const { canEdit } = useWorld();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Take it with you</CardTitle>
        <CardDescription>
          Everything in the world as a file. A JSON bundle can be imported into
          any world; the digest is for reading.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Export />
        {canEdit && <Import />}
      </CardContent>
    </Card>
  );
}

function Export() {
  const api = useApi();
  const { world } = useWorld();
  const [busy, setBusy] = useState<'json' | 'markdown'>();
  const [error, setError] = useState<Error>();

  const download = async (format: 'json' | 'markdown') => {
    setBusy(format);
    setError(undefined);
    try {
      const { blob, filename } = await api.exportWorld(world.id, format);
      saveFile(blob, filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => void download('json')}
        >
          {busy === 'json' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          Export as a bundle
        </Button>
        <Button
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => void download('markdown')}
        >
          {busy === 'markdown' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          Export as a digest
        </Button>
      </div>
      {error && <ErrorNotice error={error} />}
    </div>
  );
}

interface Parsed {
  readonly bundle: unknown;
  readonly counts: ReadonlyMap<string, number>;
  readonly total: number;
}

function Import() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const [parsed, setParsed] = useState<Parsed>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [done, setDone] = useState<number>();

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setParsed(undefined);
    setProblem(undefined);
    setDone(undefined);
    setError(undefined);
    if (!file) return;
    try {
      setParsed(summarise(JSON.parse(await file.text())));
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.importBundle(world.id, parsed.bundle);
      setDone(result.imported);
      setParsed(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="import-file">Import a bundle</FieldLabel>
        <Input
          id="import-file"
          type="file"
          accept="application/json,.json"
          onChange={(e) => void choose(e)}
        />
        <FieldDescription>
          A bundle exported from any world, or a list of resources each carrying
          its model. Records with the same ids are updated, not duplicated;
          everything lands in one transaction or not at all.
        </FieldDescription>
      </Field>
      {problem && (
        <Notice tone="error" title="That file is not a bundle">
          {problem}
        </Notice>
      )}
      {parsed && (
        <Notice title={`${parsed.total} resources to import`}>
          <ul className="list-disc pl-5">
            {[...parsed.counts.entries()].map(([model, count]) => (
              <li key={model}>
                {count} {ontology.label(model).toLowerCase()}
              </li>
            ))}
          </ul>
          <Button
            className="mt-2"
            size="sm"
            disabled={busy || parsed.total === 0}
            onClick={() => void run()}
          >
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UploadIcon data-icon="inline-start" />
            )}
            Import {parsed.total} resources
          </Button>
        </Notice>
      )}
      {error && <ErrorNotice error={error} />}
      {done !== undefined && (
        <Notice title={`Imported ${done} resources`}>
          They are in the world now, with their history continued.
        </Notice>
      )}
    </div>
  );
}

/** What a file holds, counted by model, whichever of the three shapes it is in. */
export function summarise(bundle: unknown): Parsed {
  const entries = entriesOf(bundle);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const model = modelOf(entry);
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return { bundle, counts, total: entries.length };
}

function entriesOf(bundle: unknown): unknown[] {
  if (Array.isArray(bundle)) return bundle;
  if (typeof bundle === 'object' && bundle !== null) {
    const record = bundle as { resources?: unknown; entry?: unknown };
    if (Array.isArray(record.resources)) return record.resources;
    if (Array.isArray(record.entry)) return record.entry;
  }
  throw new Error(
    'expected a bundle with an `entry` list, a `resources` list, or a list of resources',
  );
}

function modelOf(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) return 'unknown';
  const record = entry as { model?: unknown; resource?: { model?: unknown } };
  if (typeof record.model === 'string') return record.model;
  if (typeof record.resource?.model === 'string') return record.resource.model;
  return 'unknown';
}

/** Hand the browser a file to save. */
function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Let the click begin before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
