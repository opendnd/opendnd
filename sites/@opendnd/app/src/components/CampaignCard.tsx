import { Link } from 'react-router';
import { Thumb } from './Thumb';
import type { Reference, Resource } from '../api/types';
import { recordPath, useWorld } from '../app/world';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';

/** A campaign as a card: its picture, its name and state, and a line about it. */
export function CampaignCard(props: {
  readonly campaign: Resource;
  readonly model: string;
}) {
  const { world } = useWorld();
  const c = props.campaign;
  const setting = c.setting as Reference | undefined;
  return (
    <Link
      to={recordPath(world.id, props.model, c.id)}
      className="flex h-full gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-ring"
    >
      <Thumb resource={c} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-display text-base leading-tight">
            {c.name ?? c.id}
          </span>
          {typeof c.status === 'string' && (
            <Badge variant="secondary" className="ml-auto shrink-0">
              {humanize(c.status)}
            </Badge>
          )}
        </span>
        {typeof c.description === 'string' && c.description !== '' && (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {c.description}
          </span>
        )}
        {setting && (
          <span className="text-xs text-muted-foreground">
            Set in {setting.display ?? 'a place'}
          </span>
        )}
      </span>
    </Link>
  );
}
