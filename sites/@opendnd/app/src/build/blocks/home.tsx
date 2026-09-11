import { ArrowRightIcon, CompassIcon, SendIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { CampaignCard } from '../../components/CampaignCard';
import { useApi, useSession } from '../../app/context';
import { compactCount, useCounts } from '../../app/counts';
import { useRequest } from '../../app/hooks';
import { useOntology } from '../../app/ontology';
import { usePanel } from '../../app/panel';
import { SURFACES, offers } from '../../app/surfaces';
import { recordPath, useWorld } from '../../app/world';
import { ErrorNotice } from '../../components/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

/**
 * The blocks a world's front page is made of.
 *
 * They were one page; they are four blocks so that a world can arrange its
 * own front page, and so that any of them can be put on any other page.
 */

/** How a suggestion is worded for each kind of record it is drawn from. */
const ASKS: Record<string, (name: string) => string> = {
  character: (name) => `Who is ${name}?`,
  place: (name) => `Tell me about ${name}.`,
  faction: (name) => `What does ${name} want?`,
  event: (name) => `What happened at ${name}?`,
};

/** How many suggestions the greeting offers before it stops. */
const SUGGESTIONS = 4;

/** The world asked in plain words, answered in the panel beside the page. */
export function AskBlock() {
  const api = useApi();
  const ontology = useOntology();
  const session = useSession();
  const panel = usePanel();
  const { world } = useWorld();
  const [draft, setDraft] = useState('');

  // Suggestions are drawn from the world rather than written here, so they
  // name things that actually exist and read differently in every world.
  const suggestions = useRequest(async () => {
    const kinds = ['character', 'place', 'faction', 'event'].filter((m) =>
      ontology.model(m),
    );
    const pages = await Promise.all(
      kinds.map((m) => api.list(world.id, m, { limit: 1, sort: 'updatedAt' })),
    );
    const asked: string[] = [];
    kinds.forEach((kind, i) => {
      const name = pages[i]?.resources[0]?.name;
      if (typeof name === 'string' && name !== '') {
        asked.push(ASKS[kind]!(name));
      }
    });
    return asked.slice(0, SUGGESTIONS);
  }, [api, world.id, ontology]);

  const put = (text: string) => {
    const question = text.trim();
    if (question === '') return;
    setDraft('');
    panel.ask(question);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    put(draft);
  };

  const who = session?.name ?? session?.subject ?? 'there';
  return (
    <div className="flex flex-col items-center gap-3 pt-[min(8vh,3rem)] text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-muted text-brand-muted-foreground">
        <CompassIcon className="size-5" />
      </span>
      <h1 className="font-display text-3xl leading-tight sm:text-4xl">
        {greeting()}, {who}. What would you like to know about {world.name}?
      </h1>
      <p className="max-w-lg text-sm text-muted-foreground">
        Ask in plain words. The answer comes from what is on record and says
        which records it drew on.
      </p>

      <form
        onSubmit={submit}
        className="mt-4 w-full max-w-2xl rounded-2xl border bg-card text-left shadow-sm transition-colors focus-within:border-ring"
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              put(draft);
            }
          }}
          aria-label={`Ask ${world.name} a question`}
          placeholder={`Ask ${world.name} anything…`}
          rows={3}
          className="min-h-0 resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-[15px] shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" />
            Grounded in {world.name}&apos;s records
          </span>
          <Button type="submit" size="sm" disabled={draft.trim() === ''}>
            <SendIcon />
            Ask
          </Button>
        </div>
      </form>

      {suggestions.data && suggestions.data.length > 0 && (
        <div className="flex max-w-2xl flex-wrap justify-center gap-2">
          {suggestions.data.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => put(question)}
              title={question}
              className="max-w-xs truncate rounded-full border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** How much the world holds, each number a way in. */
export function CountsBlock() {
  const ontology = useOntology();
  const counts = useCounts();
  const { world } = useWorld();
  const surfaces = [
    SURFACES.campaigns,
    SURFACES.characters,
    SURFACES.compendium,
  ].filter((s) => offers(ontology, s));
  const all = counts.across(ontology.models);
  return (
    <div className="grid h-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {surfaces.map((s) => (
        <Link key={s.path} to={`/worlds/${world.id}/${s.path}`} className="block">
          <Card size="sm" className="h-full transition-colors hover:border-ring">
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="font-display text-3xl">
                {counts.of ? compactCount(counts.of[s.model!] ?? 0) : '…'}
              </CardTitle>
            </CardHeader>
          </Card>
        </Link>
      ))}
      <Link to={`/worlds/${world.id}/${SURFACES.data.path}`} className="block">
        <Card size="sm" className="h-full transition-colors hover:border-ring">
          <CardHeader>
            <CardDescription>Records in all</CardDescription>
            <CardTitle className="font-display text-3xl">
              {all === undefined ? '…' : compactCount(all)}
            </CardTitle>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}

/** The campaigns most recently played, as cards. */
export function CampaignsBlock(props: {
  readonly options?: { readonly limit?: number };
}) {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const limit = props.options?.limit ?? 6;
  const campaigns = useRequest(
    () =>
      offers(ontology, SURFACES.campaigns)
        ? api.list(world.id, SURFACES.campaigns.model, {
            limit,
            sort: 'updatedAt',
          })
        : Promise.resolve(undefined),
    [api, world.id, ontology, limit],
  );
  if (!offers(ontology, SURFACES.campaigns)) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl">Your campaigns</h2>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          render={
            <Link to={`/worlds/${world.id}/${SURFACES.campaigns.path}`} />
          }
        >
          All campaigns
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
      {campaigns.error && <ErrorNotice error={campaigns.error} />}
      {campaigns.data && campaigns.data.resources.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No campaigns yet. Start one from the campaigns page.
        </p>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
        {campaigns.data?.resources.map((c) => (
          <CampaignCard
            key={c.id}
            campaign={c}
            model={SURFACES.campaigns.model}
          />
        ))}
      </div>
    </section>
  );
}

/** What was written last, across the surfaces this world offers. */
export function RecentBlock(props: {
  readonly options?: { readonly limit?: number };
}) {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const most = props.options?.limit ?? 8;
  const surfaces = [
    SURFACES.campaigns,
    SURFACES.characters,
    SURFACES.compendium,
  ].filter((s) => offers(ontology, s));
  const recent = useRequest(async () => {
    const models = surfaces.map((s) => s.model!);
    const pages = await Promise.all(
      models.map((m) => api.list(world.id, m, { limit: 5, sort: 'updatedAt' })),
    );
    return models
      .flatMap((model, i) =>
        pages[i]!.resources.map((resource) => ({ model, resource })),
      )
      .sort((a, b) =>
        String(b.resource.meta?.lastUpdated ?? '').localeCompare(
          String(a.resource.meta?.lastUpdated ?? ''),
        ),
      )
      .slice(0, most);
  }, [api, world.id, surfaces.map((s) => s.path).join(','), most]);

  return (
    <section className="flex h-full flex-col gap-3">
      <h2 className="font-display text-xl">Recently changed</h2>
      {recent.error && <ErrorNotice error={recent.error} />}
      <ul className="divide-y overflow-y-auto rounded-lg border">
        {recent.data?.map(({ model, resource }) => (
          <li
            key={`${model}/${resource.id}`}
            className="flex items-center gap-3 px-3 py-2 text-sm"
          >
            <Badge variant="outline">{ontology.label(model)}</Badge>
            <Link
              className="underline-offset-4 hover:underline"
              to={recordPath(world.id, model, resource.id)}
            >
              {resource.name ?? resource.id}
            </Link>
            <span className="ml-auto text-xs text-muted-foreground">
              {resource.meta?.lastUpdated &&
                new Date(resource.meta.lastUpdated).toLocaleDateString()}
            </span>
          </li>
        ))}
        {recent.data && recent.data.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            Nothing yet.
          </li>
        )}
      </ul>
    </section>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
