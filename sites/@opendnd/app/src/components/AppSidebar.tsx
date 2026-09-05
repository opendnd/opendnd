import { GlobeIcon, LogOutIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { placeIn } from './Layout';
import { useApp, useSession } from '../app/context';
import { useMe } from '../app/me';
import { useOntology } from '../app/ontology';
import { humanize } from '../schema/fields';
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
 * The worlds a person may open, and inside one, its models. Both lists come
 * from the API: a new world or a new model appears here with no change.
 */
export function AppSidebar() {
  const session = useSession();
  const { signOut } = useApp();
  const me = useMe();
  const ontology = useOntology();
  const location = useLocation();
  const place = placeIn(location.pathname);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/worlds" />}>
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <GlobeIcon className="size-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">OpenDnD</span>
                <span className="text-xs text-muted-foreground">Worlds</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
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
                    isActive={world.id === place.world}
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

        {place.world && (
          <SidebarGroup>
            <SidebarGroupLabel>This world</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-2">
              <SearchBox world={place.world} />
              <SidebarMenu>
                {ontology.models.map((model) => (
                  <SidebarMenuItem key={model.id}>
                    <SidebarMenuButton
                      isActive={model.id === place.model}
                      render={
                        <Link to={`/worlds/${place.world}/${model.id}`} />
                      }
                    >
                      {humanize(model.id)}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
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

function SearchBox(props: { readonly world: string }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q) {
      void navigate(`/worlds/${props.world}/search?q=${encodeURIComponent(q)}`);
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
    </form>
  );
}
