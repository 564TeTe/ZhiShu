import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchTaskCenterDashboard } from '../api/taskCenterApi';
import type { TaskCenterDashboard } from '../model/taskCenterModel';

const POLL_INTERVAL_MS = 15_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

export function useTaskCenterDashboard(projectId: string) {
  const [dashboard, setDashboard] = useState<TaskCenterDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dashboardProjectIdRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const hasCurrentDashboard = dashboardProjectIdRef.current === projectId;
    setIsLoading(!hasCurrentDashboard);
    setIsRefreshing(hasCurrentDashboard);
    setError(null);

    void fetchTaskCenterDashboard(projectId, controller.signal)
      .then((result) => {
        if (!active) return;
        dashboardProjectIdRef.current = result.project.projectId;
        setDashboard(result);
        setNow(Date.now());
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, requestVersion]);

  useEffect(() => {
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), STALE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const currentDashboard = dashboard?.project.projectId === projectId ? dashboard : null;
  const isStale = useMemo(() => {
    if (!currentDashboard) return false;
    const fetchedAt = Date.parse(currentDashboard.fetchedAt);
    return !Number.isFinite(fetchedAt) || now - fetchedAt > currentDashboard.staleAfterMs;
  }, [currentDashboard, now]);

  return {
    dashboard: currentDashboard,
    error,
    isLoading: isLoading || (!currentDashboard && !error),
    isRefreshing,
    isStale,
    refresh,
  };
}
