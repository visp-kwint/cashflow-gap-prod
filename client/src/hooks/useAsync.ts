import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Универсальный хук загрузки данных: каждое изменение deps запускает запрос,
 * отменяет устаревшие ответы, держит data/loading/error.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (id === seq.current) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (id === seq.current) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { data, loading, error, refetch: run };
}
