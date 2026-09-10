import { BookOpenIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { SearchHit } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { SURFACES, offers } from '../app/surfaces';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading } from '../components/Notice';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
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
import { Page } from '../build/Page';
import { usePageLayout } from '../build/projects';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item';

/**
 * The world as it is read: one search across everything on record, and the
 * written works, articles, chronicles and tales, to browse when nothing is
 * being searched for.
 */
export function CompendiumSurface() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const [draft, setDraft] = useState(q);
  const surface = SURFACES.compendium;
  const hasWorks = offers(ontology, surface);

  const results = useRequest(
    () => (q ? api.search(world.id, q, 100) : Promise.resolve([])),
    [api, world.id, q],
  );
  const works = useRequest(
    () =>
      hasWorks && !q
        ? api.list(world.id, surface.model, { limit: 50, sort: 'name' })
        : Promise.resolve(undefined),
    [api, world.id, hasWorks, q],
  );

  const groups = new Map<string, SearchHit[]>();
  for (const hit of results.data ?? []) {
    groups.set(hit.model, [...(groups.get(hit.model) ?? []), hit]);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    setParams(next ? { q: next } : {});
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl">{surface.label}</h1>
            <p className="text-sm text-muted-foreground">
              {surface.description}
            </p>
          </div>
          {canEdit && hasWorks && (
            <Button
              variant="outline"
              className="ml-auto"
              render={<Link to={`/worlds/${world.id}/${surface.model}/new`} />}
            >
              <PlusIcon data-icon="inline-start" />
              New entry
            </Button>
          )}
        </div>
        <form onSubmit={submit} role="search" className="flex max-w-xl gap-2">
          <Input
            type="search"
            aria-label="Search this world"
            placeholder="Search everything on record by name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="outline">
            <SearchIcon data-icon="inline-start" />
            Search
          </Button>
        </form>
      </header>

      {q && (
        <>
          <h2 className="font-display text-xl">Results for “{q}”</h2>
          {results.error && (
            <ErrorNotice error={results.error} onRetry={results.reload} />
          )}
          {results.loading && <Loading label="Searching…" />}
          {results.data && results.data.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing is called that</EmptyTitle>
                <EmptyDescription>
                  Search matches names. Try part of a name, or a different
                  spelling.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {[...groups.entries()].map(([model, hits]) => (
            <section key={model} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {ontology.label(model)}
              </h3>
              <ItemGroup className="gap-1">
                {hits.map((hit) => (
                  <Item
                    key={hit.id}
                    size="sm"
                    variant="outline"
                    render={
                      <Link to={recordPath(world.id, hit.model, hit.id)} />
                    }
                  >
                    <ItemContent>
                      <ItemTitle>{hit.name}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline">
                        {humanize(hit.canonStatus)}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          ))}
        </>
      )}

      {!q && hasWorks && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">Entries</h2>
          {works.error && (
            <ErrorNotice error={works.error} onRetry={works.reload} />
          )}
          {works.loading && !works.data && <Loading />}
          {works.data && works.data.resources.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing written yet</EmptyTitle>
                <EmptyDescription>
                  Articles, chronicles and tales appear here, whether written by
                  hand or asked of a language model from a record's page.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <ItemGroup className="gap-1">
            {works.data?.resources.map((work) => {
              const about =
                (work.about as { name?: string }[] | undefined) ?? [];
              return (
                <Item
                  key={work.id}
                  size="sm"
                  variant="outline"
                  render={
                    <Link to={recordPath(world.id, surface.model, work.id)} />
                  }
                >
                  <ItemContent>
                    <ItemTitle>{work.name ?? work.id}</ItemTitle>
                    {about.length > 0 && (
                      <ItemDescription>
                        About{' '}
                        {about
                          .slice(0, 4)
                          .map((a) => a.name)
                          .filter(Boolean)
                          .join(', ')}
                        {about.length > 4 && ` and ${about.length - 4} more`}
                      </ItemDescription>
                    )}
                  </ItemContent>
                  <ItemActions>
                    {typeof work.type === 'string' && (
                      <Badge variant="outline">{humanize(work.type)}</Badge>
                    )}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
          {works.data?.next && (
            <p className="text-xs text-muted-foreground">
              Showing the first {works.data.resources.length}; the full list is
              under Data.
            </p>
          )}
        </section>
      )}

      {!q && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">Browse by kind</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ontology.models.map((model) => (
              <li key={model.id}>
                <Link
                  to={`/worlds/${world.id}/${model.id}`}
                  className="block h-full"
                >
                  <Card
                    size="sm"
                    className="h-full transition-colors hover:border-ring"
                  >
                    <CardHeader>
                      <CardTitle className="text-sm">{model.name}</CardTitle>
                      {(model.description ??
                        ontology.schema(model.id)?.description) && (
                        <CardDescription className="line-clamp-2 text-xs">
                          {model.description ??
                            ontology.schema(model.id)?.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The compendium page: one block, on the grid like everything else. */
export function Compendium() {
  return <Page page={usePageLayout('compendium')} />;
}
