import { type ModelId, models } from '@opendnd/types';
import { type Resource, type Store, ValidationError } from './store';

export type Format = 'json' | 'markdown';

export function isFormat(value: string): value is Format {
  return value === 'json' || value === 'markdown';
}

/**
 * Everything in a world, model by model.
 *
 * A world is exported whole rather than by model, because a resource is only
 * meaningful with the things it refers to: a tenure without its title and its
 * holder is three ids and no history.
 */
export async function exportWorld(
  store: Store,
  format: Format,
  at?: number,
): Promise<{ contentType: string; body: string }> {
  const gathered = new Map<ModelId, Resource[]>();
  for (const model of Object.keys(models) as ModelId[]) {
    const resources: Resource[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list(model, {
        limit: 500,
        ...(cursor ? { cursor } : {}),
        ...(at === undefined ? {} : { at }),
      });
      resources.push(...page.resources);
      cursor = page.next;
    } while (cursor !== undefined);
    if (resources.length > 0) gathered.set(model, resources);
  }

  if (format === 'json') {
    // Published in the shape OURS publishes in, so an export can be read
    // back by the same tooling that reads the ontology itself.
    return {
      contentType: 'application/json',
      body: `${JSON.stringify(
        {
          resourceType: 'Bundle',
          type: 'collection',
          total: [...gathered.values()].reduce((n, r) => n + r.length, 0),
          entry: [...gathered].flatMap(([model, resources]) =>
            resources.map((resource) => ({ model, resource })),
          ),
        },
        null,
        2,
      )}\n`,
    };
  }

  return { contentType: 'text/markdown', body: markdown(gathered) };
}

/** A readable digest: what the world holds, and the record of what happened. */
function markdown(gathered: Map<ModelId, Resource[]>): string {
  const world = gathered.get('world')?.[0];
  const lines: string[] = [
    `# ${String(world?.name ?? 'A world')}`,
    '',
    ...(world?.summary ? [String(world.summary), ''] : []),
    '## What it holds',
    '',
    '| Model | Records |',
    '|---|---|',
    ...[...gathered]
      .filter(([model]) => model !== 'event')
      .map(([model, resources]) => `| ${model} | ${resources.length} |`),
    '',
  ];

  const events = gathered.get('event') ?? [];
  if (events.length > 0) {
    lines.push('## History', '');
    for (const event of [...events].sort(byYear)) {
      const year = yearOf(event);
      const description = event.description
        ? ` ${String(event.description)}`
        : '';
      lines.push(
        `- **${year ?? '—'}** ${String(event.name)}.${description}`.trimEnd(),
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function yearOf(event: Resource): number | undefined {
  const when = event.when as
    { begin?: { year?: number }; end?: { year?: number } } | undefined;
  return when?.begin?.year ?? when?.end?.year;
}

function byYear(a: Resource, b: Resource): number {
  return (yearOf(a) ?? 0) - (yearOf(b) ?? 0);
}

export function assertFormat(value: string): Format {
  if (!isFormat(value)) {
    throw new ValidationError(
      `${value} is not a format this API writes; use json or markdown`,
      [{ path: ['format'], message: 'unsupported' }],
    );
  }
  return value;
}
