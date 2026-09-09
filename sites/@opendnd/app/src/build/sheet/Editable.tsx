import { LoaderCircleIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useState } from 'react';
import { useApi } from '../../app/context';
import { useWorld } from '../../app/world';

/**
 * A number on the sheet that can be changed where it stands.
 *
 * This is the difference between a sheet and a printout of one. A player at a
 * table takes six damage and wants to type a six, not to open a form, find
 * the field, save, and come back. So a value is a button; clicking it gives
 * an input; Enter or leaving it writes the record and the sheet recomputes,
 * because everything else on the sheet is derived from what was just typed.
 *
 * Nothing is saved optimistically. A number that snapped back an instant
 * after being typed would be worse than one that took a moment to settle.
 */

interface Editing {
  readonly canEdit: boolean;
  readonly model: string;
  readonly id: string;
  /** Merge-patch the record and hand back the version now stored. */
  save(patch: Record<string, unknown>): Promise<void>;
  readonly saving: boolean;
  readonly error: Error | undefined;
}

const Context = createContext<Editing | undefined>(undefined);

export function EditingProvider(props: {
  readonly model: string;
  readonly id: string;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
  readonly children: ReactNode;
}) {
  const api = useApi();
  const { world } = useWorld();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const value: Editing = {
    canEdit: props.canEdit,
    model: props.model,
    id: props.id,
    saving,
    error,
    save: async (patch) => {
      setSaving(true);
      setError(undefined);
      try {
        await api.patch(world.id, props.model, props.id, patch);
        props.onSaved();
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        setSaving(false);
      }
    },
  };
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export function useEditing(): Editing | undefined {
  return useContext(Context);
}

export interface NumberFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  /** The merge patch that sets this value, given the number typed. */
  readonly patch: (next: number) => Record<string, unknown>;
  readonly min?: number;
  readonly max?: number;
  readonly className?: string;
  /** Shown when there is no value and nobody may add one. */
  readonly placeholder?: string;
}

/** A number a player can change by clicking it. */
export function NumberField(props: NumberFieldProps) {
  const editing = useEditing();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = props.value === undefined ? (props.placeholder ?? '—') : String(props.value);

  if (!editing?.canEdit) {
    return <span className={props.className}>{shown}</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`${props.label}: ${shown}. Click to change.`}
        className={`rounded px-1 transition-colors hover:bg-accent ${props.className ?? ''}`}
        onClick={() => {
          setDraft(props.value === undefined ? '' : String(props.value));
          setOpen(true);
        }}
      >
        {shown}
      </button>
    );
  }

  const commit = () => {
    setOpen(false);
    const next = Number(draft);
    if (draft.trim() === '' || Number.isNaN(next)) return;
    if (next === props.value) return;
    const bounded = Math.min(
      props.max ?? Number.MAX_SAFE_INTEGER,
      Math.max(props.min ?? Number.MIN_SAFE_INTEGER, Math.round(next)),
    );
    void editing.save(props.patch(bounded));
  };

  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the click that
      // opened this was a click on the value; the caret belongs here.
      autoFocus
      type="number"
      aria-label={props.label}
      value={draft}
      min={props.min}
      max={props.max}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setOpen(false);
      }}
      className={`w-full min-w-0 rounded border bg-background px-1 text-center tabular-nums outline-none focus:border-ring ${props.className ?? ''}`}
    />
  );
}

/** Whether anything is being written, for a sheet to say so quietly. */
export function SavingMark() {
  const editing = useEditing();
  if (!editing) return null;
  if (editing.error) {
    return (
      <span className="text-xs text-destructive" role="status">
        Not saved: {editing.error.message}
      </span>
    );
  }
  if (editing.saving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-3 animate-spin" />
        Saving
      </span>
    );
  }
  return null;
}
