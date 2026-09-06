import { GlobeIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useMe } from '../app/me';
import { ErrorNotice, Loading } from '../components/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

export function Worlds() {
  const api = useApi();
  const me = useMe();
  const archived = useRequest(() => api.worlds(true), [api]);
  const [restoring, setRestoring] = useState<string>();
  const [restoreError, setRestoreError] = useState<Error>();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.createWorld({ name: name.trim(), visibility });
      setName('');
      me.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (id: string) => {
    setRestoring(id);
    setRestoreError(undefined);
    try {
      await api.restoreWorld(id);
      me.reload();
      archived.reload();
    } catch (cause) {
      setRestoreError(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    } finally {
      setRestoring(undefined);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your worlds</h1>
        {me.error && <ErrorNotice error={me.error} onRetry={me.reload} />}
        {me.loading && !me.data && <Loading />}
        {me.data && me.data.worlds.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon />
              </EmptyMedia>
              <EmptyTitle>No worlds yet</EmptyTitle>
              <EmptyDescription>
                Make one alongside and it will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {me.data && me.data.worlds.length > 0 && (
          <ItemGroup className="gap-2">
            {me.data.worlds.map((world) => (
              <Item
                key={world.id}
                variant="outline"
                render={<Link to={`/worlds/${world.id}`} />}
              >
                <ItemContent>
                  <ItemTitle>{world.name}</ItemTitle>
                  <ItemDescription>
                    {world.visibility === 'public'
                      ? 'Anyone may read'
                      : 'Members only'}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">{world.role ?? 'visitor'}</Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}

        {archived.data && archived.data.length > 0 && (
          <section className="flex flex-col gap-2 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Put away
            </h2>
            {restoreError && <ErrorNotice error={restoreError} />}
            <ItemGroup className="gap-2">
              {archived.data.map((world) => (
                <Item key={world.id} variant="muted">
                  <ItemContent>
                    <ItemTitle>{world.name}</ItemTitle>
                    <ItemDescription>
                      Archived
                      {world.archivedAt &&
                        ` ${new Date(world.archivedAt).toLocaleDateString()}`}
                      . Kept whole; not listed or served.
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restoring !== undefined}
                      onClick={() => restore(world.id)}
                    >
                      {restoring === world.id && (
                        <Spinner data-icon="inline-start" />
                      )}
                      Restore
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New world</CardTitle>
          <CardDescription>
            A world is its own space; nothing crosses between worlds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create}>
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
              </Field>
              {error && <ErrorNotice error={error} />}
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving && <Spinner data-icon="inline-start" />}
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
