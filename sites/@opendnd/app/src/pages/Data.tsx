import { Link } from 'react-router';
import type { ModelInfo } from '../api/types';
import { useOntology } from '../app/ontology';
import { CATEGORIES, categoryOf } from '../app/surfaces';
import { useWorld } from '../app/world';
import { ModelIcon } from '../components/ModelIcon';
import { Transfer } from '../components/Transfer';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Every kind of record the API serves, by group, as tables; and the world's export and import. */
export function Data() {
  const ontology = useOntology();
  const { world } = useWorld();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Data</h1>
        <p className="text-sm text-muted-foreground">
          Everything in {world.name} is one of these kinds of record, as the API
          describes them and grouped as the ontology places them. Most of the
          time the surfaces above do this work; this is the way in when you want
          the tables themselves.
        </p>
      </header>
      <ModelGroups models={ontology.models} world={world.id} />
      <Transfer />
    </div>
  );
}

/** Models as cards, one section per category, in the order the categories are listed. */
export function ModelGroups(props: {
  readonly models: readonly ModelInfo[];
  readonly world: string;
}) {
  const ontology = useOntology();
  const groups = new Map<string, ModelInfo[]>();
  for (const model of props.models) {
    const key = categoryOf(model).key;
    groups.set(key, [...(groups.get(key) ?? []), model]);
  }
  const order = [...CATEGORIES.map((c) => c.key), 'other'];
  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()]
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([key, models]) => {
          const category = CATEGORIES.find((c) => c.key === key);
          return (
            <section key={key} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="font-display text-xl">
                  {category?.label ?? 'Other'}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {category?.description}
                </span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {models.map((model) => {
                  const description =
                    model.description ?? ontology.schema(model.id)?.description;
                  return (
                    <li key={model.id}>
                      <Link
                        to={`/worlds/${props.world}/${model.id}`}
                        className="block h-full"
                      >
                        <Card
                          size="sm"
                          className="h-full transition-colors hover:border-ring"
                        >
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <ModelIcon
                                model={model}
                                className="size-4 text-muted-foreground"
                              />
                              {model.name}
                              {model.generate && (
                                <Badge variant="outline">generates</Badge>
                              )}
                            </CardTitle>
                            {description && (
                              <CardDescription className="line-clamp-3">
                                {description}
                              </CardDescription>
                            )}
                          </CardHeader>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
