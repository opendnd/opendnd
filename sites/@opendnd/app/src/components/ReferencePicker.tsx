import { useState } from 'react';
import { Link } from 'react-router';
import type { Reference, SearchHit } from '../api/types';
import { useApi } from '../app/context';
import { useDebounced, useRequest } from '../app/hooks';
import { useOntology } from '../app/ontology';
import { recordPath, useWorld } from '../app/world';
import { humanize } from '../schema/fields';
import { Badge } from '@/components/ui/badge';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';

export interface ReferencePickerProps {
  readonly value?: Reference;
  readonly id?: string;
  /** Only these models are searched, when the field fixes them. */
  readonly models?: readonly string[];
  onChange(value: Reference | undefined): void;
}

/**
 * Picks a resource in the current world by searching its name. The chosen
 * reference keeps the name it had when chosen, which is what the ontology's
 * `Reference` carries for display.
 */
export function ReferencePicker(props: ReferencePickerProps) {
  const api = useApi();
  const ontology = useOntology();
  const { world } = useWorld();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 250);
  const models = props.models;
  const modelsKey = models?.join(',') ?? '';
  const results = useRequest(
    () =>
      debounced.length > 0
        ? api.search(world.id, debounced, 20, models)
        : Promise.resolve([] as SearchHit[]),
    // The joined key stands for the list, which callers rebuild each render.
    [api, world.id, debounced, modelsKey],
  );
  const placeholder = models
    ? `Search ${models.map((m) => ontology.label(m).toLowerCase()).join(' or ')} by name`
    : 'Search this world by name';

  const selected: SearchHit | null = props.value
    ? {
        model: props.value.model,
        id: props.value.id,
        name: props.value.name ?? props.value.id,
        canonStatus: '',
      }
    : null;
  const hits = results.data ?? [];
  const items =
    selected && !hits.some((h) => sameHit(h, selected))
      ? [selected, ...hits]
      : hits;

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox<SearchHit>
        items={items}
        value={selected}
        onValueChange={(hit) =>
          props.onChange(
            hit ? { model: hit.model, id: hit.id, name: hit.name } : undefined,
          )
        }
        filter={null}
        itemToStringLabel={(hit) => hit.name}
        isItemEqualToValue={sameHit}
        onInputValueChange={setQuery}
      >
        <ComboboxInput
          id={props.id}
          className="w-full"
          placeholder={placeholder}
          showClear
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {results.loading
              ? 'Searching…'
              : debounced
                ? 'Nothing by that name.'
                : 'Type a name to search.'}
          </ComboboxEmpty>
          <ComboboxList>
            {(hit: SearchHit) => (
              <ComboboxItem key={`${hit.model}/${hit.id}`} value={hit}>
                <span className="grow">{hit.name}</span>
                <span className="text-xs text-muted-foreground">
                  {humanize(hit.model)}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {props.value && (
        <p className="flex items-center gap-1.5 text-sm">
          <Link
            className="underline underline-offset-4"
            to={recordPath(world.id, props.value.model, props.value.id)}
          >
            {props.value.name ?? props.value.id}
          </Link>
          <Badge variant="ghost" className="text-muted-foreground">
            {humanize(props.value.model)}
          </Badge>
        </p>
      )}
    </div>
  );
}

function sameHit(a: SearchHit, b: SearchHit): boolean {
  return a.model === b.model && a.id === b.id;
}
