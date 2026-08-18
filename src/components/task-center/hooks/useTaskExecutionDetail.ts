import { useCallback, useEffect, useRef, useState } from 'react';

import {
  acceptTaskResult,
  archiveTask,
  cancelTask,
  createTaskFollowUp,
  decideTaskApproval,
  fetchTaskCenterTaskDetail,
  retryLostTask,
  retryTask,
} from '../api/taskCenterApi';
import type { TaskCenterTaskDetail } from '../model/taskCenterModel';

const POLL_INTERVAL_MS = 15_000;

export function useTaskExecutionDetail(projectId: string, taskId: string | null) {
  const [detail, setDetail] = useState<TaskCenterTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const detailKeyRef = useRef<string | null>(null);
  const commandInFlightRef = useRef(false);
  const idempotencyKeysRef = useRef(new Map<string, string>());

  const refresh = useCallback(() => {
    if (taskId) setRequestVersion((version) => version + 1);
  }, [taskId]);

  const runCommand = useCallback(async (command: string, action: () => Promise<unknown>) => {
    if (!taskId || commandInFlightRef.current) return;
    commandInFlightRef.current = true;
    setActiveCommand(command);
    setError(null);
    try {
      await action();
      setRequestVersion((version) => version + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      commandInFlightRef.current = false;
      setActiveCommand(null);
    }
  }, [taskId]);

  const idempotencyKey = useCallback((scope: string) => {
    const existing = idempotencyKeysRef.current.get(scope);
    if (existing) return existing;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = `${scope.split(':', 1)[0]}-${random}`;
    idempotencyKeysRef.current.set(scope, created);
    return created;
  }, []);

  const retryLost = useCallback(async () => {
    if (!taskId) return;
    await runCommand('retry', () => retryLostTask(projectId, taskId));
  }, [projectId, runCommand, taskId]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    await runCommand('cancel', () => cancelTask(projectId, taskId));
  }, [projectId, runCommand, taskId]);

  const retry = useCallback(async () => {
    if (!taskId) return;
    await runCommand('retry', () => retryTask(projectId, taskId));
  }, [projectId, runCommand, taskId]);

  const archive = useCallback(async (reason: string) => {
    if (!taskId) return;
    await runCommand('archive', () => archiveTask(projectId, taskId, reason));
  }, [projectId, runCommand, taskId]);

  const followUp = useCallback(async (
    parentAttemptId: string,
    feedback: string,
    requestedAcceptance: string,
  ) => {
    if (!taskId) return;
    const scope = `follow-up:${taskId}:${parentAttemptId}:${feedback}:${requestedAcceptance}`;
    await runCommand('follow-up', async () => {
      await createTaskFollowUp(projectId, taskId, {
        parentAttemptId, feedback, requestedAcceptance, clientRequestId: idempotencyKey(scope),
      });
      idempotencyKeysRef.current.delete(scope);
    });
  }, [idempotencyKey, projectId, runCommand, taskId]);

  const accept = useCallback(async (
    attemptId: string,
    decision: 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED',
    reason: string,
  ) => {
    if (!taskId) return;
    const scope = `acceptance:${taskId}:${attemptId}:${decision}:${reason}`;
    await runCommand('acceptance', async () => {
      await acceptTaskResult(projectId, taskId, {
        attemptId, decision, reason, clientRequestId: idempotencyKey(scope),
      });
      idempotencyKeysRef.current.delete(scope);
    });
  }, [idempotencyKey, projectId, runCommand, taskId]);

  const decideApproval = useCallback(async (
    approvalId: string,
    decision: 'APPROVED' | 'DENIED',
    message?: string,
  ) => {
    if (!taskId) return;
    await runCommand(`approval:${approvalId}`, () => decideTaskApproval(
      projectId, taskId, approvalId, decision, message,
    ));
  }, [projectId, runCommand, taskId]);

  useEffect(() => {
    if (!taskId) {
      detailKeyRef.current = null;
      setDetail(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const detailKey = `${projectId}:${taskId}`;
    const hasCurrentDetail = detailKeyRef.current === detailKey;
    setIsLoading(!hasCurrentDetail);
    setIsRefreshing(hasCurrentDetail);
    setError(null);

    void fetchTaskCenterTaskDetail(projectId, taskId, controller.signal)
      .then((result) => {
        if (!active) return;
        detailKeyRef.current = detailKey;
        setDetail(result);
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
  }, [projectId, taskId, requestVersion]);

  useEffect(() => {
    if (!taskId) return;
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, taskId]);

  const detailKey = taskId ? `${projectId}:${taskId}` : null;
  return {
    detail: detailKey && detailKeyRef.current === detailKey ? detail : null,
    error,
    isLoading,
    isRefreshing,
    activeCommand,
    refresh,
    retryLost,
    cancel,
    retry,
    archive,
    followUp,
    accept,
    decideApproval,
  };
}
