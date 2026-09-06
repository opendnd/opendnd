import { SearchIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { SearchHit } from '../api/types';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading } from '../components/Notice';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item';

/** One search box across every model, as the API offers it. */
export function Search() {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const results = useRequest(
    () => (q ? api.search(world.id, q, 100) : Promise.resolve([])),
    [api, world.id, q],
  );

  const groups = new Map<string, SearchHit[]>();
  for (const hit of results.data ?? []) {
    groups.set(hit.model, [...(groups.get(hit.model) ?? []), hit]);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {q ? `Results for “${q}”` : 'Search'}
      </h1>
      {results.error && (
        <ErrorNotice error={results.error} onRetry={results.reload} />
      )}
      {results.loading && <Loading label="Searching…" />}
      {results.data && results.data.length === 0 && q && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing is called that</EmptyTitle>
            <EmptyDescription>
              Search matches names. Try part of a name, or a different spelling.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {[...groups.entries()].map(([model, hits]) => (
        <section key={model} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ontology.label(model)}
          </h2>
          <ItemGroup className="gap-1">
            {hits.map((hit) => (
              <Item
                key={hit.id}
                size="sm"
                variant="outline"
                render={<Link to={recordPath(world.id, hit.model, hit.id)} />}
              >
                <ItemContent>
                  <ItemTitle>{hit.name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Badge variant="outline">{humanize(hit.canonStatus)}</Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>
      ))}
    </div>
  );
}
