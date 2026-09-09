import { type ReactNode, createContext, useContext, useMemo } from 'react';
import {
  type Project,
  layoutFor,
  projectOf,
  recordLayoutFor,
} from './project';
import type { PageLayout } from './Page';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';

/**
 * The projects a world has built.
 *
 * Asked once for the world rather than once per page, because every page has
 * to know whether the world has replaced it, and most worlds have replaced
 * nothing. Until the answer arrives a page draws what the application ships,
 * which is the right guess and means no page waits on this to appear.
 */
export interface Projects {
  readonly all: readonly Project[];
  readonly loading: boolean;
  /** The layout to draw for a path: the world's own, or the built-in one. */
  layoutFor(path: string): PageLayout;
  /** The layout for a record of this model, when there is one. */
  recordLayoutFor(model: string): PageLayout | undefined;
  reload(): void;
}

const Context = createContext<Projects>({
  all: [],
  loading: false,
  layoutFor: (path) => layoutFor(path, []).layout,
  recordLayoutFor: (model) => recordLayoutFor(model, []),
  reload: () => undefined,
});

export function ProjectsProvider(props: {
  readonly world: string | undefined;
  readonly children: ReactNode;
}) {
  const api = useApi();
  const { world } = props;
  const request = useRequest(
    () =>
      world
        ? api.list(world, 'project', { limit: 100, sort: 'name' })
        : Promise.resolve(undefined),
    [api, world],
  );
  const all = useMemo(
    () => (request.data?.resources ?? []).map(projectOf),
    [request.data],
  );
  const value = useMemo<Projects>(
    () => ({
      all,
      loading: request.loading,
      layoutFor: (path) => layoutFor(path, all).layout,
      recordLayoutFor: (model) => recordLayoutFor(model, all),
      reload: request.reload,
    }),
    [all, request.loading, request.reload],
  );
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export function useProjects(): Projects {
  return useContext(Context);
}

/** The layout for a built-in path, replaced by the world's own if it has one. */
export function usePageLayout(path: string): PageLayout {
  return useProjects().layoutFor(path);
}
