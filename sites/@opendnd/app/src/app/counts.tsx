import { type ReactNode, createContext, useContext } from 'react';
import { useApi } from './context';
import { useRequest } from './hooks';

/**
 * How many records of each kind the world in the address holds.
 *
 * Asked once for the whole world rather than a page per model, because the
 * navigation draws a number beside every model and the pages beneath draw the
 * same numbers again. A model the world holds nothing of is absent rather
 * than zero, so a world can be read without knowing every model that exists.
 */
export interface Counts {
  readonly of: Record<string, number> | undefined;
  /** Records held across the given models, or undefined until the world has answered. */
  readonly across: (models: readonly { id: string }[]) => number | undefined;
  reload(): void;
}

const CountsContext = createContext<Counts>({
  of: undefined,
  across: () => undefined,
  reload: () => undefined,
});

export function CountsProvider(props: {
  /** The world to count, or none outside a world. */
  readonly world: string | undefined;
  readonly children: ReactNode;
}) {
  const api = useApi();
  const { world } = props;
  const request = useRequest(
    () => (world ? api.counts(world) : Promise.resolve(undefined)),
    [api, world],
  );
  const of = request.data;
  const value: Counts = {
    of,
    across: (models) =>
      of ? models.reduce((sum, m) => sum + (of[m.id] ?? 0), 0) : undefined,
    reload: request.reload,
  };
  return (
    <CountsContext.Provider value={value}>
      {props.children}
    </CountsContext.Provider>
  );
}

export function useCounts(): Counts {
  return useContext(CountsContext);
}

/** A count as a navigation shows it: 1.2k rather than 1243, 12k rather than 12400. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const thousands = n / 1000;
  return `${thousands.toFixed(thousands < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
}
