import { ModelGroups } from './Data';
import { useOntology } from '../app/ontology';
import { SURFACES, categoryOf } from '../app/surfaces';
import { useWorld } from '../app/world';
import { Notice } from '../components/Notice';

/** The game's rules as this world has them: the models the ontology groups under rules. */
export function Rules() {
  const ontology = useOntology();
  const { world } = useWorld();
  const models = ontology.models.filter((m) => categoryOf(m).key === 'rules');
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl">{SURFACES.rules.label}</h1>
        <p className="text-sm text-muted-foreground">
          {SURFACES.rules.description}
        </p>
      </header>
      {models.length === 0 ? (
        <Notice title="No rules here">
          This ontology groups nothing under rules.
        </Notice>
      ) : (
        <ModelGroups models={models} world={world.id} />
      )}
    </div>
  );
}
