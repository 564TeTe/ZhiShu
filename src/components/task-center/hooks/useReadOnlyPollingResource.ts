import { useCallback, useEffect, useState } from 'react';

type ScopedValue<T> = {
  scopeKey: string;
  value: T;
};

type ScopedError = {
  scopeKey: string;
  message: string;
};

export function useReadOnlyPollingResource<T>({
  scopeKey,
  load,
  refreshToken = 0,
  intervalMs = 10_000,
}: {
  scopeKey: string;
  load: (signal: AbortSignal) => Promise<T>;
  refreshToken?: number;
  intervalMs?: number;
}) {
  const [resource, setResource] = useState<ScopedValue<T> | null>(null);
  const [failure, setFailure] = useState<ScopedError | null>(null);
  const [loadingScope, setLoadingScope] = useState(scopeKey);
  const [isRequestLoading, setIsRequestLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const refresh = useCallback(() => setRequestVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadingScope(scopeKey);
    setIsRequestLoading(true);
    void load(controller.signal)
      .then((value) => {
        if (!active) return;
        setResource({ scopeKey, value });
        setFailure(null);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setFailure({
          scopeKey,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => {
        if (active) setIsRequestLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [load, refreshToken, requestVersion, scopeKey]);

  useEffect(() => {
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, refresh]);

  return {
    data: resource?.scopeKey === scopeKey ? resource.value : null,
    error: failure?.scopeKey === scopeKey ? failure.message : null,
    isLoading: loadingScope === scopeKey ? isRequestLoading : true,
    refresh,
  };
}
