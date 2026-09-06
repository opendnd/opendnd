import { FilesIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { Resource } from '../api/types';
import { useApi } from '../app/context';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE = 50;

interface Listing {
  readonly items: Resource[];
  readonly next?: string;
  readonly loading: boolean;
  readonly error?: Error;
}

/** Every resource of one model in a world, a page at a time. */
export function Records() {
  const api = useApi();
  const ontology = useOntology();
  const { world, canEdit } = useWorld();
  const { model = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const name = params.get('name') ?? '';
  const [listing, setListing] = useState<Listing>({ items: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    setListing({ items: [], loading: true });
    api
      .list(world.id, model, { name: name || undefined, limit: PAGE })
      .then((page) => {
        if (cancelled) return;
        setListing({ items: page.resources, next: page.next, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setListing({
          items: [],
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, world.id, model, name]);

  const more = async () => {
    if (!listing.next) return;
    setListing((l) => ({ ...l, loading: true }));
    try {
      const page = await api.list(world.id, model, {
        name: name || undefined,
        limit: PAGE,
        cursor: listing.next,
      });
      setListing((l) => ({
        items: [...l.items, ...page.resources],
        next: page.next,
        loading: false,
      }));
    } catch (error) {
      setListing((l) => ({
        ...l,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    }
  };

  if (!ontology.model(model)) {
    return (
      <Notice
        tone="warning"
        title={`There is no model called ${model}`}
        action={
          <Button
            variant="outline"
            size="xs"
            render={<Link to={`/worlds/${world.id}`} />}
          >
            The world
          </Button>
        }
      />
    );
  }

  const label = ontology.label(model);
  const newPath = `/worlds/${world.id}/${model}/new`;
  const generatePath = `/worlds/${world.id}/${model}/generate`;
  const generator = ontology.model(model)?.generate;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
        <Input
          type="search"
          className="w-56"
          placeholder="Filter by name"
          value={name}
          onChange={(e) =>
            setParams(e.target.value ? { name: e.target.value } : {}, {
              replace: true,
            })
          }
          aria-label="Filter by name"
        />
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            {generator && (
              <Button variant="outline" render={<Link to={generatePath} />}>
                <SparklesIcon data-icon="inline-start" />
                Generate
              </Button>
            )}
            <Button render={<Link to={newPath} />}>
              <PlusIcon data-icon="inline-start" />
              New {label.toLowerCase()}
            </Button>
          </div>
        )}
      </div>

      {listing.error && <ErrorNotice error={listing.error} />}

      {!listing.loading && listing.items.length === 0 && !listing.error && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilesIcon />
            </EmptyMedia>
            <EmptyTitle>
              {name
                ? `Nothing named like “${name}”`
                : `No ${label.toLowerCase()} yet`}
            </EmptyTitle>
            <EmptyDescription>
              {name
                ? 'Clear the filter to see everything.'
                : canEdit
                  ? 'Add the first one, or generate some.'
                  : 'Nothing has been added here.'}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit && !name && (
            <EmptyContent>
              <Button variant="outline" render={<Link to={newPath} />}>
                <PlusIcon data-icon="inline-start" />
                New {label.toLowerCase()}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      {listing.items.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.items.map((resource) => (
                <TableRow key={resource.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      to={recordPath(world.id, model, resource.id)}
                    >
                      {resource.name ?? resource.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {typeof resource.canonStatus === 'string' && (
                      <Badge variant="outline">
                        {humanize(resource.canonStatus)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {resource.recorded?.updatedAt &&
                      new Date(
                        resource.recorded.updatedAt,
                      ).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {listing.loading && <Loading />}
      {listing.next && !listing.loading && (
        <Button variant="outline" className="self-start" onClick={more}>
          Load more
        </Button>
      )}
    </div>
  );
}
