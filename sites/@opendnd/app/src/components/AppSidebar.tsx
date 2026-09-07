import {
  BookOpenIcon,
  CompassIcon,
  DatabaseIcon,
  DoorOpenIcon,
  HistoryIcon,
  LogOutIcon,
  MapIcon,
  SearchIcon,
  SettingsIcon,
  StoreIcon,
  SwordsIcon,
  UsersIcon,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { placeIn } from './Layout';
import { useApp, useSession } from '../app/context';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { SURFACES, offers } from '../app/surfaces';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';

/**
 * Outside a world, the worlds a person may open. Inside one, the world is the
 * whole frame: its surfaces to play and read by, its data, its settings, and
 * one door back out. The models under Data come from the API, so a new model
 * appears here with no change; the surfaces above them are the shape a
 * person expects, named in one place.
 */
export function AppSidebar() {
  const session = useSession();
  const { signOut } = useApp();
  const me = useMe();
  const ontology = useOntology();
  const location = useLocation();
  const place = placeIn(location.pathname);
  const current = me.data?.worlds.find((w) => w.id === place.world);
  const [filter, setFilter] = useState('');

  const inWorld = place.world !== undefined && current !== undefined;
  const to = (segment: string) => `/worlds/${place.world}/${segment}`;
  const active = (segment: string) =>
    location.pathname === to(segment) ||
    location.pathname.startsWith(`${to(segment)}/`) ||
    location.pathname.startsWith(`${to(segment)}?`);
  const models = ontology.models.filter(
    (m) =>
      filter.trim() === '' ||
      m.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={
                <Link to={inWorld ? `/worlds/${place.world}` : '/worlds'} />
              }
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
                <CompassIcon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-display text-[15px] leading-5">
                  {inWorld ? current.name : 'OpenDnD'}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {inWorld
                    ? `OpenDnD · ${current.role ?? 'visitor'}`
                    : 'Worlds'}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        {!inWorld && (
          <SidebarGroup>
            <SidebarGroupLabel>Your worlds</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {me.loading && !me.data && (
                  <>
                    <SidebarMenuSkeleton />
                    <SidebarMenuSkeleton />
                  </>
                )}
                {me.data?.worlds.map((world) => (
                  <SidebarMenuItem key={world.id}>
                    <SidebarMenuButton
                      render={<Link to={`/worlds/${world.id}`} />}
                    >
                      {world.name}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {me.data && me.data.worlds.length === 0 && (
                  <p className="px-2 text-xs text-muted-foreground">
                    No worlds yet.
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {inWorld && (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SearchBox world={place.world!} />
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Play</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {offers(ontology, SURFACES.campaigns) && (
                    <Entry
                      to={to(SURFACES.campaigns.path)}
                      active={active(SURFACES.campaigns.path)}
                      label={SURFACES.campaigns.label}
                      icon={<SwordsIcon />}
                    />
                  )}
                  {offers(ontology, SURFACES.characters) && (
                    <Entry
                      to={to(SURFACES.characters.path)}
                      active={active(SURFACES.characters.path)}
                      label={SURFACES.characters.label}
                      icon={<UsersIcon />}
                    />
                  )}
                  <Entry
                    to={to(SURFACES.map.path)}
                    active={active(SURFACES.map.path)}
                    label={SURFACES.map.label}
                    icon={<MapIcon />}
                  />
                  <Entry
                    to={to(SURFACES.timeline.path)}
                    active={active(SURFACES.timeline.path)}
                    label={SURFACES.timeline.label}
                    icon={<HistoryIcon />}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>World</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {offers(ontology, SURFACES.compendium) && (
                    <Entry
                      to={to(SURFACES.compendium.path)}
                      active={
                        active(SURFACES.compendium.path) || active('search')
                      }
                      label={SURFACES.compendium.label}
                      icon={<BookOpenIcon />}
                    />
                  )}
                  <Entry
                    to={to(SURFACES.marketplace.path)}
                    active={active(SURFACES.marketplace.path)}
                    label={SURFACES.marketplace.label}
                    icon={<StoreIcon />}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel className="flex items-center gap-2">
                <DatabaseIcon className="size-3.5" />
                <Link to={to(SURFACES.data.path)} className="hover:underline">
                  Data
                </Link>
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col gap-1">
                <div className="relative px-2 pb-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <SidebarInput
                    type="search"
                    className="h-8 pl-8 text-xs"
                    placeholder="Filter kinds"
                    aria-label="Filter kinds of record"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <SidebarMenu>
                  {models.map((model) => (
                    <SidebarMenuItem key={model.id}>
                      <SidebarMenuButton
                        className="text-[13px]"
                        isActive={model.id === place.model}
                        render={<Link to={to(model.id)} />}
                      >
                        <span className="truncate">{model.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  {models.length === 0 && (
                    <p className="px-2 text-xs text-muted-foreground">
                      Nothing is called that.
                    </p>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {current.role === 'owner' && (
              <SidebarGroup>
                <SidebarGroupLabel>Manage</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <Entry
                      to={to(SURFACES.settings.path)}
                      active={active(SURFACES.settings.path)}
                      label={SURFACES.settings.label}
                      icon={<SettingsIcon />}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {inWorld && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Leave this world"
                render={<Link to="/worlds" />}
              >
                <DoorOpenIcon />
                <span className="truncate">Leave {current.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} tooltip="Sign out">
              <LogOutIcon />
              <span className="truncate">
                {session?.name ?? session?.subject ?? 'Sign out'}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function Entry(props: {
  readonly to: string;
  readonly active: boolean;
  readonly label: string;
  readonly icon: React.ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        render={<Link to={props.to} />}
      >
        {props.icon}
        <span>{props.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SearchBox(props: { readonly world: string }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q) {
      void navigate(
        `/worlds/${props.world}/compendium?q=${encodeURIComponent(q)}`,
      );
    }
  };
  return (
    <form onSubmit={submit} role="search" className="relative px-2">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
      <SidebarInput
        type="search"
        className="pl-8"
        placeholder="Search this world"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search this world"
      />
      <Button type="submit" className="sr-only">
        Search
      </Button>
    </form>
  );
}
