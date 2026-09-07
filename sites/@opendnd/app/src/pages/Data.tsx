import { Link } from 'react-router';
import { useOntology } from '../app/ontology';
import { useWorld } from '../app/world';
import { Transfer } from '../components/Transfer';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Every kind of record the API serves, as tables, with the world's export and import. */
export function Data() {
  const ontology = useOntology();
  const { world } = useWorld();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Data</h1>
        <p className="text-sm text-muted-foreground">
          Everything in {world.name} is one of these kinds of record, as the API
          describes them. Open one to browse it as a table, add to it, or
          generate more.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ontology.models.map((model) => {
          const description =
            model.description ?? ontology.schema(model.id)?.description;
          return (
            <li key={model.id}>
              <Link
                to={`/worlds/${world.id}/${model.id}`}
                className="block h-full"
              >
                <Card className="h-full transition-colors hover:border-ring">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
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
      <Transfer />
    </div>
  );
}
