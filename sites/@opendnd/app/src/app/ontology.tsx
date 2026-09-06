import { type ReactNode, createContext, useContext } from 'react';
import { useApi } from './context';
import { useRequest } from './hooks';
import { Notice } from '../components/Notice';
import { type Ontology, loadOntology } from '../schema/openapi';

const OntologyContext = createContext<Ontology | undefined>(undefined);

/**
 * Loads what the API says about itself once per session and hands it to
 * every page beneath. Nothing renders until it is known, because every page
 * is built from it. Given an ontology outright, as a test does, it provides
 * that and loads nothing.
 */
export function OntologyProvider(props: {
  readonly children: ReactNode;
  readonly ontology?: Ontology;
}) {
  if (props.ontology) {
    return (
      <OntologyContext.Provider value={props.ontology}>
        {props.children}
      </OntologyContext.Provider>
    );
  }
  return <LoadedOntology>{props.children}</LoadedOntology>;
}

function LoadedOntology(props: { readonly children: ReactNode }) {
  const api = useApi();
  const request = useRequest(() => loadOntology(api), [api]);
  if (request.error) {
    return (
      <Notice tone="error" title="The API could not be read">
        {request.error.message}
        <button className="ml-3 underline" onClick={request.reload}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!request.data) return <Notice title="Reading the ontology…" />;
  return (
    <OntologyContext.Provider value={request.data}>
      {props.children}
    </OntologyContext.Provider>
  );
}

export function useOntology(): Ontology {
  const ontology = useContext(OntologyContext);
  if (!ontology) throw new Error('useOntology needs an OntologyProvider');
  return ontology;
}
