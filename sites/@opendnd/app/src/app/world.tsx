import { type ReactNode, createContext, useContext } from 'react';
import type { World } from '../api/types';

export interface WorldScope {
  readonly world: World;
  /** Whether the signed-in user may write to this world. */
  readonly canEdit: boolean;
}

const WorldContext = createContext<WorldScope | undefined>(undefined);

export function WorldProvider(props: {
  readonly world: World;
  readonly children: ReactNode;
}) {
  const role = props.world.role;
  const scope: WorldScope = {
    world: props.world,
    canEdit: role === 'owner' || role === 'editor',
  };
  return (
    <WorldContext.Provider value={scope}>
      {props.children}
    </WorldContext.Provider>
  );
}

export function useWorld(): WorldScope {
  const scope = useContext(WorldContext);
  if (!scope) throw new Error('useWorld needs a WorldProvider');
  return scope;
}

/** The address of a resource's page. */
export function recordPath(world: string, model: string, id: string): string {
  return `/worlds/${world}/${model}/${id}`;
}
