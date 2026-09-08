import { ChevronRightIcon } from 'lucide-react';

/**
 * A record as a tree that folds: each object and array a branch, opened two
 * deep to start, each value coloured by kind. Built on the browser's own
 * disclosure element, so it needs no state and reads well to a screen reader.
 */
export function JsonTree(props: {
  readonly value: unknown;
  readonly name?: string;
  readonly depth?: number;
}) {
  const depth = props.depth ?? 0;
  const { value } = props;
  if (value !== null && typeof value === 'object') {
    const entries: readonly (readonly [string, unknown])[] = Array.isArray(
      value,
    )
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    const shape = Array.isArray(value)
      ? `[${entries.length}]`
      : `{${entries.length}}`;
    return (
      <details open={depth < 2} className="group/node">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded py-px hover:bg-muted [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-open/node:rotate-90" />
          {props.name !== undefined && (
            <span className="text-foreground">{props.name}</span>
          )}
          <span className="text-muted-foreground">{shape}</span>
        </summary>
        <div className="ml-1.5 border-l pl-3">
          {entries.map(([key, item]) => (
            <JsonTree key={key} name={key} value={item} depth={depth + 1} />
          ))}
          {entries.length === 0 && (
            <span className="text-muted-foreground">empty</span>
          )}
        </div>
      </details>
    );
  }
  return (
    <div className="flex gap-1 py-px pl-4">
      {props.name !== undefined && (
        <span className="shrink-0 text-foreground">{props.name}:</span>
      )}
      <span className={`min-w-0 break-words ${toneOf(value)}`}>
        {typeof value === 'string' ? `"${value}"` : String(value)}
      </span>
    </div>
  );
}

function toneOf(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return 'text-sage-700';
    case 'number':
      return 'text-amber-700';
    case 'boolean':
      return 'text-clay-500';
    default:
      return 'text-muted-foreground';
  }
}
