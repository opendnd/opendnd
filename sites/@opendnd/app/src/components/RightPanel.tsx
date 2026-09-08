import {
  BracesIcon,
  CopyIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { placeIn } from './Layout';
import { Markdown } from './Markdown';
import { ErrorNotice, Loading } from './Notice';
import type { Answer } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { recordPath } from '../app/world';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PanelKind = 'ask' | 'inspect';

/**
 * The panel that rides along on the right of every page: a place to ask the
 * world questions, answered from its records, and the record on the page as
 * the API holds it. Both follow the address, so they always concern what is
 * in front of the reader.
 */
export function RightPanel(props: {
  readonly kind: PanelKind;
  readonly onClose: () => void;
}) {
  const location = useLocation();
  const place = placeIn(location.pathname);
  const me = useMe();
  const world = me.data?.worlds.find((w) => w.id === place.world);
  return (
    <aside
      className="flex w-96 shrink-0 flex-col border-l bg-background"
      aria-label={props.kind === 'ask' ? 'Ask the world' : 'Inspector'}
    >
      <div className="flex h-12 items-center gap-2 border-b px-3">
        {props.kind === 'ask' ? (
          <SparklesIcon className="size-4 text-brand" />
        ) : (
          <BracesIcon className="size-4 text-muted-foreground" />
        )}
        <span className="font-display text-[15px]">
          {props.kind === 'ask' ? 'Ask the world' : 'Inspector'}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close panel"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {props.kind === 'ask' ? (
          world ? (
            <Ask world={world.id} worldName={world.name} />
          ) : (
            <Idle text="Open a world to ask about it." />
          )
        ) : place.world && place.model && place.id ? (
          <Inspector world={place.world} model={place.model} id={place.id} />
        ) : (
          <Idle
            text={
              place.world
                ? 'Open a record to see it as the API holds it.'
                : 'Open a world, then a record, to inspect it.'
            }
          />
        )}
      </div>
    </aside>
  );
}

function Idle(props: { readonly text: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{props.text}</p>;
}

interface Turn {
  readonly role: 'you' | 'world';
  readonly text: string;
  readonly sources?: Answer['sources'];
}

function Ask(props: { readonly world: string; readonly worldName: string }) {
  const api = useApi();
  const key = `opendnd.ask.${props.world}`;
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored ? (JSON.parse(stored) as Turn[]) : [];
    } catch {
      return [];
    }
  });
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const end = useRef<HTMLDivElement>(null);
  // The deployment says which models it actually holds; the task's own is
  // first choice, then whatever is there, so a world with a local model and
  // no configuration still answers.
  const catalogue = useRequest(() => api.llm(), [api]);
  const [chosenModel, setChosenModel] = useState<string>();
  const models = catalogue.data?.models ?? [];
  const model = chosenModel ?? catalogue.data?.task.model ?? models[0]?.id;

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(turns.slice(-20)));
    } catch {
      // Nothing kept between visits, then.
    }
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setError(undefined);
    setTurns((t) => [...t, { role: 'you', text: q }]);
    setBusy(true);
    try {
      const answer = await api.ask(props.world, q, model);
      setTurns((t) => [
        ...t,
        { role: 'world', text: answer.answer, sources: answer.sources },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        {turns.length === 0 && (
          <p className="text-muted-foreground">
            Ask anything about {props.worldName}. The answer comes from what is
            on record, and says which records it drew on.
          </p>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              turn.role === 'you'
                ? 'ml-6 rounded-lg bg-muted px-3 py-2'
                : 'mr-2'
            }
          >
            {turn.role === 'you' ? (
              <p>{turn.text}</p>
            ) : (
              <>
                <Markdown text={turn.text} className="prose-record text-sm" />
                {turn.sources && turn.sources.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {turn.sources.map((s) => (
                      <Link
                        key={`${s.model}/${s.id}`}
                        to={recordPath(props.world, s.model, s.id)}
                      >
                        <Badge variant="outline">{s.name ?? s.id}</Badge>
                      </Link>
                    ))}
                  </p>
                )}
              </>
            )}
          </div>
        ))}
        {busy && <Loading label="Reading the records…" />}
        {error && <ErrorNotice error={error} />}
        <div ref={end} />
      </div>
      {models.length > 1 && (
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <label htmlFor="ask-model">Answered by</label>
          <select
            id="ask-model"
            className="rounded border bg-background px-1 py-0.5 font-mono text-xs"
            value={model ?? ''}
            onChange={(e) => setChosenModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <Input
          aria-label="Your question"
          placeholder={`Ask ${props.worldName}…`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Ask"
          disabled={busy || question.trim() === ''}
        >
          <SendIcon />
        </Button>
      </form>
    </>
  );
}

function Inspector(props: {
  readonly world: string;
  readonly model: string;
  readonly id: string;
}) {
  const api = useApi();
  const ontology = useOntology();
  const record = useRequest(
    () => api.get(props.world, props.model, props.id),
    [api, props.world, props.model, props.id],
  );
  const json = record.data ? JSON.stringify(record.data.body, null, 2) : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{ontology.label(props.model)}</Badge>
        {record.data?.etag && (
          <span className="font-mono text-xs text-muted-foreground">
            ETag {record.data.etag}
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!json}
          onClick={() => void navigator.clipboard?.writeText(json)}
        >
          <CopyIcon data-icon="inline-start" />
          Copy
        </Button>
      </div>
      <code className="truncate font-mono text-[11px] text-muted-foreground">
        /v1/worlds/{props.world}/{props.model}/{props.id}
      </code>
      {record.error && (
        <ErrorNotice error={record.error} onRetry={record.reload} />
      )}
      {record.loading && !record.data && <Loading />}
      {json && (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
          {json}
        </pre>
      )}
    </div>
  );
}
