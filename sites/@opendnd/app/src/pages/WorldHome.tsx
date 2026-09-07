import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Resource } from '../api/types';
import { useApi, useSession } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { SURFACES, offers } from '../app/surfaces';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice } from '../components/Notice';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** How many of a kind the home page counts before it stops counting. */
const COUNT_TO = 500;

/**
 * Inside a world: a greeting, a search, the numbers, the campaigns, and what
 * changed last. The surfaces it shows are the ones the ontology can back.
 */
export function WorldHome() {
  const api = useApi();
  const ontology = useOntology();
  const session = useSession();
  const { world } = useWorld();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const surfaces = [
    SURFACES.campaigns,
    SURFACES.characters,
    SURFACES.compendium,
  ].filter((s) => offers(ontology, s));
  const counts = useRequest(
    async () =>
      Promise.all(
        surfaces.map(async (s) => {
          const page = await api.list(world.id, s.model!, { limit: COUNT_TO });
          return {
            surface: s,
            count: page.resources.length,
            more: page.next !== undefined,
          };
        }),
      ),
    [api, world.id, surfaces.map((s) => s.path).join(',')],
  );
  const campaigns = useRequest(
    () =>
      offers(ontology, SURFACES.campaigns)
        ? api.list(world.id, SURFACES.campaigns.model, {
            limit: 6,
            sort: 'updatedAt',
          })
        : Promise.resolve(undefined),
    [api, world.id, ontology],
  );
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
        String(b.resource.recorded?.updatedAt ?? '').localeCompare(
          String(a.resource.recorded?.updatedAt ?? ''),
        ),
      )
      .slice(0, 8);
  }, [api, world.id, surfaces.map((s) => s.path).join(',')]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    void navigate(
      q
        ? `/worlds/${world.id}/${SURFACES.compendium.path}?q=${encodeURIComponent(q)}`
        : `/worlds/${world.id}/${SURFACES.compendium.path}`,
    );
  };

  const who = session?.name ?? session?.subject ?? 'there';
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-col items-center gap-3 pt-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-muted text-brand-muted-foreground">
          <SearchIcon className="size-5" />
        </span>
        <h1 className="font-display text-4xl">
          {greeting()}, {who}. {world.name} is open.
        </h1>
        <p className="text-sm text-muted-foreground">
          Search it by name, or pick up where you left off.
        </p>
        <form
          onSubmit={search}
          role="search"
          className="mt-2 flex w-full max-w-xl gap-2"
        >
          <Input
            type="search"
            aria-label="Search this world"
            placeholder={`Search ${world.name}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {surfaces.map((s) => {
          const found = counts.data?.find((c) => c.surface.path === s.path);
          return (
            <Link
              key={s.path}
              to={`/worlds/${world.id}/${s.path}`}
              className="block"
            >
              <Card
                size="sm"
                className="h-full transition-colors hover:border-ring"
              >
                <CardHeader>
                  <CardDescription>{s.label}</CardDescription>
                  <CardTitle className="font-display text-3xl">
                    {found ? `${found.count}${found.more ? '+' : ''}` : '…'}
                  </CardTitle>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
        <Link
          to={`/worlds/${world.id}/${SURFACES.data.path}`}
          className="block"
        >
          <Card
            size="sm"
            className="h-full transition-colors hover:border-ring"
          >
            <CardHeader>
              <CardDescription>Kinds of record</CardDescription>
              <CardTitle className="font-display text-3xl">
                {ontology.models.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </Link>
      </section>
      {counts.error && <ErrorNotice error={counts.error} />}

      {offers(ontology, SURFACES.campaigns) && (
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.data?.resources.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                model={SURFACES.campaigns.model}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Recently changed</h2>
        {recent.error && <ErrorNotice error={recent.error} />}
        <ul className="divide-y rounded-lg border">
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
                {resource.recorded?.updatedAt &&
                  new Date(resource.recorded.updatedAt).toLocaleDateString()}
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
    </div>
  );
}

/** A campaign as a card, the way Studio shows a project. */
export function CampaignCard(props: {
  readonly campaign: Resource;
  readonly model: string;
}) {
  const { world } = useWorld();
  const c = props.campaign;
  const setting = c.setting as
    { model: string; id: string; name?: string } | undefined;
  return (
    <Link to={recordPath(world.id, props.model, c.id)} className="block h-full">
      <Card className="h-full transition-colors hover:border-ring">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="font-display text-lg">
              {c.name ?? c.id}
            </CardTitle>
            {typeof c.status === 'string' && (
              <Badge variant="secondary" className="ml-auto">
                {humanize(c.status)}
              </Badge>
            )}
          </div>
          {typeof c.description === 'string' && c.description !== '' && (
            <CardDescription className="line-clamp-3">
              {c.description}
            </CardDescription>
          )}
        </CardHeader>
        {setting && (
          <CardContent className="text-sm text-muted-foreground">
            Set in {setting.name ?? 'a place'}
          </CardContent>
        )}
      </Card>
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
