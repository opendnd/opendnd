import { Link } from 'react-router';
import { ModelIcon } from './ModelIcon';
import type { ModelInfo } from '../api/types';
import { compactCount, useCounts } from '../app/counts';
import { useOntology } from '../app/ontology';
import { CATEGORIES, categoryOf, inGroup } from '../app/surfaces';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Models as cards, one section per category, in the order the categories are listed. */
export function ModelGroups(props: {
  readonly models: readonly ModelInfo[];
  readonly world: string;
}) {
  const ontology = useOntology();
  const counts = useCounts();
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
        .map(([key, unordered]) => {
          const models = inGroup(key, unordered);
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
                {counts.across(models) !== undefined && (
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {compactCount(counts.across(models)!)}
                  </span>
                )}
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
                              {counts.of !== undefined && (
                                <span className="ml-auto shrink-0 font-mono text-xs font-normal text-muted-foreground">
                                  {compactCount(counts.of[model.id] ?? 0)}
                                </span>
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
