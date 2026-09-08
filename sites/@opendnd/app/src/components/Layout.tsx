import { BracesIcon, SparklesIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AppSidebar } from './AppSidebar';
import { type PanelKind, RightPanel } from './RightPanel';
import { useSession } from '../app/context';
import { MeProvider, useMe } from '../app/me';
import { OntologyProvider, useOntology } from '../app/ontology';
import { SURFACE_SEGMENTS, surfaceLabel } from '../app/surfaces';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

/** Sends a visitor to sign in, remembering where they were going. */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  if (!session) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?returnTo=${returnTo}`} replace />;
  }
  return <Outlet />;
}

/** The frame around every signed-in page: a sidebar, a breadcrumb, the page. */
export function Shell() {
  const [panel, setPanel] = useState<PanelKind | undefined>(() => {
    try {
      const stored = localStorage.getItem('opendnd.panel');
      return stored === 'ask' || stored === 'inspect' ? stored : undefined;
    } catch {
      return undefined;
    }
  });
  const toggle = (kind: PanelKind) => {
    const next = panel === kind ? undefined : kind;
    setPanel(next);
    try {
      if (next) localStorage.setItem('opendnd.panel', next);
      else localStorage.removeItem('opendnd.panel');
    } catch {
      // Then the panel is only remembered for this page.
    }
  };
  return (
    <MeProvider>
      <OntologyProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            {/* Stays put while the page scrolls, so the way back is always in reach. */}
            <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <SidebarTrigger className="-ml-1" />
              <Crumbs />
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant={panel === 'ask' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={panel === 'ask'}
                  onClick={() => toggle('ask')}
                >
                  <SparklesIcon
                    data-icon="inline-start"
                    className="text-brand"
                  />
                  Ask
                </Button>
                <Button
                  variant={panel === 'inspect' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={panel === 'inspect'}
                  onClick={() => toggle('inspect')}
                >
                  <BracesIcon data-icon="inline-start" />
                  Inspect
                </Button>
              </div>
            </header>
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1 p-6">
                <Outlet />
              </div>
              {panel && (
                <div className="sticky top-12 hidden h-[calc(100vh-3rem)] lg:block">
                  <RightPanel kind={panel} onClose={() => toggle(panel)} />
                </div>
              )}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </OntologyProvider>
    </MeProvider>
  );
}

/** Where in the world the page is, from the address. */
export function placeIn(pathname: string): {
  world?: string;
  model?: string;
  id?: string;
  surface?: string;
} {
  const match = /^\/worlds\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname);
  if (!match) return {};
  const [, world, model, id] = match;
  // A surface is a page of the world, not a model in it.
  const surface = model !== undefined && SURFACE_SEGMENTS.has(model);
  return {
    world,
    ...(model && !surface ? { model } : {}),
    ...(surface ? { surface: model } : {}),
    ...(id && id !== 'new' && !surface ? { id } : {}),
  };
}

function Crumbs() {
  const location = useLocation();
  const me = useMe();
  const ontology = useOntology();
  const place = placeIn(location.pathname);
  const world = me.data?.worlds.find((w) => w.id === place.world);
  const crumbs: { label: string; to?: string }[] = [
    { label: 'Worlds', to: '/worlds' },
  ];
  if (place.world) {
    crumbs.push({
      label: world?.name ?? 'World',
      to: `/worlds/${place.world}`,
    });
  }
  if (place.world && place.model) {
    crumbs.push({
      label: ontology.label(place.model),
      to: `/worlds/${place.world}/${place.model}`,
    });
  }
  if (place.world && place.surface) {
    const label = surfaceLabel(place.surface);
    if (label) {
      crumbs.push({ label, to: `/worlds/${place.world}/${place.surface}` });
    }
  }
  const last = crumbs.length - 1;
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.label + index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {index === last || !crumb.to ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink render={<Link to={crumb.to} />}>
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
