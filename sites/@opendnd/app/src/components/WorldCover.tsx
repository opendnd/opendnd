/* eslint-disable no-bitwise -- a hash is bit arithmetic; mixing and shifting are the point */
import { useMemo } from 'react';
import { useApi } from '../app/context';
import { useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import {
  type Cell,
  cellModels,
  commonAncestor,
  parseCell,
  placeWithin,
} from '../schema/cells';

/**
 * A world's picture, drawn from the world itself: what it has placed on its
 * map, as the map page would draw it, in the world's own colours. A world
 * with nothing placed yet gets a quiet pattern of its own instead, so the
 * worlds still read as distinct places side by side.
 */
export function WorldCover(props: {
  readonly world: string;
  readonly className?: string;
}) {
  const api = useApi();
  const ontology = useOntology();
  const models = useMemo(() => cellModels(ontology), [ontology]);
  const first = models[0];
  const placed = useRequest(async () => {
    if (!first) return [] as Cell[];
    const page = await api.list(props.world, first.model, { limit: 200 });
    return page.resources
      .map((r) => parseCell(r[first.field]))
      .filter((c): c is Cell => c !== undefined);
  }, [api, props.world, first?.model, first?.field]);
  const cells = placed.data ?? [];
  const focus = commonAncestor(cells);
  const seeds = useMemo(() => pattern(props.world), [props.world]);

  return (
    <svg
      viewBox="0 0 160 90"
      role="img"
      aria-label="World cover"
      className={
        props.className ?? 'aspect-video w-full rounded-t-lg bg-sage-50'
      }
    >
      {focus
        ? cells
            .filter((c) => c.face === focus.face)
            .sort((a, b) => a.level - b.level)
            .map((cell) => {
              const at = placeWithin(focus, cell)!;
              const size = Math.max(at.size * 90, 3);
              return (
                <rect
                  key={cell.token}
                  x={35 + at.x * 90}
                  y={at.y * 90}
                  width={size}
                  height={size}
                  rx={1}
                  fill="var(--sage-500)"
                  fillOpacity={0.35}
                  stroke="var(--sage-600)"
                  strokeWidth={0.6}
                />
              );
            })
        : seeds.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={s.fill}
              fillOpacity={0.5}
            />
          ))}
    </svg>
  );
}

/** A few soft shapes decided by the world's id, so the same world always looks the same. */
function pattern(
  seed: string,
): { x: number; y: number; r: number; fill: string }[] {
  let h = 2166136261;
  for (const ch of seed) h = (h ^ ch.charCodeAt(0)) * 16777619;
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
  const fills = [
    'var(--sage-300)',
    'var(--amber-300)',
    'var(--sage-500)',
    'var(--clay-200)',
  ];
  return Array.from({ length: 5 }, (_, i) => ({
    x: 10 + next() * 140,
    y: 10 + next() * 70,
    r: 10 + next() * 26,
    fill: fills[i % fills.length]!,
  }));
}
