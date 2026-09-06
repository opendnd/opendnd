import { FeatherIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AuthorResult, LlmCatalogue, Spend } from '../api/types';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';

/**
 * Ask a language model to write about a record.
 *
 * The form comes from the request as the API describes it, with one change:
 * the model is offered as a choice among what the deployment can actually
 * serve, rather than typed. A draft is read before it is kept, because a
 * model will not say the same thing twice; keeping imports the very text
 * that was read, and writing again is another call and another bill.
 */
export function Author() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const { model = '', id = '' } = useParams();
  const navigate = useNavigate();

  const info = ontology.model(model);
  const authoring = info?.author;
  const catalogue = useRequest(() => api.llm(), [api]);
  const root = useMemo<Field | undefined>(() => {
    if (!authoring) return undefined;
    const described = describe(authoring.input, ontology, { name: model });
    return {
      ...described,
      fields: described.fields
        // Whether to keep a draft is decided after reading it.
        ?.filter((f) => f.name !== 'save')
        .map((f) => (f.name === 'model' ? asChoice(f, catalogue.data) : f)),
    };
  }, [authoring, ontology, model, catalogue.data]);

  const subject = useRequest(
    () => api.get(world.id, model, id),
    [api, world.id, model, id],
  );

  const [value, setValue] = useState<Record<string, unknown> | undefined>(() =>
    root ? (initialValue(root) as Record<string, unknown>) : undefined,
  );
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<Error>();
  const [draft, setDraft] = useState<AuthorResult>();
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<Error>();

  useEffect(() => {
    // The form is rebuilt when the model list arrives; what was typed stays.
    setValue((current) =>
      root
        ? { ...(initialValue(root) as Record<string, unknown>), ...current }
        : undefined,
    );
  }, [root]);

  const write = async () => {
    if (!value) return;
    setWriting(true);
    setError(undefined);
    setKeepError(undefined);
    try {
      setDraft(await api.author(world.id, model, id, prune(value) ?? {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setWriting(false);
    }
  };

  const keep = async () => {
    if (!draft) return;
    setKeeping(true);
    setKeepError(undefined);
    try {
      await api.importResources(world.id, [draft.work]);
      void navigate(recordPath(world.id, 'work', draft.work.id));
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
  if (!authoring || !root) {
    return (
      <Notice
        tone="warning"
        title={`Nothing writes about a ${info.name.toLowerCase()} yet`}
      />
    );
  }
  if (!canEdit) {
    return (
      <Notice
        tone="warning"
        title="Only an editor or owner may ask for writing"
      >
        A model call spends the world's money, so it is a write to the world.
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
          Write about {name}
        </h1>
        <p className="text-sm text-muted-foreground">{authoring.description}</p>
        {catalogue.error && (
          <Notice tone="warning" title="The list of models could not be read">
            {catalogue.error.message} A model can still be named by id.
          </Notice>
        )}
      </header>

      {value && (
        <SchemaForm
          root={root}
          value={value}
          onChange={setValue}
          onSubmit={() => void write()}
          submitting={writing}
          submitLabel={draft ? 'Write again' : 'Write'}
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

      {writing && <Loading label="Waiting for the model…" />}

      {draft && (
        <Draft
          draft={draft}
          keeping={keeping}
          error={keepError}
          onKeep={() => void keep()}
          onDiscard={() => setDraft(undefined)}
        />
      )}
    </div>
  );
}

/** The model field as a choice among what the deployment holds. */
function asChoice(field: Field, catalogue: LlmCatalogue | undefined): Field {
  if (!catalogue) return field;
  const configured = catalogue.task.model;
  return {
    ...field,
    kind: 'select',
    required: false,
    description: configured
      ? `Left as is, the ${catalogue.task.name} task's model, ${configured}, writes.`
      : 'Left as is, the deployment’s default model writes, if it has one.',
    options: catalogue.models.map((m) => ({
      value: m.id,
      label: `${m.id} · ${m.provider}${m.local ? ' · local' : ''}`,
    })),
  };
}

function Draft(props: {
  readonly draft: AuthorResult;
  readonly keeping: boolean;
  readonly error?: Error;
  onKeep(): void;
  onDiscard(): void;
}) {
  const { work, facts, spend } = props.draft;
  const text = typeof work.text === 'string' ? work.text : '';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FeatherIcon className="size-4" />
          {work.name ?? 'Untitled'}
          {typeof work.workType === 'string' && (
            <Badge variant="outline">{work.workType}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          A draft. Nothing is saved until it is kept.
          {spend && (
            <>
              {' '}
              <SpendLine spend={spend} />
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-prose flex-col gap-3 leading-relaxed">
          {text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-lg"
              />
            }
          >
            What the model was given: {facts.length} facts
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <ul className="list-disc pl-5 text-sm">
              {facts.map((fact, index) => (
                <li key={index}>{fact}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
        {props.error && <ErrorNotice error={props.error} />}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={props.onKeep} disabled={props.keeping}>
          {props.keeping && <Spinner data-icon="inline-start" />}
          {props.keeping ? 'Keeping…' : 'Keep this'}
        </Button>
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

function SpendLine(props: { readonly spend: Spend }) {
  const { spend } = props;
  const money =
    spend.costMicros === 0
      ? spend.cached
        ? 'from the cache, nothing'
        : 'a local model, nothing'
      : `$${(spend.chargeMicros / 1_000_000).toFixed(4)}`;
  return (
    <span>
      Written by {spend.model} via {spend.provider}: {spend.inputTokens} tokens
      in, {spend.outputTokens} out, costing {money}.
    </span>
  );
}
