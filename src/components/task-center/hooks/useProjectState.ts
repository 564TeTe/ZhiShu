import { useCallback, useEffect, useState } from 'react';

import {
  confirmProjectStateProposal,
  createInitialProjectStateProposal,
  fetchProjectState,
  fetchProjectStateProposals,
  rejectProjectStateProposal,
} from '../api/taskCenterApi';
import type {
  InitialProjectStateInput,
  ProjectStateSnapshot,
  StateChangeProposal,
} from '../model/taskCenterModel';

const STATE_POLL_INTERVAL_MS = 15_000;

export function useProjectState(projectId: string, refreshToken = 0) {
  const [state, setState] = useState<ProjectStateSnapshot | null>(null);
  const [proposals, setProposals] = useState<StateChangeProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(() => setRequestVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    void Promise.all([
      fetchProjectState(projectId, controller.signal),
      fetchProjectStateProposals(projectId, controller.signal),
    ])
      .then(([stateValue, proposalValues]) => {
        if (!active) return;
        setState(stateValue);
        setProposals(proposalValues.filter(
          (proposal): proposal is StateChangeProposal => proposal.proposalType === 'STATE_CHANGE',
        ));
        setError(null);
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
  }, [projectId, refreshToken, requestVersion]);

  useEffect(() => {
    const timer = window.setInterval(refresh, STATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const establishInitialState = useCallback(async (input: InitialProjectStateInput) => {
    setIsSaving(true);
    setError(null);
    try {
      const proposal = await createInitialProjectStateProposal(projectId, input);
      await confirmProjectStateProposal(projectId, proposal.proposalId, crypto.randomUUID());
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, refresh]);

  const confirmProposal = useCallback(async (proposalId: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await confirmProjectStateProposal(projectId, proposalId, crypto.randomUUID());
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, refresh]);

  const rejectProposal = useCallback(async (proposalId: string, reason: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await rejectProjectStateProposal(projectId, proposalId, crypto.randomUUID(), reason);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, refresh]);

  return {
    state,
    proposals,
    error,
    isLoading,
    isSaving,
    refresh,
    establishInitialState,
    confirmProposal,
    rejectProposal,
  };
}
