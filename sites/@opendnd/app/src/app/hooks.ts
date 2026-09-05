import { type DependencyList, useCallback, useEffect, useState } from 'react';

export interface Request<T> {
  readonly data?: T;
  readonly error?: Error;
  readonly loading: boolean;
  reload(): void;
}

/**
 * Runs a request when its dependencies change, and once more on `reload`.
 * A request that is superseded before it answers is aborted and its answer
 * dropped, so a fast navigation never shows the previous page's data.
 */
export function useRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): Request<T> {
  const [state, setState] = useState<{
    data?: T;
    error?: Error;
    loading: boolean;
  }>({ loading: true });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    run(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        });
      });
    return () => controller.abort();
    // The caller states what the request depends on.
  }, [...deps, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, reload };
}

/** A value that follows `input` after it has stopped changing for `delayMs`. */
export function useDebounced<T>(input: T, delayMs: number): T {
  const [value, setValue] = useState(input);
  useEffect(() => {
    const timer = setTimeout(() => setValue(input), delayMs);
    return () => clearTimeout(timer);
  }, [input, delayMs]);
  return value;
}
