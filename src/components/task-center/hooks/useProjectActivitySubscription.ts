import { useEffect, useRef, useState } from 'react';

import { fetchProjectActivity } from '../api/taskCenterApi';
import type {
  ProjectActivityEvent,
  ProjectActivitySubscriptionState,
} from '../model/taskCenterModel';

const LIVE_POLL_INTERVAL_MS = 3_000;
const RETRY_INTERVAL_MS = 15_000;
const MAX_SEEN_EVENT_IDS = 500;

type InvalidateProject = (
  fullResync: boolean,
  events: ProjectActivityEvent[],
) => void | Promise<void>;

export function useProjectActivitySubscription(
  projectId: string,
  onInvalidate: InvalidateProject,
): ProjectActivitySubscriptionState {
  const [state, setState] = useState<ProjectActivitySubscriptionState>({
    status: 'CONNECTING', lastCursor: null, lastEventAt: null, error: null,
  });
  const invalidateRef = useRef(onInvalidate);

  useEffect(() => {
    invalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let cursor: number | null = null;
    let failures = 0;
    const seen = new Set<string>();

    const remember = (eventId: string) => {
      seen.add(eventId);
      if (seen.size <= MAX_SEEN_EVENT_IDS) return;
      const oldest = seen.values().next().value as string | undefined;
      if (oldest) seen.delete(oldest);
    };

    const schedule = (delay: number) => {
      if (!active) return;
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      controller = new AbortController();
      try {
        const page = await fetchProjectActivity(
          projectId,
          cursor === null ? undefined : cursor,
          controller.signal,
        );
        if (!active) return;

        if (cursor === null || page.status === 'RESYNC_REQUIRED') {
          cursor = page.latestCursor;
          seen.clear();
          await invalidateRef.current(true, []);
        } else {
          const unseen = page.events.filter((event) => !seen.has(event.eventId));
          if (unseen.length > 0) {
            await invalidateRef.current(false, unseen);
            unseen.forEach((event) => remember(event.eventId));
          }
          cursor = page.nextCursor;
        }
        if (!active) return;
        failures = 0;
        const lastEvent = page.events.at(-1);
        setState((current) => ({
          status: 'LIVE',
          lastCursor: cursor,
          lastEventAt: lastEvent?.occurredAt ?? current.lastEventAt,
          error: null,
        }));
        schedule(page.hasMore ? 0 : LIVE_POLL_INTERVAL_MS);
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        failures += 1;
        setState((current) => ({
          ...current,
          status: failures >= 3 ? 'FALLBACK' : 'RECONNECTING',
          error: reason instanceof Error ? reason.message : String(reason),
        }));
        schedule(RETRY_INTERVAL_MS);
      }
    };

    setState({ status: 'CONNECTING', lastCursor: null, lastEventAt: null, error: null });
    void poll();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [projectId]);

  return state;
}
