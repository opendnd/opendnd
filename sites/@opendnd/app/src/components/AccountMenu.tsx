import { DoorOpenIcon, LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useApp, useSession } from '../app/context';
import { humanize } from '../schema/fields';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';

/**
 * Who is signed in, and everything that is about them rather than about the
 * world.
 *
 * It sits at the foot of the sidebar because that is where a person looks
 * for it, and because the alternative — a row reading "Leave <world>" above
 * a row reading somebody's name — put two unrelated things next to each
 * other and made the more drastic one easier to hit.
 */
export function AccountMenu(props: {
  readonly world?: string;
  readonly role?: string;
}) {
  const session = useSession();
  const { signOut } = useApp();
  const name = session?.name ?? session?.subject ?? 'Signed in';
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton size="lg" tooltip={name}>
            <Avatar size="sm">
              <AvatarFallback className="bg-brand-muted text-[11px] font-semibold text-brand-muted-foreground">
                {initials || <UserIcon className="size-3.5" />}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{name}</span>
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent align="start" side="right" className="w-60">
        {/*
          A label is a group's label: Base UI reads it from the group above
          it and throws without one. Radix did not need the group, which is
          how this got written without it.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium">{name}</span>
            {session?.email && (
              <span className="block truncate text-xs text-muted-foreground">
                {session.email}
              </span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {props.role && (
          <>
            <DropdownMenuSeparator />
            {/*
              What this person may do here. It used to sit under the world's
              name in the top left, where it read as part of the world rather
              than as a fact about the reader — and where nobody needs it.
              Studio keeps the tenant and workspace in this menu for the same
              reason: it is context, not chrome.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {humanize(props.role)} of this world
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
        {props.world && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/worlds" />}>
              <DoorOpenIcon />
              Switch world
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<Link to={`/worlds/${props.world}/settings`} />}
            >
              <SettingsIcon />
              World settings
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
