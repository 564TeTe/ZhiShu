import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchProjectMetrics } from '../api/taskCenterApi';
import type { ProjectMetrics } from '../model/taskCenterModel';

const METRICS_POLL_INTERVAL_MS = 60_000;

export function useProjectMetrics(projectId: string, refreshToken: number) {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const projectRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRequestVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetchProjectMetrics(projectId, 168, controller.signal)
      .then((value) => {
        if (!active) return;
        projectRef.current = projectId;
        setMetrics(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, refreshToken, requestVersion]);

  useEffect(() => {
    const timer = window.setInterval(refresh, METRICS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    metrics: projectRef.current === projectId ? metrics : null,
    error,
    refresh,
  };
}
