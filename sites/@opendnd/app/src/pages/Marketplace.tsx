import {
  ArrowDownIcon,
  ArrowUpIcon,
  PackageIcon,
  StoreIcon,
  XIcon,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { Module, Visibility } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

/**
 * Modules: content published from a world, offered to others. What this
 * world reads, in order; what it could enable; and publishing it in turn.
 * Everyone signed in may look; owners change the stack and publish.
 */
export function Marketplace() {
  const { world, isOwner } = useWorld();
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl">Marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Modules are worlds, published: an immutable snapshot another world
          reads beneath its own. Enable one and its records appear here as{' '}
          {world.name}&apos;s own; edit one and this world keeps its copy.
        </p>
      </header>
      {!isOwner && (
        <Notice title="Owners change what a world reads">
          <span className="flex items-center gap-2">
            <StoreIcon className="size-4" />
            You can see what {world.name} reads and what is on offer; an owner
            enables, disables and publishes.
          </span>
        </Notice>
      )}
      <Modules canManage={isOwner} />
      {isOwner && <Publish />}
    </div>
  );
}

function Modules(props: { readonly canManage: boolean }) {
  const api = useApi();
  const { world } = useWorld();
  const enabled = useRequest(() => api.worldModules(world.id), [api, world.id]);
  const catalogue = useRequest(() => api.modules(), [api]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();

  const stack = enabled.data?.modules ?? [];
  const enabledIds = new Set(stack.map((m) => m.id));

  /** Nearest first: swapping two neighbours is how an owner changes who wins. */
  const move = (from: number, to: number) => {
    const order = stack.map((m) => m.id);
    [order[from], order[to]] = [order[to]!, order[from]!];
    return api.reorderModules(world.id, order);
  };
  const offered = (catalogue.data?.modules ?? []).filter(
    (m) => !enabledIds.has(m.id),
  );

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      enabled.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const enable = (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    void act(async () => {
      await api.enableModule(world.id, choice);
      setChoice('');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enabled in this world</CardTitle>
        <CardDescription>
          Content this world reads beneath its own, nearest first. A module's
          records appear here as the world's own; editing one keeps this world's
          copy, and disabling the module leaves that copy in place.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {enabled.loading && <Loading label="Loading modules…" />}
        {enabled.error && <ErrorNotice error={enabled.error} />}
        {enabled.data && enabled.data.modules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This world reads no modules yet.
          </p>
        )}
        {enabled.data && enabled.data.modules.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Holds</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stack.map((m, index) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className="font-medium">{m.name}</span>
                    {m.summary && (
                      <span className="block text-muted-foreground">
                        {m.summary}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{m.version}</TableCell>
                  <TableCell>
                    <Contents module={m} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {props.canManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${m.name} up`}
                          disabled={busy || index === 0}
                          onClick={() => void act(() => move(index, index - 1))}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${m.name} down`}
                          disabled={busy || index === stack.length - 1}
                          onClick={() => void act(() => move(index, index + 1))}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Disable ${m.name}`}
                          disabled={busy}
                          onClick={() =>
                            void act(() => api.disableModule(world.id, m.id))
                          }
                        >
                          <XIcon />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {props.canManage && (
          <form onSubmit={enable} className="flex flex-wrap items-end gap-2">
            <Field className="min-w-64 flex-1">
              <FieldLabel htmlFor="module-choice">Enable a module</FieldLabel>
              <NativeSelect
                id="module-choice"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                disabled={offered.length === 0}
              >
                <NativeSelectOption value="">
                  {offered.length === 0
                    ? 'Nothing more to enable'
                    : 'Choose a module'}
                </NativeSelectOption>
                {offered.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name} {m.version} · {m.total} records ·{' '}
                    {m.digest.slice(7, 14)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={busy || choice === ''}>
              Enable
            </Button>
          </form>
        )}
        {catalogue.error && <ErrorNotice error={catalogue.error} />}
        {error && <ErrorNotice error={error} />}
      </CardContent>
    </Card>
  );
}

/** What a module holds, by kind, in the ontology's words. */
function Contents(props: { readonly module: Module }) {
  const ontology = useOntology();
  const parts = Object.entries(props.module.contents)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, count]) => `${count} ${ontology.label(model).toLowerCase()}`);
  return (
    <span title={parts.join(', ')}>
      {props.module.total} records
      {parts.length > 0 && (
        <span className="block text-muted-foreground">{parts.join(', ')}</span>
      )}
    </span>
  );
}

/**
 * Publish the world as a module: a snapshot of its own content, as it
 * stands, that any world offered it may enable.
 */
function Publish() {
  const api = useApi();
  const { world } = useWorld();
  const [name, setName] = useState(world.name);
  const [version, setVersion] = useState('1.0.0');
  const [license, setLicense] = useState('');
  const [summary, setSummary] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [published, setPublished] = useState<Module>();

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setPublished(undefined);
    try {
      setPublished(
        await api.publishModule(world.id, {
          name: name.trim(),
          version: version.trim(),
          ...(license.trim() ? { license: license.trim() } : {}),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          visibility,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish this world as a module</CardTitle>
        <CardDescription>
          A snapshot of everything here, as it stands, for other worlds to read.
          Publishing changes nothing in this world, and the same content
          publishes once: an unchanged world answers with the module it already
          published.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={publish} id="publish-form">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="module-name">Module name</FieldLabel>
              <Input
                id="module-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="module-version">Version</FieldLabel>
                <Input
                  id="module-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="module-license">License</FieldLabel>
                <Input
                  id="module-license"
                  value={license}
                  placeholder="CC-BY-4.0"
                  onChange={(e) => setLicense(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="module-visibility">
                  Who may enable it
                </FieldLabel>
                <NativeSelect
                  id="module-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                >
                  <NativeSelectOption value="private">
                    Members of this world
                  </NativeSelectOption>
                  <NativeSelectOption value="public">
                    Anyone signed in
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="module-summary">Module summary</FieldLabel>
              <Textarea
                id="module-summary"
                rows={2}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <FieldDescription>
                What a world enabling this should expect to find.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
        {error && <ErrorNotice error={error} />}
        {published && (
          <Notice title={`Published ${published.name} ${published.version}`}>
            {published.total} records, addressed as{' '}
            <code className="text-xs">{published.digest}</code>.
          </Notice>
        )}
      </CardContent>
      <CardFooter>
        <Button
          type="submit"
          form="publish-form"
          disabled={busy || name.trim() === '' || version.trim() === ''}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PackageIcon data-icon="inline-start" />
          )}
          Publish
        </Button>
      </CardFooter>
    </Card>
  );
}
