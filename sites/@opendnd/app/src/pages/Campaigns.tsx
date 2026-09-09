import { PlusIcon } from 'lucide-react';
import { Link } from 'react-router';
import { CampaignCard } from '../components/CampaignCard';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { SURFACES, offers } from '../app/surfaces';
import { useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Page } from '../build/Page';
import { usePageLayout } from '../build/projects';
import { Button } from '@/components/ui/button';

/** Every campaign in this world, as cards. A block, placed by a page. */
export function CampaignList() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const surface = SURFACES.campaigns;
  const page = useRequest(
    () =>
      offers(ontology, surface)
        ? api.list(world.id, surface.model, { limit: 100, sort: 'name' })
        : Promise.resolve(undefined),
    [api, world.id, ontology],
  );
  if (!offers(ontology, surface)) {
    return <Notice tone="warning" title="This ontology has no campaigns" />;
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
            New campaign
          </Button>
        )}
      </header>
      {page.error && <ErrorNotice error={page.error} onRetry={page.reload} />}
      {page.loading && !page.data && <Loading />}
      {page.data && page.data.resources.length === 0 && (
        <Notice title="No campaigns yet">
          A campaign gathers sessions, characters, quests and encounters. Start
          one and the world's history starts to be played.
        </Notice>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
        {page.data?.resources.map((c) => (
          <CampaignCard key={c.id} campaign={c} model={surface.model} />
        ))}
      </div>
    </div>
  );
}

/** The campaigns page: one block, on the grid like everything else. */
export function Campaigns() {
  return <Page page={usePageLayout('campaigns')} />;
}
