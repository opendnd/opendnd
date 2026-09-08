import { picture } from './Article';
import type { Resource } from '../api/types';
import { cn } from '@/lib/utils';

/** The soft tones a stand-in thumbnail is drawn in, chosen by the name. */
const TONES = ['sage', 'amber', 'stone'] as const;

/**
 * A record's small picture: its image when it has one, and otherwise a tile
 * in a colour decided by its name with its initial on it, so a list of
 * records reads as a row of distinct things whether or not anyone has found
 * pictures for them yet.
 */
export function Thumb(props: {
  readonly resource: Resource;
  readonly className?: string;
}) {
  const src = picture(props.resource);
  const name = String(props.resource.name ?? props.resource.id);
  const size = 'size-14 shrink-0 rounded-md';
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn(size, 'object-cover', props.className)}
      />
    );
  }
  const tone = TONES[hash(name) % TONES.length]!;
  return (
    <span
      aria-hidden
      className={cn(
        size,
        'flex items-center justify-center font-display text-xl',
        props.className,
      )}
      style={{ background: `var(--${tone}-100)`, color: `var(--${tone}-700)` }}
    >
      {initial(name)}
    </span>
  );
}

function initial(name: string): string {
  const first = name.trim().replace(/^(the|a|an|la|le|les|el|los|las)\s+/i, '');
  return (first[0] ?? name[0] ?? '?').toUpperCase();
}

function hash(text: string): number {
  let h = 5381;
  for (const ch of text) h = (h * 33 + ch.charCodeAt(0)) % 4294967296;
  return h;
}
