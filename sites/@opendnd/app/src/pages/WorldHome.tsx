import { SettingsIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useOntology } from '../app/ontology';
import { useWorld } from '../app/world';
import { Transfer } from '../components/Transfer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Every model the API serves, as the doors into a world. */
export function WorldHome() {
  const ontology = useOntology();
  const { world, isOwner } = useWorld();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {world.name}
          </h1>
          <Badge variant="secondary">{world.role ?? 'visitor'}</Badge>
          <Badge variant="outline">{world.visibility}</Badge>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              render={<Link to={`/worlds/${world.id}/settings`} />}
            >
              <SettingsIcon data-icon="inline-start" />
              Settings
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Everything in this world is one of these. Open one to browse or add to
          it.
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
