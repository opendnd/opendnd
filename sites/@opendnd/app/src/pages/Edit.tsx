import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Reference } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { SchemaForm } from '../components/Form';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { describe, humanize } from '../schema/fields';
import { rootOf } from '../schema/related';
import { editable, initialValue, prune } from '../schema/value';
import { Button } from '@/components/ui/button';

/**
 * Creates a resource, or edits one, through a form built from its schema.
 *
 * A new record can be made from another's page, linked to it: `?ref=` names
 * that record, `?set=` a field of the new record to point at it, and
 * `?link=` a field of that record to point at the new one once it is made.
 * The page then returns to the record it came from.
 */
export function Edit() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const { model = '', id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = id === undefined;

  const ref = useMemo(() => parseRef(params.get('ref')), [params]);
  const set = params.get('set') ?? undefined;
  const link = params.get('link') ?? undefined;

  const schema = ontology.schema(model, 'input');
  const root = useMemo(
    () => (schema ? describe(schema, ontology, { name: model }) : undefined),
    [schema, ontology, model],
  );

  const existing = useRequest(
    () => (isNew ? Promise.resolve(undefined) : api.get(world.id, model, id)),
    [api, world.id, model, id, isNew],
  );
  const source = useRequest(
    () =>
      ref && isNew
        ? api.get(world.id, ref.model, ref.id)
        : Promise.resolve(undefined),
    [api, world.id, ref, isNew],
  );

  const [value, setValue] = useState<Record<string, unknown>>();
  const [etag, setEtag] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!root) return;
    if (isNew) {
      if (ref && !source.data) return;
      const initial = initialValue(root) as Record<string, unknown>;
      if (ref && source.data && set) {
        const target: Reference = {
          model: ref.model,
          id: ref.id,
          ...(typeof source.data.body.name === 'string'
            ? { name: source.data.body.name }
            : {}),
        };
        const field = root.fields?.find((f) => f.name === set);
        if (field?.kind === 'list') initial[set] = [target];
        else if (field?.kind === 'reference') initial[set] = target;
      }
      setValue(initial);
    } else if (existing.data) {
      setValue(editable(existing.data.body, root));
      setEtag(existing.data.etag);
    }
  }, [root, isNew, existing.data, ref, set, source.data]);

  const submit = async () => {
    if (!value) return;
    setSaving(true);
    setError(undefined);
    let stored;
    try {
      const body = prune(value) ?? {};
      stored = isNew
        ? await api.create(world.id, model, body)
        : await api.put(world.id, model, id, body, etag);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setSaving(false);
      return;
    }
    if (isNew && ref && link) {
      try {
        await linkBack(ref, link, {
          model,
          id: stored.body.id,
          ...(typeof stored.body.name === 'string'
            ? { name: stored.body.name }
            : {}),
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        setError(
          new Error(
            `The ${humanize(model).toLowerCase()} was created, but could not be linked back: ${reason}`,
          ),
        );
        setSaving(false);
        return;
      }
    }
    void navigate(
      isNew && ref
        ? recordPath(world.id, ref.model, ref.id)
        : recordPath(world.id, model, stored.body.id),
    );
  };

  /** Point a field of the record this came from at the record just made. */
  const linkBack = async (
    from: Reference,
    field: string,
    target: Reference,
  ) => {
    const fresh = await api.get(world.id, from.model, from.id);
    const fromRoot = rootOf(ontology, from.model);
    if (!fromRoot) throw new Error(`there is no model called ${from.model}`);
    const body = editable(fresh.body, fromRoot);
    const kind = fromRoot.fields?.find((f) => f.name === field)?.kind;
    if (kind === 'list') {
      const current = Array.isArray(body[field]) ? body[field] : [];
      body[field] = [...current, target];
    } else if (kind === 'reference') {
      body[field] = target;
    } else {
      throw new Error(`${field} is not a reference field`);
    }
    await api.put(world.id, from.model, from.id, prune(body), fresh.etag);
  };

  if (!root) {
    return (
      <Notice tone="warning" title={`There is no model called ${model}`} />
    );
  }
  if (existing.error) {
    return <ErrorNotice error={existing.error} onRetry={existing.reload} />;
  }
  if (source.error) {
    return <ErrorNotice error={source.error} onRetry={source.reload} />;
  }
  if (!value) return <Loading />;

  const back = isNew
    ? ref
      ? recordPath(world.id, ref.model, ref.id)
      : `/worlds/${world.id}/${model}`
    : recordPath(world.id, model, id);
  const sourceName =
    typeof source.data?.body.name === 'string'
      ? source.data.body.name
      : ref?.id;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isNew
            ? `New ${humanize(model).toLowerCase()}`
            : `Edit ${String(value.name ?? humanize(model))}`}
        </h1>
        {isNew && ref && (
          <p className="text-sm text-muted-foreground">
            Linked to{' '}
            <Link className="underline underline-offset-4" to={back}>
              {sourceName}
            </Link>
            , which the page returns to once this is made.
          </p>
        )}
        {root.description && (
          <p className="text-sm text-muted-foreground">{root.description}</p>
        )}
      </header>
      <SchemaForm
        root={root}
        value={value}
        onChange={setValue}
        onSubmit={submit}
        submitting={saving}
        submitLabel={isNew ? 'Create' : 'Save'}
        error={error}
      >
        <Button variant="ghost" render={<Link to={back} />}>
          Cancel
        </Button>
      </SchemaForm>
    </div>
  );
}

/** `model/id`, as the query carries the record a new one is linked to. */
function parseRef(value: string | null): Reference | undefined {
  if (!value) return undefined;
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { model: value.slice(0, slash), id: value.slice(slash + 1) };
}
