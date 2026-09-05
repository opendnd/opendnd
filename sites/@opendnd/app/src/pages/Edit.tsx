import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { SchemaForm } from '../components/Form';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { describe, humanize } from '../schema/fields';
import { editable, initialValue, prune } from '../schema/value';
import { Button } from '@/components/ui/button';

/** Creates a resource, or edits one, through a form built from its schema. */
export function Edit() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const { model = '', id } = useParams();
  const navigate = useNavigate();
  const isNew = id === undefined;

  const schema = ontology.schema(model, 'input');
  const root = useMemo(
    () => (schema ? describe(schema, ontology, { name: model }) : undefined),
    [schema, ontology, model],
  );

  const existing = useRequest(
    () => (isNew ? Promise.resolve(undefined) : api.get(world.id, model, id)),
    [api, world.id, model, id, isNew],
  );

  const [value, setValue] = useState<Record<string, unknown>>();
  const [etag, setEtag] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!root) return;
    if (isNew) {
      setValue(initialValue(root) as Record<string, unknown>);
    } else if (existing.data) {
      setValue(editable(existing.data.body, root));
      setEtag(existing.data.etag);
    }
  }, [root, isNew, existing.data]);

  const submit = async () => {
    if (!value) return;
    setSaving(true);
    setError(undefined);
    try {
      const body = prune(value) ?? {};
      const stored = isNew
        ? await api.create(world.id, model, body)
        : await api.put(world.id, model, id, body, etag);
      void navigate(recordPath(world.id, model, stored.body.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setSaving(false);
    }
  };

  if (!root) {
    return (
      <Notice tone="warning" title={`There is no model called ${model}`} />
    );
  }
  if (existing.error) {
    return <ErrorNotice error={existing.error} onRetry={existing.reload} />;
  }
  if (!value) return <Loading />;

  const back = isNew
    ? `/worlds/${world.id}/${model}`
    : recordPath(world.id, model, id);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isNew
            ? `New ${humanize(model).toLowerCase()}`
            : `Edit ${String(value.name ?? humanize(model))}`}
        </h1>
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
