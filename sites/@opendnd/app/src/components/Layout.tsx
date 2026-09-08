import { SearchIcon, SparklesIcon } from 'lucide-react';
import { type FormEvent, Fragment, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AppSidebar } from './AppSidebar';
import { RightPanel } from './RightPanel';
import { useSession } from '../app/context';
import { useMediaQuery } from '../app/hooks';
import { MeProvider, useMe } from '../app/me';
import { OntologyProvider, useOntology } from '../app/ontology';
import { PanelProvider, usePanel } from '../app/panel';
import { SURFACES, SURFACE_SEGMENTS, surfaceLabel } from '../app/surfaces';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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

/** The frame around every signed-in page: a sidebar, a header, the page, and the panel on the right. */
export function Shell() {
  return (
    <MeProvider>
      <OntologyProvider>
        <PanelProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <Header />
              <Body />
            </SidebarInset>
          </SidebarProvider>
        </PanelProvider>
      </OntologyProvider>
    </MeProvider>
  );
}

/** Stays put while the page scrolls: the way back, a search of the world, and the panel's switch. */
function Header() {
  const panel = usePanel();
  const location = useLocation();
  const place = placeIn(location.pathname);
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Crumbs />
      {place.world && <WorldSearch world={place.world} />}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant={panel.open ? 'secondary' : 'ghost'}
          size="icon"
          aria-label="Ask and inspect"
          aria-pressed={panel.open}
          onClick={() => panel.setOpen(!panel.open)}
        >
          <SparklesIcon className="text-brand" />
        </Button>
      </div>
    </header>
  );
}

/**
 * The page, with the panel beside it on a wide window and over it on a
 * narrow one, so it is never out of reach.
 */
function Body() {
  const panel = usePanel();
  const wide = useMediaQuery('(min-width: 1024px)');
  const close = () => panel.setOpen(false);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 p-6">
        <Outlet />
      </div>
      {panel.open && wide && (
        <div className="sticky top-12 h-[calc(100vh-3rem)]">
          <RightPanel onClose={close} />
        </div>
      )}
      {!wide && (
        <Sheet open={panel.open} onOpenChange={(open) => !open && close()}>
          <SheetContent
            side="right"
            className="w-96 gap-0 p-0 sm:max-w-96 [&>button]:hidden"
          >
            <SheetTitle className="sr-only">Ask and inspect</SheetTitle>
            <RightPanel onClose={close} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** One search across the world, from anywhere in it. */
function WorldSearch(props: { readonly world: string }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q) {
      void navigate(
        `/worlds/${props.world}/${SURFACES.compendium.path}?q=${encodeURIComponent(q)}`,
      );
      setQuery('');
    }
  };
  return (
    <form
      onSubmit={submit}
      role="search"
      className="relative ml-2 hidden w-64 md:block lg:w-80"
    >
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className="h-8 bg-muted/50 pl-8 text-sm"
        placeholder="Search this world"
        aria-label="Search this world"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </form>
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
