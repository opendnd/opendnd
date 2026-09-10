import {
  BracesIcon,
  CopyIcon,
  ExternalLinkIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router';
import { JsonTree } from './JsonTree';
import { placeIn } from './Layout';
import { Markdown } from './Markdown';
import { ErrorNotice, Loading } from './Notice';
import type { Answer } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { type PanelTab, usePanel } from '../app/panel';
import { recordPath } from '../app/world';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * The panel that rides along on the right of every page, in two tabs: a
 * place to ask the world questions, answered from its records, and the
 * record in front of the reader as the API holds it. The inspector follows
 * the address, or a record chosen on the page, a row of a table say.
 */
export function RightPanel(props: { readonly onClose: () => void }) {
  const panel = usePanel();
  const location = useLocation();
  const place = placeIn(location.pathname);
  const me = useMe();
  const world = me.data?.worlds.find((w) => w.id === place.world);
  const inspected =
    panel.inspected ??
    (place.world && place.model && place.id
      ? { world: place.world, model: place.model, id: place.id }
      : undefined);
  return (
    <aside
      className="flex h-full w-96 shrink-0 flex-col border-l bg-background"
      aria-label="Ask and inspect"
    >
      <Tabs
        value={panel.tab}
        onValueChange={(value) => panel.show(value as PanelTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
          <TabsList>
            <TabsTrigger value="ask">
              <SparklesIcon className="text-brand" />
              Ask
            </TabsTrigger>
            <TabsTrigger value="inspect">
              <BracesIcon />
              Inspect
            </TabsTrigger>
          </TabsList>
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
        <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
          {world ? (
            <Ask world={world.id} worldName={world.name} />
          ) : (
            <Idle text="Open a world to ask about it." />
          )}
        </TabsContent>
        <TabsContent value="inspect" className="flex min-h-0 flex-1 flex-col">
          {inspected ? (
            <Inspector {...inspected} chosen={panel.inspected !== undefined} />
          ) : (
            <Idle
              text={
                place.world
                  ? 'Open a record, or choose a row of a table, to see it as the API holds it.'
                  : 'Open a world, then a record, to inspect it.'
              }
            />
          )}
        </TabsContent>
      </Tabs>
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
  const panel = usePanel();
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

  const put = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
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
    },
    [api, model, props.world],
  );

  // A question put from the page beneath, from the home screen say, arrives
  // here rather than being answered somewhere the conversation cannot be seen.
  // It waits for the catalogue, because a question sent before the deployment
  // has said what it holds is a question sent with no model. The moment it was
  // asked is remembered rather than trusting the clearing to land first: this
  // effect runs again whenever anything around it changes.
  const asked = panel.pending;
  const consumed = useRef(0);
  useEffect(() => {
    if (!asked || asked.at === consumed.current) return;
    if (busy || catalogue.loading) return;
    consumed.current = asked.at;
    panel.taken();
    void put(asked.question);
  }, [asked, busy, catalogue.loading, panel, put]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void put(question);
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
                        key={`${s.type}/${s.id}`}
                        to={recordPath(props.world, s.type.toLowerCase(), s.id)}
                      >
                        <Badge variant="outline">{s.display ?? s.id}</Badge>
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
  /** Whether this is a record chosen on the page rather than the page's own. */
  readonly chosen: boolean;
}) {
  const api = useApi();
  const ontology = useOntology();
  const record = useRequest(
    () => api.get(props.world, props.model, props.id),
    [api, props.world, props.model, props.id],
  );
  const json = record.data ? JSON.stringify(record.data.body, null, 2) : '';
  const name = record.data?.body.name;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{ontology.label(props.model)}</Badge>
        {typeof name === 'string' && (
          <span className="min-w-0 truncate font-medium">{name}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {props.chosen && (
            <Button
              variant="ghost"
              size="xs"
              render={
                <Link to={recordPath(props.world, props.model, props.id)} />
              }
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Open
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            disabled={!json}
            onClick={() => void navigator.clipboard?.writeText(json)}
          >
            <CopyIcon data-icon="inline-start" />
            Copy
          </Button>
        </span>
      </div>
      <code
        className="truncate font-mono text-[11px] text-muted-foreground"
        title={record.data?.etag ? `ETag ${record.data.etag}` : undefined}
      >
        /v1/worlds/{props.world}/{props.model}/{props.id}
      </code>
      {record.error && (
        <ErrorNotice error={record.error} onRetry={record.reload} />
      )}
      {record.loading && !record.data && <Loading />}
      {record.data && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed">
          <JsonTree value={record.data.body} />
        </div>
      )}
    </div>
  );
}
