import { Link, Outlet, useParams } from 'react-router';
import { useMe } from '../app/me';
import { WorldProvider } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Button } from '@/components/ui/button';

/** Finds the world in the address among the caller's, and scopes everything beneath to it. */
export function WorldLayout() {
  const { world: worldId = '' } = useParams();
  const me = useMe();

  if (me.error) return <ErrorNotice error={me.error} onRetry={me.reload} />;
  if (!me.data) return <Loading />;
  const world = me.data.worlds.find((w) => w.id === worldId);
  if (!world) {
    return (
      <Notice
        tone="warning"
        title="Not one of your worlds"
        action={
          <Button variant="outline" size="xs" render={<Link to="/worlds" />}>
            Your worlds
          </Button>
        }
      >
        This world is not shared with you, or it has been put away.
      </Notice>
    );
  }

  return (
    <WorldProvider world={world}>
      <Outlet />
    </WorldProvider>
  );
}
