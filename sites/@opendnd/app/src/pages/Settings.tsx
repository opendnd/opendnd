import { ArchiveIcon, MailIcon, PackageIcon, XIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Member, Module, Role, Usage, Visibility } from '../api/types';
import { useApi, useSession } from '../app/context';
import { useRequest } from '../app/hooks';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
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

const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];

/**
 * A world's own settings: what it is called and who may see it, who belongs
 * and who is invited, what it has spent, and putting it away. Owners only,
 * because the API allows no one else.
 */
export function Settings() {
  const { world, isOwner } = useWorld();
  if (!isOwner) {
    return (
      <Notice
        tone="warning"
        title="Only an owner may change a world's settings"
      >
        Ask an owner of {world.name} to make the change, or to make you one.
      </Notice>
    );
  }
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Settings for {world.name}
      </h1>
      <About />
      <Members />
      <Modules />
      <Publish />
      <Spend />
      <Archive />
    </div>
  );
}

function About() {
  const api = useApi();
  const me = useMe();
  const { world } = useWorld();
  const record = useRequest(
    () => api.get(world.id, 'world', world.id),
    [api, world.id],
  );
  const [name, setName] = useState(world.name);
  const [visibility, setVisibility] = useState(world.visibility);
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    const current = record.data?.body.summary;
    setSummary(typeof current === 'string' ? current : '');
  }, [record.data]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      await api.updateWorld(world.id, {
        name: name.trim(),
        visibility,
        summary: summary.trim() === '' ? null : summary.trim(),
      });
      setSaved(true);
      me.reload();
      record.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>About this world</CardTitle>
        <CardDescription>
          Its name and summary are also on the world's own record, which follows
          whatever is set here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} id="about-form">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="world-name">Name</FieldLabel>
              <Input
                id="world-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="world-visibility">Visibility</FieldLabel>
              <NativeSelect
                id="world-visibility"
                className="w-full"
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as 'private' | 'public')
                }
              >
                <NativeSelectOption value="private">
                  Private: members only
                </NativeSelectOption>
                <NativeSelectOption value="public">
                  Public: anyone may read
                </NativeSelectOption>
              </NativeSelect>
              <FieldDescription>
                Writing always needs a membership, whatever the visibility.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="world-summary">Summary</FieldLabel>
              <Textarea
                id="world-summary"
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={record.loading && !record.data}
              />
            </Field>
            {error && <ErrorNotice error={error} />}
            {saved && !error && (
              <Notice title="Saved">The world now reads as above.</Notice>
            )}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button
          type="submit"
          form="about-form"
          disabled={saving || name.trim() === ''}
        >
          {saving && <Spinner data-icon="inline-start" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Members() {
  const api = useApi();
  const session = useSession();
  const { world } = useWorld();
  const membership = useRequest(() => api.members(world.id), [api, world.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<Error>();

  const attempt = async (work: () => Promise<string | undefined>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setNotice(await work());
      membership.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const invite = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    void attempt(async () => {
      const answer = await api.setMember(world.id, { email: address, role });
      setEmail('');
      return answer
        ? `${answer.invited} is invited as ${answer.role}, and joins the first time they sign in.`
        : `${address} is now ${role} here.`;
    });
  };

  const changeRole = (member: Member, next: Role) =>
    void attempt(async () => {
      await api.setMember(world.id, { subject: member.subject, role: next });
      return `${member.name ?? member.subject} is now ${next}.`;
    });

  const remove = (member: Member) =>
    void attempt(async () => {
      await api.removeMember(world.id, member.subject);
      return `${member.name ?? member.subject} no longer belongs.`;
    });

  const withdraw = (address: string) =>
    void attempt(async () => {
      await api.withdrawInvitation(world.id, address);
      return `The invitation to ${address} is withdrawn.`;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Owners may do anything an editor may, and change the world itself.
          Editors write; viewers read. A world keeps at least one owner.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {membership.error && (
          <ErrorNotice error={membership.error} onRetry={membership.reload} />
        )}
        {membership.loading && !membership.data && <Loading />}
        {membership.data && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {membership.data.members.map((member) => {
                  const you = member.subject === session?.subject;
                  return (
                    <TableRow key={member.subject}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {member.name ?? member.subject}
                            {you && (
                              <Badge variant="secondary" className="ml-2">
                                you
                              </Badge>
                            )}
                          </span>
                          {member.email && (
                            <span className="text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          size="sm"
                          value={member.role}
                          disabled={busy}
                          aria-label={`Role of ${member.name ?? member.subject}`}
                          onChange={(e) =>
                            changeRole(member, e.target.value as Role)
                          }
                        >
                          {ROLES.map((r) => (
                            <NativeSelectOption key={r} value={r}>
                              {r}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => remove(member)}
                          aria-label={`Remove ${member.name ?? member.subject}`}
                        >
                          <XIcon data-icon="inline-start" />
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {membership.data.invitations.map((invitation) => (
                  <TableRow key={`invited:${invitation.email}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MailIcon className="size-4 text-muted-foreground" />
                        <span>{invitation.email}</span>
                        <Badge variant="outline">invited</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{invitation.role}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => withdraw(invitation.email)}
                        aria-label={`Withdraw the invitation to ${invitation.email}`}
                      >
                        <XIcon data-icon="inline-start" />
                        Withdraw
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <Field className="min-w-64 flex-1">
            <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
            />
          </Field>
          <Field className="w-32">
            <FieldLabel htmlFor="invite-role">As</FieldLabel>
            <NativeSelect
              id="invite-role"
              className="w-full"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {r}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" disabled={busy || email.trim() === ''}>
            {busy && <Spinner data-icon="inline-start" />}
            Invite
          </Button>
        </form>
        {error && <ErrorNotice error={error} />}
        {notice && !error && <Notice>{notice}</Notice>}
      </CardContent>
    </Card>
  );
}

/**
 * The modules a world reads beneath its own content, and enabling another.
 * The catalogue is what the API offers this owner: every public module, and
 * every module published from a world they belong to.
 */
function Modules() {
  const api = useApi();
  const { world } = useWorld();
  const enabled = useRequest(() => api.worldModules(world.id), [api, world.id]);
  const catalogue = useRequest(() => api.modules(), [api]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();

  const enabledIds = new Set((enabled.data?.modules ?? []).map((m) => m.id));
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
        <CardTitle>Modules</CardTitle>
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
              {enabled.data.modules.map((m) => (
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
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
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

function Spend() {
  const api = useApi();
  const { world } = useWorld();
  const usage = useRequest(() => api.usage(world.id), [api, world.id]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend</CardTitle>
        <CardDescription>
          What this world has spent on language model calls. Features that cost
          money to run are offered at cost plus ten percent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usage.error && (
          <ErrorNotice error={usage.error} onRetry={usage.reload} />
        )}
        {usage.loading && !usage.data && <Loading />}
        {usage.data && <UsageTable usage={usage.data} />}
      </CardContent>
    </Card>
  );
}

function UsageTable(props: { readonly usage: Usage }) {
  const { usage } = props;
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Calls</dt>
      <dd>{usage.calls.toLocaleString()}</dd>
      <dt className="text-muted-foreground">Tokens in</dt>
      <dd>{usage.inputTokens.toLocaleString()}</dd>
      <dt className="text-muted-foreground">Tokens out</dt>
      <dd>{usage.outputTokens.toLocaleString()}</dd>
      <dt className="text-muted-foreground">Cost</dt>
      <dd>{dollars(usage.costMicros)}</dd>
      <dt className="text-muted-foreground">Charged</dt>
      <dd>{dollars(usage.chargeMicros)}</dd>
    </dl>
  );
}

/** Millionths of a dollar as dollars, with the cents that matter. */
export function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(micros < 1_000_000 ? 4 : 2)}`;
}

function Archive() {
  const api = useApi();
  const me = useMe();
  const { world } = useWorld();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();

  const archive = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.archiveWorld(world.id);
      me.reload();
      void navigate('/worlds');
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Put this world away</CardTitle>
        <CardDescription>
          Archiving keeps everything and stops the world being listed or served.
          An owner can bring it back from the worlds page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <ErrorNotice error={error} />}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive" disabled={busy} />}
          >
            <ArchiveIcon data-icon="inline-start" />
            Archive {world.name}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {world.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Nothing is deleted. The world leaves everyone's list until an
                owner restores it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={archive}>
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
