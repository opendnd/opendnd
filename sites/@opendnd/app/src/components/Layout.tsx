import { Fragment } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AppSidebar } from './AppSidebar';
import { useSession } from '../app/context';
import { MeProvider, useMe } from '../app/me';
import { OntologyProvider } from '../app/ontology';
import { humanize } from '../schema/fields';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
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
  return (
    <MeProvider>
      <OntologyProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
              <Crumbs />
            </header>
            <div className="flex-1 p-6">
              <Outlet />
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
} {
  const match = /^\/worlds\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname);
  if (!match) return {};
  const [, world, model, id] = match;
  return {
    world,
    ...(model && model !== 'search' ? { model } : {}),
    ...(id && id !== 'new' ? { id } : {}),
  };
}

function Crumbs() {
  const location = useLocation();
  const me = useMe();
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
      label: humanize(place.model),
      to: `/worlds/${place.world}/${place.model}`,
    });
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
