import { type ReactNode, createContext, useContext } from 'react';
import { useApi } from './context';
import { type Request, useRequest } from './hooks';
import type { Me } from '../api/types';

const MeContext = createContext<Request<Me> | undefined>(undefined);

/** Who is signed in and which worlds they may open, fetched once and shared. */
export function MeProvider(props: { readonly children: ReactNode }) {
  const api = useApi();
  const me = useRequest(() => api.me(), [api]);
  return <MeContext.Provider value={me}>{props.children}</MeContext.Provider>;
}

export function useMe(): Request<Me> {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe needs a MeProvider');
  return me;
}
