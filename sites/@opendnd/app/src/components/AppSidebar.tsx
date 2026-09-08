import {
  BookMarkedIcon,
  BookOpenIcon,
  ChevronRightIcon,
  CompassIcon,
  DoorOpenIcon,
  HistoryIcon,
  LayoutGridIcon,
  LogOutIcon,
  MapIcon,
  SearchIcon,
  SettingsIcon,
  StoreIcon,
  SwordsIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { placeIn } from './Layout';
import { ModelIcon, categoryIcon } from './ModelIcon';
import type { ModelInfo } from '../api/types';
import { useApp, useSession } from '../app/context';
import { compactCount, useCounts } from '../app/counts';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { CATEGORIES, SURFACES, categoryOf, offers } from '../app/surfaces';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';

/**
 * Outside a world, the worlds a person may open. Inside one, the world is the
 * whole frame: its surfaces to play and read by, its data by group, its
 * settings, and one door back out. The models under Data come from the API,
 * grouped as their manifests say and shown with the icons they name; the
 * surfaces above them are the shape a person expects, named in one place.
 */
export function AppSidebar() {
  const session = useSession();
  const { signOut } = useApp();
  const me = useMe();
  const ontology = useOntology();
  const counts = useCounts();
  const location = useLocation();
  const place = placeIn(location.pathname);
  const current = me.data?.worlds.find((w) => w.id === place.world);
  const [filter, setFilter] = useState('');
  // One group of models open at a time keeps the list short enough to take in.
  const [openGroup, setOpenGroup] = useState<string>();

  const inWorld = place.world !== undefined && current !== undefined;
  const to = (segment: string) => `/worlds/${place.world}/${segment}`;
  const active = (segment: string) =>
    location.pathname === to(segment) ||
    location.pathname.startsWith(`${to(segment)}/`);
  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const shown = ontology.models.filter(
      (m) => needle === '' || m.name.toLowerCase().includes(needle),
    );
    const groups = new Map<string, ModelInfo[]>();
    for (const model of shown) {
      const key = categoryOf(model).key;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    const order = [...CATEGORIES.map((c) => c.key), 'other'];
    return [...groups.entries()].sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
    );
  }, [ontology, filter]);

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

      <SidebarContent className="gap-0">
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
            <Section label="Play" storageKey="play">
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
            </Section>

            <Section label="World" storageKey="world">
              {offers(ontology, SURFACES.compendium) && (
                <Entry
                  to={to(SURFACES.compendium.path)}
                  active={active(SURFACES.compendium.path) || active('search')}
                  label={SURFACES.compendium.label}
                  icon={<BookOpenIcon />}
                />
              )}
              <Entry
                to={to(SURFACES.rules.path)}
                active={active(SURFACES.rules.path)}
                label={SURFACES.rules.label}
                icon={<BookMarkedIcon />}
              />
              <Entry
                to={to(SURFACES.marketplace.path)}
                active={active(SURFACES.marketplace.path)}
                label={SURFACES.marketplace.label}
                icon={<StoreIcon />}
              />
            </Section>

            <Section label="Data" storageKey="data" defaultOpen={false}>
              <Entry
                to={to(SURFACES.data.path)}
                active={location.pathname === to(SURFACES.data.path)}
                label="Overview"
                icon={<LayoutGridIcon />}
              />
              <div className="relative px-2 py-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  type="search"
                  className="h-7 pl-8 text-xs"
                  placeholder="Filter resources"
                  aria-label="Filter resources"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              {grouped.map(([key, models]) => {
                const category = CATEGORIES.find((c) => c.key === key);
                const Icon = categoryIcon(key);
                return (
                  <Collapsible
                    key={key}
                    open={filter.trim() !== '' || openGroup === key}
                    onOpenChange={(open) =>
                      setOpenGroup(open ? key : undefined)
                    }
                    className="group/category"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger
                        render={<SidebarMenuButton className="text-[13px]" />}
                      >
                        <Icon />
                        <span className="truncate">
                          {category?.label ?? 'Other'}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {(() => {
                            const held = counts.across(models);
                            return held === undefined
                              ? models.length
                              : compactCount(held);
                          })()}
                        </span>
                        <ChevronRightIcon className="transition-transform group-data-[open]/category:rotate-90" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mr-0 gap-0 pr-0">
                          {models.map((model) => (
                            <SidebarMenuSubItem key={model.id}>
                              <SidebarMenuSubButton
                                size="sm"
                                isActive={model.id === place.model}
                                render={<Link to={to(model.id)} />}
                              >
                                <ModelIcon
                                  model={model}
                                  className="size-3.5 text-muted-foreground"
                                />
                                <span className="truncate">{model.name}</span>
                                {counts.of?.[model.id] !== undefined && (
                                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {compactCount(counts.of[model.id]!)}
                                  </span>
                                )}
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
              {grouped.length === 0 && (
                <p className="px-2 text-xs text-muted-foreground">
                  Nothing is called that.
                </p>
              )}
            </Section>

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

/**
 * A group of the sidebar that folds when its heading is pressed anywhere,
 * and remembers whether it was folded.
 */
function Section(props: {
  readonly label: string;
  readonly storageKey: string;
  readonly defaultOpen?: boolean;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) {
  const key = `opendnd.sidebar.${props.storageKey}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? props.defaultOpen !== false : stored === 'open';
    } catch {
      return props.defaultOpen !== false;
    }
  });
  const change = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(key, next ? 'open' : 'closed');
    } catch {
      // A browser that keeps nothing still folds for the session.
    }
  };
  return (
    <Collapsible open={open} onOpenChange={change} className="group/section">
      <SidebarGroup className="py-1">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-colors hover:text-sidebar-foreground focus-visible:ring-2"
            />
          }
        >
          {props.icon}
          <span>{props.label}</span>
          <ChevronRightIcon className="ml-auto size-3.5 transition-transform group-data-[open]/section:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent className="flex flex-col gap-1">
            <SidebarMenu>{props.children}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function Entry(props: {
  readonly to: string;
  readonly active: boolean;
  readonly label: string;
  readonly icon: ReactNode;
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
