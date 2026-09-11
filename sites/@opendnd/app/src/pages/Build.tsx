import { CopyIcon, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../app/context';
import { useWorld } from '../app/world';
import {
  BUNDLED,
  FLOOR,
  blankProject,
  builtIn,
  copyOf,
} from '../build/project';
import { useProjects } from '../build/projects';
import { ErrorNotice, Loading, Notice } from '../components/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

/**
 * What this world's application is made of.
 *
 * Two lists, and the second is the point of the first: the pages the
 * application ships with, each of which can be copied and changed, and the
 * pages this world has made its own. A copy answers to the same address, so
 * customizing the front page replaces the front page rather than adding a
 * second one nobody visits.
 */
export function Build() {
  const api = useApi();
  const navigate = useNavigate();
  const { world, canEdit } = useWorld();
  const projects = useProjects();
  const shipped = builtIn();
  const pageOf = (path: string) =>
    shipped.pages.find((one) => one.path === path);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Only a published page actually stands in front of the built-in one; a
  // draft is a page nobody but its author has seen.
  const replaced = new Set(
    projects.all
      .filter((project) => project.status === 'published')
      .flatMap((project) => project.pages.map((page) => page.path)),
  );

  const create = async () => {
    setBusy('new');
    setError(undefined);
    try {
      const made = await api.create(
        world.id,
        'project',
        blankProject(world.name),
      );
      projects.reload();
      void navigate(`/worlds/${world.id}/build/${made.body.id}/page-1`);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(undefined);
    }
  };

  const customize = async (path: string) => {
    const page = shipped.pages.find((one) => one.path === path);
    if (!page) return;
    setBusy(path);
    setError(undefined);
    try {
      const made = await api.create(
        world.id,
        'project',
        copyOf(page, world.name),
      );
      projects.reload();
      void navigate(`/worlds/${world.id}/build/${made.body.id}/${page.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl">Build</h1>
        <p className="text-sm text-muted-foreground">
          A project is an application this world builds for itself: pages of
          blocks on a grid. Copy a page and this world gets a project holding
          it; publish that and it is what everybody sees.
        </p>
      </header>

      {error && <ErrorNotice error={error} />}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl">This world&apos;s projects</h2>
          <Button
            className="ml-auto"
            size="sm"
            disabled={busy !== undefined}
            onClick={() => void create()}
          >
            <PlusIcon />
            New project
          </Button>
        </div>
        {projects.loading && projects.all.length === 0 && <Loading />}
        {!projects.loading && projects.all.length === 0 && (
          <Notice title="Nothing built yet">
            Start an empty one, or copy a page the application already ships and
            make it this world&apos;s own.
          </Notice>
        )}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
          {projects.all.map((project) => (
            <div
              key={project.id}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-base">
                  {project.name}
                </span>
                <Badge
                  variant={
                    project.status === 'published' ? 'secondary' : 'outline'
                  }
                  className="ml-auto shrink-0"
                >
                  {project.status === 'published' ? 'Published' : 'Draft'}
                </Badge>
              </div>
              {project.tagline && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {project.tagline}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {project.pages.map((page) => (
                  <li key={page.id}>
                    <Link
                      className="text-sm underline-offset-4 hover:underline"
                      to={`/worlds/${world.id}/build/${project.id}/${page.id}`}
                    >
                      {page.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {count(page.layout.blocks.length)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Start from a page that ships</h2>
        <p className="text-sm text-muted-foreground">
          Every page the application draws is itself a project of blocks. Copy
          one and it becomes this world&apos;s, answering at the same address;
          publish it and it is what everybody sees. Which of the bundled
          applications a world uses at all is a setting.
        </p>
        <div className="flex flex-col gap-3">
          {/*
            The front page belongs to no application, because a world has to
            have one. It can still be made this world's own.
          */}
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="font-display text-base">The front page</span>
              <span className="truncate text-xs text-muted-foreground">
                Where a world opens. Every world has one; it cannot be turned
                off.
              </span>
            </div>
            <ul className="divide-y">
              {FLOOR.map((path) => {
                const shipped = pageOf(path);
                return (
                  <li key={path} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm">{shipped?.name ?? path}</span>
                    <span className="text-xs text-muted-foreground">
                      {count(shipped?.layout.blocks.length ?? 0)}
                    </span>
                    {replaced.has(path) && (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Replaced by this world
                      </Badge>
                    )}
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="xs"
                        className="ml-auto"
                        disabled={busy !== undefined}
                        onClick={() => void customize(path)}
                      >
                        <CopyIcon data-icon="inline-start" />
                        {busy === path ? 'Copying…' : 'Customize'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {BUNDLED.map((app) => {
            const on = !projects.off.has(app.id);
            return (
              <div key={app.id} className="rounded-lg border">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className="font-display text-base">{app.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {app.tagline}
                  </span>
                  <Badge
                    variant={on ? 'secondary' : 'outline'}
                    className="ml-auto shrink-0"
                  >
                    {on ? 'On' : 'Off'}
                  </Badge>
                </div>
                <ul className="divide-y">
                  {app.pages.map((page) => {
                    const shipped = pageOf(page.path);
                    return (
                      <li
                        key={page.path}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <span className="text-sm">{page.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {count(shipped?.layout.blocks.length ?? 0)}
                        </span>
                        {replaced.has(page.path) && (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            Replaced by this world
                          </Badge>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="xs"
                            className="ml-auto"
                            disabled={busy !== undefined}
                            onClick={() => void customize(page.path)}
                          >
                            <CopyIcon data-icon="inline-start" />
                            {busy === page.path ? 'Copying…' : 'Customize'}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function count(blocks: number): string {
  return blocks === 1 ? '1 block' : `${blocks} blocks`;
}
