import { PlusIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { SURFACES, offers } from '../app/surfaces';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Thumb } from '../components/Thumb';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** The characters played in this world, as cards. */
export function Characters() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const surface = SURFACES.characters;
  const page = useRequest(
    () =>
      offers(ontology, surface)
        ? api.list(world.id, surface.model, { limit: 200, sort: 'name' })
        : Promise.resolve(undefined),
    [api, world.id, ontology],
  );
  if (!offers(ontology, surface)) {
    return <Notice tone="warning" title="This ontology has no characters" />;
  }
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl">{surface.label}</h1>
          <p className="text-sm text-muted-foreground">{surface.description}</p>
        </div>
        {canEdit && (
          <Button
            className="ml-auto"
            render={<Link to={`/worlds/${world.id}/${surface.model}/new`} />}
          >
            <PlusIcon data-icon="inline-start" />
            New character
          </Button>
        )}
      </header>
      {page.error && <ErrorNotice error={page.error} onRetry={page.reload} />}
      {page.loading && !page.data && <Loading />}
      {page.data && page.data.resources.length === 0 && (
        <Notice title="No characters yet">
          A character is a person of the world as played: it points at the
          person and at the campaign, and carries the sheet.
        </Notice>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
        {page.data?.resources.map((c) => {
          const person = c.person as
            { model: string; id: string; name?: string } | undefined;
          const campaign = c.campaign as
            { model: string; id: string; name?: string } | undefined;
          return (
            <Link
              key={c.id}
              to={recordPath(world.id, surface.model, c.id)}
              className="flex gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-ring"
            >
              <Thumb resource={{ ...c, name: c.name ?? person?.name }} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate font-display text-base leading-tight">
                    {c.name ?? person?.name ?? c.id}
                  </span>
                  {typeof c.level === 'number' && (
                    <Badge variant="secondary" className="ml-auto shrink-0">
                      Level {c.level}
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[
                    person && `Plays ${person.name ?? 'someone'}`,
                    campaign && `in ${campaign.name ?? 'a campaign'}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  {typeof c.status === 'string' && ` · ${humanize(c.status)}`}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
