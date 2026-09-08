import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router';

export type PanelTab = 'ask' | 'inspect';

/** A record chosen to inspect, a row of a table say, instead of the page's own. */
export interface Inspected {
  readonly world: string;
  readonly model: string;
  readonly id: string;
}

export interface Panel {
  readonly open: boolean;
  readonly tab: PanelTab;
  readonly inspected?: Inspected;
  /** A question asked from a page, waiting for the Ask tab to pick it up. */
  readonly pending?: { readonly question: string; readonly at: number };
  readonly setOpen: (open: boolean) => void;
  /** Open the panel on one of its tabs. */
  readonly show: (tab: PanelTab) => void;
  /** Open the inspector on a record other than the page's own. */
  readonly inspect: (target: Inspected) => void;
  /** Put a question to the world from elsewhere on the page, and open on it. */
  readonly ask: (question: string) => void;
  /** Said by the Ask tab once it has taken the pending question. */
  readonly taken: () => void;
}

const KEY = 'opendnd.panel';

const PanelContext = createContext<Panel>({
  open: false,
  tab: 'ask',
  setOpen: () => undefined,
  show: () => undefined,
  inspect: () => undefined,
  ask: () => undefined,
  taken: () => undefined,
});

/**
 * The state of the panel that rides along on the right of every page:
 * whether it is open, which of its tabs is showing, and a record chosen to
 * inspect. Whether it is open, and on which tab, is remembered between
 * visits; a chosen record belongs to the page it was chosen on.
 */
export function PanelProvider(props: { readonly children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tab: PanelTab }>(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'ask' || stored === 'inspect') {
        return { open: true, tab: stored };
      }
    } catch {
      // A browser that keeps nothing starts closed.
    }
    return { open: false, tab: 'ask' };
  });
  const [inspected, setInspected] = useState<Inspected>();
  const [pending, setPending] = useState<{ question: string; at: number }>();
  const location = useLocation();

  useEffect(() => setInspected(undefined), [location.pathname]);
  useEffect(() => {
    try {
      if (state.open) localStorage.setItem(KEY, state.tab);
      else localStorage.removeItem(KEY);
    } catch {
      // Then the panel is only remembered for this page.
    }
  }, [state]);

  const value = useMemo<Panel>(
    () => ({
      ...state,
      inspected,
      pending,
      setOpen: (open) => setState((s) => ({ ...s, open })),
      show: (tab) => setState({ open: true, tab }),
      inspect: (target) => {
        setInspected(target);
        setState({ open: true, tab: 'inspect' });
      },
      // The same question twice running is still two questions, so the moment
      // it was asked is part of what the Ask tab watches.
      ask: (question) => {
        setPending({ question, at: Date.now() });
        setState({ open: true, tab: 'ask' });
      },
      taken: () => setPending(undefined),
    }),
    [state, inspected, pending],
  );
  return (
    <PanelContext.Provider value={value}>
      {props.children}
    </PanelContext.Provider>
  );
}

export function usePanel(): Panel {
  return useContext(PanelContext);
}
