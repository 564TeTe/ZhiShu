import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchTaskCenterTaskHistory } from '../api/taskCenterApi';
import type {
  TaskCenterTaskArchiveScope,
  TaskCenterTaskPage,
} from '../model/taskCenterModel';

export type TaskHistoryFilters = {
  archive: TaskCenterTaskArchiveScope;
  status: string | null;
  resolutionStatus: string | null;
  search: string;
};

const PAGE_SIZE = 25;

export function useTaskHistory(projectId: string, filters: TaskHistoryFilters) {
  const [page, setPage] = useState<TaskCenterTaskPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const pageKeyRef = useRef<string | null>(null);
  const key = JSON.stringify([projectId, filters.archive, filters.status, filters.resolutionStatus, filters.search]);

  const refresh = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);

    void fetchTaskCenterTaskHistory(projectId, {
      ...filters,
      limit: PAGE_SIZE,
    }, controller.signal)
      .then((result) => {
        if (!active) return;
        pageKeyRef.current = key;
        setPage(result);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, key, projectId, requestVersion]);

  const currentPage = pageKeyRef.current === key ? page : null;

  const loadMore = useCallback(async () => {
    if (!currentPage?.hasMore || !currentPage.nextCursor || isLoadingMore) return;
    const requestKey = key;
    setIsLoadingMore(true);
    setError(null);
    try {
      const next = await fetchTaskCenterTaskHistory(projectId, {
        ...filters,
        cursor: currentPage.nextCursor,
        limit: PAGE_SIZE,
      });
      if (pageKeyRef.current !== requestKey) return;
      setPage((existing) => {
        if (!existing) return next;
        const seen = new Set(existing.items.map((task) => task.taskId));
        return {
          ...next,
          items: [...existing.items, ...next.items.filter((task) => !seen.has(task.taskId))],
        };
      });
    } catch (reason) {
      if (pageKeyRef.current === requestKey) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (pageKeyRef.current === requestKey) setIsLoadingMore(false);
    }
  }, [currentPage, filters, isLoadingMore, key, projectId]);

  return {
    page: currentPage,
    error,
    isLoading: isLoading || (!currentPage && !error),
    isLoadingMore,
    refresh,
    loadMore,
  };
}
